import { InMemoryCache } from './caching/InMemoryCache';
import { StateCache } from './caching/StateCache';
import { PriceApiClient } from './clients/price-api/PriceApiClient';
import { SecurityAlertsApiClient } from './clients/security-alerts-api/SecurityAlertsApiClient';
import { SnapClient } from './clients/snap/SnapClient';
import { TokenApiClient } from './clients/token-api/TokenApiClient';
import { TronHttpClient } from './clients/tron-http/TronHttpClient';
import { TrongridApiClient } from './clients/trongrid/TrongridApiClient';
import { TronWebFactory } from './clients/tronweb/TronWebFactory';
import { AssetsHandler } from './handlers/assets';
import { ClientRequestHandler } from './handlers/clientRequest/clientRequest';
import { CronHandler } from './handlers/cronjob';
import { KeyringHandler } from './handlers/keyring';
import { RpcHandler } from './handlers/rpc/rpc';
import { UserInputHandler } from './handlers/userInput';
import { AccountsRepository } from './services/accounts/AccountsRepository';
import { AccountsService } from './services/accounts/AccountsService';
import { AssetsRepository } from './services/assets/AssetsRepository';
import { AssetsService } from './services/assets/AssetsService';
import { ConfigProvider } from './services/config';
import { ConfirmationHandler } from './services/confirmation/ConfirmationHandler';
import { SendService } from './services/send/SendService';
import { StakingService } from './services/staking/StakingService';
import type { UnencryptedStateValue } from './services/state/State';
import { State } from './services/state/State';
import {
  RawTransactionParser,
  TransactionBroadcaster,
  TransactionFeeEstimator,
  TransactionService,
} from './services/transaction';
import { TransactionHistoryRepository } from './services/transaction-history/TransactionHistoryRepository';
import { TransactionHistoryService } from './services/transaction-history/TransactionHistoryService';
import { TransactionScanService } from './services/transaction-scan/TransactionScanService';
import { WalletService } from './services/wallet/WalletService';
import logger, { noOpLogger } from './utils/logger';

/**
 * Services
 *
 * Dependency injection order:
 * 1. Core services (ConfigProvider, State, Connection)
 * 2. Repositories (AssetsRepository, TransactionHistoryRepository, AccountsRepository)
 * 3. Business services (AssetsService, TransactionHistoryService, AccountsService)
 * 4. Handlers (AssetsHandler, CronHandler, KeyringHandler, RpcHandler, UserInputHandler)
 */
export const configProvider = new ConfigProvider();

const state = new State({
  encrypted: false,
  defaultState: {
    keyringAccounts: {},
    assets: {},
    tokenPrices: {},
    transactions: {},
    mapInterfaceNameToId: {},
  },
});

const snapClient = new SnapClient();

// Repositories - depend on State
const accountsRepository = new AccountsRepository(state);
const assetsRepository = new AssetsRepository(state);
const transactionsRepository = new TransactionHistoryRepository(state);

// Clients
const tronHttpClient = new TronHttpClient({ configProvider });

// Cache for TrongridApiClient (chain parameters caching)
// Using StateCache to persist cache across Snap restarts
const trongridCache = new StateCache(state, noOpLogger, '__cache__trongrid');
const trongridApiClient = new TrongridApiClient({
  configProvider,
  tronHttpClient,
  cache: trongridCache,
});
const tronWebFactory = new TronWebFactory({
  configProvider,
});

// Cache for PriceApiClient
const priceCache = new InMemoryCache(noOpLogger);
const priceApiClient = new PriceApiClient(configProvider, priceCache);

// Token API client
const tokenApiClient = new TokenApiClient(configProvider);

// Security Alerts API client
const securityAlertsApiClient = new SecurityAlertsApiClient(
  configProvider,
  logger,
);

// Business Services - depend on Repositories, State and other Services
const assetsService = new AssetsService({
  logger,
  state,
  assetsRepository,
  trongridApiClient,
  tronHttpClient,
  priceApiClient,
  tokenApiClient,
});

const transactionsService = new TransactionHistoryService({
  logger,
  transactionsRepository,
  trongridApiClient,
  tronHttpClient,
});

const accountsService = new AccountsService({
  logger,
  snapClient,
  accountsRepository,
  configProvider,
  assetsService,
  transactionsService,
});

const transactionFeeEstimator = new TransactionFeeEstimator({
  logger,
  trongridApiClient,
  tronHttpClient,
});

const rawTransactionParser = new RawTransactionParser({
  tronWebFactory,
});

const transactionBroadcaster = new TransactionBroadcaster({
  accountsService,
  tronWebFactory,
  snapClient,
});

const transactionService = new TransactionService({
  rawTransactionParser,
  transactionFeeEstimator,
  transactionBroadcaster,
  accountsService,
  assetsService,
  snapClient,
});

const sendService = new SendService({
  logger,
  accountsService,
  assetsService,
  tronWebFactory,
  transactionService,
});

const stakingService = new StakingService({
  logger,
  tronWebFactory,
  transactionService,
});

const walletService = new WalletService({
  logger,
  accountsService,
  tronWebFactory,
});

const transactionScanService = new TransactionScanService(
  securityAlertsApiClient,
  snapClient,
  logger,
);

const confirmationHandler = new ConfirmationHandler({
  snapClient,
  state,
  tronWebFactory,
});

/**
 * Handlers
 */
const assetsHandler = new AssetsHandler({
  logger,
  assetsService,
});
const clientRequestHandler = new ClientRequestHandler({
  logger,
  snapClient,
  accountsService,
  assetsService,
  sendService,
  tronWebFactory,
  transactionService,
  stakingService,
  confirmationHandler,
  transactionsService,
});
const cronHandler = new CronHandler({
  logger,
  snapClient,
  accountsService,
  state,
  priceApiClient,
  tronHttpClient,
  transactionScanService,
});
const keyringHandler = new KeyringHandler({
  logger,
  snapClient,
  accountsService,
  assetsService,
  transactionsService,
  walletService,
  confirmationHandler,
});
const rpcHandler = new RpcHandler({
  logger,
});
const userInputHandler = new UserInputHandler({
  logger,
  snapClient,
});

export type SnapExecutionContext = {
  /**
   * Clients
   */
  snapClient: SnapClient;
  /**
   * Services
   */
  state: State<UnencryptedStateValue>;
  priceApiClient: PriceApiClient;
  transactionService: TransactionService;
  assetsService: AssetsService;
  accountsService: AccountsService;
  transactionsService: TransactionHistoryService;
  sendService: SendService;
  walletService: WalletService;
  tronHttpClient: TronHttpClient;
  tronWebFactory: TronWebFactory;
  confirmationHandler: ConfirmationHandler;
  transactionScanService: TransactionScanService;
  /**
   * Handlers
   */
  assetsHandler: AssetsHandler;
  cronHandler: CronHandler;
  clientRequestHandler: ClientRequestHandler;
  keyringHandler: KeyringHandler;
  rpcHandler: RpcHandler;
  userInputHandler: UserInputHandler;
};

const snapContext: SnapExecutionContext = {
  /**
   * Clients
   */
  snapClient,
  /**
   * Services
   */
  state,
  priceApiClient,
  transactionService,
  assetsService,
  accountsService,
  transactionsService,
  sendService,
  walletService,
  tronHttpClient,
  tronWebFactory,
  confirmationHandler,
  transactionScanService,
  /**
   * Handlers
   */
  assetsHandler,
  clientRequestHandler,
  cronHandler,
  keyringHandler,
  rpcHandler,
  userInputHandler,
};

export {
  /**
   * Handlers
   */
  assetsHandler,
  clientRequestHandler,
  cronHandler,
  keyringHandler,
  rpcHandler,
  userInputHandler,
};

export default snapContext;
