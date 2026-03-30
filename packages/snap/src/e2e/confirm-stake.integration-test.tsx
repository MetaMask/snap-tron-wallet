/* eslint-disable @typescript-eslint/naming-convention */

import { installSnap } from '@metamask/snaps-jest';
import { TronWeb } from 'tronweb';

import { CONSENSYS_SR_NODE_ADDRESS, KnownCaip19Id } from '../constants';
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

/**
 * Returns a minimal valid TronWeb transaction object for freeze/vote responses.
 * TronWeb's trx.sign() expects raw_data_hex and txID directly on the object.
 *
 * @param txId - The transaction ID to use in the response.
 * @returns A mock transaction object.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function makeMockTransaction(txId: string) {
  return {
    raw_data: {
      contract: [],

      ref_block_bytes: '0000',

      ref_block_hash: '0000000000000000',
      expiration: 9999999999999,
      timestamp: 1000000000000,
    },

    raw_data_hex: '0a02000022080000000000000000400fca9a3b5a0012001a00',
    txID: txId,
    visible: false,
  };
}

const CUSTOM_SR_NODE_ADDRESS = TronWeb.address.fromHex(
  '412efffc7686e54ab669a1cdb1e2cc17cf4b4eca96',
);

/**
 * Creates install options with a custom native TRX balance for the test account.
 *
 * @param account - The account whose TRX balance should be updated.
 * @param balanceInTrx - The TRX balance to expose in state.
 * @returns Install options with the requested TRX balance.
 */
function createInstallSnapOptionsWithNativeBalance(
  account: ReturnType<typeof createTestAccount>,
  balanceInTrx: string,
): ReturnType<typeof createInstallSnapOptionsWithStaking> {
  const options = createInstallSnapOptionsWithStaking(account);
  const rawAmount = `${Number(balanceInTrx) * 1_000_000}`;

  return {
    ...options,
    unencryptedState: {
      ...options.unencryptedState,
      assets: {
        ...options.unencryptedState.assets,
        [account.id]: (options.unencryptedState.assets[account.id] ?? []).map(
          (asset) =>
            asset.assetType === KnownCaip19Id.TrxMainnet
              ? {
                  ...asset,
                  uiAmount: balanceInTrx,
                  rawAmount,
                }
              : asset,
        ),
      },
    },
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
    // eslint-disable-next-line @typescript-eslint/unbound-method
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

    expect(mockServer.requests.broadcasts).toStrictEqual([
      expect.objectContaining({
        raw_data: expect.objectContaining({
          contract: [
            expect.objectContaining({
              type: 'FreezeBalanceV2Contract',
              parameter: expect.objectContaining({
                value: expect.objectContaining({
                  owner_address: TronWeb.address.toHex(account.address),
                  frozen_balance: 10000000,
                }),
              }),
            }),
          ],
        }),
      }),
      expect.objectContaining({
        raw_data: expect.objectContaining({
          contract: [
            expect.objectContaining({
              type: 'VoteWitnessContract',
              parameter: expect.objectContaining({
                value: expect.objectContaining({
                  owner_address: TronWeb.address.toHex(account.address),
                  votes: [
                    {
                      vote_address: TronWeb.address.toHex(
                        CONSENSYS_SR_NODE_ADDRESS,
                      ),
                      vote_count: 10,
                    },
                  ],
                }),
              }),
            }),
          ],
        }),
      }),
    ]);
    expect(mockServer.requests.unhandled).toStrictEqual([]);
  });

  it('stakes TRX for ENERGY and preserves the energy resource in the freeze request', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { onClientRequest, mockJsonRpc } = await installSnap({
      options: createInstallSnapOptionsWithStaking(account),
    });
    mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });

    const response = await onClientRequest({
      method: ClientRequestMethod.ConfirmStake,
      params: {
        fromAccountId: TEST_ACCOUNT_ID,
        assetId: KnownCaip19Id.TrxMainnet,
        value: '10',
        options: {
          purpose: 'ENERGY',
        },
      },
    });

    expect(response).toMatchObject({
      response: {
        result: { valid: true, errors: [] },
      },
    });

    expect(mockServer.requests.broadcasts).toStrictEqual([
      expect.objectContaining({
        raw_data: expect.objectContaining({
          contract: [
            expect.objectContaining({
              type: 'FreezeBalanceV2Contract',
              parameter: expect.objectContaining({
                value: expect.objectContaining({
                  owner_address: TronWeb.address.toHex(account.address),
                  frozen_balance: 10000000,
                  resource: 'ENERGY',
                }),
              }),
            }),
          ],
        }),
      }),
      expect.objectContaining({
        raw_data: expect.objectContaining({
          contract: [
            expect.objectContaining({
              type: 'VoteWitnessContract',
              parameter: expect.objectContaining({
                value: expect.objectContaining({
                  owner_address: TronWeb.address.toHex(account.address),
                  votes: [
                    {
                      vote_address: TronWeb.address.toHex(
                        CONSENSYS_SR_NODE_ADDRESS,
                      ),
                      vote_count: 10,
                    },
                  ],
                }),
              }),
            }),
          ],
        }),
      }),
    ]);
  });

  it('stakes TRX and votes for the requested SR node when srNodeAddress is provided', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { onClientRequest, mockJsonRpc } = await installSnap({
      options: createInstallSnapOptionsWithStaking(account),
    });
    mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });

    const response = await onClientRequest({
      method: ClientRequestMethod.ConfirmStake,
      params: {
        fromAccountId: TEST_ACCOUNT_ID,
        assetId: KnownCaip19Id.TrxMainnet,
        value: '10',
        options: {
          purpose: 'BANDWIDTH',
          srNodeAddress: CUSTOM_SR_NODE_ADDRESS,
        },
      },
    });

    expect(response).toMatchObject({
      response: {
        result: { valid: true, errors: [] },
      },
    });

    expect(mockServer.requests.broadcasts).toStrictEqual([
      expect.objectContaining({
        raw_data: expect.objectContaining({
          contract: [
            expect.objectContaining({
              type: 'FreezeBalanceV2Contract',
              parameter: expect.objectContaining({
                value: expect.objectContaining({
                  owner_address: TronWeb.address.toHex(account.address),
                  frozen_balance: 10000000,
                }),
              }),
            }),
          ],
        }),
      }),
      expect.objectContaining({
        raw_data: expect.objectContaining({
          contract: [
            expect.objectContaining({
              type: 'VoteWitnessContract',
              parameter: expect.objectContaining({
                value: expect.objectContaining({
                  owner_address: TronWeb.address.toHex(account.address),
                  votes: [
                    {
                      vote_address: TronWeb.address.toHex(
                        CUSTOM_SR_NODE_ADDRESS,
                      ),
                      vote_count: 10,
                    },
                  ],
                }),
              }),
            }),
          ],
        }),
      }),
    ]);
  });

  it('returns insufficient balance when the account cannot cover the stake amount', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { onClientRequest, mockJsonRpc } = await installSnap({
      options: createInstallSnapOptionsWithNativeBalance(account, '5'),
    });
    mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });

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
        result: {
          valid: false,
          errors: [{ code: 'InsufficientBalance' }],
        },
      },
    });
    expect(mockServer.requests.broadcasts).toStrictEqual([]);
  });
});
