#!/usr/bin/env node
 
/**
 * WPN-1527 spike — TRC-20 swap fee estimation via a MetaMask reference account.
 *
 * Standalone prototype (no snap changes). Simulates captured swap
 * TriggerSmartContract transactions via `triggerconstantcontract`, comparing:
 *   A. baseline        — owner_address as captured (expected FAILED pre-approve)
 *   B. reference-owner — owner_address rewritten to the reference account
 *   C. data-rewrite    — B + user address occurrences in `data` rewritten too
 *   D. custom-replace  — B + arbitrary hex replacements in `data` (--replace)
 * and, when the tx is confirmed on-chain, the ACTUAL energy/fee paid.
 *
 * Every run appends structured records to data/runs.jsonl and every RPC call
 * to data/events.jsonl. data/registry.json aggregates every contract address,
 * method selector and owner seen across runs — this is the Phase 0 dataset
 * (which routers to approve from the reference account).
 *
 * Usage:
 *   node spike.mjs capture <txid> [--network mainnet]
 *   node spike.mjs simulate <txid|capture.json> --ref <base58|hex41> \
 *       [--rewrite-data] [--replace <findHex>:<replaceHex>]... [--label <note>]
 *   node spike.mjs check-ref <address> [--token <addr>] [--router <addr>]...
 *   node spike.mjs registry
 *
 * Environment (read from packages/snap/.env if present):
 *   TRON_HTTP_BASE_URL_MAINNET / _NILE / _SHASTA — node HTTP endpoint
 *   TRON_PRO_API_KEY                             — optional TronGrid API key
 *   REFERENCE_ADDRESS                            — default for --ref
 */

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants (mirrors packages/snap/src/constants/index.ts)
// ---------------------------------------------------------------------------

const FEE_LIMIT_SUN = 100_000_000; // FEE_LIMIT — current 100 TRX fallback cap
const SUN_IN_TRX = 1_000_000;
const FALLBACK_ENERGY_PRICE_SUN = 420;

const DEFAULT_BASE_URLS = {
  mainnet: 'https://api.trongrid.io',
  nile: 'https://nile.trongrid.io',
  shasta: 'https://api.shasta.trongrid.io',
};

/** USDT mainnet — default token for check-ref. */
const USDT_MAINNET = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/** Known 4-byte selectors, for readable logs. Unknowns accumulate in the registry. */
const KNOWN_SELECTORS = {
  '095ea7b3': 'approve(address,uint256)',
  a9059cbb: 'transfer(address,uint256)',
  '23b872dd': 'transferFrom(address,address,uint256)',
  '70a08231': 'balanceOf(address)',
  dd62ed3e: 'allowance(address,address)',
  '313ce567': 'decimals()',
  '38ed1739': 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
  '18cbafe5': 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)',
  '7ff36ab5': 'swapExactETHForTokens(uint256,address[],address,uint256)',
  '8803dbee': 'swapTokensForExactTokens(uint256,uint256,address[],address,uint256)',
  fb3bdb41: 'swapETHForExactTokens(uint256,address[],address,uint256)',
  '5c11d795':
    'swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)',
  '791ac947':
    'swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)',
  b6f9de95:
    'swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)',
  '3593564c': 'execute(bytes,bytes[],uint256)', // UniversalRouter (MM route)
  '87517c45': 'approve(address,address,uint160,uint48)', // Permit2
};

/**
 * Static-argument slot index of the `deadline` parameter for uniswap-style
 * selectors. Captured swaps expire within minutes, making re-simulation fail
 * with 'UniswapV2Router: EXPIRED' — --bump-deadline rewrites this slot.
 */
const DEADLINE_SLOT = {
  '38ed1739': 4,
  '18cbafe5': 4,
  '8803dbee': 4,
  '5c11d795': 4,
  '791ac947': 4,
  '7ff36ab5': 3,
  fb3bdb41: 3,
  b6f9de95: 3,
  '3593564c': 2, // UniversalRouter execute(commands, inputs, deadline)
};

/**
 * amountIn / amountOutMin slots for exact-in uniswap-style selectors, used by
 * --clamp-amount to fit simulations inside the reference account's balance.
 */
const EXACT_IN_SLOTS = {
  '38ed1739': { amountIn: 0, amountOutMin: 1 },
  '18cbafe5': { amountIn: 0, amountOutMin: 1 },
  '5c11d795': { amountIn: 0, amountOutMin: 1 },
  '791ac947': { amountIn: 0, amountOutMin: 1 },
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(SCRIPT_DIR, 'data');
const CAPTURES_DIR = path.join(DATA_DIR, 'captures');
const RUNS_FILE = path.join(DATA_DIR, 'runs.jsonl');
const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');
const REGISTRY_FILE = path.join(DATA_DIR, 'registry.json');

// ---------------------------------------------------------------------------
// Logging — pretty console output + persistent JSONL event log
// ---------------------------------------------------------------------------

const nowIso = () => new Date().toISOString();

function ensureDataDirs() {
  mkdirSync(CAPTURES_DIR, { recursive: true });
}

function appendJsonl(file, record) {
  ensureDataDirs();
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}

/**
 * Log an event: pretty on the console, full-fidelity in data/events.jsonl.
 *
 * @param {string} event - Short event name (e.g. 'rpc', 'variant-result').
 * @param {string} message - Human-readable one-liner.
 * @param {object} [data] - Structured payload, persisted verbatim.
 */
function logEvent(event, message, data = {}) {
  // Console gets a deep-truncated preview; events.jsonl keeps full fidelity.
  const truncate = (value) => {
    if (typeof value === 'string' && value.length > 140) {
      return `${value.slice(0, 140)}… (${value.length} chars)`;
    }
    if (Array.isArray(value)) {
      return value.slice(0, 10).map(truncate);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, val]) => [key, truncate(val)]),
      );
    }
    return value;
  };
  const preview = truncate(data);
  console.log(
    `[${nowIso()}] [${event}] ${message}`,
    Object.keys(preview).length ? JSON.stringify(preview, null, 1) : '',
  );
  appendJsonl(EVENTS_FILE, { ts: nowIso(), event, message, ...data });
}

function section(title) {
  console.log(`\n${'='.repeat(78)}\n  ${title}\n${'='.repeat(78)}`);
}

// ---------------------------------------------------------------------------
// TRON address utilities (base58check <-> 41-prefixed hex)
// ---------------------------------------------------------------------------

const B58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const sha256 = (buf) => createHash('sha256').update(buf).digest();

function b58encode(buf) {
  let num = BigInt(`0x${buf.toString('hex')}`);
  let out = '';
  while (num > 0n) {
    out = B58_ALPHABET[Number(num % 58n)] + out;
    num /= 58n;
  }
  for (const byte of buf) {
    if (byte !== 0) {
      break;
    }
    out = `1${out}`;
  }
  return out;
}

function b58decode(str) {
  let num = 0n;
  for (const char of str) {
    const idx = B58_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error(`Invalid base58 character: ${char}`);
    }
    num = num * 58n + BigInt(idx);
  }
  let hex = num.toString(16);
  if (hex.length % 2) {
    hex = `0${hex}`;
  }
  let buf = Buffer.from(hex, 'hex');
  let leadingOnes = 0;
  for (const char of str) {
    if (char !== '1') {
      break;
    }
    leadingOnes += 1;
  }
  if (leadingOnes) {
    buf = Buffer.concat([Buffer.alloc(leadingOnes), buf]);
  }
  return buf;
}

function hex41ToBase58(hex41) {
  const payload = Buffer.from(hex41, 'hex');
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return b58encode(Buffer.concat([payload, checksum]));
}

function base58ToHex41(address) {
  const decoded = b58decode(address);
  const payload = decoded.subarray(0, decoded.length - 4);
  const checksum = decoded.subarray(decoded.length - 4);
  const expected = sha256(sha256(payload)).subarray(0, 4);
  if (!checksum.equals(expected)) {
    throw new Error(`Invalid base58check checksum for address ${address}`);
  }
  return payload.toString('hex');
}

/**
 * Normalize any TRON address form to lowercase 41-prefixed hex.
 *
 * @param {string} address - Base58 (T...), 41-hex, or 0x/plain 20-byte hex.
 * @returns {string} Lowercase 41-prefixed hex address.
 */
function toHex41(address) {
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/u.test(address)) {
    return base58ToHex41(address).toLowerCase();
  }
  const stripped = address.replace(/^0x/u, '').toLowerCase();
  if (/^41[0-9a-f]{40}$/u.test(stripped)) {
    return stripped;
  }
  if (/^[0-9a-f]{40}$/u.test(stripped)) {
    return `41${stripped}`;
  }
  throw new Error(`Unrecognized TRON address format: ${address}`);
}

const toBase58 = (anyAddress) => hex41ToBase58(toHex41(anyAddress));

/** 20-byte hex (no 41 prefix) — the form embedded in ABI-encoded calldata. */
const toEvmHex20 = (anyAddress) => toHex41(anyAddress).slice(2);

const pad32 = (hex20) => hex20.padStart(64, '0');

// ---------------------------------------------------------------------------
// Environment + HTTP client
// ---------------------------------------------------------------------------

function loadDotEnv() {
  const envPath = path.join(SCRIPT_DIR, '..', '..', '.env');
  if (!existsSync(envPath)) {
    return;
  }
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/u);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/gu, '');
    }
  }
}

function makeClient(network) {
  const envKey = `TRON_HTTP_BASE_URL_${network.toUpperCase()}`;
  const baseUrl = process.env[envKey] || DEFAULT_BASE_URLS[network];
  if (!baseUrl) {
    throw new Error(`No base URL for network ${network} (set ${envKey})`);
  }
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.TRON_PRO_API_KEY) {
    headers['TRON-PRO-API-KEY'] = process.env.TRON_PRO_API_KEY;
  }
  logEvent('client', `Using node endpoint for ${network}`, {
    baseUrl,
    apiKey: process.env.TRON_PRO_API_KEY ? 'set' : 'not set',
  });

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  return async function rpc(pathname, body, { method = 'POST' } = {}) {
    const url = `${baseUrl.replace(/\/$/u, '')}${pathname}`;
    const startedAt = Date.now();
    let response;
    // Public TronGrid rate-limits aggressively (WPN-1449): retry 429s with backoff
    for (let attempt = 1; ; attempt++) {
      response = await fetch(url, {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      });
      if (response.status !== 429 || attempt >= 5) {
        break;
      }
      const retryAfterMs =
        Number(response.headers.get('retry-after')) * 1000 ||
        1000 * 2 ** (attempt - 1);
      logEvent(
        'rpc-retry',
        `${pathname} -> HTTP 429, retrying in ${retryAfterMs}ms (attempt ${attempt}/5)`,
      );
      await sleep(retryAfterMs);
    }
    const durationMs = Date.now() - startedAt;
    if (!response.ok) {
      logEvent('rpc-error', `${pathname} -> HTTP ${response.status}`, {
        url,
        request: body,
        status: response.status,
        durationMs,
      });
      throw new Error(`HTTP ${response.status} on ${pathname}`);
    }
    const json = await response.json();
    logEvent('rpc', `${pathname} (${durationMs}ms)`, {
      url,
      request: body,
      response: json,
      durationMs,
    });
    return json;
  };
}

// ---------------------------------------------------------------------------
// Registry — persistent aggregation of addresses/selectors across runs
// ---------------------------------------------------------------------------

function loadRegistry() {
  if (!existsSync(REGISTRY_FILE)) {
    return { contracts: {}, owners: {}, updatedAt: null };
  }
  return JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
}

function saveRegistry(registry) {
  ensureDataDirs();
  registry.updatedAt = nowIso();
  writeFileSync(REGISTRY_FILE, `${JSON.stringify(registry, null, 2)}\n`);
}

/**
 * Record a contract/selector/owner observation in the registry.
 *
 * @param {object} params - Observation.
 * @param {string} params.contractHex - Contract address (41-hex).
 * @param {string|null} params.selector - 4-byte method selector.
 * @param {string|null} params.ownerHex - Owner address (41-hex).
 * @param {string|null} params.contractName - Name from getcontract, if known.
 * @param {string} params.source - Where this was seen (txid, file, ...).
 * @param {string} params.network - Network name.
 */
function recordObservation({
  contractHex,
  selector,
  ownerHex,
  contractName,
  source,
  network,
}) {
  const registry = loadRegistry();
  const ts = nowIso();

  const contract = (registry.contracts[contractHex] ??= {
    base58: hex41ToBase58(contractHex),
    name: null,
    network,
    count: 0,
    firstSeen: ts,
    lastSeen: ts,
    selectors: {},
    sources: [],
  });
  contract.count += 1;
  contract.lastSeen = ts;
  contract.name = contractName ?? contract.name;
  if (source && !contract.sources.includes(source)) {
    contract.sources.push(source);
  }
  if (selector) {
    const sel = (contract.selectors[selector] ??= {
      name: KNOWN_SELECTORS[selector] ?? null,
      count: 0,
      firstSeen: ts,
      lastSeen: ts,
    });
    sel.count += 1;
    sel.lastSeen = ts;
  }

  if (ownerHex) {
    const owner = (registry.owners[ownerHex] ??= {
      base58: hex41ToBase58(ownerHex),
      count: 0,
      firstSeen: ts,
      lastSeen: ts,
    });
    owner.count += 1;
    owner.lastSeen = ts;
  }

  saveRegistry(registry);
  logEvent('registry', 'Observation recorded', {
    contract: hex41ToBase58(contractHex),
    contractName: contract.name,
    selector,
    selectorName: selector ? (KNOWN_SELECTORS[selector] ?? 'unknown') : null,
    owner: ownerHex ? hex41ToBase58(ownerHex) : null,
    source,
  });
}

// ---------------------------------------------------------------------------
// TRON helpers
// ---------------------------------------------------------------------------

/** Decode a Solidity Error(string) revert payload from constant_result. */
function decodeRevertReason(constantResult) {
  const hex = constantResult?.[0];
  if (!hex || !hex.startsWith('08c379a0')) {
    return null;
  }
  try {
    const length = Number(BigInt(`0x${hex.slice(8 + 64, 8 + 128)}`));
    return Buffer.from(hex.slice(8 + 128, 8 + 128 + length * 2), 'hex').toString(
      'utf8',
    );
  } catch {
    return null;
  }
}

function extractTriggerSmartContracts(transaction) {
  const contracts = transaction?.raw_data?.contract ?? [];
  return contracts
    .filter((contract) => contract.type === 'TriggerSmartContract')
    .map((contract) => contract.parameter.value);
}

async function getEnergyPriceSun(rpc) {
  try {
    const { chainParameter } = await rpc('/wallet/getchainparameters', null, {
      method: 'GET',
    });
    const price = chainParameter?.find(
      (param) => param.key === 'getEnergyFee',
    )?.value;
    if (price) {
      logEvent('chain-params', `Energy price: ${price} SUN/unit`, { price });
      return price;
    }
  } catch (error) {
    logEvent('chain-params', `Failed to fetch chain params: ${error.message}`);
  }
  logEvent(
    'chain-params',
    `Using fallback energy price: ${FALLBACK_ENERGY_PRICE_SUN} SUN/unit`,
  );
  return FALLBACK_ENERGY_PRICE_SUN;
}

/**
 * Replica of FeeCalculatorService.#calculateEnergySharing — validates ticket
 * item 4 (energy sharing must behave identically for the reference caller).
 *
 * @param {number} totalEnergy - Total energy from simulation.
 * @param {object|null} contractInfo - getcontract response.
 * @param {number|null} deployerAvailableEnergy - Deployer's spare energy.
 * @returns {{userEnergy: number, detail: object}} User-paid energy + detail.
 */
function calculateEnergySharing(
  totalEnergy,
  contractInfo,
  deployerAvailableEnergy,
) {
  if (!contractInfo) {
    return { userEnergy: totalEnergy, detail: { reason: 'no contract info' } };
  }
  const userPercent = contractInfo.consume_user_resource_percent ?? 100;
  const maxDeployerSubsidy = contractInfo.origin_energy_limit ?? 0;
  if (userPercent >= 100 || maxDeployerSubsidy <= 0) {
    return {
      userEnergy: totalEnergy,
      detail: { userPercent, maxDeployerSubsidy, reason: 'user pays all' },
    };
  }
  const userTheoretical = Math.ceil(totalEnergy * (userPercent / 100));
  const deployerTheoretical = totalEnergy - userTheoretical;
  let deployerActual = Math.min(deployerTheoretical, maxDeployerSubsidy);
  deployerActual =
    deployerAvailableEnergy === null
      ? 0
      : Math.min(deployerActual, deployerAvailableEnergy);
  return {
    userEnergy: totalEnergy - deployerActual,
    detail: {
      userPercent,
      maxDeployerSubsidy,
      deployerAvailableEnergy,
      deployerActual,
    },
  };
}

const sunToTrx = (sun) => sun / SUN_IN_TRX;
const energyToTrx = (energy, priceSun) => sunToTrx(energy * priceSun);

/**
 * Rewrite the deadline slot in uniswap-style calldata so captured (expired)
 * swaps can still be re-simulated.
 *
 * @param {string} data - Calldata hex (selector + ABI-encoded args).
 * @param {number} extendSeconds - New deadline horizon from now.
 * @returns {{data: string, change: object|null}} Rewritten data + change info.
 */
function bumpDeadlineInData(data, extendSeconds = 1200) {
  const selector = data.slice(0, 8).toLowerCase();
  const slot = DEADLINE_SLOT[selector];
  if (slot === undefined) {
    return { data, change: { skipped: `unknown deadline slot for ${selector}` } };
  }
  const start = 8 + slot * 64;
  const originalHex = data.slice(start, start + 64);
  if (originalHex.length < 64) {
    return { data, change: { skipped: 'calldata shorter than deadline slot' } };
  }
  const original = BigInt(`0x${originalHex}`);
  // Deadlines are unix seconds on most forks, milliseconds on some.
  const isMillis = original > 100_000_000_000n;
  const nowUnit = isMillis ? BigInt(Date.now()) : BigInt(Math.floor(Date.now() / 1000));
  const bumped = nowUnit + BigInt(extendSeconds) * (isMillis ? 1000n : 1n);
  const bumpedHex = bumped.toString(16).padStart(64, '0');
  return {
    data: data.slice(0, start) + bumpedHex + data.slice(start + 64),
    change: {
      slot,
      original: original.toString(),
      bumped: bumped.toString(),
      unit: isMillis ? 'ms' : 's',
    },
  };
}

/**
 * Clamp amountIn to `maxAmount` (raw units) and amountOutMin to 1 for
 * exact-in uniswap-style calldata, so the simulation fits inside the
 * reference account's token balance. No-op when amountIn <= maxAmount.
 *
 * @param {string} data - Calldata hex.
 * @param {bigint} maxAmount - Max input amount in raw token units.
 * @returns {{data: string, change: object|null}} Rewritten data + change info.
 */
function clampAmountInData(data, maxAmount) {
  const selector = data.slice(0, 8).toLowerCase();
  const slots = EXACT_IN_SLOTS[selector];
  if (!slots) {
    return { data, change: { skipped: `no exact-in slots for ${selector}` } };
  }
  const inStart = 8 + slots.amountIn * 64;
  const amountIn = BigInt(`0x${data.slice(inStart, inStart + 64)}`);
  if (amountIn <= maxAmount) {
    return { data, change: { skipped: `amountIn ${amountIn} <= clamp` } };
  }
  const outStart = 8 + slots.amountOutMin * 64;
  const rewritten =
    data.slice(0, inStart) +
    maxAmount.toString(16).padStart(64, '0') +
    data.slice(inStart + 64, outStart) +
    1n.toString(16).padStart(64, '0') +
    data.slice(outStart + 64);
  return {
    data: rewritten,
    change: {
      amountIn: amountIn.toString(),
      clampedTo: maxAmount.toString(),
      amountOutMin: 'set to 1',
    },
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function fetchTransactionBundle(rpc, txId) {
  const transaction = await rpc('/wallet/gettransactionbyid', { value: txId });
  if (!transaction?.raw_data) {
    throw new Error(`Transaction ${txId} not found`);
  }
  const info = await rpc('/wallet/gettransactioninfobyid', { value: txId });
  return { transaction, info: info?.id ? info : null };
}

function summarizeActual(info) {
  if (!info) {
    return null;
  }
  const receipt = info.receipt ?? {};
  return {
    blockNumber: info.blockNumber ?? null,
    result: receipt.result ?? null,
    energyUsageTotal: receipt.energy_usage_total ?? 0,
    energyUsage: receipt.energy_usage ?? 0, // paid from staked energy
    energyFeeSun: receipt.energy_fee ?? 0, // paid in TRX
    originEnergyUsage: receipt.origin_energy_usage ?? 0, // deployer subsidy
    netUsage: receipt.net_usage ?? 0,
    netFeeSun: receipt.net_fee ?? 0,
    totalFeeSun: info.fee ?? 0,
  };
}

/**
 * capture <txid> — fetch a confirmed tx, store it, and feed the registry.
 * Run this against every real swap you make while testing the extension:
 * the registry accumulates the router addresses + selectors for Phase 0.
 */
async function cmdCapture(rpc, network, txId) {
  section(`CAPTURE ${txId}`);
  const { transaction, info } = await fetchTransactionBundle(rpc, txId);
  const triggers = extractTriggerSmartContracts(transaction);
  const actual = summarizeActual(info);

  logEvent('capture', `Fetched transaction ${txId}`, {
    contractTypes: (transaction.raw_data.contract ?? []).map(
      (contract) => contract.type,
    ),
    feeLimitSun: transaction.raw_data.fee_limit ?? null,
    confirmed: Boolean(info),
    actual,
  });

  for (const value of triggers) {
    const contractHex = toHex41(value.contract_address);
    const ownerHex = toHex41(value.owner_address);
    const selector = value.data?.slice(0, 8)?.toLowerCase() ?? null;

    let contractName = null;
    try {
      const contractInfo = await rpc('/wallet/getcontract', {
        value: contractHex,
        visible: false,
      });
      contractName = contractInfo?.name ?? null;
    } catch {
      // name is best-effort
    }

    logEvent('capture-contract', 'TriggerSmartContract details', {
      contract: hex41ToBase58(contractHex),
      contractHex,
      contractName,
      owner: hex41ToBase58(ownerHex),
      ownerHex,
      selector,
      selectorName: selector ? (KNOWN_SELECTORS[selector] ?? 'unknown') : null,
      callValue: value.call_value ?? 0,
      dataLength: value.data?.length ?? 0,
      data: value.data,
    });

    recordObservation({
      contractHex,
      selector,
      ownerHex,
      contractName,
      source: txId,
      network,
    });
  }

  const capturePath = path.join(CAPTURES_DIR, `${txId}.json`);
  ensureDataDirs();
  writeFileSync(
    capturePath,
    `${JSON.stringify({ capturedAt: nowIso(), network, txId, transaction, info }, null, 2)}\n`,
  );
  logEvent('capture', `Saved capture to ${path.relative(SCRIPT_DIR, capturePath)}`);

  if (!triggers.length) {
    console.warn('⚠️  No TriggerSmartContract in this transaction.');
  }
  return capturePath;
}

/**
 * Build the simulation variants for one TriggerSmartContract value.
 *
 * @param {object} value - Original contract.parameter.value.
 * @param {object} options - Variant options.
 * @param {string|null} options.refHex - Reference owner (41-hex).
 * @param {boolean} options.rewriteData - Also rewrite owner inside `data`.
 * @param {Array<{find: string, replace: string}>} options.replacements - Custom hex replacements.
 * @returns {Array<{name: string, request: object, note: string, replacements: object[]}>} Variants.
 */
function buildVariants(
  value,
  { refHex, rewriteData, replacements, bumpDeadline, clampAmount },
) {
  const base = {
    owner_address: toHex41(value.owner_address),
    contract_address: toHex41(value.contract_address),
    data: value.data,
    ...(value.call_value ? { call_value: value.call_value } : {}),
    ...(value.token_id ? { token_id: value.token_id } : {}),
    ...(value.call_token_id ? { call_token_id: value.call_token_id } : {}),
    ...(value.call_token_value
      ? { call_token_value: value.call_token_value }
      : {}),
  };

  const variants = [
    {
      name: 'A:baseline',
      request: base,
      note: 'owner as captured (expected FAILED pre-approve)',
      replacements: [],
    },
  ];

  if (!refHex) {
    return variants;
  }

  // Reference variants get a fresh deadline so expired captures still simulate
  let refData = base.data.toLowerCase();
  let deadlineChange = null;
  if (bumpDeadline) {
    ({ data: refData, change: deadlineChange } = bumpDeadlineInData(refData));
    logEvent('bump-deadline', 'Deadline rewrite for reference variants', {
      ...deadlineChange,
    });
  }
  if (clampAmount) {
    const { data, change } = clampAmountInData(refData, BigInt(clampAmount));
    refData = data;
    logEvent('clamp-amount', 'Amount clamp for reference variants', {
      ...change,
    });
    if (change && !change.skipped) {
      deadlineChange = deadlineChange
        ? { ...deadlineChange, clamp: change }
        : { clamp: change };
    }
  }

  variants.push({
    name: 'B:reference-owner',
    request: { ...base, owner_address: refHex, data: refData },
    note: 'owner_address rewritten to reference account',
    replacements: deadlineChange ? [{ deadline: deadlineChange }] : [],
  });

  // C: rewrite user address occurrences inside data (recipient/path slots)
  let rewrittenData = refData;
  const ownerRewrites = [];
  if (rewriteData) {
    const ownerHex20 = toEvmHex20(base.owner_address);
    const refHex20 = toEvmHex20(refHex);
    for (const [find, replace] of [
      [pad32(ownerHex20), pad32(refHex20)], // ABI-encoded address argument
      [ownerHex20, refHex20], // packed occurrence (e.g. in a path)
    ]) {
      const occurrences = rewrittenData.split(find).length - 1;
      if (occurrences > 0) {
        rewrittenData = rewrittenData.replaceAll(find, replace);
        ownerRewrites.push({ find, replace, occurrences });
      }
    }
    variants.push({
      name: 'C:data-rewrite',
      request: { ...base, owner_address: refHex, data: rewrittenData },
      note: `owner + ${ownerRewrites.reduce((sum, r) => sum + r.occurrences, 0)} occurrence(s) of user address in data rewritten`,
      replacements: deadlineChange
        ? [{ deadline: deadlineChange }, ...ownerRewrites]
        : ownerRewrites,
    });
  }

  // D: custom substitutions, composed on top of C's data when --rewrite-data
  if (replacements.length) {
    const applied = deadlineChange ? [{ deadline: deadlineChange }] : [];
    applied.push(...ownerRewrites);
    let data = rewrittenData;
    for (const { find, replace } of replacements) {
      const occurrences = data.split(find.toLowerCase()).length - 1;
      data = data.replaceAll(find.toLowerCase(), replace.toLowerCase());
      applied.push({ find, replace, occurrences });
    }
    variants.push({
      name: 'D:custom-replace',
      request: { ...base, owner_address: refHex, data },
      note: 'reference owner + data-rewrite + custom --replace substitutions',
      replacements: applied,
    });
  }

  return variants;
}

/**
 * simulate <txid|file> — the core Phase 1 experiment.
 */
async function cmdSimulate(rpc, network, source, options) {
  section(`SIMULATE ${source}`);
  const refHex = options.ref ? toHex41(options.ref) : null;
  if (!refHex) {
    console.warn(
      '⚠️  No reference address (--ref or REFERENCE_ADDRESS): only the baseline variant will run.',
    );
  }

  // Resolve source: on-chain txid or a JSON file (capture / unsigned tx / raw value)
  let transaction;
  let info = null;
  let sourceDescriptor;
  if (/^[0-9a-fA-F]{64}$/u.test(source)) {
    ({ transaction, info } = await fetchTransactionBundle(rpc, source));
    sourceDescriptor = { type: 'txid', id: source };
  } else {
    const parsed = JSON.parse(readFileSync(source, 'utf8'));
    transaction = parsed.transaction ?? parsed;
    info = parsed.info ?? null;
    if (!transaction.raw_data && transaction.contract_address) {
      // Bare contract.parameter.value shape (e.g. copied from snap logs)
      transaction = {
        raw_data: {
          contract: [
            { type: 'TriggerSmartContract', parameter: { value: transaction } },
          ],
        },
      };
    }
    sourceDescriptor = { type: 'file', id: path.basename(source) };
  }

  const triggers = extractTriggerSmartContracts(transaction);
  if (!triggers.length) {
    throw new Error('No TriggerSmartContract found in source');
  }

  const energyPriceSun = await getEnergyPriceSun(rpc);
  const feeLimitSun = transaction.raw_data?.fee_limit ?? FEE_LIMIT_SUN;
  const fallbackEnergy = Math.floor(feeLimitSun / energyPriceSun);
  const actual = summarizeActual(info);

  for (const [index, value] of triggers.entries()) {
    const contractHex = toHex41(value.contract_address);
    const ownerHex = toHex41(value.owner_address);
    const selector = value.data?.slice(0, 8)?.toLowerCase() ?? null;

    section(
      `Contract ${index + 1}/${triggers.length}: ${hex41ToBase58(contractHex)} ` +
        `selector=${selector} (${selector ? (KNOWN_SELECTORS[selector] ?? 'unknown') : 'n/a'})`,
    );

    // Contract info + deployer energy — for the energy-sharing check (ticket item 4)
    let contractInfo = null;
    let deployerAvailableEnergy = null;
    try {
      contractInfo = await rpc('/wallet/getcontract', {
        value: contractHex,
        visible: false,
      });
      if (contractInfo?.origin_address) {
        const resources = await rpc('/wallet/getaccountresource', {
          address: hex41ToBase58(toHex41(contractInfo.origin_address)),
          visible: true,
        });
        deployerAvailableEnergy = Math.max(
          0,
          (resources.EnergyLimit ?? 0) - (resources.EnergyUsed ?? 0),
        );
      }
    } catch (error) {
      logEvent('contract-info', `getcontract failed: ${error.message}`);
    }

    const variants = buildVariants(value, {
      refHex,
      rewriteData: options.rewriteData,
      replacements: options.replacements,
      bumpDeadline: options.bumpDeadline,
      clampAmount: options.clampAmount,
    });

    const variantResults = [];
    for (const variant of variants) {
      logEvent('variant-start', `Running ${variant.name}`, {
        note: variant.note,
        owner: hex41ToBase58(variant.request.owner_address),
        replacements: variant.replacements,
      });
      let result;
      try {
        const response = await rpc(
          '/wallet/triggerconstantcontract',
          variant.request,
        );
        const ret = response.transaction?.ret?.[0]?.ret ?? 'SUCCESS';
        const success = response.result?.result === true && ret !== 'FAILED';
        const energyUsed = response.energy_used ?? null;
        const sharing =
          energyUsed === null
            ? null
            : calculateEnergySharing(
                energyUsed,
                contractInfo,
                deployerAvailableEnergy,
              );
        result = {
          name: variant.name,
          note: variant.note,
          owner: hex41ToBase58(variant.request.owner_address),
          replacements: variant.replacements,
          success,
          ret,
          energyUsed,
          energyPenalty: response.energy_penalty ?? 0,
          userEnergy: sharing?.userEnergy ?? null,
          energySharing: sharing?.detail ?? null,
          estimatedFeeTrx:
            sharing === null
              ? null
              : Number(energyToTrx(sharing.userEnergy, energyPriceSun).toFixed(6)),
          revertReason: decodeRevertReason(response.constant_result),
          rpcMessage: response.result?.message
            ? Buffer.from(response.result.message, 'hex').toString('utf8')
            : null,
        };
      } catch (error) {
        result = {
          name: variant.name,
          note: variant.note,
          owner: hex41ToBase58(variant.request.owner_address),
          replacements: variant.replacements,
          success: false,
          error: error.message,
        };
      }
      variantResults.push(result);
      logEvent(
        'variant-result',
        `${result.name}: ${result.success ? '✅ SUCCESS' : `❌ ${result.ret ?? result.error}`}` +
          (result.energyUsed !== null && result.energyUsed !== undefined
            ? ` energy_used=${result.energyUsed} penalty=${result.energyPenalty} userEnergy=${result.userEnergy} fee≈${result.estimatedFeeTrx} TRX`
            : ''),
        result,
      );
    }

    // ---- Comparison table -------------------------------------------------
    section('COMPARISON');
    const rows = variantResults.map((res) => ({
      variant: res.name,
      status: res.success ? 'SUCCESS' : (res.ret ?? 'ERROR'),
      energy_used: res.energyUsed ?? '-',
      penalty: res.energyPenalty ?? '-',
      user_energy: res.userEnergy ?? '-',
      'fee (TRX)': res.estimatedFeeTrx ?? '-',
      note: res.revertReason ?? res.rpcMessage ?? res.error ?? '',
    }));
    rows.push({
      variant: 'fallback (current prod)',
      status: 'n/a',
      energy_used: fallbackEnergy,
      penalty: '-',
      user_energy: fallbackEnergy,
      'fee (TRX)': Number(energyToTrx(fallbackEnergy, energyPriceSun).toFixed(6)),
      note: `fee_limit ${sunToTrx(feeLimitSun)} TRX / ${energyPriceSun} SUN`,
    });
    if (actual) {
      rows.push({
        variant: 'actual (on-chain)',
        status: actual.result ?? 'n/a',
        energy_used: actual.energyUsageTotal,
        penalty: '-',
        user_energy: actual.energyUsageTotal - actual.originEnergyUsage,
        'fee (TRX)': sunToTrx(actual.totalFeeSun),
        note: `energy_fee=${sunToTrx(actual.energyFeeSun)} TRX, staked energy used=${actual.energyUsage}`,
      });
    }
    console.table(rows);

    const reference = variantResults.find((res) =>
      res.name.startsWith('B:'),
    );
    if (actual && reference?.energyUsed) {
      const deltaPct =
        ((reference.energyUsed - actual.energyUsageTotal) /
          actual.energyUsageTotal) *
        100;
      logEvent(
        'accuracy',
        `Reference estimate vs actual: ${deltaPct.toFixed(2)}% ` +
          `(${reference.energyUsed} vs ${actual.energyUsageTotal} energy)`,
        { deltaPct, referenceEnergy: reference.energyUsed, actual },
      );
    }

    recordObservation({
      contractHex,
      selector,
      ownerHex,
      contractName: contractInfo?.name ?? null,
      source: sourceDescriptor.id,
      network,
    });

    appendJsonl(RUNS_FILE, {
      ts: nowIso(),
      network,
      source: sourceDescriptor,
      label: options.label ?? null,
      contract: {
        hex: contractHex,
        base58: hex41ToBase58(contractHex),
        name: contractInfo?.name ?? null,
      },
      selector,
      selectorName: selector ? (KNOWN_SELECTORS[selector] ?? null) : null,
      originalOwner: hex41ToBase58(ownerHex),
      referenceOwner: refHex ? hex41ToBase58(refHex) : null,
      feeLimitSun,
      energyPriceSun,
      contractInfo: contractInfo
        ? {
            name: contractInfo.name ?? null,
            consumeUserResourcePercent:
              contractInfo.consume_user_resource_percent ?? null,
            originEnergyLimit: contractInfo.origin_energy_limit ?? null,
            originAddress: contractInfo.origin_address
              ? hex41ToBase58(toHex41(contractInfo.origin_address))
              : null,
          }
        : null,
      deployerAvailableEnergy,
      variants: variantResults,
      fallback: {
        energy: fallbackEnergy,
        feeTrx: Number(energyToTrx(fallbackEnergy, energyPriceSun).toFixed(6)),
      },
      actual,
    });
    logEvent('run-saved', `Run appended to ${path.relative(SCRIPT_DIR, RUNS_FILE)}`);
  }
}

/**
 * check-ref <address> — Phase 0 provisioning verification.
 */
async function cmdCheckRef(rpc, network, address, options) {
  section(`CHECK-REF ${toBase58(address)}`);
  const refHex = toHex41(address);
  const refBase58 = hex41ToBase58(refHex);
  const tokenHex = toHex41(options.token ?? USDT_MAINNET);

  const account = await rpc('/wallet/getaccount', {
    address: refBase58,
    visible: true,
  });
  const activated = Boolean(account && Object.keys(account).length);
  const balanceTrx = sunToTrx(account?.balance ?? 0);

  const resources = await rpc('/wallet/getaccountresource', {
    address: refBase58,
    visible: true,
  });

  const readConstant = async (contractHex, data) => {
    const response = await rpc('/wallet/triggerconstantcontract', {
      owner_address: refHex,
      contract_address: contractHex,
      data,
    });
    const hex = response.constant_result?.[0];
    return hex ? BigInt(`0x${hex}`) : null;
  };

  const decimals = Number((await readConstant(tokenHex, '313ce567')) ?? 6n);
  const balanceRaw = await readConstant(
    tokenHex,
    `70a08231${pad32(toEvmHex20(refHex))}`,
  );
  const tokenBalance =
    balanceRaw === null ? null : Number(balanceRaw) / 10 ** decimals;

  const allowances = [];
  for (const router of options.routers) {
    const routerHex = toHex41(router);
    const raw = await readConstant(
      tokenHex,
      `dd62ed3e${pad32(toEvmHex20(refHex))}${pad32(toEvmHex20(routerHex))}`,
    );
    allowances.push({
      router: hex41ToBase58(routerHex),
      allowanceRaw: raw?.toString() ?? null,
      allowance: raw === null ? null : Number(raw) / 10 ** decimals,
      unlimited: raw !== null && raw > 2n ** 128n,
    });
  }

  const summary = {
    address: refBase58,
    addressHex: refHex,
    network,
    activated,
    balanceTrx,
    energy: {
      limit: resources.EnergyLimit ?? 0,
      used: resources.EnergyUsed ?? 0,
    },
    bandwidth: {
      free: (resources.freeNetLimit ?? 0) - (resources.freeNetUsed ?? 0),
      staked: (resources.NetLimit ?? 0) - (resources.NetUsed ?? 0),
    },
    token: {
      address: hex41ToBase58(tokenHex),
      decimals,
      balance: tokenBalance,
    },
    allowances,
  };
  logEvent('check-ref', 'Reference account status', summary);
  console.table(
    allowances.length
      ? allowances
      : [{ router: '(none — pass --router)', allowance: '-' }],
  );
  console.log(JSON.stringify(summary, null, 2));

  if (!activated) {
    console.warn('⚠️  Account not activated — send TRX to it first.');
  }
  if (tokenBalance === 0) {
    console.warn('⚠️  Token balance is 0 — simulations with amount > 0 will FAIL.');
  }
  for (const entry of allowances) {
    if (!entry.allowance) {
      console.warn(`⚠️  No allowance for router ${entry.router} — approve it.`);
    }
  }
}

/** registry — print the aggregated Phase 0 dataset. */
function cmdRegistry() {
  const registry = loadRegistry();
  section('REGISTRY — contracts observed across all runs');
  const rows = Object.entries(registry.contracts).map(([hex, entry]) => ({
    contract: entry.base58,
    name: entry.name ?? '?',
    network: entry.network,
    seen: entry.count,
    selectors: Object.entries(entry.selectors)
      .map(
        ([sel, meta]) =>
          `${sel}${meta.name ? ` (${meta.name.split('(')[0]})` : ''} x${meta.count}`,
      )
      .join(', '),
    lastSeen: entry.lastSeen,
    hex,
  }));
  if (!rows.length) {
    console.log('Registry is empty — run `capture` or `simulate` first.');
    return;
  }
  console.table(rows);
  section('Owners observed');
  console.table(
    Object.values(registry.owners).map(({ base58, count, lastSeen }) => ({
      owner: base58,
      seen: count,
      lastSeen,
    })),
  );
  console.log(`Full registry: ${REGISTRY_FILE}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const positional = [];
  const options = {
    network: 'mainnet',
    ref: process.env.REFERENCE_ADDRESS ?? null,
    rewriteData: false,
    bumpDeadline: false,
    clampAmount: null,
    replacements: [],
    routers: [],
    token: null,
    label: null,
  };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    switch (arg) {
      case '--network':
        options.network = rest[++i];
        break;
      case '--ref':
        options.ref = rest[++i];
        break;
      case '--rewrite-data':
        options.rewriteData = true;
        break;
      case '--bump-deadline':
        options.bumpDeadline = true;
        break;
      case '--clamp-amount':
        options.clampAmount = rest[++i];
        break;
      case '--replace': {
        const [find, replace] = rest[++i].split(':');
        options.replacements.push({ find, replace });
        break;
      }
      case '--router':
        options.routers.push(rest[++i]);
        break;
      case '--token':
        options.token = rest[++i];
        break;
      case '--label':
        options.label = rest[++i];
        break;
      default:
        positional.push(arg);
    }
  }
  return { command, positional, options };
}

const USAGE = `WPN-1527 spike — TRC-20 swap fee estimation via a reference account

Commands:
  capture <txid>                 Fetch a confirmed tx, store it in data/captures/,
                                 and record its router/selector in the registry.
  simulate <txid|file.json>      Run triggerconstantcontract variants and compare
                                 against the fallback and the actual on-chain cost.
    --ref <address>              Reference account (or REFERENCE_ADDRESS env)
    --rewrite-data               Also rewrite user address occurrences inside data
    --bump-deadline              Rewrite the expired deadline slot in swap calldata
    --clamp-amount <raw>         Clamp amountIn to <raw> units (amountOutMin -> 1)
    --replace <find>:<replace>   Extra hex substitution in data (repeatable)
    --label <note>               Free-text label stored with the run
  check-ref <address>            Verify reference account provisioning (Phase 0).
    --token <address>            Token to check (default: USDT mainnet)
    --router <address>           Router to check allowance for (repeatable)
  registry                       Print contracts/selectors seen across all runs.

Common:  --network mainnet|nile|shasta   (default: mainnet)

Data files (append-only, safe to run many times):
  data/runs.jsonl      one record per simulate run (all variants + comparison)
  data/events.jsonl    every RPC request/response, timestamped
  data/registry.json   aggregated contracts/selectors/owners across runs
  data/captures/       full transaction snapshots by txid
`;

async function main() {
  loadDotEnv();
  const { command, positional, options } = parseArgs(process.argv.slice(2));

  if (command === 'registry') {
    cmdRegistry();
    return;
  }
  if (!command || !positional[0]) {
    console.log(USAGE);
    process.exitCode = command ? 1 : 0;
    return;
  }

  const rpc = makeClient(options.network);
  switch (command) {
    case 'capture':
      await cmdCapture(rpc, options.network, positional[0]);
      break;
    case 'simulate':
      await cmdSimulate(rpc, options.network, positional[0], options);
      break;
    case 'check-ref':
      await cmdCheckRef(rpc, options.network, positional[0], options);
      break;
    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  process.exitCode = 1;
});
