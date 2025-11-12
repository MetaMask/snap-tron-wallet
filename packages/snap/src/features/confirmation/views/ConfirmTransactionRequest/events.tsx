import { resolveInterface, updateInterface } from '../../../../utils/interface';
import { ConfirmTransactionRequest } from './ConfirmTransactionRequest';
import { type ConfirmTransactionRequestContext } from './types';

async function onShowAdvancedButtonClick({
  id,
  context,
}: {
  id: string;
  context: ConfirmTransactionRequestContext;
}) {
  const updatedContext: ConfirmTransactionRequestContext = {
    ...context,
    advanced: {
      ...context.advanced,
      shown: !context.advanced.shown,
    },
  };

  await updateInterface(
    id,
    <ConfirmTransactionRequest context={updatedContext} />,
    updatedContext,
  );
}

async function onCancelButtonClick({ id }: { id: string }) {
  await resolveInterface(id, false);
}

async function onConfirmButtonClick({ id }: { id: string }) {
  await resolveInterface(id, true);
}

export enum ConfirmSignAndSendTransactionFormNames {
  ShowAdvanced = 'confirm-sign-and-send-transaction-show-advanced',
  Cancel = 'confirm-sign-and-send-transaction-cancel',
  Confirm = 'confirm-sign-and-send-transaction-confirm',
}

export const eventHandlers = {
  [ConfirmSignAndSendTransactionFormNames.ShowAdvanced]:
    onShowAdvancedButtonClick,
  [ConfirmSignAndSendTransactionFormNames.Cancel]: onCancelButtonClick,
  [ConfirmSignAndSendTransactionFormNames.Confirm]: onConfirmButtonClick,
};


