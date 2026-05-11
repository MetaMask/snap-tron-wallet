import { TransactionBroadcaster } from './TransactionBroadcaster';
import { Network } from '../../constants';
/* eslint-disable @typescript-eslint/naming-convention */
import { BackgroundEventMethod } from '../../handlers/cronjob';

const ACCOUNT_ADDRESS = 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx';

const createAccount = () =>
  ({
    id: 'account-id',
    address: ACCOUNT_ADDRESS,
    type: 'eip155:eoa',
    entropySource: 'entropy-source',
    derivationPath: "m/44'/195'/0'/0/0",
  }) as any;

const createTransaction = (ownerAddress = ACCOUNT_ADDRESS) =>
  ({
    txID: 'unsigned-tx-id',
    raw_data: {
      contract: [
        {
          type: 'TransferContract',
          parameter: {
            value: {
              owner_address: ownerAddress,
              to_address: 'TQAvWQpT9H916GckwWDJNhYZvQMkuRLtGz',
              amount: 1,
            },
          },
        },
      ],
    },
    raw_data_hex: '0a0b0c',
  }) as any;

describe('TransactionBroadcaster', () => {
  const signedTransaction = { signed: true };
  let accountsService: any;
  let tronWebFactory: any;
  let snapClient: any;
  let sign: jest.Mock;
  let sendRawTransaction: jest.Mock;
  let broadcaster: TransactionBroadcaster;

  beforeEach(() => {
    sign = jest.fn().mockResolvedValue(signedTransaction);
    sendRawTransaction = jest.fn().mockResolvedValue({
      result: true,
      txid: 'broadcast-tx-id',
    });

    accountsService = {
      findByIdOrThrow: jest.fn().mockResolvedValue(createAccount()),
      deriveTronKeypair: jest.fn().mockResolvedValue({
        privateKeyHex: 'private-key',
      }),
    };
    tronWebFactory = {
      createClient: jest.fn().mockReturnValue({
        trx: { sign, sendRawTransaction },
      }),
    };
    snapClient = {
      trackTransactionSubmitted: jest.fn().mockResolvedValue(undefined),
      scheduleBackgroundEvent: jest.fn().mockResolvedValue(undefined),
    };

    broadcaster = new TransactionBroadcaster({
      accountsService,
      tronWebFactory,
      snapClient,
    });
  });

  it('signs broadcasts and schedules tracking for matching owner', async () => {
    const result = await broadcaster.broadcast({
      scope: Network.Mainnet,
      accountId: 'account-id',
      transaction: createTransaction(),
      tracking: { type: 'transaction', origin: 'MetaMask' },
    });

    expect(accountsService.findByIdOrThrow).toHaveBeenCalledWith('account-id');
    expect(accountsService.deriveTronKeypair).toHaveBeenCalledWith({
      entropySource: 'entropy-source',
      derivationPath: "m/44'/195'/0'/0/0",
    });
    expect(tronWebFactory.createClient).toHaveBeenCalledWith(
      Network.Mainnet,
      'private-key',
    );
    expect(sign).toHaveBeenCalledWith(createTransaction());
    expect(sendRawTransaction).toHaveBeenCalledWith(signedTransaction);
    expect(snapClient.trackTransactionSubmitted).toHaveBeenCalledWith({
      origin: 'MetaMask',
      accountType: 'eip155:eoa',
      chainIdCaip: Network.Mainnet,
    });
    expect(snapClient.scheduleBackgroundEvent).toHaveBeenCalledWith({
      method: BackgroundEventMethod.TrackTransaction,
      params: {
        txId: 'broadcast-tx-id',
        scope: Network.Mainnet,
        accountIds: ['account-id'],
        attempt: 0,
      },
      duration: 'PT1S',
    });
    expect(result).toStrictEqual({
      txid: 'broadcast-tx-id',
      result: { result: true, txid: 'broadcast-tx-id' },
    });
  });

  it('signs broadcasts and schedules account sync when requested', async () => {
    await broadcaster.broadcast({
      scope: Network.Mainnet,
      accountId: 'account-id',
      transaction: createTransaction(),
      tracking: { type: 'accountSync' },
    });

    expect(snapClient.trackTransactionSubmitted).not.toHaveBeenCalled();
    expect(snapClient.scheduleBackgroundEvent).toHaveBeenCalledWith({
      method: BackgroundEventMethod.SynchronizeAccount,
      params: { accountId: 'account-id' },
      duration: 'PT5S',
    });
  });

  it('signs broadcasts without scheduling when tracking is disabled', async () => {
    await broadcaster.broadcast({
      scope: Network.Mainnet,
      accountId: 'account-id',
      transaction: createTransaction(),
      tracking: { type: 'none' },
    });

    expect(snapClient.trackTransactionSubmitted).not.toHaveBeenCalled();
    expect(snapClient.scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('throws when broadcast result is false', async () => {
    sendRawTransaction.mockResolvedValue({
      result: false,
      message: 'rejected',
    });

    await expect(
      broadcaster.broadcast({
        scope: Network.Mainnet,
        accountId: 'account-id',
        transaction: createTransaction(),
      }),
    ).rejects.toThrow('Failed to send transaction: rejected');
  });

  it('does not schedule tracking when broadcast fails', async () => {
    sendRawTransaction.mockResolvedValue({
      result: false,
      message: 'rejected',
    });

    await expect(
      broadcaster.broadcast({
        scope: Network.Mainnet,
        accountId: 'account-id',
        transaction: createTransaction(),
      }),
    ).rejects.toThrow('Failed to send transaction: rejected');

    expect(snapClient.trackTransactionSubmitted).not.toHaveBeenCalled();
    expect(snapClient.scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('throws when owner address does not match account', async () => {
    await expect(
      broadcaster.broadcast({
        scope: Network.Mainnet,
        accountId: 'account-id',
        transaction: createTransaction('TQAvWQpT9H916GckwWDJNhYZvQMkuRLtGz'),
      }),
    ).rejects.toThrow('does not match the account address');

    expect(sign).not.toHaveBeenCalled();
    expect(sendRawTransaction).not.toHaveBeenCalled();
  });
});
