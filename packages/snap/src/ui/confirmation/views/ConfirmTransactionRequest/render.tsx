import type { DialogResult } from '@metamask/snaps-sdk';

import { ConfirmTransactionRequest } from './ConfirmTransactionRequest';
import type { ConfirmTransactionRequestContext } from './types';
import type { SnapClient } from '../../../../clients/snap/SnapClient';
import { Network } from '../../../../constants';
import type { ComputeFeeResult } from '../../../../services/send/types';
import { TRX_IMAGE_SVG } from '../../../../static/tron-logo';

export const DEFAULT_CONFIRMATION_CONTEXT: ConfirmTransactionRequestContext = {
  scope: Network.Mainnet,
  fromAddress: null,
  amount: null,
  fees: [],
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
 * @param snapClient - The SnapClient instance for API interactions.
 * @param incomingContext - The initial context for the confirmation view.
 * @param incomingContext.scope - The network scope for the transaction.
 * @param incomingContext.fromAddress - The sender address.
 * @param incomingContext.amount - The amount to send (as a string).
 * @param incomingContext.fees - The detailed fee breakdown array.
 * @param incomingContext.assetSymbol - The asset symbol (e.g., TRX).
 * @param incomingContext.origin - The origin string to display.
 * @returns A dialog result with the user's decision.
 */
export async function render(
  snapClient: SnapClient,
  incomingContext: {
    scope: Network;
    fromAddress: string;
    amount: string;
    fees: ComputeFeeResult;
    assetSymbol: string;
    origin: string;
  },
): Promise<DialogResult> {
  const context: ConfirmTransactionRequestContext = {
    ...DEFAULT_CONFIRMATION_CONTEXT,
    ...incomingContext,
  };

  try {
    context.preferences = await snapClient.getPreferences();
  } catch {
    // keep defaults
  }

  const id = await snapClient.createInterface(
    <ConfirmTransactionRequest context={context} />,
    context,
  );
  const dialogPromise = snapClient.showDialog(id);

  return dialogPromise;
}
