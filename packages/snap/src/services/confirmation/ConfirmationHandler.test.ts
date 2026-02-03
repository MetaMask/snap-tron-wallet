import type { Transaction } from 'tronweb/lib/esm/types';

import { ConfirmationHandler } from './ConfirmationHandler';
import type { SnapClient } from '../../clients/snap/SnapClient';
import type { TronWebFactory } from '../../clients/tronweb/TronWebFactory';
import { Network } from '../../constants';
import type { TronKeyringAccount } from '../../entities';
import { TronMultichainMethod } from '../../handlers/keyring-types';
import { render as renderConfirmSignTransaction } from '../../ui/confirmation/views/ConfirmSignTransaction/render';
import type { State, UnencryptedStateValue } from '../state/State';

// Import mocked functions

// Mock the render functions
jest.mock('../../ui/confirmation/views/ConfirmSignMessage/render', () => ({
  render: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../ui/confirmation/views/ConfirmSignTransaction/render', () => ({
  render: jest.fn().mockResolvedValue(true),
}));

jest.mock(
  '../../ui/confirmation/views/ConfirmTransactionRequest/render',
  () => ({
    render: jest.fn().mockResolvedValue(true),
  }),
);

describe('ConfirmationHandler', () => {
  const mockAccount: TronKeyringAccount = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
    options: {},
    methods: ['signMessage', 'signTransaction'],
    type: 'tron:eoa',
    scopes: [Network.Mainnet, Network.Shasta],
    entropySource: 'entropy-source-1' as any,
    derivationPath: "m/44'/195'/0'/0/0",
    index: 0,
  };

  let confirmationHandler: ConfirmationHandler;
  let mockSnapClient: jest.Mocked<SnapClient>;
  let mockState: jest.Mocked<State<UnencryptedStateValue>>;
  let mockTronWebFactory: jest.Mocked<TronWebFactory>;
  let mockTronWeb: any;

  // Sample transaction data
  const originalRawDataHex = 'abcd1234';
  const extendedRawDataHex = 'extended5678';
  const originalExpiration = Date.now() + 60_000; // 60 seconds from now
  const extendedExpiration = originalExpiration + 300_000; // +5 minutes

  /* eslint-disable @typescript-eslint/naming-convention */
  const mockRawData: Transaction['raw_data'] = {
    contract: [],
    ref_block_bytes: '1234',
    ref_block_hash: 'abcd5678',
    expiration: originalExpiration,
    timestamp: Date.now(),
  };

  const mockExtendedRawData: Transaction['raw_data'] = {
    ...mockRawData,
    expiration: extendedExpiration,
  };
  /* eslint-enable @typescript-eslint/naming-convention */

  beforeEach(() => {
    jest.clearAllMocks();

    /* eslint-disable @typescript-eslint/naming-convention */
    // Create mock extended transaction
    const mockExtendedTransaction: Transaction = {
      visible: true,
      txID: 'new-tx-id',
      raw_data: mockExtendedRawData,
      raw_data_hex: extendedRawDataHex,
    };
    /* eslint-enable @typescript-eslint/naming-convention */

    mockTronWeb = {
      utils: {
        deserializeTx: {
          deserializeTransaction: jest.fn().mockReturnValue(mockRawData),
        },
      },
      transactionBuilder: {
        extendExpiration: jest.fn().mockResolvedValue(mockExtendedTransaction),
      },
    };

    mockSnapClient = {} as jest.Mocked<SnapClient>;

    mockState = {} as jest.Mocked<State<UnencryptedStateValue>>;

    mockTronWebFactory = {
      createClient: jest.fn().mockReturnValue(mockTronWeb),
    } as any;

    confirmationHandler = new ConfirmationHandler({
      snapClient: mockSnapClient,
      state: mockState,
      tronWebFactory: mockTronWebFactory,
    });
  });

  describe('handleKeyringRequest', () => {
    describe('SignTransaction requests', () => {
      it('extends transaction expiration before showing confirmation dialog', async () => {
        const request = {
          id: 'request-1',
          account: mockAccount.id,
          scope: Network.Mainnet,
          origin: 'https://dapp.example.com',
          request: {
            method: TronMultichainMethod.SignTransaction,
            params: {
              address: mockAccount.address,
              transaction: {
                rawDataHex: originalRawDataHex,
                type: 'TransferContract',
              },
            },
          },
        };

        await confirmationHandler.handleKeyringRequest({
          request: request as any,
          account: mockAccount,
        });

        // Verify TronWeb was used to deserialize the transaction
        expect(
          mockTronWeb.utils.deserializeTx.deserializeTransaction,
        ).toHaveBeenCalledWith('TransferContract', originalRawDataHex);

        // Verify extendExpiration was called with correct parameters
        /* eslint-disable @typescript-eslint/naming-convention */
        expect(
          mockTronWeb.transactionBuilder.extendExpiration,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            raw_data: mockRawData,
            raw_data_hex: originalRawDataHex,
          }),
          300_000, // 5 minutes in milliseconds
        );
        /* eslint-enable @typescript-eslint/naming-convention */

        // Verify the request was updated with the extended rawDataHex
        expect(request.request.params.transaction.rawDataHex).toBe(
          extendedRawDataHex,
        );

        // Verify render was called with the extended raw data
        expect(renderConfirmSignTransaction).toHaveBeenCalledWith(
          request,
          mockAccount,
          mockExtendedRawData,
        );
      });

      it('returns true when user approves the transaction', async () => {
        const request = {
          id: 'request-1',
          account: mockAccount.id,
          scope: Network.Mainnet,
          origin: 'https://dapp.example.com',
          request: {
            method: TronMultichainMethod.SignTransaction,
            params: {
              address: mockAccount.address,
              transaction: {
                rawDataHex: originalRawDataHex,
                type: 'TransferContract',
              },
            },
          },
        };

        (renderConfirmSignTransaction as jest.Mock).mockResolvedValueOnce(true);

        const result = await confirmationHandler.handleKeyringRequest({
          request: request as any,
          account: mockAccount,
        });

        expect(result).toBe(true);
      });

      it('returns false when user rejects the transaction', async () => {
        const request = {
          id: 'request-1',
          account: mockAccount.id,
          scope: Network.Mainnet,
          origin: 'https://dapp.example.com',
          request: {
            method: TronMultichainMethod.SignTransaction,
            params: {
              address: mockAccount.address,
              transaction: {
                rawDataHex: originalRawDataHex,
                type: 'TransferContract',
              },
            },
          },
        };

        (renderConfirmSignTransaction as jest.Mock).mockResolvedValueOnce(
          false,
        );

        const result = await confirmationHandler.handleKeyringRequest({
          request: request as any,
          account: mockAccount,
        });

        expect(result).toBe(false);
      });

      it('handles TriggerSmartContract transaction types', async () => {
        const request = {
          id: 'request-1',
          account: mockAccount.id,
          scope: Network.Mainnet,
          origin: 'https://dapp.example.com',
          request: {
            method: TronMultichainMethod.SignTransaction,
            params: {
              address: mockAccount.address,
              transaction: {
                rawDataHex: originalRawDataHex,
                type: 'TriggerSmartContract',
              },
            },
          },
        };

        await confirmationHandler.handleKeyringRequest({
          request: request as any,
          account: mockAccount,
        });

        expect(
          mockTronWeb.utils.deserializeTx.deserializeTransaction,
        ).toHaveBeenCalledWith('TriggerSmartContract', originalRawDataHex);

        expect(
          mockTronWeb.transactionBuilder.extendExpiration,
        ).toHaveBeenCalled();
      });
    });

    describe('unsupported methods', () => {
      it('throws error for unhandled keyring request methods', async () => {
        const request = {
          id: 'request-1',
          account: mockAccount.id,
          scope: Network.Mainnet,
          origin: 'https://dapp.example.com',
          request: {
            method: 'unsupportedMethod' as any,
            params: {},
          },
        };

        await expect(
          confirmationHandler.handleKeyringRequest({
            request: request as any,
            account: mockAccount,
          }),
        ).rejects.toThrow(
          'Unhandled keyring request method: unsupportedMethod',
        );
      });
    });
  });
});
