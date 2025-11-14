import type { DialogResult } from '@metamask/snaps-sdk';

import type { SnapClient } from '../../../../clients/snap/SnapClient';
import { Network } from '../../../../constants';
import snapContext from '../../../../context';
import type { AssetEntity } from '../../../../entities/assets';
import { BackgroundEventMethod } from '../../../../handlers/cronjob';
import type { ComputeFeeResult } from '../../../../services/send/types';
import { TRX_IMAGE_SVG } from '../../../../static/tron-logo';
import { generateImageComponent } from '../../../utils/generateImageComponent';
import { getIconUrlForKnownAsset } from '../../utils/getIconUrlForKnownAsset';
import { ConfirmTransactionRequest } from './ConfirmTransactionRequest';
import type { ConfirmTransactionRequestContext } from './types';

export const CONFIRM_TRANSACTION_INTERFACE_NAME = 'confirmTransaction';

export const DEFAULT_CONFIRMATION_CONTEXT: ConfirmTransactionRequestContext = {
  scope: Network.Mainnet,
  fromAddress: null,
  toAddress: null,
  amount: null,
  fees: [],
  asset: {
    assetType: `${Network.Mainnet}/slip44:195`,
    keyringAccountId: '',
    network: Network.Mainnet,
    symbol: 'TRX',
    decimals: 6,
    rawAmount: '0',
    uiAmount: '0',
    iconUrl: '',
    imageSvg: TRX_IMAGE_SVG,
  },
  origin: 'MetaMask',
  networkImage: TRX_IMAGE_SVG,
  tokenPrices: {},
  tokenPricesFetchStatus: 'initial',
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
 * @param incomingContext.toAddress - The recipient address.
 * @param incomingContext.amount - The amount to send (as a string).
 * @param incomingContext.fees - The detailed fee breakdown array.
 * @param incomingContext.asset - The asset involved in the transaction.
 * @param incomingContext.origin - The origin string to display.
 * @returns A dialog result with the user's decision.
 */
export async function render(
  snapClient: SnapClient,
  incomingContext: {
    scope: Network;
    fromAddress: string;
    toAddress: string;
    amount: string;
    fees: ComputeFeeResult;
    asset: AssetEntity;
    origin: string;
  },
): Promise<DialogResult> {
  // 1. Initial context with loading state
  const context: ConfirmTransactionRequestContext = {
    ...DEFAULT_CONFIRMATION_CONTEXT,
    ...incomingContext,
    tokenPricesFetchStatus: 'fetching', // Start as fetching
  };

  console.log(
    'RENDERING CONFIRM TRANSACTION REQUEST WITH CONTEXT',
    JSON.stringify(context),
  );

  try {
    context.preferences = await snapClient.getPreferences();
  } catch {
    // keep defaults
  }

  /**
   * Generate SVG images for all assets (it's an async process so it must be done here).
   */
  const [assetSvg, ...feeSvgs] = await Promise.all([
    generateImageComponent(context.asset.iconUrl, 16, 16),
    ...context.fees.map(async (fee) => {
      return await generateImageComponent(
        getIconUrlForKnownAsset(fee.asset.type),
        16,
        16,
      );
    }),
  ]);

  /**
   * There will always be SVGs for the assets because we fallback to the question mark SVG.
   */
  context.asset = {
    ...context.asset,
    imageSvg: assetSvg,
  };
  context.fees.forEach((fee, index) => {
    fee.asset.imageSvg = feeSvgs[index] ?? '';
  });

  // 2. Initial render with loading skeleton
  const id = await snapClient.createInterface(
    <ConfirmTransactionRequest context={context} />,
    context,
  );
  const dialogPromise = snapClient.showDialog(id);
  
  // Store interface ID by name for background refresh (Solana pattern)
  await snapContext.state.setKey(
    `mapInterfaceNameToId.${CONFIRM_TRANSACTION_INTERFACE_NAME}`,
    id,
  );

  // 3. Fetch prices asynchronously for main asset AND fee assets
  if (context.preferences.useExternalPricingData) {
    // Collect all asset CAIP IDs (main asset + fee assets)
    const assetCaipIds = [
      context.asset.assetType,
      ...context.fees.map((fee) => fee.asset.type),
    ];
    const uniqueAssetCaipIds = [...new Set(assetCaipIds)];
    
    // Use the priceApiClient from context - cast to avoid type issues with CAIP IDs
    snapContext.priceApiClient.getMultipleSpotPrices(uniqueAssetCaipIds as any, context.preferences.currency)
      .then((prices) => {
        context.tokenPrices = prices;
        context.tokenPricesFetchStatus = 'fetched';
        
        // Update interface with prices
        return snapClient.updateInterface(
          id, 
          <ConfirmTransactionRequest context={context} />,
          context,
        );
      })
      .catch(() => {
        context.tokenPricesFetchStatus = 'error';
        
        // Update interface to remove loading state
        return snapClient.updateInterface(
          id, 
          <ConfirmTransactionRequest context={context} />,
          context,
        );
      });
  } else {
    // If pricing is disabled, set to fetched immediately
    context.tokenPricesFetchStatus = 'fetched';
    await snapClient.updateInterface(
      id, 
      <ConfirmTransactionRequest context={context} />,
      context,
    );
  }

  // 4. Schedule background refresh (like Solana does)
  await snapClient.scheduleBackgroundEvent({
    method: BackgroundEventMethod.RefreshConfirmationPrices,
    duration: '20s', // 20 seconds like Solana
  });

  // 5. Return the dialog promise immediately (don't await it!)
  // Cleanup happens in the background refresh handler when it detects the interface is gone
  return dialogPromise;
}
