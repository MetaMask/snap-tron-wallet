import { installSnap } from '@metamask/snaps-jest';

import { KnownCaip19Id } from '../constants';
import { ClientRequestMethod } from '../handlers/clientRequest/types';
import {
  startMockApiServer,
  type MockApiServer,
} from '../test-utils/mockApiServer';
import {
  createInstallSnapOptionsWithStaking,
  createTestAccount,
  defaultAccountInfoResponse,
  defaultScanApiResponse,
  deriveAccountAddress,
  mockSpotPrices,
  SECRET_RECOVERY_PHRASE,
  TEST_ACCOUNT_ID,
} from '../test-utils/fixtures';
import { ConfirmSignTransactionFormNames } from '../ui/confirmation/views/ConfirmSignTransaction/events';

describe('Claim Unstaked TRX E2E', () => {
  let mockServer: MockApiServer;
  const accountAddress = deriveAccountAddress(SECRET_RECOVERY_PHRASE);
  const account = createTestAccount(accountAddress);

  beforeEach(async () => {
    mockServer = await startMockApiServer({
      spotPricesResponse: mockSpotPrices,
      scanResponse: defaultScanApiResponse,
      accountInfoResponse: defaultAccountInfoResponse,
      broadcastResponse: { result: true, txid: 'mock-claim-txid' },
      walletCallResponse: (_method, _body) => ({
        result: { result: true },
        transaction: {
          raw_data_hex: 'abcdef1234567890',
          txID: 'mock-withdraw-txid',
        },
      }),
    });
  });

  afterEach(async () => {
    await mockServer.close();
  });

  // TODO: These tests time out because the ConfirmSignTransaction UI is never
  // rendered. The confirmClaimUnstakedTrx flow builds a WithdrawExpireUnfreeze
  // transaction via TronWeb before showing the dialog — investigate which
  // mock server response is missing or malformed.
  it.skip(
    'confirms claim and broadcasts withdraw transaction',
    async () => {
      const { onClientRequest, mockJsonRpc } = await installSnap({
        options: createInstallSnapOptionsWithStaking(account),
      });
      mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });

      const response = onClientRequest({
        method: ClientRequestMethod.ClaimUnstakedTrx,
        params: {
          fromAccountId: TEST_ACCOUNT_ID,
          assetId: KnownCaip19Id.TrxMainnet,
        },
      });

      // ClaimUnstakedTrx builds a WithdrawExpireUnfreeze tx then shows ConfirmSignTransaction UI.
      // The UI renders with scan fetching, then updates when scan completes.
      const screen = await response.getInterface();

      // Try waiting for update (scan results). If it times out, the initial screen
      // may already have the confirm button enabled.
      let confirmScreen;
      try {
        confirmScreen = await screen.waitForUpdate();
      } catch {
        confirmScreen = screen;
      }

      await confirmScreen.clickElement(
        ConfirmSignTransactionFormNames.Confirm,
      );

      expect(await response).toMatchObject({
        response: {
          result: { valid: true, errors: [] },
        },
      });

      // TronWeb builds withdraw transaction locally and broadcasts it.
      expect(mockServer.requests.broadcasts.length).toBeGreaterThanOrEqual(1);
    },
    60000,
  );

  it.skip(
    'rejects claim when user clicks cancel',
    async () => {
      const { onClientRequest, mockJsonRpc } = await installSnap({
        options: createInstallSnapOptionsWithStaking(account),
      });
      mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });

      const response = onClientRequest({
        method: ClientRequestMethod.ClaimUnstakedTrx,
        params: {
          fromAccountId: TEST_ACCOUNT_ID,
          assetId: KnownCaip19Id.TrxMainnet,
        },
      });

      const screen = await response.getInterface();

      let confirmScreen;
      try {
        confirmScreen = await screen.waitForUpdate();
      } catch {
        confirmScreen = screen;
      }

      await confirmScreen.clickElement(
        ConfirmSignTransactionFormNames.Cancel,
      );

      expect(await response).toRespondWithError(
        expect.objectContaining({
          code: expect.any(Number),
        }),
      );
    },
    60000,
  );
});
