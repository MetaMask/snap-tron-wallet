import { TransactionStatus } from '@metamask/keyring-api';
import type { Json, JsonRpcRequest } from '@metamask/snaps-sdk';
import {
  InvalidParamsError,
  MethodNotFoundError,
  UserRejectedRequestError,
} from '@metamask/snaps-sdk';
import { assert } from '@metamask/superstruct';
import { parseCaipAssetType } from '@metamask/utils';
import { BigNumber } from 'bignumber.js';

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
  parseRewardsMessage,
  SignAndSendTransactionRequestStruct,
  SignRewardsMessageRequestStruct,
} from './validation';
import type { SnapClient } from '../../clients/snap/SnapClient';
import type { TronWebFactory } from '../../clients/tronweb/TronWebFactory';
import { FEE_LIMIT, Network, Networks, ZERO } from '../../constants';
import type { AccountsService } from '../../services/accounts/AccountsService';
import type { AssetsService } from '../../services/assets/AssetsService';
import type {
  NativeCaipAssetType,
  StakedCaipAssetType,
} from '../../services/assets/types';
import type { ConfirmationHandler } from '../../services/confirmation/ConfirmationHandler';
import type { SendService } from '../../services/send/SendService';
import type { StakingService } from '../../services/staking/StakingService';
import type { TransactionService } from '../../services/transaction';
import type { TransactionHistoryService } from '../../services/transaction-history/TransactionHistoryService';
import { TransactionMapper } from '../../services/transaction-history/TransactionMapper';
import { assertOrThrow } from '../../utils/assertOrThrow';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';

export class ClientRequestHandler {
  readonly #logger: ILogger;

  readonly #accountsService: AccountsService;

  readonly #assetsService: AssetsService;

  readonly #sendService: SendService;

  readonly #tronWebFactory: TronWebFactory;

  readonly #transactionService: TransactionService;

  readonly #stakingService: StakingService;

  readonly #confirmationHandler: ConfirmationHandler;

  readonly #transactionsService: TransactionHistoryService;

  constructor({
    logger,
    accountsService,
    assetsService,
    sendService,
    transactionService,
    tronWebFactory,
    snapClient: _snapClient,
    stakingService,
    confirmationHandler,
    transactionsService,
  }: {
    logger: ILogger;
    accountsService: AccountsService;
    assetsService: AssetsService;
    sendService: SendService;
    transactionService: TransactionService;
    tronWebFactory: TronWebFactory;
    snapClient: SnapClient;
    stakingService: StakingService;
    confirmationHandler: ConfirmationHandler;
    transactionsService: TransactionHistoryService;
  }) {
    this.#logger = createPrefixedLogger(logger, '[👋 ClientRequestHandler]');
    this.#accountsService = accountsService;
    this.#assetsService = assetsService;
    this.#sendService = sendService;
    this.#transactionService = transactionService;
    this.#tronWebFactory = tronWebFactory;
    this.#stakingService = stakingService;
    this.#confirmationHandler = confirmationHandler;
    this.#transactionsService = transactionsService;
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

    const account = await this.#accountsService.findByIdOrThrow(accountId);
    const { transaction, rawData } =
      await this.#transactionService.prepareRawTransaction({
        scope,
        account,
        transactionBase64,
        type,
      });

    await this.#transactionService.estimateFee({
      scope,
      accountId,
      transaction,
      feeLimit:
        typeof rawData.fee_limit === 'number' ? rawData.fee_limit : undefined,
    });

    const result = await this.#transactionService.broadcast({
      scope,
      accountId,
      transaction,
      tracking: { type: 'transaction', origin: 'MetaMask' },
    });

    // Immediately create and save a minimal pending transaction
    // This shows the transaction to the user right away
    const pendingTransaction = TransactionMapper.createPendingTransaction({
      txId: result.txid,
      account,
      scope,
    });

    await this.#transactionsService.save(pendingTransaction);

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

      const account = await this.#accountsService.findById(accountId);

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
      const { chainId } = parseCaipAssetType(assetId);
      const scope = chainId as Network;

      const [asset, nativeTokenAsset] =
        await this.#assetsService.getAssetsByAccountId(accountId, [
          assetId,
          Networks[scope].nativeToken.id,
        ]);

      const valueBN = new BigNumber(value);
      const assetToSendBalance = asset ? new BigNumber(asset.uiAmount) : ZERO;
      const nativeTokenBalance = nativeTokenAsset
        ? new BigNumber(nativeTokenAsset.uiAmount)
        : ZERO;

      if (!asset || valueBN.isGreaterThan(assetToSendBalance)) {
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
      const sendTransaction = await this.#sendService.buildTransaction({
        fromAccountId: accountId,
        toAddress,
        asset,
        amount: valueBN,
        feeLimit: FEE_LIMIT,
      });
      const fees = await this.#transactionService.estimateFee({
        scope,
        accountId,
        transaction: sendTransaction,
        feeLimit: FEE_LIMIT,
      });

      /**
       * The fee calculation already takes into account the energy and bandwidth consumption,
       * so we only need to make sure we have enough TRX to cover overages.
       */
      const nativeTokenId = Networks[scope].nativeToken.id;
      const trxFee = new BigNumber(
        fees.find((fee) => fee.asset.type === nativeTokenId)?.asset.amount ??
          '0',
      );

      /**
       * Don't forget that we can also be sending TRX so we must add the fees to the amount that will be
       * sent.
       */
      const totalTrxToSpend =
        // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
        assetId === nativeTokenId ? valueBN.plus(trxFee) : trxFee;

      if (totalTrxToSpend.isGreaterThan(nativeTokenBalance)) {
        return {
          valid: false,
          errors: [{ code: SendErrorCodes.InsufficientBalanceToCoverFee }],
        };
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

    const account = await this.#accountsService.findById(fromAccountId);

    if (!account) {
      return {
        valid: false,
        errors: [{ code: SendErrorCodes.Invalid }],
      };
    }

    const asset = await this.#assetsService.getAssetByAccountId(
      fromAccountId,
      assetId,
    );

    if (!asset) {
      return {
        valid: false,
        errors: [{ code: SendErrorCodes.InsufficientBalance }],
      };
    }

    const { chainId } = parseCaipAssetType(assetId);
    const scope = chainId as Network;

    const amountBN = new BigNumber(amount);

    /**
     * Validate that the user has enough funds to cover both the amount
     * and all associated fees (including account activation if applicable).
     * This prevents users from confirming sends that we know will fail.
     */
    const validation = await this.#sendService.validateSend({
      scope,
      fromAccountId,
      toAddress,
      asset,
      amount: amountBN,
      feeLimit: FEE_LIMIT,
    });

    if (!validation.valid) {
      return {
        valid: false,
        errors: [
          { code: validation.errorCode ?? SendErrorCodes.InsufficientBalance },
        ],
      };
    }

    const transaction = await this.#sendService.buildTransaction({
      fromAccountId,
      toAddress,
      asset,
      amount: amountBN,
      feeLimit: FEE_LIMIT,
    });

    const fees = await this.#transactionService.estimateFee({
      scope,
      accountId: fromAccountId,
      transaction,
      feeLimit: FEE_LIMIT,
    });

    /**
     * Show the confirmation UI.
     * Origin is 'MetaMask' because client requests come from MetaMask's own unified send flow.
     */
    const confirmed = await this.#confirmationHandler.confirmTransactionRequest(
      {
        scope,
        fromAddress: account.address,
        toAddress,
        amount,
        fees,
        asset,
        accountType: account.type,
        origin: 'MetaMask',
        transactionRawData: transaction.raw_data,
      },
    );

    if (!confirmed) {
      throw new UserRejectedRequestError() as unknown as Error;
    }

    /**
     * Send the built transaction
     */
    const result = await this.#transactionService.broadcast({
      scope,
      accountId: fromAccountId,
      transaction,
      tracking: { type: 'transaction', origin: 'MetaMask' },
    });

    // Immediately create and save a detailed pending Send transaction
    // This shows the transaction to the user right away with all details
    const pendingTransaction = TransactionMapper.createPendingSendTransaction({
      txId: result.txid,
      account,
      scope,
      toAddress,
      amount,
      assetType: assetId,
      assetSymbol: asset.symbol,
    });

    await this.#transactionsService.save(pendingTransaction);

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

    const account = await this.#accountsService.findByIdOrThrow(accountId);
    const { transaction, rawData } =
      await this.#transactionService.prepareRawTransaction({
        scope,
        account,
        transactionBase64,
        type,
        feeLimit,
      });

    const result = await this.#transactionService.estimateFee({
      scope,
      accountId,
      transaction,
      feeLimit:
        typeof rawData.fee_limit === 'number' ? rawData.fee_limit : undefined,
    });

    assert(result, ComputeFeeResponseStruct);

    return result;
  }

  /**
   * Computes a fee preview for a staking transaction.
   * It builds a freezeBalanceV2 and vote transaction on the fly and uses the
   * TransactionService to estimate resource usage and TRX cost across both.
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

    const account = await this.#accountsService.findByIdOrThrow(fromAccountId);

    const scope = Network.Mainnet;
    const assetId = Networks[scope].nativeToken.id as NativeCaipAssetType;

    const asset = await this.#assetsService.getAssetByAccountId(
      fromAccountId,
      assetId,
    );

    const accountBalance = asset ? new BigNumber(asset.uiAmount) : ZERO;
    const requestBalance = BigNumber(value);

    /**
     * Check if account has enough of the asset for staking.
     */
    if (requestBalance.isGreaterThan(accountBalance)) {
      return {
        valid: false,
        errors: [SendErrorCodes.InsufficientBalance],
      };
    }

    const result = await this.#stakingService.estimateStakeFee({
      account,
      assetId,
      amount: requestBalance,
      purpose,
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

    await this.#accountsService.findByIdOrThrow(accountId);
    const asset = await this.#assetsService.getAssetByAccountId(
      accountId,
      assetId,
    );

    /**
     * If the account doesn't have this asset, treat it as having zero balance
     */
    const accountBalance = asset ? new BigNumber(asset.uiAmount) : ZERO;
    const requestBalance = new BigNumber(value);

    if (requestBalance.isGreaterThan(accountBalance)) {
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

    const account = await this.#accountsService.findByIdOrThrow(fromAccountId);

    const asset = await this.#assetsService.getAssetByAccountId(
      fromAccountId,
      assetId,
    );

    const accountBalance = asset ? new BigNumber(asset.uiAmount) : ZERO;
    const requestBalance = new BigNumber(value);
    /**
     * Check if account has enough of the asset...
     */
    if (requestBalance.isGreaterThan(accountBalance)) {
      return {
        valid: false,
        errors: [{ code: SendErrorCodes.InsufficientBalance }],
      };
    }

    /**
     * All good. Let's stake.
     */
    await this.#stakingService.stake({
      account,
      assetId: assetId as NativeCaipAssetType,
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
    const stakedAssetId = `${assetId}-staked-for-${purpose.toLowerCase()}`;

    await this.#accountsService.findByIdOrThrow(accountId);
    const asset = await this.#assetsService.getAssetByAccountId(
      accountId,
      stakedAssetId,
    );

    const accountBalance = asset ? new BigNumber(asset.uiAmount) : ZERO;
    const requestBalance = new BigNumber(value);

    /**
     * Check if account has enough of the asset...
     */
    if (requestBalance.isGreaterThan(accountBalance)) {
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
    const stakedAssetId =
      `${assetId}-staked-for-${purpose.toLowerCase()}` as StakedCaipAssetType;

    const account = await this.#accountsService.findByIdOrThrow(accountId);

    const asset = await this.#assetsService.getAssetByAccountId(
      accountId,
      stakedAssetId,
    );

    const accountBalance = asset ? new BigNumber(asset.uiAmount) : ZERO;
    const requestBalance = new BigNumber(value);

    /**
     * Check if account has enough of the asset...
     */
    if (requestBalance.isGreaterThan(accountBalance)) {
      return {
        valid: false,
        errors: [{ code: SendErrorCodes.InsufficientBalance }],
      };
    }

    /**
     * All good. Let's unstake.
     */
    await this.#stakingService.unstake({
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

    const account = await this.#accountsService.findByIdOrThrow(fromAccountId);

    const { chainId } = parseCaipAssetType(assetId);
    const scope = chainId as Network;
    const transactions =
      await this.#stakingService.buildClaimUnstakedTrxTransactions({
        account,
        scope,
      });
    const [fees = []] = await this.#transactionService.estimateFees({
      scope,
      accountId: account.id,
      transactions,
    });

    const confirmed = await this.#confirmationHandler.confirmClaimUnstakedTrx({
      account,
      scope,
      fees,
    });

    if (!confirmed) {
      throw new UserRejectedRequestError() as Error;
    }

    await this.#transactionService.broadcastMany({
      scope,
      accountId: account.id,
      transactions,
      tracking: { type: 'accountSync' },
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

    const account = await this.#accountsService.findByIdOrThrow(fromAccountId);

    const { chainId } = parseCaipAssetType(assetId);
    const scope = chainId as Network;
    const transactions =
      await this.#stakingService.buildClaimTrxStakingRewardsTransactions({
        account,
        scope,
      });

    await this.#transactionService.broadcastMany({
      scope,
      accountId: account.id,
      transactions,
      tracking: { type: 'accountSync' },
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

    const account = await this.#accountsService.findById(accountId);
    if (!account) {
      throw new InvalidParamsError(`Account not found: ${accountId}`) as Error;
    }

    // Parse the rewards message to extract the address
    const { address: messageAddress } = parseRewardsMessage(message);

    // Validate that the address in the message matches the signing account
    if (messageAddress !== account.address) {
      throw new InvalidParamsError(
        `Address in rewards message (${messageAddress}) does not match signing account address (${account.address})`,
      ) as Error;
    }

    // Derive the private key for signing
    const { privateKeyHex } = await this.#accountsService.deriveTronKeypair({
      entropySource: account.entropySource,
      derivationPath: account.derivationPath,
    });

    // Create a TronWeb instance for message signing
    // We can use any network scope since we're just signing a message
    const tronWeb = this.#tronWebFactory.createClient(
      Network.Mainnet,
      privateKeyHex,
    );

    // Decode the base64 message to get the raw message
    // eslint-disable-next-line no-restricted-globals
    const decodedMessage = Buffer.from(message, 'base64').toString('utf8');

    // Sign the message using TronWeb's signMessageV2
    const signature = tronWeb.trx.signMessageV2(decodedMessage, privateKeyHex);

    return {
      signature,
      signedMessage: message,
      signatureType: 'secp256k1',
    };
  }
}
