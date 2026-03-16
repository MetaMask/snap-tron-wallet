/* eslint-disable @typescript-eslint/naming-convention */
import { Types } from 'tronweb';

import { TransactionScanService } from './TransactionScanService';
import { SimulationStatus } from './types';
import type { SecurityAlertSimulationValidationResponse } from '../../clients/security-alerts-api/types';
import { Network } from '../../constants';
import { mockLogger } from '../../utils/mockLogger';

/**
 * Builds mock raw transaction data for testing.
 *
 * @param contractType - The contract type to use.
 * @param count - Number of contract entries to include.
 * @returns A mock raw data object.
 */
function buildRawData(
  contractType: Types.ContractType,
  count = 1,
): Types.Transaction['raw_data'] {
  return {
    contract: Array.from({ length: count }, () => ({
      type: contractType,
      parameter: {
        value: {
          owner_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
          to_address: '4191bba2f3f6e1c4d5c8e8f5b6a7c8d9e0f1a2b3c4',
          amount: 1000000,
        },
        type_url: `type.googleapis.com/protocol.${contractType}`,
      },
    })),
    ref_block_bytes: '',
    ref_block_hash: '',
    expiration: 0,
    timestamp: 0,
  };
}

/**
 * Builds a mock Security Alerts API response for testing.
 *
 * @param overrides - Partial overrides to apply to the default response.
 * @returns A mock API response.
 */
function buildApiResponse(
  overrides: Partial<SecurityAlertSimulationValidationResponse> = {},
): SecurityAlertSimulationValidationResponse {
  return {
    validation: {
      status: 'Success',
      result_type: 'Benign',
      description: '',
      reason: '',
      classification: '',
      features: [],
    },
    simulation: {
      status: 'Success',
      assets_diffs: {},
      transaction_actions: [],
      total_usd_diff: {},
      exposures: {},
      total_usd_exposure: {},
      address_details: {},
      account_summary: {
        assets_diffs: [],
        traces: [],
        total_usd_diff: { in: '0', out: '0', total: '0' },
        exposures: [],
        total_usd_exposure: {},
      },
      params: {},
      contract_management: {},
      session_key: {},
      missing_balances: [],
      simulation_run_count: 1,
    },
    events: [],
    features: {},
    block: '100',
    chain: 'tron',
    account_address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
    ...overrides,
  } as SecurityAlertSimulationValidationResponse;
}

describe('TransactionScanService', () => {
  let mockSecurityAlertsApiClient: { scanTransaction: jest.Mock };
  let mockSnapClient: {
    trackSecurityScanCompleted: jest.Mock;
    trackSecurityAlertDetected: jest.Mock;
  };
  let service: TransactionScanService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSecurityAlertsApiClient = {
      scanTransaction: jest.fn(),
    };
    mockSnapClient = {
      trackSecurityScanCompleted: jest.fn(),
      trackSecurityAlertDetected: jest.fn(),
    };
    service = new TransactionScanService(
      mockSecurityAlertsApiClient as never,
      mockSnapClient as never,
      mockLogger,
    );
  });

  describe('scanTransaction', () => {
    it('returns skipped result without calling API for unsupported contract types', async () => {
      const rawData = buildRawData(Types.ContractType.FreezeBalanceContract);

      const result = await service.scanTransaction({
        accountAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        transactionRawData: rawData,
        origin: 'https://example.com',
        scope: Network.Mainnet,
      });

      expect(
        mockSecurityAlertsApiClient.scanTransaction,
      ).not.toHaveBeenCalled();
      expect(result).toStrictEqual({
        status: 'SUCCESS',
        estimatedChanges: { assets: [] },
        validation: { type: null, reason: null },
        error: null,
        simulationStatus: SimulationStatus.Skipped,
      });
    });

    it('returns error result for malformed transactions with multiple contracts', async () => {
      const rawData = buildRawData(Types.ContractType.TransferContract, 2);

      const result = await service.scanTransaction({
        accountAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        transactionRawData: rawData,
        origin: 'https://example.com',
        scope: Network.Mainnet,
      });

      expect(
        mockSecurityAlertsApiClient.scanTransaction,
      ).not.toHaveBeenCalled();
      expect(result?.status).toBe('ERROR');
      expect(result?.simulationStatus).toBe(SimulationStatus.Failed);
      expect(result?.error?.type).toBe('MALFORMED_TRANSACTION');
    });

    it('calls the API for supported single-contract TransferContract', async () => {
      const rawData = buildRawData(Types.ContractType.TransferContract);
      mockSecurityAlertsApiClient.scanTransaction.mockResolvedValue(
        buildApiResponse(),
      );

      const result = await service.scanTransaction({
        accountAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        transactionRawData: rawData,
        origin: 'https://example.com',
        scope: Network.Mainnet,
      });

      expect(mockSecurityAlertsApiClient.scanTransaction).toHaveBeenCalledTimes(
        1,
      );
      expect(result?.simulationStatus).toBe(SimulationStatus.Completed);
      expect(result?.status).toBe('SUCCESS');
    });

    it('calls the API for TriggerSmartContract', async () => {
      const rawData = buildRawData(Types.ContractType.TriggerSmartContract);
      mockSecurityAlertsApiClient.scanTransaction.mockResolvedValue(
        buildApiResponse(),
      );

      const result = await service.scanTransaction({
        accountAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        transactionRawData: rawData,
        origin: 'https://example.com',
        scope: Network.Mainnet,
      });

      expect(mockSecurityAlertsApiClient.scanTransaction).toHaveBeenCalledTimes(
        1,
      );
      expect(result?.simulationStatus).toBe(SimulationStatus.Completed);
    });

    it('replaces metamask origin with URL', async () => {
      const rawData = buildRawData(Types.ContractType.TransferContract);
      mockSecurityAlertsApiClient.scanTransaction.mockResolvedValue(
        buildApiResponse(),
      );

      await service.scanTransaction({
        accountAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        transactionRawData: rawData,
        origin: 'metamask',
        scope: Network.Mainnet,
      });

      expect(mockSecurityAlertsApiClient.scanTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ origin: 'https://metamask.io' }),
      );
    });

    it('returns null when API returns empty result', async () => {
      const rawData = buildRawData(Types.ContractType.TransferContract);
      mockSecurityAlertsApiClient.scanTransaction.mockResolvedValue(null);

      const result = await service.scanTransaction({
        accountAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        transactionRawData: rawData,
        origin: 'https://example.com',
        scope: Network.Mainnet,
      });

      expect(result).toBeNull();
    });

    it('returns null and logs error when API throws', async () => {
      const rawData = buildRawData(Types.ContractType.TransferContract);
      mockSecurityAlertsApiClient.scanTransaction.mockRejectedValue(
        new Error('API failure'),
      );

      const result = await service.scanTransaction({
        accountAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        transactionRawData: rawData,
        origin: 'https://example.com',
        scope: Network.Mainnet,
      });

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('maps ERROR status when simulation status is Error', async () => {
      const rawData = buildRawData(Types.ContractType.TransferContract);
      const response = buildApiResponse();
      response.simulation.status = 'Error';
      response.simulation.error = 'Simulation failed';
      mockSecurityAlertsApiClient.scanTransaction.mockResolvedValue(response);

      const result = await service.scanTransaction({
        accountAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        transactionRawData: rawData,
        origin: 'https://example.com',
        scope: Network.Mainnet,
      });

      expect(result?.status).toBe('ERROR');
      expect(result?.simulationStatus).toBe(SimulationStatus.Failed);
    });

    it('maps asset diffs with in changes', async () => {
      const rawData = buildRawData(Types.ContractType.TransferContract);
      const response = buildApiResponse();
      response.simulation.account_summary.assets_diffs = [
        {
          asset_type: 'NATIVE',
          asset: {
            type: 'NATIVE',
            name: 'TRX',
            symbol: 'TRX',
            decimals: 6,
            logo_url: null,
          },
          in: [
            {
              usd_price: '0.10',
              summary: '+1 TRX',
              value: '1',
              raw_value: '1000000',
            },
          ],
          out: [],
        },
      ];
      mockSecurityAlertsApiClient.scanTransaction.mockResolvedValue(response);

      const result = await service.scanTransaction({
        accountAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        transactionRawData: rawData,
        origin: 'https://example.com',
        scope: Network.Mainnet,
      });

      expect(result?.estimatedChanges.assets).toHaveLength(1);
      expect(result?.estimatedChanges.assets[0]?.type).toBe('in');
      expect(result?.estimatedChanges.assets[0]?.symbol).toBe('TRX');
    });

    it('maps asset diffs with out changes', async () => {
      const rawData = buildRawData(Types.ContractType.TransferContract);
      const response = buildApiResponse();
      response.simulation.account_summary.assets_diffs = [
        {
          asset_type: 'TRC20',
          asset: {
            type: 'TRC20',
            address: 'TXYZ',
            symbol: 'USDT',
            name: 'Tether',
            decimals: 6,
            logo_url: 'https://logo.png',
          },
          in: [],
          out: [
            {
              usd_price: '1.00',
              summary: '-10 USDT',
              value: '10',
              raw_value: '10000000',
            },
          ],
        },
      ];
      mockSecurityAlertsApiClient.scanTransaction.mockResolvedValue(response);

      const result = await service.scanTransaction({
        accountAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        transactionRawData: rawData,
        origin: 'https://example.com',
        scope: Network.Mainnet,
      });

      expect(result?.estimatedChanges.assets).toHaveLength(1);
      expect(result?.estimatedChanges.assets[0]?.type).toBe('out');
      expect(result?.estimatedChanges.assets[0]?.logo).toBe('https://logo.png');
    });

    it('tracks analytics when account is provided', async () => {
      const rawData = buildRawData(Types.ContractType.TransferContract);
      mockSecurityAlertsApiClient.scanTransaction.mockResolvedValue(
        buildApiResponse(),
      );

      const account = {
        address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        type: 'tron:eoa',
      };

      await service.scanTransaction({
        accountAddress: account.address,
        transactionRawData: rawData,
        origin: 'https://example.com',
        scope: Network.Mainnet,
        account: account as never,
      });

      expect(mockSnapClient.trackSecurityScanCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ scanStatus: 'SUCCESS' }),
      );
    });

    it('tracks security alert when validation is Malicious', async () => {
      const rawData = buildRawData(Types.ContractType.TransferContract);
      const response = buildApiResponse();
      response.validation.result_type = 'Malicious';
      response.validation.reason = 'known_attacker';
      mockSecurityAlertsApiClient.scanTransaction.mockResolvedValue(response);

      const account = {
        address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        type: 'tron:eoa',
      };

      await service.scanTransaction({
        accountAddress: account.address,
        transactionRawData: rawData,
        origin: 'https://example.com',
        scope: Network.Mainnet,
        account: account as never,
      });

      expect(mockSnapClient.trackSecurityAlertDetected).toHaveBeenCalledWith(
        expect.objectContaining({
          securityAlertResponse: 'Malicious',
          securityAlertReason: 'known_attacker',
        }),
      );
    });

    it('tracks error analytics when API throws and account is provided', async () => {
      const rawData = buildRawData(Types.ContractType.TransferContract);
      mockSecurityAlertsApiClient.scanTransaction.mockRejectedValue(
        new Error('fail'),
      );

      const account = {
        address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        type: 'tron:eoa',
      };

      await service.scanTransaction({
        accountAddress: account.address,
        transactionRawData: rawData,
        origin: 'https://example.com',
        scope: Network.Mainnet,
        account: account as never,
      });

      expect(mockSnapClient.trackSecurityScanCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ scanStatus: 'ERROR' }),
      );
    });
  });

  describe('getSecurityAlertDescription', () => {
    it('returns description for known_attacker reason', () => {
      const description = service.getSecurityAlertDescription({
        type: 'Malicious',
        reason: 'known_attacker',
      });

      expect(description).toContain('known attacker');
    });

    it('returns generic description for unknown reason', () => {
      const description = service.getSecurityAlertDescription({
        type: 'Warning',
        reason: 'some_new_reason',
      });

      expect(description).toBe('Security alert: some_new_reason');
    });

    it('returns unknown reason when reason is null', () => {
      const description = service.getSecurityAlertDescription({
        type: 'Warning',
        reason: null,
      });

      expect(description).toBe('Security alert: Unknown reason');
    });
  });
});
