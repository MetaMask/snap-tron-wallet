/* eslint-disable @typescript-eslint/naming-convention, no-restricted-globals */
import { InvalidParamsError } from '@metamask/snaps-sdk';
import { bytesToHex, hexToBytes, sha256 } from '@metamask/utils';

import { RawTransactionParser } from './RawTransactionParser';
import { FEE_LIMIT, Network } from '../../constants';
import type { TronKeyringAccount } from '../../entities/keyring-account';

const ACCOUNT_ADDRESS = 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx';

const createRawData = (ownerAddress = ACCOUNT_ADDRESS) =>
  ({
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
  }) as any;

const createAccount = (): TronKeyringAccount =>
  ({
    id: 'account-id',
    address: ACCOUNT_ADDRESS,
    type: 'eip155:eoa',
    options: {},
    methods: [],
    scopes: [],
    entropySource: 'entropy-source',
    derivationPath: "m/44'/195'/0'/0/0",
    index: 0,
  }) as TronKeyringAccount;

describe('RawTransactionParser', () => {
  const transactionPb = { pb: true };
  const rebuiltRawDataHex = '0a0b0c';
  let deserializeTransaction: jest.Mock;
  let txJsonToPb: jest.Mock;
  let txPbToRawDataHex: jest.Mock;
  let parser: RawTransactionParser;

  beforeEach(() => {
    deserializeTransaction = jest.fn();
    txJsonToPb = jest.fn().mockReturnValue(transactionPb);
    txPbToRawDataHex = jest.fn().mockReturnValue(rebuiltRawDataHex);

    parser = new RawTransactionParser({
      tronWebFactory: {
        createClient: jest.fn().mockReturnValue({
          utils: {
            deserializeTx: { deserializeTransaction },
            transaction: { txJsonToPb, txPbToRawDataHex },
          },
        }),
      } as any,
    });
  });

  it('prepares raw transaction and applies default fee limit', async () => {
    const rawData = createRawData();
    deserializeTransaction.mockReturnValue(rawData);
    const transactionBase64 = Buffer.from('feed', 'hex').toString('base64');
    const expectedTxId = bytesToHex(
      await sha256(hexToBytes(rebuiltRawDataHex)),
    ).slice(2);

    const result = await parser.prepareRawTransaction({
      scope: Network.Mainnet,
      account: createAccount(),
      transactionBase64,
      type: 'TransferContract',
    });

    expect(deserializeTransaction).toHaveBeenCalledWith(
      'TransferContract',
      'feed',
    );
    expect(rawData.fee_limit).toBe(FEE_LIMIT);
    expect(txJsonToPb).toHaveBeenCalledWith({ raw_data: rawData });
    expect(result.rawData).toBe(rawData);
    expect(result.transaction).toStrictEqual({
      visible: false,
      txID: expectedTxId,
      raw_data: rawData,
      raw_data_hex: rebuiltRawDataHex,
    });
  });

  it('throws when owner address does not match account', async () => {
    deserializeTransaction.mockReturnValue(
      createRawData('TQAvWQpT9H916GckwWDJNhYZvQMkuRLtGz'),
    );

    await expect(
      parser.prepareRawTransaction({
        scope: Network.Mainnet,
        account: createAccount(),
        transactionBase64: Buffer.from('feed', 'hex').toString('base64'),
        type: 'TransferContract',
      }),
    ).rejects.toThrow(InvalidParamsError);
  });

  it('throws when raw transaction is malformed', async () => {
    deserializeTransaction.mockReturnValue({ contract: [] });

    await expect(
      parser.prepareRawTransaction({
        scope: Network.Mainnet,
        account: createAccount(),
        transactionBase64: Buffer.from('feed', 'hex').toString('base64'),
        type: 'TransferContract',
      }),
    ).rejects.toThrow(InvalidParamsError);
  });
});
