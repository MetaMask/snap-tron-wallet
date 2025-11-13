import { resolveInterface } from '../../../../utils/interface';

async function onCancelButtonClick({ id }: { id: string }) {
  await resolveInterface(id, false);
}

async function onConfirmButtonClick({ id }: { id: string }) {
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


