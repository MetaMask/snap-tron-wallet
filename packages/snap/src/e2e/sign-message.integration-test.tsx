import { KeyringRpcMethod } from '@metamask/keyring-api';
import { installSnap } from '@metamask/snaps-jest';

import { Network } from '../constants';
import { TronMultichainMethod } from '../handlers/keyring-types';
import {
  createInstallSnapOptions,
  createTestAccount,
  defaultAccountInfoResponse,
  defaultScanApiResponse,
  deriveAccountAddress,
  mockSpotPrices,
  SECRET_RECOVERY_PHRASE,
  TEST_ORIGIN,
} from '../test-utils/fixtures';
import {
  startMockApiServer,
  type MockApiServer,
} from '../test-utils/mockApiServer';
import { ConfirmSignMessageFormNames } from '../ui/confirmation/views/ConfirmSignMessage/events';

// Base64-encode a test message
const TEST_MESSAGE = 'Hello, Tron!';
const TEST_MESSAGE_BASE64 = btoa(TEST_MESSAGE);

describe('Sign Message E2E', () => {
  let mockServer: MockApiServer;
  const accountAddress = deriveAccountAddress(SECRET_RECOVERY_PHRASE);
  const account = createTestAccount(accountAddress);

  beforeEach(async () => {
    mockServer = await startMockApiServer({
      spotPricesResponse: mockSpotPrices,
      scanResponse: defaultScanApiResponse,
      accountInfoResponse: defaultAccountInfoResponse,
    });
  });

  afterEach(async () => {
    await mockServer.close();
  });

  it('confirms message signing and returns signature', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { onKeyringRequest } = await installSnap({
      options: createInstallSnapOptions(account),
    });

    const response = onKeyringRequest({
      origin: TEST_ORIGIN,
      method: KeyringRpcMethod.SubmitRequest,
      params: {
        id: '33333333-3333-4333-8333-333333333333',
        origin: TEST_ORIGIN,
        account: account.id,
        scope: Network.Mainnet,
        request: {
          method: TronMultichainMethod.SignMessage,
          params: {
            address: account.address,
            message: TEST_MESSAGE_BASE64,
          },
        },
      },
    });

    const screen = await response.getInterface();

    await screen.clickElement(ConfirmSignMessageFormNames.Confirm);

    expect(await response).toMatchObject({
      response: {
        result: {
          pending: false,
          result: {
            signature: expect.stringMatching(/^0x[0-9a-fA-F]+$/u),
          },
        },
      },
    });
  });

  it('rejects when user clicks cancel', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { onKeyringRequest } = await installSnap({
      options: createInstallSnapOptions(account),
    });

    const response = onKeyringRequest({
      origin: TEST_ORIGIN,
      method: KeyringRpcMethod.SubmitRequest,
      params: {
        id: '33333333-3333-4333-8333-333333333333',
        origin: TEST_ORIGIN,
        account: account.id,
        scope: Network.Mainnet,
        request: {
          method: TronMultichainMethod.SignMessage,
          params: {
            address: account.address,
            message: TEST_MESSAGE_BASE64,
          },
        },
      },
    });

    const screen = await response.getInterface();

    await screen.clickElement(ConfirmSignMessageFormNames.Cancel);

    expect(await response).toRespondWithError(
      expect.objectContaining({
        code: expect.any(Number),
      }),
    );
  });
});
