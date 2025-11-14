import type { Network } from '../../../../constants';
import type { ComputeFeeResult } from '../../../../services/send/types';
import type { Preferences } from '../../../../types/snap';
import type { AssetEntity } from '../../../../entities/assets';

export type ConfirmTransactionRequestContext = {
  origin: string;
  scope: Network;
  fromAddress: string | null;
  amount: string | null;
  fees: ComputeFeeResult;
  asset: AssetEntity;
  preferences: Preferences;
  networkImage: string;
};
