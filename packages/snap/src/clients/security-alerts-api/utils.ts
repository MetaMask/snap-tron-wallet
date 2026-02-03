import { add0x } from '@metamask/utils';
import { TronWeb, Types } from 'tronweb';

import type { SecurityScanPayload } from './types';

export const SUPPORTED_CONTRACT_TYPES: Types.ContractType[] = [
  Types.ContractType.TransferContract,
  Types.ContractType.TransferAssetContract,
  Types.ContractType.TriggerSmartContract,
];

/**
 * Extracts scan parameters from the raw transaction data. This function
 * can be used as adapter between a Tron transaction and the payload
 * supported by SecurityAlertsApiClient.
 *
 * @param rawData - The raw transaction data.
 * @returns The extracted scan parameters.
 */
export const extractScanParametersFromTransactionData = (
  rawData: Types.Transaction['raw_data'],
): SecurityScanPayload | null => {
  const contractParam = rawData.contract[0]?.parameter.value;
  if (!contractParam) {
    return null;
  }

  const from = TronWeb.address.fromHex(contractParam.owner_address);

  let to = '';
  if ('contract_address' in contractParam && contractParam.contract_address) {
    to = TronWeb.address.fromHex(contractParam.contract_address);
  } else if ('to_address' in contractParam && contractParam.to_address) {
    to = TronWeb.address.fromHex(contractParam.to_address);
  }

  let value = 0;
  if ('call_value' in contractParam && contractParam.call_value) {
    value = contractParam.call_value;
  } else if ('amount' in contractParam && contractParam.amount) {
    value = contractParam.amount;
  }

  let data: string | null = null;
  if ('data' in contractParam && contractParam.data) {
    data = add0x(contractParam.data);
  }

  return { from, to, data, value };
};

/**
 * Checks if the given transaction is supported for scanning.
 *
 * @param rawData - The raw transaction data.
 * @returns True if the transaction is supported, false otherwise.
 */
export const isTransactionSupported = (
  rawData: Types.Transaction['raw_data'],
): boolean => {
  if (rawData.contract.length > 1) {
    // We only support transactions with a single contract interaction for now
    return false;
  }

  const [contractInteraction] = rawData.contract;
  if (!contractInteraction) {
    // No contract interaction found
    return false;
  }

  if (!SUPPORTED_CONTRACT_TYPES.includes(contractInteraction.type)) {
    // Unsupported contract type
    return false;
  }

  return true;
};
