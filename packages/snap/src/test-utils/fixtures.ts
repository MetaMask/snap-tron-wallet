/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { FeeType, TrxAccountType } from '@metamask/keyring-api';
import { HDNodeWallet } from 'ethers';
import { TronWeb } from 'tronweb';

import { KnownCaip19Id, Network, Networks } from '../constants';
import type { AssetEntity } from '../entities/assets';
import type { TronKeyringAccount } from '../entities/keyring-account';
import { TronMultichainMethod } from '../handlers/keyring-types';
import type { ComputeFeeResult } from '../services/send/types';
import {
  SimulationStatus,
  type TransactionScanResult,
} from '../services/transaction-scan/types';
import nativeTransferFixture from '../services/transactions/mocks/native-transfer.json';
import trc20TransferFixture from '../services/transactions/mocks/trc20-transfer.json';
import { TRX_IMAGE_SVG } from '../static/tron-logo';
import type { Preferences } from '../types/snap';
import { getIconUrlForKnownAsset } from '../ui/confirmation/utils/getIconUrlForKnownAsset';

export const SECRET_RECOVERY_PHRASE =
  'test test test test test test test test test test test junk';
export const DERIVATION_PATH = "m/44'/195'/0'/0/0";
export const TEST_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
export const TEST_ORIGIN = 'http://localhost:3000';

export const mockPreferences: Preferences = {
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
};

export const mockSpotPrices = {
  [KnownCaip19Id.TrxMainnet]: {
    id: 'tron',
    price: 0.123456,
    marketCap: 123456789,
    allTimeHigh: 0.5,
    allTimeLow: 0.01,
    totalVolume: 1000000,
    circulatingSupply: 90000000000,
    pricePercentChange1h: 0.5,
    pricePercentChange1d: 1,
    pricePercentChange7d: -2,
  },
};

/**
 * Derives a Tron address from a secret recovery phrase using the standard derivation path.
 *
 * @param secretRecoveryPhrase - The BIP-39 mnemonic phrase.
 * @returns The Tron base58 address.
 */
export function deriveAccountAddress(secretRecoveryPhrase: string): string {
  const wallet = HDNodeWallet.fromPhrase(
    secretRecoveryPhrase,
    undefined,
    DERIVATION_PATH,
  );
  return TronWeb.address.fromHex(wallet.address);
}

/**
 * Creates a TronKeyringAccount fixture for testing.
 *
 * @param address - The Tron address for the account.
 * @returns A TronKeyringAccount object.
 */
export function createTestAccount(address: string): TronKeyringAccount {
  return {
    id: TEST_ACCOUNT_ID,
    address,
    type: TrxAccountType.Eoa,
    options: {
      entropy: {
        type: 'mnemonic',
        id: 'default',
        derivationPath: DERIVATION_PATH,
        groupIndex: 0,
      },
      exportable: true,
    },
    methods: [
      TronMultichainMethod.SignMessage,
      TronMultichainMethod.SignTransaction,
    ],
    scopes: [Network.Mainnet],
    entropySource: 'default' as const,
    derivationPath: DERIVATION_PATH,
    index: 0,
  };
}

/**
 * Creates bandwidth and energy asset entities for an account.
 *
 * @param accountId - The keyring account ID.
 * @returns Array of bandwidth and energy AssetEntity objects.
 */
export function createAccountAssets(accountId: string): AssetEntity[] {
  return [
    {
      assetType: Networks[Network.Mainnet].bandwidth.id,
      keyringAccountId: accountId,
      network: Network.Mainnet,
      symbol: Networks[Network.Mainnet].bandwidth.symbol,
      decimals: Networks[Network.Mainnet].bandwidth.decimals,
      rawAmount: '1000',
      uiAmount: '1000',
      iconUrl: Networks[Network.Mainnet].bandwidth.iconUrl,
    },
    {
      assetType: Networks[Network.Mainnet].energy.id,
      keyringAccountId: accountId,
      network: Network.Mainnet,
      symbol: Networks[Network.Mainnet].energy.symbol,
      decimals: Networks[Network.Mainnet].energy.decimals,
      rawAmount: '0',
      uiAmount: '0',
      iconUrl: Networks[Network.Mainnet].energy.iconUrl,
    },
  ];
}

/**
 * Creates account assets that include TRX balance and staked assets for staking tests.
 *
 * @param accountId - The keyring account ID.
 * @returns Array of AssetEntity objects including TRX, bandwidth, energy, and staked assets.
 */
export function createAccountAssetsWithStaking(
  accountId: string,
): AssetEntity[] {
  return [
    ...createAccountAssets(accountId),
    {
      assetType: Networks[Network.Mainnet].nativeToken.id,
      keyringAccountId: accountId,
      network: Network.Mainnet,
      symbol: Networks[Network.Mainnet].nativeToken.symbol,
      decimals: Networks[Network.Mainnet].nativeToken.decimals,
      rawAmount: '100000000',
      uiAmount: '100',
      iconUrl: Networks[Network.Mainnet].nativeToken.iconUrl,
    },
    {
      assetType: Networks[Network.Mainnet].stakedForBandwidth.id,
      keyringAccountId: accountId,
      network: Network.Mainnet,
      symbol: Networks[Network.Mainnet].stakedForBandwidth.symbol,
      decimals: Networks[Network.Mainnet].stakedForBandwidth.decimals,
      rawAmount: '50000000',
      uiAmount: '50',
      iconUrl: Networks[Network.Mainnet].stakedForBandwidth.iconUrl,
    },
  ];
}

export const expectedFees: ComputeFeeResult = [
  {
    type: FeeType.Base,
    asset: {
      unit: Networks[Network.Mainnet].nativeToken.symbol,
      type: Networks[Network.Mainnet].nativeToken.id,
      amount: '0',
      fungible: true as const,
      iconUrl: getIconUrlForKnownAsset(
        Networks[Network.Mainnet].nativeToken.id,
      ),
    },
  },
  {
    type: FeeType.Base,
    asset: {
      unit: Networks[Network.Mainnet].bandwidth.symbol,
      type: Networks[Network.Mainnet].bandwidth.id,
      amount: '266',
      fungible: true as const,
      iconUrl: getIconUrlForKnownAsset(Networks[Network.Mainnet].bandwidth.id),
    },
  },
];

export const recipientHexAddress =
  nativeTransferFixture.raw_data.contract[0]?.parameter.value.to_address.toUpperCase() ??
  '';

/**
 * Creates a signable native TRX transfer transaction from a fixture.
 *
 * @param accountAddress - The sender's Tron address.
 * @returns Object with rawDataHex and type for use in keyring requests.
 */
export function createSignableTransaction(accountAddress: string): {
  rawDataHex: string;
  type: string;
} {
  const tronWeb = new TronWeb({ fullHost: 'http://127.0.0.1:8899' });
  const rawData = tronWeb.utils.deserializeTx.deserializeTransaction(
    'TransferContract',
    nativeTransferFixture.raw_data_hex,
  );

  rawData.contract[0]!.parameter.value.owner_address = TronWeb.address
    .toHex(accountAddress)
    .toUpperCase();

  const transactionPb = tronWeb.utils.transaction.txJsonToPb({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    raw_data: rawData,
    visible: false,
  });

  return {
    rawDataHex: tronWeb.utils.transaction
      .txPbToRawDataHex(transactionPb)
      .toLowerCase(),
    type: 'TransferContract',
  };
}

/**
 * Creates a signable TRC20 (smart contract) transfer transaction from a fixture.
 *
 * @param accountAddress - The sender's Tron address.
 * @returns Object with rawDataHex and type for use in keyring requests.
 */
export function createTrc20SignableTransaction(accountAddress: string): {
  rawDataHex: string;
  type: string;
} {
  const tronWeb = new TronWeb({ fullHost: 'http://127.0.0.1:8899' });
  const rawData = tronWeb.utils.deserializeTx.deserializeTransaction(
    'TriggerSmartContract',
    trc20TransferFixture.raw_data_hex,
  );

  rawData.contract[0]!.parameter.value.owner_address = TronWeb.address
    .toHex(accountAddress)
    .toUpperCase();

  const transactionPb = tronWeb.utils.transaction.txJsonToPb({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    raw_data: rawData,
    visible: false,
  });

  return {
    rawDataHex: tronWeb.utils.transaction
      .txPbToRawDataHex(transactionPb)
      .toLowerCase(),
    type: 'TriggerSmartContract',
  };
}

// --- Security Alerts API response factories ---

export const defaultScanApiResponse = {
  validation: {
    status: 'Success',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    result_type: 'Benign',
    reason: 'other',
  },
  simulation: {
    status: 'Success',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    account_summary: {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      assets_diffs: [
        {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          asset_type: 'native',
          asset: {
            type: 'native',
            symbol: 'TRX',
            name: 'Tron',
            // eslint-disable-next-line @typescript-eslint/naming-convention
            logo_url: null,
          },
          in: [],
          out: [
            {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              usd_price: '0.00123456',
              summary: 'Sent 0.01 TRX',
              value: '0.01',
              // eslint-disable-next-line @typescript-eslint/naming-convention
              raw_value: '10000',
            },
          ],
        },
      ],
    },
  },
};

export const defaultScanResult: TransactionScanResult = {
  status: 'SUCCESS',
  simulationStatus: SimulationStatus.Completed,
  estimatedChanges: {
    assets: [
      {
        type: 'out',
        value: '0.01',
        price: '0.00123456',
        symbol: 'TRX',
        name: 'Tron',
        logo: null,
        assetType: 'native',
      },
    ],
  },
  validation: { type: 'Benign', reason: 'other' },
  error: null,
};

/**
 * Creates a malicious scan API response (what the mock server returns).
 *
 * @returns The raw API response shape for a malicious detection.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createMaliciousScanApiResponse() {
  return {
    validation: {
      status: 'Success',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      result_type: 'Malicious',
      reason: 'known_attacker',
      description: "A known attacker's account is involved",
    },
    simulation: {
      status: 'Success',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      account_summary: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        assets_diffs: [
          {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            asset_type: 'native',
            asset: {
              type: 'native',
              symbol: 'TRX',
              name: 'Tron',
              // eslint-disable-next-line @typescript-eslint/naming-convention
              logo_url: null,
            },
            in: [],
            out: [
              {
                // eslint-disable-next-line @typescript-eslint/naming-convention
                usd_price: '0.00123456',
                summary: 'Sent 0.01 TRX',
                value: '0.01',
                // eslint-disable-next-line @typescript-eslint/naming-convention
                raw_value: '10000',
              },
            ],
          },
        ],
      },
    },
  };
}

/**
 * Creates a warning scan API response.
 *
 * @returns The raw API response shape for a warning detection.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createWarningScanApiResponse() {
  return {
    validation: {
      status: 'Success',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      result_type: 'Warning',
      reason: 'unfair_trade',
      description: 'Unfair trade of assets, without adequate compensation',
    },
    simulation: {
      status: 'Success',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      account_summary: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        assets_diffs: [
          {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            asset_type: 'native',
            asset: {
              type: 'native',
              symbol: 'TRX',
              name: 'Tron',
              // eslint-disable-next-line @typescript-eslint/naming-convention
              logo_url: null,
            },
            in: [],
            out: [
              {
                // eslint-disable-next-line @typescript-eslint/naming-convention
                usd_price: '0.00123456',
                summary: 'Sent 0.01 TRX',
                value: '0.01',
                // eslint-disable-next-line @typescript-eslint/naming-convention
                raw_value: '10000',
              },
            ],
          },
        ],
      },
    },
  };
}

/**
 * Creates a scan API response where simulation failed.
 *
 * @returns The raw API response shape for a failed simulation.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createSimulationFailedScanApiResponse() {
  return {
    validation: {
      status: 'Success',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      result_type: 'Benign',
      reason: 'other',
    },
    simulation: {
      status: 'Error',
      error: 'Transaction execution failed',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      error_details: {
        code: 'EXECUTION_REVERTED',
        category: 'simulation',
      },
    },
  };
}

/**
 * Creates a default account info API response.
 *
 * @param address - The account address.
 * @returns The TronGrid account info response shape.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function defaultAccountInfoResponse(address: string) {
  return {
    data: [{ address, balance: 1 }],
    success: true,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    meta: { at: 1, page_size: 1 },
  };
}

/**
 * Returns the standard installSnap options used across E2E tests.
 *
 * @param account - The test account.
 * @returns Options object for installSnap().
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createInstallSnapOptions(account: TronKeyringAccount) {
  return {
    ...mockPreferences,
    secretRecoveryPhrase: SECRET_RECOVERY_PHRASE,
    unencryptedState: {
      keyringAccounts: { [account.id]: account },
      assets: { [account.id]: createAccountAssets(account.id) },
      tokenPrices: {},
      transactions: {},
      mapInterfaceNameToId: {},
    },
  };
}

/**
 * Returns installSnap options with staking assets pre-populated.
 *
 * @param account - The test account.
 * @returns Options object for installSnap() with staking assets.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createInstallSnapOptionsWithStaking(
  account: TronKeyringAccount,
) {
  return {
    ...mockPreferences,
    secretRecoveryPhrase: SECRET_RECOVERY_PHRASE,
    unencryptedState: {
      keyringAccounts: { [account.id]: account },
      assets: { [account.id]: createAccountAssetsWithStaking(account.id) },
      tokenPrices: {},
      transactions: {},
      mapInterfaceNameToId: {},
    },
  };
}

// Re-export TRX_IMAGE_SVG for use in E2E tests
export { TRX_IMAGE_SVG };
