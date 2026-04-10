import { UserRejectedRequestError } from '@metamask/snaps-sdk';
import type { JsonRpcRequest } from '@metamask/snaps-sdk';

import { RpcHandler } from './rpc';
import { Network } from '../../constants';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import type { AccountsService } from '../../services/accounts/AccountsService';
import type { ConfirmationHandler } from '../../services/confirmation/ConfirmationHandler';
import type { WalletService } from '../../services/wallet/WalletService';
import { mockLogger } from '../../utils/mockLogger';
import { TronMultichainMethod } from '../keyring-types';

const TEST_ADDRESS = 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx';
const TEST_ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';
const METAMASK_ORIGIN = 'metamask';

const mockAccount: TronKeyringAccount = {
  id: TEST_ACCOUNT_ID,
  address: TEST_ADDRESS,
  type: 'tron:eoa',
  options: {},
  methods: [],
  scopes: [Network.Mainnet],
  entropySource: 'test-entropy',
  derivationPath: "m/44'/195'/0'/0/0",
  index: 0,
};

describe('RpcHandler', () => {
  let rpcHandler: RpcHandler;
  let mockWalletService: jest.Mocked<WalletService>;
  let mockAccountsService: jest.Mocked<AccountsService>;
  let mockConfirmationHandler: jest.Mocked<ConfirmationHandler>;

  beforeEach(() => {
    mockWalletService = {
      signMessage: jest.fn(),
      signTransaction: jest.fn(),
    } as unknown as jest.Mocked<WalletService>;

    mockAccountsService = {
      findByAddress: jest.fn(),
    } as unknown as jest.Mocked<AccountsService>;

    mockConfirmationHandler = {
      handleKeyringRequest: jest.fn(),
    } as unknown as jest.Mocked<ConfirmationHandler>;

    rpcHandler = new RpcHandler({
      logger: mockLogger,
      walletService: mockWalletService,
      accountsService: mockAccountsService,
      confirmationHandler: mockConfirmationHandler,
    });
  });

  describe('signMessage', () => {
    const buildRequest = (params: Record<string, unknown>): JsonRpcRequest =>
      ({
        jsonrpc: '2.0',
        id: '1',
        method: TronMultichainMethod.SignMessage,
        params,
      }) as JsonRpcRequest;

    it('allows metamask origin and signs message', async () => {
      const signature = { signature: '0xsig' };
      mockAccountsService.findByAddress.mockResolvedValue(mockAccount);
      mockConfirmationHandler.handleKeyringRequest.mockResolvedValue(true);
      mockWalletService.signMessage.mockResolvedValue(signature);

      const request = buildRequest({
        address: TEST_ADDRESS,
        message: 'aGVsbG8=', // base64('hello')
      });

      const result = await rpcHandler.handle(METAMASK_ORIGIN, request);
      expect(result).toStrictEqual(signature);
    });

    it('throws when account is not found', async () => {
      mockAccountsService.findByAddress.mockResolvedValue(null);
      const request = buildRequest({
        address: TEST_ADDRESS,
        message: 'aGVsbG8=',
      });

      await expect(rpcHandler.handle(METAMASK_ORIGIN, request)).rejects.toThrow(
        `No account found for address: ${TEST_ADDRESS}`,
      );
    });

    it('throws UserRejectedRequestError when user rejects', async () => {
      mockAccountsService.findByAddress.mockResolvedValue(mockAccount);
      mockConfirmationHandler.handleKeyringRequest.mockResolvedValue(false);

      const request = buildRequest({
        address: TEST_ADDRESS,
        message: 'aGVsbG8=',
      });

      await expect(rpcHandler.handle(METAMASK_ORIGIN, request)).rejects.toThrow(
        UserRejectedRequestError,
      );
    });
  });

  describe('signTransaction', () => {
    const buildRequest = (params: Record<string, unknown>): JsonRpcRequest =>
      ({
        jsonrpc: '2.0',
        id: '1',
        method: TronMultichainMethod.SignTransaction,
        params,
      }) as JsonRpcRequest;

    it('allows metamask origin and signs transaction', async () => {
      const signature = { signature: '0xabc123' };
      mockAccountsService.findByAddress.mockResolvedValue(mockAccount);
      mockConfirmationHandler.handleKeyringRequest.mockResolvedValue(true);
      mockWalletService.signTransaction.mockResolvedValue(signature);

      const request = buildRequest({
        address: TEST_ADDRESS,
        transaction: {
          rawDataHex: '0a0b0c',
          type: 'TriggerSmartContract',
        },
      });

      const result = await rpcHandler.handle(METAMASK_ORIGIN, request);
      expect(result).toStrictEqual(signature);
    });

    it('throws UserRejectedRequestError when user rejects transaction', async () => {
      mockAccountsService.findByAddress.mockResolvedValue(mockAccount);
      mockConfirmationHandler.handleKeyringRequest.mockResolvedValue(false);

      const request = buildRequest({
        address: TEST_ADDRESS,
        transaction: {
          rawDataHex: '0a0b0c',
          type: 'TriggerSmartContract',
        },
      });

      await expect(rpcHandler.handle(METAMASK_ORIGIN, request)).rejects.toThrow(
        UserRejectedRequestError,
      );
    });
  });

  it('rejects unknown origin with Permission denied', async () => {
    const request = {
      jsonrpc: '2.0',
      id: '1',
      method: TronMultichainMethod.SignTransaction,
      params: {
        address: TEST_ADDRESS,
        transaction: {
          rawDataHex: '0a0b0c',
          type: 'TriggerSmartContract',
        },
      },
    } as JsonRpcRequest;

    await expect(rpcHandler.handle('https://sun.io', request)).rejects.toThrow(
      'Permission denied',
    );
  });

  it('rejects unsupported methods at origin guard', async () => {
    const request = {
      jsonrpc: '2.0',
      id: '1',
      method: 'unknownMethod',
      params: {},
    } as JsonRpcRequest;

    await expect(rpcHandler.handle(METAMASK_ORIGIN, request)).rejects.toThrow(
      'Permission denied',
    );
  });
});
