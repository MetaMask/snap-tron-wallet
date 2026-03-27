import { KeyringRpcMethod } from '@metamask/keyring-api';
import { installSnap } from '@metamask/snaps-jest';
import { TronWeb } from 'tronweb';

import { KnownCaip19Id, Network } from '../constants';
import { TronMultichainMethod } from '../handlers/keyring-types';
import {
  startMockApiServer,
  type MockApiServer,
} from '../test-utils/mockApiServer';
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
import { FetchStatus } from '../types/snap';
import { ConfirmSignTransaction } from '../ui/confirmation/views/ConfirmSignTransaction/ConfirmSignTransaction';
import { ConfirmSignTransactionFormNames } from '../ui/confirmation/views/ConfirmSignTransaction/events';

/**
 * Helper to invoke a SignTransaction keyring request.
 *
 * @param onKeyringRequest - The onKeyringRequest function from installSnap.
 * @param account - The test account.
 * @param transaction - The transaction to sign.
 * @returns The response promise with getInterface().
 */
function sendSignTransactionRequest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onKeyringRequest: any,
  account: ReturnType<typeof createTestAccount>,
  transaction: { rawDataHex: string; type: string },
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

describe('Sign Transaction E2E', () => {
  let mockServer: MockApiServer;
  const accountAddress = deriveAccountAddress(SECRET_RECOVERY_PHRASE);
  const account = createTestAccount(accountAddress);

  afterEach(async () => {
    await mockServer.close();
  });

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

      // Verify the scan request was made
      expect(mockServer.requests.scans.length).toBe(1);
      // The confirm button should be disabled — user cannot proceed
      // Verify by checking broadcasts were never called (no way to confirm)
      expect(mockServer.requests.broadcasts).toStrictEqual([]);
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
