/* eslint-disable @typescript-eslint/naming-convention */
import { FeeType } from '@metamask/keyring-api';

import { TransactionService } from './TransactionService';
import { Network, Networks } from '../../constants';
import { BackgroundEventMethod } from '../../handlers/cronjob';

const ACCOUNT_ADDRESS = 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx';
const RECIPIENT_ADDRESS = 'TQAvWQpT9H916GckwWDJNhYZvQMkuRLtGz';

const createAccount = () =>
  ({
    id: 'account-id',
    address: ACCOUNT_ADDRESS,
    type: 'eip155:eoa',
  }) as any;

const createResourceAsset = (assetType: string, rawAmount: string) =>
  ({
    assetType,
    rawAmount,
  }) as any;

const createTransaction = (ownerAddress = ACCOUNT_ADDRESS) =>
  ({
    txID: 'unsigned-tx-id',
    raw_data: {
      contract: [
        {
          type: 'TransferContract',
          parameter: {
            value: {
              owner_address: ownerAddress,
              to_address: RECIPIENT_ADDRESS,
              amount: 1,
            },
          },
        },
      ],
    },
    raw_data_hex: '0a0b0c',
  }) as any;

const createResourceFee = (assetType: string, amount: string) => ({
  type: FeeType.Base,
  asset: {
    unit: assetType.includes('energy') ? 'ENERGY' : 'BANDWIDTH',
    type: assetType,
    amount,
    fungible: true as const,
  },
});

describe('TransactionService', () => {
  let rawTransactionParser: any;
  let transactionFeeEstimator: any;
  let transactionBroadcaster: any;
  let accountsService: any;
  let assetsService: any;
  let snapClient: any;
  let service: TransactionService;

  beforeEach(() => {
    rawTransactionParser = {
      prepareRawTransaction: jest.fn().mockResolvedValue({
        transaction: createTransaction(),
        rawData: createTransaction().raw_data,
      }),
    };
    transactionFeeEstimator = {
      computeFee: jest
        .fn()
        .mockResolvedValue([
          createResourceFee(Networks[Network.Mainnet].energy.id, '1'),
        ]),
    };
    transactionBroadcaster = {
      broadcast: jest.fn().mockResolvedValue({
        txid: 'broadcast-tx-id',
        result: { result: true, txid: 'broadcast-tx-id' },
      }),
    };
    accountsService = {
      findByIdOrThrow: jest.fn().mockResolvedValue(createAccount()),
    };
    assetsService = {
      getAssetsByAccountId: jest
        .fn()
        .mockResolvedValue([
          createResourceAsset(Networks[Network.Mainnet].bandwidth.id, '20'),
          createResourceAsset(Networks[Network.Mainnet].energy.id, '100'),
        ]),
    };
    snapClient = {
      scheduleBackgroundEvent: jest.fn().mockResolvedValue(undefined),
    };

    service = new TransactionService({
      rawTransactionParser,
      transactionFeeEstimator,
      transactionBroadcaster,
      accountsService,
      assetsService,
      snapClient,
    });
  });

  it('prepares raw transactions through the parser', async () => {
    const params = {
      scope: Network.Mainnet,
      account: createAccount(),
      transactionBase64: 'Cg==',
      type: 'TransferContract',
      feeLimit: 1,
    };

    const result = await service.prepareRawTransaction(params);
    expect(result).toStrictEqual({
      transaction: createTransaction(),
      rawData: createTransaction().raw_data,
    });
    expect(rawTransactionParser.prepareRawTransaction).toHaveBeenCalledWith(
      params,
    );
  });

  it('estimates fees with account resources', async () => {
    await service.estimateFee({
      scope: Network.Mainnet,
      accountId: 'account-id',
      transaction: createTransaction(),
      feeLimit: 2,
    });

    expect(accountsService.findByIdOrThrow).toHaveBeenCalledWith('account-id');
    expect(assetsService.getAssetsByAccountId).toHaveBeenCalledWith(
      'account-id',
      [
        Networks[Network.Mainnet].bandwidth.id,
        Networks[Network.Mainnet].energy.id,
      ],
    );
    expect(transactionFeeEstimator.computeFee).toHaveBeenCalledWith({
      scope: Network.Mainnet,
      transaction: createTransaction(),
      availableBandwidth: expect.objectContaining({ c: [20] }),
      availableEnergy: expect.objectContaining({ c: [100] }),
      feeLimit: 2,
    });
  });

  it('uses zero resources when resource assets are missing', async () => {
    assetsService.getAssetsByAccountId.mockResolvedValue([null, null]);

    await service.estimateFee({
      scope: Network.Mainnet,
      accountId: 'account-id',
      transaction: createTransaction(),
    });

    expect(transactionFeeEstimator.computeFee).toHaveBeenCalledWith(
      expect.objectContaining({
        availableBandwidth: expect.objectContaining({ c: [0] }),
        availableEnergy: expect.objectContaining({ c: [0] }),
      }),
    );
  });

  it('throws before fee estimation when the owner does not match the account', async () => {
    await expect(
      service.estimateFee({
        scope: Network.Mainnet,
        accountId: 'account-id',
        transaction: createTransaction(RECIPIENT_ADDRESS),
      }),
    ).rejects.toThrow('does not match the account address');

    expect(transactionFeeEstimator.computeFee).not.toHaveBeenCalled();
  });

  it('estimates multiple fees with depleted resources between transactions', async () => {
    const firstTransaction = createTransaction();
    const secondTransaction = createTransaction();
    transactionFeeEstimator.computeFee
      .mockResolvedValueOnce([
        createResourceFee(Networks[Network.Mainnet].energy.id, '60'),
        createResourceFee(Networks[Network.Mainnet].bandwidth.id, '10'),
      ])
      .mockResolvedValueOnce([
        createResourceFee(Networks[Network.Mainnet].energy.id, '80'),
        createResourceFee(Networks[Network.Mainnet].bandwidth.id, '15'),
      ]);

    const result = await service.estimateFees({
      scope: Network.Mainnet,
      accountId: 'account-id',
      transactions: [firstTransaction, secondTransaction],
    });

    expect(result).toStrictEqual([
      [
        createResourceFee(Networks[Network.Mainnet].energy.id, '60'),
        createResourceFee(Networks[Network.Mainnet].bandwidth.id, '10'),
      ],
      [
        createResourceFee(Networks[Network.Mainnet].energy.id, '80'),
        createResourceFee(Networks[Network.Mainnet].bandwidth.id, '15'),
      ],
    ]);
    expect(transactionFeeEstimator.computeFee).toHaveBeenNthCalledWith(1, {
      scope: Network.Mainnet,
      transaction: firstTransaction,
      availableBandwidth: expect.objectContaining({ c: [20] }),
      availableEnergy: expect.objectContaining({ c: [100] }),
      feeLimit: undefined,
    });
    expect(transactionFeeEstimator.computeFee).toHaveBeenNthCalledWith(2, {
      scope: Network.Mainnet,
      transaction: secondTransaction,
      availableBandwidth: expect.objectContaining({ c: [10] }),
      availableEnergy: expect.objectContaining({ c: [40] }),
      feeLimit: undefined,
    });
  });

  it('broadcasts through the broadcaster', async () => {
    const result = await service.broadcast({
      scope: Network.Mainnet,
      accountId: 'account-id',
      transaction: createTransaction(),
      tracking: { type: 'transaction', origin: 'dapp' },
    });

    expect(result).toStrictEqual({
      txid: 'broadcast-tx-id',
      result: { result: true, txid: 'broadcast-tx-id' },
    });
    expect(transactionBroadcaster.broadcast).toHaveBeenCalledWith({
      scope: Network.Mainnet,
      accountId: 'account-id',
      transaction: createTransaction(),
      tracking: { type: 'transaction', origin: 'dapp' },
    });
  });

  it('broadcasts many transactions with transaction tracking', async () => {
    const firstTransaction = createTransaction();
    const secondTransaction = createTransaction();

    await service.broadcastMany({
      scope: Network.Mainnet,
      accountId: 'account-id',
      transactions: [firstTransaction, secondTransaction],
      tracking: { type: 'transaction', origin: 'dapp' },
    });

    expect(transactionBroadcaster.broadcast).toHaveBeenNthCalledWith(1, {
      scope: Network.Mainnet,
      accountId: 'account-id',
      transaction: firstTransaction,
      tracking: { type: 'transaction', origin: 'dapp' },
    });
    expect(transactionBroadcaster.broadcast).toHaveBeenNthCalledWith(2, {
      scope: Network.Mainnet,
      accountId: 'account-id',
      transaction: secondTransaction,
      tracking: { type: 'transaction', origin: 'dapp' },
    });
    expect(snapClient.scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('broadcasts many transactions and schedules one account sync', async () => {
    await service.broadcastMany({
      scope: Network.Mainnet,
      accountId: 'account-id',
      transactions: [createTransaction(), createTransaction()],
      tracking: { type: 'accountSync' },
    });

    expect(transactionBroadcaster.broadcast).toHaveBeenCalledTimes(2);
    expect(transactionBroadcaster.broadcast).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tracking: { type: 'none' } }),
    );
    expect(transactionBroadcaster.broadcast).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tracking: { type: 'none' } }),
    );
    expect(snapClient.scheduleBackgroundEvent).toHaveBeenCalledWith({
      method: BackgroundEventMethod.SynchronizeAccount,
      params: { accountId: 'account-id' },
      duration: 'PT5S',
    });
  });

  it('schedules account sync after partial multi-broadcast success', async () => {
    transactionBroadcaster.broadcast
      .mockResolvedValueOnce({
        txid: 'broadcast-tx-id',
        result: { result: true, txid: 'broadcast-tx-id' },
      })
      .mockRejectedValueOnce(new Error('failed'));

    await expect(
      service.broadcastMany({
        scope: Network.Mainnet,
        accountId: 'account-id',
        transactions: [createTransaction(), createTransaction()],
        tracking: { type: 'accountSync' },
      }),
    ).rejects.toThrow('failed');

    expect(snapClient.scheduleBackgroundEvent).toHaveBeenCalledWith({
      method: BackgroundEventMethod.SynchronizeAccount,
      params: { accountId: 'account-id' },
      duration: 'PT5S',
    });
  });

  it('throws account sync scheduling errors after successful multi-broadcast', async () => {
    snapClient.scheduleBackgroundEvent.mockRejectedValue(
      new Error('schedule failed'),
    );

    await expect(
      service.broadcastMany({
        scope: Network.Mainnet,
        accountId: 'account-id',
        transactions: [createTransaction()],
        tracking: { type: 'accountSync' },
      }),
    ).rejects.toThrow('schedule failed');
  });

  it('wraps non-error multi-broadcast failures', async () => {
    transactionBroadcaster.broadcast.mockRejectedValue('failed');

    await expect(
      service.broadcastMany({
        scope: Network.Mainnet,
        accountId: 'account-id',
        transactions: [createTransaction()],
        tracking: { type: 'none' },
      }),
    ).rejects.toThrow('Transaction broadcast failed');
  });
});
