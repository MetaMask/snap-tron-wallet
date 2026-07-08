#!/usr/bin/env node
 
/**
 * WPN-1527 — renew the reference account's Permit2 allowance so the
 * reference-owner fee simulation keeps working (current one expires
 * ~2026-07-11).
 *
 * Sends, from the reference account:
 *   Permit2.approve(USDT, UniversalRouter, MAX_UINT160, MAX_UINT48)
 *
 * The private key never leaves this machine; it is read from the
 * REF_PRIVATE_KEY environment variable and used only to sign locally.
 *
 * Usage (from packages/snap):
 *   REF_PRIVATE_KEY=<hex key> node scripts/spike-wpn-1527/provision-permit2.mjs
 *
 * Dry run (build + print the tx without signing/broadcasting):
 *   node scripts/spike-wpn-1527/provision-permit2.mjs --dry-run
 */

import { TronWeb } from 'tronweb';

const REFERENCE_ACCOUNT = 'TPoQq65NQYpYTBcxCUozQPUDKSHHdXuTLi';
const PERMIT2 = 'TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const UNIVERSAL_ROUTER = 'TQqgNg13s2DjvXhW1ky4v6TsR8wZGvb7Y4';

const MAX_UINT160 = (2n ** 160n - 1n).toString(); // 1461501637330902918203684832716283019655932542975
const MAX_UINT48 = (2n ** 48n - 1n).toString(); // 281474976710655 (never expires in practice)

const FEE_LIMIT_SUN = 30_000_000; // 30 TRX cap; historical cost was ~2.75 TRX

const dryRun = process.argv.includes('--dry-run');

const tronWeb = new TronWeb({
  fullHost: process.env.TRON_HTTP_BASE_URL_MAINNET ?? 'https://api.trongrid.io',
  privateKey: dryRun ? undefined : process.env.REF_PRIVATE_KEY,
});

if (!dryRun && !process.env.REF_PRIVATE_KEY) {
  console.error('Set REF_PRIVATE_KEY (or use --dry-run to preview).');
  process.exit(1);
}

const { transaction } = await tronWeb.transactionBuilder.triggerSmartContract(
  PERMIT2,
  'approve(address,address,uint160,uint48)',
  { feeLimit: FEE_LIMIT_SUN },
  [
    { type: 'address', value: USDT },
    { type: 'address', value: UNIVERSAL_ROUTER },
    { type: 'uint160', value: MAX_UINT160 },
    { type: 'uint48', value: MAX_UINT48 },
  ],
  REFERENCE_ACCOUNT,
);

console.log('Unsigned transaction:');
console.log(JSON.stringify(transaction.raw_data, null, 2));

if (dryRun) {
  console.log('\n--dry-run: not signing or broadcasting.');
  process.exit(0);
}

const signed = await tronWeb.trx.sign(transaction);
const receipt = await tronWeb.trx.sendRawTransaction(signed);
console.log('\nBroadcast result:', JSON.stringify(receipt));
console.log(`https://tronscan.org/#/transaction/${signed.txID}`);

// Verify the new allowance state
await new Promise((resolve) => setTimeout(resolve, 10_000));
const permit2 = await tronWeb.contract(
  [
    {
      name: 'allowance',
      type: 'function',
      stateMutability: 'view',
      inputs: [
        { name: 'owner', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'spender', type: 'address' },
      ],
      outputs: [
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
      ],
    },
  ],
  PERMIT2,
);
const allowance = await permit2
  .allowance(REFERENCE_ACCOUNT, USDT, UNIVERSAL_ROUTER)
  .call();
console.log('\nPermit2 allowance after renewal:');
console.log('  amount    :', allowance.amount.toString());
console.log(
  '  expiration:',
  allowance.expiration.toString(),
  `(max is ${MAX_UINT48})`,
);
