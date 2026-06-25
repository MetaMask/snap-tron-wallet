import { utils as TronUtils } from 'tronweb';

/**
 * Decodes ABI parameters from TRON calldata.
 *
 * @param data - The normalized calldata including the function selector.
 * @param types - The ABI parameter types.
 * @returns The decoded parameters, or null when decoding fails.
 */
export function decodeCallDataParams(
  data: string,
  types: string[],
): unknown[] | null {
  try {
    const decoded: unknown = TronUtils.abi.decodeParams([], types, data, true);

    return Array.isArray(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
