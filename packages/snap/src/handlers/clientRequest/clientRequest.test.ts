import { FeeType } from '@metamask/keyring-api';
import type { Json, JsonRpcRequest } from '@metamask/snaps-sdk';
import { BigNumber } from 'bignumber.js';

import { ClientRequestHandler } from './clientRequest';
import { ClientRequestMethod, SendErrorCodes } from './types';
import { Network, Networks } from '../../constants';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import type { SendValidationErrorCode } from '../../services/send/types';
import { trxToSun } from '../../utils/conversion';
import { mockLogger } from '../../utils/mockLogger';

const TEST_ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';
const TEST_ADDRESS = 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx';
const TEST_TO_ADDRESS = 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx';
const TEST_PRIVATE_KEY = 'test-private-key';
const TEST_TRANSACTION_BASE64 =
  'CgK0FiII40phBu42/OZAkJyY96YzWrADCB8SqwMKMXR5cGUuZ29vZ2xlYXBpcy5jb20vcHJvdG9jb2wuVHJpZ2dlclNtYXJ0Q29udHJhY3QS9QIKFUEU0B62M0bakw7g2jDVhRrBTODEeRIVQZlGn9WqCM/oNjlc6ZPA69Vn4sFPIsQCnd+TuwAAAAAAAAAAAAAAAKYU+AO2/XgJhqQseOycf3fm3tE8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC+vCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAnq6OQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF1RSWHxzeWtuZjl8MC41fGJyaWRnZXJzAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACJUQnNGcUttbVJ5WWNuWUphOFlEeFk1ZDJKQVJhSGVxdUJKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcLzdlPemMw==';

const MOCK_ACCOUNT: TronKeyringAccount = {
  id: TEST_ACCOUNT_ID,
  address: TEST_ADDRESS,
  entropySource: 'test-entropy',
  derivationPath: "m/44'/195'/0'/0/0",
  type: 'eip155:eoa',
  options: {},
  methods: [],
  scopes: ['tron:728126428'],
  index: 0,
};

const MOCK_SEND_ACCOUNT: TronKeyringAccount = {
  ...MOCK_ACCOUNT,
  address: 'TExvJsxzPyAZ2NtkrWgNKnbLkpqnFJ73DT',
};

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

/**
 * Builds a minimal JSON-RPC request for test purposes.
 *
 * @param method - The JSON-RPC method name.
 * @param params - The request parameters.
 * @returns A JsonRpcRequest object.
 */
function buildRequest(
  method: string,
  params: Record<string, Json>,
): JsonRpcRequest {
  return { jsonrpc: '2.0' as const, id: '1', method, params };
}

type WithClientRequestHandlerCallback = (payload: {
  handler: ClientRequestHandler;
  mockAccountsService: {
    findById: jest.Mock;
    findByIdOrThrow: jest.Mock;
    deriveTronKeypair: jest.Mock;
  };
  mockAssetsService: {
    getAssetByAccountId: jest.Mock;
    getAssetsByAccountId: jest.Mock;
  };
  mockSendService: {
    validateSend: jest.Mock;
    buildTransaction: jest.Mock;
    signAndSendTransaction: jest.Mock;
  };
  mockFeeCalculatorService: {
    computeFee: jest.Mock;
  };
  mockTronWebFactory: {
    createClient: jest.Mock;
  };
  mockTronWeb: {
    utils: {
      deserializeTx: {
        deserializeTransaction: jest.Mock;
      };
    };
    trx: {
      sign: jest.Mock;
      signMessageV2: jest.Mock;
    };
    transactionBuilder: {
      freezeBalanceV2: jest.Mock;
    };
  };
  mockStakingService: {
    claimUnstakedTrx: jest.Mock;
    claimTrxStakingRewards: jest.Mock;
  };
  mockConfirmationHandler: {
    confirmTransactionRequest: jest.Mock;
  };
  mockTransactionsService: {
    save: jest.Mock;
  };
}) => void | Promise<void>;

/**
 * Creates a fresh ClientRequestHandler with all mock dependencies and passes
 * them to the test callback. Resets mocks before each invocation.
 *
 * @param testFn - Callback that receives the handler and mocks for testing.
 */
async function withClientRequestHandler(
  testFn: WithClientRequestHandlerCallback,
): Promise<void> {
  const mockAccountsService = {
    findById: jest.fn(),
    findByIdOrThrow: jest.fn(),
    deriveTronKeypair: jest.fn(),
  };

  const mockAssetsService = {
    getAssetByAccountId: jest.fn(),
    getAssetsByAccountId: jest.fn(),
  };

  const mockSendService = {
    validateSend: jest.fn(),
    buildTransaction: jest.fn(),
    signAndSendTransaction: jest.fn(),
  };

  const mockFeeCalculatorService = {
    computeFee: jest.fn(),
  };

  const mockTronWeb = {
    utils: {
      deserializeTx: {
        deserializeTransaction: jest.fn(),
      },
    },
    trx: {
      sign: jest.fn(),
      signMessageV2: jest.fn(),
    },
    transactionBuilder: {
      freezeBalanceV2: jest.fn(),
    },
  };

  const mockTronWebFactory = {
    createClient: jest.fn().mockReturnValue(mockTronWeb),
  };

  const mockStakingService = {
    claimUnstakedTrx: jest.fn().mockResolvedValue(undefined),
    claimTrxStakingRewards: jest.fn().mockResolvedValue(undefined),
  };

  const mockConfirmationHandler = {
    confirmTransactionRequest: jest.fn(),
  };

  const mockTransactionsService = {
    save: jest.fn(),
  };

  const mockSnapClient = {
    scheduleBackgroundEvent: jest.fn(),
  };

  const handler = new ClientRequestHandler({
    logger: mockLogger,
    accountsService: mockAccountsService,
    assetsService: mockAssetsService,
    sendService: mockSendService,
    feeCalculatorService: mockFeeCalculatorService,
    tronWebFactory: mockTronWebFactory,
    snapClient: mockSnapClient,
    stakingService: mockStakingService,
    confirmationHandler: mockConfirmationHandler,
    transactionsService: mockTransactionsService,
  } as unknown as ConstructorParameters<typeof ClientRequestHandler>[0]);

  await testFn({
    handler,
    mockAccountsService,
    mockAssetsService,
    mockSendService,
    mockFeeCalculatorService,
    mockTronWebFactory,
    mockTronWeb,
    mockStakingService,
    mockConfirmationHandler,
    mockTransactionsService,
  });
}

describe('ClientRequestHandler', () => {
  describe('computeFee', () => {
    describe('when called with valid parameters from external dapp', () => {
      it('computes fee breakdown for TRC20 transfer transaction', async () => {
        await withClientRequestHandler(
          async ({
            handler,
            mockAccountsService,
            mockAssetsService,
            mockFeeCalculatorService,
            mockTronWeb,
          }) => {
            const scope = Network.Shasta;
            const request = buildRequest(ClientRequestMethod.ComputeFee, {
              accountId: TEST_ACCOUNT_ID,
              transaction: TEST_TRANSACTION_BASE64,
              scope,
              options: {
                visible: false,
                type: 'TriggerSmartContract',
              },
            });

            mockAccountsService.findByIdOrThrow.mockResolvedValue(MOCK_ACCOUNT);

            mockTronWeb.utils.deserializeTx.deserializeTransaction.mockReturnValue(
              {
                contract: [
                  {
                    type: 'TriggerSmartContract',
                    parameter: {
                      value: {
                        // eslint-disable-next-line @typescript-eslint/naming-convention
                        owner_address:
                          '41045d01eb63374da930ee0da30d58516ac14ce04c79',
                        // eslint-disable-next-line @typescript-eslint/naming-convention
                        contract_address:
                          '419946f55aa08cfe8363959ce9930ebd567e2c14f',
                        data: 'a9059cbb000000000000000000000000a614f803b6fd780986a42c78ec9c7f77e6ded13c0000000000000000000000000000000000000000000000000000000000000000',
                      },
                    },
                  },
                ],
              },
            );

            mockAssetsService.getAssetsByAccountId.mockResolvedValue([
              { rawAmount: '5000' },
              { rawAmount: '100000' },
            ]);

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
              {
                type: FeeType.Base,
                asset: {
                  unit: Networks[scope].bandwidth.symbol,
                  type: Networks[scope].bandwidth.id,
                  amount: '345',
                  fungible: true as const,
                },
              },
            ];
            mockFeeCalculatorService.computeFee.mockResolvedValue(feeResult);

            const result = await handler.handle(request);

            expect(mockFeeCalculatorService.computeFee).toHaveBeenCalledWith({
              scope,
              transaction: expect.objectContaining({
                txID: expect.any(String),
                // eslint-disable-next-line @typescript-eslint/naming-convention
                raw_data: expect.any(Object),
                // eslint-disable-next-line @typescript-eslint/naming-convention
                raw_data_hex: expect.any(String),
                visible: false,
              }),
              availableEnergy: BigNumber('100000'),
              availableBandwidth: BigNumber('5000'),
              feeLimit: undefined,
            });
            expect(result).toStrictEqual(feeResult);
          },
        );
      });

      it('computes fee for native TRX transfer', async () => {
        await withClientRequestHandler(
          async ({
            handler,
            mockAccountsService,
            mockAssetsService,
            mockFeeCalculatorService,
            mockTronWeb,
          }) => {
            const scope = Network.Mainnet;
            const request = buildRequest(ClientRequestMethod.ComputeFee, {
              accountId: TEST_ACCOUNT_ID,
              transaction: TEST_TRANSACTION_BASE64,
              scope,
              options: {
                visible: true,
                type: 'TransferContract',
              },
            });

            mockAccountsService.findByIdOrThrow.mockResolvedValue(MOCK_ACCOUNT);

            mockTronWeb.utils.deserializeTx.deserializeTransaction.mockReturnValue(
              {
                contract: [
                  {
                    type: 'TransferContract',
                    parameter: {
                      value: {
                        // eslint-disable-next-line @typescript-eslint/naming-convention
                        owner_address:
                          '41045d01eb63374da930ee0da30d58516ac14ce04c79',
                        // eslint-disable-next-line @typescript-eslint/naming-convention
                        to_address: '419946f55aa08cfe8363959ce9930ebd567e2c14f',
                        amount: 1000000,
                      },
                    },
                  },
                ],
              },
            );

            mockAssetsService.getAssetsByAccountId.mockResolvedValue([
              { rawAmount: '1000' },
              { rawAmount: '0' },
            ]);

            const feeResult = [
              {
                type: FeeType.Base,
                asset: {
                  unit: Networks[scope].bandwidth.symbol,
                  type: Networks[scope].bandwidth.id,
                  amount: '268',
                  fungible: true as const,
                },
              },
            ];
            mockFeeCalculatorService.computeFee.mockResolvedValue(feeResult);

            const result = await handler.handle(request);

            expect(result).toStrictEqual(feeResult);
            expect(mockFeeCalculatorService.computeFee).toHaveBeenCalledWith({
              scope,
              transaction: expect.objectContaining({
                txID: expect.any(String),
                // eslint-disable-next-line @typescript-eslint/naming-convention
                raw_data: expect.any(Object),
                // eslint-disable-next-line @typescript-eslint/naming-convention
                raw_data_hex: expect.any(String),
              }),
              availableEnergy: BigNumber('0'),
              availableBandwidth: BigNumber('1000'),
              feeLimit: undefined,
            });
          },
        );
      });

      it('handles account with no available resources', async () => {
        await withClientRequestHandler(
          async ({
            handler,
            mockAccountsService,
            mockAssetsService,
            mockFeeCalculatorService,
            mockTronWeb,
          }) => {
            const scope = Network.Nile;
            const request = buildRequest(ClientRequestMethod.ComputeFee, {
              accountId: TEST_ACCOUNT_ID,
              transaction: TEST_TRANSACTION_BASE64,
              scope,
              options: {
                visible: false,
                type: 'TriggerSmartContract',
              },
            });

            mockAccountsService.findByIdOrThrow.mockResolvedValue(MOCK_ACCOUNT);

            mockTronWeb.utils.deserializeTx.deserializeTransaction.mockReturnValue(
              {},
            );

            mockAssetsService.getAssetsByAccountId.mockResolvedValue([
              undefined,
              undefined,
            ]);

            const feeResult = [
              {
                type: FeeType.Base,
                asset: {
                  unit: Networks[scope].nativeToken.symbol,
                  type: Networks[scope].nativeToken.id,
                  amount: '13.5',
                  fungible: true as const,
                },
              },
            ];
            mockFeeCalculatorService.computeFee.mockResolvedValue(feeResult);

            const result = await handler.handle(request);

            expect(result).toStrictEqual(feeResult);
            expect(mockFeeCalculatorService.computeFee).toHaveBeenCalledWith({
              scope,
              transaction: expect.any(Object),
              availableEnergy: BigNumber('0'),
              availableBandwidth: BigNumber('0'),
            });
          },
        );
      });
    });

    describe('when called with invalid parameters', () => {
      it('throws InvalidParamsError for missing accountId', async () => {
        await withClientRequestHandler(async ({ handler }) => {
          const request = buildRequest(ClientRequestMethod.ComputeFee, {
            transaction: TEST_TRANSACTION_BASE64,
            scope: Network.Shasta,
            options: {
              visible: false,
              type: 'TransferContract',
            },
          });

          await expect(handler.handle(request)).rejects.toThrow(
            'Invalid method parameter(s)',
          );
        });
      });

      it('throws InvalidParamsError for invalid transaction format', async () => {
        await withClientRequestHandler(async ({ handler }) => {
          const request = buildRequest(ClientRequestMethod.ComputeFee, {
            accountId: TEST_ACCOUNT_ID,
            transaction: 'not-valid-base64!!!',
            scope: Network.Shasta,
            options: {
              visible: false,
              type: 'TransferContract',
            },
          });

          await expect(handler.handle(request)).rejects.toThrow(
            'Invalid method parameter(s)',
          );
        });
      });

      it('throws error when account not found', async () => {
        await withClientRequestHandler(
          async ({ handler, mockAccountsService }) => {
            const request = buildRequest(ClientRequestMethod.ComputeFee, {
              accountId: TEST_ACCOUNT_ID,
              transaction: TEST_TRANSACTION_BASE64,
              scope: Network.Shasta,
              options: {
                visible: false,
                type: 'TransferContract',
              },
            });

            mockAccountsService.findByIdOrThrow.mockRejectedValue(
              new Error('Account not found'),
            );

            await expect(handler.handle(request)).rejects.toThrow(
              'Account not found',
            );
          },
        );
      });
    });
  });

  describe('signRewardsMessage', () => {
    describe('when called with valid parameters', () => {
      it('signs a rewards message and returns the signature', async () => {
        await withClientRequestHandler(
          async ({
            handler,
            mockAccountsService,
            mockTronWeb,
            mockTronWebFactory,
          }) => {
            const mockTimestamp = 1736660000;
            const message = utf8ToBase64(
              `rewards,${TEST_ADDRESS},${mockTimestamp}`,
            );
            const mockSignature = '0x1234567890abcdef';

            const request = buildRequest(
              ClientRequestMethod.SignRewardsMessage,
              { accountId: TEST_ACCOUNT_ID, message },
            );

            mockAccountsService.findById.mockResolvedValue(MOCK_ACCOUNT);

            mockAccountsService.deriveTronKeypair.mockResolvedValue({
              privateKeyHex: TEST_PRIVATE_KEY,
            });

            mockTronWeb.trx.signMessageV2.mockReturnValue(mockSignature);

            const result = await handler.handle(request);

            expect(mockAccountsService.findById).toHaveBeenCalledWith(
              TEST_ACCOUNT_ID,
            );
            expect(mockAccountsService.deriveTronKeypair).toHaveBeenCalledWith({
              entropySource: 'test-entropy',
              derivationPath: "m/44'/195'/0'/0/0",
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
          },
        );
      });
    });

    describe('when called with invalid parameters', () => {
      it('throws error when message does not start with "rewards,"', async () => {
        await withClientRequestHandler(async ({ handler }) => {
          const request = buildRequest(ClientRequestMethod.SignRewardsMessage, {
            accountId: TEST_ACCOUNT_ID,
            message: utf8ToBase64('invalid-message'),
          });

          await expect(handler.handle(request)).rejects.toThrow(
            'Invalid method parameter(s)',
          );
        });
      });

      it('throws error when account is not found', async () => {
        await withClientRequestHandler(
          async ({ handler, mockAccountsService }) => {
            const request = buildRequest(
              ClientRequestMethod.SignRewardsMessage,
              {
                accountId: TEST_ACCOUNT_ID,
                message: utf8ToBase64(`rewards,${TEST_ADDRESS},1736660000`),
              },
            );

            mockAccountsService.findById.mockResolvedValue(null);

            await expect(handler.handle(request)).rejects.toThrow(
              'Account not found',
            );
          },
        );
      });

      it('throws error when address in message does not match signing account', async () => {
        await withClientRequestHandler(async ({ handler }) => {
          const request = buildRequest(ClientRequestMethod.SignRewardsMessage, {
            accountId: TEST_ACCOUNT_ID,
            message: utf8ToBase64('rewards,invalid-address,1736660000'),
          });

          await expect(handler.handle(request)).rejects.toThrow(
            'Invalid method parameter(s)',
          );
        });
      });

      it('throws error when message has invalid format', async () => {
        await withClientRequestHandler(async ({ handler }) => {
          const request = buildRequest(ClientRequestMethod.SignRewardsMessage, {
            accountId: TEST_ACCOUNT_ID,
            message: utf8ToBase64('rewards,invalid'),
          });

          await expect(handler.handle(request)).rejects.toThrow(
            'Invalid method parameter(s)',
          );
        });
      });

      it('throws error when timestamp is invalid', async () => {
        await withClientRequestHandler(async ({ handler }) => {
          const request = buildRequest(ClientRequestMethod.SignRewardsMessage, {
            accountId: TEST_ACCOUNT_ID,
            message: utf8ToBase64(`rewards,${TEST_ADDRESS},invalid-timestamp`),
          });

          await expect(handler.handle(request)).rejects.toThrow(
            'Invalid method parameter(s)',
          );
        });
      });
    });
  });

  describe('computeStakeFee', () => {
    it('computes fee breakdown for TRX staking on mainnet', async () => {
      await withClientRequestHandler(
        async ({
          handler,
          mockAccountsService,
          mockAssetsService,
          mockFeeCalculatorService,
          mockTronWeb,
          mockTronWebFactory,
        }) => {
          const request = buildRequest(ClientRequestMethod.ComputeStakeFee, {
            fromAccountId: TEST_ACCOUNT_ID,
            value: '10',
            options: { purpose: 'ENERGY' },
          });

          const scope = Network.Mainnet;

          mockAccountsService.findByIdOrThrow.mockResolvedValue(MOCK_ACCOUNT);

          const builtTransaction = {
            txID: 'stake-tx-id',
            // eslint-disable-next-line @typescript-eslint/naming-convention
            raw_data: { contract: [] },
            // eslint-disable-next-line @typescript-eslint/naming-convention
            raw_data_hex: 'stake-hex',
          };

          mockTronWeb.transactionBuilder.freezeBalanceV2.mockResolvedValue(
            builtTransaction,
          );

          const nativeAssetId = Networks[scope].nativeToken.id;

          mockAssetsService.getAssetByAccountId.mockResolvedValue({
            uiAmount: '100',
          });
          mockAssetsService.getAssetsByAccountId.mockResolvedValue([
            { rawAmount: '5000' },
            { rawAmount: '100000' },
          ]);

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
          mockFeeCalculatorService.computeFee.mockResolvedValue(feeResult);

          const result = await handler.handle(request);

          expect(mockTronWebFactory.createClient).toHaveBeenCalledWith(scope);
          expect(
            mockTronWeb.transactionBuilder.freezeBalanceV2,
          ).toHaveBeenCalledWith(Number(trxToSun(10)), 'ENERGY', TEST_ADDRESS);
          expect(mockAssetsService.getAssetByAccountId).toHaveBeenCalledWith(
            TEST_ACCOUNT_ID,
            nativeAssetId,
          );
          expect(mockFeeCalculatorService.computeFee).toHaveBeenCalledWith({
            scope,
            transaction: builtTransaction,
            availableEnergy: BigNumber('100000'),
            availableBandwidth: BigNumber('5000'),
          });
          expect(result).toStrictEqual(feeResult);
        },
      );
    });

    it('returns insufficient balance error when staking more than balance', async () => {
      await withClientRequestHandler(
        async ({
          handler,
          mockAccountsService,
          mockAssetsService,
          mockFeeCalculatorService,
        }) => {
          const request = buildRequest(ClientRequestMethod.ComputeStakeFee, {
            fromAccountId: TEST_ACCOUNT_ID,
            value: '10',
            options: { purpose: 'BANDWIDTH' },
          });

          mockAccountsService.findByIdOrThrow.mockResolvedValue(MOCK_ACCOUNT);

          mockAssetsService.getAssetByAccountId.mockResolvedValue({
            uiAmount: '5',
          });

          const result = await handler.handle(request);

          expect(result).toStrictEqual({
            valid: false,
            errors: [SendErrorCodes.InsufficientBalance],
          });
          expect(mockFeeCalculatorService.computeFee).not.toHaveBeenCalled();
        },
      );
    });
  });

  describe('confirmSend', () => {
    const scope = Network.Mainnet;

    const mockNativeAsset = {
      assetType: Networks[scope].nativeToken.id,
      symbol: 'TRX',
      decimals: 6,
      uiAmount: '100',
      rawAmount: '100000000',
    };

    it.each([
      {
        errorCode: 'InsufficientBalance' as SendValidationErrorCode,
        expectedCode: SendErrorCodes.InsufficientBalance,
      },
      {
        errorCode: 'InsufficientBalanceToCoverFee' as SendValidationErrorCode,
        expectedCode: SendErrorCodes.InsufficientBalanceToCoverFee,
      },
    ])(
      'returns $errorCode when validateSend fails',
      async ({ errorCode, expectedCode }) => {
        await withClientRequestHandler(
          async ({
            handler,
            mockAccountsService,
            mockAssetsService,
            mockSendService,
            mockConfirmationHandler,
          }) => {
            const request = buildRequest(ClientRequestMethod.ConfirmSend, {
              fromAccountId: TEST_ACCOUNT_ID,
              toAddress: TEST_TO_ADDRESS,
              amount: '10',
              assetId: Networks[scope].nativeToken.id,
            });

            mockAccountsService.findById.mockResolvedValue(MOCK_SEND_ACCOUNT);

            mockAssetsService.getAssetByAccountId.mockResolvedValue(
              mockNativeAsset,
            );

            mockSendService.validateSend.mockResolvedValue({
              valid: false,
              errorCode,
            });

            const result = await handler.handle(request);

            expect(result).toStrictEqual({
              valid: false,
              errors: [{ code: expectedCode }],
            });
            expect(mockSendService.buildTransaction).not.toHaveBeenCalled();
            expect(
              mockConfirmationHandler.confirmTransactionRequest,
            ).not.toHaveBeenCalled();
          },
        );
      },
    );

    it('proceeds to confirmation when validateSend returns valid', async () => {
      await withClientRequestHandler(
        async ({
          handler,
          mockAccountsService,
          mockAssetsService,
          mockSendService,
          mockFeeCalculatorService,
          mockConfirmationHandler,
        }) => {
          const request = buildRequest(ClientRequestMethod.ConfirmSend, {
            fromAccountId: TEST_ACCOUNT_ID,
            toAddress: TEST_TO_ADDRESS,
            amount: '10',
            assetId: Networks[scope].nativeToken.id,
          });

          mockAccountsService.findById.mockResolvedValue(MOCK_SEND_ACCOUNT);

          mockAssetsService.getAssetByAccountId.mockResolvedValue(
            mockNativeAsset,
          );

          mockSendService.validateSend.mockResolvedValue({ valid: true });

          mockAssetsService.getAssetsByAccountId.mockResolvedValue([
            { rawAmount: '1000' },
            { rawAmount: '50000' },
          ]);

          const mockTransaction = {
            txID: 'test-tx-id',
            // eslint-disable-next-line @typescript-eslint/naming-convention
            raw_data: {},
            // eslint-disable-next-line @typescript-eslint/naming-convention
            raw_data_hex: 'test-hex',
          };
          mockSendService.buildTransaction.mockResolvedValue(mockTransaction);

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
          mockFeeCalculatorService.computeFee.mockResolvedValue(mockFees);

          mockConfirmationHandler.confirmTransactionRequest.mockResolvedValue(
            true,
          );

          mockSendService.signAndSendTransaction.mockResolvedValue({
            result: true,
            txid: 'broadcast-tx-id',
          });

          const result = await handler.handle(request);

          expect(mockSendService.validateSend).toHaveBeenCalled();
          expect(mockSendService.buildTransaction).toHaveBeenCalled();
          expect(mockFeeCalculatorService.computeFee).toHaveBeenCalled();
          expect(
            mockConfirmationHandler.confirmTransactionRequest,
          ).toHaveBeenCalled();
          expect(mockSendService.signAndSendTransaction).toHaveBeenCalled();

          expect(result).toMatchObject({
            transactionId: 'broadcast-tx-id',
            status: 'submitted',
          });
        },
      );
    });

    it('returns Invalid error when account is not found', async () => {
      await withClientRequestHandler(
        async ({ handler, mockAccountsService, mockSendService }) => {
          const request = buildRequest(ClientRequestMethod.ConfirmSend, {
            fromAccountId: TEST_ACCOUNT_ID,
            toAddress: TEST_TO_ADDRESS,
            amount: '10',
            assetId: Networks[scope].nativeToken.id,
          });

          mockAccountsService.findById.mockResolvedValue(null);

          const result = await handler.handle(request);

          expect(result).toStrictEqual({
            valid: false,
            errors: [{ code: SendErrorCodes.Invalid }],
          });
          expect(mockSendService.validateSend).not.toHaveBeenCalled();
        },
      );
    });

    it('returns InsufficientBalance when asset is not found', async () => {
      await withClientRequestHandler(
        async ({
          handler,
          mockAccountsService,
          mockAssetsService,
          mockSendService,
        }) => {
          const request = buildRequest(ClientRequestMethod.ConfirmSend, {
            fromAccountId: TEST_ACCOUNT_ID,
            toAddress: TEST_TO_ADDRESS,
            amount: '10',
            assetId: Networks[scope].nativeToken.id,
          });

          mockAccountsService.findById.mockResolvedValue(MOCK_SEND_ACCOUNT);

          mockAssetsService.getAssetByAccountId.mockResolvedValue(null);

          const result = await handler.handle(request);

          expect(result).toStrictEqual({
            valid: false,
            errors: [{ code: SendErrorCodes.InsufficientBalance }],
          });
          expect(mockSendService.validateSend).not.toHaveBeenCalled();
        },
      );
    });
  });

  describe('claimUnstakedTrx', () => {
    it('claims unstaked TRX successfully', async () => {
      await withClientRequestHandler(
        async ({ handler, mockAccountsService, mockStakingService }) => {
          mockAccountsService.findByIdOrThrow.mockResolvedValue(MOCK_ACCOUNT);

          const request = buildRequest(ClientRequestMethod.ClaimUnstakedTrx, {
            fromAccountId: TEST_ACCOUNT_ID,
            assetId: Networks[Network.Mainnet].nativeToken.id,
          });

          const result = await handler.handle(request);

          expect(mockAccountsService.findByIdOrThrow).toHaveBeenCalledWith(
            TEST_ACCOUNT_ID,
          );
          expect(mockStakingService.claimUnstakedTrx).toHaveBeenCalledWith({
            account: MOCK_ACCOUNT,
            scope: Network.Mainnet,
          });
          expect(result).toStrictEqual({ valid: true, errors: [] });
        },
      );
    });

    it('throws InvalidParamsError for invalid params', async () => {
      await withClientRequestHandler(async ({ handler }) => {
        const request = buildRequest(ClientRequestMethod.ClaimUnstakedTrx, {
          fromAccountId: 'not-a-uuid',
          assetId: 'invalid-asset',
        });

        await expect(handler.handle(request)).rejects.toThrow(
          'Invalid method parameter(s)',
        );
      });
    });
  });

  describe('claimTrxStakingRewards', () => {
    it('claims staking rewards successfully', async () => {
      await withClientRequestHandler(
        async ({ handler, mockAccountsService, mockStakingService }) => {
          mockAccountsService.findByIdOrThrow.mockResolvedValue(MOCK_ACCOUNT);

          const request = buildRequest(
            ClientRequestMethod.ClaimTrxStakingRewards,
            {
              fromAccountId: TEST_ACCOUNT_ID,
              assetId: Networks[Network.Mainnet].nativeToken.id,
            },
          );

          const result = await handler.handle(request);

          expect(mockAccountsService.findByIdOrThrow).toHaveBeenCalledWith(
            TEST_ACCOUNT_ID,
          );
          expect(
            mockStakingService.claimTrxStakingRewards,
          ).toHaveBeenCalledWith({
            account: MOCK_ACCOUNT,
            scope: Network.Mainnet,
          });
          expect(result).toStrictEqual({ valid: true, errors: [] });
        },
      );
    });

    it('throws InvalidParamsError for invalid params', async () => {
      await withClientRequestHandler(async ({ handler }) => {
        const request = buildRequest(
          ClientRequestMethod.ClaimTrxStakingRewards,
          {
            fromAccountId: 'not-a-uuid',
            assetId: 'invalid-asset',
          },
        );

        await expect(handler.handle(request)).rejects.toThrow(
          'Invalid method parameter(s)',
        );
      });
    });
  });
});
