import {
  InvalidParamsError,
  SnapError,
  UnauthorizedError,
} from '@metamask/snaps-sdk';
import { object, string } from '@metamask/superstruct';

import {
  validateOrigin,
  validateRequest,
  validateResponse,
} from './validators';
import { TronMultichainMethod } from '../handlers/keyring-types';

describe('validateOrigin', () => {
  it('allows metamask origin for signTransaction', () => {
    expect(() =>
      validateOrigin('metamask', TronMultichainMethod.SignTransaction),
    ).not.toThrow();
  });

  it('allows metamask origin for signMessage', () => {
    expect(() =>
      validateOrigin('metamask', TronMultichainMethod.SignMessage),
    ).not.toThrow();
  });

  it('rejects unknown origin for signTransaction', () => {
    expect(() =>
      validateOrigin('https://sun.io', TronMultichainMethod.SignTransaction),
    ).toThrow(UnauthorizedError);
  });

  it('rejects missing origin', () => {
    expect(() =>
      validateOrigin('', TronMultichainMethod.SignTransaction),
    ).toThrow('Origin not found');
  });

  it('rejects unsupported method for metamask origin', () => {
    expect(() => validateOrigin('metamask', 'tron_signTransaction')).toThrow(
      UnauthorizedError,
    );
  });
});

describe('request and response validation', () => {
  it('throws InvalidParamsError for invalid request', () => {
    expect(() =>
      validateRequest({ message: 1 }, object({ message: string() })),
    ).toThrow(InvalidParamsError);
  });

  it('throws SnapError for invalid response', () => {
    expect(() =>
      validateResponse({ signature: 1 }, object({ signature: string() })),
    ).toThrow(SnapError);
  });
});
