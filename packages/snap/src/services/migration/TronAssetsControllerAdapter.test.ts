import { MigrationStage } from './stage';
import { TronAssetsControllerAdapter } from './TronAssetsControllerAdapter';
import { WalletMessengerClient } from '../../clients/wallet/WalletMessengerClient';
import { KnownCaip19Id, Network } from '../../constants';

describe('TronAssetsControllerAdapter', () => {
  const resolveStage = jest.fn().mockResolvedValue(MigrationStage.Off);

  it('pushes the complete snapshot through the AssetsController action', async () => {
    const messenger = { call: jest.fn().mockResolvedValue(undefined) };
    const adapter = new TronAssetsControllerAdapter(
      new WalletMessengerClient(messenger),
      resolveStage,
    );
    const assets = [
      {
        assetId: 'tron:728126428/slip44:energy',
        amount: '42',
        metadata: { symbol: 'ENERGY', name: 'Energy', decimals: 0 },
      },
    ];

    await adapter.pushAssetSnapshot('account-id', 'tron:728126428', assets);

    expect(messenger.call).toHaveBeenCalledWith(
      'AssetsController:upsertSnapAssets',
      'account-id',
      'tron:728126428',
      assets,
    );
  });

  it('maps controller asset data to AssetEntity', async () => {
    const messenger = {
      call: jest.fn().mockResolvedValue({
        amount: '1000000',
        metadata: {
          symbol: 'TRX',
          name: 'Tron',
          decimals: 6,
        },
      }),
    };
    const adapter = new TronAssetsControllerAdapter(
      new WalletMessengerClient(messenger),
      resolveStage,
    );

    const asset = await adapter.getAsset(
      'account-id',
      KnownCaip19Id.TrxMainnet,
    );

    expect(messenger.call).toHaveBeenCalledWith(
      'AssetsController:getAsset',
      'account-id',
      KnownCaip19Id.TrxMainnet,
    );
    expect(asset).toMatchObject({
      assetType: KnownCaip19Id.TrxMainnet,
      keyringAccountId: 'account-id',
      network: Network.Mainnet,
      symbol: 'TRX',
      decimals: 6,
      rawAmount: '1000000',
      uiAmount: '1',
    });
  });

  it('returns null when controller has no asset', async () => {
    const messenger = { call: jest.fn().mockResolvedValue(undefined) };
    const adapter = new TronAssetsControllerAdapter(
      new WalletMessengerClient(messenger),
      resolveStage,
    );

    expect(
      await adapter.getAsset('account-id', KnownCaip19Id.TrxMainnet),
    ).toBeNull();
  });

  it('stores the most recently resolved stage', async () => {
    const adapter = new TronAssetsControllerAdapter(
      new WalletMessengerClient(undefined),
      jest.fn().mockResolvedValue(MigrationStage.ReadAssetsControllerOnly),
    );

    await adapter.resolveAndSetStage(Network.Mainnet);

    expect(adapter.getCurrentStage()).toBe(
      MigrationStage.ReadAssetsControllerOnly,
    );
  });
});
