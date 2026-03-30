/* eslint-disable @typescript-eslint/naming-convention */

import { FeeType, KeyringRpcMethod } from '@metamask/keyring-api';
import { installSnap } from '@metamask/snaps-jest';
import { TronWeb } from 'tronweb';

import { KnownCaip19Id, Network, Networks } from '../constants';
import { TronMultichainMethod } from '../handlers/keyring-types';
import type { ComputeFeeResult } from '../services/send/types';
import {
  SimulationStatus,
  type TransactionScanResult,
} from '../services/transaction-scan/types';
import {
  createInstallSnapOptions,
  createMaliciousScanApiResponse,
  createSignableTransaction,
  createSimulationFailedScanApiResponse,
  createTestAccount,
  createTrc20SignableTransaction,
  createWarningScanApiResponse,
  defaultAccountInfoResponse,
  defaultScanApiResponse,
  defaultScanResult,
  deriveAccountAddress,
  expectedFees,
  mockPreferences,
  mockSpotPrices,
  recipientHexAddress,
  SECRET_RECOVERY_PHRASE,
  TEST_ORIGIN,
  TRX_IMAGE_SVG,
} from '../test-utils/fixtures';
import {
  startMockApiServer,
  type MockApiServer,
} from '../test-utils/mockApiServer';
import { FetchStatus } from '../types/snap';
import { getIconUrlForKnownAsset } from '../ui/confirmation/utils/getIconUrlForKnownAsset';
import { ConfirmSignTransaction } from '../ui/confirmation/views/ConfirmSignTransaction/ConfirmSignTransaction';
import { ConfirmSignTransactionFormNames } from '../ui/confirmation/views/ConfirmSignTransaction/events';

type SignableTransaction = {
  rawDataHex: string;
  type: string;
};

/**
 * Helper to invoke a SignTransaction keyring request.
 *
 * @param onKeyringRequest - The onKeyringRequest function from installSnap.
 * @param account - The test account.
 * @param transaction - The transaction to sign.
 * @param transaction.rawDataHex - The raw data hex of the transaction.
 * @param transaction.type - The type of the transaction.
 * @returns The response promise with getInterface().
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function sendSignTransactionRequest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onKeyringRequest: any,
  account: ReturnType<typeof createTestAccount>,
  transaction: SignableTransaction,
) {
  return onKeyringRequest({
    origin: TEST_ORIGIN,
    method: KeyringRpcMethod.SubmitRequest,
    params: {
      id: '22222222-2222-4222-8222-222222222222',
      origin: TEST_ORIGIN,
      account: account.id,
      scope: Network.Mainnet,
      request: {
        method: TronMultichainMethod.SignTransaction,
        params: {
          address: account.address,
          transaction,
        },
      },
    },
  });
}

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

const skippedSimulationScanResult: TransactionScanResult = {
  status: 'SUCCESS',
  estimatedChanges: {
    assets: [],
  },
  validation: {
    type: null,
    reason: null,
  },
  error: null,
  simulationStatus: SimulationStatus.Skipped,
};

const unsupportedTransactionFees: ComputeFeeResult = [
  {
    type: FeeType.Base,
    asset: {
      unit: Networks[Network.Mainnet].nativeToken.symbol,
      type: Networks[Network.Mainnet].nativeToken.id,
      amount: '0',
      fungible: true as const,
      iconUrl: getIconUrlForKnownAsset(
        Networks[Network.Mainnet].nativeToken.id,
      ),
    },
  },
  {
    type: FeeType.Base,
    asset: {
      unit: Networks[Network.Mainnet].bandwidth.symbol,
      type: Networks[Network.Mainnet].bandwidth.id,
      amount: '254',
      fungible: true as const,
      iconUrl: getIconUrlForKnownAsset(Networks[Network.Mainnet].bandwidth.id),
    },
  },
];

describe('Sign Transaction E2E', () => {
  let mockServer: MockApiServer;
  const accountAddress = deriveAccountAddress(SECRET_RECOVERY_PHRASE);
  const account = createTestAccount(accountAddress);

  afterEach(async () => {
    await mockServer.close();
  });

  /**
   * Creates a signable transaction whose contract type is unsupported by the scan service.
   *
   * @returns A signable unsupported transaction payload.
   */
  async function createUnsupportedSignableTransaction(): Promise<SignableTransaction> {
    const tronWeb = new TronWeb({ fullHost: 'http://127.0.0.1:8899' });
    const transaction =
      await tronWeb.transactionBuilder.withdrawExpireUnfreeze(accountAddress);
    const transactionPb = tronWeb.utils.transaction.txJsonToPb({
      raw_data: transaction.raw_data,
      visible: false,
    });

    return {
      rawDataHex: tronWeb.utils.transaction
        .txPbToRawDataHex(transactionPb)
        .toLowerCase(),
      type: 'WithdrawExpireUnfreezeContract',
    };
  }

  describe('Security Alerts — Benign', () => {
    beforeEach(async () => {
      mockServer = await startMockApiServer({
        spotPricesResponse: mockSpotPrices,
        scanResponse: defaultScanApiResponse,
        accountInfoResponse: defaultAccountInfoResponse,
      });
    });

    it('confirms a TRX transfer and returns signature', async () => {
      const transaction = createSignableTransaction(accountAddress);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const { onKeyringRequest, mockJsonRpc } = await installSnap({
        options: createInstallSnapOptions(account),
      });
      mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });

      const response = sendSignTransactionRequest(
        onKeyringRequest,
        account,
        transaction,
      );

      const initialScreen = await response.getInterface();
      expect(initialScreen).toRender(
        <ConfirmSignTransaction
          context={{
            scope: Network.Mainnet,
            account,
            transaction,
            origin: TEST_ORIGIN,
            preferences: mockPreferences,
            networkImage: TRX_IMAGE_SVG,
            scan: null,
            scanFetchStatus: FetchStatus.Fetching,
            tokenPrices: mockSpotPrices,
            tokenPricesFetchStatus: FetchStatus.Fetched,
            fees: expectedFees,
            feesFetchStatus: FetchStatus.Fetched,
          }}
        />,
      );

      const updatedScreen = await initialScreen.waitForUpdate();
      expect(updatedScreen).toRender(
        <ConfirmSignTransaction
          context={{
            scope: Network.Mainnet,
            account,
            transaction,
            origin: TEST_ORIGIN,
            preferences: mockPreferences,
            networkImage: TRX_IMAGE_SVG,
            scan: defaultScanResult,
            scanFetchStatus: FetchStatus.Fetched,
            tokenPrices: mockSpotPrices,
            tokenPricesFetchStatus: FetchStatus.Fetched,
            fees: expectedFees,
            feesFetchStatus: FetchStatus.Fetched,
          }}
        />,
      );

      expect(mockServer.requests.spotPrices).toStrictEqual([
        { assetIds: KnownCaip19Id.TrxMainnet, vsCurrency: 'usd' },
      ]);
      expect(mockServer.requests.scans).toStrictEqual([
        {
          account_address: account.address,
          metadata: { domain: TEST_ORIGIN },
          data: {
            data: null,
            from: account.address,
            to: TronWeb.address.fromHex(recipientHexAddress),
            value: 10000,
          },
          options: ['simulation', 'validation'],
        },
      ]);
      expect(mockServer.requests.unhandled).toStrictEqual([]);

      await updatedScreen.clickElement(ConfirmSignTransactionFormNames.Confirm);

      expect(await response).toMatchObject({
        response: {
          result: {
            pending: false,
            result: {
              signature: expect.stringMatching(/^0x[0-9a-fA-F]+$/u),
            },
          },
        },
      });
    });

    it('confirms a TRC20 transfer and returns signature', async () => {
      const transaction = createTrc20SignableTransaction(accountAddress);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const { onKeyringRequest, mockJsonRpc } = await installSnap({
        options: createInstallSnapOptions(account),
      });
      mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });

      const response = sendSignTransactionRequest(
        onKeyringRequest,
        account,
        transaction,
      );

      const initialScreen = await response.getInterface();
      const updatedScreen = await initialScreen.waitForUpdate();

      await updatedScreen.clickElement(ConfirmSignTransactionFormNames.Confirm);

      expect(await response).toMatchObject({
        response: {
          result: {
            pending: false,
            result: {
              signature: expect.stringMatching(/^0x[0-9a-fA-F]+$/u),
            },
          },
        },
      });
    });

    it('rejects when user clicks cancel', async () => {
      const transaction = createSignableTransaction(accountAddress);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const { onKeyringRequest, mockJsonRpc } = await installSnap({
        options: createInstallSnapOptions(account),
      });
      mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });

      const response = sendSignTransactionRequest(
        onKeyringRequest,
        account,
        transaction,
      );

      const initialScreen = await response.getInterface();
      const updatedScreen = await initialScreen.waitForUpdate();

      await updatedScreen.clickElement(ConfirmSignTransactionFormNames.Cancel);

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
      });
    });

    it('renders danger banner but allows confirmation', async () => {
      const transaction = createSignableTransaction(accountAddress);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const { onKeyringRequest, mockJsonRpc } = await installSnap({
        options: createInstallSnapOptions(account),
      });
      mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });

      const response = sendSignTransactionRequest(
        onKeyringRequest,
        account,
        transaction,
      );

      const initialScreen = await response.getInterface();
      const updatedScreen = await initialScreen.waitForUpdate();
      expect(updatedScreen).toRender(
        <ConfirmSignTransaction
          context={{
            scope: Network.Mainnet,
            account,
            transaction,
            origin: TEST_ORIGIN,
            preferences: mockPreferences,
            networkImage: TRX_IMAGE_SVG,
            scan: maliciousScanResult,
            scanFetchStatus: FetchStatus.Fetched,
            tokenPrices: mockSpotPrices,
            tokenPricesFetchStatus: FetchStatus.Fetched,
            fees: expectedFees,
            feesFetchStatus: FetchStatus.Fetched,
          }}
        />,
      );

      // Confirm button should still be enabled — malicious is informational only
      await updatedScreen.clickElement(ConfirmSignTransactionFormNames.Confirm);

      expect(await response).toMatchObject({
        response: {
          result: {
            pending: false,
            result: {
              signature: expect.stringMatching(/^0x[0-9a-fA-F]+$/u),
            },
          },
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
      });
    });

    it('renders warning banner but allows confirmation', async () => {
      const transaction = createSignableTransaction(accountAddress);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const { onKeyringRequest, mockJsonRpc } = await installSnap({
        options: createInstallSnapOptions(account),
      });
      mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });

      const response = sendSignTransactionRequest(
        onKeyringRequest,
        account,
        transaction,
      );

      const initialScreen = await response.getInterface();
      const updatedScreen = await initialScreen.waitForUpdate();
      expect(updatedScreen).toRender(
        <ConfirmSignTransaction
          context={{
            scope: Network.Mainnet,
            account,
            transaction,
            origin: TEST_ORIGIN,
            preferences: mockPreferences,
            networkImage: TRX_IMAGE_SVG,
            scan: warningScanResult,
            scanFetchStatus: FetchStatus.Fetched,
            tokenPrices: mockSpotPrices,
            tokenPricesFetchStatus: FetchStatus.Fetched,
            fees: expectedFees,
            feesFetchStatus: FetchStatus.Fetched,
          }}
        />,
      );

      await updatedScreen.clickElement(ConfirmSignTransactionFormNames.Confirm);

      expect(await response).toMatchObject({
        response: {
          result: {
            pending: false,
            result: {
              signature: expect.stringMatching(/^0x[0-9a-fA-F]+$/u),
            },
          },
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
      });
    });

    it('disables confirm button when simulation fails', async () => {
      const transaction = createSignableTransaction(accountAddress);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const { onKeyringRequest, mockJsonRpc } = await installSnap({
        options: createInstallSnapOptions(account),
      });
      mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });

      const response = sendSignTransactionRequest(
        onKeyringRequest,
        account,
        transaction,
      );

      const initialScreen = await response.getInterface();
      const updatedScreen = await initialScreen.waitForUpdate();
      expect(updatedScreen).toRender(
        <ConfirmSignTransaction
          context={{
            scope: Network.Mainnet,
            account,
            transaction,
            origin: TEST_ORIGIN,
            preferences: mockPreferences,
            networkImage: TRX_IMAGE_SVG,
            scan: simulationFailedScanResult,
            scanFetchStatus: FetchStatus.Fetched,
            tokenPrices: mockSpotPrices,
            tokenPricesFetchStatus: FetchStatus.Fetched,
            fees: expectedFees,
            feesFetchStatus: FetchStatus.Fetched,
          }}
        />,
      );

      // Verify the scan request was made
      expect(mockServer.requests.scans.length).toBe(1);
    });
  });

  describe('Security Alerts — Simulation Skipped', () => {
    beforeEach(async () => {
      mockServer = await startMockApiServer({
        spotPricesResponse: mockSpotPrices,
        scanResponse: defaultScanApiResponse,
        accountInfoResponse: defaultAccountInfoResponse,
      });
    });

    it('renders unsupported-contract state without calling the scan API', async () => {
      const transaction = await createUnsupportedSignableTransaction();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const { onKeyringRequest, mockJsonRpc } = await installSnap({
        options: createInstallSnapOptions(account),
      });
      mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });

      const response = sendSignTransactionRequest(
        onKeyringRequest,
        account,
        transaction,
      );

      const initialScreen = await response.getInterface();
      const updatedScreen = await initialScreen.waitForUpdate();

      expect(updatedScreen).toRender(
        <ConfirmSignTransaction
          context={{
            scope: Network.Mainnet,
            account,
            transaction,
            origin: TEST_ORIGIN,
            preferences: mockPreferences,
            networkImage: TRX_IMAGE_SVG,
            scan: skippedSimulationScanResult,
            scanFetchStatus: FetchStatus.Fetched,
            tokenPrices: mockSpotPrices,
            tokenPricesFetchStatus: FetchStatus.Fetched,
            fees: unsupportedTransactionFees,
            feesFetchStatus: FetchStatus.Fetched,
          }}
        />,
      );

      expect(mockServer.requests.scans).toStrictEqual([]);

      await updatedScreen.clickElement(ConfirmSignTransactionFormNames.Confirm);

      expect(await response).toMatchObject({
        response: {
          result: {
            pending: false,
            result: {
              signature: expect.stringMatching(/^0x[0-9a-fA-F]+$/u),
            },
          },
        },
      });
    });
  });

  describe('Security Alerts — Fetch Error', () => {
    beforeEach(async () => {
      // Return a malformed response from the scan endpoint to trigger the snap's error handling
      mockServer = await startMockApiServer({
        spotPricesResponse: mockSpotPrices,
        scanResponse: { error: 'Internal server error' },
        accountInfoResponse: defaultAccountInfoResponse,
      });
    });

    it('renders error banner but allows confirmation', async () => {
      const transaction = createSignableTransaction(accountAddress);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const { onKeyringRequest, mockJsonRpc } = await installSnap({
        options: createInstallSnapOptions(account),
      });
      mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });

      const response = sendSignTransactionRequest(
        onKeyringRequest,
        account,
        transaction,
      );

      const initialScreen = await response.getInterface();
      const updatedScreen = await initialScreen.waitForUpdate();
      expect(updatedScreen).toRender(
        <ConfirmSignTransaction
          context={{
            scope: Network.Mainnet,
            account,
            transaction,
            origin: TEST_ORIGIN,
            preferences: mockPreferences,
            networkImage: TRX_IMAGE_SVG,
            scan: null,
            scanFetchStatus: FetchStatus.Error,
            tokenPrices: mockSpotPrices,
            tokenPricesFetchStatus: FetchStatus.Fetched,
            fees: expectedFees,
            feesFetchStatus: FetchStatus.Fetched,
          }}
        />,
      );

      // Even with scan error, confirm button should be enabled
      await updatedScreen.clickElement(ConfirmSignTransactionFormNames.Confirm);

      expect(await response).toMatchObject({
        response: {
          result: {
            pending: false,
            result: {
              signature: expect.stringMatching(/^0x[0-9a-fA-F]+$/u),
            },
          },
        },
      });
    });
  });
});
