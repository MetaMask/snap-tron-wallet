import { assert } from '@metamask/superstruct';
import { bytesToHex, hexToBytes, sha256 } from '@metamask/utils';
import type { Transaction } from 'tronweb/lib/esm/types';

import type { SnapClient } from '../../clients/snap/SnapClient';
import type { TronWebFactory } from '../../clients/tronweb/TronWebFactory';
import type { Network } from '../../constants';
import type { TronKeyringAccount } from '../../entities';
import type { AssetEntity } from '../../entities/assets';
import { TronMultichainMethod } from '../../handlers/keyring-types';
import { render as renderConfirmSignMessage } from '../../ui/confirmation/views/ConfirmSignMessage/render';
import { render as renderConfirmSignTransaction } from '../../ui/confirmation/views/ConfirmSignTransaction/render';
import { render as renderConfirmTransactionRequest } from '../../ui/confirmation/views/ConfirmTransactionRequest/render';
import { formatOrigin } from '../../utils/formatOrigin';
import type { ILogger } from '../../utils/logger';
import logger, { createPrefixedLogger } from '../../utils/logger';
import {
  SignTransactionRequestStruct,
  type TronWalletKeyringRequest,
} from '../../validation/structs';
import type { ComputeFeeResult } from '../send/types';
import type { State, UnencryptedStateValue } from '../state/State';

export class ConfirmationHandler {
  readonly #logger: ILogger;

  readonly #snapClient: SnapClient;

  readonly #state: State<UnencryptedStateValue>;

  readonly #tronWebFactory: TronWebFactory;

  constructor({
    snapClient,
    state,
    tronWebFactory,
  }: {
    snapClient: SnapClient;
    state: State<UnencryptedStateValue>;
    tronWebFactory: TronWebFactory;
  }) {
    this.#logger = createPrefixedLogger(logger, '[🔑 ConfirmationHandler]');
    this.#snapClient = snapClient;
    this.#state = state;
    this.#tronWebFactory = tronWebFactory;
  }

  async handleKeyringRequest({
    request,
    account,
  }: {
    request: TronWalletKeyringRequest;
    account: TronKeyringAccount;
  }): Promise<boolean> {
    this.#logger.info('Handling keyring request', {
      request,
      account,
    });

    const { method } = request.request;

    // Handle different request types
    switch (method as TronMultichainMethod) {
      case TronMultichainMethod.SignMessage: {
        return this.#handleSignMessageRequest(request, account);
      }
      case TronMultichainMethod.SignTransaction: {
        return this.#handleSignTransactionRequest(request, account);
      }
      default:
        this.#logger.warn('Unhandled keyring request method', { method });
        throw new Error(`Unhandled keyring request method: ${method}`);
    }

    return false;
  }

  async #handleSignMessageRequest(
    request: TronWalletKeyringRequest,
    account: TronKeyringAccount,
  ): Promise<boolean> {
    const result = await renderConfirmSignMessage(request, account);
    return result === true;
  }

  async #handleSignTransactionRequest(
    request: TronWalletKeyringRequest,
    account: TronKeyringAccount,
  ): Promise<boolean> {
    assert(request.request.params, SignTransactionRequestStruct);

    const {
      scope,
      request: {
        params: { transaction: transactionParams },
      },
    } = request;

    const { rawDataHex, type } = transactionParams;

    // Create a TronWeb instance for transaction deserialization
    const tronWeb = this.#tronWebFactory.createClient(scope);

    // Rebuild the transaction from hex (same logic as clientRequest handler)
    const rawData = tronWeb.utils.deserializeTx.deserializeTransaction(
      type,
      rawDataHex,
    );

    // Extend the transaction expiration to give users more time to review
    // dApps typically set ~60 second expiration which can expire during review
    const extendedTransaction = await this.#extendTransactionExpiration(
      tronWeb,
      rawData,
      rawDataHex,
    );

    // Update the request with the extended transaction's rawDataHex
    // This ensures the confirmation dialog and subsequent signing use the extended transaction
    transactionParams.rawDataHex = extendedTransaction.raw_data_hex;

    const result = await renderConfirmSignTransaction(
      request,
      account,
      extendedTransaction.raw_data,
    );
    return result === true;
  }

  /**
   * Extends transaction expiration by 5 minutes to prevent "Transaction too old" errors.
   * dApps typically create transactions with ~60 second expiration, but users may need
   * more time to review security alerts and transaction details.
   *
   * @param tronWeb - TronWeb instance for the network
   * @param rawData - Deserialized transaction raw data
   * @param rawDataHex - Original hex-encoded raw data
   * @returns Transaction with extended expiration
   */
  async #extendTransactionExpiration(
    tronWeb: ReturnType<TronWebFactory['createClient']>,
    rawData: Transaction['raw_data'],
    rawDataHex: string,
  ): Promise<Transaction> {
    // Build a Transaction object from the deserialized data
    const txID = bytesToHex(await sha256(hexToBytes(rawDataHex))).slice(2);

    const transaction: Transaction = {
      visible: true,
      txID,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      raw_data: rawData,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      raw_data_hex: rawDataHex,
    };

    // Extend expiration by 5 minutes (300,000 milliseconds)
    // This gives users adequate time to review the transaction details and security alerts
    const EXPIRATION_EXTENSION_MS = 300_000;

    const extendedTransaction =
      await tronWeb.transactionBuilder.extendExpiration(
        transaction,
        EXPIRATION_EXTENSION_MS,
      );

    this.#logger.info('Extended transaction expiration', {
      originalExpiration: rawData.expiration,
      newExpiration: extendedTransaction.raw_data.expiration,
      extensionMs: EXPIRATION_EXTENSION_MS,
    });

    return extendedTransaction;
  }

  async confirmTransactionRequest({
    scope,
    fromAddress,
    toAddress,
    amount,
    fees,
    asset,
    accountType,
    origin,
  }: {
    scope: Network;
    fromAddress: string;
    toAddress: string;
    amount: string;
    fees: ComputeFeeResult;
    asset: AssetEntity;
    accountType: string;
    origin: string;
  }): Promise<boolean> {
    // Track Transaction Added event
    await this.#snapClient.trackTransactionAdded({
      origin,
      accountType,
      chainIdCaip: scope,
    });

    const result = await renderConfirmTransactionRequest(
      this.#snapClient,
      this.#state,
      {
        scope,
        fromAddress,
        toAddress,
        amount,
        fees,
        asset,
        origin: formatOrigin(origin),
      },
    );

    // Track Transaction Rejected event if user rejects
    if (result === true) {
      await this.#snapClient.trackTransactionApproved({
        origin,
        accountType,
        chainIdCaip: scope,
      });
    } else {
      await this.#snapClient.trackTransactionRejected({
        origin,
        accountType,
        chainIdCaip: scope,
      });
    }

    return result === true;
  }
}
