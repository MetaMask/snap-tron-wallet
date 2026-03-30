/* eslint-disable @typescript-eslint/naming-convention */

import { installSnap } from '@metamask/snaps-jest';
import { TronWeb } from 'tronweb';

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
import { ConfirmSignTransactionFormNames } from '../ui/confirmation/views/ConfirmSignTransaction/events';

/**
 * Returns a minimal valid TronWeb transaction for WithdrawExpireUnfreeze.
 * Must include raw_data.contract with the correct type so the fee calculator
 * recognises it as a zero-energy system contract.
 *
 * @param ownerAddress - The hex-encoded owner address.
 * @returns A mock Transaction object.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function makeMockWithdrawTransaction(ownerAddress: string) {
  return {
    visible: false,
    txID: 'mock-withdraw-txid',

    raw_data: {
      contract: [
        {
          parameter: {
            value: {
              owner_address: ownerAddress,
            },

            type_url:
              'type.googleapis.com/protocol.WithdrawExpireUnfreezeContract',
          },
          type: 'WithdrawExpireUnfreezeContract',
        },
      ],

      ref_block_bytes: '0000',

      ref_block_hash: '0000000000000000',
      expiration: 9999999999999,
      timestamp: 1000000000000,
    },

    raw_data_hex: '0a02000022080000000000000000400fca9a3b5a0012001a00',
  };
}

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
      walletCallResponse: (method, _body) => {
        if (method === 'withdrawexpireunfreeze') {
          return makeMockWithdrawTransaction(account.address);
        }
        return { result: true };
      },
    });
  });

  afterEach(async () => {
    await mockServer.close();
  });

  it('confirms claim and broadcasts withdraw transaction', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
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

    // ClaimUnstakedTrx builds the WithdrawExpireUnfreeze tx, computes fees,
    // then renders the ConfirmSignTransaction dialog fully (all fetch
    // statuses are already Fetched, so no async UI update follows).
    const screen = await response.getInterface();

    await screen.clickElement(ConfirmSignTransactionFormNames.Confirm);

    expect(await response).toMatchObject({
      response: {
        result: { valid: true, errors: [] },
      },
    });

    expect(mockServer.requests.broadcasts).toStrictEqual([
      expect.objectContaining({
        raw_data: expect.objectContaining({
          contract: [
            expect.objectContaining({
              type: 'WithdrawExpireUnfreezeContract',
              parameter: expect.objectContaining({
                value: expect.objectContaining({
                  owner_address: TronWeb.address.toHex(account.address),
                }),
              }),
            }),
          ],
        }),
      }),
    ]);
  }, 60000);

  it('rejects claim when user clicks cancel', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
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

    await screen.clickElement(ConfirmSignTransactionFormNames.Cancel);

    expect(await response).toRespondWithError(
      expect.objectContaining({
        code: expect.any(Number),
      }),
    );
    expect(mockServer.requests.broadcasts).toStrictEqual([]);
  }, 60000);
});
