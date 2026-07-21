/**
 * Asset data supplied by a Snap to the host AssetsController.
 *
 * This is intentionally local while the corresponding Core action is being
 * finalized.
 */
export type SnapAssetUpdate = {
  assetId: string;
  amount: string;
  metadata: {
    symbol: string;
    name: string;
    decimals: number;
    image?: string;
  };
};

export type AssetsControllerUpsertSnapAssetsAction = {
  type: 'AssetsController:upsertSnapAssets';
  handler: (
    accountId: string,
    chainId: string,
    assets: SnapAssetUpdate[],
  ) => Promise<void>;
};

export type AssetsControllerGetAssetAction = {
  type: 'AssetsController:getAsset';
  handler: (
    accountId: string,
    assetId: string,
  ) => Promise<
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
  >;
};

export type RemoteFeatureFlagControllerState = {
  remoteFeatureFlags: Record<string, unknown>;
};

export type RemoteFeatureFlagControllerGetStateAction = {
  type: 'RemoteFeatureFlagController:getState';
  handler: () => RemoteFeatureFlagControllerState;
};

export type WalletMessengerActions =
  | AssetsControllerUpsertSnapAssetsAction
  | AssetsControllerGetAssetAction
  | RemoteFeatureFlagControllerGetStateAction;

export type WalletMessengerActionType = WalletMessengerActions['type'];

type ActionHandlerMap = {
  [Action in WalletMessengerActions as Action['type']]: Action['handler'];
};

export type WalletMessengerCallArgs<Action extends WalletMessengerActionType> =
  Parameters<ActionHandlerMap[Action]>;

export type WalletMessengerCallReturn<
  Action extends WalletMessengerActionType,
> = ReturnType<ActionHandlerMap[Action]>;

export type WalletMessenger = {
  call: <Action extends WalletMessengerActionType>(
    action: Action,
    ...args: WalletMessengerCallArgs<Action>
  ) => WalletMessengerCallReturn<Action>;
};
