/* eslint-disable no-restricted-globals */

import type { WalletMessengerClient } from '../../clients/wallet/WalletMessengerClient';

export enum MigrationStage {
  Off = 0,
  ReadAssetsControllerWithFallback = 1,
  ReadAssetsControllerWithoutFallback = 2,
  ReadAssetsControllerOnly = 3,
}

export const SNAPS_ASSETS_MIGRATION_FLAG = 'snapsAssetsMigration';

const STAGE_ENV_VAR = 'TRON_ASSETS_MIGRATION_STAGE';

const VALID_STAGES = [
  MigrationStage.Off,
  MigrationStage.ReadAssetsControllerWithFallback,
  MigrationStage.ReadAssetsControllerWithoutFallback,
  MigrationStage.ReadAssetsControllerOnly,
] as const;

const ENV_TO_STAGE: Record<string, MigrationStage> = {
  off: MigrationStage.Off,
  '0': MigrationStage.Off,
  'read-assets-controller-with-fallback':
    MigrationStage.ReadAssetsControllerWithFallback,
  '1': MigrationStage.ReadAssetsControllerWithFallback,
  'read-assets-controller-without-fallback':
    MigrationStage.ReadAssetsControllerWithoutFallback,
  '2': MigrationStage.ReadAssetsControllerWithoutFallback,
  'read-assets-controller-only': MigrationStage.ReadAssetsControllerOnly,
  '3': MigrationStage.ReadAssetsControllerOnly,
};

type SnapsAssetsMigrationFlag = {
  stages?: Partial<Record<string, MigrationStage>>;
  killSwitch?: boolean;
};

export type StageResolver = (chainId: string) => Promise<MigrationStage>;

/**
 * Returns true when the Snap is running outside production.
 *
 * @returns Whether the current build is non-production.
 */
function isDevEnvironment(): boolean {
  return process.env.ENVIRONMENT !== 'production';
}

/**
 * Reads the migration stage from `TRON_ASSETS_MIGRATION_STAGE`.
 *
 * @returns The configured stage, or `undefined` when unset or invalid.
 */
function resolveStageFromEnv(): MigrationStage | undefined {
  const rawStage = process.env[STAGE_ENV_VAR]?.trim().toLowerCase();

  if (rawStage && rawStage in ENV_TO_STAGE) {
    return ENV_TO_STAGE[rawStage];
  }

  return undefined;
}

/**
 * Extracts the migration stage for a chain from remote feature flags.
 *
 * @param remoteFeatureFlags - Remote feature flag payload from the wallet.
 * @param chainId - CAIP-2 chain id for the network.
 * @returns The configured stage, or `undefined` when absent or invalid.
 */
function parseStageFromRemoteFlags(
  remoteFeatureFlags: Record<string, unknown> | undefined,
  chainId: string,
): MigrationStage | undefined {
  if (!remoteFeatureFlags) {
    return undefined;
  }

  const flagValue = remoteFeatureFlags[SNAPS_ASSETS_MIGRATION_FLAG];

  if (!flagValue || typeof flagValue !== 'object') {
    return undefined;
  }

  const flag = flagValue as SnapsAssetsMigrationFlag;

  if (flag.killSwitch === true) {
    return MigrationStage.Off;
  }

  const stage = flag.stages?.[chainId];

  if (
    stage === undefined ||
    stage === null ||
    typeof stage !== 'number' ||
    !VALID_STAGES.includes(stage)
  ) {
    return undefined;
  }

  return stage;
}

/**
 * Resolves the assets migration stage for a network.
 *
 * Resolution order:
 * 1. `RemoteFeatureFlagController:getState` via wallet messenger (when available)
 * 2. `process.env.TRON_ASSETS_MIGRATION_STAGE` in non-production builds
 * 3. {@link MigrationStage.Off}
 *
 * @param chainId - CAIP-2 chain id for the network.
 * @param walletMessengerClient - Typed wallet messenger client.
 * @returns The resolved migration stage.
 */
export async function resolveStage(
  chainId: string,
  walletMessengerClient: WalletMessengerClient,
): Promise<MigrationStage> {
  const envStage = resolveStageFromEnv();

  if (walletMessengerClient.isAvailable()) {
    try {
      const state = await walletMessengerClient.getRemoteFeatureFlagState();
      const flagStage = parseStageFromRemoteFlags(
        state.remoteFeatureFlags,
        chainId,
      );

      if (flagStage !== undefined) {
        return flagStage;
      }
    } catch {
      // Fall through to env/default handling.
    }
  }

  if (isDevEnvironment() && envStage !== undefined) {
    return envStage;
  }

  return MigrationStage.Off;
}

/**
 * Creates a chain-scoped stage resolver bound to a messenger client.
 *
 * @param walletMessengerClient - Typed wallet messenger client.
 * @returns Async resolver for migration stages.
 */
export function createStageResolver(
  walletMessengerClient: WalletMessengerClient,
): StageResolver {
  return async (chainId: string) =>
    resolveStage(chainId, walletMessengerClient);
}

/**
 * Clears the dev env override. Intended for tests only.
 */
export function resetMigrationStageEnvForTests(): void {
  delete process.env[STAGE_ENV_VAR];
}
