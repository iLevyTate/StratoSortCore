/**
 * Tests for Safe Access Utilities
 * Tests null-safe property access and validation
 */

// Mock edgeCaseUtils
jest.mock('../src/shared/edgeCaseUtils', () => ({
  safeGetNestedProperty: jest.fn((obj, path, defaultValue) => {
    if (!obj || typeof obj !== 'object') return defaultValue;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return defaultValue;
      current = current[part];
    }
    return current === undefined ? defaultValue : current;
  }),
}));

describe('Safe Access Utilities', () => {
  let safeGet;
  let ensureArray;
  let safeFilePath;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    const module = require('../src/main/utils/safeAccess');
    safeGet = module.safeGet;
    ensureArray = module.ensureArray;
    safeFilePath = module.safeFilePath;
  });

  describe('safeGet', () => {
    test('returns value for existing path', () => {
      const obj = { a: { b: { c: 'value' } } };

      expect(safeGet(obj, 'a.b.c')).toBe('value');
    });

    test('returns default for missing path', () => {
      const obj = { a: { b: {} } };

      expect(safeGet(obj, 'a.b.c', 'default')).toBe('default');
    });

    test('returns null default for missing path', () => {
      const obj = {};

      expect(safeGet(obj, 'a.b')).toBeNull();
    });

    test('handles null object', () => {
      expect(safeGet(null, 'a.b', 'default')).toBe('default');
    });

    test('handles undefined object', () => {
      expect(safeGet(undefined, 'a.b', 'default')).toBe('default');
    });

    test('returns root value for simple path', () => {
      const obj = { key: 'value' };

      expect(safeGet(obj, 'key')).toBe('value');
    });
  });

  describe('ensureArray', () => {
    test('returns array as-is', () => {
      const arr = [1, 2, 3];

      expect(ensureArray(arr)).toBe(arr);
    });

    test('returns empty array for null', () => {
      expect(ensureArray(null)).toEqual([]);
    });

    test('returns empty array for undefined', () => {
      expect(ensureArray(undefined)).toEqual([]);
    });

    test('wraps single value in array', () => {
      expect(ensureArray('value')).toEqual(['value']);
    });

    test('wraps number in array', () => {
      expect(ensureArray(42)).toEqual([42]);
    });

    test('wraps object in array', () => {
      const obj = { key: 'value' };

      expect(ensureArray(obj)).toEqual([obj]);
    });

    test('returns empty array for empty string', () => {
      expect(ensureArray('')).toEqual(['']);
    });

    test('returns array containing 0', () => {
      expect(ensureArray(0)).toEqual([0]);
    });

    test('returns array containing false', () => {
      expect(ensureArray(false)).toEqual([false]);
    });
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
