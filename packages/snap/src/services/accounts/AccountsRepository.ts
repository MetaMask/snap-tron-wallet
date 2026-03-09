import type { TronKeyringAccount } from '../../entities/keyring-account';
import type { IStateManager } from '../state/IStateManager';
import type { UnencryptedStateValue } from '../state/State';

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

  async findById(id: string): Promise<TronKeyringAccount | null> {
    const accounts = await this.getAll();
    return accounts.find((account) => account.id === id) ?? null;
  }

  /**
   * Returns all accounts whose IDs are in the given list.
   * Order is not guaranteed to match the input array.
   * If an account is not found, it is not included in the result.
   *
   * @param ids - The IDs of the accounts to find.
   * @returns The matching accounts.
   */
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

  async delete(id: string): Promise<void> {
    await Promise.all([
      this.#state.deleteKey(`${this.#storageKey}.${id}`),
      this.#state.deleteKey(`assets.${id}`),
      this.#state.deleteKey(`transactions.${id}`),
    ]);
  }
}
