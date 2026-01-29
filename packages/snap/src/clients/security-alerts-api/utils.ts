import { add0x } from '@metamask/utils';
import { TronWeb } from 'tronweb';
import type { Transaction } from 'tronweb/lib/esm/types';

import type { SecurityScanPayload } from './types';

/**
 * Extracts scan parameters from the raw transaction data. This function
 * can be used as adapter between a Tron transaction and the payload
 * supported by SecurityAlertsApiClient.
 *
 * @param rawData - The raw transaction data.
 * @returns The extracted scan parameters.
 */
export const extractScanParametersFromTransactionData = (
  rawData: Transaction['raw_data'],
): SecurityScanPayload | null => {
  const contractParam = rawData.contract[0]?.parameter.value;
  if (!contractParam) {
    return null;
  }

  let to = '';
  let value = 0;
  let data: string | null = null;
  const from = TronWeb.address.fromHex(contractParam.owner_address);

  if ('contract_address' in contractParam) {
    to = TronWeb.address.fromHex(contractParam.contract_address);
    if ('call_value' in contractParam && contractParam.call_value) {
      value = contractParam.call_value;
    }
  }

  if ('to_address' in contractParam) {
    to = TronWeb.address.fromHex(contractParam.to_address);
    value = contractParam.amount;
  }

  if ('data' in contractParam && contractParam.data) {
    data = add0x(contractParam.data);
  }

  return { from, to, data, value };
};
