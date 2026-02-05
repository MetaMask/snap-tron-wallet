import { TrongridApiClient } from './TrongridApiClient';
import type { Trc20Balance } from './types';
import type { ICache } from '../../caching/ICache';
import { InMemoryCache } from '../../caching/InMemoryCache';
import { Network } from '../../constants';
import { ConfigProvider } from '../../services/config';
import { mockLogger } from '../../utils/mockLogger';
import type { Serializable } from '../../utils/serialization/types';
import { TronHttpClient } from '../tron-http/TronHttpClient';

describe('TrongridApiClient', () => {
  let client: TrongridApiClient;
  let mockConfigProvider: ConfigProvider;
  let mockTronHttpClient: TronHttpClient;
  let mockCache: ICache<Serializable>;

  // eslint-disable-next-line no-restricted-globals
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfigProvider = new ConfigProvider();
    const baseConfig = mockConfigProvider.get();
    jest.spyOn(mockConfigProvider, 'get').mockReturnValue({
      ...baseConfig,
      trongridApi: {
        baseUrls: {
          [Network.Mainnet]: 'https://api.trongrid.io',
          [Network.Nile]: 'https://nile.trongrid.io',
          [Network.Shasta]: 'https://api.shasta.trongrid.io',
        },
      },
      tronHttpApi: {
        baseUrls: {
          [Network.Mainnet]: 'https://api.trongrid.io',
          [Network.Nile]: 'https://nile.trongrid.io',
          [Network.Shasta]: 'https://api.shasta.trongrid.io',
        },
      },
    });

    mockTronHttpClient = new TronHttpClient({
      configProvider: mockConfigProvider,
    });

    mockCache = new InMemoryCache(mockLogger);

    client = new TrongridApiClient({
      configProvider: mockConfigProvider,
      tronHttpClient: mockTronHttpClient,
      cache: mockCache,
    });
  });

  afterEach(() => {
    // eslint-disable-next-line no-restricted-globals
    global.fetch = originalFetch;
  });

  describe('getTrc20BalancesByAddress', () => {
    const mockAddress = 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx';
    const normalizeBalances = (balances: Trc20Balance[]): Trc20Balance[] =>
      balances.map((balance) => ({ ...balance }));

    it('fetches and returns TRC20 balances for an address', async () => {
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

    it('returns empty array when no TRC20 tokens are found', async () => {
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

    it('returns empty array when data is undefined', async () => {
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

    it('throws error when network base URL is invalid', async () => {
      // Create a client with invalid testnet base URLs
      const limitedConfigProvider = new ConfigProvider();
      const limitedBaseConfig = limitedConfigProvider.get();
      jest.spyOn(limitedConfigProvider, 'get').mockReturnValue({
        ...limitedBaseConfig,
        trongridApi: {
          baseUrls: {
            [Network.Mainnet]: 'https://api.trongrid.io',
            [Network.Nile]: '',
            [Network.Shasta]: '',
          },
        },
        tronHttpApi: {
          baseUrls: {
            [Network.Mainnet]: 'https://api.trongrid.io',
            [Network.Nile]: '',
            [Network.Shasta]: '',
          },
        },
      });

      const limitedClient = new TrongridApiClient({
        configProvider: limitedConfigProvider,
        tronHttpClient: mockTronHttpClient,
        cache: mockCache,
      });

      await expect(
        limitedClient.getTrc20BalancesByAddress(Network.Nile, mockAddress),
      ).rejects.toThrow('Invalid URL format');
    });

    it('throws error when HTTP request fails', async () => {
      // eslint-disable-next-line no-restricted-globals
      jest.spyOn(global, 'fetch').mockResolvedValueOnce(
        // eslint-disable-next-line no-restricted-globals
        new Response('', { status: 500 }),
      );

      await expect(
        client.getTrc20BalancesByAddress(Network.Mainnet, mockAddress),
      ).rejects.toThrow('HTTP error! status: 500');
    });

    it('throws error when API returns success: false', async () => {
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

    it('works with different networks', async () => {
      const mockTrc20Balances: Trc20Balance[] = [{ TTestToken123: '1000000' }];

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

    it('validates TRC20 balance data structure', async () => {
      // Valid structure: array of Record<string, string>
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
