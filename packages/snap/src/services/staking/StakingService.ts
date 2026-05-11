import { parseCaipAssetType } from '@metamask/utils';
import { BigNumber } from 'bignumber.js';
import type { Resource, Transaction } from 'tronweb/lib/esm/types';

import type { TronWebFactory } from '../../clients/tronweb/TronWebFactory';
import type { Network } from '../../constants';
import { CONSENSYS_SR_NODE_ADDRESS, KnownCaip19Id } from '../../constants';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import { trxToSun } from '../../utils/conversion';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import type { NativeCaipAssetType, StakedCaipAssetType } from '../assets/types';
import type { ComputeFeeResult, TransactionService } from '../transaction';

export class StakingService {
  readonly #logger: ILogger;

  readonly #tronWebFactory: TronWebFactory;

  readonly #transactionService: TransactionService;

  constructor({
    logger,
    tronWebFactory,
    transactionService,
  }: {
    logger: ILogger;
    tronWebFactory: TronWebFactory;
    transactionService: TransactionService;
  }) {
    this.#logger = createPrefixedLogger(logger, '[💸 StakingService]');
    this.#tronWebFactory = tronWebFactory;
    this.#transactionService = transactionService;
  }

  async buildStakeTransactions({
    account,
    assetId,
    amount,
    purpose,
    srNodeAddress,
  }: {
    account: TronKeyringAccount;
    assetId: NativeCaipAssetType;
    amount: BigNumber;
    purpose: 'BANDWIDTH' | 'ENERGY';
    srNodeAddress?: string;
  }): Promise<Transaction[]> {
    const { chainId } = parseCaipAssetType(assetId);
    const amountInSun = Number(trxToSun(amount));
    const availableVotes = amount.integerValue(BigNumber.ROUND_DOWN).toNumber();
    const voteRecipient = srNodeAddress ?? CONSENSYS_SR_NODE_ADDRESS;
    const tronWeb = this.#tronWebFactory.createClient(chainId as Network);

    return [
      await tronWeb.transactionBuilder.freezeBalanceV2(
        amountInSun,
        purpose,
        account.address,
      ),
      await tronWeb.transactionBuilder.vote(
        { [voteRecipient]: availableVotes },
        account.address,
      ),
    ];
  }

  async estimateStakeFee({
    account,
    assetId,
    amount,
    purpose,
    srNodeAddress,
  }: {
    account: TronKeyringAccount;
    assetId: NativeCaipAssetType;
    amount: BigNumber;
    purpose: 'BANDWIDTH' | 'ENERGY';
    srNodeAddress?: string;
  }): Promise<ComputeFeeResult> {
    const { chainId } = parseCaipAssetType(assetId);
    const transactions = await this.buildStakeTransactions({
      account,
      assetId,
      amount,
      purpose,
      srNodeAddress,
    });

    const feeResults = await this.#transactionService.estimateFees({
      scope: chainId as Network,
      accountId: account.id,
      transactions,
    });

    return this.#mergeFeeResults(feeResults);
  }

  async stake({
    account,
    assetId,
    amount,
    purpose,
    srNodeAddress,
  }: {
    account: TronKeyringAccount;
    assetId: NativeCaipAssetType;
    amount: BigNumber;
    purpose: 'BANDWIDTH' | 'ENERGY';
    /**
     * Optional SR node address to allocate votes to.
     * If not provided, defaults to the Consensys SR node.
     */
    srNodeAddress?: string;
  }): Promise<void> {
    const { chainId } = parseCaipAssetType(assetId);

    this.#logger.info(
      `Staking ${amount.toString()} ${assetId} for ${purpose} for ${account.address} on ${chainId}...`,
    );

    const transactions = await this.buildStakeTransactions({
      account,
      assetId,
      amount,
      purpose,
      srNodeAddress,
    });

    await this.#transactionService.broadcastMany({
      scope: chainId as Network,
      accountId: account.id,
      transactions,
      tracking: { type: 'accountSync' },
    });
  }

  async buildUnstakeTransactions({
    account,
    assetId,
    amount,
  }: {
    account: TronKeyringAccount;
    assetId: StakedCaipAssetType;
    amount: BigNumber;
  }): Promise<Transaction[]> {
    const { chainId } = parseCaipAssetType(assetId);
    const purpose = this.#getPurposeFromStakedAssetId(assetId);
    const amountInSun = Number(trxToSun(amount));
    const tronWeb = this.#tronWebFactory.createClient(chainId as Network);

    return [
      await tronWeb.transactionBuilder.unfreezeBalanceV2(
        amountInSun,
        purpose,
        account.address,
      ),
    ];
  }

  async unstake({
    account,
    assetId,
    amount,
  }: {
    account: TronKeyringAccount;
    assetId: StakedCaipAssetType;
    amount: BigNumber;
  }): Promise<void> {
    const { chainId } = parseCaipAssetType(assetId);

    this.#logger.info(
      `Unstaking ${amount.toString()} ${assetId} for ${account.address} on ${chainId}...`,
    );

    const transactions = await this.buildUnstakeTransactions({
      account,
      assetId,
      amount,
    });

    await this.#transactionService.broadcastMany({
      scope: chainId as Network,
      accountId: account.id,
      transactions,
      tracking: { type: 'accountSync' },
    });
  }

  async buildClaimUnstakedTrxTransactions({
    account,
    scope,
  }: {
    account: TronKeyringAccount;
    scope: Network;
  }): Promise<Transaction[]> {
    const tronWeb = this.#tronWebFactory.createClient(scope);

    return [
      await tronWeb.transactionBuilder.withdrawExpireUnfreeze(account.address),
    ];
  }

  async claimUnstakedTrx({
    account,
    scope,
  }: {
    account: TronKeyringAccount;
    scope: Network;
  }): Promise<void> {
    this.#logger.info(
      `Claiming unstaked TRX for ${account.address} on ${scope}...`,
    );

    const transactions = await this.buildClaimUnstakedTrxTransactions({
      account,
      scope,
    });

    await this.#transactionService.broadcastMany({
      scope,
      accountId: account.id,
      transactions,
      tracking: { type: 'accountSync' },
    });
  }

  async buildClaimTrxStakingRewardsTransactions({
    account,
    scope,
  }: {
    account: TronKeyringAccount;
    scope: Network;
  }): Promise<Transaction[]> {
    const tronWeb = this.#tronWebFactory.createClient(scope);

    return [
      await tronWeb.transactionBuilder.withdrawBlockRewards(account.address),
    ];
  }

  async claimTrxStakingRewards({
    account,
    scope,
  }: {
    account: TronKeyringAccount;
    scope: Network;
  }): Promise<void> {
    this.#logger.info(
      `Claiming staking rewards for ${account.address} on ${scope}...`,
    );

    const transactions = await this.buildClaimTrxStakingRewardsTransactions({
      account,
      scope,
    });

    await this.#transactionService.broadcastMany({
      scope,
      accountId: account.id,
      transactions,
      tracking: { type: 'accountSync' },
    });
  }

  #getPurposeFromStakedAssetId(assetId: StakedCaipAssetType): Resource {
    if (
      [
        KnownCaip19Id.TrxStakedForBandwidthMainnet,
        KnownCaip19Id.TrxStakedForBandwidthNile,
        KnownCaip19Id.TrxStakedForBandwidthShasta,
      ].includes(assetId as KnownCaip19Id)
    ) {
      return 'BANDWIDTH';
    }

    if (
      [
        KnownCaip19Id.TrxStakedForEnergyMainnet,
        KnownCaip19Id.TrxStakedForEnergyNile,
        KnownCaip19Id.TrxStakedForEnergyShasta,
      ].includes(assetId as KnownCaip19Id)
    ) {
      return 'ENERGY';
    }

    throw new Error('Invalid asset ID');
  }

  #mergeFeeResults(feeResults: ComputeFeeResult[]): ComputeFeeResult {
    const feesByAssetType = new Map<string, ComputeFeeResult[number]>();

    for (const fees of feeResults) {
      for (const fee of fees) {
        const existingFee = feesByAssetType.get(fee.asset.type);

        if (!existingFee) {
          feesByAssetType.set(fee.asset.type, {
            ...fee,
            asset: { ...fee.asset },
          });
          continue;
        }

        existingFee.asset.amount = BigNumber(existingFee.asset.amount)
          .plus(fee.asset.amount)
          .toString();
      }
    }

    return [...feesByAssetType.values()];
  }
}
