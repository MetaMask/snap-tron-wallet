import { SnapError } from '@metamask/snaps-sdk';
import { bytesToBase64, stringToBytes } from '@metamask/utils';

import { WalletService } from './WalletService';
import type { TronWebFactory } from '../../clients/tronweb/TronWebFactory';
import { Network } from '../../constants';
import type { TronKeyringAccount } from '../../entities';
import {
  TronMultichainErrors,
  TronMultichainMethod,
} from '../../handlers/keyring-types';
import { mockLogger } from '../../utils/mockLogger';
import type { AccountsService } from '../accounts/AccountsService';

/**
 * Helper function to convert string to base64.
 *
 * @param str - The string to convert.
 * @returns Base64 encoded string.
 */
function toBase64(str: string): string {
  return bytesToBase64(stringToBytes(str));
}

describe('WalletService', () => {
  const mockTronKeypair = {
    privateKeyBytes: new Uint8Array(32),
    publicKeyBytes: new Uint8Array(33),
    privateKeyHex: 'abcd1234privatekey',
    address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
  };

  const mockAccount: TronKeyringAccount = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
    options: {},
    methods: ['signMessage', 'signTransaction'],
    type: 'tron:eoa',
    scopes: [Network.Mainnet, Network.Shasta],
    entropySource: 'entropy-source-1' as any,
    derivationPath: "m/44'/195'/0'/0/0",
    index: 0,
  };

  let walletService: WalletService;
  let mockAccountsService: jest.Mocked<AccountsService>;
  let mockTronWebFactory: jest.Mocked<TronWebFactory>;
  let mockTronWeb: any;

  beforeEach(() => {
    mockTronWeb = {
      trx: {
        signMessageV2: jest.fn().mockReturnValue('0xsignature123'),
        sign: jest.fn().mockResolvedValue({
          signature: ['abcd1234signature'],
        }),
      },
      utils: {
        transaction: {
          txPbToTxID: jest.fn().mockReturnValue({ txID: 'tx123' }),
        },
      },
    };

    mockAccountsService = {
      deriveTronKeypair: jest.fn().mockResolvedValue(mockTronKeypair),
    } as any;

    mockTronWebFactory = {
      createClient: jest.fn().mockReturnValue(mockTronWeb),
    } as any;

    walletService = new WalletService({
      logger: mockLogger,
      accountsService: mockAccountsService,
      tronWebFactory: mockTronWebFactory,
    });
  });

  describe('handleKeyringRequest', () => {
    it('routes signMessage requests correctly', async () => {
      const params = {
        address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        message: toBase64('Hello World'),
      };

      const result = await walletService.handleKeyringRequest({
        account: mockAccount,
        scope: Network.Mainnet,
        method: TronMultichainMethod.SignMessage,
        params,
      });

      expect(result).toStrictEqual({ signature: '0xsignature123' });
      expect(mockAccountsService.deriveTronKeypair).toHaveBeenCalledWith({
        entropySource: mockAccount.entropySource,
        derivationPath: mockAccount.derivationPath,
      });
    });

    it('routes signTransaction requests correctly', async () => {
      const params = {
        scope: Network.Mainnet,
        address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        transaction: toBase64('transaction-data'),
      };

      const result = await walletService.handleKeyringRequest({
        account: mockAccount,
        scope: Network.Mainnet,
        method: TronMultichainMethod.SignTransaction,
        params,
      });

      expect(result).toStrictEqual({ signature: '0xabcd1234signature' });
    });

    it('throws SnapError for unsupported methods', async () => {
      await expect(
        walletService.handleKeyringRequest({
          account: mockAccount,
          scope: Network.Mainnet,
          method: 'unsupportedMethod' as any,
          params: {},
        }),
      ).rejects.toThrow(SnapError);
    });

    it('handles user rejection errors', async () => {
      mockTronWeb.trx.signMessageV2.mockImplementation(() => {
        const error: any = new Error('User rejected');
        error.code = 4100;
        throw error;
      });

      await expect(
        walletService.handleKeyringRequest({
          account: mockAccount,
          scope: Network.Mainnet,
          method: TronMultichainMethod.SignMessage,
          params: {
            address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
            message: toBase64('Hello'),
          },
        }),
      ).rejects.toThrow(TronMultichainErrors.UserRejected.message);
    });

    it('handles invalid parameter errors', async () => {
      await expect(
        walletService.handleKeyringRequest({
          account: mockAccount,
          scope: Network.Mainnet,
          method: TronMultichainMethod.SignMessage,
          params: {
            // Missing required fields
          },
        }),
      ).rejects.toThrow('Expected a');
    });
  });

  describe('signMessage', () => {
    it('signs a message successfully', async () => {
      const params = {
        address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        message: toBase64('Hello World'),
      };

      const result = await walletService.signMessage({
        account: mockAccount,
        scope: Network.Mainnet,
        params,
      });

      expect(result).toStrictEqual({ signature: '0xsignature123' });
      expect(mockAccountsService.deriveTronKeypair).toHaveBeenCalledWith({
        entropySource: mockAccount.entropySource,
        derivationPath: mockAccount.derivationPath,
      });
      expect(mockTronWebFactory.createClient).toHaveBeenCalledWith(
        Network.Mainnet,
        mockTronKeypair.privateKeyHex,
      );
      expect(mockTronWeb.trx.signMessageV2).toHaveBeenCalledWith(
        'Hello World',
        mockTronKeypair.privateKeyHex,
      );
    });

    it('decodes base64 message before signing', async () => {
      const originalMessage = 'Test Message 123';
      const params = {
        address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        message: toBase64(originalMessage),
      };

      await walletService.signMessage({
        account: mockAccount,
        scope: Network.Mainnet,
        params,
      });

      expect(mockTronWeb.trx.signMessageV2).toHaveBeenCalledWith(
        originalMessage,
        expect.any(String),
      );
    });

    it('throws error for invalid params', async () => {
      await expect(
        walletService.signMessage({
          account: mockAccount,
          scope: Network.Mainnet,
          params: {
            // Missing required fields
          },
        }),
      ).rejects.toThrow('Expected a');
    });
  });

  describe('signTransaction', () => {
    it('signs a transaction successfully', async () => {
      const transactionData = 'transaction-data-bytes';
      const params = {
        scope: Network.Mainnet,
        address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        transaction: toBase64(transactionData),
      };

      const result = await walletService.signTransaction({
        account: mockAccount,
        scope: Network.Mainnet,
        params,
      });

      expect(result).toStrictEqual({ signature: '0xabcd1234signature' });
      expect(mockTronWebFactory.createClient).toHaveBeenCalledWith(
        Network.Mainnet,
        mockTronKeypair.privateKeyHex,
      );
    });

    it('deserializes transaction from base64', async () => {
      const params = {
        scope: Network.Mainnet,
        address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        transaction: toBase64('tx-data'),
      };

      await walletService.signTransaction({
        account: mockAccount,
        scope: Network.Mainnet,
        params,
      });

      expect(mockTronWeb.utils.transaction.txPbToTxID).toHaveBeenCalled();
      expect(mockTronWeb.trx.sign).toHaveBeenCalled();
    });

    it('handles transaction format errors', async () => {
      mockTronWeb.utils.transaction.txPbToTxID.mockImplementation(() => {
        throw new Error('Failed to deserialize transaction');
      });

      await expect(
        walletService.signTransaction({
          account: mockAccount,
          scope: Network.Mainnet,
          params: {
            scope: Network.Mainnet,
            address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
            transaction: toBase64('valid-but-unparseable-transaction-data'),
          },
        }),
      ).rejects.toThrow('Failed to deserialize transaction');
    });

    it('throws error for invalid params', async () => {
      await expect(
        walletService.signTransaction({
          account: mockAccount,
          scope: Network.Mainnet,
          params: {
            // Missing required fields
          },
        }),
      ).rejects.toThrow('Expected');
    });

    it('prefixes signature with 0x', async () => {
      mockTronWeb.trx.sign.mockResolvedValue({
        signature: ['abcdef123456'],
      });

      const result = await walletService.signTransaction({
        account: mockAccount,
        scope: Network.Mainnet,
        params: {
          scope: Network.Mainnet,
          address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
          transaction: toBase64('transaction-data'),
        },
      });

      expect(result.signature).toMatch(/^0x/u);
      expect(result.signature).toBe('0xabcdef123456');
    });

    it('handles empty signature array', async () => {
      mockTronWeb.trx.sign.mockResolvedValue({
        signature: [],
      });

      const result = await walletService.signTransaction({
        account: mockAccount,
        scope: Network.Mainnet,
        params: {
          scope: Network.Mainnet,
          address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
          transaction: toBase64('transaction-data'),
        },
      });

      expect(result.signature).toBe('0x');
    });
  });
});
