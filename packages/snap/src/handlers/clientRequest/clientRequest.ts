import { TransactionStatus } from '@metamask/keyring-api';
import type { Json, JsonRpcRequest } from '@metamask/snaps-sdk';
import {
  InvalidParamsError,
  MethodNotFoundError,
  UserRejectedRequestError,
} from '@metamask/snaps-sdk';
import { assert } from '@metamask/superstruct';

import { ClientRequestMethod, SendErrorCodes } from './types';
import {
  ClaimTrxStakingRewardsRequestStruct,
  ClaimUnstakedTrxRequestStruct,
  ComputeFeeRequestStruct,
  ComputeFeeResponseStruct,
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
import type { TransactionsService } from '../../services/transactions/TransactionsService';
import { TransactionsServiceV2 } from '../../services/transactions/TransactionsServiceV2';
import { assertOrThrow } from '../../utils/assertOrThrow';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';

export class ClientRequestHandler {
  readonly #logger: ILogger;

  readonly #transactionsServiceV2: TransactionsServiceV2;

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

    const account =
      await this.#transactionsServiceV2.findAccountOrThrow(accountId);
    const transaction =
      await this.#transactionsServiceV2.deserializeTransaction({
        scope,
        transactionBase64,
        type,
      });

    const signedTx = await this.#transactionsServiceV2.signTransaction({
      scope,
      account,
      transaction,
    });
    const result = await this.#transactionsServiceV2.broadcastTransaction({
      scope,
      signedTransaction: signedTx,
    });

    await this.#transactionsServiceV2.savePendingTransaction({
      txId: result.txid,
      account,
      scope,
    });

    await this.#transactionsServiceV2.scheduleTransactionTracking({
      txId: result.txid,
      scope,
      accountId,
    });

    return {
      transactionId: result.txid,
    };
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

      const account = await this.#transactionsServiceV2.findAccount(accountId);

      /**
       * Check if the account we want to send from exists...
       */
      if (!account) {
        return {
          valid: false,
          errors: [{ code: SendErrorCodes.Required }],
        };
      }

      /**
       * Check if we have enough of the asset we want to send...
       */
      const scope = this.#transactionsServiceV2.getScopeFromAssetId(assetId);
      const { asset, nativeTokenAsset, bandwidthAsset, energyAsset } =
        await this.#transactionsServiceV2.getSendValidationAssets({
          accountId,
          assetId,
          scope,
        });

      const valueBN = this.#transactionsServiceV2.getAmount(value);
      const assetToSendBalance = this.#transactionsServiceV2.getBalance(asset);

      if (
        !asset ||
        !this.#transactionsServiceV2.hasEnoughBalance({
          amount: valueBN,
          balance: assetToSendBalance,
        })
      ) {
        return {
          valid: false,
          errors: [{ code: SendErrorCodes.InsufficientBalance }],
        };
      }

      if (!toAddress) {
        return {
          valid: true,
          errors: [],
        };
      }

      /**
       * Estimate the fees
       */
      const sendTransaction =
        await this.#transactionsServiceV2.buildSendTransaction({
          fromAccountId: accountId,
          toAddress,
          asset,
          amount: valueBN,
          feeLimit: FEE_LIMIT,
        });
      const { availableEnergy, availableBandwidth } =
        this.#transactionsServiceV2.getAvailableResources({
          bandwidthAsset,
          energyAsset,
        });
      const fees = await this.#transactionsServiceV2.estimateFeeWithResources({
        scope,
        transaction: sendTransaction,
        availableEnergy,
        availableBandwidth,
        feeLimit: FEE_LIMIT,
      });
      const feeValidation = this.#transactionsServiceV2.validateFeeBalance({
        scope,
        assetId,
        amount: valueBN,
        fees,
        nativeTokenBalance:
          this.#transactionsServiceV2.getBalance(nativeTokenAsset),
      });

      if (!feeValidation.valid) {
        return feeValidation;
      }

      return {
        valid: true,
        errors: [],
      };
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

    const account =
      await this.#transactionsServiceV2.findAccount(fromAccountId);

    if (!account) {
      return {
        valid: false,
        errors: [{ code: SendErrorCodes.Invalid }],
      };
    }

    const asset = await this.#transactionsServiceV2.findAsset({
      accountId: fromAccountId,
      assetId,
    });

    if (!asset) {
      return {
        valid: false,
        errors: [{ code: SendErrorCodes.InsufficientBalance }],
      };
    }

    const scope = this.#transactionsServiceV2.getScopeFromAssetId(assetId);

    const amountBN = this.#transactionsServiceV2.getAmount(amount);

    /**
     * Validate that the user has enough funds to cover both the amount
     * and all associated fees (including account activation if applicable).
     * This prevents users from confirming sends that we know will fail.
     */
    const validation =
      await this.#transactionsServiceV2.validateSendFeasibility({
        scope,
        fromAccountId,
        toAddress,
        asset,
        amount: amountBN,
        feeLimit: FEE_LIMIT,
      });

    if (!validation.valid) {
      return validation;
    }

    const [resources, transaction] = await Promise.all([
      /**
       * Get available Energy and Bandwidth from account assets.
       */
      this.#transactionsServiceV2.getAvailableAccountResources({
        accountId: fromAccountId,
        scope,
      }),
      /**
       * Build the unsigned transaction.
       * Fee estimation uses a constant overhead for the signature (134 bytes).
       * Signing happens after user confirmation in sendTransaction().
       */
      this.#transactionsServiceV2.buildSendTransaction({
        fromAccountId,
        toAddress,
        asset,
        amount: amountBN,
        feeLimit: FEE_LIMIT,
      }),
    ]);

    const fees = await this.#transactionsServiceV2.estimateFeeWithResources({
      scope,
      transaction,
      availableEnergy: resources.availableEnergy,
      availableBandwidth: resources.availableBandwidth,
      feeLimit: FEE_LIMIT,
    });

    /**
     * Show the confirmation UI.
     * Origin is 'MetaMask' because client requests come from MetaMask's own unified send flow.
     */
    const confirmed = await this.#transactionsServiceV2.confirmSendTransaction({
      scope,
      account,
      toAddress,
      amount,
      fees,
      asset,
      transaction,
    });

    if (!confirmed) {
      throw new UserRejectedRequestError() as unknown as Error;
    }

    /**
     * Send the built transaction
     */
    const result =
      await this.#transactionsServiceV2.signAndBroadcastSendTransaction({
        scope,
        fromAccountId,
        transaction,
      });

    await this.#transactionsServiceV2.savePendingSendTransaction({
      txId: result.txid,
      account,
      scope,
      toAddress,
      amount,
      asset,
    });

    this.#logger.log(
      `Created pending Send transaction ${result.txid} for account ${account.id}`,
    );

    return {
      transactionId: result.txid,
      status: TransactionStatus.Submitted,
    };
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

    await this.#transactionsServiceV2.findAccountOrThrow(accountId);

    const transaction =
      await this.#transactionsServiceV2.deserializeTransaction({
        scope,
        transactionBase64,
        type,
        feeLimit,
      });

    const result = await this.#transactionsServiceV2.estimateFee({
      scope,
      accountId,
      transaction,
      feeLimit: transaction.raw_data.fee_limit,
    });

    assert(result, ComputeFeeResponseStruct);

    return result;
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

    const account =
      await this.#transactionsServiceV2.findAccountOrThrow(fromAccountId);

    const scope = Network.Mainnet;

    const asset = await this.#transactionsServiceV2.findAsset({
      accountId: fromAccountId,
      assetId: Networks[scope].nativeToken.id,
    });

    const accountBalance = this.#transactionsServiceV2.getBalance(asset);
    const requestBalance = this.#transactionsServiceV2.getAmount(value);

    /**
     * Check if account has enough of the asset for staking.
     */
    if (requestBalance.isGreaterThan(accountBalance)) {
      return {
        valid: false,
        errors: [SendErrorCodes.InsufficientBalance],
      };
    }

    const transaction = await this.#transactionsServiceV2.buildStakeTransaction(
      {
        account,
        scope,
        amount: requestBalance,
        purpose,
      },
    );

    const result = await this.#transactionsServiceV2.estimateFee({
      scope,
      accountId: fromAccountId,
      transaction,
    });

    assert(result, ComputeFeeResponseStruct);

    return result;
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

    await this.#transactionsServiceV2.findAccountOrThrow(accountId);
    const asset = await this.#transactionsServiceV2.findAsset({
      accountId,
      assetId,
    });

    /**
     * If the account doesn't have this asset, treat it as having zero balance
     */
    const accountBalance = this.#transactionsServiceV2.getBalance(asset);
    const requestBalance = this.#transactionsServiceV2.getAmount(value);

    if (
      !this.#transactionsServiceV2.hasEnoughBalance({
        amount: requestBalance,
        balance: accountBalance,
      })
    ) {
      return {
        valid: false,
        errors: [{ code: SendErrorCodes.InsufficientBalance }],
      };
    }

    return {
      valid: true,
      errors: [],
    };
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

    const account =
      await this.#transactionsServiceV2.findAccountOrThrow(fromAccountId);

    const asset = await this.#transactionsServiceV2.findAsset({
      accountId: fromAccountId,
      assetId,
    });

    const accountBalance = this.#transactionsServiceV2.getBalance(asset);
    const requestBalance = this.#transactionsServiceV2.getAmount(value);
    /**
     * Check if account has enough of the asset...
     */
    if (
      !this.#transactionsServiceV2.hasEnoughBalance({
        amount: requestBalance,
        balance: accountBalance,
      })
    ) {
      return {
        valid: false,
        errors: [{ code: SendErrorCodes.InsufficientBalance }],
      };
    }

    /**
     * All good. Let's stake.
     */
    await this.#transactionsServiceV2.executeStake({
      account,
      assetId,
      amount: requestBalance,
      purpose,
      srNodeAddress,
    });

    return {
      valid: true,
      errors: [],
    };
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

    /**
     * We convert the `slip44:195` to `slip44:195-staked-for-bandwidth` or `slip44:195-staked-for-energy`
     * depending on the purpose.
     */
    const stakedAssetId = this.#transactionsServiceV2.toStakedAssetId({
      assetId,
      purpose,
    });

    await this.#transactionsServiceV2.findAccountOrThrow(accountId);
    const asset = await this.#transactionsServiceV2.findAsset({
      accountId,
      assetId: stakedAssetId,
    });

    const accountBalance = this.#transactionsServiceV2.getBalance(asset);
    const requestBalance = this.#transactionsServiceV2.getAmount(value);

    /**
     * Check if account has enough of the asset...
     */
    if (
      !this.#transactionsServiceV2.hasEnoughBalance({
        amount: requestBalance,
        balance: accountBalance,
      })
    ) {
      return {
        valid: false,
        errors: [{ code: SendErrorCodes.InsufficientBalance }],
      };
    }

    return {
      valid: true,
      errors: [],
    };
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

    /**
     * We convert the `slip44:195-staked-for-bandwidth` or `slip44:195-staked-for-energy` to `slip44:195`
     * depending on the purpose.
     */
    const stakedAssetId = this.#transactionsServiceV2.toStakedAssetId({
      assetId,
      purpose,
    });

    const account =
      await this.#transactionsServiceV2.findAccountOrThrow(accountId);

    const asset = await this.#transactionsServiceV2.findAsset({
      accountId,
      assetId: stakedAssetId,
    });

    const accountBalance = this.#transactionsServiceV2.getBalance(asset);
    const requestBalance = this.#transactionsServiceV2.getAmount(value);

    /**
     * Check if account has enough of the asset...
     */
    if (
      !this.#transactionsServiceV2.hasEnoughBalance({
        amount: requestBalance,
        balance: accountBalance,
      })
    ) {
      return {
        valid: false,
        errors: [{ code: SendErrorCodes.InsufficientBalance }],
      };
    }

    /**
     * All good. Let's unstake.
     */
    await this.#transactionsServiceV2.executeUnstake({
      account,
      assetId: stakedAssetId,
      amount: requestBalance,
    });

    return {
      valid: true,
      errors: [],
    };
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

    const account =
      await this.#transactionsServiceV2.findAccountOrThrow(fromAccountId);

    const scope = this.#transactionsServiceV2.getScopeFromAssetId(assetId);

    const confirmed = await this.#transactionsServiceV2.confirmClaimUnstakedTrx(
      {
        account,
        scope,
      },
    );

    if (!confirmed) {
      throw new UserRejectedRequestError() as Error;
    }

    await this.#transactionsServiceV2.executeClaimUnstakedTrx({
      account,
      scope,
    });

    return {
      valid: true,
      errors: [],
    };
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

    const account =
      await this.#transactionsServiceV2.findAccountOrThrow(fromAccountId);

    const scope = this.#transactionsServiceV2.getScopeFromAssetId(assetId);

    await this.#transactionsServiceV2.executeClaimTrxStakingRewards({
      account,
      scope,
    });

    return {
      valid: true,
      errors: [],
    };
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
      return await this.#transactionsServiceV2.signRewardsMessage({
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
