import { FeeType } from '@metamask/keyring-api';
import { UserRejectedRequestError } from '@metamask/snaps-sdk';
import { BigNumber } from 'bignumber.js';

import { TransactionPipelineSteps } from './TransactionPipelineSteps';
import type { TransactionPipelineContext } from './types';
import { Network, Networks } from '../../../constants';
import type { AssetEntity } from '../../../entities/assets';
import type { TronKeyringAccount } from '../../../entities/keyring-account';
import { SendErrorCodes } from '../../../handlers/clientRequest/types';
import type { TransactionsServiceV2 } from '../TransactionsServiceV2';

describe('TransactionPipelineSteps', () => {
  let steps: TransactionPipelineSteps;
  let mockTransactionsServiceV2: jest.Mocked<TransactionsServiceV2>;

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

  const mockAsset = {
    assetType: Networks[Network.Mainnet].nativeToken.id,
    keyringAccountId: mockAccount.id,
    network: Network.Mainnet,
    symbol: 'TRX',
    decimals: 6,
    rawAmount: '100000000',
    uiAmount: '100',
    iconUrl: 'https://example.com/trx.png',
  } as AssetEntity;

  const mockTransaction = {
    txID: 'mock-transaction-id',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    raw_data: { contract: [] },
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockTransactionsServiceV2 = {
      findAccount: jest.fn().mockResolvedValue(mockAccount),
      findAccountOrThrow: jest.fn().mockResolvedValue(mockAccount),
      findAsset: jest.fn().mockResolvedValue(mockAsset),
      getScopeFromAssetId: jest.fn().mockReturnValue(Network.Mainnet),
      getAmount: jest.fn((value: string) => new BigNumber(value)),
      getBalance: jest.fn((asset: AssetEntity | null) =>
        asset ? new BigNumber(asset.uiAmount) : new BigNumber(0),
      ),
      hasEnoughBalance: jest.fn(({ amount, balance }) =>
        amount.isLessThanOrEqualTo(balance),
      ),
      getSendValidationAssets: jest.fn().mockResolvedValue({
        asset: mockAsset,
        nativeTokenAsset: mockAsset,
        bandwidthAsset: null,
        energyAsset: null,
      }),
      getAvailableResources: jest.fn().mockReturnValue({
        availableEnergy: new BigNumber(0),
        availableBandwidth: new BigNumber(0),
      }),
      deserializeTransaction: jest.fn().mockResolvedValue(mockTransaction),
      buildSendTransaction: jest.fn().mockResolvedValue(mockTransaction),
      estimateFee: jest.fn().mockResolvedValue([
        {
          type: FeeType.Base,
          asset: {
            type: Networks[Network.Mainnet].nativeToken.id,
            unit: 'TRX',
            amount: '1',
            fungible: true,
          },
        },
      ]),
      estimateFeeWithResources: jest.fn().mockResolvedValue([
        {
          type: FeeType.Base,
          asset: {
            type: Networks[Network.Mainnet].nativeToken.id,
            unit: 'TRX',
            amount: '1',
            fungible: true,
          },
        },
      ]),
      validateFeeBalance: jest.fn().mockReturnValue({
        valid: true,
        errors: [],
      }),
      confirmSendTransaction: jest.fn().mockResolvedValue(true),
      signTransactions: jest.fn().mockResolvedValue(['signed-transaction']),
      broadcastTransactions: jest
        .fn()
        .mockResolvedValue([{ result: true, txid: 'mock-tx-id' }]),
      savePendingTransactions: jest.fn().mockResolvedValue(undefined),
      scheduleAccountSync: jest.fn().mockResolvedValue(undefined),
      signRewardsMessage: jest.fn().mockResolvedValue({
        signature: 'signature',
        signedMessage: 'message',
        signatureType: 'secp256k1',
      }),
    } as unknown as jest.Mocked<TransactionsServiceV2>;

    steps = new TransactionPipelineSteps({
      transactionsServiceV2: mockTransactionsServiceV2,
    });
  });

  it('deserializes raw transaction context', async () => {
    const result = await steps.deserializeTransaction()({
      accountId: mockAccount.id,
      scope: Network.Mainnet,
      transactionBase64: 'AQID',
      transactionType: 'TransferContract',
      feeLimit: 100,
    });

    expect(mockTransactionsServiceV2.findAccountOrThrow).toHaveBeenCalledWith(
      mockAccount.id,
    );
    expect(
      mockTransactionsServiceV2.deserializeTransaction,
    ).toHaveBeenCalledWith({
      scope: Network.Mainnet,
      transactionBase64: 'AQID',
      type: 'TransferContract',
      feeLimit: 100,
    });
    expect(result).toStrictEqual({
      type: 'continue',
      context: {
        accountId: mockAccount.id,
        account: mockAccount,
        scope: Network.Mainnet,
        transactionBase64: 'AQID',
        transactionType: 'TransferContract',
        feeLimit: 100,
        kind: 'raw',
        transactions: [mockTransaction],
      },
    });
  });

  it('returns valid response for send amount input without recipient', async () => {
    const result = await steps.buildSendTransaction({
      skipIfNoToAddress: true,
      missingAccountError: SendErrorCodes.Required,
    })({
      accountId: mockAccount.id,
      assetId: Networks[Network.Mainnet].nativeToken.id,
      amountValue: '1',
      feeLimit: 100,
    });

    expect(result).toStrictEqual({
      type: 'return',
      response: { valid: true, errors: [] },
    });
    expect(
      mockTransactionsServiceV2.buildSendTransaction,
    ).not.toHaveBeenCalled();
  });

  it('aggregates fee rows for transaction bundles', async () => {
    mockTransactionsServiceV2.estimateFee
      .mockResolvedValueOnce([
        {
          type: FeeType.Base,
          asset: {
            type: Networks[Network.Mainnet].nativeToken.id,
            unit: 'TRX',
            amount: '1',
            fungible: true,
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          type: FeeType.Base,
          asset: {
            type: Networks[Network.Mainnet].nativeToken.id,
            unit: 'TRX',
            amount: '2',
            fungible: true,
          },
        },
      ]);

    const result = await steps.estimateFee()({
      accountId: mockAccount.id,
      scope: Network.Mainnet,
      transactions: [mockTransaction, { ...mockTransaction, txID: 'second' }],
    });

    expect(result).toStrictEqual({
      type: 'continue',
      context: {
        accountId: mockAccount.id,
        scope: Network.Mainnet,
        transactions: [mockTransaction, { ...mockTransaction, txID: 'second' }],
        fees: [
          {
            type: FeeType.Base,
            asset: {
              type: Networks[Network.Mainnet].nativeToken.id,
              unit: 'TRX',
              amount: '3',
              fungible: true,
            },
          },
        ],
      },
    });
  });

  it('returns fee validation response when fee balance is insufficient', async () => {
    mockTransactionsServiceV2.validateFeeBalance.mockReturnValue({
      valid: false,
      errors: [{ code: SendErrorCodes.InsufficientBalanceToCoverFee }],
    });

    const result = await steps.validateTransaction()({
      kind: 'send',
      scope: Network.Mainnet,
      assetId: Networks[Network.Mainnet].nativeToken.id,
      amount: new BigNumber(100),
      nativeTokenAsset: mockAsset,
      fees: [],
    });

    expect(result).toStrictEqual({
      type: 'return',
      response: {
        valid: false,
        errors: [{ code: SendErrorCodes.InsufficientBalanceToCoverFee }],
      },
    });
  });

  it('throws when send confirmation is rejected', async () => {
    mockTransactionsServiceV2.confirmSendTransaction.mockResolvedValue(false);

    await expect(
      steps.renderConfirmationUi()({
        kind: 'send',
        account: mockAccount,
        scope: Network.Mainnet,
        toAddress: 'TRecipientAddress',
        amountValue: '1',
        fees: [],
        asset: mockAsset,
        transactions: [mockTransaction],
      }),
    ).rejects.toThrow(UserRejectedRequestError);
  });

  it('signs, broadcasts, saves, and schedules account sync', async () => {
    const signedResult = await steps.sign()({
      accountId: mockAccount.id,
      account: mockAccount,
      scope: Network.Mainnet,
      transactions: [mockTransaction],
    });

    expect(mockTransactionsServiceV2.signTransactions).toHaveBeenCalledWith({
      scope: Network.Mainnet,
      account: mockAccount,
      transactions: [mockTransaction],
    });

    expect(signedResult.type).toBe('continue');
    const signedContext = (
      signedResult as { type: 'continue'; context: TransactionPipelineContext }
    ).context;
    const broadcastResult = await steps.broadcast()(signedContext);
    expect(broadcastResult.type).toBe('continue');
    const broadcastContext = (
      broadcastResult as {
        type: 'continue';
        context: TransactionPipelineContext;
      }
    ).context;

    await steps.savePendingTransaction()(broadcastContext);
    await steps.scheduleAccountSync()(broadcastContext);

    expect(
      mockTransactionsServiceV2.broadcastTransactions,
    ).toHaveBeenCalledWith({
      scope: Network.Mainnet,
      signedTransactions: ['signed-transaction'],
    });
    expect(
      mockTransactionsServiceV2.savePendingTransactions,
    ).toHaveBeenCalled();
    expect(mockTransactionsServiceV2.scheduleAccountSync).toHaveBeenCalledWith({
      accountId: mockAccount.id,
    });
  });
});
