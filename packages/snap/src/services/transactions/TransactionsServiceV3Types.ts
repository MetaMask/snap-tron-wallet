/* istanbul ignore file */

import type { Json } from '@metamask/snaps-sdk';
import type { BigNumber } from 'bignumber.js';
import type { Transaction } from 'tronweb/lib/esm/types';

import type { DecodedTransaction } from './TransactionsServiceV2';
import type { Network } from '../../constants';
import type { AssetEntity } from '../../entities/assets';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import type { SendErrorCodes } from '../../handlers/clientRequest/types';
import type { ComputeFeeResult } from '../send/types';

export type TransactionDraftKind =
  | 'raw'
  | 'send'
  | 'stake'
  | 'unstake'
  | 'claimUnstaked'
  | 'claimRewards';

export type DraftTransaction = Transaction | DecodedTransaction;

export type TransactionBroadcastResult = {
  result: boolean;
  txid: string;
  message?: string;
};

export type TransactionValidationResponse = {
  valid: boolean;
  errors: { code: SendErrorCodes }[];
};

export type SignedRewardsMessage = {
  signature: string;
  signedMessage: string;
  signatureType: 'secp256k1';
};

export type TransactionDraft = {
  accountId: string;
  account: TronKeyringAccount;
  scope: Network;
  kind: TransactionDraftKind;
  transactions: DraftTransaction[];
  assetId?: string;
  asset?: AssetEntity | null;
  amount?: BigNumber;
  amountValue?: string;
  toAddress?: string;
  nativeTokenAsset?: AssetEntity | null;
  availableEnergy?: BigNumber;
  availableBandwidth?: BigNumber;
  feeLimit?: number;
  fees?: ComputeFeeResult;
};

export type TransactionDraftResult =
  | { type: 'draft'; draft: TransactionDraft }
  | { type: 'response'; response: Json };
