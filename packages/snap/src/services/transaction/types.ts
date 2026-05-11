import type { FeeType } from '@metamask/keyring-api';
import type { BigNumber } from 'bignumber.js';
import type { Transaction } from 'tronweb/lib/esm/types';

import type { Network } from '../../constants';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import type {
  NativeCaipAssetType,
  ResourceCaipAssetType,
} from '../assets/types';

export type FeeAsset = {
  unit: string;
  type: NativeCaipAssetType | ResourceCaipAssetType;
  amount: string;
  fungible: true;
  iconUrl?: string;
};

export type ComputeFeeResult = {
  type: FeeType;
  asset: FeeAsset;
}[];

export type ComputeFeeParams = {
  scope: Network;
  transaction: Transaction;
  availableEnergy: BigNumber;
  availableBandwidth: BigNumber;
  feeLimit?: number;
};

export type PrepareRawTransactionParams = {
  scope: Network;
  account: TronKeyringAccount;
  transactionBase64: string;
  type: string;
  feeLimit?: number;
};

export type PreparedTransaction = {
  transaction: Transaction;
  rawData: Transaction['raw_data'];
};

export type EstimateTransactionFeeParams = {
  scope: Network;
  accountId: string;
  transaction: Transaction;
  feeLimit?: number;
};

export type EstimateTransactionFeesParams = {
  scope: Network;
  accountId: string;
  transactions: Transaction[];
  feeLimit?: number;
};

export type TransactionTracking =
  | { type: 'transaction'; origin?: string }
  | { type: 'accountSync' }
  | { type: 'none' };

export type BroadcastTransactionParams = {
  scope: Network;
  accountId: string;
  transaction: Transaction;
  tracking?: TransactionTracking;
};

export type BroadcastTransactionResult = {
  txid: string;
  result: {
    result: boolean;
    txid: string;
    message?: string;
  };
};

export type BroadcastManyTransactionsParams = {
  scope: Network;
  accountId: string;
  transactions: Transaction[];
  tracking?: TransactionTracking;
};
