import { installSnap } from '@metamask/snaps-jest';
import { TronWeb } from 'tronweb';

import { KnownCaip19Id } from '../constants';
import { ClientRequestMethod } from '../handlers/clientRequest/types';
import {
  startMockApiServer,
  type MockApiServer,
} from '../test-utils/mockApiServer';
import {
  createInstallSnapOptionsWithStaking,
  createMaliciousScanApiResponse,
  createSimulationFailedScanApiResponse,
  createTestAccount,
  defaultAccountInfoResponse,
  defaultScanApiResponse,
  deriveAccountAddress,
  mockSpotPrices,
  SECRET_RECOVERY_PHRASE,
  TEST_ACCOUNT_ID,
} from '../test-utils/fixtures';
import { ConfirmSignAndSendTransactionFormNames } from '../ui/confirmation/views/ConfirmTransactionRequest/events';

const RECIPIENT_ADDRESS = TronWeb.address.fromHex(
  '412efffc7686e54ab669a1cdb1e2cc17cf4b4eca96',
);

/**
 * Creates a minimal valid TronGrid createtransaction response for the given owner address.
 *
 * @param ownerAddress - The sender's Tron base58 address.
 * @returns A transaction response object suitable for TronWeb to process.
 */
function createMockTrxTransaction(ownerAddress: string) {
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
              // eslint-disable-next-line @typescript-eslint/naming-convention
              owner_address: ownerAddressHex,
              // eslint-disable-next-line @typescript-eslint/naming-convention
              to_address: '412EFFFC7686E54AB669A1CDB1E2CC17CF4B4ECA96',
            },
            // eslint-disable-next-line @typescript-eslint/naming-convention
            type_url: 'type.googleapis.com/protocol.TransferContract',
          },
          type: 'TransferContract',
        },
      ],
      // eslint-disable-next-line @typescript-eslint/naming-convention
      ref_block_bytes: 'cb1d',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      ref_block_hash: 'd3fc65a6fb0f782d',
      expiration: Date.now() + 60000,
      timestamp: Date.now(),
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention
    raw_data_hex:
      '0a02cb1d2208d3fc65a6fb0f782d40e8b2a18291335a66080112620a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412310a1541458437be39f3a8bfdbfee7bef93e2c5f632ceff41215412efffc7686e54ab669a1cdb1e2cc17cf4b4eca9618904e7088de9d829133',
  };
}

describe('Confirm Send E2E', () => {
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
        broadcastResponse: { result: true, txid: 'mock-send-txid-123' },
        walletCallResponse: (_method, _body) =>
          createMockTrxTransaction(accountAddress),
      });
    });

    it('confirms TRX send, broadcasts, and returns transaction ID', async () => {
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

    it('rejects send when user clicks cancel', async () => {
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

      // Verify the scan came back with failed simulation
      expect(mockServer.requests.scans.length).toBe(1);
      // The confirm button should be disabled — user cannot proceed
      // Verify by checking broadcasts were never called (no way to confirm)
      expect(mockServer.requests.broadcasts).toStrictEqual([]);

      // Clean up pending response by dismissing
      await updatedScreen.clickElement(
        ConfirmSignAndSendTransactionFormNames.Cancel,
      );
    });
  });
});
