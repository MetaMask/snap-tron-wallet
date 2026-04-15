import {
  MethodNotFoundError,
  UserRejectedRequestError,
} from '@metamask/snaps-sdk';
import type { Json, JsonRpcRequest } from '@metamask/snaps-sdk';

import { Network } from '../../constants';
import type { AccountsService } from '../../services/accounts/AccountsService';
import type { ConfirmationHandler } from '../../services/confirmation/ConfirmationHandler';
import type { WalletService } from '../../services/wallet/WalletService';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import {
  SignMessageRequestStruct,
  SignTransactionRequestStruct,
} from '../../validation/structs';
import { validateOrigin, validateRequest } from '../../validation/validators';
import { TronMultichainMethod } from '../keyring-types';

export class RpcHandler {
  readonly #logger: ILogger;

  readonly #walletService: WalletService;

  readonly #accountsService: AccountsService;

  readonly #confirmationHandler: ConfirmationHandler;

  constructor({
    logger,
    walletService,
    accountsService,
    confirmationHandler,
  }: {
    logger: ILogger;
    walletService: WalletService;
    accountsService: AccountsService;
    confirmationHandler: ConfirmationHandler;
  }) {
    this.#logger = createPrefixedLogger(logger, '[👋 RpcHandler]');
    this.#walletService = walletService;
    this.#accountsService = accountsService;
    this.#confirmationHandler = confirmationHandler;
  }

  async handle(origin: string, request: JsonRpcRequest): Promise<Json> {
    validateOrigin(origin, request.method);

    this.#logger.log('Handling RPC request', {
      method: request.method,
      origin,
    });

    const method = request.method as TronMultichainMethod;

    switch (method) {
      case TronMultichainMethod.SignMessage:
        return this.#handleSignMessage(origin, request);

      case TronMultichainMethod.SignTransaction:
        return this.#handleSignTransaction(origin, request);

      default:
        throw new MethodNotFoundError() as Error;
    }
  }

  /**
   * Handles canonical signMessage RPC calls.
   *
   * @param origin - The dapp origin provided by the caller.
   * @param request - The JSON-RPC request payload.
   * @returns The signed message response.
   */
  async #handleSignMessage(
    origin: string,
    request: JsonRpcRequest,
  ): Promise<Json> {
    validateRequest(request.params, SignMessageRequestStruct);
    const { address } = request.params;

    const account = await this.#accountsService.findByAddress(address);
    if (!account) {
      throw new Error(`No account found for address: ${address}`);
    }

    const confirmed = await this.#confirmationHandler.handleKeyringRequest({
      request: {
        id: globalThis.crypto.randomUUID(),
        scope: Network.Mainnet,
        account: account.id,
        origin,
        request: {
          method: TronMultichainMethod.SignMessage,
          params: request.params,
        },
      },
      account,
    });

    if (!confirmed) {
      throw new UserRejectedRequestError() as unknown as Error;
    }

    return this.#walletService.signMessage({
      account,
      scope: Network.Mainnet,
      params: request.params,
    });
  }

  /**
   * Handles canonical signTransaction RPC calls.
   *
   * @param origin - The dapp origin provided by the caller.
   * @param request - The JSON-RPC request payload.
   * @returns The signed transaction response.
   */
  async #handleSignTransaction(
    origin: string,
    request: JsonRpcRequest,
  ): Promise<Json> {
    validateRequest(request.params, SignTransactionRequestStruct);
    const { address } = request.params;

    const account = await this.#accountsService.findByAddress(address);
    if (!account) {
      throw new Error(`No account found for address: ${address}`);
    }

    const confirmed = await this.#confirmationHandler.handleKeyringRequest({
      request: {
        id: globalThis.crypto.randomUUID(),
        scope: Network.Mainnet,
        account: account.id,
        origin,
        request: {
          method: TronMultichainMethod.SignTransaction,
          params: request.params,
        },
      },
      account,
    });

    if (!confirmed) {
      throw new UserRejectedRequestError() as unknown as Error;
    }

    return this.#walletService.signTransaction({
      account,
      scope: Network.Mainnet,
      params: request.params,
    });
  }
}
