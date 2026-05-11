import type { SendErrorCodes } from '../../handlers/clientRequest/types';

export type TransactionResult = {
  success: boolean;
  txId: string;
  // TODO: Replace `any` with type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction: any;
};

export type SendValidationErrorCode =
  | SendErrorCodes.InsufficientBalance
  | SendErrorCodes.InsufficientBalanceToCoverFee;

export type SendValidationResult = {
  valid: boolean;
  errorCode?: SendValidationErrorCode;
};
