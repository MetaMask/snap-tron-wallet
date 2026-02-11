import { BackgroundEventMethod, CronHandler } from './cronjob';
import type { PriceApiClient } from '../clients/price-api/PriceApiClient';
import type { SnapClient } from '../clients/snap/SnapClient';
import type { TronHttpClient } from '../clients/tron-http/TronHttpClient';
import { Network } from '../constants';
import type { AccountsService } from '../services/accounts/AccountsService';
import type { TransactionScanService } from '../services/transaction-scan/TransactionScanService';
import type { TransactionScanResult } from '../services/transaction-scan/types';
import type { ConfirmTransactionRequestContext } from '../ui/confirmation/views/ConfirmTransactionRequest/types';

describe('CronHandler - refreshConfirmationSend', () => {
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
    validation: { type: 'Benign', reason: null },
    error: null,
  };

  const mockInterfaceContext: ConfirmTransactionRequestContext = {
    origin: 'MetaMask',
    scope: Network.Mainnet,
    fromAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
    toAddress: 'TQkE4s6hQqxym4fYvtVLNEGPsaAChFqxPk',
    amount: '1',
    fees: [],
    asset: {
      assetType: `${Network.Mainnet}/slip44:195`,
      keyringAccountId: 'account-1',
      network: Network.Mainnet,
      symbol: 'TRX',
      decimals: 6,
      rawAmount: '10000000',
      uiAmount: '10',
      iconUrl: '',
    },
    preferences: {
      locale: 'en',
      currency: 'usd',
      hideBalances: false,
      useSecurityAlerts: true,
      useExternalPricingData: true,
      simulateOnChainActions: true,
      useTokenDetection: true,
      batchCheckBalances: true,
      displayNftMedia: false,
      useNftDetection: false,
    },
    networkImage: '',
    tokenPrices: {},
    tokenPricesFetchStatus: 'fetched',
    scan: null,
    scanFetchStatus: 'initial',
    scanParameters: {
      from: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
      to: 'TQkE4s6hQqxym4fYvtVLNEGPsaAChFqxPk',
      data: null,
      value: 1000000,
    },
    accountType: 'tron:eoa',
  };

  let mockSnapClient: jest.Mocked<SnapClient>;
  let mockState: any;
  let mockTransactionScanService: jest.Mocked<TransactionScanService>;
  let cronHandler: CronHandler;

  beforeEach(() => {
    mockSnapClient = {
      getClientStatus: jest
        .fn()
        .mockResolvedValue({ active: true, locked: false }),
      createInterface: jest.fn().mockResolvedValue('interface-id'),
      showDialog: jest.fn().mockResolvedValue(true),
      updateInterface: jest.fn().mockResolvedValue(undefined),
      getInterfaceContext: jest.fn().mockResolvedValue(mockInterfaceContext),
      scheduleBackgroundEvent: jest.fn().mockResolvedValue(undefined),
      getPreferences: jest.fn().mockResolvedValue({}),
    } as any;

    mockState = {
      setKey: jest.fn().mockResolvedValue(undefined),
      getKey: jest.fn().mockResolvedValue({
        confirmTransaction: 'interface-id-456',
      }),
    } as any;

    mockTransactionScanService = {
      scanTransaction: jest.fn().mockResolvedValue(mockScanResult),
      getSecurityAlertDescription: jest.fn().mockReturnValue('description'),
    } as any;

    const mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
    } as any;

    cronHandler = new CronHandler({
      logger: mockLogger,
      accountsService: {} as AccountsService,
      snapClient: mockSnapClient,
      state: mockState,
      priceApiClient: {} as PriceApiClient,
      tronHttpClient: {} as TronHttpClient,
      transactionScanService: mockTransactionScanService,
    });
  });

  it('refreshes security scan and updates interface', async () => {
    await cronHandler.refreshConfirmationSend();

    // Verify scan was called
    expect(mockTransactionScanService.scanTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        accountAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        options: ['simulation', 'validation'],
      }),
    );

    // Verify interface was updated (fetching state + final state)
    expect(mockSnapClient.updateInterface).toHaveBeenCalledTimes(2);

    // Verify next refresh was scheduled
    expect(mockSnapClient.scheduleBackgroundEvent).toHaveBeenCalledWith({
      method: BackgroundEventMethod.RefreshConfirmationSend,
      duration: 'PT20S',
    });
  });

  it('exits early when no active interface exists', async () => {
    mockState.getKey.mockResolvedValue({});

    await cronHandler.refreshConfirmationSend();

    expect(mockTransactionScanService.scanTransaction).not.toHaveBeenCalled();
    expect(mockSnapClient.updateInterface).not.toHaveBeenCalled();
  });

  it('cleans up when interface context no longer exists', async () => {
    mockSnapClient.getInterfaceContext.mockResolvedValue(null);

    await cronHandler.refreshConfirmationSend();

    expect(mockState.setKey).toHaveBeenCalledWith(
      'mapInterfaceNameToId.confirmTransaction',
      null,
    );
    expect(mockTransactionScanService.scanTransaction).not.toHaveBeenCalled();
  });

  it('skips refresh when required context fields are missing', async () => {
    mockSnapClient.getInterfaceContext.mockResolvedValue({
      ...mockInterfaceContext,
      fromAddress: null,
    });

    await cronHandler.refreshConfirmationSend();

    expect(mockTransactionScanService.scanTransaction).not.toHaveBeenCalled();
  });

  it('handles scan failure gracefully and sets error state', async () => {
    mockTransactionScanService.scanTransaction.mockRejectedValue(
      new Error('Scan API error'),
    );

    await cronHandler.refreshConfirmationSend();

    // Should still update interface with error status
    expect(mockSnapClient.updateInterface).toHaveBeenCalledTimes(2);

    // The final update should have scanFetchStatus: 'error'
    const lastUpdateCall = mockSnapClient.updateInterface.mock.calls[1];
    const contextArg = lastUpdateCall?.[2] as any;
    expect(contextArg?.scanFetchStatus).toBe('error');
  });

  it('exits gracefully when interface closes during refresh', async () => {
    // First call returns context (for initial check), second returns null (closed during scan)
    mockSnapClient.getInterfaceContext
      .mockResolvedValueOnce(mockInterfaceContext)
      .mockResolvedValueOnce(null);

    await cronHandler.refreshConfirmationSend();

    // Should not schedule next refresh
    expect(mockSnapClient.scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('includes only simulation when useSecurityAlerts is false', async () => {
    mockSnapClient.getInterfaceContext.mockResolvedValue({
      ...mockInterfaceContext,
      preferences: {
        ...mockInterfaceContext.preferences,
        useSecurityAlerts: false,
      },
    });

    await cronHandler.refreshConfirmationSend();

    expect(mockTransactionScanService.scanTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        options: ['simulation'],
      }),
    );
  });
});
