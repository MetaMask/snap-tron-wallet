/* eslint-disable @typescript-eslint/naming-convention */
import { TransactionBuilderService } from './TransactionBuilderService';
import { Network } from '../../constants';
import { mockLogger } from '../../utils/mockLogger';
import nativeTransferMock from '../transactions/mocks/native-transfer.json';
import trc20TransferMock from '../transactions/mocks/trc20-transfer.json';

const mockTronWebFactory = {
  createClient: jest.fn(),
} as any;

describe('TransactionBuilderService', () => {
  let transactionBuilderService: TransactionBuilderService;
  let mockTronWebClient: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockTronWebClient = {
      utils: {
        deserializeTx: {
          deserializeTransaction: jest.fn(),
        },
      },
    };

    mockTronWebFactory.createClient.mockReturnValue(mockTronWebClient);

    transactionBuilderService = new TransactionBuilderService({
      logger: mockLogger,
      tronWebFactory: mockTronWebFactory,
    });
  });

  describe('fromHex', () => {
    it('deserializes a TRC20 transaction correctly', async () => {
      mockTronWebClient.utils.deserializeTx.deserializeTransaction.mockReturnValue(
        trc20TransferMock.raw_data,
      );

      const result = await transactionBuilderService.fromHex(
        trc20TransferMock.raw_data_hex,
        'TriggerSmartContract',
        Network.Mainnet,
      );

      // Returns a Transaction object directly
      expect(result.visible).toBe(false);
      expect(result.raw_data_hex).toBe(trc20TransferMock.raw_data_hex);
      expect(result.raw_data).toStrictEqual(trc20TransferMock.raw_data);
      expect(result.raw_data.fee_limit).toBe(225000000);
    });

    it('deserializes a native transfer transaction correctly', async () => {
      mockTronWebClient.utils.deserializeTx.deserializeTransaction.mockReturnValue(
        nativeTransferMock.raw_data,
      );

      const result = await transactionBuilderService.fromHex(
        nativeTransferMock.raw_data_hex,
        'TransferContract',
        Network.Mainnet,
      );

      expect(result.visible).toBe(false);
      expect(result.raw_data_hex).toBe(nativeTransferMock.raw_data_hex);
      expect(result.raw_data).toStrictEqual(nativeTransferMock.raw_data);

      // Native transfers don't have fee_limit
      expect(result.raw_data.fee_limit).toBeUndefined();
    });

    it('always sets visible to false', async () => {
      mockTronWebClient.utils.deserializeTx.deserializeTransaction.mockReturnValue(
        trc20TransferMock.raw_data,
      );

      const result = await transactionBuilderService.fromHex(
        trc20TransferMock.raw_data_hex,
        'TriggerSmartContract',
        Network.Mainnet,
      );

      // Key invariant: visible is always false for deserialized transactions
      expect(result.visible).toBe(false);
    });

    it('extracts feeLimit from raw_data', async () => {
      mockTronWebClient.utils.deserializeTx.deserializeTransaction.mockReturnValue(
        trc20TransferMock.raw_data,
      );

      const result = await transactionBuilderService.fromHex(
        trc20TransferMock.raw_data_hex,
        'TriggerSmartContract',
        Network.Mainnet,
      );

      // TRC20 mock has fee_limit: 225000000 (225 TRX)
      expect(result.raw_data.fee_limit).toBe(225000000);
    });

    it('handles transactions without fee_limit', async () => {
      const rawDataWithoutFeeLimit = {
        ...nativeTransferMock.raw_data,
        fee_limit: undefined,
      };

      mockTronWebClient.utils.deserializeTx.deserializeTransaction.mockReturnValue(
        rawDataWithoutFeeLimit,
      );

      const result = await transactionBuilderService.fromHex(
        nativeTransferMock.raw_data_hex,
        'TransferContract',
        Network.Mainnet,
      );

      expect(result.raw_data.fee_limit).toBeUndefined();
    });

    it('calculates txID from raw_data_hex', async () => {
      mockTronWebClient.utils.deserializeTx.deserializeTransaction.mockReturnValue(
        trc20TransferMock.raw_data,
      );

      const result = await transactionBuilderService.fromHex(
        trc20TransferMock.raw_data_hex,
        'TriggerSmartContract',
        Network.Mainnet,
      );

      // txID should be a 64-character hex string (SHA256 hash)
      expect(result.txID).toMatch(/^[0-9a-f]{64}$/u);
    });

    it('handles empty contract array gracefully', async () => {
      mockTronWebClient.utils.deserializeTx.deserializeTransaction.mockReturnValue(
        {
          contract: [],
          ref_block_bytes: '0000',
          ref_block_hash: '0000000000000000',
          expiration: 0,
          timestamp: 0,
        },
      );

      const result = await transactionBuilderService.fromHex(
        'deadbeef',
        'Unknown',
        Network.Mainnet,
      );

      // Should still return a valid Transaction object
      expect(result.visible).toBe(false);
      expect(result.raw_data.contract).toStrictEqual([]);
    });

    it('logs warning for base58 addresses in raw_data', async () => {
      // Simulate a transaction with base58 address (should not happen, but we want to warn)
      const contract = trc20TransferMock.raw_data.contract[0];
      const rawDataWithBase58 = {
        ...trc20TransferMock.raw_data,
        contract: [
          {
            ...contract,
            parameter: {
              ...contract?.parameter,
              value: {
                ...contract?.parameter?.value,
                owner_address: 'TGzz8gjYiYRqpfmDwnLxfgPuLVNmpCswVp', // base58 format
              },
            },
          },
        ],
      };

      mockTronWebClient.utils.deserializeTx.deserializeTransaction.mockReturnValue(
        rawDataWithBase58,
      );

      await transactionBuilderService.fromHex(
        trc20TransferMock.raw_data_hex,
        'TriggerSmartContract',
        Network.Mainnet,
      );

      // Should log a warning about base58 address
      // Logger prefix is first arg due to createPrefixedLogger
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[🔨 TransactionBuilderService]',
        expect.objectContaining({ field: 'owner_address' }),
        expect.stringContaining('base58 format'),
      );
    });
  });

  describe('fromBase64', () => {
    it('converts base64 to hex and calls fromHex', async () => {
      mockTronWebClient.utils.deserializeTx.deserializeTransaction.mockReturnValue(
        trc20TransferMock.raw_data,
      );

      // Convert the hex to base64 for the test
      // eslint-disable-next-line no-restricted-globals
      const base64Data = Buffer.from(
        trc20TransferMock.raw_data_hex,
        'hex',
      ).toString('base64');

      const result = await transactionBuilderService.fromBase64(
        base64Data,
        'TriggerSmartContract',
        Network.Mainnet,
      );

      expect(result.raw_data_hex).toBe(trc20TransferMock.raw_data_hex);
      expect(result.visible).toBe(false);
    });
  });

  describe('address validation', () => {
    it('validates hex addresses correctly', async () => {
      mockTronWebClient.utils.deserializeTx.deserializeTransaction.mockReturnValue(
        trc20TransferMock.raw_data,
      );

      await transactionBuilderService.fromHex(
        trc20TransferMock.raw_data_hex,
        'TriggerSmartContract',
        Network.Mainnet,
      );

      // No warnings should be logged for valid hex addresses
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('warns about addresses that are neither hex nor base58', async () => {
      const contract = trc20TransferMock.raw_data.contract[0];
      const rawDataWithInvalidAddress = {
        ...trc20TransferMock.raw_data,
        contract: [
          {
            ...contract,
            parameter: {
              ...contract?.parameter,
              value: {
                ...contract?.parameter?.value,
                owner_address: 'invalid_address_format',
              },
            },
          },
        ],
      };

      mockTronWebClient.utils.deserializeTx.deserializeTransaction.mockReturnValue(
        rawDataWithInvalidAddress,
      );

      await transactionBuilderService.fromHex(
        trc20TransferMock.raw_data_hex,
        'TriggerSmartContract',
        Network.Mainnet,
      );

      // Logger prefix is first arg due to createPrefixedLogger
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[🔨 TransactionBuilderService]',
        expect.objectContaining({ field: 'owner_address' }),
        expect.stringContaining('not in expected hex format'),
      );
    });
  });
});
