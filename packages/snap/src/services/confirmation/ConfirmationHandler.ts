import type { Network } from '../../constants';
import { render as renderConfirmTransactionRequest } from '../../ui/confirmation/views/ConfirmTransactionRequest/render';

export class ConfirmationHandler {
  async confirmTransactionRequest({
    scope,
    fromAddress,
    amount,
    fee,
  }: {
    scope: Network;
    fromAddress: string;
    amount: string;
    fee: string;
  }): Promise<boolean> {
    const result = await renderConfirmTransactionRequest({
      scope,
      fromAddress,
      amount,
      fee,
      origin: 'MetaMask',
    });

    return result === true;
  }
}


