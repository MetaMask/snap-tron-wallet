import { Network } from '../../constants';

/**
 * Swap fee estimation via a MetaMask reference account (WPN-1527).
 *
 * For TRC-20 swaps, the approval has not landed at estimation time, so
 * dry-running the swap with the user's own `owner_address` reverts inside the
 * router's `transferFrom` and the fee quote degrades to the `fee_limit`
 * fallback (100-500 TRX). Energy consumption depends on the code path
 * executed, not on the caller, so re-running the simulation from a
 * MetaMask-controlled reference account — pre-funded and holding standing
 * allowances (ERC20 -> Permit2 -> router) — returns the real `energy_used`.
 *
 * `triggerconstantcontract` requires no signature, so the reference account's
 * private key is never used here: we only substitute its address as the
 * simulation caller. Constant calls consume no balance or allowance.
 *
 * Spike evidence (packages/snap/scripts/spike-wpn-1527): reference-owner
 * simulation matched actual on-chain energy within +0.15% on the MetaMask
 * UniversalRouter route.
 */

/**
 * The reference account: TPoQq65NQYpYTBcxCUozQPUDKSHHdXuTLi.
 * Holds USDT, an unlimited USDT allowance to Permit2, and a Permit2
 * allowance to the UniversalRouter.
 */
export const SWAP_REFERENCE_OWNER_HEX =
  '4197b779963e3778985b4429d30169aa88e7c7d91f';

/**
 * SunSwap UniversalRouter: TQqgNg13s2DjvXhW1ky4v6TsR8wZGvb7Y4.
 * This is the router MetaMask Swaps routes Tron on-chain swaps through
 * (flow: ERC20.approve(Permit2) -> Permit2.approve -> UniversalRouter.execute).
 */
const UNIVERSAL_ROUTER_HEX = '41a31d689a84244bc01be56e07aeafb7686f56bb89';

/**
 * `execute(bytes,bytes[],uint256)` — the UniversalRouter swap entrypoint.
 * Its calldata references the caller via SENDER placeholders (`address(1)`),
 * never by literal address, so substituting `owner_address` is sufficient.
 */
const UNIVERSAL_ROUTER_EXECUTE_SELECTOR = '3593564c';

/**
 * Routes where the reference-owner substitution is known to be safe and
 * accurate: contract address -> allowed method selectors. Both must match;
 * anything else is never rewritten.
 */
const KNOWN_SWAP_ROUTES: Record<string, readonly string[]> = {
  [UNIVERSAL_ROUTER_HEX]: [UNIVERSAL_ROUTER_EXECUTE_SELECTOR],
};

/**
 * Return the reference account to use as the simulation caller for a known
 * swap, or null when the transaction is not a recognized swap.
 *
 * The reference account only exists on mainnet, and the substitution is only
 * safe when we positively know the transaction is a swap (router address AND
 * method selector match) — the caller identity must never leak into the
 * simulation of arbitrary contract calls.
 *
 * @param scope - The network scope of the transaction.
 * @param contractAddress - The target contract address in hex format.
 * @param data - The contract call data in hex format.
 * @returns The reference owner address (hex) or null.
 */
export function getSwapReferenceOwner(
  scope: Network,
  contractAddress: string | undefined,
  data: string | undefined,
): string | null {
  if (scope !== Network.Mainnet || !contractAddress || !data) {
    return null;
  }

  const normalizedAddress = contractAddress.toLowerCase();
  const selector = data.replace(/^0x/u, '').slice(0, 8).toLowerCase();

  const allowedSelectors = KNOWN_SWAP_ROUTES[normalizedAddress];
  if (!allowedSelectors?.includes(selector)) {
    return null;
  }

  return SWAP_REFERENCE_OWNER_HEX;
}
