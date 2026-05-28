import { getLowestUnusedIndex } from './getLowestUnusedIndex';

describe('getLowestUnusedIndex', () => {
  it('returns 0 for an empty array', () => {
    const result = getLowestUnusedIndex([]);
    expect(result).toBe(0);
  });

  it('returns the lowest unused index', () => {
    const result = getLowestUnusedIndex([
      { index: 0 },
      { index: 1 },
      { index: 2 },
      { index: 4 },
    ]);
    expect(result).toBe(3);
  });
});
