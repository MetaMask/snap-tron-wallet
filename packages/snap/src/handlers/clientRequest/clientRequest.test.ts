/* eslint-disable @typescript-eslint/naming-convention */
import { FeeType } from '@metamask/keyring-api';
import type { JsonRpcRequest } from '@metamask/snaps-sdk';
import type { Infer } from '@metamask/superstruct';
import { BigNumber } from 'bignumber.js';
import type { Transaction, TransferContract } from 'tronweb/lib/esm/types';

import { ClientRequestHandler } from './clientRequest';
import { ClientRequestMethod, SendErrorCodes } from './types';
import type { OnAmountInputRequestStruct } from './validation';
import type { SnapClient } from '../../clients/snap/SnapClient';
import type { TronWebFactory } from '../../clients/tronweb/TronWebFactory';
import { FEE_LIMIT, Network, Networks } from '../../constants';
import type { NativeAsset, ResourceAsset } from '../../entities/assets';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import type { AccountsService } from '../../services/accounts/AccountsService';
import type { AssetsService } from '../../services/assets/AssetsService';
import type { ConfirmationHandler } from '../../services/confirmation/ConfirmationHandler';
import type { SendService } from '../../services/send/SendService';
import type { StakingService } from '../../services/staking/StakingService';
import type { TransactionService } from '../../services/transaction';
import type { ComputeFeeResult } from '../../services/transaction/types';
import type { TransactionHistoryService } from '../../services/transaction-history/TransactionHistoryService';
import { mockLogger } from '../../utils/mockLogger';

const createMockTransactionService = (): jest.Mocked<TransactionService> =>
  ({
    prepareRawTransaction: jest.fn(),
    estimateFee: jest.fn(),
    estimateFees: jest.fn().mockResolvedValue([]),
    broadcast: jest.fn().mockResolvedValue({
      txid: 'broadcast-tx-id',
      result: { result: true, txid: 'broadcast-tx-id' },
    }),
    broadcastMany: jest.fn().mockResolvedValue([]),
  }) as unknown as jest.Mocked<TransactionService>;

describe('ClientRequestHandler', () => {
  describe('estimateFee', () => {
    let clientRequestHandler: ClientRequestHandler;
    let mockAccountsService: jest.Mocked<AccountsService>;
    let mockAssetsService: jest.Mocked<AssetsService>;
    let mockSendService: jest.Mocked<SendService>;
    let mockTransactionService: jest.Mocked<TransactionService>;
    let mockTronWebFactory: jest.Mocked<TronWebFactory>;
    let mockSnapClient: jest.Mocked<SnapClient>;
    let mockStakingService: jest.Mocked<StakingService>;
    let mockConfirmationHandler: jest.Mocked<ConfirmationHandler>;
    let mockTronWeb: any;
    let mockTransactionHistoryService: jest.Mocked<TransactionHistoryService>;

    const TEST_ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';
    const TEST_TRANSACTION_BASE64 =
      'CgK0FiII40phBu42/OZAkJyY96YzWrADCB8SqwMKMXR5cGUuZ29vZ2xlYXBpcy5jb20vcHJvdG9jb2wuVHJpZ2dlclNtYXJ0Q29udHJhY3QS9QIKFUEU0B62M0bakw7g2jDVhRrBTODEeRIVQZlGn9WqCM/oNjlc6ZPA69Vn4sFPIsQCnd+TuwAAAAAAAAAAAAAAAKYU+AO2/XgJhqQseOycf3fm3tE8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC+vCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAnq6OQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF1RSWHxzeWtuZjl8MC41fGJyaWRnZXJzAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACJUQnNGcUttbVJ5WWNuWUphOFlEeFk1ZDJKQVJhSGVxdUJKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcLzdlPemMw==';

    beforeEach(() => {
      mockAccountsService = {
        findByIdOrThrow: jest.fn(),
        deriveTronKeypair: jest.fn(),
      } as unknown as jest.Mocked<AccountsService>;

      mockAssetsService = {
        getAssetsByAccountId: jest.fn(),
      } as unknown as jest.Mocked<AssetsService>;

      mockSendService = {
        signAndSendTransaction: jest.fn(),
      } as unknown as jest.Mocked<SendService>;

      mockTransactionService = createMockTransactionService();

      mockTronWeb = {
        utils: {
          deserializeTx: {
            deserializeTransaction: jest.fn(),
          },
          transaction: {
            txJsonToPb: jest.fn().mockImplementation((tx) => tx),
            txPbToRawDataHex: jest.fn().mockReturnValue('1234567890abcdef'),
            txPbToTxID: jest.fn().mockReturnValue('mock-tx-id'),
          },
        },
        trx: {
          sign: jest.fn(),
          sendRawTransaction: jest.fn(),
        },
      };

      mockTronWebFactory = {
        createClient: jest.fn().mockReturnValue(mockTronWeb),
      } as unknown as jest.Mocked<TronWebFactory>;

      mockSnapClient = {
        scheduleBackgroundEvent: jest.fn(),
      } as unknown as jest.Mocked<SnapClient>;
      mockStakingService = {} as unknown as jest.Mocked<StakingService>;
      mockConfirmationHandler =
        {} as unknown as jest.Mocked<ConfirmationHandler>;
      mockTransactionHistoryService = {
        save: jest.fn(),
      } as unknown as jest.Mocked<TransactionHistoryService>;
      clientRequestHandler = new ClientRequestHandler({
        logger: mockLogger,
        accountsService: mockAccountsService,
        assetsService: mockAssetsService,
        sendService: mockSendService,
        transactionService: mockTransactionService,
        tronWebFactory: mockTronWebFactory,
        snapClient: mockSnapClient,
        stakingService: mockStakingService,
        confirmationHandler: mockConfirmationHandler,
        transactionsService: mockTransactionHistoryService,
      });
    });

    describe('when called with valid parameters from external dapp', () => {
      const createPreparedTransaction = (feeLimit = FEE_LIMIT) => {
        const rawData = {
          fee_limit: feeLimit,
          contract: [
            {
              type: 'TriggerSmartContract',
              parameter: {
                value: {
                  owner_address: '41458437be39f3a8bfdbfee7bef93e2c5f632ceff4',
                },
              },
            },
          ],
        };
        return {
          rawData,
          transaction: {
            txID: 'prepared-tx-id',
            raw_data: rawData,
            raw_data_hex: '1234567890abcdef',
          },
        };
      };

      it('estimates fees before broadcasting a raw transaction', async () => {
        const scope = Network.Mainnet;
        const account = {
          id: TEST_ACCOUNT_ID,
          address: 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx',
          entropySource: 'test-entropy',
          derivationPath: [],
        } as any;
        const preparedTransaction = createPreparedTransaction();
        const request = {
          jsonrpc: '2.0' as const,
          id: '1',
          method: ClientRequestMethod.SignAndSendTransaction,
          params: {
            accountId: TEST_ACCOUNT_ID,
            transaction: TEST_TRANSACTION_BASE64,
            scope,
            options: {
              visible: false,
              type: 'TriggerSmartContract',
            },
          },
        };

        mockAccountsService.findByIdOrThrow.mockResolvedValue(account);
        mockTransactionService.prepareRawTransaction.mockResolvedValue(
          preparedTransaction as any,
        );
        mockTransactionService.estimateFee.mockResolvedValue([]);
        mockTransactionService.broadcast.mockResolvedValue({
          txid: 'test-tx-id',
          result: { result: true, txid: 'test-tx-id' },
        });

        const result = await clientRequestHandler.handle(
          request as JsonRpcRequest,
        );

        expect(result).toStrictEqual({ transactionId: 'test-tx-id' });
        expect(
          mockTransactionService.prepareRawTransaction,
        ).toHaveBeenCalledWith({
          scope,
          account,
          transactionBase64: TEST_TRANSACTION_BASE64,
          type: 'TriggerSmartContract',
        });
        expect(mockTransactionService.estimateFee).toHaveBeenCalledWith({
          scope,
          accountId: TEST_ACCOUNT_ID,
          transaction: preparedTransaction.transaction,
          feeLimit: FEE_LIMIT,
        });
        expect(mockTransactionService.broadcast).toHaveBeenCalledWith({
          scope,
          accountId: TEST_ACCOUNT_ID,
          transaction: preparedTransaction.transaction,
          tracking: { type: 'transaction', origin: 'MetaMask' },
        });
        expect(
          mockTransactionService.estimateFee.mock.invocationCallOrder[0],
        ).toBeLessThan(
          mockTransactionService.broadcast.mock
            .invocationCallOrder[0] as number,
        );
        expect(mockAccountsService.deriveTronKeypair).not.toHaveBeenCalled();
        expect(mockTronWeb.trx.sign).not.toHaveBeenCalled();
      });

      it('computes fee breakdown for a raw transaction', async () => {
        const scope = Network.Shasta;
        const account = {
          id: TEST_ACCOUNT_ID,
          address: 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx',
        } as any;
        const preparedTransaction = createPreparedTransaction();
        const feeResult = [
          {
            type: FeeType.Base,
            asset: {
              unit: Networks[scope].energy.symbol,
              type: Networks[scope].energy.id,
              amount: '65000',
              fungible: true as const,
            },
          },
        ];
        const request = {
          jsonrpc: '2.0' as const,
          id: '1',
          method: ClientRequestMethod.ComputeFee,
          params: {
            accountId: TEST_ACCOUNT_ID,
            transaction: TEST_TRANSACTION_BASE64,
            scope,
            options: {
              visible: false,
              type: 'TriggerSmartContract',
            },
          },
        };

        mockAccountsService.findByIdOrThrow.mockResolvedValue(account);
        mockTransactionService.prepareRawTransaction.mockResolvedValue(
          preparedTransaction as any,
        );
        mockTransactionService.estimateFee.mockResolvedValue(feeResult);

        const result = await clientRequestHandler.handle(
          request as JsonRpcRequest,
        );

        expect(result).toStrictEqual(feeResult);
        expect(
          mockTransactionService.prepareRawTransaction,
        ).toHaveBeenCalledWith({
          scope,
          account,
          transactionBase64: TEST_TRANSACTION_BASE64,
          type: 'TriggerSmartContract',
          feeLimit: undefined,
        });
        expect(mockTransactionService.estimateFee).toHaveBeenCalledWith({
          scope,
          accountId: TEST_ACCOUNT_ID,
          transaction: preparedTransaction.transaction,
          feeLimit: FEE_LIMIT,
        });
        expect(mockAccountsService.deriveTronKeypair).not.toHaveBeenCalled();
        expect(mockTronWebFactory.createClient).not.toHaveBeenCalled();
      });
    });

    describe('when called with invalid parameters', () => {
      it('throws InvalidParamsError for missing accountId', async () => {
        const request = {
          jsonrpc: '2.0' as const,
          id: '4',
          method: ClientRequestMethod.ComputeFee,
          params: {
            transaction: TEST_TRANSACTION_BASE64,
            scope: Network.Shasta,
            options: {
              visible: false,
              type: 'TransferContract',
            },
          },
        };

        await expect(
          clientRequestHandler.handle(request as JsonRpcRequest),
        ).rejects.toThrow('Invalid method parameter(s)');
      });

      it('throws InvalidParamsError for invalid transaction format', async () => {
        const request = {
          jsonrpc: '2.0' as const,
          id: '5',
          method: ClientRequestMethod.ComputeFee,
          params: {
            accountId: TEST_ACCOUNT_ID,
            transaction: 'not-valid-base64!!!',
            scope: Network.Shasta,
            options: {
              visible: false,
              type: 'TransferContract',
            },
          },
        };

        await expect(
          clientRequestHandler.handle(request as JsonRpcRequest),
        ).rejects.toThrow('Invalid method parameter(s)');
      });

      it('throws error when account not found', async () => {
        const request = {
          jsonrpc: '2.0' as const,
          id: '6',
          method: ClientRequestMethod.ComputeFee,
          params: {
            accountId: TEST_ACCOUNT_ID,
            transaction: TEST_TRANSACTION_BASE64,
            scope: Network.Shasta,
            options: {
              visible: false,
              type: 'TransferContract',
            },
          },
        };

        mockAccountsService.findByIdOrThrow.mockRejectedValue(
          new Error('Account not found'),
        );

        await expect(
          clientRequestHandler.handle(request as JsonRpcRequest),
        ).rejects.toThrow('Account not found');
      });
    });
  });

  describe('signRewardsMessage', () => {
    let clientRequestHandler: ClientRequestHandler;
    let mockAccountsService: jest.Mocked<AccountsService>;
    let mockAssetsService: jest.Mocked<AssetsService>;
    let mockSendService: jest.Mocked<SendService>;
    let mockTransactionService: jest.Mocked<TransactionService>;
    let mockTronWebFactory: jest.Mocked<TronWebFactory>;
    let mockSnapClient: jest.Mocked<SnapClient>;
    let mockStakingService: jest.Mocked<StakingService>;
    let mockConfirmationHandler: jest.Mocked<ConfirmationHandler>;
    let mockTronWeb: any;
    let mockTransactionHistoryService: jest.Mocked<TransactionHistoryService>;

    const TEST_ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';
    const TEST_ADDRESS = 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx';
    const TEST_PRIVATE_KEY = 'test-private-key';

    /**
     * Helper function to convert a utf8 string to base64.
     *
     * @param utf8 - The utf8 string to convert.
     * @returns The base64 encoded string.
     */
    const utf8ToBase64 = (utf8: string): string => {
      // eslint-disable-next-line no-restricted-globals
      return Buffer.from(utf8, 'utf8').toString('base64');
    };

    beforeEach(() => {
      mockAccountsService = {
        findById: jest.fn(),
        deriveTronKeypair: jest.fn(),
      } as unknown as jest.Mocked<AccountsService>;

      mockAssetsService = {} as unknown as jest.Mocked<AssetsService>;
      mockSendService = {} as unknown as jest.Mocked<SendService>;
      mockTransactionService = createMockTransactionService();

      mockTronWeb = {
        trx: {
          signMessageV2: jest.fn(),
        },
      };

      mockTronWebFactory = {
        createClient: jest.fn().mockReturnValue(mockTronWeb),
      } as unknown as jest.Mocked<TronWebFactory>;

      mockSnapClient = {} as unknown as jest.Mocked<SnapClient>;
      mockStakingService = {} as unknown as jest.Mocked<StakingService>;
      mockConfirmationHandler =
        {} as unknown as jest.Mocked<ConfirmationHandler>;
      mockTransactionHistoryService =
        {} as unknown as jest.Mocked<TransactionHistoryService>;

      clientRequestHandler = new ClientRequestHandler({
        logger: mockLogger,
        accountsService: mockAccountsService,
        assetsService: mockAssetsService,
        sendService: mockSendService,
        transactionService: mockTransactionService,
        tronWebFactory: mockTronWebFactory,
        snapClient: mockSnapClient,
        stakingService: mockStakingService,
        confirmationHandler: mockConfirmationHandler,
        transactionsService: mockTransactionHistoryService,
      });
    });

    describe('when called with valid parameters', () => {
      it('signs a rewards message and returns the signature', async () => {
        const mockTimestamp = 1736660000;
        const message = utf8ToBase64(
          `rewards,${TEST_ADDRESS},${mockTimestamp}`,
        );
        const mockSignature = '0x1234567890abcdef';

        const request = {
          jsonrpc: '2.0' as const,
          id: '1',
          method: ClientRequestMethod.SignRewardsMessage,
          params: {
            accountId: TEST_ACCOUNT_ID,
            message,
          },
        };

        // Mock account lookup
        mockAccountsService.findById.mockResolvedValue({
          id: TEST_ACCOUNT_ID,
          address: TEST_ADDRESS,
          entropySource: 'test-entropy',
          derivationPath: [],
        } as any);

        // Mock keypair derivation
        mockAccountsService.deriveTronKeypair.mockResolvedValue({
          privateKeyHex: TEST_PRIVATE_KEY,
        } as any);

        // Mock message signing
        mockTronWeb.trx.signMessageV2.mockReturnValue(mockSignature);

        const result = await clientRequestHandler.handle(request);

        expect(mockAccountsService.findById).toHaveBeenCalledWith(
          TEST_ACCOUNT_ID,
        );
        expect(mockAccountsService.deriveTronKeypair).toHaveBeenCalledWith({
          entropySource: 'test-entropy',
          derivationPath: [],
        });
        expect(mockTronWebFactory.createClient).toHaveBeenCalledWith(
          Network.Mainnet,
          TEST_PRIVATE_KEY,
        );
        expect(mockTronWeb.trx.signMessageV2).toHaveBeenCalledWith(
          `rewards,${TEST_ADDRESS},${mockTimestamp}`,
          TEST_PRIVATE_KEY,
        );
        expect(result).toStrictEqual({
          signature: mockSignature,
          signedMessage: message,
          signatureType: 'secp256k1',
        });
      });
    });

    describe('when called with invalid parameters', () => {
      it('throws error when message does not start with "rewards,"', async () => {
        const invalidMessage = utf8ToBase64('invalid-message');

        const request = {
          jsonrpc: '2.0' as const,
          id: '1',
          method: ClientRequestMethod.SignRewardsMessage,
          params: {
            accountId: TEST_ACCOUNT_ID,
            message: invalidMessage,
          },
        };

        await expect(
          clientRequestHandler.handle(request as JsonRpcRequest),
        ).rejects.toThrow('Invalid method parameter(s)');
      });

      it('throws error when account is not found', async () => {
        const mockTimestamp = 1736660000;
        const message = utf8ToBase64(
          `rewards,${TEST_ADDRESS},${mockTimestamp}`,
        );

        const request = {
          jsonrpc: '2.0' as const,
          id: '1',
          method: ClientRequestMethod.SignRewardsMessage,
          params: {
            accountId: TEST_ACCOUNT_ID,
            message,
          },
        };

        mockAccountsService.findById.mockResolvedValue(null);

        await expect(
          clientRequestHandler.handle(request as JsonRpcRequest),
        ).rejects.toThrow('Account not found');
      });

      it('throws error when address in message does not match signing account', async () => {
        const mockTimestamp = 1736660000;
        // Use a different address - validation will catch invalid addresses
        const differentAddress = 'invalid-address';
        const message = utf8ToBase64(
          `rewards,${differentAddress},${mockTimestamp}`,
        );

        const request = {
          jsonrpc: '2.0' as const,
          id: '1',
          method: ClientRequestMethod.SignRewardsMessage,
          params: {
            accountId: TEST_ACCOUNT_ID,
            message,
          },
        };

        // The validation struct will catch the invalid address format
        // before we can compare it to the signing account address
        await expect(
          clientRequestHandler.handle(request as JsonRpcRequest),
        ).rejects.toThrow('Invalid method parameter(s)');
      });

      it('throws error when message has invalid format', async () => {
        const invalidMessage = utf8ToBase64('rewards,invalid');

        const request = {
          jsonrpc: '2.0' as const,
          id: '1',
          method: ClientRequestMethod.SignRewardsMessage,
          params: {
            accountId: TEST_ACCOUNT_ID,
            message: invalidMessage,
          },
        };

        await expect(
          clientRequestHandler.handle(request as JsonRpcRequest),
        ).rejects.toThrow('Invalid method parameter(s)');
      });

      it('throws error when timestamp is invalid', async () => {
        const invalidMessage = utf8ToBase64(
          `rewards,${TEST_ADDRESS},invalid-timestamp`,
        );

        const request = {
          jsonrpc: '2.0' as const,
          id: '1',
          method: ClientRequestMethod.SignRewardsMessage,
          params: {
            accountId: TEST_ACCOUNT_ID,
            message: invalidMessage,
          },
        };

        await expect(
          clientRequestHandler.handle(request as JsonRpcRequest),
        ).rejects.toThrow('Invalid method parameter(s)');
      });
    });
  });
});

describe('ClientRequestHandler - onAmountInput', () => {
  const TEST_ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';
  const TEST_TO_ADDRESS = 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx';
  const scope = Network.Mainnet;
  const nativeTokenId = Networks[scope].nativeToken.id;

  type OnAmountInputRequest = Infer<typeof OnAmountInputRequestStruct>;
  type WithOnAmountInputHandlerCallback<ReturnValue> = (payload: {
    handler: ClientRequestHandler;
    mockAccountsService: jest.Mocked<Pick<AccountsService, 'findById'>>;
    mockAssetsService: jest.Mocked<Pick<AssetsService, 'getAssetsByAccountId'>>;
    mockSendService: jest.Mocked<Pick<SendService, 'buildTransaction'>>;
    mockTransactionService: jest.Mocked<TransactionService>;
  }) => Promise<ReturnValue> | ReturnValue;

  const mockAccount: TronKeyringAccount = {
    id: TEST_ACCOUNT_ID,
    address: 'TExvJsxzPyAZ2NtkrWgNKnbLkpqnFJ73DT',
    type: 'tron:eoa',
    options: {},
    methods: [],
    scopes: [scope],
    entropySource: 'test-entropy',
    derivationPath: "m/44'/195'/0'/0/0",
    index: 0,
  };

  const createNativeAsset = (
    uiAmount: string,
    rawAmount: string,
  ): NativeAsset => ({
    assetType: nativeTokenId,
    keyringAccountId: TEST_ACCOUNT_ID,
    network: scope,
    symbol: 'TRX',
    decimals: 6,
    rawAmount,
    uiAmount,
    iconUrl: Networks[scope].nativeToken.iconUrl,
  });

  const createResourceAsset = (
    assetType: ResourceAsset['assetType'],
    uiAmount: string,
    rawAmount: string,
  ): ResourceAsset => ({
    assetType,
    keyringAccountId: TEST_ACCOUNT_ID,
    network: scope,
    symbol:
      assetType === Networks[scope].bandwidth.id
        ? Networks[scope].bandwidth.symbol
        : Networks[scope].energy.symbol,
    decimals: 0,
    rawAmount,
    uiAmount,
    iconUrl:
      assetType === Networks[scope].bandwidth.id
        ? Networks[scope].bandwidth.iconUrl
        : Networks[scope].energy.iconUrl,
  });

  const createMockTransferTransaction = (): Transaction<TransferContract> => ({
    visible: false,
    txID: 'mock-tx-id',

    raw_data: {
      contract: [
        {
          type: 'TransferContract' as Transaction<TransferContract>['raw_data']['contract'][number]['type'],
          parameter: {
            type_url: 'type.googleapis.com/protocol.TransferContract',
            value: {
              owner_address: `41${'a'.repeat(40)}`,

              to_address: `41${'b'.repeat(40)}`,
              amount: 1000000,
            },
          },
        },
      ],

      ref_block_bytes: '0000',

      ref_block_hash: '0'.repeat(16),
      expiration: Date.now() + 60000,
      timestamp: Date.now(),
    },

    raw_data_hex: 'mock-hex',
  });

  /**
   * Wraps `onAmountInput` tests by creating a fresh handler and fresh mocks.
   *
   * @param testFunction - The test body receiving the handler and relevant mocks.
   * @returns The return value of the callback.
   */
  async function withOnAmountInputHandler<ReturnValue>(
    testFunction: WithOnAmountInputHandlerCallback<ReturnValue>,
  ): Promise<ReturnValue> {
    const mockAccountsService: jest.Mocked<Pick<AccountsService, 'findById'>> =
      {
        findById: jest.fn(),
      };

    const mockAssetsService: jest.Mocked<
      Pick<AssetsService, 'getAssetsByAccountId'>
    > = {
      getAssetsByAccountId: jest.fn(),
    };

    const mockSendService: jest.Mocked<Pick<SendService, 'buildTransaction'>> =
      {
        buildTransaction: jest.fn(),
      };

    const mockTransactionService = createMockTransactionService();

    const handler = new ClientRequestHandler({
      logger: mockLogger,
      accountsService: mockAccountsService as unknown as AccountsService,
      assetsService: mockAssetsService as unknown as AssetsService,
      sendService: mockSendService as unknown as SendService,
      transactionService:
        mockTransactionService as unknown as TransactionService,
      tronWebFactory: {} as TronWebFactory,
      snapClient: {} as SnapClient,
      stakingService: {} as StakingService,
      confirmationHandler: {} as ConfirmationHandler,
      transactionsService: {} as TransactionHistoryService,
    });

    return await testFunction({
      handler,
      mockAccountsService,
      mockAssetsService,
      mockSendService,
      mockTransactionService,
    });
  }

  it('returns valid and skips fee validation when toAddress is missing', async () => {
    await withOnAmountInputHandler(
      async ({
        handler,
        mockAccountsService,
        mockAssetsService,
        mockSendService,
        mockTransactionService,
      }) => {
        const request: OnAmountInputRequest = {
          jsonrpc: '2.0' as const,
          id: '1',
          method: ClientRequestMethod.OnAmountInput,
          params: {
            accountId: TEST_ACCOUNT_ID,
            assetId: nativeTokenId,
            value: '10',
          },
        };

        const mockAsset = createNativeAsset('100', '100000000');
        const mockAssets: [
          NativeAsset,
          NativeAsset,
          ResourceAsset,
          ResourceAsset,
        ] = [
          mockAsset,
          mockAsset,
          createResourceAsset(Networks[scope].bandwidth.id, '5000', '5000'),
          createResourceAsset(Networks[scope].energy.id, '100000', '100000'),
        ];

        mockAccountsService.findById.mockResolvedValue(mockAccount);
        mockAssetsService.getAssetsByAccountId.mockResolvedValue(mockAssets);

        const result = await handler.handle(request);

        expect(result).toStrictEqual({ valid: true, errors: [] });
        expect(mockSendService.buildTransaction).not.toHaveBeenCalled();
        expect(mockTransactionService.estimateFee).not.toHaveBeenCalled();
      },
    );
  });

  it('uses provided toAddress when building the transaction for fee estimation', async () => {
    await withOnAmountInputHandler(
      async ({
        handler,
        mockAccountsService,
        mockAssetsService,
        mockSendService,
        mockTransactionService,
      }) => {
        const request: OnAmountInputRequest = {
          jsonrpc: '2.0' as const,
          id: '2',
          method: ClientRequestMethod.OnAmountInput,
          params: {
            accountId: TEST_ACCOUNT_ID,
            assetId: nativeTokenId,
            value: '10',
            toAddress: TEST_TO_ADDRESS,
          },
        };

        const mockAsset = createNativeAsset('100', '100000000');
        const mockAssets: [
          NativeAsset,
          NativeAsset,
          ResourceAsset,
          ResourceAsset,
        ] = [
          mockAsset,
          mockAsset,
          createResourceAsset(Networks[scope].bandwidth.id, '5000', '5000'),
          createResourceAsset(Networks[scope].energy.id, '100000', '100000'),
        ];
        const builtTransaction = createMockTransferTransaction();
        const mockFees: ComputeFeeResult = [
          {
            type: FeeType.Base,
            asset: {
              unit: 'TRX',
              type: nativeTokenId,
              amount: '1',
              fungible: true,
            },
          },
        ];

        mockAccountsService.findById.mockResolvedValue(mockAccount);
        mockAssetsService.getAssetsByAccountId.mockResolvedValue(mockAssets);
        mockSendService.buildTransaction.mockResolvedValue(builtTransaction);
        mockTransactionService.estimateFee.mockResolvedValue(mockFees);

        const result = await handler.handle(request);

        expect(result).toStrictEqual({ valid: true, errors: [] });
        expect(mockSendService.buildTransaction).toHaveBeenCalledWith({
          fromAccountId: TEST_ACCOUNT_ID,
          toAddress: TEST_TO_ADDRESS,
          asset: mockAsset,
          amount: new BigNumber('10'),
          feeLimit: FEE_LIMIT,
        });
        expect(mockTransactionService.estimateFee).toHaveBeenCalledWith({
          scope,
          accountId: TEST_ACCOUNT_ID,
          transaction: builtTransaction,
          feeLimit: FEE_LIMIT,
        });
      },
    );
  });

  it('passes amount as BigNumber (not number) to preserve decimal precision', async () => {
    await withOnAmountInputHandler(
      async ({
        handler,
        mockAccountsService,
        mockAssetsService,
        mockSendService,
        mockTransactionService,
      }) => {
        const request: OnAmountInputRequest = {
          jsonrpc: '2.0' as const,
          id: '5',
          method: ClientRequestMethod.OnAmountInput,
          params: {
            accountId: TEST_ACCOUNT_ID,
            assetId: nativeTokenId,
            value: '0.99',
            toAddress: TEST_TO_ADDRESS,
          },
        };

        const mockAsset = createNativeAsset('100', '100000000');
        const mockAssets: [
          NativeAsset,
          NativeAsset,
          ResourceAsset,
          ResourceAsset,
        ] = [
          mockAsset,
          mockAsset,
          createResourceAsset(Networks[scope].bandwidth.id, '5000', '5000'),
          createResourceAsset(Networks[scope].energy.id, '100000', '100000'),
        ];
        const builtTransaction = createMockTransferTransaction();
        const mockFees: ComputeFeeResult = [
          {
            type: FeeType.Base,
            asset: {
              unit: 'TRX',
              type: nativeTokenId,
              amount: '0',
              fungible: true,
            },
          },
        ];

        mockAccountsService.findById.mockResolvedValue(mockAccount);
        mockAssetsService.getAssetsByAccountId.mockResolvedValue(mockAssets);
        mockSendService.buildTransaction.mockResolvedValue(builtTransaction);
        mockTransactionService.estimateFee.mockResolvedValue(mockFees);

        await handler.handle(request);

        const calledAmount = mockSendService.buildTransaction.mock.calls[0]?.[0]
          ?.amount as BigNumber;

        // Must be a BigNumber, not a number — prevents IEEE 754 precision loss
        expect(calledAmount).toBeInstanceOf(BigNumber);
        // Must preserve exact decimal representation (0.99, not 0.98999999999999999...)
        expect(calledAmount.toString()).toBe('0.99');
      },
    );
  });

  it('returns insufficient balance when the asset balance is too low and toAddress is missing', async () => {
    await withOnAmountInputHandler(
      async ({
        handler,
        mockAccountsService,
        mockAssetsService,
        mockSendService,
        mockTransactionService,
      }) => {
        const request: OnAmountInputRequest = {
          jsonrpc: '2.0' as const,
          id: '3',
          method: ClientRequestMethod.OnAmountInput,
          params: {
            accountId: TEST_ACCOUNT_ID,
            assetId: nativeTokenId,
            value: '10',
          },
        };

        const lowBalanceAsset = createNativeAsset('5', '5000000');
        const mockAssets: [
          NativeAsset,
          NativeAsset,
          ResourceAsset,
          ResourceAsset,
        ] = [
          lowBalanceAsset,
          lowBalanceAsset,
          createResourceAsset(Networks[scope].bandwidth.id, '5000', '5000'),
          createResourceAsset(Networks[scope].energy.id, '100000', '100000'),
        ];

        mockAccountsService.findById.mockResolvedValue(mockAccount);
        mockAssetsService.getAssetsByAccountId.mockResolvedValue(mockAssets);

        const result = await handler.handle(request);

        expect(result).toStrictEqual({
          valid: false,
          errors: [{ code: SendErrorCodes.InsufficientBalance }],
        });
        expect(mockSendService.buildTransaction).not.toHaveBeenCalled();
        expect(mockTransactionService.estimateFee).not.toHaveBeenCalled();
      },
    );
  });

  it('returns insufficient balance to cover fee when toAddress is provided and fees exceed the native balance', async () => {
    await withOnAmountInputHandler(
      async ({
        handler,
        mockAccountsService,
        mockAssetsService,
        mockSendService,
        mockTransactionService,
      }) => {
        const request: OnAmountInputRequest = {
          jsonrpc: '2.0' as const,
          id: '4',
          method: ClientRequestMethod.OnAmountInput,
          params: {
            accountId: TEST_ACCOUNT_ID,
            assetId: nativeTokenId,
            value: '10',
            toAddress: TEST_TO_ADDRESS,
          },
        };

        const mockAsset = createNativeAsset('10', '10000000');
        const mockAssets: [
          NativeAsset,
          NativeAsset,
          ResourceAsset,
          ResourceAsset,
        ] = [
          mockAsset,
          mockAsset,
          createResourceAsset(Networks[scope].bandwidth.id, '0', '0'),
          createResourceAsset(Networks[scope].energy.id, '0', '0'),
        ];
        const builtTransaction = createMockTransferTransaction();
        const mockFees: ComputeFeeResult = [
          {
            type: FeeType.Base,
            asset: {
              unit: 'TRX',
              type: nativeTokenId,
              amount: '1',
              fungible: true,
            },
          },
        ];

        mockAccountsService.findById.mockResolvedValue(mockAccount);
        mockAssetsService.getAssetsByAccountId.mockResolvedValue(mockAssets);
        mockSendService.buildTransaction.mockResolvedValue(builtTransaction);
        mockTransactionService.estimateFee.mockResolvedValue(mockFees);

        const result = await handler.handle(request);

        expect(result).toStrictEqual({
          valid: false,
          errors: [{ code: SendErrorCodes.InsufficientBalanceToCoverFee }],
        });
      },
    );
  });
});

describe('ClientRequestHandler - computeStakeFee', () => {
  let clientRequestHandler: ClientRequestHandler;
  let mockAccountsService: jest.Mocked<AccountsService>;
  let mockAssetsService: jest.Mocked<AssetsService>;
  let mockSendService: jest.Mocked<SendService>;
  let mockTransactionService: jest.Mocked<TransactionService>;
  let mockTronWebFactory: jest.Mocked<TronWebFactory>;
  let mockSnapClient: jest.Mocked<SnapClient>;
  let mockStakingService: jest.Mocked<StakingService>;
  let mockConfirmationHandler: jest.Mocked<ConfirmationHandler>;
  let mockTransactionHistoryService: jest.Mocked<TransactionHistoryService>;
  let mockTronWeb: any;

  const TEST_ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    mockAccountsService = {
      findByIdOrThrow: jest.fn(),
      deriveTronKeypair: jest.fn(),
    } as unknown as jest.Mocked<AccountsService>;

    mockAssetsService = {
      getAssetByAccountId: jest.fn(),
      getAssetsByAccountId: jest.fn(),
    } as unknown as jest.Mocked<AssetsService>;

    mockSendService = {} as unknown as jest.Mocked<SendService>;

    mockTransactionService = createMockTransactionService();

    mockTronWeb = {
      trx: {
        sign: jest.fn(),
      },
      transactionBuilder: {
        freezeBalanceV2: jest.fn(),
      },
    };

    mockTronWebFactory = {
      createClient: jest.fn().mockReturnValue(mockTronWeb),
    } as unknown as jest.Mocked<TronWebFactory>;

    mockSnapClient = {} as unknown as jest.Mocked<SnapClient>;
    mockStakingService = {
      estimateStakeFee: jest.fn(),
    } as unknown as jest.Mocked<StakingService>;
    mockConfirmationHandler = {} as unknown as jest.Mocked<ConfirmationHandler>;
    mockTransactionHistoryService = {
      save: jest.fn(),
    } as unknown as jest.Mocked<TransactionHistoryService>;
    clientRequestHandler = new ClientRequestHandler({
      logger: mockLogger,
      accountsService: mockAccountsService,
      assetsService: mockAssetsService,
      sendService: mockSendService,
      transactionService: mockTransactionService,
      tronWebFactory: mockTronWebFactory,
      snapClient: mockSnapClient,
      stakingService: mockStakingService,
      confirmationHandler: mockConfirmationHandler,
      transactionsService: mockTransactionHistoryService,
    });
  });

  it('computes fee breakdown for TRX staking on mainnet', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: '1',
      method: ClientRequestMethod.ComputeStakeFee,
      params: {
        fromAccountId: TEST_ACCOUNT_ID,
        value: '10',
        options: {
          purpose: 'ENERGY' as const,
        },
      },
    };

    const scope = Network.Mainnet;

    // Mock account lookup
    mockAccountsService.findByIdOrThrow.mockResolvedValue({
      id: TEST_ACCOUNT_ID,
      address: 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx',
      entropySource: 'test-entropy',
      derivationPath: [],
    } as any);

    // Native TRX asset for mainnet
    const nativeAssetId = Networks[scope].nativeToken.id;

    // Mock native balance
    (mockAssetsService.getAssetByAccountId as jest.Mock).mockResolvedValue({
      uiAmount: '100',
    });

    const feeResult = [
      {
        type: FeeType.Base,
        asset: {
          unit: Networks[scope].energy.symbol,
          type: Networks[scope].energy.id,
          amount: '65000',
          fungible: true as const,
        },
      },
    ];
    mockStakingService.estimateStakeFee.mockResolvedValue(feeResult);

    const result = await clientRequestHandler.handle(request as JsonRpcRequest);

    expect(mockAccountsService.findByIdOrThrow).toHaveBeenCalledWith(
      TEST_ACCOUNT_ID,
    );
    expect(mockAccountsService.deriveTronKeypair).not.toHaveBeenCalled();
    expect(mockTronWebFactory.createClient).not.toHaveBeenCalled();
    expect(mockAssetsService.getAssetByAccountId).toHaveBeenCalledWith(
      TEST_ACCOUNT_ID,
      nativeAssetId,
    );
    expect(mockStakingService.estimateStakeFee).toHaveBeenCalledWith({
      account: expect.objectContaining({ id: TEST_ACCOUNT_ID }),
      assetId: nativeAssetId,
      amount: BigNumber('10'),
      purpose: 'ENERGY',
    });
    expect(result).toStrictEqual(feeResult);
  });

  it('returns insufficient balance error when staking more than balance', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: '2',
      method: ClientRequestMethod.ComputeStakeFee,
      params: {
        fromAccountId: TEST_ACCOUNT_ID,
        value: '10',
        options: {
          purpose: 'BANDWIDTH' as const,
        },
      },
    };

    mockAccountsService.findByIdOrThrow.mockResolvedValue({
      id: TEST_ACCOUNT_ID,
      address: 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx',
      entropySource: 'test-entropy',
      derivationPath: [],
    } as any);

    // Account has only 5 TRX
    (mockAssetsService.getAssetByAccountId as jest.Mock).mockResolvedValue({
      uiAmount: '5',
    });

    const result = (await clientRequestHandler.handle(
      request as JsonRpcRequest,
    )) as any;

    expect(result).toStrictEqual({
      valid: false,
      errors: [SendErrorCodes.InsufficientBalance],
    });
    expect(mockStakingService.estimateStakeFee).not.toHaveBeenCalled();
  });
});

describe('ClientRequestHandler - confirmSend validation', () => {
  let clientRequestHandler: ClientRequestHandler;
  let mockAccountsService: jest.Mocked<AccountsService>;
  let mockAssetsService: jest.Mocked<AssetsService>;
  let mockSendService: jest.Mocked<SendService>;
  let mockTransactionService: jest.Mocked<TransactionService>;
  let mockTronWebFactory: jest.Mocked<TronWebFactory>;
  let mockSnapClient: jest.Mocked<SnapClient>;
  let mockStakingService: jest.Mocked<StakingService>;
  let mockConfirmationHandler: jest.Mocked<ConfirmationHandler>;
  let mockTransactionHistoryService: jest.Mocked<TransactionHistoryService>;

  const TEST_ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';
  const TEST_TO_ADDRESS = 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx';
  const scope = Network.Mainnet;

  beforeEach(() => {
    mockAccountsService = {
      findById: jest.fn(),
      findByIdOrThrow: jest.fn(),
      deriveTronKeypair: jest.fn(),
    } as unknown as jest.Mocked<AccountsService>;

    mockAssetsService = {
      getAssetByAccountId: jest.fn(),
      getAssetsByAccountId: jest.fn(),
    } as unknown as jest.Mocked<AssetsService>;

    mockSendService = {
      validateSend: jest.fn(),
      buildTransaction: jest.fn(),
      signAndSendTransaction: jest.fn(),
    } as unknown as jest.Mocked<SendService>;

    mockTransactionService = createMockTransactionService();

    mockTronWebFactory = {
      createClient: jest.fn(),
    } as unknown as jest.Mocked<TronWebFactory>;

    mockSnapClient = {} as unknown as jest.Mocked<SnapClient>;
    mockStakingService = {} as unknown as jest.Mocked<StakingService>;
    mockConfirmationHandler = {
      confirmTransactionRequest: jest.fn(),
    } as unknown as jest.Mocked<ConfirmationHandler>;
    mockTransactionHistoryService = {
      save: jest.fn(),
    } as unknown as jest.Mocked<TransactionHistoryService>;

    clientRequestHandler = new ClientRequestHandler({
      logger: mockLogger,
      accountsService: mockAccountsService,
      assetsService: mockAssetsService,
      sendService: mockSendService,
      transactionService: mockTransactionService,
      tronWebFactory: mockTronWebFactory,
      snapClient: mockSnapClient,
      stakingService: mockStakingService,
      confirmationHandler: mockConfirmationHandler,
      transactionsService: mockTransactionHistoryService,
    });
  });

  it('returns InsufficientBalance when validateSend returns InsufficientBalance', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: '1',
      method: ClientRequestMethod.ConfirmSend,
      params: {
        fromAccountId: TEST_ACCOUNT_ID,
        toAddress: TEST_TO_ADDRESS,
        amount: '10',
        assetId: Networks[scope].nativeToken.id,
      },
    };

    // Mock account found
    mockAccountsService.findById.mockResolvedValue({
      id: TEST_ACCOUNT_ID,
      address: 'TExvJsxzPyAZ2NtkrWgNKnbLkpqnFJ73DT',
      entropySource: 'test-entropy',
      derivationPath: [],
      type: 'tron:basic',
    } as any);

    // Mock asset found
    const mockAsset = {
      assetType: Networks[scope].nativeToken.id,
      symbol: 'TRX',
      decimals: 6,
      uiAmount: '100',
      rawAmount: '100000000',
    };
    (mockAssetsService.getAssetByAccountId as jest.Mock).mockResolvedValue(
      mockAsset,
    );

    // validateSend returns insufficient balance
    mockSendService.validateSend.mockResolvedValue({
      valid: false,
      errorCode: 'InsufficientBalance' as any,
    });

    const result = (await clientRequestHandler.handle(
      request as JsonRpcRequest,
    )) as any;

    expect(result).toStrictEqual({
      valid: false,
      errors: [{ code: SendErrorCodes.InsufficientBalance }],
    });

    expect(mockSendService.validateSend).toHaveBeenCalledWith({
      scope,
      fromAccountId: TEST_ACCOUNT_ID,
      toAddress: TEST_TO_ADDRESS,
      asset: mockAsset,
      amount: BigNumber('10'),
      feeLimit: FEE_LIMIT,
    });

    // Should not proceed to build transaction or confirmation
    expect(mockSendService.buildTransaction).not.toHaveBeenCalled();
    expect(
      mockConfirmationHandler.confirmTransactionRequest,
    ).not.toHaveBeenCalled();
  });

  it('returns InsufficientBalanceToCoverFee when validateSend returns InsufficientBalanceToCoverFee', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: '1',
      method: ClientRequestMethod.ConfirmSend,
      params: {
        fromAccountId: TEST_ACCOUNT_ID,
        toAddress: TEST_TO_ADDRESS,
        amount: '99',
        assetId: Networks[scope].nativeToken.id,
      },
    };

    mockAccountsService.findById.mockResolvedValue({
      id: TEST_ACCOUNT_ID,
      address: 'TExvJsxzPyAZ2NtkrWgNKnbLkpqnFJ73DT',
      entropySource: 'test-entropy',
      derivationPath: [],
      type: 'tron:basic',
    } as any);

    const mockAsset = {
      assetType: Networks[scope].nativeToken.id,
      symbol: 'TRX',
      decimals: 6,
      uiAmount: '100',
      rawAmount: '100000000',
    };
    (mockAssetsService.getAssetByAccountId as jest.Mock).mockResolvedValue(
      mockAsset,
    );

    // validateSend returns insufficient balance to cover fee
    mockSendService.validateSend.mockResolvedValue({
      valid: false,
      errorCode: 'InsufficientBalanceToCoverFee' as any,
    });

    const result = (await clientRequestHandler.handle(
      request as JsonRpcRequest,
    )) as any;

    expect(result).toStrictEqual({
      valid: false,
      errors: [{ code: SendErrorCodes.InsufficientBalanceToCoverFee }],
    });

    expect(mockSendService.buildTransaction).not.toHaveBeenCalled();
    expect(
      mockConfirmationHandler.confirmTransactionRequest,
    ).not.toHaveBeenCalled();
  });

  it('proceeds to confirmation when validateSend returns valid', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: '1',
      method: ClientRequestMethod.ConfirmSend,
      params: {
        fromAccountId: TEST_ACCOUNT_ID,
        toAddress: TEST_TO_ADDRESS,
        amount: '10',
        assetId: Networks[scope].nativeToken.id,
      },
    };

    const mockAccount = {
      id: TEST_ACCOUNT_ID,
      address: 'TExvJsxzPyAZ2NtkrWgNKnbLkpqnFJ73DT',
      entropySource: 'test-entropy',
      derivationPath: [],
      type: 'tron:basic',
    };
    mockAccountsService.findById.mockResolvedValue(mockAccount as any);

    const mockAsset = {
      assetType: Networks[scope].nativeToken.id,
      symbol: 'TRX',
      decimals: 6,
      uiAmount: '100',
      rawAmount: '100000000',
    };
    (mockAssetsService.getAssetByAccountId as jest.Mock).mockResolvedValue(
      mockAsset,
    );

    // validateSend returns valid
    mockSendService.validateSend.mockResolvedValue({ valid: true });

    const mockTransaction = {
      txID: 'test-tx-id',

      raw_data: {},

      raw_data_hex: 'test-hex',
    };
    mockSendService.buildTransaction.mockResolvedValue(mockTransaction as any);

    const mockFees = [
      {
        type: 'base' as const,
        asset: {
          unit: 'TRX',
          type: Networks[scope].nativeToken.id,
          amount: '0',
          fungible: true as const,
        },
      },
    ];
    mockTransactionService.estimateFee.mockResolvedValue(mockFees as any);

    // User confirms
    mockConfirmationHandler.confirmTransactionRequest.mockResolvedValue(true);

    mockTransactionService.broadcast.mockResolvedValue({
      txid: 'broadcast-tx-id',
      result: { result: true, txid: 'broadcast-tx-id' },
    });

    const result = await clientRequestHandler.handle(request as JsonRpcRequest);

    // Should have proceeded through the full flow
    expect(mockSendService.validateSend).toHaveBeenCalledWith({
      scope,
      fromAccountId: TEST_ACCOUNT_ID,
      toAddress: TEST_TO_ADDRESS,
      asset: mockAsset,
      amount: BigNumber('10'),
      feeLimit: FEE_LIMIT,
    });
    expect(mockSendService.buildTransaction).toHaveBeenCalledWith({
      fromAccountId: TEST_ACCOUNT_ID,
      toAddress: TEST_TO_ADDRESS,
      asset: mockAsset,
      amount: BigNumber('10'),
      feeLimit: FEE_LIMIT,
    });
    expect(mockTransactionService.estimateFee).toHaveBeenCalledWith({
      scope,
      accountId: TEST_ACCOUNT_ID,
      transaction: mockTransaction,
      feeLimit: FEE_LIMIT,
    });
    expect(
      mockConfirmationHandler.confirmTransactionRequest,
    ).toHaveBeenCalled();
    expect(mockTransactionService.broadcast).toHaveBeenCalledWith({
      scope,
      accountId: TEST_ACCOUNT_ID,
      transaction: mockTransaction,
      tracking: { type: 'transaction', origin: 'MetaMask' },
    });

    // Result should be the transaction result
    expect(result).toMatchObject({
      transactionId: 'broadcast-tx-id',
      status: 'submitted',
    });

    // buildTransaction must receive a BigNumber to preserve decimal precision
    const calledAmount = mockSendService.buildTransaction.mock.calls[0]?.[0]
      ?.amount as BigNumber;
    expect(calledAmount).toBeInstanceOf(BigNumber);
    expect(calledAmount.toString()).toBe('10');
  });

  it('returns Invalid error when account is not found', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: '1',
      method: ClientRequestMethod.ConfirmSend,
      params: {
        fromAccountId: TEST_ACCOUNT_ID,
        toAddress: TEST_TO_ADDRESS,
        amount: '10',
        assetId: Networks[scope].nativeToken.id,
      },
    };

    // Account not found
    mockAccountsService.findById.mockResolvedValue(null);

    const result = (await clientRequestHandler.handle(
      request as JsonRpcRequest,
    )) as any;

    expect(result).toStrictEqual({
      valid: false,
      errors: [{ code: SendErrorCodes.Invalid }],
    });

    expect(mockSendService.validateSend).not.toHaveBeenCalled();
  });

  it('returns InsufficientBalance when asset is not found', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: '1',
      method: ClientRequestMethod.ConfirmSend,
      params: {
        fromAccountId: TEST_ACCOUNT_ID,
        toAddress: TEST_TO_ADDRESS,
        amount: '10',
        assetId: Networks[scope].nativeToken.id,
      },
    };

    mockAccountsService.findById.mockResolvedValue({
      id: TEST_ACCOUNT_ID,
      address: 'TExvJsxzPyAZ2NtkrWgNKnbLkpqnFJ73DT',
      entropySource: 'test-entropy',
      derivationPath: [],
      type: 'tron:basic',
    } as any);

    // Asset not found
    (mockAssetsService.getAssetByAccountId as jest.Mock).mockResolvedValue(
      null,
    );

    const result = (await clientRequestHandler.handle(
      request as JsonRpcRequest,
    )) as any;

    expect(result).toStrictEqual({
      valid: false,
      errors: [{ code: SendErrorCodes.InsufficientBalance }],
    });

    expect(mockSendService.validateSend).not.toHaveBeenCalled();
  });
});

describe('ClientRequestHandler - claimUnstakedTrx', () => {
  let clientRequestHandler: ClientRequestHandler;
  let mockAccountsService: jest.Mocked<AccountsService>;
  let mockAssetsService: jest.Mocked<AssetsService>;
  let mockSendService: jest.Mocked<SendService>;
  let mockTransactionService: jest.Mocked<TransactionService>;
  let mockTronWebFactory: jest.Mocked<TronWebFactory>;
  let mockSnapClient: jest.Mocked<SnapClient>;
  let mockStakingService: jest.Mocked<StakingService>;
  let mockConfirmationHandler: jest.Mocked<ConfirmationHandler>;
  let mockTransactionHistoryService: jest.Mocked<TransactionHistoryService>;

  const TEST_ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';

  const mockAccount = {
    id: TEST_ACCOUNT_ID,
    address: 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx',
    entropySource: 'test-entropy',
    derivationPath: "m/44'/195'/0'/0/0",
  };

  beforeEach(() => {
    mockAccountsService = {
      findByIdOrThrow: jest.fn().mockResolvedValue(mockAccount),
    } as unknown as jest.Mocked<AccountsService>;

    mockAssetsService = {} as unknown as jest.Mocked<AssetsService>;
    mockSendService = {} as unknown as jest.Mocked<SendService>;
    mockTransactionService = createMockTransactionService();
    mockTronWebFactory = {
      createClient: jest.fn(),
    } as unknown as jest.Mocked<TronWebFactory>;
    mockSnapClient = {} as unknown as jest.Mocked<SnapClient>;
    mockStakingService = {
      buildClaimUnstakedTrxTransactions: jest.fn().mockResolvedValue([
        {
          txID: 'claim-tx-id',
          raw_data: {},
          raw_data_hex: 'claim-hex',
        },
      ]),
    } as unknown as jest.Mocked<StakingService>;
    mockConfirmationHandler = {
      confirmClaimUnstakedTrx: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<ConfirmationHandler>;
    mockTransactionHistoryService = {
      save: jest.fn(),
    } as unknown as jest.Mocked<TransactionHistoryService>;

    clientRequestHandler = new ClientRequestHandler({
      logger: mockLogger,
      accountsService: mockAccountsService,
      assetsService: mockAssetsService,
      sendService: mockSendService,
      transactionService: mockTransactionService,
      tronWebFactory: mockTronWebFactory,
      snapClient: mockSnapClient,
      stakingService: mockStakingService,
      confirmationHandler: mockConfirmationHandler,
      transactionsService: mockTransactionHistoryService,
    });
  });

  it('claims unstaked TRX successfully when user confirms', async () => {
    mockConfirmationHandler.confirmClaimUnstakedTrx.mockResolvedValue(true);
    mockTransactionService.estimateFees.mockResolvedValue([
      [
        {
          type: FeeType.Base,
          asset: {
            unit: 'TRX',
            type: Networks[Network.Mainnet].nativeToken.id,
            amount: '0',
            fungible: true,
          },
        },
      ],
    ]);

    const request = {
      jsonrpc: '2.0' as const,
      id: '1',
      method: 'claimUnstakedTrx',
      params: {
        fromAccountId: TEST_ACCOUNT_ID,
        assetId: Networks[Network.Mainnet].nativeToken.id,
      },
    };

    const result = await clientRequestHandler.handle(request as JsonRpcRequest);

    expect(mockAccountsService.findByIdOrThrow).toHaveBeenCalledWith(
      TEST_ACCOUNT_ID,
    );
    expect(
      mockConfirmationHandler.confirmClaimUnstakedTrx,
    ).toHaveBeenCalledWith({
      account: mockAccount,
      scope: Network.Mainnet,
      fees: [
        {
          type: FeeType.Base,
          asset: {
            unit: 'TRX',
            type: Networks[Network.Mainnet].nativeToken.id,
            amount: '0',
            fungible: true,
          },
        },
      ],
    });
    expect(mockTransactionService.broadcastMany).toHaveBeenCalledWith({
      scope: Network.Mainnet,
      accountId: TEST_ACCOUNT_ID,
      transactions: [
        {
          txID: 'claim-tx-id',
          raw_data: {},
          raw_data_hex: 'claim-hex',
        },
      ],
      tracking: { type: 'accountSync' },
    });
    expect(result).toStrictEqual({ valid: true, errors: [] });
  });

  it('throws when user rejects the confirmation', async () => {
    mockConfirmationHandler.confirmClaimUnstakedTrx.mockResolvedValue(false);

    const request = {
      jsonrpc: '2.0' as const,
      id: '1',
      method: 'claimUnstakedTrx',
      params: {
        fromAccountId: TEST_ACCOUNT_ID,
        assetId: Networks[Network.Mainnet].nativeToken.id,
      },
    };

    await expect(
      clientRequestHandler.handle(request as JsonRpcRequest),
    ).rejects.toThrow('User rejected the request.');

    expect(
      mockConfirmationHandler.confirmClaimUnstakedTrx,
    ).toHaveBeenCalledWith({
      account: mockAccount,
      scope: Network.Mainnet,
      fees: [],
    });
    expect(mockTransactionService.broadcastMany).not.toHaveBeenCalled();
  });

  it('throws InvalidParamsError for invalid params', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: '1',
      method: 'claimUnstakedTrx',
      params: {
        fromAccountId: 'not-a-uuid',
        assetId: 'invalid-asset',
      },
    };

    await expect(
      clientRequestHandler.handle(request as JsonRpcRequest),
    ).rejects.toThrow('Invalid method parameter(s)');
  });
});

describe('ClientRequestHandler - claimTrxStakingRewards', () => {
  let clientRequestHandler: ClientRequestHandler;
  let mockAccountsService: jest.Mocked<AccountsService>;
  let mockAssetsService: jest.Mocked<AssetsService>;
  let mockSendService: jest.Mocked<SendService>;
  let mockTransactionService: jest.Mocked<TransactionService>;
  let mockTronWebFactory: jest.Mocked<TronWebFactory>;
  let mockSnapClient: jest.Mocked<SnapClient>;
  let mockStakingService: jest.Mocked<StakingService>;
  let mockConfirmationHandler: jest.Mocked<ConfirmationHandler>;
  let mockTransactionHistoryService: jest.Mocked<TransactionHistoryService>;

  const TEST_ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';

  const mockAccount = {
    id: TEST_ACCOUNT_ID,
    address: 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx',
    entropySource: 'test-entropy',
    derivationPath: "m/44'/195'/0'/0/0",
  };

  beforeEach(() => {
    mockAccountsService = {
      findByIdOrThrow: jest.fn().mockResolvedValue(mockAccount),
    } as unknown as jest.Mocked<AccountsService>;

    mockAssetsService = {} as unknown as jest.Mocked<AssetsService>;
    mockSendService = {} as unknown as jest.Mocked<SendService>;
    mockTransactionService = createMockTransactionService();
    mockTronWebFactory = {
      createClient: jest.fn(),
    } as unknown as jest.Mocked<TronWebFactory>;
    mockSnapClient = {} as unknown as jest.Mocked<SnapClient>;
    mockStakingService = {
      buildClaimTrxStakingRewardsTransactions: jest.fn().mockResolvedValue([
        {
          txID: 'rewards-tx-id',
          raw_data: {},
          raw_data_hex: 'rewards-hex',
        },
      ]),
    } as unknown as jest.Mocked<StakingService>;
    mockConfirmationHandler = {} as unknown as jest.Mocked<ConfirmationHandler>;
    mockTransactionHistoryService = {
      save: jest.fn(),
    } as unknown as jest.Mocked<TransactionHistoryService>;

    clientRequestHandler = new ClientRequestHandler({
      logger: mockLogger,
      accountsService: mockAccountsService,
      assetsService: mockAssetsService,
      sendService: mockSendService,
      transactionService: mockTransactionService,
      tronWebFactory: mockTronWebFactory,
      snapClient: mockSnapClient,
      stakingService: mockStakingService,
      confirmationHandler: mockConfirmationHandler,
      transactionsService: mockTransactionHistoryService,
    });
  });

  it('claims staking rewards successfully', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: '1',
      method: 'claimTrxStakingRewards',
      params: {
        fromAccountId: TEST_ACCOUNT_ID,
        assetId: Networks[Network.Mainnet].nativeToken.id,
      },
    };

    const result = await clientRequestHandler.handle(request as JsonRpcRequest);

    expect(mockAccountsService.findByIdOrThrow).toHaveBeenCalledWith(
      TEST_ACCOUNT_ID,
    );
    expect(mockTransactionService.broadcastMany).toHaveBeenCalledWith({
      scope: Network.Mainnet,
      accountId: TEST_ACCOUNT_ID,
      transactions: [
        {
          txID: 'rewards-tx-id',
          raw_data: {},
          raw_data_hex: 'rewards-hex',
        },
      ],
      tracking: { type: 'accountSync' },
    });
    expect(result).toStrictEqual({ valid: true, errors: [] });
  });

  it('throws InvalidParamsError for invalid params', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: '1',
      method: 'claimTrxStakingRewards',
      params: {
        fromAccountId: 'not-a-uuid',
        assetId: 'invalid-asset',
      },
    };

    await expect(
      clientRequestHandler.handle(request as JsonRpcRequest),
    ).rejects.toThrow('Invalid method parameter(s)');
  });
});
