import { parseCaipAssetType } from '@metamask/utils';
import type { CaipAssetType } from '@metamask/utils';

import { MigrationStage, type StageResolver } from './stage';
import type { WalletMessengerClient } from '../../clients/wallet/WalletMessengerClient';
import { type Network, TokenMetadata } from '../../constants';
import type { AssetEntity } from '../../entities/assets';
import type { SnapAssetUpdate } from '../../types/wallet-messenger';
import { toUiAmount } from '../../utils/conversion';

/**
 * Boundary between Tron asset synchronization and the host AssetsController.
 *
 * Resource and staking pseudo-assets are deliberately not filtered here: the
 * controller receives the complete snapshot supplied by the Snap.
 */
export class TronAssetsControllerAdapter {
  readonly #walletMessengerClient: WalletMessengerClient;

  readonly #resolveStage: StageResolver;

  #currentStage: MigrationStage = MigrationStage.Off;

  constructor(
    walletMessengerClient: WalletMessengerClient,
    resolveStage: StageResolver,
  ) {
    this.#walletMessengerClient = walletMessengerClient;
    this.#resolveStage = resolveStage;
  }

  async getMigrationStage(chainId: string): Promise<MigrationStage> {
    await this.resolveAndSetStage(chainId);
    return this.getCurrentStage();
  }

  async resolveAndSetStage(chainId: string): Promise<void> {
    this.#currentStage = await this.#resolveStage(chainId);
  }

  getCurrentStage(): MigrationStage {
    return this.#currentStage;
  }

  async pushAssetSnapshot(
    accountId: string,
    chainId: string,
    assets: SnapAssetUpdate[],
  ): Promise<void> {
    await this.#walletMessengerClient.upsertSnapAssets(
      accountId,
      chainId,
      assets,
    );
  }

  async getAsset(
    accountId: string,
    assetId: string,
  ): Promise<AssetEntity | null> {
    const result = await this.#walletMessengerClient.getAsset(
      accountId,
      assetId,
    );

    if (!result) {
      return null;
    }

    return this.#mapToAssetEntity(accountId, assetId, result);
  }

  #mapToAssetEntity(
    accountId: string,
    assetId: string,
    result: {
      amount: string;
      metadata?: {
        symbol: string;
        name: string;
        decimals: number;
        image?: string;
      };
    },
  ): AssetEntity {
    const { chainId } = parseCaipAssetType(assetId as CaipAssetType);
    const knownMetadata = TokenMetadata[assetId as keyof typeof TokenMetadata];

    const decimals = result.metadata?.decimals ?? knownMetadata?.decimals ?? 0;
    const symbol = result.metadata?.symbol ?? knownMetadata?.symbol ?? '';
    const iconUrl = result.metadata?.image ?? knownMetadata?.iconUrl ?? '';

    return {
      assetType: assetId,
      keyringAccountId: accountId,
      network: chainId as Network,
      symbol,
      decimals,
      rawAmount: result.amount,
      uiAmount: toUiAmount(result.amount, decimals).toString(),
      iconUrl,
    } as AssetEntity;
  }
}
