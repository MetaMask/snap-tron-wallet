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
} from './validation';
import type { SnapClient } from '../../clients/snap/SnapClient';
import type { TronWebFactory } from '../../clients/tronweb/TronWebFactory';
import { FEE_LIMIT, Network, Networks } from '../../constants';
import type { AccountsService } from '../../services/accounts/AccountsService';
import type { AssetsService } from '../../services/assets/AssetsService';
import type { ConfirmationHandler } from '../../services/confirmation/ConfirmationHandler';
import type { FeeCalculatorService } from '../../services/send/FeeCalculatorService';
import type { SendService } from '../../services/send/SendService';
import type { StakingService } from '../../services/staking/StakingService';
import { TransactionPipeline } from '../../services/transactions/pipeline/TransactionPipeline';
import { TransactionPipelineSteps } from '../../services/transactions/pipeline/TransactionPipelineSteps';
import type { TransactionsService } from '../../services/transactions/TransactionsService';
import { TransactionsServiceV2 } from '../../services/transactions/TransactionsServiceV2';
import { assertOrThrow } from '../../utils/assertOrThrow';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';

export class ClientRequestHandler {
  readonly #logger: ILogger;

  readonly #transactionsServiceV2: TransactionsServiceV2;

  readonly #transactionPipeline: TransactionPipeline;

  readonly #transactionSteps: TransactionPipelineSteps;

  constructor({
    logger,
    accountsService,
    assetsService,
    sendService,
    feeCalculatorService,
    tronWebFactory,
    snapClient,
    stakingService,
    confirmationHandler,
    transactionsService,
    transactionsServiceV2,
    transactionPipeline,
    transactionSteps,
  }: {
    logger: ILogger;
    accountsService: AccountsService;
    assetsService: AssetsService;
    sendService: SendService;
    feeCalculatorService: FeeCalculatorService;
    tronWebFactory: TronWebFactory;
    snapClient: SnapClient;
    stakingService: StakingService;
    confirmationHandler: ConfirmationHandler;
    transactionsService: TransactionsService;
    transactionsServiceV2?: TransactionsServiceV2;
    transactionPipeline?: TransactionPipeline;
    transactionSteps?: TransactionPipelineSteps;
  }) {
    this.#logger = createPrefixedLogger(logger, '[👋 ClientRequestHandler]');
    this.#transactionsServiceV2 =
      transactionsServiceV2 ??
      new TransactionsServiceV2({
        logger,
        accountsService,
        assetsService,
        sendService,
        feeCalculatorService,
        tronWebFactory,
        snapClient,
        stakingService,
        confirmationHandler,
        transactionsService,
      });
    this.#transactionPipeline =
      transactionPipeline ?? new TransactionPipeline();
    this.#transactionSteps =
      transactionSteps ??
      new TransactionPipelineSteps({
        transactionsServiceV2: this.#transactionsServiceV2,
      });
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
   * The caller MUST:
   * - Display transaction details (recipient, amount, fees) to the user
   * - Obtain explicit user approval before calling this method
   * - Validate transaction authenticity and integrity
   *
   * Failure to implement caller-side consent will result in transactions being
   * signed and broadcast without user knowledge, creating a critical security
   * vulnerability.
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

    /**
     * Transaction here is in base64 format.
     */
    const {
      transaction: transactionBase64,
      accountId,
      scope,
      options: { type },
    } = request.params;

    return this.#transactionPipeline.execute({
      context: {
        accountId,
        scope,
        transactionBase64,
        transactionType: type,
        feeLimit: FEE_LIMIT,
      },
      steps: [
        this.#transactionSteps.deserializeTransaction(),
        this.#transactionSteps.estimateFee(),
        this.#transactionSteps.validateTransaction(),
        this.#transactionSteps.sign(),
        this.#transactionSteps.broadcast(),
        this.#transactionSteps.savePendingTransaction(),
        this.#transactionSteps.scheduleAccountSync(),
        this.#transactionSteps.returnTransactionId(),
      ],
    });
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
   * - Asset must exist in the account
   * - Asset amount must not be greater than the account balance
   * - If native TRX + full amount, we need bandwidth
   * -
   *
   * @param request - The JSON-RPC request containing amount and asset details.
   * @returns Validation result with balance and sufficiency status.
   */
  async #handleOnAmountInput(request: JsonRpcRequest): Promise<Json> {
    try {
      assert(request, OnAmountInputRequestStruct);

      const { accountId, assetId, value, toAddress } = request.params;

      return await this.#transactionPipeline.execute({
        context: {
          accountId,
          assetId,
          amountValue: value,
          toAddress,
          feeLimit: FEE_LIMIT,
        },
        steps: [
          this.#transactionSteps.buildSendTransaction({
            skipIfNoToAddress: true,
            missingAccountError: SendErrorCodes.Required,
          }),
          this.#transactionSteps.estimateFee(),
          this.#transactionSteps.validateTransaction(),
          this.#transactionSteps.returnValidationSuccess(),
        ],
      });
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

    return this.#transactionPipeline.execute({
      context: {
        accountId: fromAccountId,
        assetId,
        amountValue: amount,
        toAddress,
        feeLimit: FEE_LIMIT,
      },
      steps: [
        this.#transactionSteps.buildSendTransaction({
          validateSendFeasibility: true,
        }),
        this.#transactionSteps.estimateFee(),
        this.#transactionSteps.validateTransaction(),
        this.#transactionSteps.renderConfirmationUi(),
        this.#transactionSteps.sign(),
        this.#transactionSteps.broadcast(),
        this.#transactionSteps.savePendingTransaction(),
        this.#transactionSteps.scheduleAccountSync(),
        this.#transactionSteps.returnSubmittedTransaction(),
      ],
    });
  }

  /**
   * Handles the computation of a fee for a TRON transaction.
   * Returns used energy, used bandwidth, and the additional TRX cost breakdown for overages.
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

    return this.#transactionPipeline.execute({
      context: {
        accountId,
        scope,
        transactionBase64,
        transactionType: type,
        feeLimit,
      },
      steps: [
        this.#transactionSteps.deserializeTransaction(),
        this.#transactionSteps.estimateFee(),
        this.#transactionSteps.validateTransaction(),
        this.#transactionSteps.returnComputedFee(),
      ],
    });
  }

  /**
   * Computes a fee preview for a staking transaction.
   * It builds and signs a freezeBalanceV2 transaction on the fly and uses the
   * FeeCalculatorService to estimate resource usage and TRX cost.
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

    return this.#transactionPipeline.execute({
      context: {
        accountId: fromAccountId,
        assetId: Networks[scope].nativeToken.id,
        amountValue: value,
        scope,
        purpose,
      },
      steps: [
        this.#transactionSteps.buildStakeTransaction({ includeVote: false }),
        this.#transactionSteps.estimateFee(),
        this.#transactionSteps.validateTransaction(),
        this.#transactionSteps.returnComputedFee(),
      ],
    });
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

    return this.#transactionPipeline.execute({
      context: {
        accountId,
        assetId,
        amountValue: value,
      },
      steps: [
        this.#transactionSteps.buildStakeTransaction({ validateOnly: true }),
        this.#transactionSteps.validateTransaction(),
        this.#transactionSteps.returnValidationSuccess(),
      ],
    });
  }

  /**
   * Handles the confirmation of a stake. Checks if the user has enough of the asset
   * to do the stake and then stakes the asset.
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

    return this.#transactionPipeline.execute({
      context: {
        accountId: fromAccountId,
        assetId,
        amountValue: value,
        purpose,
        srNodeAddress,
      },
      steps: [
        this.#transactionSteps.buildStakeTransaction({ includeVote: true }),
        this.#transactionSteps.estimateFee(),
        this.#transactionSteps.validateTransaction(),
        this.#transactionSteps.sign(),
        this.#transactionSteps.broadcast(),
        this.#transactionSteps.savePendingTransaction(),
        this.#transactionSteps.scheduleAccountSync(),
        this.#transactionSteps.returnValidationSuccess(),
      ],
    });
  }

  /**
   * Check if we have enough of the asset to unstake. Keep in mind
   * that you can unstake TRX that is allocated for Bandwidth or for Energy.
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

    return this.#transactionPipeline.execute({
      context: {
        accountId,
        assetId,
        amountValue: value,
        purpose,
      },
      steps: [
        this.#transactionSteps.buildUnstakeTransaction({ validateOnly: true }),
        this.#transactionSteps.validateTransaction(),
        this.#transactionSteps.returnValidationSuccess(),
      ],
    });
  }

  /**
   * Handles the confirmation of an unstake. Checks if the user has enough of the asset
   * to do the unstake.
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

    return this.#transactionPipeline.execute({
      context: {
        accountId,
        assetId,
        amountValue: value,
        purpose,
      },
      steps: [
        this.#transactionSteps.buildUnstakeTransaction(),
        this.#transactionSteps.estimateFee(),
        this.#transactionSteps.validateTransaction(),
        this.#transactionSteps.sign(),
        this.#transactionSteps.broadcast(),
        this.#transactionSteps.savePendingTransaction(),
        this.#transactionSteps.scheduleAccountSync(),
        this.#transactionSteps.returnValidationSuccess(),
      ],
    });
  }

  /**
   * Claims TRX that has completed the 14-day unstaking lock period.
   * Uses the WithdrawExpireUnfreezeContract on the Tron network.
   *
   * Shows a confirmation dialog before signing and broadcasting.
   *
   * @param request - The JSON-RPC request containing the account and asset details.
   * @returns The result indicating success or failure with errors.
   * @throws {UserRejectedRequestError} If the user rejects the confirmation.
   */
  async #handleClaimUnstakedTrx(request: JsonRpcRequest): Promise<Json> {
    assertOrThrow(
      request,
      ClaimUnstakedTrxRequestStruct,
      new InvalidParamsError(),
    );

    const { fromAccountId, assetId } = request.params;

    return this.#transactionPipeline.execute({
      context: {
        accountId: fromAccountId,
        assetId,
      },
      steps: [
        this.#transactionSteps.buildClaimUnstakedTransaction(),
        this.#transactionSteps.estimateFee(),
        this.#transactionSteps.validateTransaction(),
        this.#transactionSteps.renderConfirmationUi(),
        this.#transactionSteps.sign(),
        this.#transactionSteps.broadcast(),
        this.#transactionSteps.savePendingTransaction(),
        this.#transactionSteps.scheduleAccountSync(),
        this.#transactionSteps.returnValidationSuccess(),
      ],
    });
  }

  /**
   * Claims accrued voting/staking rewards.
   * Uses the WithdrawBalanceContract on the Tron network.
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

    return this.#transactionPipeline.execute({
      context: {
        accountId: fromAccountId,
        assetId,
      },
      steps: [
        this.#transactionSteps.buildClaimRewardsTransaction(),
        this.#transactionSteps.estimateFee(),
        this.#transactionSteps.validateTransaction(),
        this.#transactionSteps.sign(),
        this.#transactionSteps.broadcast(),
        this.#transactionSteps.savePendingTransaction(),
        this.#transactionSteps.scheduleAccountSync(),
        this.#transactionSteps.returnValidationSuccess(),
      ],
    });
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
      return await this.#transactionPipeline.execute({
        context: { accountId, message },
        steps: [
          this.#transactionSteps.signRewardsMessage(),
          this.#transactionSteps.returnSignedRewardsMessage(),
        ],
      });
    } catch (error) {
      if (error instanceof Error) {
        throw new InvalidParamsError(error.message) as Error;
      }
      throw error;
    }
  }
}
