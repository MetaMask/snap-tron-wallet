import { decodeCallDataParams } from './abi';

describe('ABI utilities', () => {
  describe('decodeCallDataParams', () => {
    it('decodes calldata parameters after the function selector', () => {
      const decoded = decodeCallDataParams(
        '095ea7b30000000000000000000000002efffc7686e54ab669a1cdb1e2cc17cf4b4eca960000000000000000000000000000000000000000000000000000000000002710',
        ['address', 'uint256'],
      );

      expect(decoded?.[0]).toBe('412efffc7686e54ab669a1cdb1e2cc17cf4b4eca96');
      expect(decoded?.[1]).toBe(10000n);
    });

    it('returns null for invalid calldata', () => {
      expect(decodeCallDataParams('invalid', ['address'])).toBeNull();
    });
  });
});
