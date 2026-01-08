/* eslint-disable no-restricted-globals */
/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Fee Calculator Service Test Script
 *
 * Run with: npx tsx test.ts
 *
 * Tests the ACTUAL FeeCalculatorService with swap quotes from MetaMask Bridge API.
 * Compares fee estimates between HIGH ENERGY and LOW ENERGY wallets for the same trade paths.
 */

import { BigNumber } from 'bignumber.js';
import type { Transaction } from 'tronweb/lib/esm/types';

// Import actual implementations from the codebase
import { FeeCalculatorService } from './packages/snap/src/services/send/FeeCalculatorService.ts';
import { Network, SUN_IN_TRX } from './packages/snap/src/constants/index.ts';
import type { ILogger } from './packages/snap/src/utils/logger.ts';
import type { TrongridApiClient } from './packages/snap/src/clients/trongrid/TrongridApiClient.ts';
import type {
  ChainParameter,
  TriggerConstantContractRequest,
  TriggerConstantContractResponse,
  TronAccount,
} from './packages/snap/src/clients/trongrid/types.ts';

// ============================================================================
// Configuration
// ============================================================================

const TRX_PRICE_USD = 0.30;
const EXPECTED_FEE_USD = 20.0;

const TRONGRID_URLS = {
  [Network.Mainnet]: 'https://api.trongrid.io',
  [Network.Nile]: 'https://nile.trongrid.io',
  [Network.Shasta]: 'https://api.shasta.trongrid.io',
} as Record<Network, string>;

// ============================================================================
// Test Wallets
// ============================================================================

type WalletConfig = {
  address: string;
  label: string;
  icon: string;
};

const WALLETS: Record<string, WalletConfig> = {
  HIGH_ENERGY: {
    address: 'TVhT3xzcQB1yiYkddx5tzj8qaRm5sLLPqi',
    label: 'HIGH ENERGY',
    icon: '⚡',
  },
  LOW_ENERGY: {
    address: 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx',
    label: 'LOW ENERGY',
    icon: '🔋',
  },
};

// ============================================================================
// Token Addresses
// ============================================================================

const TOKENS = {
  TRX: '0x0000000000000000000000000000000000000000',
  USDT: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
} as const;

const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

// ============================================================================
// Swap Directions (Trade Paths)
// ============================================================================

type SwapDirection = {
  name: string;
  srcTokenAddress: string;
  destTokenAddress: string;
  srcTokenAmount: string;
  srcSymbol: string;
  srcDecimals: number;
};

const SWAP_DIRECTIONS: SwapDirection[] = [
  {
    name: 'USDT → TRX',
    srcTokenAddress: TOKENS.USDT,
    destTokenAddress: TOKENS.TRX,
    srcTokenAmount: '10000000', // 10 USDT
    srcSymbol: 'USDT',
    srcDecimals: 6,
  },
  {
    name: 'TRX → USDT',
    srcTokenAddress: TOKENS.TRX,
    destTokenAddress: TOKENS.USDT,
    srcTokenAmount: '10000000', // 10 TRX
    srcSymbol: 'TRX',
    srcDecimals: 6,
  },
];

// ============================================================================
// Capturing Logger
// ============================================================================

type LogEntry = {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  args: any[];
};

class CapturingLogger implements ILogger {
  logs: LogEntry[] = [];

  clear() {
    this.logs = [];
  }

  log(...args: any[]) {
    this.logs.push({ level: 'log', args });
  }

  info(...args: any[]) {
    this.logs.push({ level: 'info', args });
  }

  warn(...args: any[]) {
    this.logs.push({ level: 'warn', args });
  }

  error(...args: any[]) {
    this.logs.push({ level: 'error', args });
  }

  debug(...args: any[]) {
    this.logs.push({ level: 'debug', args });
  }

  summarize(): string {
    const summary: string[] = [];
    let contractType = '';
    let energyEstimate = 0;
    let usedFallback = false;
    let fallbackReason = '';

    for (const entry of this.logs) {
      const message = entry.args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');

      if (message.includes('Calculating energy for contract type:')) {
        const match = message.match(/contract type: (\w+)/);
        if (match) {
          contractType = match[1] || '';
        }
      }

      if (message.includes('using fallback') || message.includes('fallback')) {
        usedFallback = true;
        if (message.includes('Failed to estimate')) {
          fallbackReason = 'sim failed';
        }
      }

      if (message.includes('Calculated fallback energy from fee limit')) {
        const energyMatch = message.match(/"maxEnergyFromFeeLimit":(\d+)/);
        if (energyMatch) {
          energyEstimate = parseInt(energyMatch[1] || '0', 10);
        }
      }

      if (message.includes('Energy estimate for') && message.includes('units')) {
        const match = message.match(/"energyUsed":(\d+)/);
        if (match) {
          energyEstimate = parseInt(match[1] || '0', 10);
          usedFallback = false; // Simulation succeeded
        }
      }
    }

    if (contractType) {
      summary.push(contractType);
    }
    if (usedFallback) {
      summary.push(`FALLBACK (${fallbackReason})`);
    } else {
      summary.push('simulation OK');
    }
    if (energyEstimate > 0) {
      summary.push(`${energyEstimate.toLocaleString()} energy`);
    }

    return summary.join(', ') || 'no data';
  }
}

// ============================================================================
// Account Info Types
// ============================================================================

type AccountResources = {
  availableEnergy: BigNumber;
  availableBandwidth: BigNumber;
};

type AccountBalances = {
  trxBalance: number;
  usdtBalance: number;
};

type WalletInfo = {
  config: WalletConfig;
  resources: AccountResources;
  balances: AccountBalances;
};

// ============================================================================
// TrongridApiClient
// ============================================================================

class CachedTrongridApiClient implements Pick<TrongridApiClient, 'getAccountInfoByAddress' | 'getChainParameters' | 'triggerConstantContract'> {
  #chainParametersCache: Map<Network, ChainParameter[]>;

  private constructor(chainParametersCache: Map<Network, ChainParameter[]>) {
    this.#chainParametersCache = chainParametersCache;
  }

  static async create(): Promise<CachedTrongridApiClient> {
    const baseUrl = TRONGRID_URLS[Network.Mainnet];
    const response = await fetch(`${baseUrl}/wallet/getchainparameters`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch chain parameters: ${response.status}`);
    }
    const data: any = await response.json();
    const cache = new Map<Network, ChainParameter[]>();
    cache.set(Network.Mainnet, data.chainParameter || []);
    return new CachedTrongridApiClient(cache);
  }

  static async fetchAccountResources(walletAddress: string): Promise<AccountResources> {
    const baseUrl = TRONGRID_URLS[Network.Mainnet];
    const response = await fetch(`${baseUrl}/wallet/getaccountresource`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: walletAddress, visible: true }),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch account resources: ${response.status}`);
    }
    const data: any = await response.json();
    return {
      availableEnergy: BigNumber(Math.max(0, (data.EnergyLimit || 0) - (data.EnergyUsed || 0))),
      availableBandwidth: BigNumber((data.freeNetLimit || 0) - (data.freeNetUsed || 0) + (data.NetLimit || 0)),
    };
  }

  static async fetchAccountBalances(walletAddress: string): Promise<AccountBalances> {
    const baseUrl = TRONGRID_URLS[Network.Mainnet];
    const response = await fetch(`${baseUrl}/v1/accounts/${walletAddress}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    
    let trxBalance = 0;
    let usdtBalance = 0;
    
    if (response.ok) {
      const data: any = await response.json();
      if (data.success && data.data?.[0]) {
        const account = data.data[0];
        trxBalance = (account.balance || 0) / SUN_IN_TRX;
        const trc20 = account.trc20 || [];
        for (const token of trc20) {
          if (token[USDT_CONTRACT]) {
            usdtBalance = parseInt(token[USDT_CONTRACT], 10) / 1_000_000;
            break;
          }
        }
      }
    }
    return { trxBalance, usdtBalance };
  }

  async getAccountInfoByAddress(scope: Network, address: string): Promise<TronAccount> {
    const baseUrl = TRONGRID_URLS[scope];
    const response = await fetch(`${baseUrl}/v1/accounts/${address}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data: any = await response.json();
    if (!data.success || !data.data?.length) throw new Error('Account not found');
    return data.data[0];
  }

  async getChainParameters(scope: Network): Promise<ChainParameter[]> {
    const cached = this.#chainParametersCache.get(scope);
    if (cached) return cached;
    throw new Error(`Chain parameters not cached for network: ${scope}`);
  }

  async triggerConstantContract(scope: Network, request: TriggerConstantContractRequest): Promise<TriggerConstantContractResponse> {
    const baseUrl = TRONGRID_URLS[scope];
    const body = Object.fromEntries(Object.entries(request).filter(([, v]) => v !== undefined && v !== null));
    const response = await fetch(`${baseUrl}/wallet/triggerconstantcontract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json() as Promise<TriggerConstantContractResponse>;
  }
}

// ============================================================================
// Bridge API Quote Fetcher
// ============================================================================

type SwapQuote = {
  quote: {
    bridgeId: string;
    srcAsset: { symbol: string };
    destAsset: { symbol: string };
    srcTokenAmount: string;
    destTokenAmount: string;
  };
  trade: Transaction & { visible: boolean; txID: string };
};

async function fetchSwapQuotes(walletAddress: string, swap: SwapDirection): Promise<SwapQuote[]> {
  const params = new URLSearchParams({
    walletAddress,
    destWalletAddress: walletAddress,
    srcChainId: '728126428',
    destChainId: '728126428',
    srcTokenAddress: swap.srcTokenAddress,
    destTokenAddress: swap.destTokenAddress,
    srcTokenAmount: swap.srcTokenAmount,
    insufficientBal: 'true',
    resetApproval: 'false',
    gasIncluded: 'false',
    gasIncluded7702: 'false',
    slippage: '2',
  });

  const response = await fetch(`https://bridge.dev-api.cx.metamask.io/getQuoteStream?${params}`, {
    headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
  });

  if (!response.ok) throw new Error(`Failed to fetch quotes: ${response.status}`);

  const text = await response.text();
  const quotes: SwapQuote[] = [];

  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.quote && data.trade) quotes.push(data);
      } catch { /* skip */ }
    }
  }
  return quotes;
}

// ============================================================================
// Helpers
// ============================================================================

function extractTrxFee(fees: { asset: { unit: string; amount: string } }[]): number {
  for (const fee of fees) {
    if (fee.asset.unit === 'TRX') return parseFloat(fee.asset.amount);
  }
  return 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  Fee Calculator Service - Energy Impact Analysis                                                                      ║');
  console.log(`║  TRX Price: $${TRX_PRICE_USD.toFixed(2)} USD │ Expected Fee: $${EXPECTED_FEE_USD.toFixed(2)}                                                                        ║`);
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  // Initialize
  const trongridApiClient = await CachedTrongridApiClient.create();
  const capturingLogger = new CapturingLogger();
  const feeCalculator = new FeeCalculatorService({
    logger: capturingLogger,
    trongridApiClient: trongridApiClient as unknown as TrongridApiClient,
  });

  // Pre-fetch wallet info for all wallets
  const walletInfos: Record<string, WalletInfo> = {};
  for (const [key, config] of Object.entries(WALLETS)) {
    const resources = await CachedTrongridApiClient.fetchAccountResources(config.address);
    const balances = await CachedTrongridApiClient.fetchAccountBalances(config.address);
    walletInfos[key] = { config, resources, balances };
  }

  // Show wallet summary
  console.log('📊 WALLET SUMMARY');
  console.log('─'.repeat(90));
  console.log(`  ${'Wallet'.padEnd(15)} │ ${'Address'.padEnd(36)} │ ${'Energy'.padEnd(10)} │ ${'Bandwidth'.padEnd(10)} │ TRX │ USDT`);
  console.log('─'.repeat(90));
  for (const [key, info] of Object.entries(walletInfos)) {
    const shortAddr = `${info.config.address.slice(0, 8)}...${info.config.address.slice(-6)}`;
    console.log(`  ${info.config.icon} ${key.padEnd(12)} │ ${shortAddr.padEnd(36)} │ ${info.resources.availableEnergy.toString().padEnd(10)} │ ${info.resources.availableBandwidth.toString().padEnd(10)} │ ${info.balances.trxBalance.toFixed(1).padEnd(3)} │ ${info.balances.usdtBalance.toFixed(1)}`);
  }
  console.log('─'.repeat(90));

  // Process each swap direction
  for (const swapDir of SWAP_DIRECTIONS) {
    console.log(`\n${'═'.repeat(120)}`);
    console.log(`  🔄 TRADE PATH: ${swapDir.name}`);
    console.log('═'.repeat(120));

    // Table header
    console.log('─'.repeat(120));
    console.log(`  ${'Wallet'.padEnd(14)} │ ${'Provider'.padEnd(10)} │ ${'Amount'.padEnd(16)} │ ${'Funds'.padEnd(6)} │ ${'feeLimit'.padEnd(12)} │ ${'Estimated'.padEnd(12)} │ Logic Summary`);
    console.log('─'.repeat(120));

    for (const [walletKey, walletInfo] of Object.entries(walletInfos)) {
      await sleep(300);
      const quotes = await fetchSwapQuotes(walletInfo.config.address, swapDir);

      const requiredAmount = parseInt(swapDir.srcTokenAmount, 10) / (10 ** swapDir.srcDecimals);
      const hasFunds = swapDir.srcSymbol === 'TRX'
        ? walletInfo.balances.trxBalance >= requiredAmount
        : walletInfo.balances.usdtBalance >= requiredAmount;
      const fundsIcon = hasFunds ? '✅' : '❌';

      const walletLabel = `${walletInfo.config.icon} ${walletKey}`;

      if (quotes.length === 0) {
        console.log(`  ${walletLabel.padEnd(14)} │ ${'(none)'.padEnd(10)} │ ${'-'.padEnd(16)} │ ${fundsIcon.padEnd(6)} │ ${'-'.padEnd(12)} │ ${'-'.padEnd(12)} │ no quotes`);
        continue;
      }

      for (const quote of quotes) {
        const feeLimit = (quote.trade.raw_data as any)?.fee_limit;
        const feeLimitTrx = feeLimit ? (feeLimit / SUN_IN_TRX).toFixed(1) : 'N/A';

        capturingLogger.clear();

        const fees = await feeCalculator.computeFee({
          scope: Network.Mainnet,
          transaction: quote.trade as Transaction,
          availableEnergy: walletInfo.resources.availableEnergy,
          availableBandwidth: walletInfo.resources.availableBandwidth,
          feeLimit,
        });

        const logicSummary = capturingLogger.summarize();
        const estimatedTrx = extractTrxFee(fees);
        const estimatedUsd = (estimatedTrx * TRX_PRICE_USD).toFixed(2);

        const srcAmt = (parseInt(quote.quote.srcTokenAmount, 10) / 1_000_000).toFixed(1);
        const destAmt = (parseInt(quote.quote.destTokenAmount, 10) / 1_000_000).toFixed(1);
        const amountStr = `${srcAmt} → ${destAmt}`;

        console.log(`  ${walletLabel.padEnd(14)} │ ${quote.quote.bridgeId.padEnd(10)} │ ${amountStr.padEnd(16)} │ ${fundsIcon.padEnd(6)} │ ${(feeLimitTrx + ' TRX').padEnd(12)} │ $${estimatedUsd.padEnd(11)} │ ${logicSummary}`);
      }
    }

    console.log('─'.repeat(120));
    console.log(`  📝 Expected: $${EXPECTED_FEE_USD.toFixed(2)} per transaction`);
  }

  console.log(`\n${'═'.repeat(120)}`);
  console.log('✅ Done\n');
}

main().catch(console.error);
