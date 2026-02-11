import { render } from './render';
import type { SnapClient } from '../../../../clients/snap/SnapClient';
import { Network } from '../../../../constants';
import type { AssetEntity } from '../../../../entities/assets';
import { BackgroundEventMethod } from '../../../../handlers/cronjob';
import type { TransactionScanService } from '../../../../services/transaction-scan/TransactionScanService';
import type { TransactionScanResult } from '../../../../services/transaction-scan/types';
import type { Preferences } from '../../../../types/snap';

// Mock the context module
jest.mock('../../../../context', () => ({
  __esModule: true, // eslint-disable-line @typescript-eslint/naming-convention
  default: {
    transactionScanService: null,
  },
}));

describe('ConfirmTransactionRequest render', () => {
  const mockPreferences: Preferences = {
    locale: 'en',
    currency: 'usd',
    hideBalances: false,
    useSecurityAlerts: true,
    useExternalPricingData: true,
    simulateOnChainActions: true,
    useTokenDetection: true,
    batchCheckBalances: true,
    displayNftMedia: true,
    useNftDetection: true,
  };

  const mockAsset: AssetEntity = {
    assetType: `${Network.Mainnet}/slip44:195`,
    keyringAccountId: 'account-1',
    network: Network.Mainnet,
    symbol: 'TRX',
    decimals: 6,
    rawAmount: '10000000',
    uiAmount: '10',
    iconUrl: '',
  };

  const mockScanResult: TransactionScanResult = {
    status: 'SUCCESS',
    estimatedChanges: {
      assets: [
        {
          type: 'out',
          value: '1000000',
          price: '0.1',
          symbol: 'TRX',
          name: 'Tron',
          logo: null,
          assetType: 'TRC20',
        },
      ],
    },
    validation: {
      type: 'Benign',
      reason: null,
    },
    error: null,
  };

  let mockSnapClient: jest.Mocked<SnapClient>;
  let mockTransactionScanService: jest.Mocked<TransactionScanService>;
  let mockState: any;

  beforeEach(() => {
    mockSnapClient = {
      createInterface: jest.fn().mockResolvedValue('interface-id-123'),
      showDialog: jest.fn().mockResolvedValue(true),
      updateInterface: jest.fn().mockResolvedValue(undefined),
      getPreferences: jest.fn().mockResolvedValue(mockPreferences),
      scheduleBackgroundEvent: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockTransactionScanService = {
      scanTransaction: jest.fn().mockResolvedValue(mockScanResult),
      getSecurityAlertDescription: jest.fn().mockReturnValue('description'),
    } as any;

    mockState = {
      setKey: jest.fn().mockResolvedValue(undefined),
      getKey: jest.fn().mockResolvedValue({}),
    } as any;

    // Update mocked context with our mocks
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-globals
    const snapContext = require('../../../../context').default;
    snapContext.transactionScanService = mockTransactionScanService;
  });

  const defaultIncomingContext = {
    scope: Network.Mainnet,
    fromAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
    toAddress: 'TQkE4s6hQqxym4fYvtVLNEGPsaAChFqxPk',
    amount: '1',
    fees: [],
    asset: mockAsset,
    origin: 'MetaMask',
    accountType: 'tron:eoa',
  };

  it('triggers security scan when preferences enable it', async () => {
    await render(mockSnapClient, mockState, defaultIncomingContext);

    // Verify createInterface was called
    expect(mockSnapClient.createInterface).toHaveBeenCalledTimes(1);

    // Verify showDialog was called with the interface ID
    expect(mockSnapClient.showDialog).toHaveBeenCalledWith('interface-id-123');

    // Verify security scan was triggered
    expect(mockTransactionScanService.scanTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        accountAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        parameters: {
          from: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
          to: 'TQkE4s6hQqxym4fYvtVLNEGPsaAChFqxPk',
          data: undefined,
          value: 1000000, // 1 TRX = 1000000 sun
        },
        origin: 'MetaMask',
        scope: Network.Mainnet,
        options: ['simulation', 'validation'],
      }),
    );

    // Verify interface was updated with scan results
    expect(mockSnapClient.updateInterface).toHaveBeenCalled();

    // Verify background refresh was scheduled for scan
    expect(mockSnapClient.scheduleBackgroundEvent).toHaveBeenCalledWith({
      method: BackgroundEventMethod.RefreshConfirmationSend,
      duration: 'PT20S',
    });
  });

  it('always triggers scan even when security preferences are disabled', async () => {
    mockSnapClient.getPreferences.mockResolvedValue({
      ...mockPreferences,
      useSecurityAlerts: false,
      simulateOnChainActions: false,
    });

    await render(mockSnapClient, mockState, defaultIncomingContext);

    // Scan is always triggered (simulation needed for estimated changes)
    expect(mockTransactionScanService.scanTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        options: ['simulation'],
      }),
    );

    // Background scan refresh should still be scheduled
    expect(mockSnapClient.scheduleBackgroundEvent).toHaveBeenCalledWith({
      method: BackgroundEventMethod.RefreshConfirmationSend,
      duration: 'PT20S',
    });
  });

  it('handles security scan failure gracefully', async () => {
    mockTransactionScanService.scanTransaction.mockRejectedValue(
      new Error('Scan failed'),
    );

    await render(mockSnapClient, mockState, defaultIncomingContext);

    // Should still create interface
    expect(mockSnapClient.createInterface).toHaveBeenCalledTimes(1);

    // Should update interface (with error state)
    expect(mockSnapClient.updateInterface).toHaveBeenCalled();

    // Verify the context passed to updateInterface has error state
    const updateCall = mockSnapClient.updateInterface.mock.calls[0];
    const contextArg = updateCall?.[2] as any;
    expect(contextArg?.scanFetchStatus).toBe('error');
    expect(contextArg?.scan).toBeNull();
  });

  it('handles missing transaction scan service gracefully', async () => {
    // Set transactionScanService to null for this test
    // eslint-disable-next-line no-restricted-globals, @typescript-eslint/no-require-imports
    const snapContext = require('../../../../context').default;
    snapContext.transactionScanService = null;

    await render(mockSnapClient, mockState, defaultIncomingContext);

    // Should still create interface
    expect(mockSnapClient.createInterface).toHaveBeenCalledTimes(1);

    // Scan should not be called
    expect(mockTransactionScanService.scanTransaction).not.toHaveBeenCalled();
  });

  it('uses fallback preferences when preferences fail to load', async () => {
    mockSnapClient.getPreferences.mockRejectedValue(
      new Error('Failed to load'),
    );

    // Should not throw
    const result = await render(
      mockSnapClient,
      mockState,
      defaultIncomingContext,
    );

    expect(result).toBe(true);

    // Should use defaults which have security enabled
    expect(mockTransactionScanService.scanTransaction).toHaveBeenCalled();
  });

  it('requests only simulation when useSecurityAlerts is false', async () => {
    mockSnapClient.getPreferences.mockResolvedValue({
      ...mockPreferences,
      useSecurityAlerts: false,
      simulateOnChainActions: true,
    });

    await render(mockSnapClient, mockState, defaultIncomingContext);

    expect(mockTransactionScanService.scanTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        options: ['simulation'],
      }),
    );
  });

  it('includes both simulation and validation when useSecurityAlerts is true', async () => {
    mockSnapClient.getPreferences.mockResolvedValue({
      ...mockPreferences,
      useSecurityAlerts: true,
      simulateOnChainActions: false,
    });

    await render(mockSnapClient, mockState, defaultIncomingContext);

    // Simulation is always included; validation added when useSecurityAlerts is true
    expect(mockTransactionScanService.scanTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        options: ['simulation', 'validation'],
      }),
    );
  });

  it('builds correct scan parameters for TRC20 tokens', async () => {
    const trc20Asset: AssetEntity = {
      ...mockAsset,
      assetType: `${Network.Mainnet}/trc20:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`,
      symbol: 'USDT',
      decimals: 6,
    };

    await render(mockSnapClient, mockState, {
      ...defaultIncomingContext,
      asset: trc20Asset,
    });

    // For TRC20, the `to` should be the contract address
    expect(mockTransactionScanService.scanTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({
          from: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
          to: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // contract address
          data: undefined,
          value: undefined, // null → undefined
        }),
      }),
    );
  });

  it('schedules price refresh when pricing data is enabled', async () => {
    await render(mockSnapClient, mockState, defaultIncomingContext);

    expect(mockSnapClient.scheduleBackgroundEvent).toHaveBeenCalledWith({
      method: BackgroundEventMethod.RefreshConfirmationPrices,
      duration: 'PT1S',
    });
  });

  it('returns the dialog promise result', async () => {
    const expectedResult = true;
    mockSnapClient.showDialog.mockResolvedValue(expectedResult);

    const result = await render(
      mockSnapClient,
      mockState,
      defaultIncomingContext,
    );

    expect(result).toBe(expectedResult);
  });

  it('stores interface ID in state for background refresh', async () => {
    await render(mockSnapClient, mockState, defaultIncomingContext);

    expect(mockState.setKey).toHaveBeenCalledWith(
      'mapInterfaceNameToId.confirmTransaction',
      'interface-id-123',
    );
  });
});
