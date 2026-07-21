/* eslint-disable no-restricted-globals */

import {
  MigrationStage,
  resetMigrationStageEnvForTests,
  resolveStage,
  shouldPushSnapAssets,
} from './stage';
import { WalletMessengerClient } from '../../clients/wallet/WalletMessengerClient';

const CHAIN_ID = 'tron:728126428';

describe('resolveStage', () => {
  const originalEnvironment = process.env.ENVIRONMENT;

  beforeEach(() => {
    process.env.ENVIRONMENT = 'local';
    resetMigrationStageEnvForTests();
  });

  afterEach(() => {
    process.env.ENVIRONMENT = originalEnvironment;
    resetMigrationStageEnvForTests();
  });

  it('returns Off by default when messenger is unavailable', async () => {
    const client = new WalletMessengerClient(undefined);

    expect(await resolveStage(CHAIN_ID, client)).toBe(MigrationStage.Off);
  });

  it('returns ReadAssetsControllerWithFallback from remote flag', async () => {
    const messenger = {
      call: jest.fn().mockReturnValue({
        remoteFeatureFlags: {
          snapsAssetsMigration: {
            stages: {
              [CHAIN_ID]: MigrationStage.ReadAssetsControllerWithFallback,
            },
          },
        },
      }),
    };
    const client = new WalletMessengerClient(messenger);

    expect(await resolveStage(CHAIN_ID, client)).toBe(
      MigrationStage.ReadAssetsControllerWithFallback,
    );
  });

  it('returns ReadAssetsControllerWithoutFallback from remote flag', async () => {
    const messenger = {
      call: jest.fn().mockReturnValue({
        remoteFeatureFlags: {
          snapsAssetsMigration: {
            stages: {
              [CHAIN_ID]: MigrationStage.ReadAssetsControllerWithoutFallback,
            },
          },
        },
      }),
    };
    const client = new WalletMessengerClient(messenger);

    expect(await resolveStage(CHAIN_ID, client)).toBe(
      MigrationStage.ReadAssetsControllerWithoutFallback,
    );
  });

  it('returns ReadAssetsControllerOnly from remote flag', async () => {
    const messenger = {
      call: jest.fn().mockReturnValue({
        remoteFeatureFlags: {
          snapsAssetsMigration: {
            stages: { [CHAIN_ID]: MigrationStage.ReadAssetsControllerOnly },
          },
        },
      }),
    };
    const client = new WalletMessengerClient(messenger);

    expect(await resolveStage(CHAIN_ID, client)).toBe(
      MigrationStage.ReadAssetsControllerOnly,
    );
  });

  it('returns Off when killSwitch is true', async () => {
    const messenger = {
      call: jest.fn().mockReturnValue({
        remoteFeatureFlags: {
          snapsAssetsMigration: {
            killSwitch: true,
            stages: { [CHAIN_ID]: MigrationStage.ReadAssetsControllerOnly },
          },
        },
      }),
    };
    const client = new WalletMessengerClient(messenger);

    expect(await resolveStage(CHAIN_ID, client)).toBe(MigrationStage.Off);
  });

  it('returns Off when remote flag is missing', async () => {
    const messenger = {
      call: jest.fn().mockReturnValue({
        remoteFeatureFlags: {},
      }),
    };
    const client = new WalletMessengerClient(messenger);

    expect(await resolveStage(CHAIN_ID, client)).toBe(MigrationStage.Off);
  });

  it('returns Off for malformed remote flag values', async () => {
    const messenger = {
      call: jest.fn().mockReturnValue({
        remoteFeatureFlags: {
          snapsAssetsMigration: {
            stages: { [CHAIN_ID]: 99 },
          },
        },
      }),
    };
    const client = new WalletMessengerClient(messenger);

    expect(await resolveStage(CHAIN_ID, client)).toBe(MigrationStage.Off);
  });

  it('falls back to TRON_ASSETS_MIGRATION_STAGE in dev when messenger is unavailable', async () => {
    process.env.TRON_ASSETS_MIGRATION_STAGE =
      'read-assets-controller-with-fallback';
    const client = new WalletMessengerClient(undefined);

    expect(await resolveStage(CHAIN_ID, client)).toBe(
      MigrationStage.ReadAssetsControllerWithFallback,
    );
  });

  it('falls back to env when messenger read fails in dev', async () => {
    process.env.TRON_ASSETS_MIGRATION_STAGE = '2';
    const messenger = {
      call: jest.fn().mockImplementation(() => {
        throw new Error('messenger unavailable');
      }),
    };
    const client = new WalletMessengerClient(messenger);

    expect(await resolveStage(CHAIN_ID, client)).toBe(
      MigrationStage.ReadAssetsControllerWithoutFallback,
    );
  });

  it('ignores env override in production', async () => {
    process.env.ENVIRONMENT = 'production';
    process.env.TRON_ASSETS_MIGRATION_STAGE = '3';
    const client = new WalletMessengerClient(undefined);

    expect(await resolveStage(CHAIN_ID, client)).toBe(MigrationStage.Off);
  });
});

describe('shouldPushSnapAssets', () => {
  it('returns false only when migration is off', () => {
    expect(shouldPushSnapAssets(MigrationStage.Off)).toBe(false);
    expect(
      shouldPushSnapAssets(MigrationStage.ReadAssetsControllerWithFallback),
    ).toBe(true);
  });
});
