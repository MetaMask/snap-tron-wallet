import type { AssetEntity } from '../../entities/assets';
import type { IStateManager } from '../state/IStateManager';
import type { UnencryptedStateValue } from '../state/State';

export class AssetsRepository {
  readonly #state: IStateManager<UnencryptedStateValue>;

  constructor(state: IStateManager<UnencryptedStateValue>) {
    this.#state = state;
  }

  async getByAccountId(keyringAccountId: string): Promise<AssetEntity[]> {
    const assets = await this.#state.getKey<AssetEntity[]>(
      `assets.${keyringAccountId}`,
    );

    return assets ?? [];
  }

  async getByAccountIdAndAssetType(
    keyringAccountId: string,
    assetType: string,
  ): Promise<AssetEntity | null> {
    const assets = await this.getByAccountId(keyringAccountId);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    return assets.find((asset) => asset.assetType === assetType) ?? null;
  }

  /**
   * Get assets by account ID and asset types.
   *
   * @param keyringAccountId - The keyring account ID.
   * @param assetTypes - The asset types to filter by.
   * @returns An array of assets matching the criteria.
   */
  async getByAccountIdAndAssetTypes(
    keyringAccountId: string,
    assetTypes: string[],
  ): Promise<(AssetEntity | null)[]> {
    const assets = await this.getByAccountId(keyringAccountId);
    const result: (AssetEntity | null)[] = [];

    // We iterate through the assetTypes to preserve the order
    for (const assetType of assetTypes) {
      const asset = assets.find(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
        (currAsset) => currAsset.assetType === assetType,
      );
      result.push(asset ?? null);
    }

    return result;
  }

  async getAll(): Promise<AssetEntity[]> {
    const assetsByAccount =
      (await this.#state.getKey<UnencryptedStateValue['assets']>('assets')) ??
      {};

    return Object.values(assetsByAccount).flat();
  }

  async saveMany(assets: AssetEntity[]): Promise<void> {
    // Group assets by account to minimize state operations
    const assetsByAccount = assets.reduce<Record<string, AssetEntity[]>>(
      (acc, asset) => {
        const { keyringAccountId } = asset;
        acc[keyringAccountId] ??= [];
        acc[keyringAccountId].push(asset);
        return acc;
      },
      {},
    );

    // Update each account's assets
    await Promise.all(
      Object.entries(assetsByAccount).map(
        async ([keyringAccountId, newAssets]) => {
          const existingAssets =
            (await this.#state.getKey<AssetEntity[]>(
              `assets.${keyringAccountId}`,
            )) ?? [];

          const updatedAssets = [...existingAssets];

          // Update or add each asset
          newAssets.forEach((asset) => {
            // Avoid duplicates. If same asset is already saved, override it.
            const existingAssetIndex = updatedAssets.findIndex(
              (item) =>
                item.assetType === asset.assetType &&
                item.keyringAccountId === asset.keyringAccountId,
            );

            if (existingAssetIndex === -1) {
              updatedAssets.push(asset);
            } else {
              updatedAssets[existingAssetIndex] = asset;
            }
          });

          await this.#state.setKey(`assets.${keyringAccountId}`, updatedAssets);
        },
      ),
    );
  }
}
