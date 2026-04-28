import {
  BIP44CoinTypeNode,
  BIP44PurposeNodeToken,
  mnemonicPhraseToBytes,
} from '@metamask/key-tree';
import { computeAddress } from 'ethers';
import { TronWeb } from 'tronweb';

import { deriveTronAddressFromCoinTypeNodeJson } from './deriveTronFromCoinTypeNode';

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('deriveTronAddressFromCoinTypeNodeJson', () => {
  it('matches full-path Tron addresses for indices 0–3', async () => {
    const seed = mnemonicPhraseToBytes(TEST_MNEMONIC);
    const coinTypeNode = await BIP44CoinTypeNode.fromDerivationPath([
      seed,
      BIP44PurposeNodeToken,
      `bip32:195'`,
    ]);
    const coinTypeJson = coinTypeNode.toJSON();

    for (const addressIndex of [0, 1, 2, 3]) {
      const fullNode = await coinTypeNode.deriveBIP44AddressKey({
        account: 0,
        change: 0,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        address_index: addressIndex,
      });

      const expectedHex = computeAddress(fullNode.publicKey);
      const expectedAddress = TronWeb.address.fromHex(expectedHex);

      const { address } = await deriveTronAddressFromCoinTypeNodeJson({
        coinTypeNodeJson: coinTypeJson,
        addressIndex,
      });

      expect(address).toBe(expectedAddress);
    }
  });
});
