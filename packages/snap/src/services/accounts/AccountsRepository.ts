import type { EntropySourceId } from '@metamask/keyring-api';

import type { TronKeyringAccount } from '../../entities/keyring-account';
import type { IStateManager } from '../state/IStateManager';
import type { UnencryptedStateValue } from '../state/State';

/**
 * Range of inclusive account indices to create.
 *
 * @param from - The starting index.
 * @param to - The ending index.
 */
type AccountCreationRange = {
  from: number;
  to: number;
};

export class AccountsRepository {
  readonly #storageKey = 'keyringAccounts';

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
    >(this.#storageKey);

    return Object.values(accounts ?? {});
  }

  /**
   * Returns accounts matching an entropy source and inclusive index range.
   *
   * @param entropySource - Entropy source to match.
   * @param range - Inclusive group index range to match.
   * @returns Matching accounts in ascending index order.
   */
  async findByEntropySourceAndRange(
    entropySource: EntropySourceId,
    range: AccountCreationRange,
  ): Promise<TronKeyringAccount[]> {
    const accounts = await this.getAll();

    return accounts
      .filter(
        (account) =>
          account.entropySource === entropySource &&
          account.index >= range.from &&
          account.index <= range.to,
      )
      .sort((first, second) => first.index - second.index);
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
    await this.#state.setKey(`${this.#storageKey}.${account.id}`, account);

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
      this.#storageKey,
      (current) => ({
        ...(current ?? {}),
        ...newAccounts,
      }),
    );
  }

  async delete(id: string): Promise<void> {
    await Promise.all([
      this.#state.deleteKey(`${this.#storageKey}.${id}`),
      this.#state.deleteKey(`assets.${id}`),
      this.#state.deleteKey(`transactions.${id}`),
    ]);
  }
}
