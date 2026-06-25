import { isHexString, remove0x } from '@metamask/utils';

/**
 * Normalizes a hex string by validating it, lowercasing it, and removing
 * the optional 0x prefix.
 *
 * @param value - The value to normalize.
 * @returns The normalized hex string without `0x`, or null when invalid.
 */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  if (!isHexString(value)) {
    return null;
  }

  return remove0x(value).toLowerCase();
}

/**
 * Converts a hex-encoded string to UTF-8.
 *
 * @param value - Hex string (with or without 0x prefix)
 * @returns Decoded UTF-8 string
 */
export function hexToString(value: string): string {
  const cleanValue = value.startsWith('0x') ? value.slice(2) : value;

  if (cleanValue.length === 0) {
    return '';
  }

  if (cleanValue.length % 2 !== 0) {
    throw new Error('Invalid hex string: odd length');
  }

  const bytes = new Uint8Array(cleanValue.length / 2);
  for (let index = 0; index < cleanValue.length; index += 2) {
    const byte = parseInt(cleanValue.slice(index, index + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error('Invalid hex string: contains non-hex characters');
    }
    bytes[index / 2] = byte;
  }

  return new TextDecoder().decode(bytes);
}
