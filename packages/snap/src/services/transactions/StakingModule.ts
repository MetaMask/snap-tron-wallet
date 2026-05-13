/* istanbul ignore file */

import { parseCaipAssetType } from '@metamask/utils';
import { BigNumber } from 'bignumber.js';
import type { Resource, Transaction } from 'tronweb/lib/esm/types';

import type { TronWebFactory } from '../../clients/tronweb/TronWebFactory';
import { CONSENSYS_SR_NODE_ADDRESS, KnownCaip19Id } from '../../constants';
import type { Network } from '../../constants';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import { trxToSun } from '../../utils/conversion';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import type { NativeCaipAssetType, StakedCaipAssetType } from '../assets/types';

export class StakingModule {
  readonly #logger: ILogger;

  readonly #tronWebFactory: TronWebFactory;

  constructor({
    logger,
    tronWebFactory,
  }: {
    logger: ILogger;
    tronWebFactory: TronWebFactory;
  }) {
    this.#logger = createPrefixedLogger(logger, '[💸 StakingModule]');
    this.#tronWebFactory = tronWebFactory;
  }

  async buildStakeTransactions({
    account,
    assetId,
    amount,
    purpose,
    srNodeAddress,
    includeVote = true,
  }: {
    account: TronKeyringAccount;
    assetId: NativeCaipAssetType;
    amount: BigNumber;
    purpose: 'BANDWIDTH' | 'ENERGY';
    srNodeAddress?: string;
    includeVote?: boolean;
  }): Promise<{ scope: Network; transactions: Transaction[] }> {
    const { chainId } = parseCaipAssetType(assetId);
    const scope = chainId as Network;
    const tronWeb = this.#tronWebFactory.createClient(scope);
    const amountInSun = Number(trxToSun(amount));
    const transactions: Transaction[] = [
      await tronWeb.transactionBuilder.freezeBalanceV2(
        amountInSun,
        purpose,
        account.address,
      ),
    ];

    if (includeVote) {
      const availableVotes = amount
        .integerValue(BigNumber.ROUND_DOWN)
        .toNumber();
      const voteRecipient = srNodeAddress ?? CONSENSYS_SR_NODE_ADDRESS;

      transactions.push(
        await tronWeb.transactionBuilder.vote(
          { [voteRecipient]: availableVotes },
          account.address,
        ),
      );
    }

    this.#logger.log(
      `Built ${transactions.length} staking transaction(s) for ${account.address}`,
    );

    return { scope, transactions };
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
    const { chainId } = parseCaipAssetType(assetId);
    const scope = chainId as Network;
    const tronWeb = this.#tronWebFactory.createClient(scope);

    return {
      scope,
      transactions: [
        await tronWeb.transactionBuilder.unfreezeBalanceV2(
          Number(trxToSun(amount)),
          this.#getUnstakePurpose(assetId),
          account.address,
        ),
      ],
    };
  }

  async buildClaimUnstakedTransactions({
    account,
    scope,
  }: {
    account: TronKeyringAccount;
    scope: Network;
  }): Promise<{ scope: Network; transactions: Transaction[] }> {
    const tronWeb = this.#tronWebFactory.createClient(scope);

    return {
      scope,
      transactions: [
        await tronWeb.transactionBuilder.withdrawExpireUnfreeze(
          account.address,
        ),
      ],
    };
  }

  async buildClaimRewardsTransactions({
    account,
    scope,
  }: {
    account: TronKeyringAccount;
    scope: Network;
  }): Promise<{ scope: Network; transactions: Transaction[] }> {
    const tronWeb = this.#tronWebFactory.createClient(scope);

    return {
      scope,
      transactions: [
        await tronWeb.transactionBuilder.withdrawBlockRewards(account.address),
      ],
    };
  }

  #getUnstakePurpose(assetId: StakedCaipAssetType): Resource {
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
}
