import type { Network } from '../../../../constants';
import type { Preferences } from '../../../../types/snap';

export type ConfirmTransactionRequestContext = {
  origin: string;
  scope: Network;
  fromAddress: string | null;
  amount: string | null;
  fee: string | null;
  preferences: Preferences;
  networkImage: string;
};


