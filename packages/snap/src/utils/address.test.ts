import { toTronAddress } from './address';

describe('address utilities', () => {
  describe('toTronAddress', () => {
    it('converts protocol hex TRON addresses to base58', () => {
      expect(toTronAddress('412efffc7686e54ab669a1cdb1e2cc17cf4b4eca96')).toBe(
        'TEFik7dGm6r5Y1Af9mGwnELuJLa1jXDDUB',
      );
    });

    it('converts decoded ABI hex addresses to base58', () => {
      expect(toTronAddress('0x2efffc7686e54ab669a1cdb1e2cc17cf4b4eca96')).toBe(
        'TEFik7dGm6r5Y1Af9mGwnELuJLa1jXDDUB',
      );
    });

    it('returns undefined for invalid addresses', () => {
      expect(toTronAddress('invalid-address')).toBeUndefined();
    });

    it('returns undefined for non-string values', () => {
      expect(toTronAddress(null)).toBeUndefined();
      expect(toTronAddress(undefined)).toBeUndefined();
      expect(toTronAddress(123)).toBeUndefined();
    });
  });
});
