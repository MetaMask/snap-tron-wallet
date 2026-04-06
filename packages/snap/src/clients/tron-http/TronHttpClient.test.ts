/* eslint-disable @typescript-eslint/naming-convention */
import { TronHttpClient } from './TronHttpClient';
import { Network } from '../../constants';
import modernInternalTransactionMock from './mocks/transaction-info-with-modern-internals.json';
import { ConfigProvider } from '../../services/config';

describe('TronHttpClient', () => {
  /**
   * Creates a fresh client for each test and restores `fetch` afterward.
   *
   * @param testFunction - The test logic to execute with the client.
   * @returns The callback return value.
   */
  async function withTronHttpClient<ReturnValue>(
    testFunction: (
      client: TronHttpClient,
    ) => Promise<ReturnValue> | ReturnValue,
  ): Promise<ReturnValue> {
    const configProvider = new ConfigProvider();
    const baseConfig = configProvider.get();
    jest.spyOn(configProvider, 'get').mockReturnValue({
      ...baseConfig,
      tronHttpApi: {
        baseUrls: {
          [Network.Mainnet]: 'https://api.trongrid.io',
          [Network.Nile]: 'https://nile.trongrid.io',
          [Network.Shasta]: 'https://api.shasta.trongrid.io',
        },
      },
    });

    const client = new TronHttpClient({ configProvider });

    // eslint-disable-next-line no-restricted-globals
    const originalFetch = global.fetch;
    try {
      return await testFunction(client);
    } finally {
      // eslint-disable-next-line no-restricted-globals
      global.fetch = originalFetch;
    }
  }

  describe('getTransactionInfoById', () => {
    const txId =
      'fb1ba8f053951758ab23d3b636503e30b501ab7e9373cdb28b19d23a6d64fbf4';

    it('accepts modern internal_transactions shape from Full Node', async () => {
      await withTronHttpClient(async (client) => {
        // eslint-disable-next-line no-restricted-globals
        jest.spyOn(global, 'fetch').mockResolvedValueOnce(
          // eslint-disable-next-line no-restricted-globals
          new Response(JSON.stringify(modernInternalTransactionMock), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

        const result = await client.getTransactionInfoById(
          Network.Mainnet,
          txId,
        );

        expect(result).toMatchObject(modernInternalTransactionMock);
      });
    });

    it('rejects legacy internal_transactions shape from Full Node', async () => {
      await withTronHttpClient(async (client) => {
        const txWithLegacyInternalTransactions = {
          ...modernInternalTransactionMock,

          internal_transactions: [
            {
              internal_tx_id:
                'f713a395530df07b65d339d17933f0c0a4636a2b1abc4a569fb25d8c7e79e3f4',
              from_address: '4172db65b2e023e4783d46023e7135c692e527f6cb',
              to_address: '41891cdb91d149f23b1a45d9c5ca78a88d0cb44c18',
              data: {
                note: '63616c6c',
                rejected: true,
                call_value: {
                  _: 6357085,
                },
              },
            },
          ],
        };

        // eslint-disable-next-line no-restricted-globals
        jest.spyOn(global, 'fetch').mockResolvedValueOnce(
          // eslint-disable-next-line no-restricted-globals
          new Response(JSON.stringify(txWithLegacyInternalTransactions), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

        await expect(
          client.getTransactionInfoById(Network.Mainnet, txId),
        ).rejects.toThrow('Expected a value of type');
      });
    });
  });
});
