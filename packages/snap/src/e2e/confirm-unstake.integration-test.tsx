import { installSnap } from '@metamask/snaps-jest';

import { KnownCaip19Id } from '../constants';
import { ClientRequestMethod } from '../handlers/clientRequest/types';
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
import {
  startMockApiServer,
  type MockApiServer,
} from '../test-utils/mockApiServer';

describe('Confirm Unstake E2E', () => {
  let mockServer: MockApiServer;
  const accountAddress = deriveAccountAddress(SECRET_RECOVERY_PHRASE);
  const account = createTestAccount(accountAddress);

  beforeEach(async () => {
    mockServer = await startMockApiServer({
      spotPricesResponse: mockSpotPrices,
      scanResponse: defaultScanApiResponse,
      accountInfoResponse: defaultAccountInfoResponse,
      broadcastResponse: { result: true, txid: 'mock-unstake-txid' },
      walletCallResponse: (_method, _body) => ({
        result: { result: true },
        transaction: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          raw_data_hex: 'abcdef1234567890',
          txID: 'mock-unfreeze-txid',
        },
      }),
    });
  });

  afterEach(async () => {
    await mockServer.close();
  });

  it('unstakes TRX by broadcasting unfreeze transaction', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { onClientRequest, mockJsonRpc } = await installSnap({
      options: createInstallSnapOptionsWithStaking(account),
    });
    mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });

    const response = await onClientRequest({
      method: ClientRequestMethod.ConfirmUnstake,
      params: {
        accountId: TEST_ACCOUNT_ID,
        assetId: KnownCaip19Id.TrxMainnet,
        value: '10',
        options: {
          purpose: 'BANDWIDTH',
        },
      },
    });

    expect(response).toMatchObject({
      response: {
        result: { valid: true, errors: [] },
      },
    });

    // TronWeb builds unfreeze transaction locally and broadcasts it.
    expect(mockServer.requests.broadcasts.length).toBeGreaterThanOrEqual(1);
    expect(mockServer.requests.unhandled).toStrictEqual([]);
  });
});
