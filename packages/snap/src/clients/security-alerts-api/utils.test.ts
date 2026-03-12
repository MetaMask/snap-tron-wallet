/* eslint-disable @typescript-eslint/naming-convention */
import { Types } from 'tronweb';

import {
  buildTransactionRawData,
  extractScanParametersFromTransactionData,
  isTransactionSupported,
  SUPPORTED_CONTRACT_TYPES,
} from './utils';
import type { TransferContractParameter } from '../trongrid/types';

describe('SecurityAlertsApiClient utils', () => {
  describe('extractScanParametersFromTransactionData', () => {
    it('extracts scan parameters from a TransferContractParameter', () => {
      const contractInteraction: TransferContractParameter = {
        type_url: 'type.googleapis.com/protocol.TransferContract',
        value: {
          owner_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
          to_address: '4191bba2f3f6e1c4d5c8e8f5b6a7c8d9e0f1a2b3c4',
          amount: 500000,
        },
      };
      const rawData: Types.Transaction['raw_data'] = {
        contract: [
          {
            type: Types.ContractType.TransferContract,
            parameter: contractInteraction,
          },
        ],
        ref_block_bytes: '',
        ref_block_hash: '',
        expiration: 0,
        timestamp: 0,
      };

      const result = extractScanParametersFromTransactionData(rawData);

      expect(result).toStrictEqual({
        from: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        to: 'TPFmm695uHPTn8wNmQbF8yMiZxfCeUdXkJ',
        data: null,
        value: 500000,
      });
    });

    it('extract scan parameters from a TriggerSmartContract', () => {
      const contractInteraction = {
        type_url: 'type.googleapis.com/protocol.TriggerSmartContract',
        value: {
          owner_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
          contract_address: '4191bba2f3f6e1c4d5c8e8f5b6a7c8d9e0f1a2b3c4',
          call_value: 200000,
          data: 'abcdef',
        },
      };
      const rawData: Types.Transaction['raw_data'] = {
        contract: [
          {
            type: Types.ContractType.TriggerSmartContract,
            parameter: contractInteraction,
          },
        ],
        ref_block_bytes: '',
        ref_block_hash: '',
        expiration: 0,
        timestamp: 0,
      };

      const result = extractScanParametersFromTransactionData(rawData);

      expect(result).toStrictEqual({
        from: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        to: 'TPFmm695uHPTn8wNmQbF8yMiZxfCeUdXkJ',
        data: '0xabcdef',
        value: 200000,
      });
    });

    it('returns null if no contract parameter is found', () => {
      const rawData: Types.Transaction['raw_data'] = {
        contract: [],
        ref_block_bytes: '',
        ref_block_hash: '',
        expiration: 0,
        timestamp: 0,
      };

      const result = extractScanParametersFromTransactionData(rawData);

      expect(result).toBeNull();
    });
  });

  describe('isTransactionSupported', () => {
    it('returns false for transactions with multiple contract interactions', () => {
      const rawData: Types.Transaction['raw_data'] = {
        contract: [
          {
            type: Types.ContractType.TransferContract,
            parameter: {
              value: {
                owner_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
                contract_address: '4191bba2f3f6e1c4d5c8e8f5b6a7c8d9e0f1a2b3c4',
                call_value: 200000,
                data: 'abcdef',
              },
              type_url: 'type.googleapis.com/protocol.TriggerSmartContract',
            },
          },
          {
            type: Types.ContractType.TriggerSmartContract,
            parameter: {
              value: {
                owner_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
                contract_address: '4191bba2f3f6e1c4d5c8e8f5b6a7c8d9e0f1a2b3c4',
                call_value: 200000,
                data: 'abcdef',
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

      const result = isTransactionSupported(rawData);

      expect(result).toBe(false);
    });

    it.each([
      Types.ContractType.AccountUpdateContract,
      Types.ContractType.FreezeBalanceContract,
      Types.ContractType.UnfreezeBalanceContract,
      Types.ContractType.WithdrawBalanceContract,
      Types.ContractType.UpdateAssetContract,
      Types.ContractType.ParticipateAssetIssueContract,
      Types.ContractType.AccountPermissionUpdateContract,
      Types.ContractType.ExchangeCreateContract,
      Types.ContractType.ExchangeInjectContract,
      Types.ContractType.ExchangeWithdrawContract,
      Types.ContractType.ExchangeTransactionContract,
      Types.ContractType.TransferAssetContract,
    ])(
      'returns false for transactions with unsupported contract types',
      (contractType) => {
        const rawData: Types.Transaction['raw_data'] = {
          contract: [
            {
              type: contractType,
              parameter: {
                value: {
                  owner_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
                  contract_address:
                    '4191bba2f3f6e1c4d5c8e8f5b6a7c8d9e0f1a2b3c4',
                  call_value: 200000,
                  data: 'abcdef',
                },
                // This is here only to make TypeScript happy; the actual type_url is irrelevant for the test
                type_url: 'type.googleapis.com/protocol.UnknownContract',
              },
            },
          ],
          ref_block_bytes: '',
          ref_block_hash: '',
          expiration: 0,
          timestamp: 0,
        };

        const result = isTransactionSupported(rawData);

        expect(result).toBe(false);
      },
    );

    it.each(SUPPORTED_CONTRACT_TYPES)(
      'returns true for transactions with a single supported contract type',
      (contractType) => {
        const rawData: Types.Transaction['raw_data'] = {
          contract: [
            {
              type: contractType,
              parameter: {
                value: {
                  owner_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
                  contract_address:
                    '4191bba2f3f6e1c4d5c8e8f5b6a7c8d9e0f1a2b3c4',
                  call_value: 200000,
                  data: 'abcdef',
                },
                // This is here only to make TypeScript happy; the actual type_url is irrelevant for the test
                type_url: 'type.googleapis.com/protocol.UnknownContract',
              },
            },
          ],
          ref_block_bytes: '',
          ref_block_hash: '',
          expiration: 0,
          timestamp: 0,
        };

        const result = isTransactionSupported(rawData);

        expect(result).toBe(true);
      },
    );
  });

  describe('buildTransactionRawData', () => {
    it('builds a TransferContract for native TRX sends', () => {
      const result = buildTransactionRawData({
        from: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        to: 'TPFmm695uHPTn8wNmQbF8yMiZxfCeUdXkJ',
        amount: 1000000,
        contractType: Types.ContractType.TransferContract,
      });

      expect(result.contract).toHaveLength(1);
      expect(result.contract[0]?.type).toBe(
        Types.ContractType.TransferContract,
      );
      expect(result.contract[0]?.parameter.value).toStrictEqual({
        owner_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
        to_address: '4191bba2f3f6e1c4d5c8e8f5b6a7c8d9e0f1a2b3c4',
        amount: 1000000,
      });
    });

    it('builds a TriggerSmartContract for smart contract calls', () => {
      const result = buildTransactionRawData({
        from: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        to: 'TPFmm695uHPTn8wNmQbF8yMiZxfCeUdXkJ',
        amount: 200000,
        data: 'abcdef',
        contractType: Types.ContractType.TriggerSmartContract,
      });

      expect(result.contract).toHaveLength(1);
      expect(result.contract[0]?.type).toBe(
        Types.ContractType.TriggerSmartContract,
      );
      expect(result.contract[0]?.parameter.value).toStrictEqual({
        owner_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
        contract_address: '4191bba2f3f6e1c4d5c8e8f5b6a7c8d9e0f1a2b3c4',
        call_value: 200000,
        data: 'abcdef',
      });
    });

    it('omits call_value when amount is 0 for TriggerSmartContract', () => {
      const result = buildTransactionRawData({
        from: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        to: 'TPFmm695uHPTn8wNmQbF8yMiZxfCeUdXkJ',
        amount: 0,
        contractType: Types.ContractType.TriggerSmartContract,
      });

      expect(result.contract[0]?.parameter.value).toStrictEqual({
        owner_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
        contract_address: '4191bba2f3f6e1c4d5c8e8f5b6a7c8d9e0f1a2b3c4',
      });
    });

    it('omits data when not provided for TriggerSmartContract', () => {
      const result = buildTransactionRawData({
        from: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        to: 'TPFmm695uHPTn8wNmQbF8yMiZxfCeUdXkJ',
        amount: 100,
        contractType: Types.ContractType.TriggerSmartContract,
      });

      expect(result.contract[0]?.parameter.value).not.toHaveProperty('data');
    });

    it('round-trips through extractScanParametersFromTransactionData for TransferContract', () => {
      const rawData = buildTransactionRawData({
        from: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        to: 'TPFmm695uHPTn8wNmQbF8yMiZxfCeUdXkJ',
        amount: 500000,
        contractType: Types.ContractType.TransferContract,
      });

      const extracted = extractScanParametersFromTransactionData(rawData);

      expect(extracted).toStrictEqual({
        from: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        to: 'TPFmm695uHPTn8wNmQbF8yMiZxfCeUdXkJ',
        data: null,
        value: 500000,
      });
    });

    it('round-trips through extractScanParametersFromTransactionData for TriggerSmartContract', () => {
      const rawData = buildTransactionRawData({
        from: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        to: 'TPFmm695uHPTn8wNmQbF8yMiZxfCeUdXkJ',
        amount: 300000,
        data: 'abcdef',
        contractType: Types.ContractType.TriggerSmartContract,
      });

      const extracted = extractScanParametersFromTransactionData(rawData);

      expect(extracted).toStrictEqual({
        from: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        to: 'TPFmm695uHPTn8wNmQbF8yMiZxfCeUdXkJ',
        data: '0xabcdef',
        value: 300000,
      });
    });
  });
});
