import { formatOrigin } from './formatOrigin';

describe('formatOrigin', () => {
  it('maps "metamask" to "MetaMask" (case-insensitive)', () => {
    expect(formatOrigin('metamask')).toBe('MetaMask');
    expect(formatOrigin('METAMASK')).toBe('MetaMask');
    expect(formatOrigin('MetaMask')).toBe('MetaMask');
    expect(formatOrigin('MeTaMaSk')).toBe('MetaMask');
  });

  it('maps "wallet-connect" to "WalletConnect" (case-insensitive)', () => {
    expect(formatOrigin('wallet-connect')).toBe('WalletConnect');
    expect(formatOrigin('WALLET-CONNECT')).toBe('WalletConnect');
    expect(formatOrigin('Wallet-Connect')).toBe('WalletConnect');
  });

  it('extracts hostname from valid URLs', () => {
    expect(formatOrigin('https://dapp.example.com')).toBe('dapp.example.com');
    expect(formatOrigin('http://example.com')).toBe('example.com');
    expect(formatOrigin('https://subdomain.example.com:8080')).toBe(
      'subdomain.example.com',
    );
    expect(formatOrigin('http://localhost:3000')).toBe('localhost');
    expect(formatOrigin('https://example.com/path/to/page')).toBe(
      'example.com',
    );
  });

  it('returns an empty string for non-URL / invalid origins', () => {
    expect(formatOrigin('example.com')).toBe('');
    expect(formatOrigin('not-a-url')).toBe('');
    expect(formatOrigin('just some text')).toBe('');
  });

  it('returns "Unknown" for undefined', () => {
    expect(formatOrigin(undefined)).toBe('Unknown');
  });

  it('returns "Unknown" for empty string', () => {
    expect(formatOrigin('')).toBe('Unknown');
  });
});
