import { ConfirmSignTransaction } from './ConfirmSignTransaction';
import { ConfirmSignTransactionFormNames } from './events';
import type { ConfirmSignTransactionContext } from './types';
import { Network } from '../../../../constants';
import type { TronKeyringAccount } from '../../../../entities/keyring-account';
import { TronMultichainMethod } from '../../../../handlers/keyring-types';
import {
  SimulationStatus,
  type TransactionScanError,
  type TransactionScanResult,
} from '../../../../services/transaction-scan/types';
import { FetchStatus, type Preferences } from '../../../../types/snap';

/**
 * Recursively searches a rendered JSX tree for an element with a given name.
 *
 * @param node - The current JSX node (element, array, or primitive).
 * @param name - The element `name` prop to look for.
 * @returns The matching element, or undefined.
 */
function findByName(node: any, name: string): any {
  if (!node || typeof node !== 'object') {
    return undefined;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByName(child, name);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  if (node.props?.name === name) {
    return node;
  }
  return findByName(node.props?.children, name);
}

describe('ConfirmSignTransaction', () => {
  const mockAccount: TronKeyringAccount = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
    options: {},
    methods: [
      TronMultichainMethod.SignMessage,
      TronMultichainMethod.SignTransaction,
    ],
    type: 'tron:eoa',
    scopes: [Network.Mainnet],
    entropySource: 'entropy-source-1' as any,
    derivationPath: "m/44'/195'/0'/0/0",
    index: 0,
  };

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

  const buildScanResult = (
    overrides: Partial<TransactionScanResult> = {},
  ): TransactionScanResult => ({
    status: 'SUCCESS',
    simulationStatus: SimulationStatus.Completed,
    estimatedChanges: { assets: [] },
    validation: { type: 'Benign', reason: null },
    error: null,
    ...overrides,
  });

  const buildContext = (
    overrides: Partial<ConfirmSignTransactionContext> = {},
  ): ConfirmSignTransactionContext =>
    ({
      scope: Network.Mainnet,
      account: mockAccount,
      transaction: { rawDataHex: '0a02beef', type: 'TransferContract' },
      origin: 'https://example.com',
      preferences: mockPreferences,
      networkImage: '',
      scan: buildScanResult(),
      scanFetchStatus: FetchStatus.Fetched,
      tokenPrices: {} as any,
      tokenPricesFetchStatus: FetchStatus.Fetched,
      fees: [] as any,
      feesFetchStatus: FetchStatus.Fetched,
      ...overrides,
    }) as ConfirmSignTransactionContext;

  const isConfirmDisabled = (
    context: ConfirmSignTransactionContext,
  ): boolean => {
    const tree = ConfirmSignTransaction({ context });
    const confirmButton = findByName(
      tree,
      ConfirmSignTransactionFormNames.Confirm,
    );
    return Boolean(confirmButton?.props?.disabled);
  };

  const deadlineError: TransactionScanError = {
    type: null,
    code: null,
    message: 'Reverted: TransactionDeadlinePassed',
  };

  const otherError: TransactionScanError = {
    type: 'Revert',
    code: 'INSUFFICIENT_BALANCE',
    message: 'Reverted: insufficient balance',
  };

  it('disables the confirm button during the initial scan load', () => {
    expect(
      isConfirmDisabled(buildContext({ scanFetchStatus: FetchStatus.Loading })),
    ).toBe(true);
  });

  it('enables the confirm button for a successful scan', () => {
    expect(isConfirmDisabled(buildContext())).toBe(false);
  });

  it('keeps the confirm button enabled when the scan fails on a deadline', () => {
    expect(
      isConfirmDisabled(
        buildContext({
          scan: buildScanResult({
            status: 'ERROR',
            simulationStatus: SimulationStatus.Failed,
            error: deadlineError,
          }),
        }),
      ),
    ).toBe(false);
  });

  it('disables the confirm button for other failed simulations', () => {
    expect(
      isConfirmDisabled(
        buildContext({
          scan: buildScanResult({
            status: 'ERROR',
            simulationStatus: SimulationStatus.Failed,
            error: otherError,
          }),
        }),
      ),
    ).toBe(true);
  });
});
