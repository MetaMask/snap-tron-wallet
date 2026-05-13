/* istanbul ignore file */

import { TransactionStatus } from '@metamask/keyring-api';
import type { Json, JsonRpcRequest } from '@metamask/snaps-sdk';
import { InvalidParamsError, MethodNotFoundError } from '@metamask/snaps-sdk';
import { assert } from '@metamask/superstruct';

import { ClientRequestMethod, SendErrorCodes } from './types';
import {
  ClaimTrxStakingRewardsRequestStruct,
  ClaimUnstakedTrxRequestStruct,
  ComputeFeeRequestStruct,
  ComputeStakeFeeRequestStruct,
  OnAddressInputRequestStruct,
  OnAmountInputRequestStruct,
  OnConfirmSendRequestStruct,
  OnConfirmStakeRequestStruct,
  OnConfirmUnstakeRequestStruct,
  OnStakeAmountInputRequestStruct,
  OnUnstakeAmountInputRequestStruct,
  SignAndSendTransactionRequestStruct,
  SignRewardsMessageRequestStruct,
  ComputeFeeResponseStruct,
} from './validation';
import { FEE_LIMIT, Network, Networks } from '../../constants';
import type { TransactionsServiceV3 } from '../../services/transactions/TransactionsServiceV3';
import { assertOrThrow } from '../../utils/assertOrThrow';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';

export class ClientRequestHandlerV3 {
  readonly #logger: ILogger;

  readonly #transactionsServiceV3: TransactionsServiceV3;

  constructor({
    logger,
    transactionsServiceV3,
  }: {
    logger: ILogger;
    transactionsServiceV3: TransactionsServiceV3;
  }) {
    this.#logger = createPrefixedLogger(logger, '[👋 ClientRequestHandlerV3]');
    this.#transactionsServiceV3 = transactionsServiceV3;
  }

  /**
   * Handles JSON-RPC requests originating exclusively from the client - as defined in [SIP-31](https://github.com/MetaMask/SIPs/blob/main/SIPS/sip-31.md) -
   * by routing them to the appropriate use case, based on the method. Some methods need to be implemented
   * as part of the [Unified Non-EVM Send](https://www.notion.so/metamask-consensys/Unified-Non-EVM-Send-248f86d67d6880278445f9ad75478471) specification.
   *
   * @param request - The JSON-RPC request containing the method and parameters.
   * @returns The response to the JSON-RPC request.
   * @throws {MethodNotFoundError} If the method is not found.
   * @throws {InvalidParamsError} If the params are invalid.
   */
  async handle(request: JsonRpcRequest): Promise<Json> {
    this.#logger.log('Handling client request', request);

    const { method } = request;

    switch (method as ClientRequestMethod) {
      /**
       * Wallet Standard
       */
      case ClientRequestMethod.SignAndSendTransaction:
        return this.#handleSignAndSendTransaction(request);
      /**
       * Unified non-EVM Send
       */
      case ClientRequestMethod.OnAddressInput:
        return this.#handleOnAddressInput(request);
      case ClientRequestMethod.OnAmountInput:
        return this.#handleOnAmountInput(request);
      case ClientRequestMethod.ConfirmSend:
        return this.#handleConfirmSend(request);
      case ClientRequestMethod.ComputeFee:
        return this.#handleComputeFee(request);
      case ClientRequestMethod.ComputeStakeFee:
        return this.#handleComputeStakeFee(request);
      /**
       * Staking
       */
      case ClientRequestMethod.OnStakeAmountInput:
        return this.#handleOnStakeAmountInput(request);
      case ClientRequestMethod.ConfirmStake:
        return this.#handleConfirmStake(request);
      case ClientRequestMethod.OnUnstakeAmountInput:
        return this.#handleOnUnstakeAmountInput(request);
      case ClientRequestMethod.ConfirmUnstake:
        return this.#handleConfirmUnstake(request);
      case ClientRequestMethod.ClaimUnstakedTrx:
        return this.#handleClaimUnstakedTrx(request);
      case ClientRequestMethod.ClaimTrxStakingRewards:
        return this.#handleClaimTrxStakingRewards(request);
      /**
       * Sign Rewards Message
       */
      case ClientRequestMethod.SignRewardsMessage:
        return this.#handleSignRewardsMessage(request);
      default:
        throw new MethodNotFoundError() as Error;
    }
  }

  /**
   * Handles the signing and sending of a transaction.
   *
   * CRITICAL SECURITY REQUIREMENT:
   * This method does NOT request user confirmation. The caller is responsible
   * for obtaining explicit user consent before invoking this method.
   *
   * @param request - The JSON-RPC request containing transaction details.
   * @returns The transaction result with hash and status.
   */
  async #handleSignAndSendTransaction(request: JsonRpcRequest): Promise<Json> {
    assertOrThrow(
      request,
      SignAndSendTransactionRequestStruct,
      new InvalidParamsError(),
    );

    const {
      transaction: transactionBase64,
      accountId,
      scope,
      options: { type },
    } = request.params;

    let draft = await this.#transactionsServiceV3.prepareRawTransaction({
      accountId,
      scope,
      transactionBase64,
      transactionType: type,
      feeLimit: FEE_LIMIT,
    });
    const fees =
      await this.#transactionsServiceV3.estimateTransactionFees(draft);
    const validation = this.#transactionsServiceV3.validateTransactionDraft({
      draft,
      fees,
    });

    if (!validation.valid) {
      return this.#transactionsServiceV3.validationResponse(validation);
    }

    draft = this.#transactionsServiceV3.withFees({ draft, fees });
    const broadcastResults =
      await this.#transactionsServiceV3.submitTransactionDraft({ draft });
    const transactionId = broadcastResults[0]?.txid;

    if (!transactionId) {
      throw new Error('Transaction submission did not return a transaction id');
    }

    return { transactionId };
  }

  /**
   * Handles the input of an address.
   *
   * @param request - The JSON-RPC request containing the method and parameters.
   * @returns The response to the JSON-RPC request.
   */
  async #handleOnAddressInput(request: JsonRpcRequest): Promise<Json> {
    try {
      assert(request, OnAddressInputRequestStruct);
      return {
        valid: true,
        errors: [],
      };
    } catch {
      return {
        valid: false,
        errors: [{ code: SendErrorCodes.Invalid }],
      };
    }
  }

  /**
   * Handles amount input validation and balance checking.
   *
   * @param request - The JSON-RPC request containing amount and asset details.
   * @returns Validation result with balance and sufficiency status.
   */
  async #handleOnAmountInput(request: JsonRpcRequest): Promise<Json> {
    try {
      assert(request, OnAmountInputRequestStruct);

      const { accountId, assetId, value, toAddress } = request.params;
      const prepared = await this.#transactionsServiceV3.prepareSendTransaction(
        {
          accountId,
          assetId,
          amountValue: value,
          toAddress,
          feeLimit: FEE_LIMIT,
          skipIfNoToAddress: true,
          missingAccountError: SendErrorCodes.Required,
        },
      );

      if (prepared.type === 'response') {
        return prepared.response;
      }

      const fees = await this.#transactionsServiceV3.estimateTransactionFees(
        prepared.draft,
      );
      const validation = this.#transactionsServiceV3.validateTransactionDraft({
        draft: prepared.draft,
        fees,
      });

      if (!validation.valid) {
        return this.#transactionsServiceV3.validationResponse(validation);
      }

      return this.#transactionsServiceV3.validationResponse(
        this.#transactionsServiceV3.validationSuccess(),
      );
    } catch (error) {
      this.#logger.error('Error in #handleOnAmountInput:', error);
      return {
        valid: false,
        errors: [{ code: SendErrorCodes.Invalid }],
      };
    }
  }

  /**
   * Handles the confirmation and sending of a transaction.
   *
   * @param request - The JSON-RPC request containing transaction details.
   * @returns The transaction result with hash and status.
   */
  async #handleConfirmSend(request: JsonRpcRequest): Promise<Json> {
    assertOrThrow(
      request,
      OnConfirmSendRequestStruct,
      new InvalidParamsError(),
    );

    const { fromAccountId, toAddress, amount, assetId } = request.params;
    const prepared = await this.#transactionsServiceV3.prepareSendTransaction({
      accountId: fromAccountId,
      assetId,
      amountValue: amount,
      toAddress,
      feeLimit: FEE_LIMIT,
      validateSendFeasibility: true,
    });

    if (prepared.type === 'response') {
      return prepared.response;
    }

    let { draft } = prepared;
    const fees =
      await this.#transactionsServiceV3.estimateTransactionFees(draft);
    const validation = this.#transactionsServiceV3.validateTransactionDraft({
      draft,
      fees,
    });

    if (!validation.valid) {
      return this.#transactionsServiceV3.validationResponse(validation);
    }

    await this.#transactionsServiceV3.confirmSendDraft({ draft, fees });
    draft = this.#transactionsServiceV3.withFees({ draft, fees });
    const broadcastResults =
      await this.#transactionsServiceV3.submitTransactionDraft({ draft });
    const transactionId = broadcastResults[0]?.txid;

    if (!transactionId) {
      throw new Error('Transaction submission did not return a transaction id');
    }

    return {
      transactionId,
      status: TransactionStatus.Submitted,
    };
  }

  /**
   * Handles the computation of a fee for a TRON transaction.
   *
   * @param request - The JSON-RPC request containing the method and parameters.
   * @returns The response to the JSON-RPC request with the detailed fee breakdown.
   * @throws {InvalidParamsError} If the params are invalid.
   */
  async #handleComputeFee(request: JsonRpcRequest): Promise<Json> {
    assertOrThrow(request, ComputeFeeRequestStruct, new InvalidParamsError());

    const {
      params: {
        scope,
        transaction: transactionBase64,
        accountId,
        options: { type, feeLimit },
      },
    } = request;
    const draft = await this.#transactionsServiceV3.prepareRawTransaction({
      accountId,
      scope,
      transactionBase64,
      transactionType: type,
      feeLimit,
    });
    const fees =
      await this.#transactionsServiceV3.estimateTransactionFees(draft);
    const validation = this.#transactionsServiceV3.validateTransactionDraft({
      draft,
      fees,
    });

    if (!validation.valid) {
      return this.#transactionsServiceV3.validationResponse(validation);
    }

    assert(fees, ComputeFeeResponseStruct);
    return fees as Json;
  }

  /**
   * Computes a fee preview for a staking transaction.
   *
   * @param request - The JSON-RPC request containing staking details.
   * @returns The detailed fee breakdown for the staking transaction.
   * @throws {InvalidParamsError} If the params are invalid.
   */
  async #handleComputeStakeFee(request: JsonRpcRequest): Promise<Json> {
    assertOrThrow(
      request,
      ComputeStakeFeeRequestStruct,
      new InvalidParamsError(),
    );

    const {
      fromAccountId,
      value,
      options: { purpose },
    } = request.params;
    const scope = Network.Mainnet;
    const prepared = await this.#transactionsServiceV3.prepareStakeTransactions(
      {
        accountId: fromAccountId,
        assetId: Networks[scope].nativeToken.id,
        amountValue: value,
        scope,
        purpose,
        includeVote: true,
      },
    );

    if (prepared.type === 'response') {
      return prepared.response;
    }

    const fees = await this.#transactionsServiceV3.estimateTransactionFees(
      prepared.draft,
    );
    const validation = this.#transactionsServiceV3.validateTransactionDraft({
      draft: prepared.draft,
      fees,
    });

    if (!validation.valid) {
      return this.#transactionsServiceV3.validationResponse(validation);
    }

    assert(fees, ComputeFeeResponseStruct);
    return fees as Json;
  }

  /**
   * Handles the input of a stake amount. Checks if the user has enough of the asset
   * to do the stake.
   *
   * @param request - The JSON-RPC request containing the method and parameters.
   * @returns The response to the JSON-RPC request.
   */
  async #handleOnStakeAmountInput(request: JsonRpcRequest): Promise<Json> {
    assertOrThrow(
      request,
      OnStakeAmountInputRequestStruct,
      new InvalidParamsError(),
    );

    const { accountId, assetId, value } = request.params;
    const prepared = await this.#transactionsServiceV3.prepareStakeTransactions(
      {
        accountId,
        assetId,
        amountValue: value,
        validateOnly: true,
      },
    );

    if (prepared.type === 'response') {
      return prepared.response;
    }

    const validation = this.#transactionsServiceV3.validateTransactionDraft({
      draft: prepared.draft,
    });

    return this.#transactionsServiceV3.validationResponse(validation);
  }

  /**
   * Handles the confirmation of a stake.
   *
   * @param request - The JSON-RPC request containing the method and parameters.
   * @returns The response to the JSON-RPC request.
   */
  async #handleConfirmStake(request: JsonRpcRequest): Promise<Json> {
    assertOrThrow(
      request,
      OnConfirmStakeRequestStruct,
      new InvalidParamsError(),
    );

    const {
      fromAccountId,
      assetId,
      value,
      options: { purpose, srNodeAddress },
    } = request.params;
    const prepared = await this.#transactionsServiceV3.prepareStakeTransactions(
      {
        accountId: fromAccountId,
        assetId,
        amountValue: value,
        purpose,
        srNodeAddress,
        includeVote: true,
      },
    );

    if (prepared.type === 'response') {
      return prepared.response;
    }

    let { draft } = prepared;
    const fees =
      await this.#transactionsServiceV3.estimateTransactionFees(draft);
    const validation = this.#transactionsServiceV3.validateTransactionDraft({
      draft,
      fees,
    });

    if (!validation.valid) {
      return this.#transactionsServiceV3.validationResponse(validation);
    }

    draft = this.#transactionsServiceV3.withFees({ draft, fees });
    await this.#transactionsServiceV3.submitTransactionDraft({ draft });

    return this.#transactionsServiceV3.validationResponse(
      this.#transactionsServiceV3.validationSuccess(),
    );
  }

  /**
   * Check if we have enough of the asset to unstake.
   *
   * @param request - The JSON-RPC request containing the method and parameters.
   * @returns The response to the JSON-RPC request.
   */
  async #handleOnUnstakeAmountInput(request: JsonRpcRequest): Promise<Json> {
    assertOrThrow(
      request,
      OnUnstakeAmountInputRequestStruct,
      new InvalidParamsError(),
    );

    const {
      accountId,
      assetId,
      value,
      options: { purpose },
    } = request.params;
    const prepared =
      await this.#transactionsServiceV3.prepareUnstakeTransactions({
        accountId,
        assetId,
        amountValue: value,
        purpose,
        validateOnly: true,
      });

    if (prepared.type === 'response') {
      return prepared.response;
    }

    const validation = this.#transactionsServiceV3.validateTransactionDraft({
      draft: prepared.draft,
    });

    return this.#transactionsServiceV3.validationResponse(validation);
  }

  /**
   * Handles the confirmation of an unstake.
   *
   * @param request - The JSON-RPC request containing the method and parameters.
   * @returns The response to the JSON-RPC request.
   */
  async #handleConfirmUnstake(request: JsonRpcRequest): Promise<Json> {
    assertOrThrow(
      request,
      OnConfirmUnstakeRequestStruct,
      new InvalidParamsError(),
    );

    const {
      accountId,
      assetId,
      value,
      options: { purpose },
    } = request.params;
    const prepared =
      await this.#transactionsServiceV3.prepareUnstakeTransactions({
        accountId,
        assetId,
        amountValue: value,
        purpose,
      });

    if (prepared.type === 'response') {
      return prepared.response;
    }

    let { draft } = prepared;
    const fees =
      await this.#transactionsServiceV3.estimateTransactionFees(draft);
    const validation = this.#transactionsServiceV3.validateTransactionDraft({
      draft,
      fees,
    });

    if (!validation.valid) {
      return this.#transactionsServiceV3.validationResponse(validation);
    }

    draft = this.#transactionsServiceV3.withFees({ draft, fees });
    await this.#transactionsServiceV3.submitTransactionDraft({ draft });

    return this.#transactionsServiceV3.validationResponse(
      this.#transactionsServiceV3.validationSuccess(),
    );
  }

  /**
   * Claims TRX that has completed the 14-day unstaking lock period.
   *
   * @param request - The JSON-RPC request containing the account and asset details.
   * @returns The result indicating success or failure with errors.
   */
  async #handleClaimUnstakedTrx(request: JsonRpcRequest): Promise<Json> {
    assertOrThrow(
      request,
      ClaimUnstakedTrxRequestStruct,
      new InvalidParamsError(),
    );

    const { fromAccountId, assetId } = request.params;
    let draft =
      await this.#transactionsServiceV3.prepareClaimUnstakedTransactions({
        accountId: fromAccountId,
        assetId,
      });
    const fees =
      await this.#transactionsServiceV3.estimateTransactionFees(draft);
    const validation = this.#transactionsServiceV3.validateTransactionDraft({
      draft,
      fees,
    });

    if (!validation.valid) {
      return this.#transactionsServiceV3.validationResponse(validation);
    }

    await this.#transactionsServiceV3.confirmClaimUnstakedDraft({ draft });
    draft = this.#transactionsServiceV3.withFees({ draft, fees });
    await this.#transactionsServiceV3.submitTransactionDraft({ draft });

    return this.#transactionsServiceV3.validationResponse(
      this.#transactionsServiceV3.validationSuccess(),
    );
  }

  /**
   * Claims accrued voting/staking rewards.
   *
   * @param request - The JSON-RPC request containing the account and asset details.
   * @returns The result indicating success or failure with errors.
   */
  async #handleClaimTrxStakingRewards(request: JsonRpcRequest): Promise<Json> {
    assertOrThrow(
      request,
      ClaimTrxStakingRewardsRequestStruct,
      new InvalidParamsError(),
    );

    const { fromAccountId, assetId } = request.params;
    let draft =
      await this.#transactionsServiceV3.prepareClaimRewardsTransactions({
        accountId: fromAccountId,
        assetId,
      });
    const fees =
      await this.#transactionsServiceV3.estimateTransactionFees(draft);
    const validation = this.#transactionsServiceV3.validateTransactionDraft({
      draft,
      fees,
    });

    if (!validation.valid) {
      return this.#transactionsServiceV3.validationResponse(validation);
    }

    draft = this.#transactionsServiceV3.withFees({ draft, fees });
    await this.#transactionsServiceV3.submitTransactionDraft({ draft });

    return this.#transactionsServiceV3.validationResponse(
      this.#transactionsServiceV3.validationSuccess(),
    );
  }

  /**
   * Handles signing a rewards message without confirmation.
   *
   * @param request - The JSON-RPC request containing the message to sign.
   * @returns The signature, signed message, and signature type.
   */
  async #handleSignRewardsMessage(request: JsonRpcRequest): Promise<Json> {
    assertOrThrow(
      request,
      SignRewardsMessageRequestStruct,
      new InvalidParamsError(),
    );

    const {
      params: { accountId, message },
    } = request;

    try {
      return await this.#transactionsServiceV3.signRewardsMessage({
        accountId,
        message,
      });
    } catch (error) {
      if (error instanceof Error) {
        throw new InvalidParamsError(error.message) as Error;
      }
      throw error;
    }
  }
}
