import type { SnapClient } from '../../clients/snap/SnapClient';
import type { Network } from '../../constants';
import { render as renderConfirmTransactionRequest } from '../../ui/confirmation/views/ConfirmTransactionRequest/render';
import type { ComputeFeeResult } from '../send/types';
import type { AssetEntity } from '../../entities/assets';

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
    asset,
  }: {
    scope: Network;
    fromAddress: string;
    amount: string;
    fees: ComputeFeeResult;
    asset: AssetEntity;
  }): Promise<boolean> {
    console.log('WE WANT TO SEND ASSET', JSON.stringify(asset))
    const result = await renderConfirmTransactionRequest(this.#snapClient, {
      scope,
      fromAddress,
      amount,
      fees,
      asset,
      origin: 'MetaMask',
    });

    return result === true;
  }
}
