import type { JsonRpcRequest } from '@metamask/snaps-sdk';

import { RpcHandler } from './rpc';
import { WalletConnectRpcMethod } from './types';
import { Network } from '../../constants';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import type { AccountsService } from '../../services/accounts/AccountsService';
import type { ConfirmationHandler } from '../../services/confirmation/ConfirmationHandler';
import type { WalletService } from '../../services/wallet/WalletService';
import { mockLogger } from '../../utils/mockLogger';

const TEST_ADDRESS = 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx';
const TEST_ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';
const TEST_ORIGIN = 'https://example-dapp.io';

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

const mockTransaction = {
  txID: 'abc123txid',
  // eslint-disable-next-line @typescript-eslint/naming-convention
  raw_data: {
    contract: [{ type: 'TransferContract' }],
  },
  // eslint-disable-next-line @typescript-eslint/naming-convention
  raw_data_hex: 'deadbeef01020304',
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

  describe('handle', () => {
    it('throws UnauthorizedError for non-WalletConnect methods from unknown origin', async () => {
      const request = {
        jsonrpc: '2.0',
        id: '1',
        method: 'tron_unknownMethod',
        params: {},
      } as JsonRpcRequest;

      // Non-WC methods go through origin validation, which rejects unknown origins
      await expect(rpcHandler.handle(TEST_ORIGIN, request)).rejects.toThrow(
        'Permission denied',
      );
    });

    it('skips origin validation for WalletConnect methods', async () => {
      // tron_signMessage is a WalletConnect method — any origin is allowed
      mockAccountsService.findByAddress.mockResolvedValue(mockAccount);
      mockConfirmationHandler.handleKeyringRequest.mockResolvedValue(true);
      mockWalletService.signMessage.mockResolvedValue({ signature: '0xsig' });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: '1',
        method: WalletConnectRpcMethod.SignMessage,
        params: { address: TEST_ADDRESS, message: 'hello' },
      };

      // Should not throw even with an unknown/arbitrary origin
      const result = await rpcHandler.handle(
        'https://random-dapp.xyz',
        request,
      );
      expect(result).toBeDefined();
    });
  });

  describe('tron_signMessage', () => {
    const buildRequest = (params: Record<string, unknown>): JsonRpcRequest =>
      ({
        jsonrpc: '2.0',
        id: '1',
        method: WalletConnectRpcMethod.SignMessage,
        params,
      }) as JsonRpcRequest;

    it('signs a message and returns the signature', async () => {
      const plainMessage = 'Hello Tron!';
      // eslint-disable-next-line no-restricted-globals
      const base64Message = Buffer.from(plainMessage, 'utf8').toString(
        'base64',
      );

      mockAccountsService.findByAddress.mockResolvedValue(mockAccount);
      mockConfirmationHandler.handleKeyringRequest.mockResolvedValue(true);
      mockWalletService.signMessage.mockResolvedValue({
        signature: '0xdeadbeef',
      });

      const result = await rpcHandler.handle(
        TEST_ORIGIN,
        buildRequest({ address: TEST_ADDRESS, message: plainMessage }),
      );

      expect(mockAccountsService.findByAddress).toHaveBeenCalledWith(
        TEST_ADDRESS,
      );
      expect(mockConfirmationHandler.handleKeyringRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          account: mockAccount,
          request: expect.objectContaining({
            scope: Network.Mainnet,
            account: TEST_ACCOUNT_ID,
            origin: TEST_ORIGIN,
            request: expect.objectContaining({
              params: { address: TEST_ADDRESS, message: base64Message },
            }),
          }),
        }),
      );
      expect(mockWalletService.signMessage).toHaveBeenCalledWith({
        account: mockAccount,
        scope: Network.Mainnet,
        params: { address: TEST_ADDRESS, message: base64Message },
      });
      expect(result).toStrictEqual({ signature: '0xdeadbeef' });
    });

    it('base64-encodes the plain-text message before passing to WalletService', async () => {
      const plainMessage = 'Sign this message';
      // eslint-disable-next-line no-restricted-globals
      const expectedBase64 = Buffer.from(plainMessage, 'utf8').toString(
        'base64',
      );

      mockAccountsService.findByAddress.mockResolvedValue(mockAccount);
      mockConfirmationHandler.handleKeyringRequest.mockResolvedValue(true);
      mockWalletService.signMessage.mockResolvedValue({ signature: '0xsig' });

      await rpcHandler.handle(
        TEST_ORIGIN,
        buildRequest({ address: TEST_ADDRESS, message: plainMessage }),
      );

      expect(mockWalletService.signMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ message: expectedBase64 }),
        }),
      );
    });

    it('throws UserRejectedRequestError when user rejects confirmation', async () => {
      mockAccountsService.findByAddress.mockResolvedValue(mockAccount);
      mockConfirmationHandler.handleKeyringRequest.mockResolvedValue(false);

      await expect(
        rpcHandler.handle(
          TEST_ORIGIN,
          buildRequest({ address: TEST_ADDRESS, message: 'hello' }),
        ),
      ).rejects.toThrow('User rejected the request.');

      expect(mockWalletService.signMessage).not.toHaveBeenCalled();
    });

    it('throws when no account found for address', async () => {
      mockAccountsService.findByAddress.mockResolvedValue(null);

      await expect(
        rpcHandler.handle(
          TEST_ORIGIN,
          buildRequest({ address: TEST_ADDRESS, message: 'hello' }),
        ),
      ).rejects.toThrow(`No account found for address: ${TEST_ADDRESS}`);
    });

    it('throws for missing address', async () => {
      await expect(
        rpcHandler.handle(TEST_ORIGIN, buildRequest({ message: 'hello' })),
      ).rejects.toThrow('At path: address');
    });

    it('throws for missing message', async () => {
      await expect(
        rpcHandler.handle(TEST_ORIGIN, buildRequest({ address: TEST_ADDRESS })),
      ).rejects.toThrow('At path: message');
    });
  });

  describe('tron_signTransaction', () => {
    const buildRequest = (params: Record<string, unknown>): JsonRpcRequest =>
      ({
        jsonrpc: '2.0',
        id: '1',
        method: WalletConnectRpcMethod.SignTransaction,
        params,
      }) as JsonRpcRequest;

    it('signs a transaction and returns the WalletConnect formatted result', async () => {
      const rawSignature = '0xabcdef1234567890';

      mockAccountsService.findByAddress.mockResolvedValue(mockAccount);
      mockConfirmationHandler.handleKeyringRequest.mockResolvedValue(true);
      mockWalletService.signTransaction.mockResolvedValue({
        signature: rawSignature,
      });

      const result = await rpcHandler.handle(
        TEST_ORIGIN,
        buildRequest({ address: TEST_ADDRESS, transaction: mockTransaction }),
      );

      expect(mockAccountsService.findByAddress).toHaveBeenCalledWith(
        TEST_ADDRESS,
      );
      expect(mockConfirmationHandler.handleKeyringRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          account: mockAccount,
          request: expect.objectContaining({
            scope: Network.Mainnet,
            account: TEST_ACCOUNT_ID,
            origin: TEST_ORIGIN,
            request: expect.objectContaining({
              params: {
                address: TEST_ADDRESS,
                transaction: {
                  rawDataHex: mockTransaction.raw_data_hex,
                  type: 'TransferContract',
                },
              },
            }),
          }),
        }),
      );
      expect(mockWalletService.signTransaction).toHaveBeenCalledWith({
        account: mockAccount,
        scope: Network.Mainnet,
        params: {
          address: TEST_ADDRESS,
          transaction: {
            rawDataHex: mockTransaction.raw_data_hex,
            type: 'TransferContract',
          },
        },
      });

      // Signature should be stripped of 0x prefix and wrapped in an array
      expect(result).toStrictEqual({
        txID: mockTransaction.txID,
        signature: ['abcdef1234567890'],
        // eslint-disable-next-line @typescript-eslint/naming-convention
        raw_data: mockTransaction.raw_data,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        raw_data_hex: mockTransaction.raw_data_hex,
        visible: false,
      });
    });

    it('strips 0x prefix from signature', async () => {
      mockAccountsService.findByAddress.mockResolvedValue(mockAccount);
      mockConfirmationHandler.handleKeyringRequest.mockResolvedValue(true);
      mockWalletService.signTransaction.mockResolvedValue({
        signature: '0xdeadbeef',
      });

      const result = (await rpcHandler.handle(
        TEST_ORIGIN,
        buildRequest({ address: TEST_ADDRESS, transaction: mockTransaction }),
      )) as { signature: string[] };

      expect(result.signature).toStrictEqual(['deadbeef']);
    });

    it('handles signature without 0x prefix', async () => {
      mockAccountsService.findByAddress.mockResolvedValue(mockAccount);
      mockConfirmationHandler.handleKeyringRequest.mockResolvedValue(true);
      mockWalletService.signTransaction.mockResolvedValue({
        signature: 'cafebabe',
      });

      const result = (await rpcHandler.handle(
        TEST_ORIGIN,
        buildRequest({ address: TEST_ADDRESS, transaction: mockTransaction }),
      )) as { signature: string[] };

      expect(result.signature).toStrictEqual(['cafebabe']);
    });

    it('extracts contract type from raw_data.contract[0].type', async () => {
      const transactionWithType = {
        ...mockTransaction,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        raw_data: {
          contract: [{ type: 'TriggerSmartContract' }],
        },
      };

      mockAccountsService.findByAddress.mockResolvedValue(mockAccount);
      mockConfirmationHandler.handleKeyringRequest.mockResolvedValue(true);
      mockWalletService.signTransaction.mockResolvedValue({
        signature: '0xsig',
      });

      await rpcHandler.handle(
        TEST_ORIGIN,
        buildRequest({
          address: TEST_ADDRESS,
          transaction: transactionWithType,
        }),
      );

      expect(mockWalletService.signTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            transaction: expect.objectContaining({
              type: 'TriggerSmartContract',
            }),
          }),
        }),
      );
    });

    it('uses empty string for contract type when contract array is empty', async () => {
      const transactionNoContract = {
        ...mockTransaction,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        raw_data: { contract: [] },
      };

      mockAccountsService.findByAddress.mockResolvedValue(mockAccount);
      mockConfirmationHandler.handleKeyringRequest.mockResolvedValue(true);
      mockWalletService.signTransaction.mockResolvedValue({
        signature: '0xsig',
      });

      await rpcHandler.handle(
        TEST_ORIGIN,
        buildRequest({
          address: TEST_ADDRESS,
          transaction: transactionNoContract,
        }),
      );

      expect(mockWalletService.signTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            transaction: expect.objectContaining({ type: '' }),
          }),
        }),
      );
    });

    it('throws UserRejectedRequestError when user rejects confirmation', async () => {
      mockAccountsService.findByAddress.mockResolvedValue(mockAccount);
      mockConfirmationHandler.handleKeyringRequest.mockResolvedValue(false);

      await expect(
        rpcHandler.handle(
          TEST_ORIGIN,
          buildRequest({
            address: TEST_ADDRESS,
            transaction: mockTransaction,
          }),
        ),
      ).rejects.toThrow('User rejected the request.');

      expect(mockWalletService.signTransaction).not.toHaveBeenCalled();
    });

    it('throws when no account found for address', async () => {
      mockAccountsService.findByAddress.mockResolvedValue(null);

      await expect(
        rpcHandler.handle(
          TEST_ORIGIN,
          buildRequest({
            address: TEST_ADDRESS,
            transaction: mockTransaction,
          }),
        ),
      ).rejects.toThrow(`No account found for address: ${TEST_ADDRESS}`);
    });

    it('throws for missing transaction', async () => {
      await expect(
        rpcHandler.handle(TEST_ORIGIN, buildRequest({ address: TEST_ADDRESS })),
      ).rejects.toThrow('At path: transaction');
    });

    it('throws for missing address', async () => {
      await expect(
        rpcHandler.handle(
          TEST_ORIGIN,
          buildRequest({ transaction: mockTransaction }),
        ),
      ).rejects.toThrow('At path: address');
    });
  });
});
