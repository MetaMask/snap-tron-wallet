import { ClientRequestMethod } from '../../../../handlers/clientRequest/types';
import { BigNumber } from 'bignumber.js';
import { Network, Networks } from '../../../../constants';
import {
  CONFIRM_SIGN_AND_SEND_TRANSACTION_INTERFACE_NAME,
  createInterface,
  getPreferences,
  showDialog,
  updateInterface,
} from '../../../../utils/interface';
import logger from '../../../../utils/logger';
import snapContext from '../../../../context';
import { ConfirmTransactionRequest } from './ConfirmTransactionRequest';
import type { ConfirmTransactionRequestContext } from './types';

export const DEFAULT_CONFIRMATION_CONTEXT: ConfirmTransactionRequestContext = {
  scope: Network.Mainnet,
  fromAddress: null,
  amount: null,
  fee: null,
  preferences: {
    locale: 'en',
    currency: 'usd',
    hideBalances: false,
    useSecurityAlerts: false,
    useExternalPricingData: true,
    simulateOnChainActions: false,
    useTokenDetection: true,
    batchCheckBalances: true,
    displayNftMedia: false,
    useNftDetection: false,
  },
};

export async function render(incomingContext: {
  scope: Network;
  fromAddress: string;
  amount: string;
  fee: string;
}) {
  const context: ConfirmTransactionRequestContext = {
    ...DEFAULT_CONFIRMATION_CONTEXT,
    ...incomingContext,
  };

  try {
    context.preferences = await getPreferences();
  } catch {
    // keep defaults
  }

  const id = await createInterface(
    <ConfirmTransactionRequest context={context} />,
    context,
  );
  const dialogPromise = showDialog(id);

  return dialogPromise;
}


