import type { Network } from '../../../../constants';
import type { ComputeFeeResult } from '../../../../services/send/types';
import type { Preferences } from '../../../../types/snap';

export type ConfirmTransactionRequestContext = {
  origin: string;
  scope: Network;
  fromAddress: string | null;
  amount: string | null;
  fees: ComputeFeeResult;
  assetSymbol: string;
  preferences: Preferences;
  networkImage: string;
};
