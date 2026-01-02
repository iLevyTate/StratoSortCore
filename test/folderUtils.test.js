/**
 * @jest-environment node
 *
 * Tests for folderUtils.js
 * Covers folder mapping and category extraction utilities
 */

const { mapFoldersToCategories, getFolderNamesString } = require('../src/shared/folderUtils');

describe('folderUtils', () => {
  describe('mapFoldersToCategories', () => {
    describe('basic functionality', () => {
      test('maps folders to category objects', () => {
        const folders = [
          { id: '1', name: 'Reports', description: 'Monthly reports', path: '/docs/reports' },
          { id: '2', name: 'Invoices', description: 'Payment invoices', path: '/docs/invoices' }
        ];

        const result = mapFoldersToCategories(folders);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ name: 'Reports', description: 'Monthly reports', id: '1' });
        expect(result[1]).toEqual({ name: 'Invoices', description: 'Payment invoices', id: '2' });
      });

      test('handles empty array', () => {
        const result = mapFoldersToCategories([]);
        expect(result).toEqual([]);
      });

      test('handles null input', () => {
        const result = mapFoldersToCategories(null);
        expect(result).toEqual([]);
      });

      test('handles undefined input', () => {
        const result = mapFoldersToCategories(undefined);
        expect(result).toEqual([]);
      });
    });

    describe('filtering behavior', () => {
      test('filters out default folders without paths', () => {
        const folders = [
          { id: '1', name: 'Documents', isDefault: true },
          { id: '2', name: 'Reports', description: 'Monthly reports', path: '/docs/reports' }
        ];

        const result = mapFoldersToCategories(folders);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Reports');
      });

      test('includes default folders with paths', () => {
        const folders = [
          { id: '1', name: 'Documents', isDefault: true, path: '/docs' },
          { id: '2', name: 'Reports', path: '/reports' }
        ];

        const result = mapFoldersToCategories(folders);

        expect(result).toHaveLength(2);
      });

      test('filters out null entries', () => {
        const folders = [null, { id: '1', name: 'Reports', path: '/reports' }, undefined];

        const result = mapFoldersToCategories(folders);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Reports');
      });
    });

    describe('options.includeId', () => {
      test('includes id by default', () => {
        const folders = [{ id: '123', name: 'Test', path: '/test' }];

        const result = mapFoldersToCategories(folders);

        expect(result[0]).toHaveProperty('id', '123');
      });

      test('excludes id when includeId is false', () => {
        const folders = [{ id: '123', name: 'Test', path: '/test' }];

        const result = mapFoldersToCategories(folders, { includeId: false });

        expect(result[0]).not.toHaveProperty('id');
      });
    });

    describe('options.nameMax', () => {
      test('truncates name to specified length', () => {
        const folders = [{ name: 'Very Long Folder Name Here', path: '/test' }];

        const result = mapFoldersToCategories(folders, { nameMax: 10 });

        expect(result[0].name).toBe('Very Long ');
        expect(result[0].name.length).toBe(10);
      });

      test('does not truncate if name is shorter than max', () => {
        const folders = [{ name: 'Short', path: '/test' }];

        const result = mapFoldersToCategories(folders, { nameMax: 100 });

        expect(result[0].name).toBe('Short');
      });
    });

    describe('options.descriptionMax', () => {
      test('truncates description to specified length', () => {
        const folders = [
          {
            name: 'Test',
            description: 'This is a very long description that should be truncated',
            path: '/test'
          }
        ];

        const result = mapFoldersToCategories(folders, { descriptionMax: 20 });

        expect(result[0].description).toBe('This is a very long ');
        expect(result[0].description.length).toBe(20);
      });
    });

    describe('options.limit', () => {
      test('limits number of folders returned', () => {
        const folders = [
          { name: 'A', path: '/a' },
          { name: 'B', path: '/b' },
          { name: 'C', path: '/c' },
          { name: 'D', path: '/d' },
          { name: 'E', path: '/e' }
        ];

        const result = mapFoldersToCategories(folders, { limit: 3 });

        expect(result).toHaveLength(3);
        expect(result.map((f) => f.name)).toEqual(['A', 'B', 'C']);
      });

      test('returns all folders if limit exceeds count', () => {
        const folders = [
          { name: 'A', path: '/a' },
          { name: 'B', path: '/b' }
        ];

        const result = mapFoldersToCategories(folders, { limit: 10 });

        expect(result).toHaveLength(2);
      });
    });

    describe('default values', () => {
      test('uses "Unknown" for missing name', () => {
        const folders = [{ path: '/test' }];

        const result = mapFoldersToCategories(folders);

        expect(result[0].name).toBe('Unknown');
      });

      test('uses empty string for missing description', () => {
        const folders = [{ name: 'Test', path: '/test' }];

        const result = mapFoldersToCategories(folders);

        expect(result[0].description).toBe('');
      });

      test('uses null for missing id', () => {
        const folders = [{ name: 'Test', path: '/test' }];

        const result = mapFoldersToCategories(folders);

        expect(result[0].id).toBeNull();
      });
    });
  });

  describe('getFolderNamesString', () => {
    test('returns comma-separated folder names', () => {
      const categories = [{ name: 'Reports' }, { name: 'Invoices' }, { name: 'Documents' }];

      const result = getFolderNamesString(categories);

      expect(result).toBe('Reports, Invoices, Documents');
    });

    test('handles single folder', () => {
      const categories = [{ name: 'Reports' }];

      const result = getFolderNamesString(categories);

      expect(result).toBe('Reports');
    });

    test('handles empty array', () => {
      const result = getFolderNamesString([]);

      expect(result).toBe('');
    });

    test('handles null input', () => {
      const result = getFolderNamesString(null);

      expect(result).toBe('');
    });

    test('uses "Unknown" for folders without names', () => {
      const categories = [{ name: 'Reports' }, {}, { name: 'Documents' }];

      const result = getFolderNamesString(categories);

      expect(result).toBe('Reports, Unknown, Documents');
    });

    test('handles null entries in array', () => {
      const categories = [{ name: 'Reports' }, null, { name: 'Documents' }];

      const result = getFolderNamesString(categories);

      expect(result).toBe('Reports, Unknown, Documents');
    });
  });
});
