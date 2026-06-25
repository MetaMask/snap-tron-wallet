import type { Types } from 'tronweb';

import { getTransactionPrompt } from './transactionPrompt';

/**
 * Builds TriggerSmartContract raw data for prompt decoding tests.
 *
 * @param data - The contract calldata.
 * @returns Transaction raw data containing the calldata.
 */
function buildTriggerSmartContractRawData(data: string) {
  return {
    contract: [
      {
        type: 'TriggerSmartContract',
        parameter: {
          value: {
            data,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            owner_address: '41458437be39f3a8bfdbfee7bef93e2c5f632ceff4',
            // eslint-disable-next-line @typescript-eslint/naming-convention
            contract_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
          },
          // eslint-disable-next-line @typescript-eslint/naming-convention
          type_url: 'type.googleapis.com/protocol.TriggerSmartContract',
        },
      },
    ],
  } as unknown as Types.Transaction['raw_data'];
}

describe('getTransactionPrompt', () => {
  it('recognizes TRC20 approve transactions', () => {
    const rawData = buildTriggerSmartContractRawData(
      '095ea7b30000000000000000000000002efffc7686e54ab669a1cdb1e2cc17cf4b4eca960000000000000000000000000000000000000000000000000000000000002710',
    );

    expect(getTransactionPrompt(rawData)).toStrictEqual({
      titleKey: 'confirmation.transactionAction.authorizeToken',
      actionKey: 'confirmation.transactionAction.authorizeToken',
      targetLabelKey: 'confirmation.transactionTarget.spender',
      targetAddress: 'TEFik7dGm6r5Y1Af9mGwnELuJLa1jXDDUB',
    });
  });

  it('recognizes JustLend-style enterMarkets collateral transactions', () => {
    const rawData = buildTriggerSmartContractRawData(
      'c2998238000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010000000000000000000000002efffc7686e54ab669a1cdb1e2cc17cf4b4eca96',
    );

    expect(getTransactionPrompt(rawData)).toStrictEqual({
      titleKey: 'confirmation.transactionAction.enableCollateral',
      actionKey: 'confirmation.transactionAction.enableCollateral',
      targetLabelKey: 'confirmation.transactionTarget.collateralMarket',
      targetAddress: 'TEFik7dGm6r5Y1Af9mGwnELuJLa1jXDDUB',
    });
  });

  it('recognizes singular enterMarket collateral transactions', () => {
    const rawData = buildTriggerSmartContractRawData(
      '3fe5d4250000000000000000000000002efffc7686e54ab669a1cdb1e2cc17cf4b4eca96',
    );

    expect(getTransactionPrompt(rawData)).toStrictEqual({
      titleKey: 'confirmation.transactionAction.enableCollateral',
      actionKey: 'confirmation.transactionAction.enableCollateral',
      targetLabelKey: 'confirmation.transactionTarget.collateralMarket',
      targetAddress: 'TEFik7dGm6r5Y1Af9mGwnELuJLa1jXDDUB',
    });
  });

  it('recognizes exitMarket collateral transactions', () => {
    const rawData = buildTriggerSmartContractRawData(
      'ede4edd00000000000000000000000002efffc7686e54ab669a1cdb1e2cc17cf4b4eca96',
    );

    expect(getTransactionPrompt(rawData)).toStrictEqual({
      titleKey: 'confirmation.transactionAction.disableCollateral',
      actionKey: 'confirmation.transactionAction.disableCollateral',
      targetLabelKey: 'confirmation.transactionTarget.collateralMarket',
      targetAddress: 'TEFik7dGm6r5Y1Af9mGwnELuJLa1jXDDUB',
    });
  });

  it('returns null for unrecognized trigger smart contract calls', () => {
    const rawData = buildTriggerSmartContractRawData(
      'a9059cbb0000000000000000000000002efffc7686e54ab669a1cdb1e2cc17cf4b4eca960000000000000000000000000000000000000000000000000000000000002710',
    );

    expect(getTransactionPrompt(rawData)).toBeNull();
  });
});
