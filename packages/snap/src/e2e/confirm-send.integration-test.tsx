/* eslint-disable @typescript-eslint/naming-convention */

import { installSnap } from '@metamask/snaps-jest';
import { TronWeb } from 'tronweb';

import { KnownCaip19Id, Network, Networks } from '../constants';
import type { AssetEntity } from '../entities/assets';
import { ClientRequestMethod } from '../handlers/clientRequest/types';
import type { ComputeFeeResult } from '../services/send/types';
import {
  SimulationStatus,
  type TransactionScanResult,
} from '../services/transaction-scan/types';
import {
  createInstallSnapOptionsWithStaking,
  createMaliciousScanApiResponse,
  createSimulationFailedScanApiResponse,
  createTestAccount,
  createWarningScanApiResponse,
  defaultAccountInfoResponse,
  defaultScanApiResponse,
  defaultScanResult,
  deriveAccountAddress,
  expectedFees,
  mockPreferences,
  mockSpotPrices,
  SECRET_RECOVERY_PHRASE,
  TEST_ACCOUNT_ID,
  TRX_IMAGE_SVG,
} from '../test-utils/fixtures';
import {
  startMockApiServer,
  type MockApiServer,
} from '../test-utils/mockApiServer';
import { FetchStatus } from '../types/snap';
import { getIconUrlForKnownAsset } from '../ui/confirmation/utils/getIconUrlForKnownAsset';
import { ConfirmTransactionRequest } from '../ui/confirmation/views/ConfirmTransactionRequest/ConfirmTransactionRequest';
import { ConfirmSignAndSendTransactionFormNames } from '../ui/confirmation/views/ConfirmTransactionRequest/events';

// eslint-disable-next-line no-restricted-globals
process.env.EXPLORER_MAINNET_BASE_URL = 'https://explorer-mainnet.test';
// eslint-disable-next-line no-restricted-globals
process.env.EXPLORER_NILE_BASE_URL = 'https://explorer-nile.test';
// eslint-disable-next-line no-restricted-globals
process.env.EXPLORER_SHASTA_BASE_URL = 'https://explorer-shasta.test';

type TriggerSmartContractBody = {
  owner_address: string;
  contract_address: string;
  function_selector: string;
  parameter: string;
  fee_limit?: number | string;
  call_value?: number | string;
};

type MockJsonValue =
  | null
  | boolean
  | number
  | string
  | MockJsonValue[]
  | MockJsonObject;

type MockJsonObject = {
  [key: string]: MockJsonValue;
};

type WalletCallResponse = NonNullable<
  Parameters<typeof startMockApiServer>[0]['walletCallResponse']
>;

const RECIPIENT_ADDRESS = TronWeb.address.fromHex(
  '412efffc7686e54ab669a1cdb1e2cc17cf4b4eca96',
);
const USDT_CONTRACT_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const CONFIRM_SEND_ORIGIN = 'MetaMask';

const nativeAsset: AssetEntity = {
  assetType: KnownCaip19Id.TrxMainnet,
  keyringAccountId: TEST_ACCOUNT_ID,
  network: Network.Mainnet,
  symbol: Networks[Network.Mainnet].nativeToken.symbol,
  decimals: Networks[Network.Mainnet].nativeToken.decimals,
  rawAmount: '100000000',
  uiAmount: '100',
  iconUrl: Networks[Network.Mainnet].nativeToken.iconUrl,
};

const trc20Asset: AssetEntity = {
  assetType: `${Network.Mainnet}/trc20:${USDT_CONTRACT_ADDRESS}`,
  keyringAccountId: TEST_ACCOUNT_ID,
  network: Network.Mainnet,
  symbol: 'USDT',
  decimals: 6,
  rawAmount: '100000000',
  uiAmount: '100',
  iconUrl: '',
};

const maliciousScanResult: TransactionScanResult = {
  ...defaultScanResult,
  validation: {
    type: 'Malicious',
    reason: 'known_attacker',
  },
};

const warningScanResult: TransactionScanResult = {
  ...defaultScanResult,
  validation: {
    type: 'Warning',
    reason: 'unfair_trade',
  },
};

const simulationFailedScanResult: TransactionScanResult = {
  status: 'ERROR',
  estimatedChanges: {
    assets: [],
  },
  validation: {
    type: 'Benign',
    reason: 'other',
  },
  error: {
    type: null,
    code: 'EXECUTION_REVERTED',
    message: 'Transaction execution failed',
  },
  simulationStatus: SimulationStatus.Failed,
};

const [baseFee, bandwidthFee] = expectedFees;

if (!baseFee || !bandwidthFee) {
  throw new Error('Expected fee fixtures to include base and bandwidth fees.');
}

const sendExpectedFees: ComputeFeeResult = [
  {
    type: baseFee.type,
    asset: {
      ...baseFee.asset,
      iconUrl: getIconUrlForKnownAsset(
        Networks[Network.Mainnet].nativeToken.id,
      ),
    },
  },
  {
    type: bandwidthFee.type,
    asset: {
      ...bandwidthFee.asset,
      amount: '267',
      iconUrl: getIconUrlForKnownAsset(Networks[Network.Mainnet].bandwidth.id),
    },
  },
];

/**
 * Adds a TRC20 asset to the installed test state.
 *
 * @param account - The account whose asset list should include the TRC20 token.
 * @returns Install options with the TRC20 asset attached.
 */
function createInstallSnapOptionsWithTrc20(
  account: ReturnType<typeof createTestAccount>,
): ReturnType<typeof createInstallSnapOptionsWithStaking> {
  const options = createInstallSnapOptionsWithStaking(account);

  return {
    ...options,
    unencryptedState: {
      ...options.unencryptedState,
      assets: {
        ...options.unencryptedState.assets,
        [account.id]: [
          ...(options.unencryptedState.assets[account.id] ?? []),
          trc20Asset,
        ],
      },
    },
  };
}

/**
 * Creates a minimal valid TronGrid createtransaction response for the given owner address.
 *
 * @param ownerAddress - The sender's Tron base58 address.
 * @returns A transaction response object suitable for TronWeb to process.
 */
function createMockTrxTransaction(ownerAddress: string): MockJsonObject {
  const ownerAddressHex = TronWeb.address.toHex(ownerAddress).toUpperCase();
  return {
    visible: false,
    txID: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',

    raw_data: {
      contract: [
        {
          parameter: {
            value: {
              amount: 1000000,

              owner_address: ownerAddressHex,

              to_address: '412EFFFC7686E54AB669A1CDB1E2CC17CF4B4ECA96',
            },

            type_url: 'type.googleapis.com/protocol.TransferContract',
          },
          type: 'TransferContract',
        },
      ],

      ref_block_bytes: 'cb1d',

      ref_block_hash: 'd3fc65a6fb0f782d',
      expiration: Date.now() + 60000,
      timestamp: Date.now(),
    },

    raw_data_hex:
      '0a02cb1d2208d3fc65a6fb0f782d40e8b2a18291335a66080112620a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412310a1541458437be39f3a8bfdbfee7bef93e2c5f632ceff41215412efffc7686e54ab669a1cdb1e2cc17cf4b4eca9618904e7088de9d829133',
  };
}

/**
 * Removes undefined fields so the mocked wallet payload remains JSON-safe.
 *
 * @param body - The smart contract trigger body sent to the wallet RPC.
 * @returns A JSON-safe trigger body.
 */
function createJsonSafeTriggerBody(
  body: TriggerSmartContractBody,
): MockJsonObject {
  return {
    owner_address: body.owner_address,
    contract_address: body.contract_address,
    function_selector: body.function_selector,
    parameter: body.parameter,
    ...(body.fee_limit === undefined ? {} : { fee_limit: body.fee_limit }),
    ...(body.call_value === undefined ? {} : { call_value: body.call_value }),
  };
}

/**
 * Creates a minimal TriggerSmartContract transaction response for TronWeb.
 *
 * @param body - The smart contract trigger body sent to the wallet RPC.
 * @returns A transaction response object suitable for TronWeb to process.
 */
function createMockTrc20Transaction(
  body: TriggerSmartContractBody,
): MockJsonObject {
  const tronWeb = new TronWeb({ fullHost: 'http://127.0.0.1:8899' });
  const transaction = {
    visible: false,
    txID: '',
    raw_data_hex: '',
    raw_data: {
      contract: [
        {
          parameter: {
            value: createJsonSafeTriggerBody(body),
            type_url: 'type.googleapis.com/protocol.TriggerSmartContract',
          },
          type: 'TriggerSmartContract',
        },
      ],
      ref_block_bytes: '0001',
      ref_block_hash: 'b8c2e3f4a5d6e7f8',
      expiration: Date.now() + 60000,
      timestamp: Date.now(),
      fee_limit: Number(body.fee_limit ?? 225000000),
    },
  };
  const transactionPb = tronWeb.utils.transaction.txJsonToPb(transaction);

  return {
    ...transaction,
    txID: tronWeb.utils.transaction
      .txPbToTxID(transactionPb)
      .replace(/^0x/u, ''),
    raw_data_hex: tronWeb.utils.transaction
      .txPbToRawDataHex(transactionPb)
      .toLowerCase(),
  };
}

describe('Confirm Send E2E', () => {
  let mockServer: MockApiServer;
  const accountAddress = deriveAccountAddress(SECRET_RECOVERY_PHRASE);
  const account = createTestAccount(accountAddress);

  /**
   * Updates the mock server reference used by the shared cleanup hook.
   *
   * @param server - The active mock server for the current test.
   */
  function setMockServer(server: MockApiServer): void {
    mockServer = server;
  }

  afterEach(async () => {
    await mockServer.close();
  });

  describe('Security Alerts — Benign', () => {
    beforeEach(async () => {
      mockServer = await startMockApiServer({
        spotPricesResponse: mockSpotPrices,
        scanResponse: defaultScanApiResponse,
        accountInfoResponse: defaultAccountInfoResponse,
        broadcastResponse: { result: true, txid: 'mock-send-txid-123' },
        walletCallResponse: (_method, _body) =>
          createMockTrxTransaction(accountAddress),
      });
    });

    it('confirms TRX send, broadcasts, and returns transaction ID', async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const { onClientRequest, mockJsonRpc } = await installSnap({
        options: createInstallSnapOptionsWithStaking(account),
      });
      mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });
      mockJsonRpc({ method: 'snap_manageAccounts', result: null });

      const response = onClientRequest({
        method: ClientRequestMethod.ConfirmSend,
        params: {
          fromAccountId: TEST_ACCOUNT_ID,
          toAddress: RECIPIENT_ADDRESS,
          amount: '1',
          assetId: KnownCaip19Id.TrxMainnet,
        },
      });

      const screen = await response.getInterface();
      const updatedScreen = await screen.waitForUpdate();
      expect(updatedScreen).toRender(
        <ConfirmTransactionRequest
          context={{
            origin: CONFIRM_SEND_ORIGIN,
            scope: Network.Mainnet,
            fromAddress: account.address,
            toAddress: RECIPIENT_ADDRESS,
            amount: '1',
            fees: sendExpectedFees,
            asset: nativeAsset,
            preferences: mockPreferences,
            networkImage: TRX_IMAGE_SVG,
            tokenPrices: {},
            tokenPricesFetchStatus: FetchStatus.Fetching,
            scan: defaultScanResult,
            scanFetchStatus: FetchStatus.Fetched,
            transactionRawData: null,
            accountType: account.type,
          }}
        />,
      );

      await updatedScreen.clickElement(
        ConfirmSignAndSendTransactionFormNames.Confirm,
      );

      expect(await response).toMatchObject({
        response: {
          result: expect.objectContaining({
            transactionId: expect.any(String),
          }),
        },
      });

      expect(mockServer.requests.broadcasts.length).toBeGreaterThanOrEqual(1);
      expect(mockServer.requests.unhandled).toStrictEqual([]);
    });

    it('builds a TRC20 send transaction and scans the smart contract call', async () => {
      const currentMockServer = mockServer;
      await currentMockServer.close();
      const trc20WalletCallResponse: WalletCallResponse = (
        method,
        body,
      ): MockJsonObject => {
        if (method === 'triggersmartcontract') {
          return {
            result: { result: true },
            transaction: createMockTrc20Transaction(
              body as TriggerSmartContractBody,
            ),
          };
        }

        if (method === 'triggerconstantcontract') {
          return {
            result: { result: true },
            energy_used: 0,
            transaction: {
              ret: [{ ret: 'SUCESS' }],
              visible: false,
              txID: 'mock-trigger-txid',
              raw_data: {
                contract: [],
                ref_block_bytes: '0000',
                ref_block_hash: '0000000000000000',
                expiration: 0,
                timestamp: 0,
              },
              raw_data_hex: '00',
            },
          };
        }

        if (method === 'getcontract') {
          return {
            consume_user_resource_percent: 100,
            origin_energy_limit: 0,
          };
        }

        return { result: true };
      };
      const nextMockServer = await startMockApiServer({
        spotPricesResponse: mockSpotPrices,
        scanResponse: defaultScanApiResponse,
        accountInfoResponse: defaultAccountInfoResponse,
        broadcastResponse: { result: true, txid: 'mock-send-trc20-txid-123' },
        walletCallResponse: trc20WalletCallResponse,
      });
      setMockServer(nextMockServer);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const { onClientRequest, mockJsonRpc } = await installSnap({
        options: createInstallSnapOptionsWithTrc20(account),
      });
      mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });
      mockJsonRpc({ method: 'snap_manageAccounts', result: null });

      const response = onClientRequest({
        method: ClientRequestMethod.ConfirmSend,
        params: {
          fromAccountId: TEST_ACCOUNT_ID,
          toAddress: RECIPIENT_ADDRESS,
          amount: '1',
          assetId: trc20Asset.assetType,
        },
      });

      const screen = await response.getInterface();
      const updatedScreen = await screen.waitForUpdate();

      expect(mockServer.requests.walletCalls).toContainEqual(
        expect.objectContaining({
          method: 'triggersmartcontract',
        }),
      );
      expect(mockServer.requests.scans).toStrictEqual([
        expect.objectContaining({
          account_address: account.address,
          data: {
            data: null,
            from: account.address,
            to: USDT_CONTRACT_ADDRESS,
            value: 0,
          },
          options: ['simulation', 'validation'],
        }),
      ]);

      await updatedScreen.clickElement(
        ConfirmSignAndSendTransactionFormNames.Cancel,
      );

      expect(await response).toRespondWithError(
        expect.objectContaining({
          code: expect.any(Number),
        }),
      );
      expect(mockServer.requests.unhandled).toStrictEqual([]);
    });

    it('rejects send when user clicks cancel', async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const { onClientRequest, mockJsonRpc } = await installSnap({
        options: createInstallSnapOptionsWithStaking(account),
      });
      mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });
      mockJsonRpc({ method: 'snap_manageAccounts', result: null });

      const response = onClientRequest({
        method: ClientRequestMethod.ConfirmSend,
        params: {
          fromAccountId: TEST_ACCOUNT_ID,
          toAddress: RECIPIENT_ADDRESS,
          amount: '1',
          assetId: KnownCaip19Id.TrxMainnet,
        },
      });

      const screen = await response.getInterface();
      const updatedScreen = await screen.waitForUpdate();

      await updatedScreen.clickElement(
        ConfirmSignAndSendTransactionFormNames.Cancel,
      );

      expect(await response).toRespondWithError(
        expect.objectContaining({
          code: expect.any(Number),
        }),
      );
    });
  });

  describe('Security Alerts — Malicious', () => {
    beforeEach(async () => {
      mockServer = await startMockApiServer({
        spotPricesResponse: mockSpotPrices,
        scanResponse: createMaliciousScanApiResponse(),
        accountInfoResponse: defaultAccountInfoResponse,
        broadcastResponse: { result: true, txid: 'mock-send-txid-malicious' },
        walletCallResponse: (_method, _body) =>
          createMockTrxTransaction(accountAddress),
      });
    });

    it('renders danger banner but send still proceeds', async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const { onClientRequest, mockJsonRpc } = await installSnap({
        options: createInstallSnapOptionsWithStaking(account),
      });
      mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });
      mockJsonRpc({ method: 'snap_manageAccounts', result: null });

      const response = onClientRequest({
        method: ClientRequestMethod.ConfirmSend,
        params: {
          fromAccountId: TEST_ACCOUNT_ID,
          toAddress: RECIPIENT_ADDRESS,
          amount: '1',
          assetId: KnownCaip19Id.TrxMainnet,
        },
      });

      const screen = await response.getInterface();
      const updatedScreen = await screen.waitForUpdate();
      expect(updatedScreen).toRender(
        <ConfirmTransactionRequest
          context={{
            origin: CONFIRM_SEND_ORIGIN,
            scope: Network.Mainnet,
            fromAddress: account.address,
            toAddress: RECIPIENT_ADDRESS,
            amount: '1',
            fees: sendExpectedFees,
            asset: nativeAsset,
            preferences: mockPreferences,
            networkImage: TRX_IMAGE_SVG,
            tokenPrices: {},
            tokenPricesFetchStatus: FetchStatus.Fetching,
            scan: maliciousScanResult,
            scanFetchStatus: FetchStatus.Fetched,
            transactionRawData: null,
            accountType: account.type,
          }}
        />,
      );

      await updatedScreen.clickElement(
        ConfirmSignAndSendTransactionFormNames.Confirm,
      );

      expect(await response).toMatchObject({
        response: {
          result: expect.objectContaining({
            transactionId: expect.any(String),
          }),
        },
      });
    });
  });

  describe('Security Alerts — Warning', () => {
    beforeEach(async () => {
      mockServer = await startMockApiServer({
        spotPricesResponse: mockSpotPrices,
        scanResponse: createWarningScanApiResponse(),
        accountInfoResponse: defaultAccountInfoResponse,
        broadcastResponse: { result: true, txid: 'mock-send-txid-warning' },
        walletCallResponse: (_method, _body) =>
          createMockTrxTransaction(accountAddress),
      });
    });

    it('renders warning banner but send still proceeds', async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const { onClientRequest, mockJsonRpc } = await installSnap({
        options: createInstallSnapOptionsWithStaking(account),
      });
      mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });
      mockJsonRpc({ method: 'snap_manageAccounts', result: null });

      const response = onClientRequest({
        method: ClientRequestMethod.ConfirmSend,
        params: {
          fromAccountId: TEST_ACCOUNT_ID,
          toAddress: RECIPIENT_ADDRESS,
          amount: '1',
          assetId: KnownCaip19Id.TrxMainnet,
        },
      });

      const screen = await response.getInterface();
      const updatedScreen = await screen.waitForUpdate();
      expect(updatedScreen).toRender(
        <ConfirmTransactionRequest
          context={{
            origin: CONFIRM_SEND_ORIGIN,
            scope: Network.Mainnet,
            fromAddress: account.address,
            toAddress: RECIPIENT_ADDRESS,
            amount: '1',
            fees: sendExpectedFees,
            asset: nativeAsset,
            preferences: mockPreferences,
            networkImage: TRX_IMAGE_SVG,
            tokenPrices: {},
            tokenPricesFetchStatus: FetchStatus.Fetching,
            scan: warningScanResult,
            scanFetchStatus: FetchStatus.Fetched,
            transactionRawData: null,
            accountType: account.type,
          }}
        />,
      );

      await updatedScreen.clickElement(
        ConfirmSignAndSendTransactionFormNames.Confirm,
      );

      expect(await response).toMatchObject({
        response: {
          result: expect.objectContaining({
            transactionId: expect.any(String),
          }),
        },
      });
    });
  });

  describe('Security Alerts — Simulation Failed', () => {
    beforeEach(async () => {
      mockServer = await startMockApiServer({
        spotPricesResponse: mockSpotPrices,
        scanResponse: createSimulationFailedScanApiResponse(),
        accountInfoResponse: defaultAccountInfoResponse,
        walletCallResponse: (_method, _body) =>
          createMockTrxTransaction(accountAddress),
      });
    });

    it('disables confirm button when simulation fails', async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const { onClientRequest, mockJsonRpc } = await installSnap({
        options: createInstallSnapOptionsWithStaking(account),
      });
      mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });
      mockJsonRpc({ method: 'snap_manageAccounts', result: null });

      const response = onClientRequest({
        method: ClientRequestMethod.ConfirmSend,
        params: {
          fromAccountId: TEST_ACCOUNT_ID,
          toAddress: RECIPIENT_ADDRESS,
          amount: '1',
          assetId: KnownCaip19Id.TrxMainnet,
        },
      });

      const screen = await response.getInterface();
      const updatedScreen = await screen.waitForUpdate();
      expect(updatedScreen).toRender(
        <ConfirmTransactionRequest
          context={{
            origin: CONFIRM_SEND_ORIGIN,
            scope: Network.Mainnet,
            fromAddress: account.address,
            toAddress: RECIPIENT_ADDRESS,
            amount: '1',
            fees: sendExpectedFees,
            asset: nativeAsset,
            preferences: mockPreferences,
            networkImage: TRX_IMAGE_SVG,
            tokenPrices: {},
            tokenPricesFetchStatus: FetchStatus.Fetching,
            scan: simulationFailedScanResult,
            scanFetchStatus: FetchStatus.Fetched,
            transactionRawData: null,
            accountType: account.type,
          }}
        />,
      );

      expect(mockServer.requests.scans.length).toBe(1);

      // Clean up pending response by dismissing
      await updatedScreen.clickElement(
        ConfirmSignAndSendTransactionFormNames.Cancel,
      );
    });
  });

  describe('Security Alerts — Fetch Error', () => {
    beforeEach(async () => {
      mockServer = await startMockApiServer({
        spotPricesResponse: mockSpotPrices,
        scanResponse: { error: 'Internal server error' },
        accountInfoResponse: defaultAccountInfoResponse,
        broadcastResponse: { result: true, txid: 'mock-send-txid-fetch-error' },
        walletCallResponse: (_method, _body) =>
          createMockTrxTransaction(accountAddress),
      });
    });

    it('renders error banner but send still proceeds', async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const { onClientRequest, mockJsonRpc } = await installSnap({
        options: createInstallSnapOptionsWithStaking(account),
      });
      mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });
      mockJsonRpc({ method: 'snap_manageAccounts', result: null });

      const response = onClientRequest({
        method: ClientRequestMethod.ConfirmSend,
        params: {
          fromAccountId: TEST_ACCOUNT_ID,
          toAddress: RECIPIENT_ADDRESS,
          amount: '1',
          assetId: KnownCaip19Id.TrxMainnet,
        },
      });

      const screen = await response.getInterface();
      const updatedScreen = await screen.waitForUpdate();
      expect(updatedScreen).toRender(
        <ConfirmTransactionRequest
          context={{
            origin: CONFIRM_SEND_ORIGIN,
            scope: Network.Mainnet,
            fromAddress: account.address,
            toAddress: RECIPIENT_ADDRESS,
            amount: '1',
            fees: sendExpectedFees,
            asset: nativeAsset,
            preferences: mockPreferences,
            networkImage: TRX_IMAGE_SVG,
            tokenPrices: {},
            tokenPricesFetchStatus: FetchStatus.Fetching,
            scan: null,
            scanFetchStatus: FetchStatus.Error,
            transactionRawData: null,
            accountType: account.type,
          }}
        />,
      );

      await updatedScreen.clickElement(
        ConfirmSignAndSendTransactionFormNames.Confirm,
      );

      expect(await response).toMatchObject({
        response: {
          result: expect.objectContaining({
            transactionId: expect.any(String),
          }),
        },
      });
    });
  });
});
