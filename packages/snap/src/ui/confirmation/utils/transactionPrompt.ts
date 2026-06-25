import type { Types } from 'tronweb';

import { decodeCallDataParams } from '../../../utils/abi';
import { toTronAddress } from '../../../utils/address';
import { normalizeHex } from '../../../utils/hex';
import type { LocalizedMessage } from '../../../utils/i18n';
import { getTriggerSmartContractValue } from '../../../utils/transaction';

const SELECTORS = {
  Approve: '095ea7b3',
  EnterMarkets: 'c2998238',
  EnterMarket: '3fe5d425',
  ExitMarket: 'ede4edd0',
} as const;

export type TransactionPrompt = {
  titleKey: LocalizedMessage;
  actionKey: LocalizedMessage;
  targetLabelKey?: LocalizedMessage;
  targetAddress?: string;
};

/**
 * Decodes the first market address from Compound/JustLend `enterMarkets`.
 *
 * @param data - The normalized calldata.
 * @returns The first market address, if present.
 */
function getEnterMarketsTargetAddress(data: string): string | undefined {
  const decoded = decodeCallDataParams(data, ['address[]']);
  const markets = decoded?.[0];

  if (Array.isArray(markets)) {
    return toTronAddress(markets[0]);
  }

  return undefined;
}

/**
 * Decodes a single address parameter from TRON calldata.
 *
 * @param data - The normalized calldata.
 * @returns The decoded base58 TRON address, if present.
 */
function getAddressTarget(data: string): string | undefined {
  const decoded = decodeCallDataParams(data, ['address']);

  return toTronAddress(decoded?.[0]);
}

/**
 * Builds a specialized confirmation prompt for recognized TRON contract calls.
 *
 * @param rawData - The transaction raw data.
 * @returns Prompt metadata, or null for unrecognized transactions.
 */
export function getTransactionPrompt(
  rawData: Types.Transaction['raw_data'] | null,
): TransactionPrompt | null {
  const triggerValue = getTriggerSmartContractValue(rawData);
  const data = normalizeHex(triggerValue?.data);

  if (!data || data.length < 8) {
    return null;
  }

  const selector = data.slice(0, 8);

  if (selector === SELECTORS.Approve) {
    return {
      titleKey: 'confirmation.transactionAction.authorizeToken',
      actionKey: 'confirmation.transactionAction.authorizeToken',
      targetLabelKey: 'confirmation.transactionTarget.spender',
      targetAddress: getAddressTarget(data),
    };
  }

  if (selector === SELECTORS.EnterMarkets) {
    return {
      titleKey: 'confirmation.transactionAction.enableCollateral',
      actionKey: 'confirmation.transactionAction.enableCollateral',
      targetLabelKey: 'confirmation.transactionTarget.collateralMarket',
      targetAddress: getEnterMarketsTargetAddress(data),
    };
  }

  if (selector === SELECTORS.EnterMarket) {
    return {
      titleKey: 'confirmation.transactionAction.enableCollateral',
      actionKey: 'confirmation.transactionAction.enableCollateral',
      targetLabelKey: 'confirmation.transactionTarget.collateralMarket',
      targetAddress: getAddressTarget(data),
    };
  }

  if (selector === SELECTORS.ExitMarket) {
    return {
      titleKey: 'confirmation.transactionAction.disableCollateral',
      actionKey: 'confirmation.transactionAction.disableCollateral',
      targetLabelKey: 'confirmation.transactionTarget.collateralMarket',
      targetAddress: getAddressTarget(data),
    };
  }

  return null;
}
