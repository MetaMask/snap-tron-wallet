import { BigNumber } from 'bignumber.js';

import type { TransactionsService } from './TransactionsService';
import { TransactionsServiceV2 } from './TransactionsServiceV2';
import type { SnapClient } from '../../clients/snap/SnapClient';
import type { TronWebFactory } from '../../clients/tronweb/TronWebFactory';
import { KnownCaip19Id, Network } from '../../constants';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import { BackgroundEventMethod } from '../../handlers/cronjob';
import { mockLogger } from '../../utils/mockLogger';
import type { AccountsService } from '../accounts/AccountsService';
import type { AssetsService } from '../assets/AssetsService';
import type { ConfirmationHandler } from '../confirmation/ConfirmationHandler';
import type { FeeCalculatorService } from '../send/FeeCalculatorService';
import type { SendService } from '../send/SendService';
import type { StakingService } from '../staking/StakingService';

describe('TransactionsServiceV2', () => {
  let service: TransactionsServiceV2;
  let mockAccountsService: jest.Mocked<AccountsService>;
  let mockTronWebFactory: jest.Mocked<TronWebFactory>;
  let mockSnapClient: jest.Mocked<SnapClient>;
  let mockStakingService: jest.Mocked<StakingService>;
  let mockTransactionsService: jest.Mocked<TransactionsService>;
  let mockTronWeb: any;

  const mockAccount: TronKeyringAccount = {
    id: 'test-account-id',
    address: 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx',
    type: 'eip155:eoa',
    options: {},
    methods: [],
    scopes: [Network.Mainnet],
    entropySource: 'test-entropy',
    derivationPath: "m/44'/195'/0'/0/0",
    index: 0,
  };

  const mockTransaction = {
    txID: 'mock-transaction-id',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    raw_data: { contract: [] },
  } as any;

  const mockSignedTransaction = {
    ...mockTransaction,
    signature: ['mock-signature'],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockTronWeb = {
      trx: {
        sign: jest.fn().mockResolvedValue(mockSignedTransaction),
        sendRawTransaction: jest
          .fn()
          .mockResolvedValue({ result: true, txid: 'mock-tx-id' }),
      },
    };

    mockAccountsService = {
      deriveTronKeypair: jest.fn().mockResolvedValue({
        privateKeyHex: 'mock-private-key',
      }),
    } as unknown as jest.Mocked<AccountsService>;

    mockTronWebFactory = {
      createClient: jest.fn().mockReturnValue(mockTronWeb),
    } as unknown as jest.Mocked<TronWebFactory>;

    mockSnapClient = {
      scheduleBackgroundEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SnapClient>;

    mockStakingService = {
      buildStakeTransactions: jest.fn().mockResolvedValue({
        scope: Network.Mainnet,
        transactions: [mockTransaction],
      }),
    } as unknown as jest.Mocked<StakingService>;

    mockTransactionsService = {
      save: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<TransactionsService>;

    service = new TransactionsServiceV2({
      logger: mockLogger,
      accountsService: mockAccountsService,
      assetsService: {} as jest.Mocked<AssetsService>,
      sendService: {} as jest.Mocked<SendService>,
      feeCalculatorService: {} as jest.Mocked<FeeCalculatorService>,
      tronWebFactory: mockTronWebFactory,
      snapClient: mockSnapClient,
      stakingService: mockStakingService,
      confirmationHandler: {} as jest.Mocked<ConfirmationHandler>,
      transactionsService: mockTransactionsService,
    });
  });

  it('delegates stake transaction builds to StakingService', async () => {
    const result = await service.buildStakeTransactions({
      account: mockAccount,
      assetId: KnownCaip19Id.TrxMainnet,
      amount: BigNumber(100),
      purpose: 'BANDWIDTH',
      includeVote: false,
    });

    expect(mockStakingService.buildStakeTransactions).toHaveBeenCalledWith({
      account: mockAccount,
      assetId: KnownCaip19Id.TrxMainnet,
      amount: BigNumber(100),
      purpose: 'BANDWIDTH',
      includeVote: false,
    });
    expect(result).toStrictEqual({
      scope: Network.Mainnet,
      transactions: [mockTransaction],
    });
  });

  it('signs every transaction in order', async () => {
    const secondSignedTransaction = {
      ...mockSignedTransaction,
      txID: 'second-signed-transaction',
    };
    mockTronWeb.trx.sign
      .mockResolvedValueOnce(mockSignedTransaction)
      .mockResolvedValueOnce(secondSignedTransaction);

    const transactions = [mockTransaction, { ...mockTransaction, txID: '2' }];

    const result = await service.signTransactions({
      scope: Network.Mainnet,
      account: mockAccount,
      transactions,
    });

    expect(mockAccountsService.deriveTronKeypair).toHaveBeenCalledWith({
      entropySource: mockAccount.entropySource,
      derivationPath: mockAccount.derivationPath,
    });
    expect(mockTronWebFactory.createClient).toHaveBeenCalledWith(
      Network.Mainnet,
      'mock-private-key',
    );
    expect(mockTronWeb.trx.sign).toHaveBeenNthCalledWith(1, transactions[0]);
    expect(mockTronWeb.trx.sign).toHaveBeenNthCalledWith(2, transactions[1]);
    expect(result).toStrictEqual([
      mockSignedTransaction,
      secondSignedTransaction,
    ]);
  });

  it('broadcasts every signed transaction in order', async () => {
    const secondResult = { result: true, txid: 'second-tx-id' };
    mockTronWeb.trx.sendRawTransaction
      .mockResolvedValueOnce({ result: true, txid: 'first-tx-id' })
      .mockResolvedValueOnce(secondResult);

    const signedTransactions = [
      mockSignedTransaction,
      { ...mockSignedTransaction, txID: 'second' },
    ];

    const result = await service.broadcastTransactions({
      scope: Network.Mainnet,
      signedTransactions,
    });

    expect(mockTronWebFactory.createClient).toHaveBeenCalledWith(
      Network.Mainnet,
    );
    expect(mockTronWeb.trx.sendRawTransaction).toHaveBeenNthCalledWith(
      1,
      signedTransactions[0],
    );
    expect(mockTronWeb.trx.sendRawTransaction).toHaveBeenNthCalledWith(
      2,
      signedTransactions[1],
    );
    expect(result).toStrictEqual([
      { result: true, txid: 'first-tx-id' },
      secondResult,
    ]);
  });

  it('throws when a broadcast fails', async () => {
    mockTronWeb.trx.sendRawTransaction.mockResolvedValue({
      result: false,
      txid: 'failed-tx-id',
      message: 'broadcast failed',
    });

    await expect(
      service.broadcastTransactions({
        scope: Network.Mainnet,
        signedTransactions: [mockSignedTransaction],
      }),
    ).rejects.toThrow('Failed to send transaction: broadcast failed');
  });

  it('schedules account sync', async () => {
    await service.scheduleAccountSync({ accountId: mockAccount.id });

    expect(mockSnapClient.scheduleBackgroundEvent).toHaveBeenCalledWith({
      method: BackgroundEventMethod.SynchronizeAccount,
      params: { accountId: mockAccount.id },
      duration: 'PT5S',
    });
  });
});
