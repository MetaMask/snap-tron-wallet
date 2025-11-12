import type { SpotPrices } from '../../../../clients/price-api/types';
import type { Network } from '../../../../constants';
import type { Preferences } from '../../../../types/snap';
import type { TronKeyringAccount } from '../../../../entities/keyring-account';
import type { ClientRequestMethod } from '../../../../handlers/clientRequest/types';

export type ConfirmTransactionRequestContext = {
  scope: Network;
  fromAddress: string | null;
  amount: string | null;
  fee: string | null;
  preferences: Preferences;
};


