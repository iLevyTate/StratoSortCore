/**
 * Tests for Safe Access Utilities
 * Tests null-safe file path validation
 */

describe('Safe Access Utilities', () => {
  let safeFilePath;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    const module = require('../src/main/utils/safeAccess');
    safeFilePath = module.safeFilePath;
  });

  describe('safeFilePath', () => {
    test('returns valid path unchanged', () => {
      expect(safeFilePath('/path/to/file.txt')).toBe('/path/to/file.txt');
    });

    test('trims whitespace', () => {
      expect(safeFilePath('  /path/to/file.txt  ')).toBe('/path/to/file.txt');
    });

    test('returns null for null input', () => {
      expect(safeFilePath(null)).toBeNull();
    });

    test('returns null for undefined input', () => {
      expect(safeFilePath(undefined)).toBeNull();
    });

    test('returns null for empty string', () => {
      expect(safeFilePath('')).toBeNull();
    });

    test('returns null for whitespace-only string', () => {
      expect(safeFilePath('   ')).toBeNull();
    });

    test('returns null for non-string input', () => {
      expect(safeFilePath(123)).toBeNull();
      expect(safeFilePath({})).toBeNull();
      expect(safeFilePath([])).toBeNull();
    });

    test('removes null bytes', () => {
      expect(safeFilePath('/path\0to/file.txt')).toBe('/pathto/file.txt');
    });

    test('removes multiple null bytes', () => {
      expect(safeFilePath('/path\0\0to\0file.txt')).toBe('/pathtofile.txt');
    });

    test('returns null if only null bytes', () => {
      expect(safeFilePath('\0\0\0')).toBeNull();
    });
  });
});
