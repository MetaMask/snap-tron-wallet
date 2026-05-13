/* istanbul ignore file */

import type { Json } from '@metamask/snaps-sdk';
import { UserRejectedRequestError } from '@metamask/snaps-sdk';
import { BigNumber } from 'bignumber.js';

import { TransactionsServiceV2 } from './TransactionsServiceV2';
import type {
  TransactionBroadcastResult,
  TransactionDraft,
  TransactionDraftResult,
  TransactionValidationResponse,
} from './TransactionsServiceV3Types';
import type { Network } from '../../constants';
import { Networks } from '../../constants';
import { SendErrorCodes } from '../../handlers/clientRequest/types';
import type { NativeCaipAssetType } from '../assets/types';
import type { ComputeFeeResult } from '../send/types';

type PrepareSendTransactionOptions = {
  skipIfNoToAddress?: boolean;
  missingAccountError?: SendErrorCodes;
  missingAssetError?: SendErrorCodes;
  validateSendFeasibility?: boolean;
};

type PrepareStakeTransactionOptions = {
  validateOnly?: boolean;
  includeVote?: boolean;
};

type PrepareUnstakeTransactionOptions = {
  validateOnly?: boolean;
};

export class TransactionsServiceV3 extends TransactionsServiceV2 {
  async prepareRawTransaction({
    accountId,
    scope,
    transactionBase64,
    transactionType,
    feeLimit,
  }: {
    accountId: string;
    scope: Network;
    transactionBase64: string;
    transactionType: string;
    feeLimit?: number;
  }): Promise<TransactionDraft> {
    const account = await this.findAccountOrThrow(accountId);
    const transaction = await this.deserializeTransaction({
      scope,
      transactionBase64,
      type: transactionType,
      feeLimit,
    });

    return {
      accountId,
      account,
      scope,
      kind: 'raw',
      transactions: [transaction],
      feeLimit: transaction.raw_data.fee_limit ?? feeLimit,
    };
  }

  async prepareSendTransaction({
    accountId,
    assetId,
    amountValue,
    toAddress,
    feeLimit,
    skipIfNoToAddress,
    missingAccountError,
    missingAssetError,
    validateSendFeasibility,
  }: {
    accountId: string;
    assetId: string;
    amountValue: string;
    toAddress?: string;
    feeLimit?: number;
  } & PrepareSendTransactionOptions): Promise<TransactionDraftResult> {
    const account = await this.findAccount(accountId);

    if (!account) {
      return this.#returnValidationError(
        missingAccountError ?? SendErrorCodes.Invalid,
      );
    }

    const scope = this.getScopeFromAssetId(assetId);
    const { asset, nativeTokenAsset, bandwidthAsset, energyAsset } =
      await this.getSendValidationAssets({ accountId, assetId, scope });
    const amount = this.getAmount(amountValue);
    const assetBalance = this.getBalance(asset);

    if (!asset || !this.hasEnoughBalance({ amount, balance: assetBalance })) {
      return this.#returnValidationError(
        missingAssetError ?? SendErrorCodes.InsufficientBalance,
      );
    }

    if (skipIfNoToAddress && !toAddress) {
      return this.#returnValidationSuccess();
    }

    if (!toAddress) {
      return this.#returnValidationError(SendErrorCodes.Invalid);
    }

    if (validateSendFeasibility) {
      const validation = await this.validateSendFeasibility({
        scope,
        fromAccountId: accountId,
        toAddress,
        asset,
        amount,
        feeLimit,
      });

      if (!validation.valid) {
        return { type: 'response', response: validation as Json };
      }
    }

    const transaction = await this.buildSendTransaction({
      fromAccountId: accountId,
      toAddress,
      asset,
      amount,
      feeLimit,
    });
    const { availableEnergy, availableBandwidth } = this.getAvailableResources({
      bandwidthAsset,
      energyAsset,
    });

    return {
      type: 'draft',
      draft: {
        accountId,
        account,
        scope,
        assetId,
        asset,
        amount,
        amountValue,
        toAddress,
        feeLimit,
        nativeTokenAsset,
        availableEnergy,
        availableBandwidth,
        kind: 'send',
        transactions: [transaction],
      },
    };
  }

  async prepareStakeTransactions({
    accountId,
    assetId,
    amountValue,
    scope,
    purpose,
    srNodeAddress,
    validateOnly,
    includeVote,
  }: {
    accountId: string;
    assetId: string;
    amountValue: string;
    scope?: Network;
    purpose?: 'BANDWIDTH' | 'ENERGY';
    srNodeAddress?: string;
  } & PrepareStakeTransactionOptions): Promise<TransactionDraftResult> {
    const account = await this.findAccountOrThrow(accountId);
    const asset = await this.findAsset({ accountId, assetId });
    const amount = this.getAmount(amountValue);
    const balance = this.getBalance(asset);
    const transactionScope = scope ?? this.getScopeFromAssetId(assetId);

    if (!this.hasEnoughBalance({ amount, balance })) {
      return this.#returnValidationError(SendErrorCodes.InsufficientBalance);
    }

    if (validateOnly || !purpose) {
      return {
        type: 'draft',
        draft: {
          accountId,
          account,
          scope: transactionScope,
          assetId,
          asset,
          amount,
          amountValue,
          kind: 'stake',
          transactions: [],
        },
      };
    }

    const { scope: builtScope, transactions } =
      await this.buildStakeTransactions({
        account,
        assetId: assetId as NativeCaipAssetType,
        amount,
        purpose,
        srNodeAddress,
        includeVote,
      });

    return {
      type: 'draft',
      draft: {
        accountId,
        account,
        scope: builtScope,
        assetId,
        asset,
        amount,
        amountValue,
        kind: 'stake',
        transactions,
      },
    };
  }

  async prepareUnstakeTransactions({
    accountId,
    assetId,
    amountValue,
    purpose,
    validateOnly,
  }: {
    accountId: string;
    assetId: string;
    amountValue: string;
    purpose: 'BANDWIDTH' | 'ENERGY';
  } & PrepareUnstakeTransactionOptions): Promise<TransactionDraftResult> {
    const stakedAssetId = this.toStakedAssetId({ assetId, purpose });
    const account = await this.findAccountOrThrow(accountId);
    const asset = await this.findAsset({ accountId, assetId: stakedAssetId });
    const amount = this.getAmount(amountValue);
    const balance = this.getBalance(asset);
    const scope = this.getScopeFromAssetId(assetId);

    if (!this.hasEnoughBalance({ amount, balance })) {
      return this.#returnValidationError(SendErrorCodes.InsufficientBalance);
    }

    if (validateOnly) {
      return {
        type: 'draft',
        draft: {
          accountId,
          account,
          scope,
          assetId,
          asset,
          amount,
          amountValue,
          kind: 'unstake',
          transactions: [],
        },
      };
    }

    const { transactions } = await this.buildUnstakeTransactions({
      account,
      assetId: stakedAssetId,
      amount,
    });

    return {
      type: 'draft',
      draft: {
        accountId,
        account,
        scope,
        assetId,
        asset,
        amount,
        amountValue,
        kind: 'unstake',
        transactions,
      },
    };
  }

  async prepareClaimUnstakedTransactions({
    accountId,
    assetId,
  }: {
    accountId: string;
    assetId: string;
  }): Promise<TransactionDraft> {
    const account = await this.findAccountOrThrow(accountId);
    const scope = this.getScopeFromAssetId(assetId);
    const { transactions } = await this.buildClaimUnstakedTransactions({
      account,
      scope,
    });

    return {
      accountId,
      account,
      scope,
      assetId,
      kind: 'claimUnstaked',
      transactions,
    };
  }

  async prepareClaimRewardsTransactions({
    accountId,
    assetId,
  }: {
    accountId: string;
    assetId: string;
  }): Promise<TransactionDraft> {
    const account = await this.findAccountOrThrow(accountId);
    const scope = this.getScopeFromAssetId(assetId);
    const { transactions } = await this.buildClaimRewardsTransactions({
      account,
      scope,
    });

    return {
      accountId,
      account,
      scope,
      assetId,
      kind: 'claimRewards',
      transactions,
    };
  }

  async estimateTransactionFees(
    draft: TransactionDraft,
  ): Promise<ComputeFeeResult> {
    const fees: ComputeFeeResult[] = [];

    for (const transaction of draft.transactions) {
      if (
        draft.availableEnergy !== undefined &&
        draft.availableBandwidth !== undefined
      ) {
        fees.push(
          await this.estimateFeeWithResources({
            scope: draft.scope,
            transaction,
            availableEnergy: draft.availableEnergy,
            availableBandwidth: draft.availableBandwidth,
            feeLimit: draft.feeLimit,
          }),
        );
        continue;
      }

      fees.push(
        await this.estimateFee({
          scope: draft.scope,
          accountId: draft.accountId,
          transaction,
          feeLimit: draft.feeLimit,
        }),
      );
    }

    return this.#aggregateFees(fees);
  }

  validateTransactionDraft({
    draft,
    fees,
  }: {
    draft: TransactionDraft;
    fees?: ComputeFeeResult;
  }): TransactionValidationResponse {
    if (draft.kind === 'send' && fees && draft.amount) {
      return this.validateFeeBalance({
        scope: draft.scope,
        assetId: draft.assetId ?? Networks[draft.scope].nativeToken.id,
        amount: draft.amount,
        fees,
        nativeTokenBalance: this.getBalance(draft.nativeTokenAsset ?? null),
      });
    }

    return this.#validationSuccess();
  }

  async confirmSendDraft({
    draft,
    fees,
  }: {
    draft: TransactionDraft;
    fees: ComputeFeeResult;
  }): Promise<void> {
    if (
      draft.kind !== 'send' ||
      !draft.toAddress ||
      !draft.amountValue ||
      !draft.asset ||
      !draft.transactions[0]
    ) {
      throw new Error('Cannot confirm incomplete send transaction draft');
    }

    const confirmed = await this.confirmSendTransaction({
      scope: draft.scope,
      account: draft.account,
      toAddress: draft.toAddress,
      amount: draft.amountValue,
      fees,
      asset: draft.asset,
      transaction: draft.transactions[0],
    });

    if (!confirmed) {
      throw new UserRejectedRequestError() as unknown as Error;
    }
  }

  async confirmClaimUnstakedDraft({
    draft,
  }: {
    draft: TransactionDraft;
  }): Promise<void> {
    if (draft.kind !== 'claimUnstaked') {
      throw new Error('Cannot confirm non-claim-unstaked transaction draft');
    }

    const confirmed = await this.confirmClaimUnstakedTrx({
      account: draft.account,
      scope: draft.scope,
    });

    if (!confirmed) {
      throw new UserRejectedRequestError() as unknown as Error;
    }
  }

  async submitTransactionDraft({
    draft,
  }: {
    draft: TransactionDraft;
  }): Promise<TransactionBroadcastResult[]> {
    const signedTransactions = await this.signTransactions({
      scope: draft.scope,
      account: draft.account,
      transactions: draft.transactions,
    });
    const broadcastResults = await this.broadcastTransactions({
      scope: draft.scope,
      signedTransactions,
    });

    await this.savePendingTransactions({
      account: draft.account,
      scope: draft.scope,
      broadcastResults,
      sendDetails:
        draft.kind === 'send' &&
        draft.toAddress &&
        draft.amountValue &&
        draft.asset
          ? {
              toAddress: draft.toAddress,
              amount: draft.amountValue,
              asset: draft.asset,
            }
          : undefined,
    });
    await this.scheduleAccountSync({ accountId: draft.accountId });

    return broadcastResults as TransactionBroadcastResult[];
  }

  withFees({
    draft,
    fees,
  }: {
    draft: TransactionDraft;
    fees: ComputeFeeResult;
  }): TransactionDraft {
    return { ...draft, fees };
  }

  validationSuccess(): TransactionValidationResponse {
    return this.#validationSuccess();
  }

  validationResponse(response: TransactionValidationResponse): Json {
    return response as Json;
  }

  #returnValidationError(code: SendErrorCodes): TransactionDraftResult {
    return {
      type: 'response',
      response: {
        valid: false,
        errors: [{ code }],
      },
    };
  }

  #returnValidationSuccess(): TransactionDraftResult {
    return {
      type: 'response',
      response: this.#validationSuccess() as Json,
    };
  }

  #validationSuccess(): TransactionValidationResponse {
    return {
      valid: true,
      errors: [],
    };
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
