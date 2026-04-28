import { BIP44CoinTypeNode, type JsonBIP44Node } from '@metamask/key-tree';
import { hexToBytes } from '@metamask/utils';
import { computeAddress } from 'ethers';
import { TronWeb } from 'tronweb';

import { sanitizeSensitiveError } from './errors';

const TRON_COIN_TYPE = 195;

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
  try {
    const coinTypeNode = await BIP44CoinTypeNode.fromJSON(
      coinTypeNodeJson,
      TRON_COIN_TYPE,
    );

    const addressNode = await coinTypeNode.deriveBIP44AddressKey({
      account: 0,
      change: 0,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      address_index: addressIndex,
    });

    if (!addressNode.publicKey) {
      throw new Error('Unable to derive public key');
    }

    const publicKeyBytes = hexToBytes(addressNode.publicKey);
    const hexAddress = computeAddress(addressNode.publicKey);
    const address = TronWeb.address.fromHex(hexAddress);

    if (!address) {
      throw new Error('Unable to derive address');
    }

    return { address, publicKeyBytes };
  } catch (error) {
    throw sanitizeSensitiveError(error);
  }
}
