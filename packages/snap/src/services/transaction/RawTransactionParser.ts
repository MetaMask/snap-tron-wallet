import { bytesToHex, hexToBytes, sha256 } from '@metamask/utils';
import type { Types } from 'tronweb';

import type { PreparedTransaction, PrepareRawTransactionParams } from './types';
import type { TronWebFactory } from '../../clients/tronweb/TronWebFactory';
import { FEE_LIMIT } from '../../constants';
import {
  assertTransactionOwnerAddress,
  assertTransactionStructure,
} from '../../validation/transaction';

type TransactionRawData = Types.Transaction['raw_data'] & {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  fee_limit?: number;
};

export class RawTransactionParser {
  readonly #tronWebFactory: TronWebFactory;

  constructor({ tronWebFactory }: { tronWebFactory: TronWebFactory }) {
    this.#tronWebFactory = tronWebFactory;
  }

  async prepareRawTransaction({
    scope,
    account,
    transactionBase64,
    type,
    feeLimit = FEE_LIMIT,
  }: PrepareRawTransactionParams): Promise<PreparedTransaction> {
    const tronWeb = this.#tronWebFactory.createClient(scope);

    // eslint-disable-next-line no-restricted-globals
    const rawDataHex = Buffer.from(transactionBase64, 'base64').toString('hex');
    const rawData = tronWeb.utils.deserializeTx.deserializeTransaction(
      type,
      rawDataHex,
    ) as TransactionRawData;

    rawData.fee_limit = feeLimit;
    assertTransactionStructure(rawData);
    assertTransactionOwnerAddress(rawData, account.address);

    const transactionPb = tronWeb.utils.transaction.txJsonToPb({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      raw_data: rawData,
    });
    const rebuiltRawDataHex =
      tronWeb.utils.transaction.txPbToRawDataHex(transactionPb);
    const txID = bytesToHex(await sha256(hexToBytes(rebuiltRawDataHex))).slice(
      2,
    );

    return {
      rawData,
      transaction: {
        visible: false,
        txID,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        raw_data: rawData,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        raw_data_hex: rebuiltRawDataHex,
      },
    };
  }
}
