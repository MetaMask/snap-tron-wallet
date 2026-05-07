import type { JsonBIP44Node } from '@metamask/key-tree';
import type {
  CreateAccountOptions as KeyringBatchCreateAccountOptions,
  EntropySourceId,
  KeyringAccount,
} from '@metamask/keyring-api';
import {
  AccountCreationType,
  assertCreateAccountOptionIsSupported,
  KeyringEvent,
  TrxAccountType,
  TrxScope,
} from '@metamask/keyring-api';
import {
  emitSnapKeyringEvent,
  getSelectedAccounts,
} from '@metamask/keyring-snap-sdk';
import type { Json } from '@metamask/snaps-sdk';
import { assert } from '@metamask/superstruct';
import { hexToBytes } from '@metamask/utils';
import { computeAddress } from 'ethers';
import { TronWeb } from 'tronweb';

import type { AccountsRepository } from './AccountsRepository';
import type { CreateAccountOptions } from './types';
import type { SnapClient } from '../../clients/snap/SnapClient';
import {
  asStrictKeyringAccount,
  type TronKeyringAccount,
} from '../../entities/keyring-account';
import { createTronBip44AddressDeriver } from '../../utils/deriveTronFromCoinTypeNode';
import { sanitizeSensitiveError } from '../../utils/errors';
import { getLowestUnusedIndex } from '../../utils/getLowestUnusedIndex';
import baseLogger, {
  createPrefixedLogger,
  type ILogger,
} from '../../utils/logger';
import { DerivationPathStruct } from '../../validation/structs';
import type { AssetsService } from '../assets/AssetsService';
import type { ConfigProvider } from '../config';
import type { TransactionsService } from '../transactions/TransactionsService';

/**
 * Elliptic curve for TRON (same as Ethereum)
 */
const CURVE = 'secp256k1' as const;

const MAX_BIP44_ACCOUNT_INDEX = 0x7fffffff;

const CREATE_ACCOUNTS_BATCH_SIZE = 100;

type AccountCreationRange = {
  from: number;
  to: number;
};

type TronAddressDeriver = Awaited<
  ReturnType<typeof createTronBip44AddressDeriver>
>;

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
 * Builds a stable operation name for a create-accounts index batch.
 *
 * @param operation - The operation being measured.
 * @param from - The first account index in the batch.
 * @param to - The last account index in the batch.
 * @returns The operation name.
 */
function getBatchOperationName(
  operation: string,
  from: number,
  to: number,
): string {
  return `${operation}_${from}_${to}`;
}

/**
 * Validates account creation ranges before any expensive state or entropy work.
 *
 * @param range - Inclusive account index range to validate.
 */
function validateAccountCreationRange(range: AccountCreationRange): void {
  if (!Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to)) {
    throw new Error('Invalid account creation range: bounds must be integers');
  }

  if (range.from < 0 || range.to < 0) {
    throw new Error(
      'Invalid account creation range: bounds must be non-negative',
    );
  }

  if (
    range.from > MAX_BIP44_ACCOUNT_INDEX ||
    range.to > MAX_BIP44_ACCOUNT_INDEX
  ) {
    throw new Error(
      `Invalid account creation range: bounds must be at most ${MAX_BIP44_ACCOUNT_INDEX}`,
    );
  }

  if (range.from > range.to) {
    throw new Error(
      'Invalid account creation range: from must be less than or equal to to',
    );
  }
}

export class AccountsService {
  readonly #accountsRepository: AccountsRepository;

  readonly #configProvider: ConfigProvider;

  readonly #logger: ILogger;

  readonly #assetsService: AssetsService;

  readonly #transactionsService: TransactionsService;

  readonly #snapClient: SnapClient;

  constructor({
    accountsRepository,
    configProvider,
    logger,
    assetsService,
    snapClient,
    transactionsService,
  }: {
    accountsRepository: AccountsRepository;
    configProvider: ConfigProvider;
    logger: ILogger;
    assetsService: AssetsService;
    snapClient: SnapClient;
    transactionsService: TransactionsService;
  }) {
    this.#logger = createPrefixedLogger(logger, '[🔑 AccountsService]');
    this.#configProvider = configProvider;
    this.#accountsRepository = accountsRepository;
    this.#assetsService = assetsService;
    this.#transactionsService = transactionsService;
    this.#snapClient = snapClient;
  }

  /**
   * Derives a TRON private and public key from a given derivation path using BIP44.
   * The derivation path follows the format: m/44'/195'/account'/change/index
   * where 195 is TRON's coin type.
   *
   * @param params - The parameters for the TRON key derivation.
   * @param params.entropySource - The entropy source to use for key derivation.
   * @param params.derivationPath - The derivation path to use for key derivation.
   * @returns A Promise that resolves to the private key bytes, public key bytes, private key hex WITHOUT the `0x` prefix, and address.
   * @throws {Error} If unable to derive private key or if derivation fails.
   */
  async deriveTronKeypair({
    entropySource,
    derivationPath,
  }: {
    entropySource?: EntropySourceId | undefined;
    derivationPath: string;
  }): Promise<{
    privateKeyBytes: Uint8Array;
    publicKeyBytes: Uint8Array;
    privateKeyHex: string;
    address: string;
  }> {
    try {
      this.#logger.log({ derivationPath }, 'Generating TRON wallet');

      assert(derivationPath, DerivationPathStruct);

      const path = derivationPath.split('/');

      const node = await this.#snapClient.getBip32Entropy({
        entropySource,
        path,
        curve: CURVE,
      });

      if (!node.privateKey || !node.publicKey) {
        throw new Error('Unable to derive private key');
      }

      const privateKeyBytes = hexToBytes(node.privateKey);
      const publicKeyBytes = hexToBytes(node.publicKey);
      const privateKeyHex = node.privateKey.slice(2);

      // Derive address from public key (cheaper than from private key)
      const hexAddress = computeAddress(node.publicKey);
      const address = TronWeb.address.fromHex(hexAddress);

      if (!address) {
        throw new Error('Unable to derive address');
      }

      return {
        privateKeyBytes,
        publicKeyBytes,
        privateKeyHex,
        address,
      };
    } catch (error) {
      // Sanitize errors to prevent leaking sensitive cryptographic information
      throw sanitizeSensitiveError(error);
    }
  }

  async deriveAccount({
    entropySource,
    index,
  }: {
    entropySource: EntropySourceId;
    index: number;
  }): Promise<TronKeyringAccount> {
    const derivationPath = AccountsService.getDefaultDerivationPath(index);
    const { address } = await this.deriveTronKeypair({
      entropySource,
      derivationPath,
    });

    return {
      id: globalThis.crypto.randomUUID(),
      entropySource,
      derivationPath,
      index,
      type: TrxAccountType.Eoa,
      address,
      scopes: [TrxScope.Mainnet, TrxScope.Nile, TrxScope.Shasta],
      options: {
        entropy: {
          type: 'mnemonic',
          id: entropySource,
          derivationPath,
          groupIndex: index,
        },
        exportable: true,
      },
      methods: ['signMessage', 'signTransaction'],
    };
  }

  async create(options?: CreateAccountOptions): Promise<KeyringAccount> {
    const accounts = await this.#accountsRepository.getAll();

    const entropySource =
      options?.entropySource ?? (await this.#getDefaultEntropySource());
    const index =
      options?.index ??
      this.#getLowestUnusedKeyringAccountIndex(accounts, entropySource);

    /**
     * Now that we have the `entropySource` and `index` ready,
     * we need to make sure that they do not correspond to an existing account already.
     */
    const sameAccount = accounts.find(
      (account) =>
        account.index === index && account.entropySource === entropySource,
    );

    if (sameAccount) {
      this.#logger.warn(
        '[🔑 Keyring] An account already exists with the same derivation path and entropy source. Skipping account creation.',
      );
      return asStrictKeyringAccount(sameAccount);
    }

    const derivedAccount = await this.deriveAccount({
      entropySource,
      index,
    });

    const { metamask: metamaskOptions, ...remainingOptions } = options ?? {};

    const tronKeyringAccount: TronKeyringAccount = {
      ...derivedAccount,
      options: {
        ...derivedAccount.options,
        ...(Object.fromEntries(
          Object.entries(remainingOptions).filter(
            ([, value]) => value !== undefined,
          ),
        ) as Record<string, Json>),
        groupIndex: index,
      },
    };

    await this.#accountsRepository.create(tronKeyringAccount);

    try {
      const keyringAccount = asStrictKeyringAccount(tronKeyringAccount);

      await emitSnapKeyringEvent(snap, KeyringEvent.AccountCreated, {
        /**
         * We can't pass the `keyringAccount` object because it contains the index
         * and the snaps sdk does not allow extra properties.
         */
        account: keyringAccount,
        /**
         * Skip account creation confirmation dialogs to make it look like a native
         * account creation flow.
         */
        displayConfirmation: false,
        /**
         * Internal options to MetaMask that includes a correlation ID. We need
         * to also emit this ID to the Snap keyring.
         */
        ...(metamaskOptions
          ? {
              metamask: metamaskOptions,
            }
          : {}),
      });

      return keyringAccount;
    } catch (error) {
      // Rollback: if the event emission fails after the account was persisted,
      // remove it from state so we don't end up with an orphaned record.
      try {
        await this.#accountsRepository.delete(tronKeyringAccount.id);
      } catch (deleteError) {
        this.#logger.error(
          { deleteError, accountId: tronKeyringAccount.id },
          'Failed to rollback account creation',
        );
      }
      throw error;
    }
  }

  /**
   * Batch-creates Tron accounts for a BIP-44 index or index range. Existing accounts for the
   * same entropy source and index are returned without duplicate state writes.
   *
   * @param options - The options for the account creation.
   * @param options.entropySource - The entropy source to use for the account creation.
   * @param options.type - The type of account creation.
   * @param options.groupIndex - The group index to use for the account creation.
   * @returns The created accounts.
   */
  async createAccounts(
    options: KeyringBatchCreateAccountOptions,
  ): Promise<KeyringAccount[]> {
    const createAccountsStart = Date.now();
    assertCreateAccountOptionIsSupported(options, [
      `${AccountCreationType.Bip44DeriveIndex}`,
      `${AccountCreationType.Bip44DeriveIndexRange}`,
    ]);

    const { entropySource } = options;

    // Get the range of accounts to create
    const range =
      options.type === AccountCreationType.Bip44DeriveIndex
        ? { from: options.groupIndex, to: options.groupIndex }
        : options.range;
    const validateRangeStart = Date.now();
    validateAccountCreationRange(range);
    logPerformance('VALIDATE_ACCOUNT_CREATION_RANGE', validateRangeStart);

    // Get all accounts for the same entropy source to avoid duplicate state writes
    const getExistingAccountsStart = Date.now();
    const getAllAccountsStart = Date.now();
    const existingAccounts = await this.#accountsRepository.getAll();
    logPerformance('GET_ALL_ACCOUNTS', getAllAccountsStart);

    const indexExistingAccountsStart = Date.now();
    const allAccounts = new Map<number, TronKeyringAccount>();
    for (const account of existingAccounts) {
      if (account.entropySource === entropySource) {
        allAccounts.set(account.index, account);
      }
    }
    logPerformance('INDEX_EXISTING_ACCOUNTS', indexExistingAccountsStart);
    logPerformance('GET_EXISTING_ACCOUNTS', getExistingAccountsStart);

    let deriveTronAddressPromise: Promise<TronAddressDeriver> | undefined;

    const createTronAddressDeriver = async (): Promise<TronAddressDeriver> => {
      const getEntropyStart = Date.now();
      const bip44Node = (await this.#snapClient.getBip32Entropy({
        entropySource,
        path: ['m', "44'", "195'"],
        curve: CURVE,
      })) as JsonBIP44Node;
      logPerformance('GET_BIP32_ENTROPY', getEntropyStart);

      const createDeriverStart = Date.now();
      const tronAddressDeriver = await createTronBip44AddressDeriver(bip44Node);
      logPerformance('CREATE_TRON_BIP44_ADDRESS_DERIVER', createDeriverStart);
      return tronAddressDeriver;
    };

    const getTronAddressDeriver = async (): Promise<TronAddressDeriver> => {
      deriveTronAddressPromise ??= createTronAddressDeriver();
      return deriveTronAddressPromise;
    };

    const deriveMissingAccountsStart = Date.now();
    for (
      let batchStart = range.from;
      batchStart <= range.to;
      batchStart += CREATE_ACCOUNTS_BATCH_SIZE
    ) {
      const batchEnd = Math.min(
        batchStart + CREATE_ACCOUNTS_BATCH_SIZE - 1,
        range.to,
      );
      const newAccounts: Record<string, TronKeyringAccount> = {};
      let newAccountCount = 0;

      const createAccountsBatchStart = Date.now();
      const deriveMissingAccountsBatchStart = Date.now();
      for (
        let groupIndex = batchStart;
        groupIndex <= batchEnd;
        groupIndex += 1
      ) {
        if (allAccounts.has(groupIndex)) {
          continue;
        }

        const id = globalThis.crypto.randomUUID();
        const derivationPath =
          AccountsService.getDefaultDerivationPath(groupIndex);
        const tronAddressDeriver = await getTronAddressDeriver();
        const { address } = await tronAddressDeriver(groupIndex);

        const tronKeyringAccount: TronKeyringAccount = {
          id,
          entropySource,
          derivationPath,
          index: groupIndex,
          type: TrxAccountType.Eoa,
          address,
          scopes: [TrxScope.Mainnet, TrxScope.Nile, TrxScope.Shasta],
          options: {
            entropy: {
              type: 'mnemonic',
              id: entropySource,
              derivationPath,
              groupIndex,
            },
            exportable: true,
          },
          methods: ['signMessage', 'signTransaction'],
        };

        allAccounts.set(groupIndex, tronKeyringAccount);
        newAccounts[id] = tronKeyringAccount;
        newAccountCount += 1;
      }
      logPerformance(
        getBatchOperationName(
          'DERIVE_MISSING_ACCOUNTS_BATCH',
          batchStart,
          batchEnd,
        ),
        deriveMissingAccountsBatchStart,
      );

      if (newAccountCount > 0) {
        const mergeKeyringAccountsStart = Date.now();
        await this.#accountsRepository.mergeKeyringAccounts(newAccounts);
        logPerformance(
          getBatchOperationName(
            'MERGE_KEYRING_ACCOUNTS_BATCH',
            batchStart,
            batchEnd,
          ),
          mergeKeyringAccountsStart,
        );
        logPerformance('MERGE_KEYRING_ACCOUNTS', mergeKeyringAccountsStart);
      }
      logPerformance(
        getBatchOperationName('CREATE_ACCOUNTS_BATCH', batchStart, batchEnd),
        createAccountsBatchStart,
      );
    }
    logPerformance('DERIVE_MISSING_ACCOUNTS', deriveMissingAccountsStart);

    const buildCreateAccountsResultStart = Date.now();
    const result: KeyringAccount[] = [];
    for (let groupIndex = range.from; groupIndex <= range.to; groupIndex += 1) {
      const account = allAccounts.get(groupIndex);
      if (account) {
        result.push(asStrictKeyringAccount(account));
      }
    }
    logPerformance(
      'BUILD_CREATE_ACCOUNTS_RESULT',
      buildCreateAccountsResultStart,
    );

    logPerformance('CREATE_ACCOUNTS', createAccountsStart);
    return result;
  }

  async getAll(): Promise<TronKeyringAccount[]> {
    return this.#accountsRepository.getAll();
  }

  async getAllSelected(): Promise<TronKeyringAccount[]> {
    const [allAccounts, selectedAccountIds] = await Promise.all([
      this.#accountsRepository.getAll(),
      getSelectedAccounts(snap),
    ]);

    return allAccounts.filter((account) =>
      selectedAccountIds.includes(account.id),
    );
  }

  async findById(id: string): Promise<TronKeyringAccount | null> {
    return this.#accountsRepository.findById(id);
  }

  /**
   * Retrieves an account by ID and throws an error if not found.
   * This is a convenience method that combines findById with validation.
   *
   * @param id - The account ID to retrieve.
   * @returns The account if found.
   * @throws {Error} If the account is not found.
   */
  async findByIdOrThrow(id: string): Promise<TronKeyringAccount> {
    const account = await this.#accountsRepository.findById(id);

    if (!account) {
      throw new Error(`Account with ID ${id} not found`);
    }

    return account;
  }

  async findByIds(ids: string[]): Promise<TronKeyringAccount[]> {
    const accounts = await this.#accountsRepository.findByIds(ids);

    if (ids.length !== accounts.length) {
      this.#logger.error('[findByIds] Some accounts not found');
    }

    return accounts;
  }

  async findByAddress(address: string): Promise<TronKeyringAccount | null> {
    return this.#accountsRepository.findByAddress(address);
  }

  async delete(id: string): Promise<void> {
    return this.#accountsRepository.delete(id);
  }

  /**
   * Synchronizes only assets for the given accounts.
   * This method can be called independently to sync assets without syncing transactions.
   *
   * @param accounts - The accounts to synchronize assets for.
   */
  async synchronizeAssets(accounts: TronKeyringAccount[]): Promise<void> {
    const scopes = this.#configProvider.get().activeNetworks;
    const combinations = accounts.flatMap((account) =>
      scopes.map((scope) => ({ account, scope })),
    );

    const assetResponses = await Promise.allSettled(
      combinations.map(async ({ account, scope }) => {
        return this.#assetsService.fetchAssetsAndBalancesForAccount(
          scope,
          account,
        );
      }),
    );

    const assets = assetResponses.flatMap((response) =>
      response.status === 'fulfilled' ? response.value : [],
    );

    await this.#assetsService.saveMany(assets);
  }

  async synchronizeTransactions(accounts: TronKeyringAccount[]): Promise<void> {
    const scopes = this.#configProvider.get().activeNetworks;
    const combinations = accounts.flatMap((account) =>
      scopes.map((scope) => ({ account, scope })),
    );

    const transactionResponses = await Promise.allSettled(
      combinations.map(async ({ account, scope }) => {
        return this.#transactionsService.fetchNewTransactionsForAccount(
          scope,
          account,
        );
      }),
    );

    const transactions = transactionResponses.flatMap((response) =>
      response.status === 'fulfilled' ? response.value : [],
    );

    await this.#transactionsService.saveMany(transactions);
  }

  async synchronize(accounts: TronKeyringAccount[]): Promise<void> {
    await Promise.allSettled([
      this.synchronizeAssets(accounts),
      this.synchronizeTransactions(accounts),
    ]);
  }

  #getLowestUnusedKeyringAccountIndex(
    accounts: TronKeyringAccount[],
    entropySource: EntropySourceId,
  ): number {
    const accountsFilteredByEntropySourceId = accounts.filter(
      (account) => account.entropySource === entropySource,
    );

    return getLowestUnusedIndex(accountsFilteredByEntropySourceId);
  }

  static getDefaultDerivationPath(index: number): `m/${string}` {
    return `m/44'/195'/0'/0/${index}`;
  }

  async #getDefaultEntropySource(): Promise<EntropySourceId> {
    const entropySources = await this.#snapClient.listEntropySources();
    const defaultEntropySource = entropySources.find(({ primary }) => primary);

    if (!defaultEntropySource) {
      throw new Error(
        'No default entropy source found - this can never happen',
      );
    }

    return defaultEntropySource.id;
  }
}
