import { WalletMessengerClient } from './WalletMessengerClient';
import type { WalletMessenger } from '../../types/wallet-messenger';

describe('WalletMessengerClient', () => {
  it('calls AssetsController:getAsset with typed arguments', async () => {
    const asset = {
      amount: '1000000',
      metadata: {
        symbol: 'TRX',
        name: 'Tron',
        decimals: 6,
      },
    };
    const messenger: WalletMessenger = {
      call: jest.fn().mockResolvedValue(asset),
    };
    const client = new WalletMessengerClient(messenger);

    expect(
      await client.getAsset('account-id', 'tron:728126428/slip44:195'),
    ).toStrictEqual(asset);

    expect(messenger.call).toHaveBeenCalledWith(
      'AssetsController:getAsset',
      'account-id',
      'tron:728126428/slip44:195',
    );
  });
});
