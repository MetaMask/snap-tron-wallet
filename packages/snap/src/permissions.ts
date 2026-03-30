import { KeyringRpcMethod } from '@metamask/keyring-api';

import { TestDappRpcRequestMethod, WalletConnectRpcMethod } from './handlers/rpc/types';

// eslint-disable-next-line no-restricted-globals
const isDev = process.env.ENVIRONMENT !== 'production';

const prodOrigins = ['https://portfolio.metamask.io'];
const allowedOrigins = isDev ? ['http://localhost:3000'] : prodOrigins;

const dappPermissions = isDev
  ? new Set([
      // Keyring methods
      KeyringRpcMethod.ListAccounts,
      KeyringRpcMethod.GetAccount,
      KeyringRpcMethod.CreateAccount,
      KeyringRpcMethod.DeleteAccount,
      KeyringRpcMethod.DiscoverAccounts,
      KeyringRpcMethod.GetAccountBalances,
      KeyringRpcMethod.SubmitRequest,
      KeyringRpcMethod.ListAccountTransactions,
      KeyringRpcMethod.ListAccountAssets,
      // Test dapp specific methods
      TestDappRpcRequestMethod.ComputeFee,
    ])
  : new Set([]);

const metamaskPermissions = new Set([
  // Keyring methods
  KeyringRpcMethod.ListAccounts,
  KeyringRpcMethod.GetAccount,
  KeyringRpcMethod.CreateAccount,
  KeyringRpcMethod.DeleteAccount,
  KeyringRpcMethod.DiscoverAccounts,
  KeyringRpcMethod.GetAccountBalances,
  KeyringRpcMethod.SubmitRequest,
  KeyringRpcMethod.ListAccountTransactions,
  KeyringRpcMethod.ListAccountAssets,
  KeyringRpcMethod.ResolveAccountAddress,
  KeyringRpcMethod.SetSelectedAccounts,
]);

const metamask = 'metamask';

export const originPermissions = new Map<string, Set<string>>([]);

for (const origin of allowedOrigins) {
  originPermissions.set(origin, dappPermissions);
}
originPermissions.set(metamask, metamaskPermissions);

/**
 * WalletConnect methods that are callable from any origin.
 *
 * These bypass the origin allowlist because WalletConnect dApp origins are
 * not known ahead of time and cannot be pre-registered. Security is provided
 * by the WalletConnect session authorization — the user has already approved
 * the connection, and MetaMask Mobile validates the session before forwarding
 * the request to the snap.
 *
 * Ref: https://docs.reown.com/advanced/multichain/rpc-reference/tron-rpc
 */
export const walletConnectMethods = new Set(Object.values(WalletConnectRpcMethod));
