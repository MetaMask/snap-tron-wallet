import type { KeyringAccount } from '@metamask/keyring-api';
import { KeyringEvent } from '@metamask/keyring-api';
import { emitSnapKeyringEvent } from '@metamask/keyring-snap-sdk';

import type { AssetsRepository } from './AssetsRepository';
import type { PriceApiClient } from '../../clients/price-api/PriceApiClient';
import type { TokenApiClient } from '../../clients/token-api/TokenApiClient';
import type { TronHttpClient } from '../../clients/tron-http/TronHttpClient';
import type { TrongridApiClient } from '../../clients/trongrid/TrongridApiClient';
import { KnownCaip19Id, Network } from '../../constants';
import type { AssetEntity } from '../../entities/assets';
import { mockLogger } from '../../utils/mockLogger';
import type { State, UnencryptedStateValue } from '../state/State';

// Mock context module to avoid circular dependency
jest.mock('../../context', () => ({
  configProvider: {
    get() {
      return {
        priceApi: {
          cacheTtlsMilliseconds: {
            fiatExchangeRates: 3600000,
            spotPrices: 3600000,
            historicalPrices: 3600000,
          },
        },
        activeNetworks: [],
      };
    },
  },
}));

jest.mock('@metamask/keyring-snap-sdk', () => ({
  emitSnapKeyringEvent: jest.fn(),
}));

// Mock global snap object
// eslint-disable-next-line no-restricted-globals
(global as any).snap = {};

// Import AssetsService after mocking context
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-globals
const { AssetsService } = require('./AssetsService');

/* eslint-disable @typescript-eslint/naming-convention */
const minimalTronAccount = {
  address: 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx',
  balance: 0,
  frozenV2: [],
  account_resource: {
    energy_window_optimized: false,
    energy_window_size: 0,
  },
  create_time: 0,
  latest_opration_time: 0,
  unfrozenV2: [],
  latest_consume_free_time: 0,
  votes: [],
  latest_withdraw_time: 0,
  net_window_size: 0,
  net_window_optimized: false,
  owner_permission: { keys: [], threshold: 0, permission_name: 'owner' },
  active_permission: [],
};
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Builds a mock AccountResources object matching the shape returned by
 * POST https://api.trongrid.io/wallet/getaccountresource.
 *
 * The Tron full node omits fields with zero values, so all
 * account-level fields are optional. Network-level totals use
 * sensible mainnet defaults.
 *
 * @see https://developers.tron.network/reference/getaccountresource
 * @param overrides - Account-specific fields to set.
 * @returns A mock AccountResources object.
 */
function getMockAccountResources(overrides: Record<string, number> = {}) {
  return {
    freeNetLimit: 600,
    TotalNetLimit: 0,
    TotalNetWeight: 0,
    TotalEnergyLimit: 0,
    TotalEnergyWeight: 0,
    ...overrides,
  };
}

/**
 * Finds an asset by its CAIP-19 asset type.
 *
 * @param assets - The list of assets to search.
 * @param assetType - The CAIP-19 asset type to match.
 * @returns The matching asset, or undefined.
 */
function findAsset(assets: AssetEntity[], assetType: KnownCaip19Id) {
  return assets.find((a: AssetEntity) => a.assetType === assetType);
}

describe('AssetsService', () => {
  let assetsService: any;
  let mockAssetsRepository: jest.Mocked<
    Pick<
      AssetsRepository,
      | 'saveMany'
      | 'getByAccountId'
      | 'getByAccountIdAndAssetType'
      | 'getByAccountIdAndAssetTypes'
    >
  >;
  let mockState: jest.Mocked<
    Pick<State<UnencryptedStateValue>, 'getKey' | 'setKey'>
  >;
  let mockTrongridApiClient: jest.Mocked<
    Pick<
      TrongridApiClient,
      'getAccountInfoByAddress' | 'getTrc20BalancesByAddress'
    >
  >;
  let mockTronHttpClient: jest.Mocked<
    Pick<TronHttpClient, 'getAccountResources'>
  >;
  let mockPriceApiClient: jest.Mocked<
    Pick<
      PriceApiClient,
      'getFiatExchangeRates' | 'getHistoricalPrices' | 'getMultipleSpotPrices'
    >
  >;
  let mockTokenApiClient: jest.Mocked<
    Pick<TokenApiClient, 'getTokensMetadata'>
  >;

  const mockAccount: KeyringAccount = {
    id: 'test-account-id',
    address: 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx',
    type: 'eip155:eoa',
    options: {},
    methods: [],
    scopes: ['tron:728126428'],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockAssetsRepository = {
      saveMany: jest.fn().mockResolvedValue(undefined),
      getByAccountId: jest.fn().mockResolvedValue([]),
      getByAccountIdAndAssetType: jest.fn().mockResolvedValue(null),
      getByAccountIdAndAssetTypes: jest.fn().mockResolvedValue([]),
    };

    mockState = {
      getKey: jest.fn().mockResolvedValue({}),
      setKey: jest.fn().mockResolvedValue(undefined),
    };

    mockTrongridApiClient = {
      getAccountInfoByAddress: jest.fn(),
      getTrc20BalancesByAddress: jest.fn(),
    };
    mockTronHttpClient = {
      getAccountResources: jest.fn(),
    };
    mockPriceApiClient = {
      getFiatExchangeRates: jest.fn(),
      getHistoricalPrices: jest.fn(),
      getMultipleSpotPrices: jest.fn().mockResolvedValue({}),
    };
    mockTokenApiClient = {
      getTokensMetadata: jest.fn().mockResolvedValue({}),
    };

    assetsService = new AssetsService({
      logger: mockLogger,
      assetsRepository: mockAssetsRepository,
      state: mockState,
      trongridApiClient: mockTrongridApiClient,
      tronHttpClient: mockTronHttpClient,
      priceApiClient: mockPriceApiClient,
      tokenApiClient: mockTokenApiClient,
    });
  });

  describe('fetchAssetsAndBalancesForAccount', () => {
    describe('inactive account fallback', () => {
      it('falls back to TRC20 balance endpoint when account info fails (inactive account)', async () => {
        // Arrange: Account info fails (inactive account doesn't exist on-chain)
        // Note: getAccountResources returns {} for inactive accounts, not an error
        mockTrongridApiClient.getAccountInfoByAddress.mockRejectedValue(
          new Error('Account not found or no data returned'),
        );
        mockTronHttpClient.getAccountResources.mockResolvedValue({} as never);

        // TRC20 fallback endpoint returns some balances
        const trc20Balances = [
          { TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: '24249143' },
        ];
        mockTrongridApiClient.getTrc20BalancesByAddress.mockResolvedValue(
          trc20Balances,
        );

        // Mock price API to return prices for the TRC20 tokens
        const trc20AssetId = `${String(Network.Mainnet)}/trc20:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`;
        mockPriceApiClient.getMultipleSpotPrices.mockResolvedValue({
          [trc20AssetId]: {
            id: trc20AssetId,
            price: 1.0,
          },
        } as never);

        // Act
        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        // Assert: Should have called the fallback endpoint
        expect(
          mockTrongridApiClient.getTrc20BalancesByAddress,
        ).toHaveBeenCalledWith(Network.Mainnet, mockAccount.address);

        // Assert: Should return TRX with zero balance and TRC20 tokens
        const trxAsset = assets.find(
          (asset: AssetEntity) => asset.assetType === KnownCaip19Id.TrxMainnet,
        );
        expect(trxAsset).toBeDefined();
        expect(trxAsset?.rawAmount).toBe('0');

        const expectedTrc20AssetType = `${String(Network.Mainnet)}/trc20:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`;
        const trc20Asset = assets.find(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
          (asset: AssetEntity) => asset.assetType === expectedTrc20AssetType,
        );
        expect(trc20Asset).toBeDefined();
        expect(trc20Asset?.rawAmount).toBe('24249143');
      });

      it('returns zero TRX and resources when fallback also returns empty', async () => {
        // Arrange: Account info fails (inactive account)
        // Note: getAccountResources returns {} for inactive accounts, not an error
        mockTrongridApiClient.getAccountInfoByAddress.mockRejectedValue(
          new Error('Account not found or no data returned'),
        );
        mockTronHttpClient.getAccountResources.mockResolvedValue({} as never);

        // TRC20 fallback endpoint returns empty (no tokens)
        mockTrongridApiClient.getTrc20BalancesByAddress.mockResolvedValue([]);

        // Act
        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        // Assert: Should have called the fallback endpoint
        expect(
          mockTrongridApiClient.getTrc20BalancesByAddress,
        ).toHaveBeenCalledWith(Network.Mainnet, mockAccount.address);

        // Assert: Should return TRX with zero balance and zero resources
        const trxAsset = assets.find(
          (asset: AssetEntity) => asset.assetType === KnownCaip19Id.TrxMainnet,
        );
        expect(trxAsset).toBeDefined();
        expect(trxAsset?.rawAmount).toBe('0');

        // Assert: Bandwidth and energy should also be present with zero values
        const bandwidthAsset = assets.find(
          (asset: AssetEntity) =>
            asset.assetType === KnownCaip19Id.BandwidthMainnet,
        );
        const energyAsset = assets.find(
          (asset: AssetEntity) =>
            asset.assetType === KnownCaip19Id.EnergyMainnet,
        );
        expect(bandwidthAsset).toBeDefined();
        expect(energyAsset).toBeDefined();
      });

      it('gracefully handles fallback endpoint failure', async () => {
        // Arrange: Account info fails (inactive account)
        // Note: getAccountResources returns {} for inactive accounts, not an error
        mockTrongridApiClient.getAccountInfoByAddress.mockRejectedValue(
          new Error('Account not found or no data returned'),
        );
        mockTronHttpClient.getAccountResources.mockResolvedValue({} as never);

        // TRC20 fallback endpoint also fails
        mockTrongridApiClient.getTrc20BalancesByAddress.mockRejectedValue(
          new Error('Network error'),
        );

        // Act
        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        // Assert: Should still return TRX with zero balance
        const trxAsset = assets.find(
          (asset: AssetEntity) => asset.assetType === KnownCaip19Id.TrxMainnet,
        );
        expect(trxAsset).toBeDefined();
        expect(trxAsset?.rawAmount).toBe('0');
      });

      it('filters out TRC20 tokens without price data from inactive account', async () => {
        // Arrange: Account info fails (inactive account)
        // Note: getAccountResources returns {} for inactive accounts, not an error
        mockTrongridApiClient.getAccountInfoByAddress.mockRejectedValue(
          new Error('Account not found or no data returned'),
        );
        mockTronHttpClient.getAccountResources.mockResolvedValue({} as never);

        // TRC20 fallback returns tokens including a spam token
        const trc20BalancesWithSpam = [
          { TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: '24249143' }, // USDT - has price
          { TSpamToken123456789: '1000000000' }, // Spam token - no price
        ];
        mockTrongridApiClient.getTrc20BalancesByAddress.mockResolvedValue(
          trc20BalancesWithSpam as never,
        );

        // Mock price API to only return price for USDT
        const usdtAssetId = `${String(Network.Mainnet)}/trc20:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`;
        mockPriceApiClient.getMultipleSpotPrices.mockResolvedValue({
          [usdtAssetId]: {
            id: usdtAssetId,
            price: 1.0,
          },
          // No price for spam token
        } as never);

        // Act
        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        // Assert: USDT should be included
        const usdtAssetType = `${String(Network.Mainnet)}/trc20:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`;
        const usdtAsset = assets.find(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
          (asset: AssetEntity) => asset.assetType === usdtAssetType,
        );
        expect(usdtAsset).toBeDefined();

        // Assert: Spam token should be filtered out
        const spamAssetType = `${String(Network.Mainnet)}/trc20:TSpamToken123456789`;
        const spamAsset = assets.find(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
          (asset: AssetEntity) => asset.assetType === spamAssetType,
        );
        expect(spamAsset).toBeUndefined();
      });
    });

    describe('partial failure handling', () => {
      it('uses fallback when account info fails even if resources succeed (inactive account)', async () => {
        // Arrange: Account info fails (inactive account), resources succeed with empty object
        // This matches real API behavior: getAccountResources returns {} for inactive accounts
        mockTrongridApiClient.getAccountInfoByAddress.mockRejectedValue(
          new Error('Account not found or no data returned'),
        );
        mockTronHttpClient.getAccountResources.mockResolvedValue({
          freeNetLimit: 600,
          NetLimit: 0,
          EnergyLimit: 0,
        } as never);

        // TRC20 fallback endpoint returns some balances
        const trc20Balances = [
          { TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: '100000' },
        ];
        mockTrongridApiClient.getTrc20BalancesByAddress.mockResolvedValue(
          trc20Balances,
        );

        // Mock price API for the TRC20 token
        const trc20AssetId = `${String(Network.Mainnet)}/trc20:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`;
        mockPriceApiClient.getMultipleSpotPrices.mockResolvedValue({
          [trc20AssetId]: { id: trc20AssetId, price: 1.0 },
        } as never);

        // Act
        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        // Assert: Should have used the fallback endpoint
        expect(
          mockTrongridApiClient.getTrc20BalancesByAddress,
        ).toHaveBeenCalledWith(Network.Mainnet, mockAccount.address);

        // Assert: Should return zero TRX (fallback behavior)
        const trxAsset = assets.find(
          (asset: AssetEntity) => asset.assetType === KnownCaip19Id.TrxMainnet,
        );
        expect(trxAsset).toBeDefined();
        expect(trxAsset?.rawAmount).toBe('0');

        // Assert: Should include TRC20 from fallback
        const trc20Asset = assets.find(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
          (asset: AssetEntity) => asset.assetType === trc20AssetId,
        );
        expect(trc20Asset).toBeDefined();
        expect(trc20Asset?.rawAmount).toBe('100000');
      });

      it('continues with zero resources when only resources request fails', async () => {
        // Arrange: Account info succeeds, resources fail
        mockTrongridApiClient.getAccountInfoByAddress.mockResolvedValue({
          address: mockAccount.address,
          balance: 1000000,
          trc20: [],
        } as never);
        mockTronHttpClient.getAccountResources.mockRejectedValue(
          new Error('Resources endpoint unavailable'),
        );

        // Act
        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        // Assert: Should return TRX balance from account info
        const trxAsset = assets.find(
          (asset: AssetEntity) => asset.assetType === KnownCaip19Id.TrxMainnet,
        );
        expect(trxAsset).toBeDefined();
        expect(trxAsset?.rawAmount).toBe('1000000');

        // Assert: Bandwidth and energy should be 0 (default)
        const bandwidthAsset = assets.find(
          (asset: AssetEntity) =>
            asset.assetType === KnownCaip19Id.BandwidthMainnet,
        );
        expect(bandwidthAsset).toBeDefined();
        expect(bandwidthAsset?.rawAmount).toBe('0');
      });
    });
  });

  describe('saveMany', () => {
    it('does not remove energy and bandwidth assets even when they have zero amounts', async () => {
      // Arrange: Create assets with zero amounts for energy and bandwidth
      const assets: AssetEntity[] = [
        {
          assetType: KnownCaip19Id.TrxMainnet,
          keyringAccountId: mockAccount.id,
          network: Network.Mainnet,
          symbol: 'TRX',
          decimals: 6,
          rawAmount: '1000000',
          uiAmount: '1',
          iconUrl: '',
        },
        {
          assetType: KnownCaip19Id.EnergyMainnet,
          keyringAccountId: mockAccount.id,
          network: Network.Mainnet,
          symbol: 'ENERGY',
          decimals: 0,
          rawAmount: '0', // Zero energy
          uiAmount: '0',
          iconUrl: '',
        },
        {
          assetType: KnownCaip19Id.BandwidthMainnet,
          keyringAccountId: mockAccount.id,
          network: Network.Mainnet,
          symbol: 'BANDWIDTH',
          decimals: 0,
          rawAmount: '0', // Zero bandwidth
          uiAmount: '0',
          iconUrl: '',
        },
      ];

      mockState.getKey.mockResolvedValue({});

      await assetsService.saveMany(assets);

      // Assert: Energy and bandwidth should be in the "added" list, not "removed"
      expect(emitSnapKeyringEvent).toHaveBeenCalledWith(
        expect.anything(),
        KeyringEvent.AccountAssetListUpdated,
        {
          assets: {
            [mockAccount.id]: {
              added: expect.arrayContaining([
                KnownCaip19Id.TrxMainnet,
                KnownCaip19Id.EnergyMainnet,
                KnownCaip19Id.BandwidthMainnet,
              ]),
              removed: [],
            },
          },
        },
      );
    });

    it('removes non-essential assets with zero amounts', async () => {
      // Arrange: Create a regular TRC20 token with zero amount
      const trc20AssetId = `${Network.Mainnet}/trc20:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`;
      const assets: AssetEntity[] = [
        {
          assetType: KnownCaip19Id.TrxMainnet,
          keyringAccountId: mockAccount.id,
          network: Network.Mainnet,
          symbol: 'TRX',
          decimals: 6,
          rawAmount: '1000000',
          uiAmount: '1',
          iconUrl: '',
        },
        {
          assetType: trc20AssetId,
          keyringAccountId: mockAccount.id,
          network: Network.Mainnet,
          symbol: 'USDT',
          decimals: 6,
          rawAmount: '0', // Zero balance
          uiAmount: '0',
          iconUrl: '',
        },
      ];

      // Mock the getAll method to return the same assets (simulating they were already saved)
      mockState.getKey.mockResolvedValue({
        [mockAccount.id]: assets,
      });

      // Act: Save the assets
      await assetsService.saveMany(assets);

      // Assert: TRC20 with zero balance should be in the "removed" list
      expect(emitSnapKeyringEvent).toHaveBeenCalledWith(
        expect.anything(),
        KeyringEvent.AccountAssetListUpdated,
        {
          assets: {
            [mockAccount.id]: {
              added: [KnownCaip19Id.TrxMainnet], // TRX is always present
              removed: [trc20AssetId], // Zero balance TRC20 should be removed
            },
          },
        },
      );
    });

    it('keeps maximum energy and bandwidth assets even with zero amounts', async () => {
      // Arrange: Create maximum energy and bandwidth assets with zero amounts
      const assets: AssetEntity[] = [
        {
          assetType: KnownCaip19Id.TrxMainnet,
          keyringAccountId: mockAccount.id,
          network: Network.Mainnet,
          symbol: 'TRX',
          decimals: 6,
          rawAmount: '1000000',
          uiAmount: '1',
          iconUrl: '',
        },
        {
          assetType: KnownCaip19Id.MaximumEnergyMainnet,
          keyringAccountId: mockAccount.id,
          network: Network.Mainnet,
          symbol: 'MAX-ENERGY',
          decimals: 0,
          rawAmount: '0',
          uiAmount: '0',
          iconUrl: '',
        },
        {
          assetType: KnownCaip19Id.MaximumBandwidthMainnet,
          keyringAccountId: mockAccount.id,
          network: Network.Mainnet,
          symbol: 'MAX-BANDWIDTH',
          decimals: 0,
          rawAmount: '0',
          uiAmount: '0',
          iconUrl: '',
        },
      ];

      // Mock the getAll method to return empty
      mockState.getKey.mockResolvedValue({});

      // Act: Save the assets
      await assetsService.saveMany(assets);

      // Assert: Maximum energy and bandwidth should be in the "added" list
      expect(emitSnapKeyringEvent).toHaveBeenCalledWith(
        expect.anything(),
        KeyringEvent.AccountAssetListUpdated,
        {
          assets: {
            [mockAccount.id]: {
              added: expect.arrayContaining([
                KnownCaip19Id.TrxMainnet,
                KnownCaip19Id.MaximumEnergyMainnet,
                KnownCaip19Id.MaximumBandwidthMainnet,
              ]),
              removed: [],
            },
          },
        },
      );
    });

    it('keeps staked assets even with zero amounts', async () => {
      // Arrange: Create staked assets with zero amounts
      const assets: AssetEntity[] = [
        {
          assetType: KnownCaip19Id.TrxMainnet,
          keyringAccountId: mockAccount.id,
          network: Network.Mainnet,
          symbol: 'TRX',
          decimals: 6,
          rawAmount: '1000000',
          uiAmount: '1',
          iconUrl: '',
        },
        {
          assetType: KnownCaip19Id.TrxStakedForBandwidthMainnet,
          keyringAccountId: mockAccount.id,
          network: Network.Mainnet,
          symbol: 'sTRX-BANDWIDTH',
          decimals: 6,
          rawAmount: '0',
          uiAmount: '0',
          iconUrl: '',
        },
        {
          assetType: KnownCaip19Id.TrxStakedForEnergyMainnet,
          keyringAccountId: mockAccount.id,
          network: Network.Mainnet,
          symbol: 'sTRX-ENERGY',
          decimals: 6,
          rawAmount: '0',
          uiAmount: '0',
          iconUrl: '',
        },
      ];

      // Mock the getAll method to return empty
      mockState.getKey.mockResolvedValue({});

      // Act: Save the assets
      await assetsService.saveMany(assets);

      // Assert: Staked assets should be in the "added" list
      expect(emitSnapKeyringEvent).toHaveBeenCalledWith(
        expect.anything(),
        KeyringEvent.AccountAssetListUpdated,
        {
          assets: {
            [mockAccount.id]: {
              added: expect.arrayContaining([
                KnownCaip19Id.TrxMainnet,
                KnownCaip19Id.TrxStakedForBandwidthMainnet,
                KnownCaip19Id.TrxStakedForEnergyMainnet,
              ]),
              removed: [],
            },
          },
        },
      );
    });

    describe('updating assets from 0 to >0', () => {
      it('adds energy to the asset list when it updates from 0 to >0', async () => {
        // Arrange: Previously saved assets with zero energy
        const savedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '1000000',
            uiAmount: '1',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.EnergyMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'ENERGY',
            decimals: 0,
            rawAmount: '0', // Previously zero
            uiAmount: '0',
            iconUrl: '',
          },
        ];

        // New assets with non-zero energy
        const updatedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '1000000',
            uiAmount: '1',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.EnergyMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'ENERGY',
            decimals: 0,
            rawAmount: '50000', // Now has energy!
            uiAmount: '50000',
            iconUrl: '',
          },
        ];

        // Mock state to return previously saved assets
        mockState.getKey.mockResolvedValue({
          [mockAccount.id]: savedAssets,
        });

        // Act: Save updated assets
        await assetsService.saveMany(updatedAssets);

        // Assert: Energy should be in the "added" list since it went from 0 to >0
        expect(emitSnapKeyringEvent).toHaveBeenCalledWith(
          expect.anything(),
          KeyringEvent.AccountAssetListUpdated,
          {
            assets: {
              [mockAccount.id]: {
                added: expect.arrayContaining([
                  KnownCaip19Id.TrxMainnet,
                  KnownCaip19Id.EnergyMainnet,
                ]),
                removed: [],
              },
            },
          },
        );
      });

      it('adds bandwidth to the asset list when it updates from 0 to >0', async () => {
        // Arrange: Previously saved assets with zero bandwidth
        const savedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '1000000',
            uiAmount: '1',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.BandwidthMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'BANDWIDTH',
            decimals: 0,
            rawAmount: '0', // Previously zero
            uiAmount: '0',
            iconUrl: '',
          },
        ];

        // New assets with non-zero bandwidth
        const updatedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '1000000',
            uiAmount: '1',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.BandwidthMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'BANDWIDTH',
            decimals: 0,
            rawAmount: '1500', // Now has bandwidth!
            uiAmount: '1500',
            iconUrl: '',
          },
        ];

        // Mock state to return previously saved assets
        mockState.getKey.mockResolvedValue({
          [mockAccount.id]: savedAssets,
        });

        // Act: Save updated assets
        await assetsService.saveMany(updatedAssets);

        // Assert: Bandwidth should be in the "added" list since it went from 0 to >0
        expect(emitSnapKeyringEvent).toHaveBeenCalledWith(
          expect.anything(),
          KeyringEvent.AccountAssetListUpdated,
          {
            assets: {
              [mockAccount.id]: {
                added: expect.arrayContaining([
                  KnownCaip19Id.TrxMainnet,
                  KnownCaip19Id.BandwidthMainnet,
                ]),
                removed: [],
              },
            },
          },
        );
      });

      it('adds TRC20 token to the asset list when it updates from 0 to >0', async () => {
        const trc20AssetId = `${Network.Mainnet}/trc20:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`;

        // Arrange: Previously saved assets with zero USDT
        const savedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '1000000',
            uiAmount: '1',
            iconUrl: '',
          },
          {
            assetType: trc20AssetId,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'USDT',
            decimals: 6,
            rawAmount: '0', // Previously zero
            uiAmount: '0',
            iconUrl: '',
          },
        ];

        // New assets with non-zero USDT
        const updatedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '1000000',
            uiAmount: '1',
            iconUrl: '',
          },
          {
            assetType: trc20AssetId,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'USDT',
            decimals: 6,
            rawAmount: '100000000', // Now has USDT!
            uiAmount: '100',
            iconUrl: '',
          },
        ];

        // Mock state to return previously saved assets
        mockState.getKey.mockResolvedValue({
          [mockAccount.id]: savedAssets,
        });

        // Act: Save updated assets
        await assetsService.saveMany(updatedAssets);

        // Assert: USDT should be in the "added" list since it went from 0 to >0
        expect(emitSnapKeyringEvent).toHaveBeenCalledWith(
          expect.anything(),
          KeyringEvent.AccountAssetListUpdated,
          {
            assets: {
              [mockAccount.id]: {
                added: expect.arrayContaining([
                  KnownCaip19Id.TrxMainnet,
                  trc20AssetId,
                ]),
                removed: [],
              },
            },
          },
        );
      });

      it('handles multiple assets updating from 0 to >0 simultaneously', async () => {
        const trc20AssetId = `${Network.Mainnet}/trc20:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`;

        // Arrange: Previously saved assets with all zeros
        const savedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '1000000',
            uiAmount: '1',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.EnergyMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'ENERGY',
            decimals: 0,
            rawAmount: '0',
            uiAmount: '0',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.BandwidthMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'BANDWIDTH',
            decimals: 0,
            rawAmount: '0',
            uiAmount: '0',
            iconUrl: '',
          },
          {
            assetType: trc20AssetId,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'USDT',
            decimals: 6,
            rawAmount: '0',
            uiAmount: '0',
            iconUrl: '',
          },
        ];

        // New assets with all non-zero amounts
        const updatedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '1000000',
            uiAmount: '1',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.EnergyMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'ENERGY',
            decimals: 0,
            rawAmount: '50000',
            uiAmount: '50000',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.BandwidthMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'BANDWIDTH',
            decimals: 0,
            rawAmount: '1500',
            uiAmount: '1500',
            iconUrl: '',
          },
          {
            assetType: trc20AssetId,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'USDT',
            decimals: 6,
            rawAmount: '100000000',
            uiAmount: '100',
            iconUrl: '',
          },
        ];

        // Mock state to return previously saved assets
        mockState.getKey.mockResolvedValue({
          [mockAccount.id]: savedAssets,
        });

        // Act: Save updated assets
        await assetsService.saveMany(updatedAssets);

        // Assert: All assets should be in the "added" list
        expect(emitSnapKeyringEvent).toHaveBeenCalledWith(
          expect.anything(),
          KeyringEvent.AccountAssetListUpdated,
          {
            assets: {
              [mockAccount.id]: {
                added: expect.arrayContaining([
                  KnownCaip19Id.TrxMainnet,
                  KnownCaip19Id.EnergyMainnet,
                  KnownCaip19Id.BandwidthMainnet,
                  trc20AssetId,
                ]),
                removed: [],
              },
            },
          },
        );
      });

      it('handles staked assets updating from 0 to >0', async () => {
        // Arrange: Previously saved assets with zero staked amounts
        const savedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '5000000',
            uiAmount: '5',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.TrxStakedForEnergyMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'sTRX-ENERGY',
            decimals: 6,
            rawAmount: '0',
            uiAmount: '0',
            iconUrl: '',
          },
        ];

        // New assets after staking (TRX reduced, staked asset increased)
        const updatedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '2000000',
            uiAmount: '2',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.TrxStakedForEnergyMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'sTRX-ENERGY',
            decimals: 6,
            rawAmount: '3000000', // User staked 3 TRX
            uiAmount: '3',
            iconUrl: '',
          },
        ];

        // Mock state to return previously saved assets
        mockState.getKey.mockResolvedValue({
          [mockAccount.id]: savedAssets,
        });

        // Act: Save updated assets
        await assetsService.saveMany(updatedAssets);

        // Assert: Staked asset should be in the "added" list
        expect(emitSnapKeyringEvent).toHaveBeenCalledWith(
          expect.anything(),
          KeyringEvent.AccountAssetListUpdated,
          {
            assets: {
              [mockAccount.id]: {
                added: expect.arrayContaining([
                  KnownCaip19Id.TrxMainnet,
                  KnownCaip19Id.TrxStakedForEnergyMainnet,
                ]),
                removed: [],
              },
            },
          },
        );
      });
    });

    describe('updating assets going down', () => {
      it('updates energy balance when it decreases but remains >0', async () => {
        // Arrange: Previously saved assets with high energy
        const savedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '1000000',
            uiAmount: '1',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.EnergyMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'ENERGY',
            decimals: 0,
            rawAmount: '100000', // High energy
            uiAmount: '100000',
            iconUrl: '',
          },
        ];

        // New assets with reduced energy (after transaction consumption)
        const updatedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '1000000',
            uiAmount: '1',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.EnergyMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'ENERGY',
            decimals: 0,
            rawAmount: '35000', // Energy consumed by transaction
            uiAmount: '35000',
            iconUrl: '',
          },
        ];

        // Mock state to return previously saved assets
        mockState.getKey.mockResolvedValue({
          [mockAccount.id]: savedAssets,
        });

        // Act: Save updated assets
        await assetsService.saveMany(updatedAssets);

        // Assert: Energy should still be in the "added" list (not removed)
        expect(emitSnapKeyringEvent).toHaveBeenCalledWith(
          expect.anything(),
          KeyringEvent.AccountAssetListUpdated,
          {
            assets: {
              [mockAccount.id]: {
                added: expect.arrayContaining([
                  KnownCaip19Id.TrxMainnet,
                  KnownCaip19Id.EnergyMainnet,
                ]),
                removed: [],
              },
            },
          },
        );

        // Assert: Balance update event should be emitted with new amount
        expect(emitSnapKeyringEvent).toHaveBeenCalledWith(
          expect.anything(),
          KeyringEvent.AccountBalancesUpdated,
          {
            balances: {
              [mockAccount.id]: {
                [KnownCaip19Id.TrxMainnet]: {
                  unit: 'TRX',
                  amount: '1',
                },
                [KnownCaip19Id.EnergyMainnet]: {
                  unit: 'ENERGY',
                  amount: '35000',
                },
              },
            },
          },
        );
      });

      it('updates bandwidth balance when it decreases but remains >0', async () => {
        // Arrange: Previously saved assets with high bandwidth
        const savedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '1000000',
            uiAmount: '1',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.BandwidthMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'BANDWIDTH',
            decimals: 0,
            rawAmount: '5000', // High bandwidth
            uiAmount: '5000',
            iconUrl: '',
          },
        ];

        // New assets with reduced bandwidth (after transaction consumption)
        const updatedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '1000000',
            uiAmount: '1',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.BandwidthMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'BANDWIDTH',
            decimals: 0,
            rawAmount: '4700', // Bandwidth consumed by transaction
            uiAmount: '4700',
            iconUrl: '',
          },
        ];

        // Mock state to return previously saved assets
        mockState.getKey.mockResolvedValue({
          [mockAccount.id]: savedAssets,
        });

        // Act: Save updated assets
        await assetsService.saveMany(updatedAssets);

        // Assert: Bandwidth should still be in the "added" list (not removed)
        expect(emitSnapKeyringEvent).toHaveBeenCalledWith(
          expect.anything(),
          KeyringEvent.AccountAssetListUpdated,
          {
            assets: {
              [mockAccount.id]: {
                added: expect.arrayContaining([
                  KnownCaip19Id.TrxMainnet,
                  KnownCaip19Id.BandwidthMainnet,
                ]),
                removed: [],
              },
            },
          },
        );

        // Assert: Balance update event should be emitted with new amount
        expect(emitSnapKeyringEvent).toHaveBeenCalledWith(
          expect.anything(),
          KeyringEvent.AccountBalancesUpdated,
          {
            balances: {
              [mockAccount.id]: {
                [KnownCaip19Id.TrxMainnet]: {
                  unit: 'TRX',
                  amount: '1',
                },
                [KnownCaip19Id.BandwidthMainnet]: {
                  unit: 'BANDWIDTH',
                  amount: '4700',
                },
              },
            },
          },
        );
      });

      it('keeps energy in the list when it drops to 0', async () => {
        // Arrange: Previously saved assets with some energy
        const savedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '1000000',
            uiAmount: '1',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.EnergyMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'ENERGY',
            decimals: 0,
            rawAmount: '50000',
            uiAmount: '50000',
            iconUrl: '',
          },
        ];

        // New assets with zero energy (fully consumed)
        const updatedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '1000000',
            uiAmount: '1',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.EnergyMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'ENERGY',
            decimals: 0,
            rawAmount: '0', // All energy consumed
            uiAmount: '0',
            iconUrl: '',
          },
        ];

        // Mock state to return previously saved assets
        mockState.getKey.mockResolvedValue({
          [mockAccount.id]: savedAssets,
        });

        // Act: Save updated assets
        await assetsService.saveMany(updatedAssets);

        // Assert: Energy should still be in the "added" list (not removed) because it's an essential asset
        expect(emitSnapKeyringEvent).toHaveBeenCalledWith(
          expect.anything(),
          KeyringEvent.AccountAssetListUpdated,
          {
            assets: {
              [mockAccount.id]: {
                added: expect.arrayContaining([
                  KnownCaip19Id.TrxMainnet,
                  KnownCaip19Id.EnergyMainnet,
                ]),
                removed: [],
              },
            },
          },
        );
      });

      it('keeps bandwidth in the list when it drops to 0', async () => {
        // Arrange: Previously saved assets with some bandwidth
        const savedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '1000000',
            uiAmount: '1',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.BandwidthMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'BANDWIDTH',
            decimals: 0,
            rawAmount: '300',
            uiAmount: '300',
            iconUrl: '',
          },
        ];

        // New assets with zero bandwidth (fully consumed)
        const updatedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '1000000',
            uiAmount: '1',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.BandwidthMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'BANDWIDTH',
            decimals: 0,
            rawAmount: '0', // All bandwidth consumed
            uiAmount: '0',
            iconUrl: '',
          },
        ];

        // Mock state to return previously saved assets
        mockState.getKey.mockResolvedValue({
          [mockAccount.id]: savedAssets,
        });

        // Act: Save updated assets
        await assetsService.saveMany(updatedAssets);

        // Assert: Bandwidth should still be in the "added" list (not removed) because it's an essential asset
        expect(emitSnapKeyringEvent).toHaveBeenCalledWith(
          expect.anything(),
          KeyringEvent.AccountAssetListUpdated,
          {
            assets: {
              [mockAccount.id]: {
                added: expect.arrayContaining([
                  KnownCaip19Id.TrxMainnet,
                  KnownCaip19Id.BandwidthMainnet,
                ]),
                removed: [],
              },
            },
          },
        );
      });

      it('handles both energy and bandwidth fluctuating in a transaction', async () => {
        // Arrange: Previously saved assets
        const savedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '2000000',
            uiAmount: '2',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.EnergyMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'ENERGY',
            decimals: 0,
            rawAmount: '80000',
            uiAmount: '80000',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.BandwidthMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'BANDWIDTH',
            decimals: 0,
            rawAmount: '1500',
            uiAmount: '1500',
            iconUrl: '',
          },
        ];

        // New assets after a TRC20 transaction (both consumed)
        const updatedAssets: AssetEntity[] = [
          {
            assetType: KnownCaip19Id.TrxMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'TRX',
            decimals: 6,
            rawAmount: '2000000',
            uiAmount: '2',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.EnergyMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'ENERGY',
            decimals: 0,
            rawAmount: '45000', // Consumed by smart contract call
            uiAmount: '45000',
            iconUrl: '',
          },
          {
            assetType: KnownCaip19Id.BandwidthMainnet,
            keyringAccountId: mockAccount.id,
            network: Network.Mainnet,
            symbol: 'BANDWIDTH',
            decimals: 0,
            rawAmount: '1235', // Consumed by transaction size
            uiAmount: '1235',
            iconUrl: '',
          },
        ];

        // Mock state to return previously saved assets
        mockState.getKey.mockResolvedValue({
          [mockAccount.id]: savedAssets,
        });

        // Act: Save updated assets
        await assetsService.saveMany(updatedAssets);

        // Assert: Both should remain in the asset list
        expect(emitSnapKeyringEvent).toHaveBeenCalledWith(
          expect.anything(),
          KeyringEvent.AccountAssetListUpdated,
          {
            assets: {
              [mockAccount.id]: {
                added: expect.arrayContaining([
                  KnownCaip19Id.TrxMainnet,
                  KnownCaip19Id.EnergyMainnet,
                  KnownCaip19Id.BandwidthMainnet,
                ]),
                removed: [],
              },
            },
          },
        );

        // Assert: Balance update event should reflect new amounts
        expect(emitSnapKeyringEvent).toHaveBeenCalledWith(
          expect.anything(),
          KeyringEvent.AccountBalancesUpdated,
          {
            balances: {
              [mockAccount.id]: {
                [KnownCaip19Id.TrxMainnet]: {
                  unit: 'TRX',
                  amount: '2',
                },
                [KnownCaip19Id.EnergyMainnet]: {
                  unit: 'ENERGY',
                  amount: '45000',
                },
                [KnownCaip19Id.BandwidthMainnet]: {
                  unit: 'BANDWIDTH',
                  amount: '1235',
                },
              },
            },
          },
        );
      });
    });
  });

  describe('fetchAssetsAndBalancesForAccount', () => {
    describe('bandwidth', () => {
      it('returns 0 when account has no resources', async () => {
        mockTrongridApiClient.getAccountInfoByAddress.mockResolvedValue(
          minimalTronAccount,
        );
        mockTokenApiClient.getTokensMetadata.mockResolvedValue({});
        mockPriceApiClient.getMultipleSpotPrices.mockResolvedValue({});
        mockTronHttpClient.getAccountResources.mockResolvedValue({});

        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        expect(
          findAsset(assets, KnownCaip19Id.BandwidthMainnet)?.rawAmount,
        ).toBe('0');
      });

      it('returns remaining free bandwidth when no staking', async () => {
        mockTrongridApiClient.getAccountInfoByAddress.mockResolvedValue(
          minimalTronAccount,
        );
        mockTokenApiClient.getTokensMetadata.mockResolvedValue({});
        mockPriceApiClient.getMultipleSpotPrices.mockResolvedValue({});
        mockTronHttpClient.getAccountResources.mockResolvedValue(
          getMockAccountResources({ freeNetUsed: 200 }),
        );

        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        expect(
          findAsset(assets, KnownCaip19Id.BandwidthMainnet)?.rawAmount,
        ).toBe('400');
      });

      it('returns combined remaining free + staked bandwidth', async () => {
        mockTrongridApiClient.getAccountInfoByAddress.mockResolvedValue(
          minimalTronAccount,
        );
        mockTokenApiClient.getTokensMetadata.mockResolvedValue({});
        mockPriceApiClient.getMultipleSpotPrices.mockResolvedValue({});
        mockTronHttpClient.getAccountResources.mockResolvedValue(
          getMockAccountResources({ freeNetUsed: 326, NetLimit: 16 }),
        );

        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        expect(
          findAsset(assets, KnownCaip19Id.BandwidthMainnet)?.rawAmount,
        ).toBe('290');
      });

      it('clamps to 0 when used exceeds maximum', async () => {
        mockTrongridApiClient.getAccountInfoByAddress.mockResolvedValue(
          minimalTronAccount,
        );
        mockTokenApiClient.getTokensMetadata.mockResolvedValue({});
        mockPriceApiClient.getMultipleSpotPrices.mockResolvedValue({});
        mockTronHttpClient.getAccountResources.mockResolvedValue(
          getMockAccountResources({
            freeNetUsed: 600,
            NetUsed: 50,
            NetLimit: 16,
          }),
        );

        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        expect(
          findAsset(assets, KnownCaip19Id.BandwidthMainnet)?.rawAmount,
        ).toBe('0');
      });
    });

    describe('maximum bandwidth', () => {
      it('returns 0 when account has no resources', async () => {
        mockTrongridApiClient.getAccountInfoByAddress.mockResolvedValue(
          minimalTronAccount,
        );
        mockTokenApiClient.getTokensMetadata.mockResolvedValue({});
        mockPriceApiClient.getMultipleSpotPrices.mockResolvedValue({});
        mockTronHttpClient.getAccountResources.mockResolvedValue({});

        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        expect(
          findAsset(assets, KnownCaip19Id.MaximumBandwidthMainnet)?.rawAmount,
        ).toBe('0');
      });

      it('returns only free bandwidth limit when no staking', async () => {
        mockTrongridApiClient.getAccountInfoByAddress.mockResolvedValue(
          minimalTronAccount,
        );
        mockTokenApiClient.getTokensMetadata.mockResolvedValue({});
        mockPriceApiClient.getMultipleSpotPrices.mockResolvedValue({});
        mockTronHttpClient.getAccountResources.mockResolvedValue(
          getMockAccountResources({}),
        );

        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        expect(
          findAsset(assets, KnownCaip19Id.MaximumBandwidthMainnet)?.rawAmount,
        ).toBe('600');
      });

      it('returns free + staked bandwidth limit', async () => {
        mockTrongridApiClient.getAccountInfoByAddress.mockResolvedValue(
          minimalTronAccount,
        );
        mockTokenApiClient.getTokensMetadata.mockResolvedValue({});
        mockPriceApiClient.getMultipleSpotPrices.mockResolvedValue({});
        mockTronHttpClient.getAccountResources.mockResolvedValue(
          getMockAccountResources({ NetLimit: 48 }),
        );

        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        expect(
          findAsset(assets, KnownCaip19Id.MaximumBandwidthMainnet)?.rawAmount,
        ).toBe('648');
      });
    });

    describe('energy', () => {
      it('returns 0 when account has no resources', async () => {
        mockTrongridApiClient.getAccountInfoByAddress.mockResolvedValue(
          minimalTronAccount,
        );
        mockTokenApiClient.getTokensMetadata.mockResolvedValue({});
        mockPriceApiClient.getMultipleSpotPrices.mockResolvedValue({});
        mockTronHttpClient.getAccountResources.mockResolvedValue({});

        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        expect(findAsset(assets, KnownCaip19Id.EnergyMainnet)?.rawAmount).toBe(
          '0',
        );
      });

      it('returns full energy when none consumed', async () => {
        mockTrongridApiClient.getAccountInfoByAddress.mockResolvedValue(
          minimalTronAccount,
        );
        mockTokenApiClient.getTokensMetadata.mockResolvedValue({});
        mockPriceApiClient.getMultipleSpotPrices.mockResolvedValue({});
        mockTronHttpClient.getAccountResources.mockResolvedValue(
          getMockAccountResources({ EnergyLimit: 329 }),
        );

        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        expect(findAsset(assets, KnownCaip19Id.EnergyMainnet)?.rawAmount).toBe(
          '329',
        );
      });

      it('returns remaining energy after partial consumption', async () => {
        mockTrongridApiClient.getAccountInfoByAddress.mockResolvedValue(
          minimalTronAccount,
        );
        mockTokenApiClient.getTokensMetadata.mockResolvedValue({});
        mockPriceApiClient.getMultipleSpotPrices.mockResolvedValue({});
        mockTronHttpClient.getAccountResources.mockResolvedValue(
          getMockAccountResources({ EnergyLimit: 5000, EnergyUsed: 4383 }),
        );

        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        expect(findAsset(assets, KnownCaip19Id.EnergyMainnet)?.rawAmount).toBe(
          '617',
        );
      });

      it('clamps to 0 when EnergyUsed exceeds EnergyLimit from leasing', async () => {
        mockTrongridApiClient.getAccountInfoByAddress.mockResolvedValue(
          minimalTronAccount,
        );
        mockTokenApiClient.getTokensMetadata.mockResolvedValue({});
        mockPriceApiClient.getMultipleSpotPrices.mockResolvedValue({});
        mockTronHttpClient.getAccountResources.mockResolvedValue(
          getMockAccountResources({ EnergyLimit: 46, EnergyUsed: 6511 }),
        );

        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        expect(findAsset(assets, KnownCaip19Id.EnergyMainnet)?.rawAmount).toBe(
          '0',
        );
      });
    });

    describe('maximum energy', () => {
      it('returns 0 when account has no resources', async () => {
        mockTrongridApiClient.getAccountInfoByAddress.mockResolvedValue(
          minimalTronAccount,
        );
        mockTokenApiClient.getTokensMetadata.mockResolvedValue({});
        mockPriceApiClient.getMultipleSpotPrices.mockResolvedValue({});
        mockTronHttpClient.getAccountResources.mockResolvedValue({});

        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        expect(
          findAsset(assets, KnownCaip19Id.MaximumEnergyMainnet)?.rawAmount,
        ).toBe('0');
      });

      it('returns EnergyLimit from staking', async () => {
        mockTrongridApiClient.getAccountInfoByAddress.mockResolvedValue(
          minimalTronAccount,
        );
        mockTokenApiClient.getTokensMetadata.mockResolvedValue({});
        mockPriceApiClient.getMultipleSpotPrices.mockResolvedValue({});
        mockTronHttpClient.getAccountResources.mockResolvedValue(
          getMockAccountResources({ EnergyLimit: 329 }),
        );

        const assets = await assetsService.fetchAssetsAndBalancesForAccount(
          Network.Mainnet,
          mockAccount,
        );

        expect(
          findAsset(assets, KnownCaip19Id.MaximumEnergyMainnet)?.rawAmount,
        ).toBe('329');
      });
    });
  });
});
