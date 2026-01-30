import type { KeyringRequest } from '@metamask/keyring-api';
import type { DialogResult } from '@metamask/snaps-sdk';
import { assert } from '@metamask/superstruct';
import { BigNumber } from 'bignumber.js';
import { TronWeb } from 'tronweb';
import type { Transaction } from 'tronweb/lib/esm/types';

import { ConfirmSignTransaction } from './ConfirmSignTransaction';
import { CONFIRM_SIGN_TRANSACTION_INTERFACE_NAME } from './types';
import type { ConfirmSignTransactionContext } from './types';
import { Network, Networks, ZERO } from '../../../../constants';
import snapContext from '../../../../context';
import type { TronKeyringAccount } from '../../../../entities';
import { BackgroundEventMethod } from '../../../../handlers/cronjob';
import { TRX_IMAGE_SVG } from '../../../../static/tron-logo';
import { SignTransactionRequestStruct } from '../../../../validation/structs';
import { getIconUrlForKnownAsset } from '../../utils/getIconUrlForKnownAsset';

export const DEFAULT_CONTEXT: ConfirmSignTransactionContext = {
  scope: Network.Mainnet,
  account: null,
  transaction: {
    rawDataHex: '',
    type: '',
  },
  origin: '',
  networkImage: TRX_IMAGE_SVG,
  scan: null,
  scanFetchStatus: 'initial',
  tokenPrices: {},
  tokenPricesFetchStatus: 'initial',
  scanParameters: null,
  fees: [],
  feesFetchStatus: 'initial',
  preferences: {
    locale: 'en',
    currency: 'usd',
    hideBalances: false,
    useSecurityAlerts: true,
    useExternalPricingData: true,
    simulateOnChainActions: true,
    useTokenDetection: true,
    batchCheckBalances: true,
    displayNftMedia: false,
    useNftDetection: false,
  },
};

/**
 * Renders the confirmation dialog for a sign transaction request.
 *
 * @param request - The keyring request to confirm.
 * @param account - The account that the request is for.
 * @param deserializedTransaction - The deserialized transaction object.
 * @returns The confirmation dialog result.
 */
export async function render(
  request: KeyringRequest,
  account: TronKeyringAccount,
  deserializedTransaction: Transaction,
): Promise<DialogResult> {
  const { snapClient, transactionScanService } = snapContext;
  assert(request.request.params, SignTransactionRequestStruct);

  const {
    request: {
      params: { transaction },
    },
    scope,
    origin,
  } = request;

  // Build initial context
  const context: ConfirmSignTransactionContext = {
    ...DEFAULT_CONTEXT,
    scope: scope as Network,
    account,
    transaction,
    origin: origin ?? 'Unknown',
    scanFetchStatus: 'fetching',
    tokenPricesFetchStatus: 'initial',
    feesFetchStatus: 'initial',
  };

  const { assetsService, feeCalculatorService, priceApiClient } = snapContext;

  // Parallelize: Get preferences + Fetch account assets
  const [preferences, accountAssets] = await Promise.all([
    snapClient.getPreferences().catch(() => DEFAULT_CONTEXT.preferences),
    assetsService.getAssetsByAccountId(account.id, [
      Networks[scope as Network].bandwidth.id,
      Networks[scope as Network].energy.id,
    ]),
  ]);

  context.preferences = preferences;

  const { useSecurityAlerts, simulateOnChainActions, useExternalPricingData } =
    context.preferences;

  // Calculate fees
  try {
    const [bandwidthAsset, energyAsset] = accountAssets;

    const availableEnergy = energyAsset
      ? new BigNumber(energyAsset.rawAmount)
      : ZERO;
    const availableBandwidth = bandwidthAsset
      ? new BigNumber(bandwidthAsset.rawAmount)
      : ZERO;

    const fees = await feeCalculatorService.computeFee({
      scope: scope as Network,
      transaction: deserializedTransaction,
      availableEnergy,
      availableBandwidth,
      feeLimit: deserializedTransaction.raw_data.fee_limit as
        | number
        | undefined,
    });

    // Resolve icon URLs for fee assets
    fees.forEach((fee) => {
      fee.asset.iconUrl = getIconUrlForKnownAsset(fee.asset.type);
    });

    // Fetch prices if enabled
    const tokenPrices = useExternalPricingData
      ? await priceApiClient
          .getMultipleSpotPrices(
            [`${scope}/slip44:195`] as any,
            context.preferences.currency,
          )
          .catch(() => ({}))
      : {};

    context.fees = fees;
    context.feesFetchStatus = 'fetched';
    context.tokenPrices = tokenPrices;
    context.tokenPricesFetchStatus = 'fetched';
  } catch {
    context.fees = [];
    context.feesFetchStatus = 'error';
    context.tokenPrices = {};
    context.tokenPricesFetchStatus = 'error';
  }

  // Extract scan parameters early (before interface creation)
  const contractParam = deserializedTransaction.raw_data.contract?.[0]
    ?.parameter?.value as any;
  const fromHex = contractParam?.owner_address ?? '';
  const toHex =
    contractParam?.contract_address ?? contractParam?.to_address ?? '';
  const value = contractParam?.amount ?? null;
  const dataHex = contractParam?.data ?? null;

  // Convert hex addresses to base58 format
  const from = fromHex ? TronWeb.address.fromHex(fromHex) : '';
  const to = toHex ? TronWeb.address.fromHex(toHex) : '';
  const data = dataHex ? `0x${dataHex}` : null;

  context.scanParameters = {
    from,
    to,
    data,
    value,
  };

  // Create initial interface with loading state
  const id = await snapClient.createInterface(
    <ConfirmSignTransaction context={context} />,
    context,
  );

  const dialogPromise = snapClient.showDialog(id);

  // Parallelize: Store interface ID + Start security scan
  const storeIdPromise = snapContext.state.setKey(
    `mapInterfaceNameToId.${CONFIRM_SIGN_TRANSACTION_INTERFACE_NAME}`,
    id,
  );

  // If security scanning is enabled, scan the transaction
  if (transactionScanService && (useSecurityAlerts || simulateOnChainActions)) {
    const options: string[] = [];

    if (simulateOnChainActions) {
      options.push('simulation');
    }

    if (useSecurityAlerts) {
      options.push('validation');
    }

    try {
      const scan = await transactionScanService.scanTransaction({
        accountAddress: account.address,
        parameters: {
          from: from ?? undefined,
          to: to ?? undefined,
          data: data ?? undefined,
          value: value ?? undefined,
        },
        origin,
        scope: scope as Network,
        options,
      });

      context.scan = scan;
      context.scanFetchStatus = scan ? 'fetched' : 'error';
    } catch {
      context.scan = null;
      context.scanFetchStatus = 'error';
    }

    // Ensure interface ID is stored before updating
    await storeIdPromise;

    // Update interface with scan results
    await snapClient.updateInterface(
      id,
      <ConfirmSignTransaction context={context} />,
      context,
    );

    await snapClient.scheduleBackgroundEvent({
      method: BackgroundEventMethod.RefreshSignTransaction,
      duration: 'PT20S',
    });
  } else {
    // No scanning, mark as fetched immediately
    context.scanFetchStatus = 'fetched';

    // Ensure interface ID is stored before updating
    await storeIdPromise;

    await snapClient.updateInterface(
      id,
      <ConfirmSignTransaction context={context} />,
      context,
    );
  }

  return dialogPromise;
}
