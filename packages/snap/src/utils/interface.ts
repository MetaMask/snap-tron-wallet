import type {
  DialogResult,
  GetInterfaceStateResult,
  Json,
  ResolveInterfaceResult,
  UpdateInterfaceResult,
} from '@metamask/snaps-sdk';

import type { Preferences } from '../types/snap';

export const CONFIRM_SIGN_AND_SEND_TRANSACTION_INTERFACE_NAME =
  'confirm-sign-and-send-transaction';

/**
 * Create a UI interface with the provided UI component and context.
 *
 * @param ui - The UI component to render.
 * @param context - The initial context object to associate with the interface.
 * @returns The created interface id.
 */
export async function createInterface<TContext>(
  ui: any,
  context: TContext & Record<string, Json>,
): Promise<string> {
  return snap.request({
    method: 'snap_createInterface',
    params: {
      ui,
      context,
    },
  });
}

/**
 * Update an existing UI interface with a new UI component and context.
 *
 * @param id - The interface id returned from createInterface.
 * @param ui - The new UI component to render.
 * @param context - The updated context object to associate with the interface.
 * @returns The update interface result.
 */
export async function updateInterface<TContext>(
  id: string,
  ui: any,
  context: TContext & Record<string, Json>,
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

/**
 * Get the current state of an interface by id.
 *
 * @param id - The interface id.
 * @returns The interface state result.
 */
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

/**
 * Resolve an interface by id with the given JSON value.
 *
 * @param id - The interface id.
 * @param value - The value to resolve the interface with.
 * @returns The resolve interface result.
 */
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

/**
 * Show a dialog for the given interface id and return the result.
 *
 * @param id - The interface id.
 * @returns The dialog result.
 */
export async function showDialog(id: string): Promise<DialogResult> {
  return snap.request({
    method: 'snap_dialog',
    params: {
      id,
    },
  });
}

/**
 * Retrieve the user's preferences from the snap.
 *
 * @returns The user preferences.
 */
export async function getPreferences(): Promise<Preferences> {
  return snap.request({
    method: 'snap_getPreferences',
  }) as Promise<Preferences>;
}
