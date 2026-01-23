/**
 * Tests for text normalization utilities
 *
 * Tests the unified text normalization functions consolidated from:
 * - documentLlm.js (normalizeTextForModel)
 * - documentExtractors.js (various cleanup functions)
 * - analysisTextUtils.js (storage normalization)
 */

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const {
  cleanTextContent,
  truncateWithMarker,
  normalizeForModel,
  removeControlCharacters,
  splitIntoWords,
  createPreview,
  normalizeForStorage
} = require('../src/main/analysis/textNormalization');

describe('textNormalization', () => {
  describe('cleanTextContent', () => {
    test('returns empty string for null/undefined', () => {
      expect(cleanTextContent(null)).toBe('');
      expect(cleanTextContent(undefined)).toBe('');
      expect(cleanTextContent('')).toBe('');
    });

    test('removes null bytes', () => {
      expect(cleanTextContent('hello\u0000world')).toBe('hello world');
      expect(cleanTextContent('\u0000test\u0000')).toBe('test');
    });

    test('normalizes tabs and form feeds to spaces', () => {
      expect(cleanTextContent('hello\tworld')).toBe('hello world');
      expect(cleanTextContent('hello\fworld')).toBe('hello world');
      expect(cleanTextContent('hello\x0Bworld')).toBe('hello world');
    });

    test('collapses multiple spaces to single space', () => {
      expect(cleanTextContent('hello    world')).toBe('hello world');
      expect(cleanTextContent('  hello   world  ')).toBe('hello world');
    });

    test('trims whitespace', () => {
      expect(cleanTextContent('  test  ')).toBe('test');
    });

    test('handles mixed content', () => {
      const input = '  Hello\u0000\tWorld   with\x0Bmultiple  spaces  ';
      expect(cleanTextContent(input)).toBe('Hello World with multiple spaces');
    });
  });

  describe('truncateWithMarker', () => {
    test('returns original text if shorter than maxLength', () => {
      expect(truncateWithMarker('hello', 10)).toBe('hello');
      expect(truncateWithMarker('hello', 5)).toBe('hello');
    });

    test('returns null/undefined as-is', () => {
      expect(truncateWithMarker(null, 10)).toBeNull();
      expect(truncateWithMarker(undefined, 10)).toBeUndefined();
    });

    test('truncates text without marker by default', () => {
      expect(truncateWithMarker('hello world', 5)).toBe('hello');
    });

    test('truncates text with marker', () => {
      expect(truncateWithMarker('hello world', 8, '...')).toBe('hello...');
    });

    test('handles marker longer than available space', () => {
      expect(truncateWithMarker('hello', 3, '...')).toBe('...');
    });
  });

  describe('normalizeForModel', () => {
    test('returns empty string for null/undefined', () => {
      expect(normalizeForModel(null, 100)).toBe('');
      expect(normalizeForModel(undefined, 100)).toBe('');
      expect(normalizeForModel('', 100)).toBe('');
    });

    test('cleans and truncates text', () => {
      const input = '  Hello\u0000  World  ';
      const result = normalizeForModel(input, 100);
      expect(result).toBe('Hello World');
    });

    test('truncates before regex to prevent buffer overflow', () => {
      // Very long input should be handled safely
      const longInput = 'a'.repeat(100000);
      const result = normalizeForModel(longInput, 100);
      expect(result.length).toBeLessThanOrEqual(100);
    });

    test('handles no maxLength specified', () => {
      const input = 'hello world';
      const result = normalizeForModel(input);
      expect(result).toBe('hello world');
    });

    test('handles maxLength of 0', () => {
      const result = normalizeForModel('hello', 0);
      // 0 or invalid maxLength should not truncate
      expect(result).toBe('hello');
    });
  });

  describe('removeControlCharacters', () => {
    test('returns empty string for null/undefined', () => {
      expect(removeControlCharacters(null)).toBe('');
      expect(removeControlCharacters(undefined)).toBe('');
    });

    test('preserves newlines by default', () => {
      const input = 'hello\nworld\r\n';
      const result = removeControlCharacters(input);
      expect(result).toContain('\n');
    });

    test('removes control chars while preserving newlines', () => {
      const input = 'hello\u0001\u0002world\n';
      const result = removeControlCharacters(input);
      expect(result).toBe('helloworld\n');
    });

    test('removes all control chars when preserveNewlines is false', () => {
      const input = 'hello\nworld';
      const result = removeControlCharacters(input, { preserveNewlines: false });
      expect(result).not.toContain('\n');
    });
  });

  describe('splitIntoWords', () => {
    test('returns empty array for null/undefined', () => {
      expect(splitIntoWords(null)).toEqual([]);
      expect(splitIntoWords(undefined)).toEqual([]);
      expect(splitIntoWords('')).toEqual([]);
    });

    test('splits on various separators', () => {
      const result = splitIntoWords('hello-world_foo/bar.baz');
      expect(result).toContain('hello');
      expect(result).toContain('world');
      expect(result).toContain('foo');
      expect(result).toContain('bar');
      expect(result).toContain('baz');
    });

    test('filters by minimum word length', () => {
      const result = splitIntoWords('a to the hello world', { minWordLength: 3 });
      expect(result).not.toContain('a');
      expect(result).not.toContain('to');
      expect(result).toContain('the');
      expect(result).toContain('hello');
    });

    test('respects maxWords limit', () => {
      const result = splitIntoWords('one two three four five', { maxWords: 3 });
      expect(result.length).toBe(3);
    });

    test('converts to lowercase', () => {
      const result = splitIntoWords('Hello World');
      expect(result).toContain('hello');
      expect(result).toContain('world');
    });
  });

  describe('createPreview', () => {
    test('returns empty string for null/undefined', () => {
      expect(createPreview(null)).toBe('');
      expect(createPreview(undefined)).toBe('');
    });

    test('returns full text if shorter than maxLength', () => {
      expect(createPreview('hello world', 100)).toBe('hello world');
    });

    test('truncates at word boundary when possible', () => {
      const result = createPreview('hello world testing', 15);
      // Should truncate at a word boundary if within 70% of max
      expect(result.endsWith('...')).toBe(true);
    });

    test('uses custom suffix', () => {
      const result = createPreview('hello world testing', 10, ' [more]');
      expect(result.endsWith('[more]')).toBe(true);
    });

    test('cleans content before truncating', () => {
      const input = '  hello   world  ';
      const result = createPreview(input, 100);
      expect(result).toBe('hello world');
    });
  });

  describe('normalizeForStorage', () => {
    test('returns null for non-string input', () => {
      expect(normalizeForStorage(null)).toBeNull();
      expect(normalizeForStorage(undefined)).toBeNull();
      expect(normalizeForStorage(123)).toBeNull();
      expect(normalizeForStorage({})).toBeNull();
    });

    test('returns null for empty string', () => {
      expect(normalizeForStorage('')).toBeNull();
      expect(normalizeForStorage('   ')).toBeNull();
    });

    test('removes null bytes', () => {
      const result = normalizeForStorage('hello\u0000world');
      expect(result).toBe('helloworld');
    });

    test('trims whitespace', () => {
      expect(normalizeForStorage('  test  ')).toBe('test');
    });

    test('truncates to maxLength', () => {
      const result = normalizeForStorage('hello world', 5);
      expect(result).toBe('hello');
    });

    test('returns cleaned text without maxLength', () => {
      const result = normalizeForStorage('  hello  ');
      expect(result).toBe('hello');
    });
  });
});
