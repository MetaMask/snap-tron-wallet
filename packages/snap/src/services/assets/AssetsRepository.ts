import { cloneDeep } from 'lodash';

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

  /**
   * Persist the latest asset snapshots grouped by account and network.
   *
   * Each input batch is treated as the full current snapshot for the
   * corresponding account/network pairs. Assets missing from a refreshed
   * network slice are removed, while assets for other networks are preserved.
   *
   * @param assets - The latest asset snapshots to persist.
   */
  async saveMany(assets: AssetEntity[]): Promise<void> {
    // Update the state atomically
    await this.#state.update((stateValue) => {
      const newState = cloneDeep(stateValue);
      const assetsByAccountAndNetwork = new Map<
        string,
        Map<AssetEntity['network'], AssetEntity[]>
      >();

      // Group the incoming batch by account and network so each network slice
      // can be replaced independently in the persisted state.
      for (const asset of assets) {
        const groupedByNetwork =
          assetsByAccountAndNetwork.get(asset.keyringAccountId) ?? new Map();
        const groupedAssets = groupedByNetwork.get(asset.network) ?? [];

        groupedAssets.push(asset);
        groupedByNetwork.set(asset.network, groupedAssets);
        assetsByAccountAndNetwork.set(asset.keyringAccountId, groupedByNetwork);
      }

      for (const [
        keyringAccountId,
        groupedByNetwork,
      ] of assetsByAccountAndNetwork) {
        let accountAssets = cloneDeep(newState.assets[keyringAccountId] ?? []);

        for (const [network, groupedAssets] of groupedByNetwork) {
          // Each sync batch is the full latest snapshot for one account/network pair.
          // Replace only that network slice and preserve assets from other networks.
          const assetsForOtherNetworks = accountAssets.filter(
            (item) => item.network !== network,
          );

          // Rebuild the account state from the untouched network slices plus the
          // latest snapshot for the network we just refreshed.
          accountAssets = [...assetsForOtherNetworks, ...groupedAssets];
        }

        newState.assets[keyringAccountId] = accountAssets;
      }
      return newState;
    });
  }
}
