import type { FeeType } from '@metamask/keyring-api';

import type {
  NativeCaipAssetType,
  ResourceCaipAssetType,
} from '../assets/types';

export type TransactionResult = {
  success: boolean;
  txId: string;
  transaction: any;
};

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

export enum SendValidationErrorCode {
  InsufficientBalance = 'InsufficientBalance',
  InsufficientBalanceToCoverFee = 'InsufficientBalanceToCoverFee',
}

export type SendValidationResult = {
  valid: boolean;
  errorCode?: SendValidationErrorCode;
};
