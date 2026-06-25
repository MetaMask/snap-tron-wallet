/* eslint-disable @typescript-eslint/naming-convention */
import { Types } from 'tronweb';

import { getTriggerSmartContractValue } from './transaction';

describe('transaction utilities', () => {
  describe('getTriggerSmartContractValue', () => {
    it('extracts TriggerSmartContract values', () => {
      const value = {
        data: 'abcdef',
        owner_address: '41458437be39f3a8bfdbfee7bef93e2c5f632ceff4',
        contract_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
      };
      const rawData: Types.Transaction['raw_data'] = {
        contract: [
          {
            type: Types.ContractType.TriggerSmartContract,
            parameter: {
              value,
              type_url: 'type.googleapis.com/protocol.TriggerSmartContract',
            },
          },
        ],
        ref_block_bytes: '',
        ref_block_hash: '',
        expiration: 0,
        timestamp: 0,
      };

      expect(getTriggerSmartContractValue(rawData)).toBe(value);
    });

    it('returns null for other contract types', () => {
      const rawData: Types.Transaction['raw_data'] = {
        contract: [
          {
            type: Types.ContractType.TransferContract,
            parameter: {
              value: {
                owner_address: '41458437be39f3a8bfdbfee7bef93e2c5f632ceff4',
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

      expect(getTriggerSmartContractValue(rawData)).toBeNull();
    });

    it('returns null for null input', () => {
      expect(getTriggerSmartContractValue(null)).toBeNull();
    });
  });
});
