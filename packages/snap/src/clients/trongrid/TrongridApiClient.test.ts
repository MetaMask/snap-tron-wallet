import { TrongridApiClient } from './TrongridApiClient';
import type { Trc20Balance } from './types';
import type { ICache } from '../../caching/ICache';
import { InMemoryCache } from '../../caching/InMemoryCache';
import { Network } from '../../constants';
import { ConfigProvider } from '../../services/config';
import { mockLogger } from '../../utils/mockLogger';
import type { Serializable } from '../../utils/serialization/types';
import { TronHttpClient } from '../tron-http/TronHttpClient';

/**
 * Builds a TrongridApiClient with default dependencies.
 * Each call creates fresh instances to keep tests isolated.
 *
 * @param overrides - Optional overrides for the config provider base URLs.
 * @param overrides.trongridBaseUrls - Custom TronGrid API base URLs by network.
 * @param overrides.tronHttpBaseUrls - Custom Tron HTTP API base URLs by network.
 * @returns The client and its dependencies.
 */
function buildTrongridApiClient(
  overrides: {
    trongridBaseUrls?: Record<string, string>;
    tronHttpBaseUrls?: Record<string, string>;
  } = {},
): {
  client: TrongridApiClient;
  configProvider: ConfigProvider;
  tronHttpClient: TronHttpClient;
  cache: ICache<Serializable>;
} {
  const defaultBaseUrls = {
    [Network.Mainnet]: 'https://api.trongrid.io',
    [Network.Nile]: 'https://nile.trongrid.io',
    [Network.Shasta]: 'https://api.shasta.trongrid.io',
  };

  const configProvider = new ConfigProvider();
  const baseConfig = configProvider.get();
  jest.spyOn(configProvider, 'get').mockReturnValue({
    ...baseConfig,
    trongridApi: {
      baseUrls: overrides.trongridBaseUrls ?? defaultBaseUrls,
    },
    tronHttpApi: {
      baseUrls: overrides.tronHttpBaseUrls ?? defaultBaseUrls,
    },
  });

  const tronHttpClient = new TronHttpClient({
    configProvider,
  });

  const cache = new InMemoryCache(mockLogger);

  const client = new TrongridApiClient({
    configProvider,
    tronHttpClient,
    cache,
  });

  return { client, configProvider, tronHttpClient, cache };
}

/**
 * Wraps a test function that needs to mock `global.fetch`,
 * ensuring the original fetch is restored after the test completes.
 *
 * @param testFn - The async test body to execute.
 */
async function withFetch(testFn: () => Promise<void>): Promise<void> {
  // eslint-disable-next-line no-restricted-globals
  const originalFetch = global.fetch;
  try {
    await testFn();
  } finally {
    // eslint-disable-next-line no-restricted-globals
    global.fetch = originalFetch;
  }
}

describe('TrongridApiClient', () => {
  describe('getTrc20BalancesByAddress', () => {
    const mockAddress = 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx';
    const normalizeBalances = (balances: Trc20Balance[]): Trc20Balance[] =>
      balances.map((balance) => ({ ...balance }));

    it('fetches and returns TRC20 balances for an address', async () => {
      await withFetch(async () => {
        const { client } = buildTrongridApiClient();
        const mockTrc20Balances: Trc20Balance[] = [
          { TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: '24249143' },
          { TGPuQ7g7H8GsUEXhwvvJop4zCncurEh2ht: '88123456' },
        ];

        // eslint-disable-next-line no-restricted-globals
        jest.spyOn(global, 'fetch').mockResolvedValueOnce(
          // eslint-disable-next-line no-restricted-globals
          new Response(
            JSON.stringify({
              data: mockTrc20Balances,
              success: true,
              // eslint-disable-next-line @typescript-eslint/naming-convention
              meta: { at: 1770121997373, page_size: 4 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );

        const result = await client.getTrc20BalancesByAddress(
          Network.Mainnet,
          mockAddress,
        );

        expect(normalizeBalances(result)).toStrictEqual(mockTrc20Balances);
        // eslint-disable-next-line no-restricted-globals
        expect(global.fetch).toHaveBeenCalledWith(
          `https://api.trongrid.io/v1/accounts/${mockAddress}/trc20/balance`,
          expect.objectContaining({
            headers: expect.objectContaining({
              'Content-Type': 'application/json',
            }),
          }),
        );
      });
    });

    it('returns empty array when no TRC20 tokens are found', async () => {
      await withFetch(async () => {
        const { client } = buildTrongridApiClient();

        // eslint-disable-next-line no-restricted-globals
        jest.spyOn(global, 'fetch').mockResolvedValueOnce(
          // eslint-disable-next-line no-restricted-globals
          new Response(
            JSON.stringify({
              data: [],
              success: true,
              // eslint-disable-next-line @typescript-eslint/naming-convention
              meta: { at: 1770121997373, page_size: 0 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );

        const result = await client.getTrc20BalancesByAddress(
          Network.Mainnet,
          mockAddress,
        );

        expect(result).toStrictEqual([]);
      });
    });

    it('returns empty array when data is undefined', async () => {
      await withFetch(async () => {
        const { client } = buildTrongridApiClient();

        // eslint-disable-next-line no-restricted-globals
        jest.spyOn(global, 'fetch').mockResolvedValueOnce(
          // eslint-disable-next-line no-restricted-globals
          new Response(
            JSON.stringify({
              success: true,
              // eslint-disable-next-line @typescript-eslint/naming-convention
              meta: { at: 1770121997373, page_size: 0 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );

        const result = await client.getTrc20BalancesByAddress(
          Network.Mainnet,
          mockAddress,
        );

        expect(result).toStrictEqual([]);
      });
    });

    it('throws error when network base URL is invalid', async () => {
      const invalidBaseUrls = {
        [Network.Mainnet]: 'https://api.trongrid.io',
        [Network.Nile]: '',
        [Network.Shasta]: '',
      };
      const { client } = buildTrongridApiClient({
        trongridBaseUrls: invalidBaseUrls,
        tronHttpBaseUrls: invalidBaseUrls,
      });

      await expect(
        client.getTrc20BalancesByAddress(Network.Nile, mockAddress),
      ).rejects.toThrow('Invalid URL format');
    });

    it('throws error when HTTP request fails', async () => {
      await withFetch(async () => {
        const { client } = buildTrongridApiClient();

        // eslint-disable-next-line no-restricted-globals
        jest.spyOn(global, 'fetch').mockResolvedValueOnce(
          // eslint-disable-next-line no-restricted-globals
          new Response('', { status: 500 }),
        );

        await expect(
          client.getTrc20BalancesByAddress(Network.Mainnet, mockAddress),
        ).rejects.toThrow('HTTP error! status: 500');
      });
    });

    it('throws error when API returns success: false', async () => {
      await withFetch(async () => {
        const { client } = buildTrongridApiClient();

        // eslint-disable-next-line no-restricted-globals
        jest.spyOn(global, 'fetch').mockResolvedValueOnce(
          // eslint-disable-next-line no-restricted-globals
          new Response(
            JSON.stringify({
              data: [],
              success: false,
              // eslint-disable-next-line @typescript-eslint/naming-convention
              meta: { at: 1770121997373, page_size: 0 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );

        await expect(
          client.getTrc20BalancesByAddress(Network.Mainnet, mockAddress),
        ).rejects.toThrow('API request failed');
      });
    });

    it('works with different networks', async () => {
      await withFetch(async () => {
        const { client } = buildTrongridApiClient();
        const mockTrc20Balances: Trc20Balance[] = [
          { TTestToken123: '1000000' },
        ];

        // eslint-disable-next-line no-restricted-globals
        jest.spyOn(global, 'fetch').mockResolvedValueOnce(
          // eslint-disable-next-line no-restricted-globals
          new Response(
            JSON.stringify({
              data: mockTrc20Balances,
              success: true,
              // eslint-disable-next-line @typescript-eslint/naming-convention
              meta: { at: 1770121997373, page_size: 1 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );

        const result = await client.getTrc20BalancesByAddress(
          Network.Nile,
          mockAddress,
        );

        expect(normalizeBalances(result)).toStrictEqual(mockTrc20Balances);
        // eslint-disable-next-line no-restricted-globals
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('nile.trongrid.io'),
          expect.any(Object),
        );
      });
    });

    it('validates TRC20 balance data structure', async () => {
      await withFetch(async () => {
        const { client } = buildTrongridApiClient();
        const validBalances: Trc20Balance[] = [
          { TokenAddress1: '100' },
          { TokenAddress2: '200' },
        ];

        // eslint-disable-next-line no-restricted-globals
        jest.spyOn(global, 'fetch').mockResolvedValueOnce(
          // eslint-disable-next-line no-restricted-globals
          new Response(
            JSON.stringify({
              data: validBalances,
              success: true,
              // eslint-disable-next-line @typescript-eslint/naming-convention
              meta: { at: 1770121997373, page_size: 2 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );

        const result = await client.getTrc20BalancesByAddress(
          Network.Mainnet,
          mockAddress,
        );

        expect(result).toHaveLength(2);
        const normalizedBalances = normalizeBalances(result);
        expect(normalizedBalances[0]).toStrictEqual({ TokenAddress1: '100' });
        expect(normalizedBalances[1]).toStrictEqual({ TokenAddress2: '200' });
      });
    });
  });
});
