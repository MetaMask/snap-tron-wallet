// eslint-disable-next-line import-x/no-nodejs-modules
import http from 'node:http';

export const E2E_API_HOST = '127.0.0.1';
export const E2E_API_PORT = 8899;
export const E2E_API_BASE_URL = `http://${E2E_API_HOST}:${E2E_API_PORT}`;

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type RequestRecorder = {
  spotPrices: { assetIds: string | null; vsCurrency: string | null }[];
  accountInfo: string[];
  scans: Record<string, JsonValue>[];
  broadcasts: Record<string, JsonValue>[];
  walletCalls: { method: string; body: Record<string, JsonValue> }[];
  fiatExchangeRates: number;
  unhandled: string[];
};

export type MockApiServer = {
  requests: RequestRecorder;
  close: () => Promise<void>;
};

type StartMockApiServerOptions = {
  spotPricesResponse: JsonValue;
  scanResponse: JsonValue;
  accountInfoResponse: (address: string) => JsonValue;
  broadcastResponse?: JsonValue;
  walletCallResponse?: (
    method: string,
    body: Record<string, JsonValue>,
  ) => JsonValue;
  fiatExchangeRatesResponse?: JsonValue;
  accountResourceResponse?: (address: string) => JsonValue;
};

/**
 * Sends a JSON response with the given status code and body.
 *
 * @param response - The HTTP server response object.
 * @param statusCode - The HTTP status code to send.
 * @param body - The JSON value to serialize as the response body.
 */
function sendJson(
  response: http.ServerResponse,
  statusCode: number,
  body: JsonValue,
): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(body));
}

/**
 * Reads and parses the JSON body from an incoming HTTP request.
 *
 * @param request - The incoming HTTP request.
 * @returns The parsed JSON body as a plain object, or an empty object if the body is empty.
 */
async function readJsonBody(
  request: http.IncomingMessage,
): Promise<Record<string, JsonValue>> {
  // eslint-disable-next-line no-restricted-globals
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    // eslint-disable-next-line no-restricted-globals
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  // eslint-disable-next-line no-restricted-globals
  const body = Buffer.concat(chunks).toString('utf8');
  return body ? (JSON.parse(body) as Record<string, JsonValue>) : {};
}

const WALLET_RPC_METHODS = new Set([
  'createtransaction',
  'triggersmartcontract',
  'freezebalancev2',
  'unfreezebalancev2',
  'withdrawexpireunfreeze',
  'votewitnessaccount',
  'getaccountresource',
  'triggerconstantcontract',
  'getcontract',
]);

/**
 * A minimal mock block response for TronWeb's transactionBuilder.
 * TronWeb calls POST /wallet/getblock before building transactions
 * to get ref_block_bytes and ref_block_hash.
 */
const MOCK_BLOCK_RESPONSE = {
  blockID: '0000000000000001b8c2e3f4a5d6e7f8091a2b3c4d5e6f7a8b9c0d1e2f3a4b5c',
  // eslint-disable-next-line @typescript-eslint/naming-convention
  block_header: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    raw_data: {
      number: 1,
      txTrieRoot:
        '0000000000000000000000000000000000000000000000000000000000000000',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      witness_address: '41000000000000000000000000000000000000000000',
      parentHash:
        '0000000000000000000000000000000000000000000000000000000000000000',
      timestamp: Date.now(),
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention
    witness_signature: '',
  },
};

/**
 * Default chain parameters response for GET /wallet/getchainparameters.
 */
const MOCK_CHAIN_PARAMETERS = {
  chainParameter: [
    { key: 'getTransactionFee', value: 1000 },
    { key: 'getEnergyFee', value: 420 },
    { key: 'getMaintenanceTimeInterval', value: 21600000 },
  ],
};

/**
 * Default response for POST /wallet/getnextmaintenancetime.
 */
const MOCK_NEXT_MAINTENANCE_TIME = {
  // eslint-disable-next-line id-denylist
  num: Date.now() + 21600000,
};

/**
 * Starts a mock API server for E2E tests.
 *
 * @param options0 - Configuration options for the mock server.
 * @param options0.spotPricesResponse - Response to return for GET /v3/spot-prices.
 * @param options0.scanResponse - Response to return for POST /tron/transaction/scan.
 * @param options0.accountInfoResponse - Function returning a response for GET /v1/accounts/:address.
 * @param options0.broadcastResponse - Response to return for POST /wallet/broadcasttransaction. Defaults to `{ result: true, txid: 'mock-txid' }`.
 * @param options0.walletCallResponse - Function returning a response for wallet RPC POST endpoints. Defaults to `{ result: true }`.
 * @param options0.fiatExchangeRatesResponse - Response to return for GET /v1/exchange-rates/fiat. Defaults to `{ usd: 1 }`.
 * @param options0.accountResourceResponse - Function returning a response for POST /wallet/getaccountresource.
 * @returns A promise resolving to a MockApiServer with request recorder and close function.
 */
export async function startMockApiServer({
  spotPricesResponse,
  scanResponse,
  accountInfoResponse,
  broadcastResponse = { result: true, txid: 'mock-txid' },
  walletCallResponse,
  fiatExchangeRatesResponse = { usd: 1 },
  accountResourceResponse,
}: StartMockApiServerOptions): Promise<MockApiServer> {
  const requests: RequestRecorder = {
    spotPrices: [],
    accountInfo: [],
    scans: [],
    broadcasts: [],
    walletCalls: [],
    fiatExchangeRates: 0,
    unhandled: [],
  };

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      requests.unhandled.push('UNKNOWN');
      sendJson(response, 500, { error: 'Missing request URL' });
      return;
    }

    const url = new URL(request.url, E2E_API_BASE_URL);

    if (request.method === 'GET' && url.pathname === '/v3/spot-prices') {
      requests.spotPrices.push({
        assetIds: url.searchParams.get('assetIds'),
        vsCurrency: url.searchParams.get('vsCurrency'),
      });
      sendJson(response, 200, spotPricesResponse);
      return;
    }

    if (
      request.method === 'POST' &&
      url.pathname === '/tron/transaction/scan'
    ) {
      requests.scans.push(await readJsonBody(request));
      sendJson(response, 200, scanResponse);
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/v1/accounts/')) {
      const address = decodeURIComponent(
        url.pathname.slice('/v1/accounts/'.length),
      );
      requests.accountInfo.push(address);
      sendJson(response, 200, accountInfoResponse(address));
      return;
    }

    if (
      request.method === 'POST' &&
      url.pathname === '/wallet/broadcasttransaction'
    ) {
      const body = await readJsonBody(request);
      requests.broadcasts.push(body);
      sendJson(response, 200, broadcastResponse);
      return;
    }

    if (request.method === 'POST' && url.pathname.startsWith('/wallet/')) {
      const method = url.pathname.slice('/wallet/'.length);
      if (WALLET_RPC_METHODS.has(method)) {
        const body = await readJsonBody(request);
        requests.walletCalls.push({ method, body });

        if (method === 'getaccountresource' && accountResourceResponse) {
          const address = typeof body.address === 'string' ? body.address : '';
          sendJson(response, 200, accountResourceResponse(address));
          return;
        }

        let result: JsonValue;
        if (walletCallResponse) {
          result = walletCallResponse(method, body);
        } else if (method === 'triggerconstantcontract') {
          // Default response for energy estimation
          result = {
            result: { result: true },
            // eslint-disable-next-line @typescript-eslint/naming-convention
            energy_used: 0,
            transaction: {
              ret: [{ ret: 'SUCESS' }],
              visible: false,
              txID: 'mock-trigger-txid',
              // eslint-disable-next-line @typescript-eslint/naming-convention
              raw_data: {
                contract: [],
                // eslint-disable-next-line @typescript-eslint/naming-convention
                ref_block_bytes: '0000',
                // eslint-disable-next-line @typescript-eslint/naming-convention
                ref_block_hash: '0000000000000000',
                expiration: 0,
                timestamp: 0,
              },
              // eslint-disable-next-line @typescript-eslint/naming-convention
              raw_data_hex: '00',
            },
          };
        } else if (method === 'getcontract') {
          // Default response for contract info
          result = {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            consume_user_resource_percent: 100,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            origin_energy_limit: 0,
          };
        } else {
          result = { result: true };
        }
        sendJson(response, 200, result);
        return;
      }
    }

    // TronWeb calls POST /wallet/getblock before building transactions
    if (request.method === 'POST' && url.pathname === '/wallet/getblock') {
      await readJsonBody(request);
      sendJson(response, 200, MOCK_BLOCK_RESPONSE);
      return;
    }

    // TronHttpClient calls GET /wallet/getchainparameters for fee calculation
    if (
      (request.method === 'GET' || request.method === 'POST') &&
      url.pathname === '/wallet/getchainparameters'
    ) {
      if (request.method === 'POST') {
        await readJsonBody(request);
      }
      sendJson(response, 200, MOCK_CHAIN_PARAMETERS);
      return;
    }

    // TrongridApiClient calls POST /wallet/getnextmaintenancetime for cache timing
    if (
      request.method === 'POST' &&
      url.pathname === '/wallet/getnextmaintenancetime'
    ) {
      await readJsonBody(request);
      sendJson(response, 200, MOCK_NEXT_MAINTENANCE_TIME);
      return;
    }

    if (
      request.method === 'GET' &&
      url.pathname === '/v1/exchange-rates/fiat'
    ) {
      requests.fiatExchangeRates += 1;
      sendJson(response, 200, fiatExchangeRatesResponse);
      return;
    }

    requests.unhandled.push(`${request.method ?? 'UNKNOWN'} ${url.pathname}`);
    sendJson(response, 500, {
      error: `Unhandled request: ${request.method ?? 'UNKNOWN'} ${url.pathname}`,
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(E2E_API_PORT, E2E_API_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return {
    requests,
    close: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}
