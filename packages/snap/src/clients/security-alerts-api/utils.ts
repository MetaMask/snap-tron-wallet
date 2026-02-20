/* eslint-disable @typescript-eslint/naming-convention */
import { add0x } from '@metamask/utils';
import { TronWeb, Types } from 'tronweb';

import type { SecurityScanPayload } from './types';

export const SUPPORTED_CONTRACT_TYPES: Types.ContractType[] = [
  Types.ContractType.TransferContract,
  Types.ContractType.CreateSmartContract,
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
 * Builds a minimal `Transaction['raw_data']` suitable for security scanning
 * from high-level send parameters. This is the inverse of
 * {@link extractScanParametersFromTransactionData}.
 *
 * @param params - The send parameters.
 * @param params.from - The sender address (base58).
 * @param params.to - The recipient or contract address (base58).
 * @param params.amount - The amount in sun (for native TRX sends).
 * @param params.data - Optional contract call data (for TRC20 sends).
 * @param params.isTrc20 - Whether this is a TRC20 token transfer.
 * @returns A minimal raw transaction data object.
 */
export const buildTransactionRawData = ({
  from,
  to,
  amount,
  data,
  isTrc20,
}: {
  from: string;
  to: string;
  amount: number;
  data?: string | null;
  isTrc20: boolean;
}): Types.Transaction['raw_data'] => {
  const ownerAddressHex = TronWeb.address.toHex(from);

  if (isTrc20) {
    return {
      contract: [
        {
          type: Types.ContractType.TriggerSmartContract,
          parameter: {
            value: {
              owner_address: ownerAddressHex,
              contract_address: TronWeb.address.toHex(to),
              ...(data ? { data } : {}),
              ...(amount ? { call_value: amount } : {}),
            },
            type_url: 'type.googleapis.com/protocol.TriggerSmartContract',
          },
        },
      ],
      ref_block_bytes: '',
      ref_block_hash: '',
      expiration: 0,
      timestamp: 0,
    };
  }

  return {
    contract: [
      {
        type: Types.ContractType.TransferContract,
        parameter: {
          value: {
            owner_address: ownerAddressHex,
            to_address: TronWeb.address.toHex(to),
            amount,
          },
          type_url: 'type.googleapis.com/protocol.TransferContract',
        },
      },
    ],
    ref_block_bytes: '',
    ref_block_hash: '',
    expiration: 0,
    timestamp: 0,
  };
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
