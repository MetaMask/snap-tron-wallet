/* eslint-disable @typescript-eslint/naming-convention */

import { installSnap } from '@metamask/snaps-jest';
import { TronWeb } from 'tronweb';

import { KnownCaip19Id, Network, Networks } from '../constants';
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
 * Creates install options with a custom staked balance for the requested resource.
 *
 * @param account - The account whose assets should be updated.
 * @param purpose - The staking resource to update.
 * @param balanceInTrx - The staked balance in TRX.
 * @returns Install options with the requested staked balance.
 */
function createInstallSnapOptionsWithStakedBalance(
  account: ReturnType<typeof createTestAccount>,
  purpose: 'BANDWIDTH' | 'ENERGY',
  balanceInTrx: string,
): ReturnType<typeof createInstallSnapOptionsWithStaking> {
  const options = createInstallSnapOptionsWithStaking(account);
  const rawAmount = `${Number(balanceInTrx) * 1_000_000}`;
  const stakedAsset =
    purpose === 'ENERGY'
      ? {
          assetType: Networks[Network.Mainnet].stakedForEnergy.id,
          keyringAccountId: account.id,
          network: Network.Mainnet,
          symbol: Networks[Network.Mainnet].stakedForEnergy.symbol,
          decimals: Networks[Network.Mainnet].stakedForEnergy.decimals,
          rawAmount,
          uiAmount: balanceInTrx,
          iconUrl: Networks[Network.Mainnet].stakedForEnergy.iconUrl,
        }
      : null;

  return {
    ...options,
    unencryptedState: {
      ...options.unencryptedState,
      assets: {
        ...options.unencryptedState.assets,
        [account.id]: [
          ...(options.unencryptedState.assets[account.id] ?? [])
            .filter((asset) =>
              purpose === 'ENERGY'
                ? asset.assetType !==
                  Networks[Network.Mainnet].stakedForEnergy.id
                : asset.assetType !==
                  Networks[Network.Mainnet].stakedForBandwidth.id,
            )
            .map((asset) =>
              asset.assetType ===
              Networks[Network.Mainnet].stakedForBandwidth.id
                ? {
                    ...asset,
                    rawAmount,
                    uiAmount: balanceInTrx,
                  }
                : asset,
            ),
          ...(stakedAsset ? [stakedAsset] : []),
        ],
      },
    },
  };
}

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

    expect(mockServer.requests.broadcasts).toStrictEqual([
      expect.objectContaining({
        raw_data: expect.objectContaining({
          contract: [
            expect.objectContaining({
              type: 'UnfreezeBalanceV2Contract',
              parameter: expect.objectContaining({
                value: expect.objectContaining({
                  owner_address: TronWeb.address.toHex(account.address),
                  unfreeze_balance: 10000000,
                }),
              }),
            }),
          ],
        }),
      }),
    ]);
    expect(mockServer.requests.unhandled).toStrictEqual([]);
  });

  it('unstakes TRX staked for ENERGY and preserves the energy resource in the broadcast', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { onClientRequest, mockJsonRpc } = await installSnap({
      options: createInstallSnapOptionsWithStakedBalance(
        account,
        'ENERGY',
        '50',
      ),
    });
    mockJsonRpc({ method: 'snap_scheduleBackgroundEvent', result: {} });

    const response = await onClientRequest({
      method: ClientRequestMethod.ConfirmUnstake,
      params: {
        accountId: TEST_ACCOUNT_ID,
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
              type: 'UnfreezeBalanceV2Contract',
              parameter: expect.objectContaining({
                value: expect.objectContaining({
                  owner_address: TronWeb.address.toHex(account.address),
                  unfreeze_balance: 10000000,
                  resource: 'ENERGY',
                }),
              }),
            }),
          ],
        }),
      }),
    ]);
  });

  it('returns insufficient balance when the account cannot cover the unstake amount', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { onClientRequest, mockJsonRpc } = await installSnap({
      options: createInstallSnapOptionsWithStakedBalance(
        account,
        'BANDWIDTH',
        '5',
      ),
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
        result: {
          valid: false,
          errors: [{ code: 'InsufficientBalance' }],
        },
      },
    });
    expect(mockServer.requests.broadcasts).toStrictEqual([]);
  });
});
