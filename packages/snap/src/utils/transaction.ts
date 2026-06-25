import { Types } from 'tronweb';

export type TriggerSmartContractValue = {
  data?: unknown;
};

/**
 * Extracts the TriggerSmartContract value from transaction raw data.
 *
 * @param rawData - The transaction raw data.
 * @returns The trigger contract value, or null for other contract types.
 */
export function getTriggerSmartContractValue(
  rawData: Types.Transaction['raw_data'] | null,
): TriggerSmartContractValue | null {
  if (!rawData || typeof rawData !== 'object') {
    return null;
  }

  const contract = rawData.contract?.[0];
  if (
    !contract ||
    String(contract.type) !== String(Types.ContractType.TriggerSmartContract)
  ) {
    return null;
  }

  const value = contract.parameter?.value;
  return value && typeof value === 'object'
    ? (value as TriggerSmartContractValue)
    : null;
}
