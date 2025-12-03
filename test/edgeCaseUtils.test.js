/**
 * Tests for Edge Case Utilities
 * Tests defensive programming patterns for safe object access
 */

describe('edgeCaseUtils', () => {
  let safeGetNestedProperty;

  beforeEach(() => {
    // jest.resetModules(); // Removed - breaks module imports
    const module = require('../src/shared/edgeCaseUtils');
    safeGetNestedProperty = module.safeGetNestedProperty;
  });

  describe('safeGetNestedProperty', () => {
    describe('valid object and path', () => {
      test('returns value for simple path', () => {
        const obj = { name: 'test' };
        expect(safeGetNestedProperty(obj, 'name')).toBe('test');
      });

      test('returns value for nested path', () => {
        const obj = { user: { profile: { name: 'John' } } };
        expect(safeGetNestedProperty(obj, 'user.profile.name')).toBe('John');
      });

      test('returns value for deeply nested path', () => {
        const obj = { a: { b: { c: { d: { e: 'deep' } } } } };
        expect(safeGetNestedProperty(obj, 'a.b.c.d.e')).toBe('deep');
      });

      test('returns array value', () => {
        const obj = { items: [1, 2, 3] };
        expect(safeGetNestedProperty(obj, 'items')).toEqual([1, 2, 3]);
      });

      test('returns object value', () => {
        const obj = { nested: { data: 'value' } };
        expect(safeGetNestedProperty(obj, 'nested')).toEqual({ data: 'value' });
      });

      test('returns number value', () => {
        const obj = { count: 42 };
        expect(safeGetNestedProperty(obj, 'count')).toBe(42);
      });

      test('returns boolean value', () => {
        const obj = { enabled: true };
        expect(safeGetNestedProperty(obj, 'enabled')).toBe(true);
      });

      test('returns false boolean correctly', () => {
        const obj = { enabled: false };
        expect(safeGetNestedProperty(obj, 'enabled')).toBe(false);
      });

      test('returns zero correctly', () => {
        const obj = { count: 0 };
        expect(safeGetNestedProperty(obj, 'count')).toBe(0);
      });

      test('returns empty string correctly', () => {
        const obj = { text: '' };
        expect(safeGetNestedProperty(obj, 'text')).toBe('');
      });

      test('returns null correctly', () => {
        const obj = { value: null };
        expect(safeGetNestedProperty(obj, 'value')).toBe(null);
      });
    });

    describe('invalid object input', () => {
      test('returns default for null object', () => {
        expect(safeGetNestedProperty(null, 'path')).toBe(null);
      });

      test('returns default for undefined object', () => {
        expect(safeGetNestedProperty(undefined, 'path')).toBe(null);
      });

      test('returns default for string object', () => {
        expect(safeGetNestedProperty('string', 'path')).toBe(null);
      });

      test('returns default for number object', () => {
        expect(safeGetNestedProperty(42, 'path')).toBe(null);
      });

      test('returns default for boolean object', () => {
        expect(safeGetNestedProperty(true, 'path')).toBe(null);
      });

      test('returns custom default for invalid object', () => {
        expect(safeGetNestedProperty(null, 'path', 'custom')).toBe('custom');
      });
    });

    describe('invalid path input', () => {
      test('returns default for null path', () => {
        expect(safeGetNestedProperty({ a: 1 }, null)).toBe(null);
      });

      test('returns default for undefined path', () => {
        expect(safeGetNestedProperty({ a: 1 }, undefined)).toBe(null);
      });

      test('returns default for number path', () => {
        expect(safeGetNestedProperty({ a: 1 }, 123)).toBe(null);
      });

      test('returns default for object path', () => {
        expect(safeGetNestedProperty({ a: 1 }, {})).toBe(null);
      });

      test('returns custom default for invalid path', () => {
        expect(safeGetNestedProperty({ a: 1 }, null, 'default')).toBe('default');
      });
    });

    describe('missing path segments', () => {
      test('returns default for missing key', () => {
        const obj = { name: 'test' };
        expect(safeGetNestedProperty(obj, 'missing')).toBe(null);
      });

      test('returns default for missing nested key', () => {
        const obj = { user: { name: 'test' } };
        expect(safeGetNestedProperty(obj, 'user.profile')).toBe(null);
      });

      test('returns default for deeply missing key', () => {
        const obj = { a: { b: {} } };
        expect(safeGetNestedProperty(obj, 'a.b.c.d')).toBe(null);
      });

      test('returns custom default for missing key', () => {
        const obj = { name: 'test' };
        expect(safeGetNestedProperty(obj, 'missing', 'default')).toBe('default');
      });
    });

    describe('null/undefined in path', () => {
      test('returns default when intermediate is null', () => {
        const obj = { user: null };
        expect(safeGetNestedProperty(obj, 'user.name')).toBe(null);
      });

      test('returns default when intermediate is undefined', () => {
        const obj = { user: undefined };
        expect(safeGetNestedProperty(obj, 'user.name')).toBe(null);
      });

      test('returns default when intermediate is non-object', () => {
        const obj = { user: 'string' };
        expect(safeGetNestedProperty(obj, 'user.name')).toBe(null);
      });
    });

    describe('edge cases', () => {
      test('handles empty path string', () => {
        const obj = { name: 'test' };
        expect(safeGetNestedProperty(obj, '')).toBe(null);
      });

      test('handles path with only dots', () => {
        const obj = { name: 'test' };
        expect(safeGetNestedProperty(obj, '...')).toBe(null);
      });

      test('handles path with leading dot', () => {
        const obj = { name: 'test' };
        expect(safeGetNestedProperty(obj, '.name')).toBe(null);
      });

      test('handles path with trailing dot', () => {
        const obj = { name: 'test' };
        expect(safeGetNestedProperty(obj, 'name.')).toBe(null);
      });

      test('handles array-like object', () => {
        const obj = { '0': 'first', '1': 'second' };
        expect(safeGetNestedProperty(obj, '0')).toBe('first');
      });

      test('handles object with numeric keys', () => {
        const obj = { data: { 123: 'value' } };
        expect(safeGetNestedProperty(obj, 'data.123')).toBe('value');
      });
    });

    describe('default value types', () => {
      test('returns object as default', () => {
        const defaultObj = { fallback: true };
        expect(safeGetNestedProperty({}, 'missing', defaultObj)).toEqual(defaultObj);
      });

      test('returns array as default', () => {
        const defaultArr = [1, 2, 3];
        expect(safeGetNestedProperty({}, 'missing', defaultArr)).toEqual(defaultArr);
      });

      test('returns function as default', () => {
        const defaultFn = () => 'result';
        expect(safeGetNestedProperty({}, 'missing', defaultFn)).toBe(defaultFn);
      });

      test('returns null when undefined is passed as default', () => {
        // The function treats undefined default as "use null"
        expect(safeGetNestedProperty({}, 'missing', undefined)).toBe(null);
      });
    });
  });
});
