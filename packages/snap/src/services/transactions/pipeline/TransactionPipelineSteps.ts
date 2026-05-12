import { TransactionStatus } from '@metamask/keyring-api';
import type { Json } from '@metamask/snaps-sdk';
import { UserRejectedRequestError } from '@metamask/snaps-sdk';
import { assert } from '@metamask/superstruct';
import { BigNumber } from 'bignumber.js';

import type {
  BroadcastResult,
  PipelineTransaction,
  TransactionPipelineContext,
  TransactionPipelineStep,
} from './types';
import { SendErrorCodes } from '../../../handlers/clientRequest/types';
import { ComputeFeeResponseStruct } from '../../../handlers/clientRequest/validation';
import type { NativeCaipAssetType } from '../../assets/types';
import type { ComputeFeeResult } from '../../send/types';
import type { TransactionsServiceV2 } from '../TransactionsServiceV2';

type BuildSendTransactionOptions = {
  skipIfNoToAddress?: boolean;
  missingAccountError?: SendErrorCodes;
  missingAssetError?: SendErrorCodes;
};

type BuildStakeTransactionOptions = {
  validateOnly?: boolean;
  includeVote?: boolean;
};

type BuildUnstakeTransactionOptions = {
  validateOnly?: boolean;
};

const continueWith = (
  context: TransactionPipelineContext,
): { type: 'continue'; context: TransactionPipelineContext } => ({
  type: 'continue',
  context,
});

const returnResponse = (
  response: Json,
): { type: 'return'; response: Json } => ({
  type: 'return',
  response,
});

const returnValidationError = (
  code: SendErrorCodes,
): { type: 'return'; response: Json } =>
  returnResponse({
    valid: false,
    errors: [{ code }],
  });

const returnValidationSuccess = (): { type: 'return'; response: Json } =>
  returnResponse({
    valid: true,
    errors: [],
  });

const requireField = <Key extends keyof TransactionPipelineContext>(
  context: TransactionPipelineContext,
  field: Key,
): NonNullable<TransactionPipelineContext[Key]> => {
  const value = context[field];
  if (value === undefined || value === null) {
    throw new Error(`Transaction pipeline missing required context: ${field}`);
  }
  return value as NonNullable<TransactionPipelineContext[Key]>;
};

const getFirstTransaction = (
  context: TransactionPipelineContext,
): PipelineTransaction => {
  const transaction = requireField(context, 'transactions')[0];
  if (!transaction) {
    throw new Error('Transaction pipeline missing required transaction');
  }
  return transaction;
};

const getFirstBroadcastResult = (
  context: TransactionPipelineContext,
): BroadcastResult => {
  const broadcastResult = requireField(context, 'broadcastResults')[0];
  if (!broadcastResult) {
    throw new Error('Transaction pipeline missing required broadcast result');
  }
  return broadcastResult;
};

export class TransactionPipelineSteps {
  readonly #transactionsServiceV2: TransactionsServiceV2;

  constructor({
    transactionsServiceV2,
  }: {
    transactionsServiceV2: TransactionsServiceV2;
  }) {
    this.#transactionsServiceV2 = transactionsServiceV2;
  }

  deserializeTransaction(): TransactionPipelineStep<TransactionPipelineContext> {
    return async (context) => {
      const accountId = requireField(context, 'accountId');
      const scope = requireField(context, 'scope');
      const transactionBase64 = requireField(context, 'transactionBase64');
      const transactionType = requireField(context, 'transactionType');
      const account =
        await this.#transactionsServiceV2.findAccountOrThrow(accountId);
      const transaction =
        await this.#transactionsServiceV2.deserializeTransaction({
          scope,
          transactionBase64,
          type: transactionType,
          feeLimit: context.feeLimit,
        });

      return continueWith({
        ...context,
        account,
        kind: 'raw',
        transactions: [transaction],
      });
    };
  }

  buildSendTransaction(
    options: BuildSendTransactionOptions = {},
  ): TransactionPipelineStep<TransactionPipelineContext> {
    return async (context) => {
      const accountId = requireField(context, 'accountId');
      const assetId = requireField(context, 'assetId');
      const amountValue = requireField(context, 'amountValue');
      const account = await this.#transactionsServiceV2.findAccount(accountId);

      if (!account) {
        return returnValidationError(
          options.missingAccountError ?? SendErrorCodes.Invalid,
        );
      }

      const scope = this.#transactionsServiceV2.getScopeFromAssetId(assetId);
      const { asset, nativeTokenAsset, bandwidthAsset, energyAsset } =
        await this.#transactionsServiceV2.getSendValidationAssets({
          accountId,
          assetId,
          scope,
        });
      const amount = this.#transactionsServiceV2.getAmount(amountValue);
      const assetBalance = this.#transactionsServiceV2.getBalance(asset);

      if (
        !asset ||
        !this.#transactionsServiceV2.hasEnoughBalance({
          amount,
          balance: assetBalance,
        })
      ) {
        return returnValidationError(
          options.missingAssetError ?? SendErrorCodes.InsufficientBalance,
        );
      }

      if (options.skipIfNoToAddress && !context.toAddress) {
        return returnValidationSuccess();
      }

      const toAddress = requireField(context, 'toAddress');
      const transaction =
        await this.#transactionsServiceV2.buildSendTransaction({
          fromAccountId: accountId,
          toAddress,
          asset,
          amount,
          feeLimit: context.feeLimit,
        });
      const { availableEnergy, availableBandwidth } =
        this.#transactionsServiceV2.getAvailableResources({
          bandwidthAsset,
          energyAsset,
        });

      return continueWith({
        ...context,
        account,
        scope,
        asset,
        amount,
        nativeTokenAsset,
        availableEnergy,
        availableBandwidth,
        kind: 'send',
        transactions: [transaction],
      });
    };
  }

  buildStakeTransaction(
    options: BuildStakeTransactionOptions = {},
  ): TransactionPipelineStep<TransactionPipelineContext> {
    return async (context) => {
      const accountId = requireField(context, 'accountId');
      const assetId = requireField(context, 'assetId');
      const amountValue = requireField(context, 'amountValue');
      const account =
        await this.#transactionsServiceV2.findAccountOrThrow(accountId);
      const asset = await this.#transactionsServiceV2.findAsset({
        accountId,
        assetId,
      });
      const amount = this.#transactionsServiceV2.getAmount(amountValue);
      const balance = this.#transactionsServiceV2.getBalance(asset);

      if (!this.#transactionsServiceV2.hasEnoughBalance({ amount, balance })) {
        return returnValidationError(SendErrorCodes.InsufficientBalance);
      }

      if (options.validateOnly || !context.purpose) {
        return continueWith({
          ...context,
          account,
          asset,
          amount,
          scope:
            context.scope ??
            this.#transactionsServiceV2.getScopeFromAssetId(assetId),
          kind: 'stake',
        });
      }

      const { scope, transactions } =
        await this.#transactionsServiceV2.buildStakeTransactions({
          account,
          assetId: assetId as NativeCaipAssetType,
          amount,
          purpose: context.purpose,
          srNodeAddress: context.srNodeAddress,
          includeVote: options.includeVote,
        });

      return continueWith({
        ...context,
        account,
        asset,
        amount,
        scope,
        kind: 'stake',
        transactions,
      });
    };
  }

  buildUnstakeTransaction(
    options: BuildUnstakeTransactionOptions = {},
  ): TransactionPipelineStep<TransactionPipelineContext> {
    return async (context) => {
      const accountId = requireField(context, 'accountId');
      const assetId = requireField(context, 'assetId');
      const amountValue = requireField(context, 'amountValue');
      const purpose = requireField(context, 'purpose');
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
      const amount = this.#transactionsServiceV2.getAmount(amountValue);
      const balance = this.#transactionsServiceV2.getBalance(asset);

      if (!this.#transactionsServiceV2.hasEnoughBalance({ amount, balance })) {
        return returnValidationError(SendErrorCodes.InsufficientBalance);
      }

      if (options.validateOnly) {
        return continueWith({
          ...context,
          account,
          asset,
          amount,
          stakedAssetId,
          scope: this.#transactionsServiceV2.getScopeFromAssetId(assetId),
          kind: 'unstake',
        });
      }

      const { scope, transactions } =
        await this.#transactionsServiceV2.buildUnstakeTransactions({
          account,
          assetId: stakedAssetId,
          amount,
        });

      return continueWith({
        ...context,
        account,
        asset,
        amount,
        stakedAssetId,
        scope,
        kind: 'unstake',
        transactions,
      });
    };
  }

  buildClaimUnstakedTransaction(): TransactionPipelineStep<TransactionPipelineContext> {
    return async (context) => {
      const accountId = requireField(context, 'accountId');
      const assetId = requireField(context, 'assetId');
      const account =
        await this.#transactionsServiceV2.findAccountOrThrow(accountId);
      const scope = this.#transactionsServiceV2.getScopeFromAssetId(assetId);
      const { transactions } =
        await this.#transactionsServiceV2.buildClaimUnstakedTransactions({
          account,
          scope,
        });

      return continueWith({
        ...context,
        account,
        scope,
        kind: 'claimUnstaked',
        transactions,
      });
    };
  }

  buildClaimRewardsTransaction(): TransactionPipelineStep<TransactionPipelineContext> {
    return async (context) => {
      const accountId = requireField(context, 'accountId');
      const assetId = requireField(context, 'assetId');
      const account =
        await this.#transactionsServiceV2.findAccountOrThrow(accountId);
      const scope = this.#transactionsServiceV2.getScopeFromAssetId(assetId);
      const { transactions } =
        await this.#transactionsServiceV2.buildClaimRewardsTransactions({
          account,
          scope,
        });

      return continueWith({
        ...context,
        account,
        scope,
        kind: 'claimRewards',
        transactions,
      });
    };
  }

  estimateFee(): TransactionPipelineStep<TransactionPipelineContext> {
    return async (context) => {
      const transactions = context.transactions ?? [];
      if (transactions.length === 0) {
        return continueWith(context);
      }

      const scope = requireField(context, 'scope');
      const fees: ComputeFeeResult[] = [];

      for (const transaction of transactions) {
        if (
          context.availableEnergy !== undefined &&
          context.availableBandwidth !== undefined
        ) {
          fees.push(
            await this.#transactionsServiceV2.estimateFeeWithResources({
              scope,
              transaction,
              availableEnergy: context.availableEnergy,
              availableBandwidth: context.availableBandwidth,
              feeLimit: context.feeLimit,
            }),
          );
          continue;
        }

        fees.push(
          await this.#transactionsServiceV2.estimateFee({
            scope,
            accountId: requireField(context, 'accountId'),
            transaction,
            feeLimit: context.feeLimit,
          }),
        );
      }

      return continueWith({
        ...context,
        fees: this.#aggregateFees(fees),
      });
    };
  }

  validateTransaction(): TransactionPipelineStep<TransactionPipelineContext> {
    return async (context) => {
      if (context.kind === 'send' && context.fees && context.amount) {
        const validation = this.#transactionsServiceV2.validateFeeBalance({
          scope: requireField(context, 'scope'),
          assetId: requireField(context, 'assetId'),
          amount: context.amount,
          fees: context.fees,
          nativeTokenBalance: this.#transactionsServiceV2.getBalance(
            context.nativeTokenAsset ?? null,
          ),
        });

        if (!validation.valid) {
          return returnResponse(validation);
        }
      }

      return continueWith(context);
    };
  }

  renderConfirmationUi(): TransactionPipelineStep<TransactionPipelineContext> {
    return async (context) => {
      if (context.kind === 'send') {
        const confirmed =
          await this.#transactionsServiceV2.confirmSendTransaction({
            scope: requireField(context, 'scope'),
            account: requireField(context, 'account'),
            toAddress: requireField(context, 'toAddress'),
            amount: requireField(context, 'amountValue'),
            fees: requireField(context, 'fees'),
            asset: requireField(context, 'asset'),
            transaction: getFirstTransaction(context),
          });

        if (!confirmed) {
          throw new UserRejectedRequestError() as unknown as Error;
        }
      }

      if (context.kind === 'claimUnstaked') {
        const confirmed =
          await this.#transactionsServiceV2.confirmClaimUnstakedTrx({
            account: requireField(context, 'account'),
            scope: requireField(context, 'scope'),
          });

        if (!confirmed) {
          throw new UserRejectedRequestError() as unknown as Error;
        }
      }

      return continueWith(context);
    };
  }

  sign(): TransactionPipelineStep<TransactionPipelineContext> {
    return async (context) => {
      const signedTransactions =
        await this.#transactionsServiceV2.signTransactions({
          scope: requireField(context, 'scope'),
          account: requireField(context, 'account'),
          transactions: requireField(context, 'transactions'),
        });

      return continueWith({
        ...context,
        signedTransactions,
      });
    };
  }

  broadcast(): TransactionPipelineStep<TransactionPipelineContext> {
    return async (context) => {
      const broadcastResults =
        await this.#transactionsServiceV2.broadcastTransactions({
          scope: requireField(context, 'scope'),
          signedTransactions: requireField(context, 'signedTransactions'),
        });

      return continueWith({
        ...context,
        broadcastResults,
      });
    };
  }

  savePendingTransaction(): TransactionPipelineStep<TransactionPipelineContext> {
    return async (context) => {
      await this.#transactionsServiceV2.savePendingTransactions({
        account: requireField(context, 'account'),
        scope: requireField(context, 'scope'),
        broadcastResults: requireField(context, 'broadcastResults'),
        sendDetails:
          context.kind === 'send'
            ? {
                toAddress: requireField(context, 'toAddress'),
                amount: requireField(context, 'amountValue'),
                asset: requireField(context, 'asset'),
              }
            : undefined,
      });

      return continueWith(context);
    };
  }

  scheduleAccountSync(): TransactionPipelineStep<TransactionPipelineContext> {
    return async (context) => {
      await this.#transactionsServiceV2.scheduleAccountSync({
        accountId: requireField(context, 'accountId'),
      });

      return continueWith(context);
    };
  }

  signRewardsMessage(): TransactionPipelineStep<TransactionPipelineContext> {
    return async (context) => {
      const signedRewardsMessage =
        await this.#transactionsServiceV2.signRewardsMessage({
          accountId: requireField(context, 'accountId'),
          message: requireField(context, 'message'),
        });

      return continueWith({
        ...context,
        signedRewardsMessage,
      });
    };
  }

  returnValidationSuccess(): TransactionPipelineStep<TransactionPipelineContext> {
    return async () => returnValidationSuccess();
  }

  returnTransactionId(): TransactionPipelineStep<TransactionPipelineContext> {
    return async (context) =>
      returnResponse({
        transactionId: getFirstBroadcastResult(context).txid,
      });
  }

  returnSubmittedTransaction(): TransactionPipelineStep<TransactionPipelineContext> {
    return async (context) =>
      returnResponse({
        transactionId: getFirstBroadcastResult(context).txid,
        status: TransactionStatus.Submitted,
      });
  }

  returnComputedFee(): TransactionPipelineStep<TransactionPipelineContext> {
    return async (context) => {
      const fees = requireField(context, 'fees');
      assert(fees, ComputeFeeResponseStruct);
      return returnResponse(fees);
    };
  }

  returnSignedRewardsMessage(): TransactionPipelineStep<TransactionPipelineContext> {
    return async (context) =>
      returnResponse(requireField(context, 'signedRewardsMessage'));
  }

  #aggregateFees(feeResults: ComputeFeeResult[]): ComputeFeeResult {
    const feesByAsset = new Map<string, ComputeFeeResult[number]>();

    for (const fees of feeResults) {
      for (const fee of fees) {
        const key = `${fee.type}:${fee.asset.type}`;
        const existingFee = feesByAsset.get(key);

        if (!existingFee) {
          feesByAsset.set(key, {
            ...fee,
            asset: { ...fee.asset },
          });
          continue;
        }

        existingFee.asset.amount = new BigNumber(existingFee.asset.amount)
          .plus(fee.asset.amount)
          .toString();
      }
    }

    return Array.from(feesByAsset.values());
  }
}
