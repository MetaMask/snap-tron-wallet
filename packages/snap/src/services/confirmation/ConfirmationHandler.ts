import type { TronKeyringAccount } from '../../entities/keyring-account';
import type { Network } from '../../constants';
import type { ClientRequestMethod } from '../../handlers/clientRequest/types';
import { render as renderConfirmTransactionRequest } from '../../features/confirmation/views/ConfirmTransactionRequest/render';

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
    });

    return result === true;
  }
}


