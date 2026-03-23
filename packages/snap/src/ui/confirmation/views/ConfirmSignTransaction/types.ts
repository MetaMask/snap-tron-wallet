import type { SpotPrices } from '../../../../clients/price-api/types';
import type { SecurityScanPayload } from '../../../../clients/security-alerts-api/types';
import type { Network } from '../../../../constants';
import type { TronKeyringAccount } from '../../../../entities/keyring-account';
import type { ComputeFeeResult } from '../../../../services/send/types';
import type { TransactionScanResult } from '../../../../services/transaction-scan/types';
import type { FetchStatus, Preferences } from '../../../../types/snap';

export const CONFIRM_SIGN_TRANSACTION_INTERFACE_NAME = 'confirmSignTransaction';

export type ConfirmSignTransactionContext = {
  scope: Network;
  account: TronKeyringAccount | null;
  transaction: {
    rawDataHex: string;
    type: string;
  };
  origin: string;
  preferences: Preferences;
  networkImage: string;
  scan: TransactionScanResult | null;
  scanFetchStatus: FetchStatus;
  scanParameters: SecurityScanPayload | null;
  tokenPrices: SpotPrices;
  tokenPricesFetchStatus: FetchStatus;
  fees: ComputeFeeResult;
  feesFetchStatus: FetchStatus;
};
