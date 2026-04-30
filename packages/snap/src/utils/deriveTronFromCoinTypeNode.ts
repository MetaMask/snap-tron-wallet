import {
  getBIP44AddressKeyDeriver,
  type JsonBIP44Node,
  type JsonBIP44CoinTypeNode,
} from '@metamask/key-tree';
import { hexToBytes } from '@metamask/utils';
import { computeAddress } from 'ethers';
import { TronWeb } from 'tronweb';

import { sanitizeSensitiveError } from './errors';

/**
 * Maps an uncompressed secp256k1 public key hex string to a Tron base58 address.
 *
 * @param publicKey - Uncompressed public key with `0x` prefix (same format as key-tree nodes).
 * @returns The Tron address and raw public key bytes.
 */
function tronAddressFromPublicKeyHex(publicKey: string): {
  address: string;
  publicKeyBytes: Uint8Array;
} {
  const publicKeyBytes = hexToBytes(publicKey);
  const hexAddress = computeAddress(publicKey);
  const address = TronWeb.address.fromHex(hexAddress);

  if (!address) {
    throw new Error('Unable to derive address');
  }

  return { address, publicKeyBytes };
}

/**
 * Builds a reusable deriver for Tron addresses under `m/44'/195'/0'/0/i` from the
 * coin-type JSON at `m/44'/195'` (one {@link getBIP44AddressKeyDeriver} parse for many indices).
 *
 * @param coinTypeNodeJson - JSON node from `snap_getBip32Entropy` at path `m/44'/195'`.
 * @returns A function that derives the Tron address for a given BIP-44 `address_index`.
 */
export async function createTronBip44AddressDeriver(
  coinTypeNodeJson: JsonBIP44Node,
): Promise<
  (addressIndex: number) => Promise<{
    address: string;
    publicKeyBytes: Uint8Array;
  }>
> {
  try {
    const deriver = await getBIP44AddressKeyDeriver(
      coinTypeNodeJson as JsonBIP44CoinTypeNode,
      {
        account: 0,
        change: 0,
      },
    );

    return async (addressIndex: number) => {
      try {
        const addressNode = await deriver(addressIndex);

        if (!addressNode.publicKey) {
          throw new Error('Unable to derive public key');
        }

        return tronAddressFromPublicKeyHex(addressNode.publicKey);
      } catch (error) {
        throw sanitizeSensitiveError(error);
      }
    };
  } catch (error) {
    throw sanitizeSensitiveError(error);
  }
}

/**
 * Derives a Tron address from a BIP-44 coin-type node at `m/44'/195'`, without an extra
 * `snap_getBip32Entropy` call per address index.
 *
 * @param options0 - The options for the derivation.
 * @param options0.coinTypeNodeJson - JSON node from `snap_getBip32Entropy` at path `m/44'/195'`.
 * @param options0.addressIndex - BIP-44 `address_index` under account `0'` and change `0`.
 * @returns The derived Tron address and public key bytes.
 */
export async function deriveTronAddressFromCoinTypeNodeJson({
  coinTypeNodeJson,
  addressIndex,
}: {
  coinTypeNodeJson: JsonBIP44Node;
  addressIndex: number;
}): Promise<{ address: string; publicKeyBytes: Uint8Array }> {
  const derive = await createTronBip44AddressDeriver(coinTypeNodeJson);
  return derive(addressIndex);
}
