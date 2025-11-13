import type { SnapClient } from '../../clients/snap/SnapClient';
import type { Network } from '../../constants';
import { render as renderConfirmTransactionRequest } from '../../ui/confirmation/views/ConfirmTransactionRequest/render';

export class ConfirmationHandler {
  readonly #snapClient: SnapClient;

  constructor({ snapClient }: { snapClient: SnapClient }) {
    this.#snapClient = snapClient;
  }

  async confirmTransactionRequest({
    scope,
    fromAddress,
    amount,
    fee,
    assetSymbol,
  }: {
    scope: Network;
    fromAddress: string;
    amount: string;
    fee: string;
    assetSymbol: string;
  }): Promise<boolean> {
    const result = await renderConfirmTransactionRequest(this.#snapClient, {
      scope,
      fromAddress,
      amount,
      fee,
      assetSymbol,
      origin: 'MetaMask',
    });

    return result === true;
  }
}
