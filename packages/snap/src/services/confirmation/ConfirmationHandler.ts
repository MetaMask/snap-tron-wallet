import type { SnapClient } from '../../clients/snap/SnapClient';
import type { Network } from '../../constants';
import { render as renderConfirmTransactionRequest } from '../../ui/confirmation/views/ConfirmTransactionRequest/render';
import type { ComputeFeeResult } from '../send/types';

export class ConfirmationHandler {
  readonly #snapClient: SnapClient;

  constructor({ snapClient }: { snapClient: SnapClient }) {
    this.#snapClient = snapClient;
  }

  async confirmTransactionRequest({
    scope,
    fromAddress,
    amount,
    fees,
    assetSymbol,
  }: {
    scope: Network;
    fromAddress: string;
    amount: string;
    fees: ComputeFeeResult;
    assetSymbol: string;
  }): Promise<boolean> {
    const result = await renderConfirmTransactionRequest(this.#snapClient, {
      scope,
      fromAddress,
      amount,
      fees,
      assetSymbol,
      origin: 'MetaMask',
    });

    return result === true;
  }
}
