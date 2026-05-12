import { parseCaipAssetType } from '@metamask/utils';
import { BigNumber } from 'bignumber.js';
import type { TronWeb } from 'tronweb';
import type { Resource } from 'tronweb/lib/esm/types';

import type { SnapClient } from '../../clients/snap/SnapClient';
import type { TronWebFactory } from '../../clients/tronweb/TronWebFactory';
import type { Network } from '../../constants';
import { CONSENSYS_SR_NODE_ADDRESS, KnownCaip19Id } from '../../constants';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import { trxToSun } from '../../utils/conversion';
import { executeOnChainActions } from '../../utils/executeOnChainActions';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';
import type { AccountsService } from '../accounts/AccountsService';
import type { NativeCaipAssetType, StakedCaipAssetType } from '../assets/types';

export class StakingService {
  readonly #logger: ILogger;

  readonly #accountsService: AccountsService;

  readonly #tronWebFactory: TronWebFactory;

  readonly #snapClient: SnapClient;

  constructor({
    logger,
    accountsService,
    tronWebFactory,
    snapClient,
  }: {
    logger: ILogger;
    accountsService: AccountsService;
    tronWebFactory: TronWebFactory;
    snapClient: SnapClient;
  }) {
    this.#logger = createPrefixedLogger(logger, '[💸 StakingService]');
    this.#accountsService = accountsService;
    this.#tronWebFactory = tronWebFactory;
    this.#snapClient = snapClient;
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
    /**
     * Optional SR node address to allocate votes to.
     * If not provided, defaults to the Consensys SR node.
     */
    srNodeAddress?: string;
    includeVote?: boolean;
  }): Promise<{ scope: Network; transactions: unknown[] }> {
    const { chainId } = parseCaipAssetType(assetId);
    const scope = chainId as Network;
    const tronWeb = this.#tronWebFactory.createClient(scope);

    return {
      scope,
      transactions: await this.#buildStakeTransactions({
        tronWeb,
        account,
        amount,
        purpose,
        srNodeAddress,
        includeVote,
      }),
    };
  }

  async buildUnstakeTransactions({
    account,
    assetId,
    amount,
  }: {
    account: TronKeyringAccount;
    assetId: StakedCaipAssetType;
    amount: BigNumber;
  }): Promise<{ scope: Network; transactions: unknown[] }> {
    const { chainId } = parseCaipAssetType(assetId);
    const scope = chainId as Network;
    const tronWeb = this.#tronWebFactory.createClient(scope);

    return {
      scope,
      transactions: await this.#buildUnstakeTransactions({
        tronWeb,
        account,
        assetId,
        amount,
      }),
    };
  }

  async buildClaimUnstakedTransactions({
    account,
    scope,
  }: {
    account: TronKeyringAccount;
    scope: Network;
  }): Promise<{ scope: Network; transactions: unknown[] }> {
    const tronWeb = this.#tronWebFactory.createClient(scope);

    return {
      scope,
      transactions: await this.#buildClaimUnstakedTransactions({
        tronWeb,
        account,
      }),
    };
  }

  async buildClaimRewardsTransactions({
    account,
    scope,
  }: {
    account: TronKeyringAccount;
    scope: Network;
  }): Promise<{ scope: Network; transactions: unknown[] }> {
    const tronWeb = this.#tronWebFactory.createClient(scope);

    return {
      scope,
      transactions: await this.#buildClaimRewardsTransactions({
        tronWeb,
        account,
      }),
    };
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

    await executeOnChainActions({
      accountsService: this.#accountsService,
      tronWebFactory: this.#tronWebFactory,
      snapClient: this.#snapClient,
      account,
      scope: chainId as Network,
      buildTransactions: async (tronWeb) =>
        this.#buildStakeTransactions({
          tronWeb,
          account,
          amount,
          purpose,
          srNodeAddress,
          includeVote: true,
        }),
    });
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

    await executeOnChainActions({
      accountsService: this.#accountsService,
      tronWebFactory: this.#tronWebFactory,
      snapClient: this.#snapClient,
      account,
      scope: chainId as Network,
      buildTransactions: async (tronWeb) =>
        this.#buildUnstakeTransactions({
          tronWeb,
          account,
          assetId,
          amount,
        }),
    });
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

    await executeOnChainActions({
      accountsService: this.#accountsService,
      tronWebFactory: this.#tronWebFactory,
      snapClient: this.#snapClient,
      account,
      scope,
      buildTransactions: async (tronWeb) =>
        this.#buildClaimUnstakedTransactions({ tronWeb, account }),
    });
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

    await executeOnChainActions({
      accountsService: this.#accountsService,
      tronWebFactory: this.#tronWebFactory,
      snapClient: this.#snapClient,
      account,
      scope,
      buildTransactions: async (tronWeb) =>
        this.#buildClaimRewardsTransactions({ tronWeb, account }),
    });
  }

  async #buildStakeTransactions({
    tronWeb,
    account,
    amount,
    purpose,
    srNodeAddress,
    includeVote,
  }: {
    tronWeb: TronWeb;
    account: TronKeyringAccount;
    amount: BigNumber;
    purpose: 'BANDWIDTH' | 'ENERGY';
    srNodeAddress?: string;
    includeVote: boolean;
  }): Promise<unknown[]> {
    const amountInSun = Number(trxToSun(amount));
    const transactions: unknown[] = [
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

    return transactions;
  }

  async #buildUnstakeTransactions({
    tronWeb,
    account,
    assetId,
    amount,
  }: {
    tronWeb: TronWeb;
    account: TronKeyringAccount;
    assetId: StakedCaipAssetType;
    amount: BigNumber;
  }): Promise<unknown[]> {
    const purpose = this.#getUnstakePurpose(assetId);
    const amountInSun = Number(trxToSun(amount));

    return [
      await tronWeb.transactionBuilder.unfreezeBalanceV2(
        amountInSun,
        purpose,
        account.address,
      ),
    ];
  }

  async #buildClaimUnstakedTransactions({
    tronWeb,
    account,
  }: {
    tronWeb: TronWeb;
    account: TronKeyringAccount;
  }): Promise<unknown[]> {
    return [
      await tronWeb.transactionBuilder.withdrawExpireUnfreeze(account.address),
    ];
  }

  async #buildClaimRewardsTransactions({
    tronWeb,
    account,
  }: {
    tronWeb: TronWeb;
    account: TronKeyringAccount;
  }): Promise<unknown[]> {
    return [
      await tronWeb.transactionBuilder.withdrawBlockRewards(account.address),
    ];
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
