import type { SpotPrices } from '../../../../clients/price-api/types';
import type { Network } from '../../../../constants';
import type { AssetEntity } from '../../../../entities/assets';
import type { ComputeFeeResult } from '../../../../services/send/types';
import type { FetchStatus, Preferences } from '../../../../types/snap';

export type ConfirmTransactionRequestContext = {
  origin: string;
  scope: Network;
  fromAddress: string | null;
  toAddress: string | null;
  amount: string | null;
  fees: ComputeFeeResult;
  asset: AssetEntity;
  preferences: Preferences;
  networkImage: string;
  tokenPrices: SpotPrices;
  tokenPricesFetchStatus: FetchStatus;
};
