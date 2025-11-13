import type {
  ComponentOrElement,
  DialogResult,
  GetInterfaceStateResult,
  Json,
  ResolveInterfaceResult,
  UpdateInterfaceResult,
} from '@metamask/snaps-sdk';

import type { Preferences } from '../types/snap';

export const CONFIRM_SIGN_AND_SEND_TRANSACTION_INTERFACE_NAME =
  'confirm-sign-and-send-transaction';

export async function createInterface<TContext>(
  ui: ComponentOrElement,
  context: TContext,
): Promise<string> {
  return snap.request({
    method: 'snap_createInterface',
    params: {
      ui,
      context,
    },
  });
}

export async function updateInterface<TContext>(
  id: string,
  ui: ComponentOrElement,
  context: TContext,
): Promise<UpdateInterfaceResult> {
  return snap.request({
    method: 'snap_updateInterface',
    params: {
      id,
      ui,
      context,
    },
  });
}

export async function getInterfaceState(
  id: string,
): Promise<GetInterfaceStateResult> {
  return snap.request({
    method: 'snap_getInterfaceState',
    params: {
      id,
    },
  });
}

export async function resolveInterface(
  id: string,
  value: Json,
): Promise<ResolveInterfaceResult> {
  return snap.request({
    method: 'snap_resolveInterface',
    params: {
      id,
      value,
    },
  });
}

export async function showDialog(id: string): Promise<DialogResult> {
  return snap.request({
    method: 'snap_dialog',
    params: {
      id,
    },
  });
}

export async function getPreferences(): Promise<Preferences> {
  return snap.request({
    method: 'snap_getPreferences',
  }) as Promise<Preferences>;
}
