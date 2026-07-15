import type {
  RemoteFeatureFlagControllerState,
  SnapAssetUpdate,
  WalletMessenger,
  WalletMessengerActionType,
  WalletMessengerCallArgs,
  WalletMessengerCallReturn,
} from '../../types/wallet-messenger';

/** Thin, typed wrapper around the messenger endowment supplied by MetaMask. */
export class WalletMessengerClient {
  readonly #messenger: WalletMessenger | undefined;

  constructor(messenger: WalletMessenger | undefined) {
    this.#messenger = messenger;
  }

  isAvailable(): boolean {
    return typeof this.#messenger?.call === 'function';
  }

  call<Action extends WalletMessengerActionType>(
    action: Action,
    ...args: WalletMessengerCallArgs<Action>
  ): WalletMessengerCallReturn<Action> {
    const messenger = this.#messenger;

    if (!messenger || typeof messenger.call !== 'function') {
      throw new Error('Wallet messenger is not available');
    }

    return messenger.call(action, ...args);
  }

  async upsertSnapAssets(
    accountId: string,
    chainId: string,
    assets: SnapAssetUpdate[],
  ): Promise<void> {
    await this.call(
      'AssetsController:upsertSnapAssets',
      accountId,
      chainId,
      assets,
    );
  }

  async getAsset(
    accountId: string,
    assetId: string,
  ): Promise<
    | {
        amount: string;
        metadata?: {
          symbol: string;
          name: string;
          decimals: number;
          image?: string;
        };
      }
    | undefined
  > {
    return await this.call('AssetsController:getAsset', accountId, assetId);
  }

  async getRemoteFeatureFlagState(): Promise<RemoteFeatureFlagControllerState> {
    return await Promise.resolve(
      this.call('RemoteFeatureFlagController:getState'),
    );
  }
}
