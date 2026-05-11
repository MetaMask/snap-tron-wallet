/* eslint-disable @typescript-eslint/naming-convention */
import { FeeType } from '@metamask/keyring-api';
import { BigNumber } from 'bignumber.js';

import { StakingService } from './StakingService';
import { CONSENSYS_SR_NODE_ADDRESS, Network, Networks } from '../../constants';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import { mockLogger } from '../../utils/mockLogger';

const ACCOUNT = {
  id: 'account-id',
  address: 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx',
} as TronKeyringAccount;

const createTransaction = (txID: string) =>
  ({
    txID,
    raw_data: {
      contract: [
        {
          type: 'FreezeBalanceV2Contract',
          parameter: {
            value: {
              owner_address: ACCOUNT.address,
            },
          },
        },
      ],
    },
    raw_data_hex: '0a0b0c',
  }) as any;

const createFee = (assetType: string, amount: string) => ({
  type: FeeType.Base,
  asset: {
    unit: assetType.includes('energy') ? 'ENERGY' : 'BANDWIDTH',
    type: assetType,
    amount,
    fungible: true as const,
  },
});

describe('StakingService', () => {
  let freezeBalanceV2: jest.Mock;
  let vote: jest.Mock;
  let unfreezeBalanceV2: jest.Mock;
  let withdrawExpireUnfreeze: jest.Mock;
  let withdrawBlockRewards: jest.Mock;
  let tronWebFactory: any;
  let transactionService: any;
  let service: StakingService;

  beforeEach(() => {
    freezeBalanceV2 = jest.fn().mockResolvedValue(createTransaction('freeze'));
    vote = jest.fn().mockResolvedValue(createTransaction('vote'));
    unfreezeBalanceV2 = jest
      .fn()
      .mockResolvedValue(createTransaction('unfreeze'));
    withdrawExpireUnfreeze = jest
      .fn()
      .mockResolvedValue(createTransaction('withdraw-unfrozen'));
    withdrawBlockRewards = jest
      .fn()
      .mockResolvedValue(createTransaction('withdraw-rewards'));

    tronWebFactory = {
      createClient: jest.fn().mockReturnValue({
        transactionBuilder: {
          freezeBalanceV2,
          vote,
          unfreezeBalanceV2,
          withdrawExpireUnfreeze,
          withdrawBlockRewards,
        },
      }),
    };
    transactionService = {
      estimateFees: jest.fn().mockResolvedValue([]),
      broadcastMany: jest.fn().mockResolvedValue([]),
    };

    service = new StakingService({
      logger: mockLogger,
      tronWebFactory,
      transactionService,
    });
  });

  it('builds stake and vote transactions with the default SR node', async () => {
    const transactions = await service.buildStakeTransactions({
      account: ACCOUNT,
      assetId: Networks[Network.Mainnet].nativeToken.id,
      amount: new BigNumber('10.5'),
      purpose: 'ENERGY',
    });

    expect(tronWebFactory.createClient).toHaveBeenCalledWith(Network.Mainnet);
    expect(freezeBalanceV2).toHaveBeenCalledWith(
      10_500_000,
      'ENERGY',
      ACCOUNT.address,
    );
    expect(vote).toHaveBeenCalledWith(
      { [CONSENSYS_SR_NODE_ADDRESS]: 10 },
      ACCOUNT.address,
    );
    expect(transactions).toStrictEqual([
      createTransaction('freeze'),
      createTransaction('vote'),
    ]);
  });

  it('uses the provided SR node when building stake transactions', async () => {
    await service.buildStakeTransactions({
      account: ACCOUNT,
      assetId: Networks[Network.Mainnet].nativeToken.id,
      amount: new BigNumber('3'),
      purpose: 'BANDWIDTH',
      srNodeAddress: 'TVMwGfdDz58VvM7yTzGMWWSHsmofSxa9jH',
    });

    expect(vote).toHaveBeenCalledWith(
      { TVMwGfdDz58VvM7yTzGMWWSHsmofSxa9jH: 3 },
      ACCOUNT.address,
    );
  });

  it('estimates stake fees for all built transactions and merges fee assets', async () => {
    transactionService.estimateFees.mockResolvedValue([
      [
        createFee(Networks[Network.Mainnet].energy.id, '10'),
        createFee(Networks[Network.Mainnet].bandwidth.id, '2'),
      ],
      [
        createFee(Networks[Network.Mainnet].energy.id, '15'),
        createFee(Networks[Network.Mainnet].bandwidth.id, '3'),
      ],
    ]);

    const result = await service.estimateStakeFee({
      account: ACCOUNT,
      assetId: Networks[Network.Mainnet].nativeToken.id,
      amount: new BigNumber('10'),
      purpose: 'ENERGY',
    });

    expect(transactionService.estimateFees).toHaveBeenCalledWith({
      scope: Network.Mainnet,
      accountId: ACCOUNT.id,
      transactions: [createTransaction('freeze'), createTransaction('vote')],
    });
    expect(result).toStrictEqual([
      createFee(Networks[Network.Mainnet].energy.id, '25'),
      createFee(Networks[Network.Mainnet].bandwidth.id, '5'),
    ]);
  });

  it('broadcasts stake transactions with one account sync tracking request', async () => {
    await service.stake({
      account: ACCOUNT,
      assetId: Networks[Network.Mainnet].nativeToken.id,
      amount: new BigNumber('10'),
      purpose: 'ENERGY',
    });

    expect(transactionService.broadcastMany).toHaveBeenCalledWith({
      scope: Network.Mainnet,
      accountId: ACCOUNT.id,
      transactions: [createTransaction('freeze'), createTransaction('vote')],
      tracking: { type: 'accountSync' },
    });
  });

  it('broadcasts unstake transactions with account sync tracking', async () => {
    await service.unstake({
      account: ACCOUNT,
      assetId: Networks[Network.Mainnet].stakedForEnergy.id as any,
      amount: new BigNumber('2'),
    });

    expect(unfreezeBalanceV2).toHaveBeenCalledWith(
      2_000_000,
      'ENERGY',
      ACCOUNT.address,
    );
    expect(transactionService.broadcastMany).toHaveBeenCalledWith({
      scope: Network.Mainnet,
      accountId: ACCOUNT.id,
      transactions: [createTransaction('unfreeze')],
      tracking: { type: 'accountSync' },
    });
  });

  it('throws for invalid staked asset IDs', async () => {
    await expect(
      service.buildUnstakeTransactions({
        account: ACCOUNT,
        assetId: `${Network.Mainnet}/slip44:195-staked-for-invalid` as any,
        amount: new BigNumber('2'),
      }),
    ).rejects.toThrow('Invalid asset ID');
  });

  it('builds and broadcasts claim unstaked TRX transactions', async () => {
    await service.claimUnstakedTrx({
      account: ACCOUNT,
      scope: Network.Mainnet,
    });

    expect(withdrawExpireUnfreeze).toHaveBeenCalledWith(ACCOUNT.address);
    expect(transactionService.broadcastMany).toHaveBeenCalledWith({
      scope: Network.Mainnet,
      accountId: ACCOUNT.id,
      transactions: [createTransaction('withdraw-unfrozen')],
      tracking: { type: 'accountSync' },
    });
  });

  it('builds and broadcasts staking rewards claim transactions', async () => {
    await service.claimTrxStakingRewards({
      account: ACCOUNT,
      scope: Network.Mainnet,
    });

    expect(withdrawBlockRewards).toHaveBeenCalledWith(ACCOUNT.address);
    expect(transactionService.broadcastMany).toHaveBeenCalledWith({
      scope: Network.Mainnet,
      accountId: ACCOUNT.id,
      transactions: [createTransaction('withdraw-rewards')],
      tracking: { type: 'accountSync' },
    });
  });
});
