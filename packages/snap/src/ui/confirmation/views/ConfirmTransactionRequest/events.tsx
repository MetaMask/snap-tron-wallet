import { resolveInterface } from '../../../../utils/interface';

/**
 * Handle cancel button click by resolving the interface with a falsy value.
 *
 * @param options - The options bag.
 * @param options.id - The interface id.
 */
async function onCancelButtonClick(options: { id: string }): Promise<void> {
  const { id } = options;
  await resolveInterface(id, false);
}

/**
 * Handle confirm button click by resolving the interface with a truthy value.
 *
 * @param options - The options bag.
 * @param options.id - The interface id.
 */
async function onConfirmButtonClick(options: { id: string }): Promise<void> {
  const { id } = options;
  await resolveInterface(id, true);
}

export enum ConfirmSignAndSendTransactionFormNames {
  Cancel = 'confirm-sign-and-send-transaction-cancel',
  Confirm = 'confirm-sign-and-send-transaction-confirm',
}

export const eventHandlers = {
  [ConfirmSignAndSendTransactionFormNames.Cancel]: onCancelButtonClick,
  [ConfirmSignAndSendTransactionFormNames.Confirm]: onConfirmButtonClick,
};
