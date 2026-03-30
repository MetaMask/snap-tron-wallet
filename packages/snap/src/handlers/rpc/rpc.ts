import { MethodNotFoundError, UserRejectedRequestError } from '@metamask/snaps-sdk';
import type { Json, JsonRpcRequest } from '@metamask/snaps-sdk';

import { Network } from '../../constants';
import { walletConnectMethods } from '../../permissions';
import type { AccountsService } from '../../services/accounts/AccountsService';
import type { ConfirmationHandler } from '../../services/confirmation/ConfirmationHandler';
import type { WalletService } from '../../services/wallet/WalletService';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import {
  WCSignMessageParamsStruct,
  WCSignTransactionParamsStruct,
} from '../../validation/structs';
import { validateOrigin, validateRequest } from '../../validation/validators';
import { TronMultichainMethod } from '../keyring-types';
import { WalletConnectRpcMethod } from './types';

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
    // WalletConnect methods bypass the origin allowlist — dApp origins are not
    // known ahead of time. Session-level authorization is handled by MetaMask
    // Mobile before the request reaches the snap.
    if (!walletConnectMethods.has(request.method)) {
      validateOrigin(origin, request.method);
    }

    this.#logger.log('Handling RPC request', { method: request.method, origin });

    const { method } = request;

    switch (method) {
      case WalletConnectRpcMethod.SignMessage:
        return this.#handleSignMessage(request);

      case WalletConnectRpcMethod.SignTransaction:
        return this.#handleSignTransaction(request);

      default:
        throw new MethodNotFoundError() as Error;
    }
  }

  /**
   * Handles tron_signMessage (WalletConnect Tron namespace).
   *
   * WalletConnect format:
   *   params: { address: string, message: string (plain text) }
   *   result: { signature: string }
   *
   * Mapping: message is base64-encoded before forwarding to WalletService,
   * which calls tronWeb.trx.signMessageV2.
   *
   * Ref: https://docs.reown.com/advanced/multichain/rpc-reference/tron-rpc
   */
  async #handleSignMessage(request: JsonRpcRequest): Promise<Json> {
    validateRequest(request.params, WCSignMessageParamsStruct);
    const { address, message } = request.params;

    this.#logger.log('tron_signMessage', { address });

    const account = await this.#accountsService.findByAddress(address);
    if (!account) {
      throw new Error(`No account found for address: ${address}`);
    }

    // WalletConnect sends plain text; WalletService.signMessage expects base64.
    // eslint-disable-next-line no-restricted-globals
    const base64Message = Buffer.from(message, 'utf8').toString('base64');
    const snapParams = { address, message: base64Message };

    const confirmed = await this.#confirmationHandler.handleKeyringRequest({
      request: {
        id: crypto.randomUUID(),
        scope: Network.Mainnet,
        account: account.id,
        request: {
          method: TronMultichainMethod.SignMessage,
          params: snapParams,
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
      params: snapParams,
    });
  }

  /**
   * Handles tron_signTransaction (WalletConnect Tron namespace).
   *
   * WalletConnect v1 flat format:
   *   params: { address, transaction: { txID, raw_data, raw_data_hex, visible? } }
   *   result: { txID, signature: string[], raw_data, raw_data_hex, visible }
   *
   * Mapping:
   * - IN:  raw_data_hex + raw_data.contract[0].type → WalletService.signTransaction
   * - OUT: signature "0x<hex>" → strip 0x, wrap in array per WC spec
   *
   * Wallets must advertise tron_method_version: "v1" in WalletConnect
   * sessionProperties so dApps send the flat format (not the legacy nested
   * transaction.transaction structure).
   *
   * Ref: https://docs.reown.com/advanced/multichain/rpc-reference/tron-rpc
   */
  async #handleSignTransaction(request: JsonRpcRequest): Promise<Json> {
    validateRequest(request.params, WCSignTransactionParamsStruct);
    const { address, transaction } = request.params;

    this.#logger.log('tron_signTransaction', { address, txID: transaction.txID });

    const account = await this.#accountsService.findByAddress(address);
    if (!account) {
      throw new Error(`No account found for address: ${address}`);
    }

    // Extract the protobuf contract type from raw_data — required by
    // WalletService.signTransaction to deserialize the raw hex.
    const contractType = transaction.raw_data.contract[0]?.type ?? '';
    const snapParams = {
      address,
      transaction: {
        rawDataHex: transaction.raw_data_hex,
        type: contractType,
      },
    };

    const confirmed = await this.#confirmationHandler.handleKeyringRequest({
      request: {
        id: crypto.randomUUID(),
        scope: Network.Mainnet,
        account: account.id,
        request: {
          method: TronMultichainMethod.SignTransaction,
          params: snapParams,
        },
      },
      account,
    });

    if (!confirmed) {
      throw new UserRejectedRequestError() as unknown as Error;
    }

    const { signature } = await this.#walletService.signTransaction({
      account,
      scope: Network.Mainnet,
      params: snapParams,
    });

    // WalletConnect expects signature as an array of hex strings without the
    // 0x prefix. WalletService returns "0x<hex>".
    const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;

    return {
      txID: transaction.txID,
      signature: [sigHex],
      // eslint-disable-next-line @typescript-eslint/naming-convention
      raw_data: transaction.raw_data as Json,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      raw_data_hex: transaction.raw_data_hex,
      visible: false,
    };
  }
}
