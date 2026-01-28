import { TrongridApiClient } from './TrongridApiClient';
import type { ICache } from '../../caching/ICache';
import { Network } from '../../constants';
import type { ConfigProvider } from '../../services/config';
import type { Serializable } from '../../utils/serialization/types';
import type { TronHttpClient } from '../tron-http/TronHttpClient';
import type { ChainParameter } from '../tron-http/types';

describe('TrongridApiClient', () => {
  let trongridApiClient: TrongridApiClient;
  let mockTronHttpClient: jest.Mocked<TronHttpClient>;
  let mockCache: jest.Mocked<ICache<Serializable>>;
  let mockConfigProvider: ConfigProvider;

  const defaultMaintenanceInterval = 6 * 60 * 60 * 1000; // 6 hours in ms

  // Use a time that's exactly on a 6-hour boundary for simpler test calculations
  // This is midnight UTC: 1700006400000 = Nov 15, 2023 00:00:00 UTC
  const midnightUtc = 1700006400000;

  beforeEach(() => {
    jest.useFakeTimers();

    mockTronHttpClient = {
      getChainParameters: jest.fn(),
      getNextMaintenanceTime: jest.fn(),
    } as unknown as jest.Mocked<TronHttpClient>;

    mockCache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ICache<Serializable>>;

    mockConfigProvider = {
      get: jest.fn().mockReturnValue({
        trongridApi: {
          baseUrls: {
            [Network.Mainnet]: 'https://api.trongrid.io',
            [Network.Shasta]: 'https://api.shasta.trongrid.io',
          },
        },
      }),
    } as unknown as ConfigProvider;

    trongridApiClient = new TrongridApiClient({
      configProvider: mockConfigProvider,
      tronHttpClient: mockTronHttpClient,
      cache: mockCache,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getChainParameters', () => {
    const mockChainParameters: ChainParameter[] = [
      { key: 'getMaintenanceTimeInterval', value: defaultMaintenanceInterval },
      { key: 'getTransactionFee', value: 1000 },
      { key: 'getEnergyFee', value: 420 },
    ];

    describe('caching behavior', () => {
      it('does NOT call getNextMaintenanceTime - calculates from interval instead', async () => {
        jest.setSystemTime(midnightUtc);
        mockTronHttpClient.getChainParameters.mockResolvedValue(
          mockChainParameters,
        );

        await trongridApiClient.getChainParameters(Network.Mainnet);

        // This is the key assertion - we no longer need a separate API call
        expect(
          mockTronHttpClient.getNextMaintenanceTime,
        ).not.toHaveBeenCalled();
      });

      it('calculates TTL to align with next maintenance window boundary', async () => {
        // Set time to 30 minutes after midnight (00:30 UTC)
        const thirtyMinutesAfterMidnight = midnightUtc + 30 * 60 * 1000;
        jest.setSystemTime(thirtyMinutesAfterMidnight);

        mockTronHttpClient.getChainParameters.mockResolvedValue(
          mockChainParameters,
        );

        await trongridApiClient.getChainParameters(Network.Mainnet);

        // Next maintenance is at 06:00 UTC (6 hours after midnight)
        // TTL should be 5.5 hours (6:00 - 0:30 = 5h 30m = 19800000ms)
        const expectedTtl = 5 * 60 * 60 * 1000 + 30 * 60 * 1000; // 5h 30m

        expect(mockCache.set).toHaveBeenCalledWith(
          expect.stringContaining('TrongridApiClient:getChainParameters:'),
          mockChainParameters,
          expectedTtl,
        );
      });

      it('calculates TTL correctly when fetched just before maintenance window', async () => {
        // Set time to 5:30 UTC (30 minutes before 6:00 maintenance)
        const fiveThirtyUtc = midnightUtc + 5 * 60 * 60 * 1000 + 30 * 60 * 1000;
        jest.setSystemTime(fiveThirtyUtc);

        mockTronHttpClient.getChainParameters.mockResolvedValue(
          mockChainParameters,
        );

        await trongridApiClient.getChainParameters(Network.Mainnet);

        // Next maintenance is at 06:00 UTC
        // TTL should be 30 minutes (6:00 - 5:30 = 30m = 1800000ms)
        const expectedTtl = 30 * 60 * 1000; // 30 minutes

        expect(mockCache.set).toHaveBeenCalledWith(
          expect.stringContaining('TrongridApiClient:getChainParameters:'),
          mockChainParameters,
          expectedTtl,
        );
      });

      it('calculates TTL correctly when fetched just after maintenance window', async () => {
        // Set time to 6:05 UTC (5 minutes after 6:00 maintenance)
        const sixOhFiveUtc = midnightUtc + 6 * 60 * 60 * 1000 + 5 * 60 * 1000;
        jest.setSystemTime(sixOhFiveUtc);

        mockTronHttpClient.getChainParameters.mockResolvedValue(
          mockChainParameters,
        );

        await trongridApiClient.getChainParameters(Network.Mainnet);

        // Next maintenance is at 12:00 UTC
        // TTL should be 5h 55m (12:00 - 6:05 = 5h 55m = 21300000ms)
        const expectedTtl = 5 * 60 * 60 * 1000 + 55 * 60 * 1000; // 5h 55m

        expect(mockCache.set).toHaveBeenCalledWith(
          expect.stringContaining('TrongridApiClient:getChainParameters:'),
          mockChainParameters,
          expectedTtl,
        );
      });

      it('calculates TTL correctly when fetched exactly at maintenance window', async () => {
        // Set time to exactly 6:00 UTC (on the maintenance boundary)
        const sixUtc = midnightUtc + 6 * 60 * 60 * 1000;
        jest.setSystemTime(sixUtc);

        mockTronHttpClient.getChainParameters.mockResolvedValue(
          mockChainParameters,
        );

        await trongridApiClient.getChainParameters(Network.Mainnet);

        // When exactly on a boundary, next maintenance is the NEXT boundary (12:00 UTC)
        // TTL should be exactly 6 hours
        expect(mockCache.set).toHaveBeenCalledWith(
          expect.stringContaining('TrongridApiClient:getChainParameters:'),
          mockChainParameters,
          defaultMaintenanceInterval,
        );
      });

      it('returns cached data on subsequent calls within expiry window', async () => {
        jest.setSystemTime(midnightUtc);
        mockTronHttpClient.getChainParameters.mockResolvedValue(
          mockChainParameters,
        );

        // First call - populates cache
        await trongridApiClient.getChainParameters(Network.Mainnet);

        // Reset mocks and setup cache hit
        mockTronHttpClient.getChainParameters.mockClear();
        mockCache.get.mockResolvedValue(mockChainParameters);

        // Second call - should use cache
        const result = await trongridApiClient.getChainParameters(
          Network.Mainnet,
        );

        expect(result).toStrictEqual(mockChainParameters);
        expect(mockTronHttpClient.getChainParameters).not.toHaveBeenCalled();
      });

      it('refetches data after cache expiry (maintenance window passed)', async () => {
        jest.setSystemTime(midnightUtc);
        mockTronHttpClient.getChainParameters.mockResolvedValue(
          mockChainParameters,
        );

        // First call at midnight - expires at 06:00
        await trongridApiClient.getChainParameters(Network.Mainnet);

        // Advance time past the 06:00 maintenance window
        jest.setSystemTime(midnightUtc + 6 * 60 * 60 * 1000 + 1000);

        // Reset and prepare for second call
        mockTronHttpClient.getChainParameters.mockClear();
        const updatedParams: ChainParameter[] = [
          ...mockChainParameters,
          { key: 'getNewParam', value: 999 },
        ];
        mockTronHttpClient.getChainParameters.mockResolvedValue(updatedParams);

        const result = await trongridApiClient.getChainParameters(
          Network.Mainnet,
        );

        expect(result).toStrictEqual(updatedParams);
        expect(mockTronHttpClient.getChainParameters).toHaveBeenCalledTimes(1);
      });

      it('uses custom maintenance interval when provided in response', async () => {
        // Set time to 1 hour after midnight
        const oneHourAfterMidnight = midnightUtc + 60 * 60 * 1000;
        jest.setSystemTime(oneHourAfterMidnight);

        const customInterval = 4 * 60 * 60 * 1000; // 4 hours
        const customParams: ChainParameter[] = [
          { key: 'getMaintenanceTimeInterval', value: customInterval },
          { key: 'getTransactionFee', value: 1000 },
        ];

        mockTronHttpClient.getChainParameters.mockResolvedValue(customParams);

        await trongridApiClient.getChainParameters(Network.Mainnet);

        // With 4-hour interval, next maintenance is at 04:00 UTC
        // TTL should be 3 hours (04:00 - 01:00 = 3h)
        const expectedTtl = 3 * 60 * 60 * 1000;

        expect(mockCache.set).toHaveBeenCalledWith(
          expect.stringContaining('TrongridApiClient:getChainParameters:'),
          customParams,
          expectedTtl,
        );
      });

      it('uses default 6-hour interval when getMaintenanceTimeInterval is missing', async () => {
        // Set time to 30 minutes after midnight
        const thirtyMinutesAfterMidnight = midnightUtc + 30 * 60 * 1000;
        jest.setSystemTime(thirtyMinutesAfterMidnight);

        const paramsWithoutInterval: ChainParameter[] = [
          { key: 'getTransactionFee', value: 1000 },
          { key: 'getEnergyFee', value: 420 },
        ];

        mockTronHttpClient.getChainParameters.mockResolvedValue(
          paramsWithoutInterval,
        );

        await trongridApiClient.getChainParameters(Network.Mainnet);

        // Falls back to 6-hour interval, next maintenance at 06:00
        // TTL should be 5h 30m
        const expectedTtl = 5 * 60 * 60 * 1000 + 30 * 60 * 1000;

        expect(mockCache.set).toHaveBeenCalledWith(
          expect.stringContaining('TrongridApiClient:getChainParameters:'),
          paramsWithoutInterval,
          expectedTtl,
        );
      });

      it('caches separately for different networks', async () => {
        jest.setSystemTime(midnightUtc);
        mockTronHttpClient.getChainParameters.mockResolvedValue(
          mockChainParameters,
        );

        await trongridApiClient.getChainParameters(Network.Mainnet);
        await trongridApiClient.getChainParameters(Network.Shasta);

        expect(mockTronHttpClient.getChainParameters).toHaveBeenCalledTimes(2);

        // Check that set was called twice with different network identifiers
        expect(mockCache.set).toHaveBeenCalledTimes(2);

        // Get the cache keys used
        const cacheKeys = (mockCache.set as jest.Mock).mock.calls.map(
          (call) => call[0],
        );
        expect(cacheKeys[0]).toContain(Network.Mainnet);
        expect(cacheKeys[1]).toContain(Network.Shasta);
      });
    });

    describe('error handling', () => {
      it('propagates errors from TronHttpClient', async () => {
        jest.setSystemTime(midnightUtc);
        const error = new Error('Network error');
        mockTronHttpClient.getChainParameters.mockRejectedValue(error);

        await expect(
          trongridApiClient.getChainParameters(Network.Mainnet),
        ).rejects.toThrow('Network error');
      });
    });
  });
});
