import { BigNumber } from 'bignumber.js';

import { StakingService } from './StakingService';
import type { SnapClient } from '../../clients/snap/SnapClient';
import type { TronWebFactory } from '../../clients/tronweb/TronWebFactory';
import {
  CONSENSYS_SR_NODE_ADDRESS,
  KnownCaip19Id,
  Network,
} from '../../constants';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import { BackgroundEventMethod } from '../../handlers/cronjob';
import { trxToSun } from '../../utils/conversion';
import { mockLogger } from '../../utils/mockLogger';
import type { AccountsService } from '../accounts/AccountsService';
import type { NativeCaipAssetType, StakedCaipAssetType } from '../assets/types';

const MOCK_ACCOUNT: TronKeyringAccount = {
  id: 'test-account-id',
  address: 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx',
  type: 'eip155:eoa',
  options: {},
  methods: [],
  scopes: ['tron:728126428'],
  entropySource: 'test-entropy',
  derivationPath: "m/44'/195'/0'/0/0",
  index: 0,
};

const MOCK_PRIVATE_KEY_HEX =
  '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

const MOCK_TRANSACTION = {
  txID: 'mock-transaction-id',
  // eslint-disable-next-line @typescript-eslint/naming-convention
  raw_data: { contract: [] },
};

const MOCK_SIGNED_TRANSACTION = {
  ...MOCK_TRANSACTION,
  signature: ['mock-signature'],
};

type WithStakingServiceCallback = (payload: {
  stakingService: StakingService;
  mockAccountsService: jest.Mocked<
    Pick<AccountsService, 'deriveTronKeypair' | 'findByIdOrThrow'>
  >;
  mockTronWebFactory: jest.Mocked<Pick<TronWebFactory, 'createClient'>>;
  mockSnapClient: jest.Mocked<Pick<SnapClient, 'scheduleBackgroundEvent'>>;
  mockTronWeb: {
    transactionBuilder: {
      freezeBalanceV2: jest.Mock;
      unfreezeBalanceV2: jest.Mock;
      vote: jest.Mock;
      withdrawExpireUnfreeze: jest.Mock;
      withdrawBlockRewards: jest.Mock;
    };
    trx: {
      sign: jest.Mock;
      sendRawTransaction: jest.Mock;
    };
  };
}) => void | Promise<void>;

/**
 * Creates a fresh StakingService with all mock dependencies and passes
 * them to the test callback.
 *
 * @param testFn - Callback that receives the service and mocks for testing.
 */
async function withStakingService(
  testFn: WithStakingServiceCallback,
): Promise<void> {
  const mockTronWeb = {
    transactionBuilder: {
      freezeBalanceV2: jest.fn().mockResolvedValue(MOCK_TRANSACTION),
      unfreezeBalanceV2: jest.fn().mockResolvedValue(MOCK_TRANSACTION),
      vote: jest.fn().mockResolvedValue(MOCK_TRANSACTION),
      withdrawExpireUnfreeze: jest.fn().mockResolvedValue(MOCK_TRANSACTION),
      withdrawBlockRewards: jest.fn().mockResolvedValue(MOCK_TRANSACTION),
    },
    trx: {
      sign: jest.fn().mockResolvedValue(MOCK_SIGNED_TRANSACTION),
      sendRawTransaction: jest
        .fn()
        .mockResolvedValue({ result: true, txid: 'mock-tx-id' }),
    },
  };

  const mockAccountsService: jest.Mocked<
    Pick<AccountsService, 'deriveTronKeypair' | 'findByIdOrThrow'>
  > = {
    deriveTronKeypair: jest.fn().mockResolvedValue({
      privateKeyHex: MOCK_PRIVATE_KEY_HEX,
    }),
    findByIdOrThrow: jest.fn().mockResolvedValue(MOCK_ACCOUNT),
  };

  const mockTronWebFactory: jest.Mocked<Pick<TronWebFactory, 'createClient'>> =
    {
      createClient: jest.fn().mockReturnValue(mockTronWeb),
    };

  const mockSnapClient: jest.Mocked<
    Pick<SnapClient, 'scheduleBackgroundEvent'>
  > = {
    scheduleBackgroundEvent: jest.fn().mockResolvedValue(undefined),
  };

  const stakingService = new StakingService({
    logger: mockLogger,
    accountsService: mockAccountsService,
    tronWebFactory: mockTronWebFactory,
    snapClient: mockSnapClient,
  } as unknown as ConstructorParameters<typeof StakingService>[0]);

  await testFn({
    stakingService,
    mockAccountsService,
    mockTronWebFactory,
    mockSnapClient,
    mockTronWeb,
  });
}

describe('StakingService', () => {
  describe('stake', () => {
    it('stakes TRX, votes for Consensys SR node, and schedules sync', async () => {
      await withStakingService(
        async ({
          stakingService,
          mockAccountsService,
          mockTronWebFactory,
          mockSnapClient,
          mockTronWeb,
        }) => {
          const amount = BigNumber(100);

          await stakingService.stake({
            account: MOCK_ACCOUNT,
            assetId: KnownCaip19Id.TrxMainnet,
            amount,
            purpose: 'BANDWIDTH',
          });

          expect(mockAccountsService.deriveTronKeypair).toHaveBeenCalledWith({
            entropySource: MOCK_ACCOUNT.entropySource,
            derivationPath: MOCK_ACCOUNT.derivationPath,
          });
          expect(mockTronWebFactory.createClient).toHaveBeenCalledWith(
            Network.Mainnet,
            MOCK_PRIVATE_KEY_HEX,
          );
          expect(
            mockTronWeb.transactionBuilder.freezeBalanceV2,
          ).toHaveBeenCalledWith(
            Number(trxToSun(amount)),
            'BANDWIDTH',
            MOCK_ACCOUNT.address,
          );
          expect(mockTronWeb.trx.sign).toHaveBeenCalledWith(MOCK_TRANSACTION);
          expect(mockTronWeb.trx.sendRawTransaction).toHaveBeenCalledWith(
            MOCK_SIGNED_TRANSACTION,
          );
          expect(mockTronWeb.transactionBuilder.vote).toHaveBeenCalledWith(
            { [CONSENSYS_SR_NODE_ADDRESS]: 100 },
            MOCK_ACCOUNT.address,
          );
          expect(mockSnapClient.scheduleBackgroundEvent).toHaveBeenCalledWith({
            method: BackgroundEventMethod.SynchronizeAccount,
            params: { accountId: MOCK_ACCOUNT.id },
            duration: 'PT5S',
          });
        },
      );
    });

    it('uses custom SR node address when provided', async () => {
      await withStakingService(async ({ stakingService, mockTronWeb }) => {
        const customSrNodeAddress = 'TSR1234567890abcdefghijklmnopqrstuv';

        await stakingService.stake({
          account: MOCK_ACCOUNT,
          assetId: KnownCaip19Id.TrxMainnet,
          amount: BigNumber(100),
          purpose: 'BANDWIDTH',
          srNodeAddress: customSrNodeAddress,
        });

        expect(mockTronWeb.transactionBuilder.vote).toHaveBeenCalledWith(
          { [customSrNodeAddress]: 100 },
          MOCK_ACCOUNT.address,
        );
      });
    });

    it.each([
      { assetId: KnownCaip19Id.TrxMainnet, expectedNetwork: Network.Mainnet },
      { assetId: KnownCaip19Id.TrxNile, expectedNetwork: Network.Nile },
      { assetId: KnownCaip19Id.TrxShasta, expectedNetwork: Network.Shasta },
    ])(
      'stakes on $expectedNetwork based on assetId',
      async ({ assetId, expectedNetwork }) => {
        await withStakingService(
          async ({ stakingService, mockTronWebFactory }) => {
            await stakingService.stake({
              account: MOCK_ACCOUNT,
              assetId: assetId as NativeCaipAssetType,
              amount: BigNumber(1),
              purpose: 'ENERGY',
            });

            expect(mockTronWebFactory.createClient).toHaveBeenCalledWith(
              expectedNetwork,
              MOCK_PRIVATE_KEY_HEX,
            );
          },
        );
      },
    );
  });

  describe('unstake', () => {
    it('unstakes TRX for BANDWIDTH and schedules sync', async () => {
      await withStakingService(
        async ({
          stakingService,
          mockAccountsService,
          mockTronWebFactory,
          mockSnapClient,
          mockTronWeb,
        }) => {
          const amount = BigNumber(1000000);

          await stakingService.unstake({
            account: MOCK_ACCOUNT,
            assetId: KnownCaip19Id.TrxStakedForBandwidthMainnet,
            amount,
          });

          expect(mockAccountsService.deriveTronKeypair).toHaveBeenCalledWith({
            entropySource: MOCK_ACCOUNT.entropySource,
            derivationPath: MOCK_ACCOUNT.derivationPath,
          });
          expect(mockTronWebFactory.createClient).toHaveBeenCalledWith(
            Network.Mainnet,
            MOCK_PRIVATE_KEY_HEX,
          );
          expect(
            mockTronWeb.transactionBuilder.unfreezeBalanceV2,
          ).toHaveBeenCalledWith(
            Number(trxToSun(amount)),
            'BANDWIDTH',
            MOCK_ACCOUNT.address,
          );
          expect(mockTronWeb.trx.sign).toHaveBeenCalledWith(MOCK_TRANSACTION);
          expect(mockTronWeb.trx.sendRawTransaction).toHaveBeenCalledWith(
            MOCK_SIGNED_TRANSACTION,
          );
          expect(mockSnapClient.scheduleBackgroundEvent).toHaveBeenCalledWith({
            method: BackgroundEventMethod.SynchronizeAccount,
            params: { accountId: MOCK_ACCOUNT.id },
            duration: 'PT5S',
          });
        },
      );
    });

    it('unstakes TRX for ENERGY', async () => {
      await withStakingService(async ({ stakingService, mockTronWeb }) => {
        await stakingService.unstake({
          account: MOCK_ACCOUNT,
          assetId: KnownCaip19Id.TrxStakedForEnergyMainnet,
          amount: BigNumber(2000000),
        });

        expect(
          mockTronWeb.transactionBuilder.unfreezeBalanceV2,
        ).toHaveBeenCalledWith(
          Number(trxToSun(2000000)),
          'ENERGY',
          MOCK_ACCOUNT.address,
        );
      });
    });

    it.each([
      {
        assetId: KnownCaip19Id.TrxStakedForBandwidthMainnet,
        expectedNetwork: Network.Mainnet,
      },
      {
        assetId: KnownCaip19Id.TrxStakedForBandwidthNile,
        expectedNetwork: Network.Nile,
      },
      {
        assetId: KnownCaip19Id.TrxStakedForBandwidthShasta,
        expectedNetwork: Network.Shasta,
      },
    ])(
      'unstakes on $expectedNetwork based on assetId',
      async ({ assetId, expectedNetwork }) => {
        await withStakingService(
          async ({ stakingService, mockTronWebFactory }) => {
            await stakingService.unstake({
              account: MOCK_ACCOUNT,
              assetId: assetId as StakedCaipAssetType,
              amount: BigNumber(1),
            });

            expect(mockTronWebFactory.createClient).toHaveBeenCalledWith(
              expectedNetwork,
              MOCK_PRIVATE_KEY_HEX,
            );
          },
        );
      },
    );

    it('throws error for invalid asset ID', async () => {
      await withStakingService(async ({ stakingService }) => {
        await expect(
          stakingService.unstake({
            account: MOCK_ACCOUNT,
            assetId: 'tron:728126428/slip44:invalid' as StakedCaipAssetType,
            amount: BigNumber(1000000),
          }),
        ).rejects.toThrow('Invalid asset ID');
      });
    });
  });

  describe('claimUnstakedTrx', () => {
    it('builds, signs, and broadcasts a withdrawExpireUnfreeze transaction', async () => {
      await withStakingService(
        async ({
          stakingService,
          mockAccountsService,
          mockTronWebFactory,
          mockSnapClient,
          mockTronWeb,
        }) => {
          await stakingService.claimUnstakedTrx({
            account: MOCK_ACCOUNT,
            scope: Network.Mainnet,
          });

          expect(mockAccountsService.deriveTronKeypair).toHaveBeenCalledWith({
            entropySource: MOCK_ACCOUNT.entropySource,
            derivationPath: MOCK_ACCOUNT.derivationPath,
          });
          expect(mockTronWebFactory.createClient).toHaveBeenCalledWith(
            Network.Mainnet,
            MOCK_PRIVATE_KEY_HEX,
          );
          expect(
            mockTronWeb.transactionBuilder.withdrawExpireUnfreeze,
          ).toHaveBeenCalledWith(MOCK_ACCOUNT.address);
          expect(mockTronWeb.trx.sign).toHaveBeenCalledWith(MOCK_TRANSACTION);
          expect(mockTronWeb.trx.sendRawTransaction).toHaveBeenCalledWith(
            MOCK_SIGNED_TRANSACTION,
          );
          expect(mockSnapClient.scheduleBackgroundEvent).toHaveBeenCalledWith({
            method: BackgroundEventMethod.SynchronizeAccount,
            params: { accountId: MOCK_ACCOUNT.id },
            duration: 'PT5S',
          });
        },
      );
    });
  });

  describe('claimTrxStakingRewards', () => {
    it('builds, signs, and broadcasts a withdrawBlockRewards transaction', async () => {
      await withStakingService(
        async ({
          stakingService,
          mockAccountsService,
          mockTronWebFactory,
          mockSnapClient,
          mockTronWeb,
        }) => {
          await stakingService.claimTrxStakingRewards({
            account: MOCK_ACCOUNT,
            scope: Network.Mainnet,
          });

          expect(mockAccountsService.deriveTronKeypair).toHaveBeenCalledWith({
            entropySource: MOCK_ACCOUNT.entropySource,
            derivationPath: MOCK_ACCOUNT.derivationPath,
          });
          expect(mockTronWebFactory.createClient).toHaveBeenCalledWith(
            Network.Mainnet,
            MOCK_PRIVATE_KEY_HEX,
          );
          expect(
            mockTronWeb.transactionBuilder.withdrawBlockRewards,
          ).toHaveBeenCalledWith(MOCK_ACCOUNT.address);
          expect(mockTronWeb.trx.sign).toHaveBeenCalledWith(MOCK_TRANSACTION);
          expect(mockTronWeb.trx.sendRawTransaction).toHaveBeenCalledWith(
            MOCK_SIGNED_TRANSACTION,
          );
          expect(mockSnapClient.scheduleBackgroundEvent).toHaveBeenCalledWith({
            method: BackgroundEventMethod.SynchronizeAccount,
            params: { accountId: MOCK_ACCOUNT.id },
            duration: 'PT5S',
          });
        },
      );
    });
  });
});
