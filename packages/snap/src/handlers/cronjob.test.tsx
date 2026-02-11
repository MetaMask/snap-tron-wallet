import { BackgroundEventMethod, CronHandler } from './cronjob';
import type { PriceApiClient } from '../clients/price-api/PriceApiClient';
import type { SnapClient } from '../clients/snap/SnapClient';
import type { TronHttpClient } from '../clients/tron-http/TronHttpClient';
import { Network } from '../constants';
import type { AccountsService } from '../services/accounts/AccountsService';
import type { TransactionScanService } from '../services/transaction-scan/TransactionScanService';
import type { TransactionScanResult } from '../services/transaction-scan/types';
import type { ConfirmTransactionRequestContext } from '../ui/confirmation/views/ConfirmTransactionRequest/types';

/**
 * Builds a mock scan result for use in tests.
 *
 * @param overrides - Optional overrides for the scan result.
 * @returns A mock TransactionScanResult.
 */
function buildMockScanResult(
  overrides: Partial<TransactionScanResult> = {},
): TransactionScanResult {
  return {
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
    ...overrides,
  };
}

/**
 * Builds a mock interface context for the send confirmation dialog.
 *
 * @param overrides - Optional overrides for context fields.
 * @returns A mock ConfirmTransactionRequestContext.
 */
function buildMockInterfaceContext(
  overrides: Partial<ConfirmTransactionRequestContext> = {},
): ConfirmTransactionRequestContext {
  return {
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
    ...overrides,
  };
}

/**
 * The callback that `withCronHandler` calls.
 */
type WithCronHandlerCallback = (payload: {
  cronHandler: CronHandler;
  mockSnapClient: jest.Mocked<SnapClient>;
  mockState: jest.Mocked<{ getKey: jest.Mock; setKey: jest.Mock }>;
  mockTransactionScanService: jest.Mocked<TransactionScanService>;
}) => Promise<void> | void;

/**
 * Options for the `withCronHandler` factory function.
 */
type WithCronHandlerOptions = {
  interfaceContext?: ConfirmTransactionRequestContext | null;
  scanResult?: TransactionScanResult;
  mapInterfaceNameToId?: Record<string, string>;
};

/**
 * Constructs a CronHandler with sensible defaults and calls the given test
 * function with the handler and all mocks. Overrides can be provided to
 * configure the mocks for specific test scenarios.
 *
 * @param args - Either a function, or an options bag + a function.
 * @returns The return value of the given function.
 */
async function withCronHandler(
  ...args:
    | [WithCronHandlerCallback]
    | [WithCronHandlerOptions, WithCronHandlerCallback]
): Promise<void> {
  const [options, testFunction] = args.length === 2 ? args : [{}, args[0]];

  const {
    interfaceContext = buildMockInterfaceContext(),
    scanResult = buildMockScanResult(),
    mapInterfaceNameToId = { confirmTransaction: 'interface-id-456' },
  } = options;

  const mockSnapClient = {
    getClientStatus: jest
      .fn()
      .mockResolvedValue({ active: true, locked: false }),
    createInterface: jest.fn().mockResolvedValue('interface-id'),
    showDialog: jest.fn().mockResolvedValue(true),
    updateInterface: jest.fn().mockResolvedValue(undefined),
    getInterfaceContext: jest.fn().mockResolvedValue(interfaceContext),
    scheduleBackgroundEvent: jest.fn().mockResolvedValue(undefined),
    getPreferences: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<SnapClient>;

  const mockState = {
    setKey: jest.fn().mockResolvedValue(undefined),
    getKey: jest.fn().mockResolvedValue(mapInterfaceNameToId),
  } as unknown as jest.Mocked<{ getKey: jest.Mock; setKey: jest.Mock }>;

  const mockTransactionScanService = {
    scanTransaction: jest.fn().mockResolvedValue(scanResult),
    getSecurityAlertDescription: jest.fn().mockReturnValue('description'),
  } as unknown as jest.Mocked<TransactionScanService>;

  const cronHandler = new CronHandler({
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
    } as any,
    accountsService: {} as AccountsService,
    snapClient: mockSnapClient,
    state: mockState as any,
    priceApiClient: {} as PriceApiClient,
    tronHttpClient: {} as TronHttpClient,
    transactionScanService: mockTransactionScanService,
  });

  await testFunction({
    cronHandler,
    mockSnapClient,
    mockState,
    mockTransactionScanService,
  });
}

describe('CronHandler', () => {
  describe('refreshConfirmationSend', () => {
    it('refreshes security scan and updates interface', async () => {
      await withCronHandler(
        async ({ cronHandler, mockSnapClient, mockTransactionScanService }) => {
          await cronHandler.refreshConfirmationSend();

          expect(
            mockTransactionScanService.scanTransaction,
          ).toHaveBeenCalledWith(
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
        },
      );
    });

    it('exits early when no active interface exists', async () => {
      await withCronHandler(
        { mapInterfaceNameToId: {} },
        async ({ cronHandler, mockSnapClient, mockTransactionScanService }) => {
          await cronHandler.refreshConfirmationSend();

          expect(
            mockTransactionScanService.scanTransaction,
          ).not.toHaveBeenCalled();
          expect(mockSnapClient.updateInterface).not.toHaveBeenCalled();
        },
      );
    });

    it('cleans up when interface context no longer exists', async () => {
      await withCronHandler(
        { interfaceContext: null },
        async ({ cronHandler, mockState, mockTransactionScanService }) => {
          await cronHandler.refreshConfirmationSend();

          expect(mockState.setKey).toHaveBeenCalledWith(
            'mapInterfaceNameToId.confirmTransaction',
            null,
          );
          expect(
            mockTransactionScanService.scanTransaction,
          ).not.toHaveBeenCalled();
        },
      );
    });

    it('skips refresh when required context fields are missing', async () => {
      await withCronHandler(
        {
          interfaceContext: buildMockInterfaceContext({ fromAddress: null }),
        },
        async ({ cronHandler, mockTransactionScanService }) => {
          await cronHandler.refreshConfirmationSend();

          expect(
            mockTransactionScanService.scanTransaction,
          ).not.toHaveBeenCalled();
        },
      );
    });

    it('handles scan failure gracefully and sets error state', async () => {
      await withCronHandler(
        async ({ cronHandler, mockSnapClient, mockTransactionScanService }) => {
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
        },
      );
    });

    it('exits gracefully when interface closes during refresh', async () => {
      const context = buildMockInterfaceContext();
      await withCronHandler(
        { interfaceContext: context },
        async ({ cronHandler, mockSnapClient }) => {
          // First call returns context (initial check), second returns null (closed during scan)
          mockSnapClient.getInterfaceContext
            .mockResolvedValueOnce(context)
            .mockResolvedValueOnce(null);

          await cronHandler.refreshConfirmationSend();

          // Should not schedule next refresh
          expect(mockSnapClient.scheduleBackgroundEvent).not.toHaveBeenCalled();
        },
      );
    });

    it('includes only simulation when useSecurityAlerts is false', async () => {
      await withCronHandler(
        {
          interfaceContext: buildMockInterfaceContext({
            preferences: {
              locale: 'en',
              currency: 'usd',
              hideBalances: false,
              useSecurityAlerts: false,
              useExternalPricingData: true,
              simulateOnChainActions: true,
              useTokenDetection: true,
              batchCheckBalances: true,
              displayNftMedia: false,
              useNftDetection: false,
            },
          }),
        },
        async ({ cronHandler, mockTransactionScanService }) => {
          await cronHandler.refreshConfirmationSend();

          expect(
            mockTransactionScanService.scanTransaction,
          ).toHaveBeenCalledWith(
            expect.objectContaining({
              options: ['simulation'],
            }),
          );
        },
      );
    });
  });
});
