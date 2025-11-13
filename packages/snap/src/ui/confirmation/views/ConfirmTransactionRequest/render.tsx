import type { DialogResult } from '@metamask/snaps-sdk';

import { ConfirmTransactionRequest } from './ConfirmTransactionRequest';
import type { ConfirmTransactionRequestContext } from './types';
import { Network } from '../../../../constants';
import { TRX_IMAGE_SVG } from '../../../../static/tron-logo';
import {
  createInterface,
  getPreferences,
  showDialog,
} from '../../../../utils/interface';

export const DEFAULT_CONFIRMATION_CONTEXT: ConfirmTransactionRequestContext = {
  scope: Network.Mainnet,
  fromAddress: null,
  amount: null,
  fee: '0',
  assetSymbol: 'TRX',
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

/**
 * Render the ConfirmTransactionRequest UI and show a dialog resolving to the user's choice.
 *
 * @param incomingContext - The initial context for the confirmation view.
 * @param incomingContext.scope - The network scope for the transaction.
 * @param incomingContext.fromAddress - The sender address.
 * @param incomingContext.amount - The amount to send (as a string).
 * @param incomingContext.fee - The estimated fee (as a string).
 * @param incomingContext.assetSymbol - The asset symbol (e.g., TRX).
 * @param incomingContext.origin - The origin string to display.
 * @returns A dialog result with the user's decision.
 */
export async function render(incomingContext: {
  scope: Network;
  fromAddress: string;
  amount: string;
  fee: string;
  assetSymbol: string;
  origin: string;
}): Promise<DialogResult> {
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
