import type { EntropySourceId } from '@metamask/keyring-api';

import type { TronKeyringAccount } from '../../entities/keyring-account';
import type { IStateManager } from '../state/IStateManager';
import type {
  KeyringAccountIndex,
  UnencryptedStateValue,
} from '../state/State';

type AccountCreationRange = {
  from: number;
  to: number;
};

export class AccountsRepository {
  readonly #accountsStorageKey = 'keyringAccounts';

  readonly #accountIndexStorageKey = 'keyringAccountIndex';

  readonly #state: IStateManager<UnencryptedStateValue>;

  constructor(state: IStateManager<UnencryptedStateValue>) {
    this.#state = state;
  }

  /**
   * Returns all accounts from the state.
   *
   * @returns All accounts from the state.
   */
  async getAll(): Promise<TronKeyringAccount[]> {
    const accounts = await this.#state.getKey<
      UnencryptedStateValue['keyringAccounts']
    >(this.#accountsStorageKey);

    return Object.values(accounts ?? {});
  }

  /**
   * Returns accounts matching an entropy source and inclusive index range.
   *
   * This prefers the compact account index so callers do not have to read the
   * entire `keyringAccounts` object. If the index is absent or has no entry
   * for the requested entropy source, it falls back to the legacy full read
   * once and stores a rebuilt index for future calls.
   *
   * @param entropySource - Entropy source to match.
   * @param range - Inclusive group index range to match.
   * @returns Matching accounts in ascending index order.
   */
  async findByEntropySourceAndRange(
    entropySource: EntropySourceId,
    range: AccountCreationRange,
  ): Promise<TronKeyringAccount[]> {
    const accountIndex = await this.#getKeyringAccountIndex();

    if (accountIndex?.[entropySource] === undefined) {
      const accounts = await this.getAll();
      await this.#mergeRebuiltKeyringAccountIndex(
        this.#buildKeyringAccountIndex(accounts, entropySource),
      );

      return accounts
        .filter(
          (account) =>
            account.entropySource === entropySource &&
            account.index >= range.from &&
            account.index <= range.to,
        )
        .sort((first, second) => first.index - second.index);
    }

    const accountIdsByIndex = accountIndex[entropySource] ?? {};
    const indexedAccounts = await Promise.all(
      this.#getAccountIdsInRange(accountIdsByIndex, range).map(
        async ([index, accountId]) => {
          const account = await this.#state.getKey<TronKeyringAccount>(
            `${this.#accountsStorageKey}.${accountId}`,
          );

          return account &&
            account.entropySource === entropySource &&
            account.index === index
            ? account
            : undefined;
        },
      ),
    );

    return indexedAccounts.filter(
      (account): account is TronKeyringAccount => account !== undefined,
    );
  }

  async findById(id: string): Promise<TronKeyringAccount | null> {
    const accounts = await this.getAll();
    return accounts.find((account) => account.id === id) ?? null;
  }

  async findByIds(ids: string[]): Promise<TronKeyringAccount[]> {
    const accounts = await this.getAll();
    return accounts.filter((account) => ids.includes(account.id));
  }

  async findByAddress(address: string): Promise<TronKeyringAccount | null> {
    const accounts = await this.getAll();

    return accounts.find((account) => account.address === address) ?? null;
  }

  async create(account: TronKeyringAccount): Promise<TronKeyringAccount> {
    await this.#state.setKey(
      `${this.#accountsStorageKey}.${account.id}`,
      account,
    );
    await this.#mergeKeyringAccountIndex({ [account.id]: account });

    return account;
  }

  /**
   * Merges multiple keyring accounts into `keyringAccounts` in a single atomic state update.
   *
   * @param newAccounts - The new accounts to merge.
   */
  async mergeKeyringAccounts(
    newAccounts: Record<string, TronKeyringAccount>,
  ): Promise<void> {
    await this.#state.setKeyWith<Record<string, TronKeyringAccount>>(
      this.#accountsStorageKey,
      (current) => ({
        ...(current ?? {}),
        ...newAccounts,
      }),
    );
    await this.#mergeKeyringAccountIndex(newAccounts);
  }

  async delete(id: string): Promise<void> {
    const account = await this.#state.getKey<TronKeyringAccount>(
      `${this.#accountsStorageKey}.${id}`,
    );

    await Promise.all([
      this.#state.deleteKey(`${this.#accountsStorageKey}.${id}`),
      this.#state.deleteKey(`assets.${id}`),
      this.#state.deleteKey(`transactions.${id}`),
    ]);

    if (account) {
      await this.#removeFromKeyringAccountIndex(account);
    }
  }

  async #getKeyringAccountIndex(): Promise<KeyringAccountIndex | undefined> {
    return await this.#state.getKey<KeyringAccountIndex>(
      this.#accountIndexStorageKey,
    );
  }

  async #mergeRebuiltKeyringAccountIndex(
    rebuiltIndex: KeyringAccountIndex,
  ): Promise<void> {
    await this.#state.setKeyWith<KeyringAccountIndex>(
      this.#accountIndexStorageKey,
      (current) =>
        this.#mergeKeyringAccountIndexValues(rebuiltIndex, current ?? {}),
    );
  }

  async #mergeKeyringAccountIndex(
    accounts: Record<string, TronKeyringAccount>,
  ): Promise<void> {
    await this.#state.setKeyWith<KeyringAccountIndex>(
      this.#accountIndexStorageKey,
      (current) => {
        const accountIndex = { ...(current ?? {}) };

        for (const account of Object.values(accounts)) {
          accountIndex[account.entropySource] = {
            ...(accountIndex[account.entropySource] ?? {}),
            [account.index]: account.id,
          };
        }

        return accountIndex;
      },
    );
  }

  async #removeFromKeyringAccountIndex(
    account: TronKeyringAccount,
  ): Promise<void> {
    await this.#state.setKeyWith<KeyringAccountIndex>(
      this.#accountIndexStorageKey,
      (current) => {
        const entropySourceIndex = {
          ...(current?.[account.entropySource] ?? {}),
        };
        delete entropySourceIndex[account.index];

        return {
          ...(current ?? {}),
          [account.entropySource]: entropySourceIndex,
        };
      },
    );
  }

  #buildKeyringAccountIndex(
    accounts: TronKeyringAccount[],
    ensureEntropySource?: EntropySourceId,
  ): KeyringAccountIndex {
    const accountIndex = accounts.reduce<KeyringAccountIndex>(
      (index, account) => {
        index[account.entropySource] = {
          ...(index[account.entropySource] ?? {}),
          [account.index]: account.id,
        };

        return index;
      },
      {},
    );

    if (ensureEntropySource) {
      accountIndex[ensureEntropySource] ??= {};
    }

    return accountIndex;
  }

  #mergeKeyringAccountIndexValues(
    ...accountIndexes: KeyringAccountIndex[]
  ): KeyringAccountIndex {
    const mergedAccountIndex: KeyringAccountIndex = {};

    for (const accountIndex of accountIndexes) {
      for (const [entropySource, accountIdsByIndex] of Object.entries(
        accountIndex,
      )) {
        mergedAccountIndex[entropySource] = {
          ...(mergedAccountIndex[entropySource] ?? {}),
          ...accountIdsByIndex,
        };
      }
    }

    return mergedAccountIndex;
  }

  #getAccountIdsInRange(
    accountIdsByIndex: Record<string, string>,
    range: AccountCreationRange,
  ): [number, string][] {
    const accountIds: [number, string][] = [];

    for (let index = range.from; index <= range.to; index += 1) {
      const accountId = accountIdsByIndex[index];

      if (accountId) {
        accountIds.push([index, accountId]);
      }
    }

    return accountIds;
  }
}
