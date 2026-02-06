const { normalizeText, normalizeOptionalText } = require('../src/shared/normalization/text');

describe('normalization/text', () => {
  test('normalizeText trims, collapses whitespace, and strips nulls', () => {
    const result = normalizeText('  a\u0000\t b  ');
    expect(result).toBe('a b');
  });

  test('normalizeText respects maxLength', () => {
    const result = normalizeText('abcdef', { maxLength: 3 });
    expect(result).toBe('abc');
  });

  test('normalizeOptionalText returns null when empty', () => {
    const result = normalizeOptionalText('   ');
    expect(result).toBeNull();
  });
});
