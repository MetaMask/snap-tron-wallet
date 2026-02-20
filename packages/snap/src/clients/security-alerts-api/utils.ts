/* eslint-disable @typescript-eslint/naming-convention */
import { add0x, parseCaipAssetType } from '@metamask/utils';
import { TronWeb, Types } from 'tronweb';

import type { SecurityScanPayload } from './types';
import type { AssetEntity } from '../../entities/assets';

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

/**
 * Builds a minimal `Transaction['raw_data']` from the Send flow's scan
 * parameters and asset metadata. The resulting object carries just enough
 * structure for `isTransactionSupported` and
 * `extractScanParametersFromTransactionData` to work correctly.
 *
 * @param scanPayload - The scan payload with from/to/data/value.
 * @param asset - The asset being sent (used to determine contract type).
 * @returns A minimal Transaction raw_data suitable for the scan pipeline.
 */
export const buildTransactionRawData = (
  scanPayload: SecurityScanPayload,
  asset: AssetEntity,
): Types.Transaction['raw_data'] => {
  const { assetNamespace } = parseCaipAssetType(asset.assetType);
  const isTrc20 = assetNamespace === 'trc20';

  const ownerAddressHex = TronWeb.address.toHex(scanPayload.from ?? '');

  if (isTrc20) {
    return {
      contract: [
        {
          type: Types.ContractType.TriggerSmartContract,
          parameter: {
            type_url: 'type.googleapis.com/protocol.TriggerSmartContract',
            value: {
              owner_address: ownerAddressHex,
              contract_address: TronWeb.address.toHex(scanPayload.to ?? ''),
              call_value: scanPayload.value ?? 0,
              data: scanPayload.data ?? '',
            },
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
          type_url: 'type.googleapis.com/protocol.TransferContract',
          value: {
            owner_address: ownerAddressHex,
            to_address: TronWeb.address.toHex(scanPayload.to ?? ''),
            amount: scanPayload.value ?? 0,
          },
        },
      },
    ],
    ref_block_bytes: '',
    ref_block_hash: '',
    expiration: 0,
    timestamp: 0,
  };
};
