export enum RpcRequestMethods {
  OnStart = 'onStart',
  OnInstall = 'onInstall',
  OnUpdate = 'onUpdate',
}

/**
 * Methods specific to the test dapp,
 * to allow specific flows for manual testing.
 */
export enum TestDappRpcRequestMethod {
  ComputeFee = 'computeFee',
}

/**
 * WalletConnect Tron namespace RPC methods.
 *
 * Spec: https://docs.reown.com/advanced/multichain/rpc-reference/tron-rpc
 *
 * Only signing methods are implemented. tron_sendTransaction and tron_getBalance
 * are optional per the WalletConnect spec — dApps call Tron nodes directly for
 * broadcast and balance queries.
 */
export enum WalletConnectRpcMethod {
  SignMessage = 'tron_signMessage',
  SignTransaction = 'tron_signTransaction',
}
