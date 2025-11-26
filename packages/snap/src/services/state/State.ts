import type { Transaction } from '@metamask/keyring-api';

import type { IStateManager } from './IStateManager';
import type { SpotPrices } from '../../clients/price-api/types';
import type { TronKeyringAccount } from '../../entities';
import type { AssetEntity } from '../../entities/assets';
import { safeMerge } from '../../utils/safeMerge';
import { deserialize } from '../../utils/serialization/deserialize';
import { serialize } from '../../utils/serialization/serialize';
import type { Serializable } from '../../utils/serialization/types';

export type AccountId = string;

export type UnencryptedStateValue = {
  keyringAccounts: Record<string, TronKeyringAccount>;
  assets: Record<AccountId, AssetEntity[]>;
  tokenPrices: SpotPrices;
  transactions: Record<AccountId, Transaction[]>;
  mapInterfaceNameToId: Record<string, string>;
};

export const DEFAULT_UNENCRYPTED_STATE: UnencryptedStateValue = {
  keyringAccounts: {},
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
 * This class is a layer on top the the `snap_getState` and `snap_setState` APIs that facilitates their usage:
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
export class State<TStateValue extends Record<string, Serializable>>
  implements IStateManager<TStateValue>
{
  readonly #config: StateConfig<TStateValue>;

  constructor(config: StateConfig<TStateValue>) {
    this.#config = config;
  }

  async get(): Promise<TStateValue> {
    const state = await snap.request({
      method: 'snap_getState',
      params: {
        encrypted: this.#config.encrypted,
      },
    });

    const stateDeserialized = deserialize(state ?? {}) as TStateValue;

    // Merge the default state with the underlying snap state
    // to ensure that we always have default values. It lets us avoid a ton of null checks everywhere.
    const stateWithDefaults = safeMerge(
      this.#config.defaultState,
      stateDeserialized,
    );

    return stateWithDefaults;
  }

  async getKey<TResponse extends Serializable>(
    key: string,
  ): Promise<TResponse | undefined> {
    const value = await snap.request({
      method: 'snap_getState',
      params: {
        key,
        encrypted: this.#config.encrypted,
      },
    });

    if (value === null) {
      return undefined;
    }

    return deserialize(value) as TResponse;
  }

  async setKey(key: string, value: Serializable): Promise<void> {
    await snap.request({
      method: 'snap_setState',
      params: {
        key,
        value: serialize(value),
        encrypted: this.#config.encrypted,
      },
    });
  }

  async deleteKey(key: string): Promise<void> {
    return this.setKey(key, undefined);
  }

  async deleteKeys(keys: string[]): Promise<void> {
    await Promise.all(keys.map(async (key) => this.deleteKey(key)));
  }
}
