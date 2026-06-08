import { TrxAccountType, TrxScope } from '@metamask/keyring-api';

import { AccountsRepository } from './AccountsRepository';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import { InMemoryState } from '../state/InMemoryState';
import type { UnencryptedStateValue } from '../state/State';

describe('AccountsRepository', () => {
  it('skips merge entries that conflict on entropy source and index', async () => {
    const existing: TronKeyringAccount = {
      id: 'existing-0',
      entropySource: 'test-entropy',
      derivationPath: "m/44'/195'/0'/0/0",
      index: 0,
      type: TrxAccountType.Eoa,
      address: 'TAddress0',
      scopes: [TrxScope.Mainnet, TrxScope.Nile, TrxScope.Shasta],
      options: {},
      methods: ['signMessage', 'signTransaction'],
    };
    const state = new InMemoryState<UnencryptedStateValue>({
      keyringAccounts: { [existing.id]: existing },
      assets: {},
      tokenPrices: {},
      transactions: {},
      mapInterfaceNameToId: {},
    });
    const repository = new AccountsRepository(state);

    await repository.mergeKeyringAccounts({
      'duplicate-index': {
        ...existing,
        id: 'duplicate-index',
      },
      'new-index': {
        ...existing,
        id: 'new-index',
        index: 1,
        derivationPath: "m/44'/195'/0'/0/1",
        address: 'TAddress1',
      },
    });

    const accounts = await repository.getAll();

    expect(accounts).toHaveLength(2);
    expect(accounts.map((account) => account.id).sort()).toStrictEqual([
      'existing-0',
      'new-index',
    ]);
  });

  it('skips duplicate indices within the same merge batch', async () => {
    const base: TronKeyringAccount = {
      id: 'first',
      entropySource: 'test-entropy',
      derivationPath: "m/44'/195'/0'/0/0",
      index: 0,
      type: TrxAccountType.Eoa,
      address: 'TAddress0',
      scopes: [TrxScope.Mainnet, TrxScope.Nile, TrxScope.Shasta],
      options: {},
      methods: ['signMessage', 'signTransaction'],
    };
    const state = new InMemoryState<UnencryptedStateValue>({
      keyringAccounts: {},
      assets: {},
      tokenPrices: {},
      transactions: {},
      mapInterfaceNameToId: {},
    });
    const repository = new AccountsRepository(state);

    await repository.mergeKeyringAccounts({
      first: base,
      second: {
        ...base,
        id: 'second',
      },
    });

    const accounts = await repository.getAll();

    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.id).toBe('first');
  });

  it('returns the existing account when create races on the same index', async () => {
    const existing: TronKeyringAccount = {
      id: 'existing-0',
      entropySource: 'test-entropy',
      derivationPath: "m/44'/195'/0'/0/0",
      index: 0,
      type: TrxAccountType.Eoa,
      address: 'TAddress0',
      scopes: [TrxScope.Mainnet, TrxScope.Nile, TrxScope.Shasta],
      options: {},
      methods: ['signMessage', 'signTransaction'],
    };
    const state = new InMemoryState<UnencryptedStateValue>({
      keyringAccounts: { [existing.id]: existing },
      assets: {},
      tokenPrices: {},
      transactions: {},
      mapInterfaceNameToId: {},
    });
    const repository = new AccountsRepository(state);

    const result = await repository.create({
      ...existing,
      id: 'new-id',
    });

    expect(result.id).toBe('existing-0');
    expect(await repository.getAll()).toHaveLength(1);
  });
});
