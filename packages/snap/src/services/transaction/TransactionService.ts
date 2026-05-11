import { BigNumber } from 'bignumber.js';

import type { RawTransactionParser } from './RawTransactionParser';
import type { TransactionBroadcaster } from './TransactionBroadcaster';
import type { TransactionFeeEstimator } from './TransactionFeeEstimator';
import type {
  BroadcastManyTransactionsParams,
  BroadcastTransactionParams,
  BroadcastTransactionResult,
  ComputeFeeResult,
  EstimateTransactionFeeParams,
  EstimateTransactionFeesParams,
  PrepareRawTransactionParams,
  PreparedTransaction,
} from './types';
import type { SnapClient } from '../../clients/snap/SnapClient';
import { Networks, ZERO } from '../../constants';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import { BackgroundEventMethod } from '../../handlers/cronjob';
import {
  assertTransactionOwnerAddress,
  assertTransactionStructure,
} from '../../validation/transaction';
import type { AccountsService } from '../accounts/AccountsService';
import type { AssetsService } from '../assets/AssetsService';

type AvailableResources = {
  availableBandwidth: BigNumber;
  availableEnergy: BigNumber;
};

export class TransactionService {
  readonly #rawTransactionParser: RawTransactionParser;

  readonly #transactionFeeEstimator: TransactionFeeEstimator;

  readonly #transactionBroadcaster: TransactionBroadcaster;

  readonly #accountsService: AccountsService;

  readonly #assetsService: AssetsService;

  readonly #snapClient: SnapClient;

  constructor({
    rawTransactionParser,
    transactionFeeEstimator,
    transactionBroadcaster,
    accountsService,
    assetsService,
    snapClient,
  }: {
    rawTransactionParser: RawTransactionParser;
    transactionFeeEstimator: TransactionFeeEstimator;
    transactionBroadcaster: TransactionBroadcaster;
    accountsService: AccountsService;
    assetsService: AssetsService;
    snapClient: SnapClient;
  }) {
    this.#rawTransactionParser = rawTransactionParser;
    this.#transactionFeeEstimator = transactionFeeEstimator;
    this.#transactionBroadcaster = transactionBroadcaster;
    this.#accountsService = accountsService;
    this.#assetsService = assetsService;
    this.#snapClient = snapClient;
  }

  async prepareRawTransaction(
    params: PrepareRawTransactionParams,
  ): Promise<PreparedTransaction> {
    return this.#rawTransactionParser.prepareRawTransaction(params);
  }

  async estimateFee({
    scope,
    accountId,
    transaction,
    feeLimit,
  }: EstimateTransactionFeeParams): Promise<ComputeFeeResult> {
    const account = await this.#accountsService.findByIdOrThrow(accountId);
    this.#assertTransactionBelongsToAccount(transaction.raw_data, account);

    const { availableBandwidth, availableEnergy } =
      await this.#getAvailableResources(scope, accountId);

    return this.#transactionFeeEstimator.computeFee({
      scope,
      transaction,
      availableBandwidth,
      availableEnergy,
      feeLimit,
    });
  }

  async estimateFees({
    scope,
    accountId,
    transactions,
    feeLimit,
  }: EstimateTransactionFeesParams): Promise<ComputeFeeResult[]> {
    const account = await this.#accountsService.findByIdOrThrow(accountId);
    for (const transaction of transactions) {
      this.#assertTransactionBelongsToAccount(transaction.raw_data, account);
    }

    let { availableBandwidth, availableEnergy } =
      await this.#getAvailableResources(scope, accountId);

    const feeResults: ComputeFeeResult[] = [];
    for (const transaction of transactions) {
      const fees = await this.#transactionFeeEstimator.computeFee({
        scope,
        transaction,
        availableBandwidth,
        availableEnergy,
        feeLimit,
      });

      feeResults.push(fees);
      availableBandwidth = this.#subtractResourceFee({
        available: availableBandwidth,
        fees,
        assetType: Networks[scope].bandwidth.id,
      });
      availableEnergy = this.#subtractResourceFee({
        available: availableEnergy,
        fees,
        assetType: Networks[scope].energy.id,
      });
    }

    return feeResults;
  }

  async broadcast(
    params: BroadcastTransactionParams,
  ): Promise<BroadcastTransactionResult> {
    return this.#transactionBroadcaster.broadcast(params);
  }

  async broadcastMany({
    scope,
    accountId,
    transactions,
    tracking,
  }: BroadcastManyTransactionsParams): Promise<BroadcastTransactionResult[]> {
    const shouldScheduleAccountSync = tracking?.type === 'accountSync';
    const results: BroadcastTransactionResult[] = [];
    let broadcastError: unknown;

    try {
      for (const transaction of transactions) {
        const result = await this.#transactionBroadcaster.broadcast({
          scope,
          accountId,
          transaction,
          tracking: shouldScheduleAccountSync ? { type: 'none' } : tracking,
        });
        results.push(result);
      }
    } catch (error) {
      broadcastError = error;
    }

    if (shouldScheduleAccountSync && results.length > 0) {
      try {
        await this.#scheduleAccountSync(accountId);
      } catch (scheduleError) {
        if (!broadcastError) {
          throw scheduleError;
        }
      }
    }

    if (broadcastError) {
      if (broadcastError instanceof Error) {
        throw broadcastError;
      }
      throw new Error('Transaction broadcast failed');
    }

    return results;
  }

  async #getAvailableResources(
    scope: EstimateTransactionFeeParams['scope'],
    accountId: string,
  ): Promise<AvailableResources> {
    const [bandwidthAsset, energyAsset] =
      await this.#assetsService.getAssetsByAccountId(accountId, [
        Networks[scope].bandwidth.id,
        Networks[scope].energy.id,
      ]);

    return {
      availableBandwidth: BigNumber(bandwidthAsset?.rawAmount ?? 0),
      availableEnergy: BigNumber(energyAsset?.rawAmount ?? 0),
    };
  }

  #assertTransactionBelongsToAccount(
    rawData: Parameters<typeof assertTransactionStructure>[0],
    account: TronKeyringAccount,
  ): void {
    assertTransactionStructure(rawData);
    assertTransactionOwnerAddress(rawData, account.address);
  }

  #subtractResourceFee({
    available,
    fees,
    assetType,
  }: {
    available: BigNumber;
    fees: ComputeFeeResult;
    assetType: string;
  }): BigNumber {
    const consumed = fees
      .filter((fee) => fee.asset.type === assetType)
      .reduce((sum, fee) => sum.plus(fee.asset.amount), ZERO);
    const remaining = available.minus(consumed);

    return remaining.isGreaterThan(ZERO) ? remaining : ZERO;
  }

  async #scheduleAccountSync(accountId: string): Promise<void> {
    await this.#snapClient.scheduleBackgroundEvent({
      method: BackgroundEventMethod.SynchronizeAccount,
      params: { accountId },
      duration: 'PT5S',
    });
  }
}
