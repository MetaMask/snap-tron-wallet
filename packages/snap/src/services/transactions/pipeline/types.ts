import type { Json } from '@metamask/snaps-sdk';
import type { BigNumber } from 'bignumber.js';
import type { Transaction } from 'tronweb/lib/esm/types';

import type { Network } from '../../../constants';
import type { AssetEntity } from '../../../entities/assets';
import type { TronKeyringAccount } from '../../../entities/keyring-account';
import type { StakedCaipAssetType } from '../../assets/types';
import type { ComputeFeeResult } from '../../send/types';

export type TransactionPipelineStepResult<Context> =
  | { type: 'continue'; context: Context }
  | { type: 'return'; response: Json };

export type TransactionPipelineStep<Context> = (
  context: Context,
) => Promise<TransactionPipelineStepResult<Context>>;

export type TransactionBundleKind =
  | 'raw'
  | 'send'
  | 'stake'
  | 'unstake'
  | 'claimUnstaked'
  | 'claimRewards';

export type BroadcastResult = {
  result: boolean;
  txid: string;
  message?: string;
};

export type TransactionPipelineContext = {
  accountId?: string;
  account?: TronKeyringAccount;
  scope?: Network;
  assetId?: string;
  asset?: AssetEntity | null;
  stakedAssetId?: StakedCaipAssetType;
  amount?: BigNumber;
  amountValue?: string;
  toAddress?: string;
  transactionBase64?: string;
  transactionType?: string;
  feeLimit?: number;
  purpose?: 'BANDWIDTH' | 'ENERGY';
  srNodeAddress?: string;
  kind?: TransactionBundleKind;
  transactions?: Transaction[];
  signedTransactions?: unknown[];
  broadcastResults?: BroadcastResult[];
  fees?: ComputeFeeResult;
  nativeTokenAsset?: AssetEntity | null;
  availableEnergy?: BigNumber;
  availableBandwidth?: BigNumber;
  message?: string;
  signedRewardsMessage?: {
    signature: string;
    signedMessage: string;
    signatureType: 'secp256k1';
  };
};
