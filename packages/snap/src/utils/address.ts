import { TronWeb } from 'tronweb';

/**
 * Converts a hex TRON address to a base58 TRON address.
 *
 * @param address - The decoded ABI or protocol hex address.
 * @returns The base58 TRON address, if conversion succeeds.
 */
export function toTronAddress(address: unknown): string | undefined {
  if (typeof address !== 'string') {
    return undefined;
  }

  try {
    const tronAddress = TronWeb.address.fromHex(address);

    return TronWeb.isAddress(tronAddress) ? tronAddress : undefined;
  } catch {
    return undefined;
  }
}
