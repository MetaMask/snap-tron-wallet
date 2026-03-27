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

/**
 * Returns a minimal valid TronWeb transaction object for freeze/vote responses.
 * TronWeb's trx.sign() expects raw_data_hex and txID directly on the object.
 *
 * @param txId - The transaction ID to use in the response.
 * @returns A mock transaction object.
 */
function makeMockTransaction(txId: string) {
  return {
    raw_data: {
      contract: [],
      ref_block_bytes: '0000',
      ref_block_hash: '0000000000000000',
      expiration: 9999999999999,
      timestamp: 1000000000000,
    },
    raw_data_hex:
      '0a02000022080000000000000000400fca9a3b5a0012001a00',
    txID: txId,
    visible: false,
  };
}

describe('Confirm Stake E2E', () => {
  let mockServer: MockApiServer;
  const accountAddress = deriveAccountAddress(SECRET_RECOVERY_PHRASE);
  const account = createTestAccount(accountAddress);

  beforeEach(async () => {
    mockServer = await startMockApiServer({
      spotPricesResponse: mockSpotPrices,
      scanResponse: defaultScanApiResponse,
      accountInfoResponse: defaultAccountInfoResponse,
      broadcastResponse: { result: true, txid: 'mock-stake-txid' },
      walletCallResponse: (method, _body) => {
        // Return a valid-looking transaction for freeze and vote calls
        if (method === 'freezebalancev2') {
          return makeMockTransaction('mock-freeze-txid');
        }
        if (method === 'votewitnessaccount') {
          return makeMockTransaction('mock-vote-txid');
        }
        return { result: true };
      },
    });
  });

  afterEach(async () => {
    await mockServer.close();
  });

  it('stakes TRX by broadcasting freeze and vote transactions', async () => {
    const { onClientRequest, mockJsonRpc } = await installSnap({
      options: createInstallSnapOptionsWithStaking(account),
    });
    mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });

    // ConfirmStake has NO confirmation UI — await directly
    const response = await onClientRequest({
      method: ClientRequestMethod.ConfirmStake,
      params: {
        fromAccountId: TEST_ACCOUNT_ID,
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

    // TronWeb builds freeze/vote transactions locally (via getblock + protobuf)
    // and broadcasts them. Verify broadcasts were made.
    expect(mockServer.requests.broadcasts.length).toBeGreaterThanOrEqual(2);
    expect(mockServer.requests.unhandled).toStrictEqual([]);
  });
});
