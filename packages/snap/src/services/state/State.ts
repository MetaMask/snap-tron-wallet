import type { EntropySourceId, Transaction } from '@metamask/keyring-api';
import type { MutexInterface } from 'async-mutex';
import { Mutex } from 'async-mutex';
import { unset } from 'lodash';

import type { IStateManager } from './IStateManager';
import type { SpotPrices } from '../../clients/price-api/types';
import type { AssetEntity } from '../../entities/assets';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import baseLogger from '../../utils/logger';
import { safeMerge } from '../../utils/safeMerge';
import { deserialize } from '../../utils/serialization/deserialize';
import { serialize } from '../../utils/serialization/serialize';
import type { Serializable } from '../../utils/serialization/types';

export type AccountId = string;

export type KeyringAccountIndex = Record<
  EntropySourceId,
  Record<string, AccountId>
>;

export type UnencryptedStateValue = {
  keyringAccounts: Record<string, TronKeyringAccount>;
  keyringAccountIndex: KeyringAccountIndex;
  assets: Record<AccountId, AssetEntity[]>;
  tokenPrices: SpotPrices;
  transactions: Record<AccountId, Transaction[]>;
  mapInterfaceNameToId: Record<string, string>;
};

export const DEFAULT_UNENCRYPTED_STATE: UnencryptedStateValue = {
  keyringAccounts: {},
  keyringAccountIndex: {},
  assets: {},
  tokenPrices: {},
  transactions: {},
  mapInterfaceNameToId: {},
};

export type StateConfig<TValue extends Record<string, Serializable>> = {
  encrypted: boolean;
  defaultState: TValue;
};

/**
 * Logs elapsed execution time for performance debugging.
 *
 * @param operation - The operation being measured.
 * @param start - The timestamp captured before the operation started.
 * @param end - The timestamp captured after the operation completed.
 */
function logPerformance(
  operation: string,
  start: number,
  end = Date.now(),
): void {
  baseLogger.log(
    `[PERFORMANCE DEBUG - TRON SNAP] ${operation} took ${
      end - start
    } ms to execute`,
  );
}

/**
 * Returns a bounded operation suffix for state key performance logs.
 *
 * @param key - The state key being accessed.
 * @returns The normalized top-level state key.
 */
function getStateKeyOperationSuffix(key?: string): string {
  return (key?.split('.')[0] ?? 'ROOT')
    .replace(/[^a-z0-9]/giu, '_')
    .toUpperCase();
}

/**
 * Because we use both snap_manageState and snap_setState, we must protect against them being used at the same time.
 * We must also protect against multiple parallel requests to snap_manageState.
 * snap_setState, snap_getState etc does not have this limitation and can be accessed safely as long as
 * an ongoing manageState operation is not occurring.
 */
class StateLock {
  readonly #blobModificationMutex = new Mutex();

  readonly #regularStateUpdateMutex = new Mutex();

  readonly #regularStateWriteMutex = new Mutex();

  #pendingRegularStateUpdates = 0;

  #releaseRegularStateUpdateMutex: MutexInterface.Releaser | null = null;

  async #acquireRegularStateUpdateMutex(): Promise<void> {
    if (!this.#regularStateUpdateMutex.isLocked()) {
      this.#releaseRegularStateUpdateMutex =
        await this.#regularStateUpdateMutex.acquire();
    }
  }

  async wrapRegularStateOperation<ReturnType>(
    callback: MutexInterface.Worker<ReturnType>,
  ): Promise<ReturnType> {
    // If we are currently doing a full blob update, wait it out.
    // Signal that regular state operations are ongoing by acquring the mutex.
    // Other regular state operations can skip this, as they are safe to do in parallel.
    await Promise.all([
      this.#blobModificationMutex.waitForUnlock(),
      this.#acquireRegularStateUpdateMutex(),
    ]);

    try {
      this.#pendingRegularStateUpdates += 1;
      return await callback();
    } finally {
      this.#pendingRegularStateUpdates -= 1;

      if (
        this.#pendingRegularStateUpdates === 0 &&
        this.#releaseRegularStateUpdateMutex
      ) {
        this.#releaseRegularStateUpdateMutex();
      }
    }
  }

  async wrapRegularStateWriteOperation<ReturnType>(
    callback: MutexInterface.Worker<ReturnType>,
  ): Promise<ReturnType> {
    return await this.#regularStateWriteMutex.runExclusive(async () =>
      this.wrapRegularStateOperation(callback),
    );
  }

  async wrapManageStateOperation<ReturnType>(
    callback: MutexInterface.Worker<ReturnType>,
  ): Promise<ReturnType> {
    await this.#regularStateUpdateMutex.waitForUnlock();

    return await this.#blobModificationMutex.runExclusive(callback);
  }
}

/**
 * This class is a layer on top the the `snap_manageState` API that facilitates its usage:
 *
 * Basic usage:
 * - Get and update the sate of the snap
 *
 * Serialization:
 * - It serializes the data before storing it in the snap state because only JSON-assignable data can be stored.
 * - It deserializes the data after retrieving it from the snap state.
 * - So you don't need to worry about the data format when storing or retrieving data.
 *
 * Default values:
 * - It  merges the default state with the underlying snap state to ensure that we always have default values,
 * letting us avoid a ton of null checks everywhere.
 */
export class State<
  TStateValue extends Record<string, Serializable>,
> implements IStateManager<TStateValue> {
  readonly #lock = new StateLock();

  readonly #config: StateConfig<TStateValue>;

  constructor(config: StateConfig<TStateValue>) {
    this.#config = config;
  }

  async #unsafeGet(): Promise<TStateValue> {
    const getStateStart = Date.now();
    const snapGetStateStart = Date.now();
    const state = await snap.request({
      method: 'snap_getState',
      params: {
        encrypted: this.#config.encrypted,
      },
    });
    logPerformance('STATE_GET_SNAP_GET_STATE_ROOT', snapGetStateStart);

    const deserializeStart = Date.now();
    const stateDeserialized = deserialize(state ?? {}) as TStateValue;
    logPerformance('STATE_GET_DESERIALIZE_ROOT', deserializeStart);

    // Merge the default state with the underlying snap state
    // to ensure that we always have default values. It lets us avoid a ton of null checks everywhere.
    const mergeDefaultsStart = Date.now();
    const stateWithDefaults = safeMerge(
      this.#config.defaultState,
      stateDeserialized,
    );
    logPerformance('STATE_GET_MERGE_DEFAULTS_ROOT', mergeDefaultsStart);
    logPerformance('STATE_GET_TOTAL_ROOT', getStateStart);

    return stateWithDefaults;
  }

  async get(): Promise<TStateValue> {
    return this.#lock.wrapRegularStateOperation(async () => this.#unsafeGet());
  }

  async getKey<TResponse extends Serializable>(
    key: string,
  ): Promise<TResponse | undefined> {
    return this.#lock.wrapRegularStateOperation(async () => {
      const operationSuffix = getStateKeyOperationSuffix(key);
      const getKeyStart = Date.now();
      const snapGetStateStart = Date.now();
      const value = await snap.request({
        method: 'snap_getState',
        params: {
          key,
          encrypted: this.#config.encrypted,
        },
      });
      logPerformance(
        `STATE_GET_KEY_SNAP_GET_STATE_${operationSuffix}`,
        snapGetStateStart,
      );

      if (value === null) {
        logPerformance(`STATE_GET_KEY_TOTAL_${operationSuffix}`, getKeyStart);
        return undefined;
      }

      const deserializeStart = Date.now();
      const result = deserialize(value) as TResponse;
      logPerformance(
        `STATE_GET_KEY_DESERIALIZE_${operationSuffix}`,
        deserializeStart,
      );
      logPerformance(`STATE_GET_KEY_TOTAL_${operationSuffix}`, getKeyStart);

      return result;
    });
  }

  async setKey(key: string, value: Serializable): Promise<void> {
    await this.#lock.wrapRegularStateWriteOperation(async () => {
      const operationSuffix = getStateKeyOperationSuffix(key);
      const setKeyStart = Date.now();
      const serializeStart = Date.now();
      const serializedValue = serialize(value);
      logPerformance(
        `STATE_SET_KEY_SERIALIZE_${operationSuffix}`,
        serializeStart,
      );

      const snapSetStateStart = Date.now();
      await snap.request({
        method: 'snap_setState',
        params: {
          key,
          value: serializedValue,
          encrypted: this.#config.encrypted,
        },
      });
      logPerformance(
        `STATE_SET_KEY_SNAP_SET_STATE_${operationSuffix}`,
        snapSetStateStart,
      );
      logPerformance(`STATE_SET_KEY_TOTAL_${operationSuffix}`, setKeyStart);
    });
  }

  async setKeyWith<TValue extends Serializable>(
    key: string,
    updater: (currentValue: TValue | undefined) => TValue,
  ): Promise<void> {
    await this.#lock.wrapRegularStateWriteOperation(async () => {
      const operationSuffix = getStateKeyOperationSuffix(key);
      const setKeyWithStart = Date.now();
      const snapGetStateStart = Date.now();
      const rawValue = await snap.request({
        method: 'snap_getState',
        params: {
          key,
          encrypted: this.#config.encrypted,
        },
      });
      logPerformance(
        `STATE_SET_KEY_WITH_SNAP_GET_STATE_${operationSuffix}`,
        snapGetStateStart,
      );

      const deserializeStart = Date.now();
      const oldValue =
        rawValue === null ? undefined : (deserialize(rawValue) as TValue);
      logPerformance(
        `STATE_SET_KEY_WITH_DESERIALIZE_${operationSuffix}`,
        deserializeStart,
      );

      const updaterStart = Date.now();
      const newValue = updater(oldValue);
      logPerformance(
        `STATE_SET_KEY_WITH_UPDATER_${operationSuffix}`,
        updaterStart,
      );

      const serializeStart = Date.now();
      const serializedValue = serialize(newValue);
      logPerformance(
        `STATE_SET_KEY_WITH_SERIALIZE_${operationSuffix}`,
        serializeStart,
      );

      const snapSetStateStart = Date.now();
      await snap.request({
        method: 'snap_setState',
        params: {
          key,
          value: serializedValue,
          encrypted: this.#config.encrypted,
        },
      });
      logPerformance(
        `STATE_SET_KEY_WITH_SNAP_SET_STATE_${operationSuffix}`,
        snapSetStateStart,
      );
      logPerformance(
        `STATE_SET_KEY_WITH_TOTAL_${operationSuffix}`,
        setKeyWithStart,
      );
    });
  }

  async update(
    updaterFunction: (state: TStateValue) => TStateValue,
  ): Promise<TStateValue> {
    // Because this function modifies the entire state blob,
    // we must protect against parallel requests.
    return await this.#lock.wrapManageStateOperation(async () => {
      const currentState = await this.#unsafeGet();

      const newState = updaterFunction(currentState);

      // Generally we should try to use snap_getState and snap_setState over this
      // as snap_manageState is slower and error-prone due to requiring manual mutex management.
      await snap.request({
        method: 'snap_manageState',
        params: {
          operation: 'update',
          newState: serialize(newState),
          encrypted: this.#config.encrypted,
        },
      });

      return newState;
    });
  }

  async deleteKey(key: string): Promise<void> {
    await this.update((state) => {
      // Using lodash's unset to leverage the json path capabilities
      unset(state, key);
      return state;
    });
  }

  async deleteKeys(keys: string[]): Promise<void> {
    await this.update((state) => {
      keys.forEach((key) => {
        unset(state, key);
      });
      return state;
    });
  }
}
