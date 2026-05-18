import { TrxAccountType, TrxScope } from '@metamask/keyring-api';

import { AccountsRepository } from './AccountsRepository';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import type { Serializable } from '../../utils/serialization/types';
import { InMemoryState } from '../state/InMemoryState';
import type {
  KeyringAccountIndex,
  UnencryptedStateValue,
} from '../state/State';
import { DEFAULT_UNENCRYPTED_STATE } from '../state/State';

/**
 * Creates a test keyring account.
 *
 * @param overrides - Account fields to override.
 * @returns A test keyring account.
 */
function createAccount(
  overrides: Partial<TronKeyringAccount>,
): TronKeyringAccount {
  return {
    id: 'account-0',
    entropySource: 'test-entropy',
    derivationPath: "m/44'/195'/0'/0/0",
    index: 0,
    type: TrxAccountType.Eoa,
    address: 'TTestAddress',
    scopes: [TrxScope.Mainnet, TrxScope.Nile, TrxScope.Shasta],
    options: {},
    methods: ['signMessage', 'signTransaction'],
    ...overrides,
  };
}

/**
 * Creates mutable test state.
 *
 * @param overrides - State fields to override.
 * @returns A test state value.
 */
function createState(
  overrides: Partial<UnencryptedStateValue> = {},
): UnencryptedStateValue {
  return {
    ...DEFAULT_UNENCRYPTED_STATE,
    keyringAccounts: {},
    keyringAccountIndex: {},
    assets: {},
    tokenPrices: {},
    transactions: {},
    mapInterfaceNameToId: {},
    ...overrides,
  };
}

class StaleAccountIndexReadState extends InMemoryState<UnencryptedStateValue> {
  async getKey<TResponse extends Serializable>(
    key: string,
  ): Promise<TResponse | undefined> {
    if (key === 'keyringAccountIndex') {
      return undefined;
    }

    return super.getKey(key);
  }
}

describe('AccountsRepository', () => {
  it('finds accounts by entropy source and range using the account index', async () => {
    const account0 = createAccount({ id: 'account-0', index: 0 });
    const account2 = createAccount({
      id: 'account-2',
      index: 2,
      derivationPath: "m/44'/195'/0'/0/2",
    });
    const otherEntropyAccount = createAccount({
      id: 'other-entropy-account',
      entropySource: 'other-entropy',
      index: 1,
    });
    const stateValue = createState({
      keyringAccounts: {
        [account0.id]: account0,
        [account2.id]: account2,
        [otherEntropyAccount.id]: otherEntropyAccount,
      },
      keyringAccountIndex: {
        'test-entropy': {
          0: account0.id,
          2: account2.id,
        },
        'other-entropy': {
          1: otherEntropyAccount.id,
        },
      },
    });
    const repository = new AccountsRepository(new InMemoryState(stateValue));

    const result = await repository.findByEntropySourceAndRange(
      'test-entropy',
      { from: 0, to: 2 },
    );

    expect(result).toStrictEqual([account0, account2]);
  });

  it('ignores stale account index entries for another entropy source', async () => {
    const otherEntropyAccount = createAccount({
      id: 'other-entropy-account',
      entropySource: 'other-entropy',
      index: 0,
    });
    const stateValue = createState({
      keyringAccounts: {
        [otherEntropyAccount.id]: otherEntropyAccount,
      },
      keyringAccountIndex: {
        'test-entropy': {
          0: otherEntropyAccount.id,
        },
      },
    });
    const repository = new AccountsRepository(new InMemoryState(stateValue));

    const result = await repository.findByEntropySourceAndRange(
      'test-entropy',
      { from: 0, to: 0 },
    );

    expect(result).toStrictEqual([]);
  });

  it('rebuilds the account index when reading legacy state without one', async () => {
    const account0 = createAccount({ id: 'account-0', index: 0 });
    const otherEntropyAccount = createAccount({
      id: 'other-entropy-account',
      entropySource: 'other-entropy',
      index: 1,
    });
    const stateValue = createState({
      keyringAccounts: {
        [account0.id]: account0,
        [otherEntropyAccount.id]: otherEntropyAccount,
      },
    }) as Partial<UnencryptedStateValue> as UnencryptedStateValue;
    delete (stateValue as Partial<UnencryptedStateValue>).keyringAccountIndex;
    const repository = new AccountsRepository(new InMemoryState(stateValue));

    const result = await repository.findByEntropySourceAndRange(
      'test-entropy',
      { from: 0, to: 1 },
    );

    expect(result).toStrictEqual([account0]);
    expect(stateValue.keyringAccountIndex).toStrictEqual({
      'test-entropy': { 0: account0.id },
      'other-entropy': { 1: otherEntropyAccount.id },
    });
  });

  it('rebuilds an empty account index when legacy accounts already exist', async () => {
    const account = createAccount({ id: 'account-0', index: 0 });
    const stateValue = createState({
      keyringAccounts: { [account.id]: account },
      keyringAccountIndex: {},
    });
    const repository = new AccountsRepository(new InMemoryState(stateValue));

    const result = await repository.findByEntropySourceAndRange(
      'test-entropy',
      { from: 0, to: 0 },
    );

    expect(result).toStrictEqual([account]);
    expect(stateValue.keyringAccountIndex).toStrictEqual({
      'test-entropy': { 0: account.id },
    });
  });

  it('merges a rebuilt account index with concurrent account index updates', async () => {
    const legacyAccount = createAccount({ id: 'legacy-account', index: 0 });
    const concurrentIndex: KeyringAccountIndex = {
      'test-entropy': { 1: 'concurrent-account' },
    };
    const stateValue = createState({
      keyringAccounts: { [legacyAccount.id]: legacyAccount },
      keyringAccountIndex: concurrentIndex,
    });
    const repository = new AccountsRepository(
      new StaleAccountIndexReadState(stateValue),
    );

    const result = await repository.findByEntropySourceAndRange(
      'test-entropy',
      { from: 0, to: 0 },
    );

    expect(result).toStrictEqual([legacyAccount]);
    expect(stateValue.keyringAccountIndex).toStrictEqual({
      'test-entropy': {
        0: legacyAccount.id,
        1: 'concurrent-account',
      },
    });
  });

  it('merges accounts and updates the account index', async () => {
    const account0 = createAccount({ id: 'account-0', index: 0 });
    const account1 = createAccount({
      id: 'account-1',
      index: 1,
      derivationPath: "m/44'/195'/0'/0/1",
    });
    const stateValue = createState();
    const repository = new AccountsRepository(new InMemoryState(stateValue));

    await repository.mergeKeyringAccounts({
      [account0.id]: account0,
      [account1.id]: account1,
    });

    expect(stateValue.keyringAccounts).toStrictEqual({
      [account0.id]: account0,
      [account1.id]: account1,
    });
    expect(stateValue.keyringAccountIndex).toStrictEqual({
      'test-entropy': {
        0: account0.id,
        1: account1.id,
      },
    });
  });

  it('creates an account and updates the account index', async () => {
    const account = createAccount({ id: 'account-0', index: 0 });
    const stateValue = createState();
    const repository = new AccountsRepository(new InMemoryState(stateValue));

    await repository.create(account);

    expect(stateValue.keyringAccounts[account.id]).toStrictEqual(account);
    expect(stateValue.keyringAccountIndex).toStrictEqual({
      'test-entropy': { 0: account.id },
    });
  });

  it('deletes an account and removes it from the account index', async () => {
    const account = createAccount({ id: 'account-0', index: 0 });
    const stateValue = createState({
      keyringAccounts: { [account.id]: account },
      keyringAccountIndex: {
        'test-entropy': { 0: account.id },
      },
    });
    const repository = new AccountsRepository(new InMemoryState(stateValue));

    await repository.delete(account.id);

    expect(stateValue.keyringAccounts[account.id]).toBeUndefined();
    expect(stateValue.keyringAccountIndex['test-entropy']?.[0]).toBeUndefined();
  });
});
