import { ConfirmationHandler } from './ConfirmationHandler';
import type { SnapClient } from '../../clients/snap/SnapClient';
import type { TronWebFactory } from '../../clients/tronweb/TronWebFactory';
import { Network } from '../../constants';
import type { TronKeyringAccount } from '../../entities/keyring-account';
import { TronMultichainMethod } from '../../handlers/keyring-types';
import { render as renderConfirmSignMessage } from '../../ui/confirmation/views/ConfirmSignMessage/render';
import { render as renderConfirmSignTransaction } from '../../ui/confirmation/views/ConfirmSignTransaction/render';
import type { State, UnencryptedStateValue } from '../state/State';

jest.mock('../../ui/confirmation/views/ConfirmSignMessage/render', () => ({
  render: jest.fn(),
}));

jest.mock('../../ui/confirmation/views/ConfirmSignTransaction/render', () => ({
  render: jest.fn(),
}));

jest.mock(
  '../../ui/confirmation/views/ConfirmTransactionRequest/render',
  () => ({
    render: jest.fn(),
  }),
);

const mockRenderConfirmSignMessage = jest.mocked(renderConfirmSignMessage);
const mockRenderConfirmSignTransaction = jest.mocked(
  renderConfirmSignTransaction,
);

const mockAccount: TronKeyringAccount = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  address: 'TGJn1wnUYHJbvN88cynZbsAz2EMeZq73yx',
  type: 'tron:eoa',
  options: {},
  methods: [],
  scopes: ['tron:728126428'],
  entropySource: 'test-entropy',
  derivationPath: "m/44'/195'/0'/0/0",
  index: 0,
};

describe('ConfirmationHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleKeyringRequest', () => {
    it('returns false for unhandled method', async () => {
      const mockState: Pick<
        State<UnencryptedStateValue>,
        'getKey' | 'setKey'
      > = {
        getKey: jest.fn(),
        setKey: jest.fn(),
      };
      const handler = new ConfirmationHandler({
        snapClient: {} as SnapClient,
        state: mockState as State<UnencryptedStateValue>,
        tronWebFactory: {} as TronWebFactory,
      });

      const result = await handler.handleKeyringRequest({
        request: {
          scope: Network.Mainnet,
          request: {
            method: 'unknownMethod',
            params: {},
          },
        } as any,
        account: mockAccount,
      });

      expect(result).toBe(false);
    });

    it('returns true when sign message render confirms', async () => {
      mockRenderConfirmSignMessage.mockResolvedValue(true);

      const mockState: Pick<
        State<UnencryptedStateValue>,
        'getKey' | 'setKey'
      > = {
        getKey: jest.fn(),
        setKey: jest.fn(),
      };
      const handler = new ConfirmationHandler({
        snapClient: {} as SnapClient,
        state: mockState as State<UnencryptedStateValue>,
        tronWebFactory: {} as TronWebFactory,
      });

      const result = await handler.handleKeyringRequest({
        request: {
          scope: Network.Mainnet,
          request: {
            method: TronMultichainMethod.SignMessage,
            params: {},
          },
        } as any,
        account: mockAccount,
      });

      expect(result).toBe(true);
      expect(mockRenderConfirmSignMessage).toHaveBeenCalled();
    });

    it('returns true when sign transaction render confirms', async () => {
      mockRenderConfirmSignTransaction.mockResolvedValue(true);

      const mockTronWeb = {
        utils: {
          deserializeTx: {
            deserializeTransaction: jest.fn().mockReturnValue({
              contract: [
                {
                  type: 'TransferContract',
                  parameter: { value: { amount: 1 } },
                },
              ],
            }),
          },
        },
      };

      const mockTronWebFactory: Pick<TronWebFactory, 'createClient'> = {
        createClient: jest.fn().mockReturnValue(mockTronWeb),
      };

      const mockState: Pick<
        State<UnencryptedStateValue>,
        'getKey' | 'setKey'
      > = {
        getKey: jest.fn(),
        setKey: jest.fn(),
      };

      const handler = new ConfirmationHandler({
        snapClient: {} as SnapClient,
        state: mockState as State<UnencryptedStateValue>,
        tronWebFactory: mockTronWebFactory as TronWebFactory,
      });

      const result = await handler.handleKeyringRequest({
        request: {
          scope: Network.Mainnet,
          request: {
            method: TronMultichainMethod.SignTransaction,
            params: {
              address: mockAccount.address,
              transaction: {
                rawDataHex: '0a0',
                type: 'TransferContract',
              },
            },
          },
        } as any,
        account: mockAccount,
      });

      expect(result).toBe(true);
      expect(mockRenderConfirmSignTransaction).toHaveBeenCalled();
    });
  });
});
