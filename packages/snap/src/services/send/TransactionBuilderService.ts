import { bytesToHex, hexToBytes, sha256 } from '@metamask/utils';
import type { Transaction } from 'tronweb/lib/esm/types';

import type { TronWebFactory } from '../../clients/tronweb/TronWebFactory';
import type { Network } from '../../constants';
import type { ILogger } from '../../utils/logger';
import { createPrefixedLogger } from '../../utils/logger';

/**
 * TRON hex addresses always start with '41' (21 bytes = 42 hex chars).
 * This prefix distinguishes mainnet addresses from testnet.
 */
const HEX_ADDRESS_PREFIX = '41';
const HEX_ADDRESS_LENGTH = 42;

/**
 * Service responsible for deserializing incoming transactions.
 *
 * This service centralizes all transaction deserialization logic to ensure
 * consistent handling of the `visible` field across all handlers.
 *
 * Key invariants:
 * - Deserialized transactions always have hex addresses (41...)
 * - The `visible` field is always set to `false` for deserialized transactions
 * - The `raw_data` and `raw_data_hex` are always consistent
 */
export class TransactionBuilderService {
  readonly #logger: ILogger;

  readonly #tronWebFactory: TronWebFactory;

  constructor({
    logger,
    tronWebFactory,
  }: {
    logger: ILogger;
    tronWebFactory: TronWebFactory;
  }) {
    this.#logger = createPrefixedLogger(
      logger,
      '[🔨 TransactionBuilderService]',
    );
    this.#tronWebFactory = tronWebFactory;
  }

  /**
   * Deserialize a transaction from base64-encoded raw_data_hex.
   *
   * @param base64 - The base64-encoded raw_data_hex
   * @param type - The contract type (e.g., 'TriggerSmartContract', 'TransferContract')
   * @param scope - The network scope
   * @returns The deserialized Transaction object
   */
  async fromBase64(
    base64: string,
    type: string,
    scope: Network,
  ): Promise<Transaction> {
    // eslint-disable-next-line no-restricted-globals
    const rawDataHex = Buffer.from(base64, 'base64').toString('hex');
    return this.fromHex(rawDataHex, type, scope);
  }

  /**
   * Deserialize a transaction from hex-encoded raw_data_hex.
   *
   * @param rawDataHex - The hex-encoded raw_data_hex
   * @param type - The contract type (e.g., 'TriggerSmartContract', 'TransferContract')
   * @param scope - The network scope
   * @returns The deserialized Transaction object
   */
  async fromHex(
    rawDataHex: string,
    type: string,
    scope: Network,
  ): Promise<Transaction> {
    this.#logger.log(`Deserializing transaction of type: ${type}`);

    const tronWeb = this.#tronWebFactory.createClient(scope);

    // Deserialize the raw_data from protobuf
    const rawData = tronWeb.utils.deserializeTx.deserializeTransaction(
      type,
      rawDataHex,
    );

    // Calculate transaction ID (hash of raw_data_hex)
    const txID = bytesToHex(await sha256(hexToBytes(rawDataHex))).slice(2);

    // Validate that addresses are in hex format (not base58)
    // This ensures consistency between raw_data and raw_data_hex
    this.#validateAddressFormats(rawData);

    // Build the full transaction object
    // IMPORTANT: visible is always false because deserialized transactions
    // have hex addresses (41...), not base58 addresses (T...)
    const transaction: Transaction = {
      visible: false,
      txID,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      raw_data: rawData,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      raw_data_hex: rawDataHex,
    };

    this.#logger.log({ txID }, 'Transaction deserialized successfully');

    return transaction;
  }

  /**
   * Check if an address is in valid hex format.
   * TRON hex addresses are 42 characters long and start with '41'.
   *
   * @param address - The address to validate
   * @returns true if the address is in valid hex format
   */
  #isValidHexAddress(address: string): boolean {
    if (!address || typeof address !== 'string') {
      return false;
    }
    return (
      address.length === HEX_ADDRESS_LENGTH &&
      address.startsWith(HEX_ADDRESS_PREFIX) &&
      /^[0-9a-fA-F]+$/u.test(address)
    );
  }

  /**
   * Check if an address appears to be in base58 format.
   * Base58 addresses start with 'T' and are 34 characters long.
   *
   * @param address - The address to check
   * @returns true if the address appears to be base58 format
   */
  #isBase58Address(address: string): boolean {
    if (!address || typeof address !== 'string') {
      return false;
    }
    return address.startsWith('T') && address.length === 34;
  }

  /**
   * Validate that all addresses in the transaction raw_data are in hex format.
   * Logs warnings if any addresses are in unexpected formats.
   *
   * @param rawData - The deserialized transaction raw_data
   */
  #validateAddressFormats(rawData: any): void {
    const contract = rawData.contract?.[0];
    if (!contract?.parameter?.value) {
      return;
    }

    const { value } = contract.parameter;
    const addressFields = [
      'owner_address',
      'to_address',
      'contract_address',
      'receiver_address',
      'resource_address',
    ];

    for (const field of addressFields) {
      const address = value[field];
      if (address) {
        if (this.#isBase58Address(address)) {
          this.#logger.warn(
            { field, address: `${address.slice(0, 10)}...` },
            `Address in ${field} is in base58 format, expected hex. This may cause signing issues.`,
          );
        } else if (!this.#isValidHexAddress(address)) {
          this.#logger.warn(
            { field, address: `${address.slice(0, 10)}...` },
            `Address in ${field} is not in expected hex format.`,
          );
        }
      }
    }
  }
}
