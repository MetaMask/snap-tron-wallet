import { SnapError } from '@metamask/snaps-sdk';

import { ListAccountAssetsResponseStruct } from './structs';
import { validateResponse } from './validators';

const getThrownValidateResponseError = (): unknown => {
  try {
    validateResponse({}, ListAccountAssetsResponseStruct);
  } catch (error) {
    return error;
  }

  return undefined;
};

describe('Validators', () => {
  describe('validateResponse', () => {
    it('throws invalid response with cause data', () => {
      const error = getThrownValidateResponseError();
      const snapError = error as SnapError;

      expect(snapError).toBeInstanceOf(SnapError);
      expect(snapError.message).toContain('Invalid Response');
      expect(snapError.data).toMatchObject({
        cause: {
          message: expect.stringContaining('Expected an array value'),
        },
      });
    });
  });
});
