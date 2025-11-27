import { SnapError } from '@metamask/snaps-sdk';
import type { Json } from '@metamask/utils';

import type { TronWebFactory } from '../../clients/tronweb/TronWebFactory';
import type { Network } from '../../constants';
import type { TronKeyringAccount } from '../../entities';
import {
  TronMultichainErrors,
  TronMultichainMethod,
} from '../../handlers/keyring-types';
import { createPrefixedLogger, type ILogger } from '../../utils/logger';
import {
  SignMessageRequestStruct,
  SignMessageResponseStruct,
  SignTransactionRequestStruct,
} from '../../validation/structs';
import { validateRequest, validateResponse } from '../../validation/validators';
import type { AccountsService } from '../accounts/AccountsService';
/**
 * Service responsible for handling wallet operations like signing messages and transactions.
 */
export class WalletService {
  readonly #logger: ILogger;

  readonly #accountsService: AccountsService;

  readonly #tronWebFactory: TronWebFactory;

  constructor({
    logger,
    accountsService,
    tronWebFactory,
  }: {
    logger: ILogger;
    accountsService: AccountsService;
    tronWebFactory: TronWebFactory;
  }) {
    this.#logger = createPrefixedLogger(logger, '[💼 WalletService]');
    this.#accountsService = accountsService;
    this.#tronWebFactory = tronWebFactory;
  }

  /**
   * Handles wallet requests by routing them to the appropriate method.
   *
   * @param request - The wallet request containing method and parameters.
   * @param request.account - The account to use for signing.
   * @param request.scope - The scope to use for signing.
   * @param request.method - The method to execute (signMessage or signTransaction).
   * @param request.params - The parameters for the method.
   * @returns The result of the wallet operation.
   * @throws {SnapError} If the method is not supported or if there's an error.
   */
  async handleKeyringRequest({
    account,
    scope,
    method,
    params,
  }: {
    account: TronKeyringAccount;
    scope: Network;
    method: TronMultichainMethod;
    params: Json;
  }): Promise<{ signature: string }> {
    this.#logger.log('Handling wallet request', {
      method,
      accountId: account.id,
      scope,
      params,
    });

    try {
      switch (method) {
        case TronMultichainMethod.SignMessage:
          return await this.signMessage({ account, scope, params });
        case TronMultichainMethod.SignTransaction:
          return await this.signTransaction({ account, scope, params });
        default:
          throw new SnapError(
            'Unsupported wallet method',
            TronMultichainErrors.InvalidParams,
          );
      }
    } catch (error: any) {
      this.#logger.error({ error }, 'Error handling wallet request');

      // User rejected the request
      if (error.code === 4100 || error.message?.includes('rejected')) {
        throw new SnapError(
          TronMultichainErrors.UserRejected.message,
          TronMultichainErrors.UserRejected,
        );
      }

      // Invalid parameters
      if (error.code === 4001 || error.message?.includes('Invalid')) {
        throw new SnapError(
          error.message ?? TronMultichainErrors.InvalidParams.message,
          TronMultichainErrors.InvalidParams,
        );
      }

      // Unknown error
      throw new SnapError(
        error.message ?? TronMultichainErrors.UnknownError.message,
        TronMultichainErrors.UnknownError,
      );
    }
  }

  /**
   * Signs a plain text message with a Tron account.
   * The signature can be used to verify ownership of the account.
   *
   * @param request - The sign message request.
   * @param request.account - The account to sign with.
   * @param request.scope - The scope to use for signing.
   * @param request.params - The request parameters containing address and message.
   * @returns An object containing the signature.
   */
  async signMessage({
    account,
    scope,
    params,
  }: {
    account: TronKeyringAccount;
    scope: Network;
    params: Json;
  }): Promise<{ signature: string }> {
    try {
      // Validate the params structure
      validateRequest(params, SignMessageRequestStruct);

      const { address, message } = params;

      // Derive the private key for signing
      const { privateKeyHex } = await this.#accountsService.deriveTronKeypair({
        entropySource: account.entropySource,
        derivationPath: account.derivationPath,
      });

      // Create a TronWeb instance for message signing
      // We can use any network since we're just signing a message
      const tronWeb = this.#tronWebFactory.createClient(scope, privateKeyHex);

      // Decode the base64 message to get the raw message
      // eslint-disable-next-line no-restricted-globals
      const decodedMessage = Buffer.from(message, 'base64').toString('utf8');

      // Sign the message using TronWeb's signMessageV2
      const signature = tronWeb.trx.signMessageV2(
        decodedMessage,
        privateKeyHex,
      );

      const result = {
        signature,
      };

      validateResponse(result, SignMessageResponseStruct);

      this.#logger.log('Message signed successfully', { address });

      return result;
    } catch (error: any) {
      this.#logger.error({ error }, 'Error signing message');
      throw error;
    }
  }

  /**
   * Signs a Tron transaction.
   * The transaction must be provided as a base64-encoded serialized transaction string.
   *
   * @param request - The sign transaction request.
   * @param request.account - The account to sign with.
   * @param request.scope - The scope to use for signing.
   * @param request.params - The request parameters containing scope, address, and transaction.
   * @returns An object containing the signature.
   */
  async signTransaction({
    account,
    scope,
    params,
  }: {
    account: TronKeyringAccount;
    scope: Network;
    params: Json;
  }): Promise<{ signature: string }> {
    try {
      // Validate the params structure
      validateRequest(params, SignTransactionRequestStruct);

      const { address, transaction: transactionBase64 } = params;

      // Derive the private key for signing
      const { privateKeyHex } = await this.#accountsService.deriveTronKeypair({
        entropySource: account.entropySource,
        derivationPath: account.derivationPath,
      });

      // Create a TronWeb instance for transaction signing
      const tronWeb = this.#tronWebFactory.createClient(scope, privateKeyHex);

      // Deserialize the transaction from base64
      // eslint-disable-next-line no-restricted-globals
      const txBytes = Buffer.from(transactionBase64, 'base64');

      // Use TronWeb to deserialize and sign the transaction
      // The transaction should be a protobuf-serialized transaction
      const transaction = tronWeb.utils.transaction.txPbToTxID(txBytes);

      // Sign the transaction
      const signedTx = await tronWeb.trx.sign(transaction, privateKeyHex);

      // Extract the signature from the signed transaction
      // signedTx.signature is an array of hex strings
      const signatureArray = (signedTx as any).signature as string[];
      const signature = signatureArray?.[0] ?? '';

      const result = {
        signature: `0x${signature}`,
      };

      this.#logger.log('Transaction signed successfully', { address, scope });

      return result;
    } catch (error: any) {
      this.#logger.error({ error }, 'Error signing transaction');

      // Check if it's a transaction format error
      if (
        error.message?.includes('deserialize') ||
        error.message?.includes('parse') ||
        error.message?.includes('invalid')
      ) {
        throw new SnapError(
          `Invalid transaction format: ${error.message}`,
          TronMultichainErrors.InvalidTransaction,
        );
      }

      throw error;
    }
  }
}
