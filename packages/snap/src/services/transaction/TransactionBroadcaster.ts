import type {
  BroadcastTransactionParams,
  BroadcastTransactionResult,
  TransactionTracking,
} from './types';
import type { SnapClient } from '../../clients/snap/SnapClient';
import type { TronWebFactory } from '../../clients/tronweb/TronWebFactory';
import { BackgroundEventMethod } from '../../handlers/cronjob';
import {
  assertTransactionOwnerAddress,
  assertTransactionStructure,
} from '../../validation/transaction';
import type { AccountsService } from '../accounts/AccountsService';

const DEFAULT_TRACKING: TransactionTracking = {
  type: 'transaction',
  origin: 'MetaMask',
};

export class TransactionBroadcaster {
  readonly #accountsService: AccountsService;

  readonly #tronWebFactory: TronWebFactory;

  readonly #snapClient: SnapClient;

  constructor({
    accountsService,
    tronWebFactory,
    snapClient,
  }: {
    accountsService: AccountsService;
    tronWebFactory: TronWebFactory;
    snapClient: SnapClient;
  }) {
    this.#accountsService = accountsService;
    this.#tronWebFactory = tronWebFactory;
    this.#snapClient = snapClient;
  }

  async broadcast({
    scope,
    accountId,
    transaction,
    tracking = DEFAULT_TRACKING,
  }: BroadcastTransactionParams): Promise<BroadcastTransactionResult> {
    const account = await this.#accountsService.findByIdOrThrow(accountId);

    assertTransactionStructure(transaction.raw_data);
    assertTransactionOwnerAddress(transaction.raw_data, account.address);

    const { privateKeyHex } = await this.#accountsService.deriveTronKeypair({
      entropySource: account.entropySource,
      derivationPath: account.derivationPath,
    });
    const tronWeb = this.#tronWebFactory.createClient(scope, privateKeyHex);

    const signedTransaction = await tronWeb.trx.sign(transaction);
    const result = await tronWeb.trx.sendRawTransaction(signedTransaction);

    if (!result.result) {
      throw new Error(`Failed to send transaction: ${result.message}`);
    }

    if (tracking.type === 'transaction') {
      await this.#snapClient.trackTransactionSubmitted({
        origin: tracking.origin ?? 'MetaMask',
        accountType: account.type,
        chainIdCaip: scope,
      });

      await this.#snapClient.scheduleBackgroundEvent({
        method: BackgroundEventMethod.TrackTransaction,
        params: {
          txId: result.txid,
          scope,
          accountIds: [accountId],
          attempt: 0,
        },
        duration: 'PT1S',
      });
    }

    if (tracking.type === 'accountSync') {
      await this.#snapClient.scheduleBackgroundEvent({
        method: BackgroundEventMethod.SynchronizeAccount,
        params: { accountId },
        duration: 'PT5S',
      });
    }

    return {
      txid: result.txid,
      result,
    };
  }
}
