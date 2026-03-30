import {
  MethodNotFoundError,
  UserRejectedRequestError,
} from '@metamask/snaps-sdk';
import type { Json, JsonRpcRequest } from '@metamask/snaps-sdk';
import { bytesToBase64, stringToBytes } from '@metamask/utils';

import { RpcHandler } from './rpc';
import { WalletConnectRpcMethod } from './types';
import { Network } from '../../constants';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import type { AccountsService } from '../../services/accounts/AccountsService';
import type { ConfirmationHandler } from '../../services/confirmation/ConfirmationHandler';
import type { WalletService } from '../../services/wallet/WalletService';
import { mockLogger } from '../../utils/mockLogger';
import * as validators from '../../validation/validators';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TRON_ADDRESS = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';
const ACCOUNT_ID = '123e4567-e89b-42d3-a456-426614174000';
const DAPP_ORIGIN = 'https://sunswap.com';

const mockAccount: TronKeyringAccount = {
  id: ACCOUNT_ID,
  address: TRON_ADDRESS,
  options: {},
  methods: ['signMessage', 'signTransaction'],
  type: 'tron:eoa',
  scopes: [Network.Mainnet],
  entropySource: 'entropy-source-1' as any,
  derivationPath: "m/44'/195'/0'/0/0",
  index: 0,
};

/** Minimal WalletConnect v1 transaction fixture. */
const WC_TRANSACTION = {
  txID: 'abc123txid',
  // eslint-disable-next-line @typescript-eslint/naming-convention
  raw_data: {
    contract: [{ type: 'TriggerSmartContract' }],
    // eslint-disable-next-line @typescript-eslint/naming-convention
    ref_block_bytes: '1234',
    expiration: 1700000000,
    timestamp: 1699999000,
  } as Json,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  raw_data_hex: 'deadbeef01020304',
  visible: false,
} satisfies Record<string, Json>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Encode a plain-text string to base64 the same way the RpcHandler does.
 *
 * @param text - The plain-text string to encode.
 * @returns Base64-encoded string.
 */
function toBase64(text: string): string {
  return bytesToBase64(stringToBytes(text));
}

/**
 * Build a minimal JsonRpcRequest for the given WC method.
 *
 * @param method - The RPC method name.
 * @param params - The params object.
 * @returns A JsonRpcRequest fixture.
 */
function makeRequest(
  method: string,
  params: Record<string, Json>,
): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: 1,
    method,
    params,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RpcHandler', () => {
  let handler: RpcHandler;
  let mockAccountsService: jest.Mocked<AccountsService>;
  let mockWalletService: jest.Mocked<WalletService>;
  let mockConfirmationHandler: jest.Mocked<ConfirmationHandler>;

  beforeEach(() => {
    mockAccountsService = {
      findByAddress: jest.fn().mockResolvedValue(mockAccount),
    } as unknown as jest.Mocked<AccountsService>;

    mockWalletService = {
      signMessage: jest.fn().mockResolvedValue({ signature: 'sig-hex' }),
      signTransaction: jest
        .fn()
        .mockResolvedValue({ signature: '0xdeadbeef01' }),
    } as unknown as jest.Mocked<WalletService>;

    mockConfirmationHandler = {
      handleKeyringRequest: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<ConfirmationHandler>;

    handler = new RpcHandler({
      logger: mockLogger,
      walletService: mockWalletService,
      accountsService: mockAccountsService,
      confirmationHandler: mockConfirmationHandler,
    });
  });

  // ── handle() routing ──────────────────────────────────────────────────────

  describe('handle', () => {
    it('throws MethodNotFoundError for unknown methods', async () => {
      // Bypass the origin check so we reach the switch statement.
      jest.spyOn(validators, 'validateOrigin').mockReturnValue(undefined);
      const request = makeRequest('unknown_method', {});
      await expect(handler.handle('metamask', request)).rejects.toThrow(
        MethodNotFoundError,
      );
    });

    it('routes tron_signMessage without origin check', async () => {
      // An arbitrary dApp origin that is NOT in originPermissions.
      // If origin were checked, this would throw UnauthorizedError.
      const request = makeRequest(WalletConnectRpcMethod.SignMessage, {
        address: TRON_ADDRESS,
        message: 'hello',
      });
      expect(await handler.handle(DAPP_ORIGIN, request)).toStrictEqual({
        signature: 'sig-hex',
      });
    });

    it('routes tron_signTransaction without origin check', async () => {
      const request = makeRequest(WalletConnectRpcMethod.SignTransaction, {
        address: TRON_ADDRESS,
        transaction: WC_TRANSACTION,
      });
      expect(await handler.handle(DAPP_ORIGIN, request)).toMatchObject({
        txID: WC_TRANSACTION.txID,
      });
    });
  });

  // ── tron_signMessage ──────────────────────────────────────────────────────

  describe('tron_signMessage', () => {
    const signMessageRequest = (message: string) =>
      makeRequest(WalletConnectRpcMethod.SignMessage, {
        address: TRON_ADDRESS,
        message,
      });

    it('returns { signature } on success', async () => {
      const result = await handler.handle(
        DAPP_ORIGIN,
        signMessageRequest('hello world'),
      );
      expect(result).toStrictEqual({ signature: 'sig-hex' });
    });

    it('base64-encodes the plain-text message before calling WalletService', async () => {
      const plainText = 'hello world';
      await handler.handle(DAPP_ORIGIN, signMessageRequest(plainText));
      expect(mockWalletService.signMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          params: {
            address: TRON_ADDRESS,
            message: toBase64(plainText),
          },
        }),
      );
    });

    it('passes origin to the confirmation dialog', async () => {
      await handler.handle(DAPP_ORIGIN, signMessageRequest('msg'));
      expect(mockConfirmationHandler.handleKeyringRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({ origin: DAPP_ORIGIN }),
        }),
      );
    });

    it('passes Network.Mainnet scope to WalletService', async () => {
      await handler.handle(DAPP_ORIGIN, signMessageRequest('msg'));
      expect(mockWalletService.signMessage).toHaveBeenCalledWith(
        expect.objectContaining({ scope: Network.Mainnet }),
      );
    });

    it('throws when no account is found for the address', async () => {
      mockAccountsService.findByAddress.mockResolvedValue(null);
      const request = signMessageRequest('msg');
      await expect(handler.handle(DAPP_ORIGIN, request)).rejects.toThrow(
        `No account found for address: ${TRON_ADDRESS}`,
      );
    });

    it('throws UserRejectedRequestError when user rejects the confirmation', async () => {
      mockConfirmationHandler.handleKeyringRequest.mockResolvedValue(false);
      const request = signMessageRequest('msg');
      await expect(handler.handle(DAPP_ORIGIN, request)).rejects.toThrow(
        UserRejectedRequestError,
      );
    });

    it('throws InvalidParamsError on invalid params', async () => {
      const request = makeRequest(WalletConnectRpcMethod.SignMessage, {
        address: 'not-a-tron-address',
        message: 'msg',
      });
      await expect(handler.handle(DAPP_ORIGIN, request)).rejects.toThrow(Error);
    });
  });

  // ── tron_signTransaction ──────────────────────────────────────────────────

  describe('tron_signTransaction', () => {
    const signTxRequest = (tx = WC_TRANSACTION) =>
      makeRequest(WalletConnectRpcMethod.SignTransaction, {
        address: TRON_ADDRESS,
        transaction: tx,
      });

    it('returns the full WalletConnect signed transaction shape', async () => {
      const result = await handler.handle(DAPP_ORIGIN, signTxRequest());
      expect(result).toStrictEqual({
        txID: WC_TRANSACTION.txID,
        signature: ['deadbeef01'],
        // eslint-disable-next-line @typescript-eslint/naming-convention
        raw_data: WC_TRANSACTION.raw_data,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        raw_data_hex: WC_TRANSACTION.raw_data_hex,
        visible: false,
      });
    });

    it('strips 0x prefix from the signature and wraps it in an array', async () => {
      mockWalletService.signTransaction.mockResolvedValue({
        signature: '0xABCDEF',
      });
      const result = (await handler.handle(DAPP_ORIGIN, signTxRequest())) as {
        signature: string[];
      };
      expect(result.signature).toStrictEqual(['ABCDEF']);
    });

    it('handles signature without 0x prefix', async () => {
      mockWalletService.signTransaction.mockResolvedValue({
        signature: 'ABCDEF',
      });
      const result = (await handler.handle(DAPP_ORIGIN, signTxRequest())) as {
        signature: string[];
      };
      expect(result.signature).toStrictEqual(['ABCDEF']);
    });

    it('extracts contract type from raw_data.contract[0].type', async () => {
      await handler.handle(DAPP_ORIGIN, signTxRequest());
      expect(mockWalletService.signTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            transaction: expect.objectContaining({
              type: 'TriggerSmartContract',
              rawDataHex: WC_TRANSACTION.raw_data_hex,
            }),
          }),
        }),
      );
    });

    it('falls back to empty string when contract array is empty', async () => {
      const txNoContract = {
        ...WC_TRANSACTION,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        raw_data: { contract: [] } as Json,
      };
      await handler.handle(DAPP_ORIGIN, signTxRequest(txNoContract));
      expect(mockWalletService.signTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            transaction: expect.objectContaining({ type: '' }),
          }),
        }),
      );
    });

    it('passes origin to the confirmation dialog', async () => {
      await handler.handle(DAPP_ORIGIN, signTxRequest());
      expect(mockConfirmationHandler.handleKeyringRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({ origin: DAPP_ORIGIN }),
        }),
      );
    });

    it('throws when no account is found for the address', async () => {
      mockAccountsService.findByAddress.mockResolvedValue(null);
      await expect(
        handler.handle(DAPP_ORIGIN, signTxRequest()),
      ).rejects.toThrow(`No account found for address: ${TRON_ADDRESS}`);
    });

    it('throws UserRejectedRequestError when user rejects the confirmation', async () => {
      mockConfirmationHandler.handleKeyringRequest.mockResolvedValue(false);
      await expect(
        handler.handle(DAPP_ORIGIN, signTxRequest()),
      ).rejects.toThrow(UserRejectedRequestError);
    });

    it('throws InvalidParamsError when transaction is missing raw_data_hex', async () => {
      const request = makeRequest(WalletConnectRpcMethod.SignTransaction, {
        address: TRON_ADDRESS,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        transaction: { txID: 'abc', raw_data: { contract: [] } },
      });
      await expect(handler.handle(DAPP_ORIGIN, request)).rejects.toThrow(Error);
    });
  });
});
