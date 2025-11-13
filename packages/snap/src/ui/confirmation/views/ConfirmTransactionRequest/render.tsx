import { Network } from '../../../../constants';
import { TRX_IMAGE_SVG } from '../../../../static/tron-logo';
import {
  createInterface,
  getPreferences,
  showDialog,
} from '../../../../utils/interface';
import { ConfirmTransactionRequest } from './ConfirmTransactionRequest';
import type { ConfirmTransactionRequestContext } from './types';

export const DEFAULT_CONFIRMATION_CONTEXT: ConfirmTransactionRequestContext = {
  scope: Network.Mainnet,
  fromAddress: null,
  amount: null,
  fee: '0',
  origin: 'MetaMask',
  networkImage: TRX_IMAGE_SVG,
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
  origin: string;
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


