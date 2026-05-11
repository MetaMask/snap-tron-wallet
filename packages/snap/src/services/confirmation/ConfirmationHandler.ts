import { InternalError } from '@metamask/snaps-sdk';
import { assert } from '@metamask/superstruct';
import type { Types } from 'tronweb';

import type { SnapClient } from '../../clients/snap/SnapClient';
import type { TronWebFactory } from '../../clients/tronweb/TronWebFactory';
import type { Network } from '../../constants';
import type { AssetEntity } from '../../entities/assets';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import { TronMultichainMethod } from '../../handlers/keyring-types';
import { TRX_IMAGE_SVG } from '../../static/tron-logo';
import { FetchStatus } from '../../types/snap';
import { getIconUrlForKnownAsset } from '../../ui/confirmation/utils/getIconUrlForKnownAsset';
import { render as renderConfirmSignMessage } from '../../ui/confirmation/views/ConfirmSignMessage/render';
import { ConfirmSignTransaction } from '../../ui/confirmation/views/ConfirmSignTransaction/ConfirmSignTransaction';
import { render as renderConfirmSignTransaction } from '../../ui/confirmation/views/ConfirmSignTransaction/render';
import {
  CONFIRM_SIGN_TRANSACTION_INTERFACE_NAME,
  type ConfirmSignTransactionContext,
} from '../../ui/confirmation/views/ConfirmSignTransaction/types';
import { render as renderConfirmTransactionRequest } from '../../ui/confirmation/views/ConfirmTransactionRequest/render';
import { CONFIRM_TRANSACTION_INTERFACE_NAME } from '../../ui/confirmation/views/ConfirmTransactionRequest/types';
import { formatOrigin } from '../../utils/formatOrigin';
import type { ILogger } from '../../utils/logger';
import logger, { createPrefixedLogger } from '../../utils/logger';
import {
  SignTransactionRequestStruct,
  type TronWalletKeyringRequest,
} from '../../validation/structs';
import {
  assertTransactionOwnerAddress,
  assertTransactionStructure,
} from '../../validation/transaction';
import type { State, UnencryptedStateValue } from '../state/State';
import type { ComputeFeeResult } from '../transaction/types';

export class ConfirmationHandler {
  readonly #logger: ILogger;

  readonly #snapClient: SnapClient;

  readonly #state: State<UnencryptedStateValue>;

  readonly #tronWebFactory: TronWebFactory;

  constructor({
    snapClient,
    state,
    tronWebFactory,
  }: {
    snapClient: SnapClient;
    state: State<UnencryptedStateValue>;
    tronWebFactory: TronWebFactory;
  }) {
    this.#logger = createPrefixedLogger(logger, '[🔑 ConfirmationHandler]');
    this.#snapClient = snapClient;
    this.#state = state;
    this.#tronWebFactory = tronWebFactory;
  }

  async #clearInterfaceId(interfaceName: string): Promise<void> {
    try {
      await this.#state.setKey(`mapInterfaceNameToId.${interfaceName}`, null);
    } catch (error) {
      this.#logger.error({ error }, 'Failed to clear interface ID');
    }
  }

  async handleKeyringRequest({
    request,
    account,
  }: {
    request: TronWalletKeyringRequest;
    account: TronKeyringAccount;
  }): Promise<boolean> {
    this.#logger.info('Handling keyring request', {
      request,
      account,
    });

    const { method } = request.request;

    // Handle different request types
    switch (method as TronMultichainMethod) {
      case TronMultichainMethod.SignMessage: {
        return this.#handleSignMessageRequest(request, account);
      }
      case TronMultichainMethod.SignTransaction: {
        return this.#handleSignTransactionRequest(request, account);
      }
      default:
        this.#logger.warn('Unhandled keyring request method', { method });
        throw new Error(`Unhandled keyring request method: ${method}`);
    }
  }

  async #handleSignMessageRequest(
    request: TronWalletKeyringRequest,
    account: TronKeyringAccount,
  ): Promise<boolean> {
    const result = await renderConfirmSignMessage(request, account);
    return result === true;
  }

  async #handleSignTransactionRequest(
    request: TronWalletKeyringRequest,
    account: TronKeyringAccount,
  ): Promise<boolean> {
    assert(request.request.params, SignTransactionRequestStruct);

    const {
      scope,
      request: {
        params: {
          transaction: { rawDataHex, type },
        },
      },
    } = request;

    // Create a TronWeb instance for transaction deserialization
    const tronWeb = this.#tronWebFactory.createClient(scope);

    // Rebuild the transaction from hex (same logic as clientRequest handler)
    const rawData = tronWeb.utils.deserializeTx.deserializeTransaction(
      type,
      rawDataHex,
    );
    assertTransactionStructure(rawData);
    assertTransactionOwnerAddress(rawData, account.address);

    const result = await renderConfirmSignTransaction(
      request,
      account,
      rawData,
    );

    await this.#clearInterfaceId(CONFIRM_SIGN_TRANSACTION_INTERFACE_NAME);

    return result === true;
  }

  async confirmTransactionRequest({
    scope,
    fromAddress,
    toAddress,
    amount,
    fees,
    asset,
    accountType,
    origin,
    transactionRawData,
  }: {
    scope: Network;
    fromAddress: string;
    toAddress: string;
    amount: string;
    fees: ComputeFeeResult;
    asset: AssetEntity;
    accountType: string;
    origin: string;
    transactionRawData: Types.Transaction['raw_data'];
  }): Promise<boolean> {
    // Track Transaction Added event
    await this.#snapClient.trackTransactionAdded({
      origin,
      accountType,
      chainIdCaip: scope,
    });

    const result = await renderConfirmTransactionRequest(
      this.#snapClient,
      this.#state,
      {
        scope,
        fromAddress,
        toAddress,
        amount,
        fees,
        asset,
        origin: formatOrigin(origin),
        accountType,
        transactionRawData,
      },
    );

    await this.#clearInterfaceId(CONFIRM_TRANSACTION_INTERFACE_NAME);

    // Track Transaction Rejected event if user rejects
    if (result === true) {
      await this.#snapClient.trackTransactionApproved({
        origin,
        accountType,
        chainIdCaip: scope,
      });
    } else {
      await this.#snapClient.trackTransactionRejected({
        origin,
        accountType,
        chainIdCaip: scope,
      });
    }

    return result === true;
  }

  /**
   * Shows a confirmation dialog for claiming unstaked TRX,
   * reusing the ConfirmSignTransaction UI component.
   *
   * Presents the user with an approval dialog before any signing occurs.
   *
   * @param params - The parameters for the confirmation.
   * @param params.account - The account claiming the unstaked TRX.
   * @param params.scope - The network scope.
   * @param params.fees - Precomputed fees for the claim transaction.
   * @returns True if the user confirmed, false otherwise.
   */
  async confirmClaimUnstakedTrx({
    account,
    scope,
    fees,
  }: {
    account: TronKeyringAccount;
    scope: Network;
    fees: ComputeFeeResult;
  }): Promise<boolean> {
    fees.forEach((fee) => {
      fee.asset.iconUrl = getIconUrlForKnownAsset(fee.asset.type);
    });

    let preferences;
    try {
      preferences = await this.#snapClient.getPreferences();
    } catch {
      throw new InternalError('Failed to retrieve Snap preferences.') as Error;
    }

    const context: ConfirmSignTransactionContext = {
      scope,
      account,
      transaction: { rawDataHex: '', type: '' },
      origin: 'MetaMask',
      preferences,
      networkImage: TRX_IMAGE_SVG,
      scan: null,
      scanFetchStatus: FetchStatus.Fetched,
      tokenPrices: {},
      tokenPricesFetchStatus: FetchStatus.Fetched,
      fees,
      feesFetchStatus: FetchStatus.Fetched,
    };

    const ui = ConfirmSignTransaction({ context });
    const id = await this.#snapClient.createInterface(ui, context);

    const result = await this.#snapClient.showDialog(id);
    return result === true;
  }
}
