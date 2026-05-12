import type {
  CaipAssetType,
  Transaction as KeyringTransaction,
} from '@metamask/keyring-api';
import {
  bytesToHex,
  hexToBytes,
  parseCaipAssetType,
  sha256,
} from '@metamask/utils';
import { BigNumber } from 'bignumber.js';
import type { TronWeb, Types } from 'tronweb';
import type {
  Transaction,
  TransferAssetContract,
  TransferContract,
  TriggerSmartContract,
} from 'tronweb/lib/esm/types';

import { TransactionMapper } from './TransactionsMapper';
import type { TransactionsService } from './TransactionsService';
import type { SnapClient } from '../../clients/snap/SnapClient';
import type { TronWebFactory } from '../../clients/tronweb/TronWebFactory';
import { FEE_LIMIT, Network, Networks, ZERO } from '../../constants';
import type { AssetEntity } from '../../entities/assets';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import { SendErrorCodes } from '../../handlers/clientRequest/types';
import { parseRewardsMessage } from '../../handlers/clientRequest/validation';
import { BackgroundEventMethod } from '../../handlers/cronjob';
import { trxToSun } from '../../utils/conversion';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import { assertTransactionStructure } from '../../validation/transaction';
import type { AccountsService } from '../accounts/AccountsService';
import type { AssetsService } from '../assets/AssetsService';
import type { NativeCaipAssetType, StakedCaipAssetType } from '../assets/types';
import type { ConfirmationHandler } from '../confirmation/ConfirmationHandler';
import type { FeeCalculatorService } from '../send/FeeCalculatorService';
import type { SendService } from '../send/SendService';
import type { ComputeFeeResult } from '../send/types';
import type { StakingService } from '../staking/StakingService';

type TransactionRawData = Types.Transaction['raw_data'] & {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  fee_limit?: number;
};

export type DecodedTransaction = {
  visible: false;
  txID: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  raw_data: TransactionRawData;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  raw_data_hex: string;
};

export type SendTransaction =
  | Transaction<TransferContract>
  | Transaction<TransferAssetContract>
  | Transaction<TriggerSmartContract>;

type BroadcastResult = {
  result: boolean;
  txid: string;
  message?: string;
};

type ValidationResult = {
  valid: boolean;
  errors: { code: SendErrorCodes }[];
};

export class TransactionsServiceV2 {
  readonly #logger: ILogger;

  readonly #accountsService: AccountsService;

  readonly #assetsService: AssetsService;

  readonly #sendService: SendService;

  readonly #feeCalculatorService: FeeCalculatorService;

  readonly #tronWebFactory: TronWebFactory;

  readonly #snapClient: SnapClient;

  readonly #stakingService: StakingService;

  readonly #confirmationHandler: ConfirmationHandler;

  readonly #transactionsService: TransactionsService;

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
  }) {
    this.#logger = createPrefixedLogger(logger, '[🧱 TransactionsServiceV2]');
    this.#accountsService = accountsService;
    this.#assetsService = assetsService;
    this.#sendService = sendService;
    this.#feeCalculatorService = feeCalculatorService;
    this.#tronWebFactory = tronWebFactory;
    this.#snapClient = snapClient;
    this.#stakingService = stakingService;
    this.#confirmationHandler = confirmationHandler;
    this.#transactionsService = transactionsService;
  }

  getScopeFromAssetId(assetId: string): Network {
    const { chainId } = parseCaipAssetType(assetId as CaipAssetType);
    return chainId as Network;
  }

  async findAccount(accountId: string): Promise<TronKeyringAccount | null> {
    return this.#accountsService.findById(accountId);
  }

  async findAccountOrThrow(accountId: string): Promise<TronKeyringAccount> {
    return this.#accountsService.findByIdOrThrow(accountId);
  }

  async findAsset({
    accountId,
    assetId,
  }: {
    accountId: string;
    assetId: string;
  }): Promise<AssetEntity | null> {
    return this.#assetsService.getAssetByAccountId(accountId, assetId);
  }

  getAmount(value: string): BigNumber {
    return new BigNumber(value);
  }

  getBalance(asset: AssetEntity | null): BigNumber {
    return asset ? new BigNumber(asset.uiAmount) : ZERO;
  }

  hasEnoughBalance({
    amount,
    balance,
  }: {
    amount: BigNumber;
    balance: BigNumber;
  }): boolean {
    return amount.isLessThanOrEqualTo(balance);
  }

  async getSendValidationAssets({
    accountId,
    assetId,
    scope,
  }: {
    accountId: string;
    assetId: string;
    scope: Network;
  }): Promise<{
    asset: AssetEntity | null;
    nativeTokenAsset: AssetEntity | null;
    bandwidthAsset: AssetEntity | null;
    energyAsset: AssetEntity | null;
  }> {
    const [asset, nativeTokenAsset, bandwidthAsset, energyAsset] =
      await this.#assetsService.getAssetsByAccountId(accountId, [
        assetId,
        Networks[scope].nativeToken.id,
        Networks[scope].bandwidth.id,
        Networks[scope].energy.id,
      ]);

    return {
      asset: asset ?? null,
      nativeTokenAsset: nativeTokenAsset ?? null,
      bandwidthAsset: bandwidthAsset ?? null,
      energyAsset: energyAsset ?? null,
    };
  }

  getAvailableResources({
    bandwidthAsset,
    energyAsset,
  }: {
    bandwidthAsset: AssetEntity | null;
    energyAsset: AssetEntity | null;
  }): { availableEnergy: BigNumber; availableBandwidth: BigNumber } {
    return {
      availableEnergy: energyAsset
        ? new BigNumber(energyAsset.rawAmount)
        : ZERO,
      availableBandwidth: bandwidthAsset
        ? new BigNumber(bandwidthAsset.rawAmount)
        : ZERO,
    };
  }

  async getAvailableAccountResources({
    accountId,
    scope,
  }: {
    accountId: string;
    scope: Network;
  }): Promise<{ availableEnergy: BigNumber; availableBandwidth: BigNumber }> {
    const [bandwidthAsset, energyAsset] =
      await this.#assetsService.getAssetsByAccountId(accountId, [
        Networks[scope].bandwidth.id,
        Networks[scope].energy.id,
      ]);

    return this.getAvailableResources({
      bandwidthAsset: bandwidthAsset ?? null,
      energyAsset: energyAsset ?? null,
    });
  }

  async validateSendFeasibility({
    scope,
    fromAccountId,
    toAddress,
    asset,
    amount,
    feeLimit,
  }: {
    scope: Network;
    fromAccountId: string;
    toAddress: string;
    asset: AssetEntity;
    amount: BigNumber;
    feeLimit?: number;
  }): Promise<ValidationResult> {
    const validation = await this.#sendService.validateSend({
      scope,
      fromAccountId,
      toAddress,
      asset,
      amount,
      feeLimit,
    });

    if (!validation.valid) {
      return {
        valid: false,
        errors: [
          { code: validation.errorCode ?? SendErrorCodes.InsufficientBalance },
        ],
      };
    }

    return { valid: true, errors: [] };
  }

  validateFeeBalance({
    scope,
    assetId,
    amount,
    fees,
    nativeTokenBalance,
  }: {
    scope: Network;
    assetId: string;
    amount: BigNumber;
    fees: ComputeFeeResult;
    nativeTokenBalance: BigNumber;
  }): ValidationResult {
    const nativeTokenId = Networks[scope].nativeToken.id;
    const trxFee = new BigNumber(
      fees.find((fee) => fee.asset.type === nativeTokenId)?.asset.amount ?? '0',
    );
    const totalTrxToSpend =
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      assetId === nativeTokenId ? amount.plus(trxFee) : trxFee;

    if (totalTrxToSpend.isGreaterThan(nativeTokenBalance)) {
      return {
        valid: false,
        errors: [{ code: SendErrorCodes.InsufficientBalanceToCoverFee }],
      };
    }

    return { valid: true, errors: [] };
  }

  async deserializeTransaction({
    scope,
    transactionBase64,
    type,
    feeLimit = FEE_LIMIT,
  }: {
    scope: Network;
    transactionBase64: string;
    type: string;
    feeLimit?: number;
  }): Promise<DecodedTransaction> {
    const tronWeb = this.#tronWebFactory.createClient(scope);

    // eslint-disable-next-line no-restricted-globals
    let rawDataHex = Buffer.from(transactionBase64, 'base64').toString('hex');
    const rawData = tronWeb.utils.deserializeTx.deserializeTransaction(
      type,
      rawDataHex,
    ) as TransactionRawData;

    rawDataHex = this.#setRawDataFeeLimit(tronWeb, rawData, feeLimit);
    assertTransactionStructure(rawData);

    const txID = bytesToHex(await sha256(hexToBytes(rawDataHex))).slice(2);

    return {
      visible: false,
      txID,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      raw_data: rawData,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      raw_data_hex: rawDataHex,
    };
  }

  async buildSendTransaction({
    fromAccountId,
    toAddress,
    asset,
    amount,
    feeLimit,
  }: {
    fromAccountId: string;
    toAddress: string;
    asset: AssetEntity;
    amount: BigNumber;
    feeLimit?: number;
  }): Promise<SendTransaction> {
    return this.#sendService.buildTransaction({
      fromAccountId,
      toAddress,
      asset,
      amount,
      feeLimit,
    });
  }

  async buildStakeTransaction({
    account,
    scope,
    amount,
    purpose,
  }: {
    account: TronKeyringAccount;
    scope: Network;
    amount: BigNumber;
    purpose: 'BANDWIDTH' | 'ENERGY';
  }): Promise<Transaction> {
    const tronWeb = this.#tronWebFactory.createClient(scope);
    const amountInSun = Number(trxToSun(amount));
    return tronWeb.transactionBuilder.freezeBalanceV2(
      amountInSun,
      purpose,
      account.address,
    );
  }

  async buildStakeTransactions({
    account,
    assetId,
    amount,
    purpose,
    srNodeAddress,
    includeVote,
  }: {
    account: TronKeyringAccount;
    assetId: NativeCaipAssetType;
    amount: BigNumber;
    purpose: 'BANDWIDTH' | 'ENERGY';
    srNodeAddress?: string;
    includeVote?: boolean;
  }): Promise<{ scope: Network; transactions: Transaction[] }> {
    return this.#stakingService.buildStakeTransactions({
      account,
      assetId,
      amount,
      purpose,
      srNodeAddress,
      includeVote,
    }) as Promise<{ scope: Network; transactions: Transaction[] }>;
  }

  async buildUnstakeTransactions({
    account,
    assetId,
    amount,
  }: {
    account: TronKeyringAccount;
    assetId: StakedCaipAssetType;
    amount: BigNumber;
  }): Promise<{ scope: Network; transactions: Transaction[] }> {
    return this.#stakingService.buildUnstakeTransactions({
      account,
      assetId,
      amount,
    }) as Promise<{ scope: Network; transactions: Transaction[] }>;
  }

  async buildClaimUnstakedTransactions({
    account,
    scope,
  }: {
    account: TronKeyringAccount;
    scope: Network;
  }): Promise<{ scope: Network; transactions: Transaction[] }> {
    return this.#stakingService.buildClaimUnstakedTransactions({
      account,
      scope,
    }) as Promise<{ scope: Network; transactions: Transaction[] }>;
  }

  async buildClaimRewardsTransactions({
    account,
    scope,
  }: {
    account: TronKeyringAccount;
    scope: Network;
  }): Promise<{ scope: Network; transactions: Transaction[] }> {
    return this.#stakingService.buildClaimRewardsTransactions({
      account,
      scope,
    }) as Promise<{ scope: Network; transactions: Transaction[] }>;
  }

  async estimateFee({
    scope,
    accountId,
    transaction,
    feeLimit,
  }: {
    scope: Network;
    accountId: string;
    transaction: Transaction | DecodedTransaction;
    feeLimit?: number;
  }): Promise<ComputeFeeResult> {
    const { availableEnergy, availableBandwidth } =
      await this.getAvailableAccountResources({ accountId, scope });

    return this.#feeCalculatorService.computeFee({
      scope,
      transaction: transaction as Transaction,
      availableEnergy,
      availableBandwidth,
      feeLimit,
    });
  }

  async estimateFeeWithResources({
    scope,
    transaction,
    availableEnergy,
    availableBandwidth,
    feeLimit,
  }: {
    scope: Network;
    transaction: Transaction | DecodedTransaction;
    availableEnergy: BigNumber;
    availableBandwidth: BigNumber;
    feeLimit?: number;
  }): Promise<ComputeFeeResult> {
    return this.#feeCalculatorService.computeFee({
      scope,
      transaction: transaction as Transaction,
      availableEnergy,
      availableBandwidth,
      feeLimit,
    });
  }

  async confirmSendTransaction({
    scope,
    account,
    toAddress,
    amount,
    fees,
    asset,
    transaction,
  }: {
    scope: Network;
    account: TronKeyringAccount;
    toAddress: string;
    amount: string;
    fees: ComputeFeeResult;
    asset: AssetEntity;
    transaction: Transaction | DecodedTransaction;
  }): Promise<boolean> {
    return this.#confirmationHandler.confirmTransactionRequest({
      scope,
      fromAddress: account.address,
      toAddress,
      amount,
      fees,
      asset,
      accountType: account.type,
      origin: 'MetaMask',
      transactionRawData: transaction.raw_data,
    });
  }

  async confirmClaimUnstakedTrx({
    account,
    scope,
  }: {
    account: TronKeyringAccount;
    scope: Network;
  }): Promise<boolean> {
    return this.#confirmationHandler.confirmClaimUnstakedTrx({
      account,
      scope,
    });
  }

  async signTransaction({
    scope,
    account,
    transaction,
  }: {
    scope: Network;
    account: TronKeyringAccount;
    transaction: Transaction | DecodedTransaction;
  }): Promise<unknown> {
    const { privateKeyHex } = await this.#accountsService.deriveTronKeypair({
      entropySource: account.entropySource,
      derivationPath: account.derivationPath,
    });
    const tronWeb = this.#tronWebFactory.createClient(scope, privateKeyHex);

    return tronWeb.trx.sign(
      transaction as Parameters<TronWeb['trx']['sign']>[0],
    );
  }

  async signTransactions({
    scope,
    account,
    transactions,
  }: {
    scope: Network;
    account: TronKeyringAccount;
    transactions: (Transaction | DecodedTransaction)[];
  }): Promise<unknown[]> {
    const { privateKeyHex } = await this.#accountsService.deriveTronKeypair({
      entropySource: account.entropySource,
      derivationPath: account.derivationPath,
    });
    const tronWeb = this.#tronWebFactory.createClient(scope, privateKeyHex);
    const signedTransactions: unknown[] = [];

    for (const transaction of transactions) {
      signedTransactions.push(
        await tronWeb.trx.sign(
          transaction as Parameters<TronWeb['trx']['sign']>[0],
        ),
      );
    }

    return signedTransactions;
  }

  async broadcastTransaction({
    scope,
    signedTransaction,
  }: {
    scope: Network;
    signedTransaction: unknown;
  }): Promise<BroadcastResult> {
    const tronWeb = this.#tronWebFactory.createClient(scope);
    const result = (await tronWeb.trx.sendRawTransaction(
      signedTransaction as Parameters<TronWeb['trx']['sendRawTransaction']>[0],
    )) as BroadcastResult;

    if (!result.result) {
      throw new Error(`Failed to send transaction: ${result.message}`);
    }

    return result;
  }

  async broadcastTransactions({
    scope,
    signedTransactions,
  }: {
    scope: Network;
    signedTransactions: unknown[];
  }): Promise<BroadcastResult[]> {
    const tronWeb = this.#tronWebFactory.createClient(scope);
    const results: BroadcastResult[] = [];

    for (const signedTransaction of signedTransactions) {
      const result = (await tronWeb.trx.sendRawTransaction(
        signedTransaction as Parameters<
          TronWeb['trx']['sendRawTransaction']
        >[0],
      )) as BroadcastResult;

      if (!result.result) {
        throw new Error(`Failed to send transaction: ${result.message}`);
      }

      results.push(result);
    }

    return results;
  }

  async signAndBroadcastSendTransaction({
    scope,
    fromAccountId,
    transaction,
  }: {
    scope: Network;
    fromAccountId: string;
    transaction: SendTransaction;
  }): Promise<BroadcastResult> {
    return this.#sendService.signAndSendTransaction({
      scope,
      fromAccountId,
      transaction,
    }) as Promise<BroadcastResult>;
  }

  async savePendingTransaction({
    txId,
    account,
    scope,
  }: {
    txId: string;
    account: TronKeyringAccount;
    scope: Network;
  }): Promise<void> {
    const pendingTransaction = TransactionMapper.createPendingTransaction({
      txId,
      account,
      scope,
    });

    await this.#savePending(pendingTransaction);
  }

  async savePendingSendTransaction({
    txId,
    account,
    scope,
    toAddress,
    amount,
    asset,
  }: {
    txId: string;
    account: TronKeyringAccount;
    scope: Network;
    toAddress: string;
    amount: string;
    asset: AssetEntity;
  }): Promise<void> {
    const pendingTransaction = TransactionMapper.createPendingSendTransaction({
      txId,
      account,
      scope,
      toAddress,
      amount,
      assetType: asset.assetType,
      assetSymbol: asset.symbol,
    });

    await this.#savePending(pendingTransaction);
  }

  async savePendingTransactions({
    account,
    scope,
    broadcastResults,
    sendDetails,
  }: {
    account: TronKeyringAccount;
    scope: Network;
    broadcastResults: BroadcastResult[];
    sendDetails?: {
      toAddress: string;
      amount: string;
      asset: AssetEntity;
    };
  }): Promise<void> {
    for (const result of broadcastResults) {
      if (sendDetails) {
        await this.savePendingSendTransaction({
          txId: result.txid,
          account,
          scope,
          toAddress: sendDetails.toAddress,
          amount: sendDetails.amount,
          asset: sendDetails.asset,
        });
        continue;
      }

      await this.savePendingTransaction({
        txId: result.txid,
        account,
        scope,
      });
    }
  }

  async scheduleTransactionTracking({
    txId,
    scope,
    accountId,
  }: {
    txId: string;
    scope: Network;
    accountId: string;
  }): Promise<void> {
    await this.#snapClient.scheduleBackgroundEvent({
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId,
        scope,
        accountIds: [accountId],
        attempt: 0,
      },
      duration: 'PT1S',
    });
  }

  async scheduleAccountSync({
    accountId,
  }: {
    accountId: string;
  }): Promise<void> {
    await this.#snapClient.scheduleBackgroundEvent({
      method: BackgroundEventMethod.SynchronizeAccount,
      params: { accountId },
      duration: 'PT5S',
    });
  }

  async executeStake({
    account,
    assetId,
    amount,
    purpose,
    srNodeAddress,
  }: {
    account: TronKeyringAccount;
    assetId: string;
    amount: BigNumber;
    purpose: 'BANDWIDTH' | 'ENERGY';
    srNodeAddress?: string;
  }): Promise<void> {
    await this.#stakingService.stake({
      account,
      assetId: assetId as NativeCaipAssetType,
      amount,
      purpose,
      srNodeAddress,
    });
  }

  async executeUnstake({
    account,
    assetId,
    amount,
  }: {
    account: TronKeyringAccount;
    assetId: StakedCaipAssetType;
    amount: BigNumber;
  }): Promise<void> {
    await this.#stakingService.unstake({
      account,
      assetId,
      amount,
    });
  }

  async executeClaimUnstakedTrx({
    account,
    scope,
  }: {
    account: TronKeyringAccount;
    scope: Network;
  }): Promise<void> {
    await this.#stakingService.claimUnstakedTrx({ account, scope });
  }

  async executeClaimTrxStakingRewards({
    account,
    scope,
  }: {
    account: TronKeyringAccount;
    scope: Network;
  }): Promise<void> {
    await this.#stakingService.claimTrxStakingRewards({ account, scope });
  }

  toStakedAssetId({
    assetId,
    purpose,
  }: {
    assetId: string;
    purpose: 'BANDWIDTH' | 'ENERGY';
  }): StakedCaipAssetType {
    return `${assetId}-staked-for-${purpose.toLowerCase()}` as StakedCaipAssetType;
  }

  async signRewardsMessage({
    accountId,
    message,
  }: {
    accountId: string;
    message: string;
  }): Promise<{
    signature: string;
    signedMessage: string;
    signatureType: 'secp256k1';
  }> {
    const account = await this.#accountsService.findById(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    const { address: messageAddress } = parseRewardsMessage(message);

    if (messageAddress !== account.address) {
      throw new Error(
        `Address in rewards message (${messageAddress}) does not match signing account address (${account.address})`,
      );
    }

    const { privateKeyHex } = await this.#accountsService.deriveTronKeypair({
      entropySource: account.entropySource,
      derivationPath: account.derivationPath,
    });
    const tronWeb = this.#tronWebFactory.createClient(
      Network.Mainnet,
      privateKeyHex,
    );

    // eslint-disable-next-line no-restricted-globals
    const decodedMessage = Buffer.from(message, 'base64').toString('utf8');
    const signature = tronWeb.trx.signMessageV2(decodedMessage, privateKeyHex);

    return {
      signature,
      signedMessage: message,
      signatureType: 'secp256k1',
    };
  }

  async #savePending(transaction: KeyringTransaction): Promise<void> {
    await this.#transactionsService.save(transaction);
    this.#logger.log(`Saved pending transaction ${transaction.id}`);
  }

  #setRawDataFeeLimit(
    tronWeb: TronWeb,
    rawData: TransactionRawData,
    feeLimit: number,
  ): string {
    rawData.fee_limit = feeLimit;
    const transactionPb = tronWeb.utils.transaction.txJsonToPb({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      raw_data: rawData,
    });
    return tronWeb.utils.transaction.txPbToRawDataHex(transactionPb);
  }
}
