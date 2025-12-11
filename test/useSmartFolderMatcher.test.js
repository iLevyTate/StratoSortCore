/**
 * Tests for useSmartFolderMatcher Hook
 * Tests smart folder matching with caching
 */

import { renderHook } from '@testing-library/react';

describe('useSmartFolderMatcher', () => {
  let useSmartFolderMatcher;

  beforeEach(() => {
    // jest.resetModules(); // Removed - breaks React hooks context
    useSmartFolderMatcher =
      require('../src/renderer/phases/organize/useSmartFolderMatcher').useSmartFolderMatcher;
  });

  describe('basic matching', () => {
    test('returns matching function', () => {
      const { result } = renderHook(() =>
        useSmartFolderMatcher([{ name: 'Documents', path: '/Documents' }])
      );

      expect(typeof result.current).toBe('function');
    });

    test('returns null for null category', () => {
      const { result } = renderHook(() =>
        useSmartFolderMatcher([{ name: 'Documents', path: '/Documents' }])
      );

      expect(result.current(null)).toBeNull();
    });

    test('returns null for undefined category', () => {
      const { result } = renderHook(() =>
        useSmartFolderMatcher([{ name: 'Documents', path: '/Documents' }])
      );

      expect(result.current(undefined)).toBeNull();
    });

    test('returns null for empty category', () => {
      const { result } = renderHook(() =>
        useSmartFolderMatcher([{ name: 'Documents', path: '/Documents' }])
      );

      expect(result.current('')).toBeNull();
    });

    test('matches exact folder name', () => {
      const folders = [
        { name: 'Documents', path: '/Documents' },
        { name: 'Photos', path: '/Photos' }
      ];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      expect(result.current('Documents')).toEqual(folders[0]);
      expect(result.current('Photos')).toEqual(folders[1]);
    });
  });

  describe('case insensitive matching', () => {
    test('matches regardless of case', () => {
      const folders = [{ name: 'Documents', path: '/Documents' }];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      expect(result.current('documents')).toEqual(folders[0]);
      expect(result.current('DOCUMENTS')).toEqual(folders[0]);
      expect(result.current('Documents')).toEqual(folders[0]);
    });

    test('matches mixed case categories', () => {
      const folders = [{ name: 'MyDocuments', path: '/MyDocuments' }];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      expect(result.current('mydocuments')).toEqual(folders[0]);
      expect(result.current('MYDOCUMENTS')).toEqual(folders[0]);
    });
  });

  describe('plural/singular matching', () => {
    test('matches plural when category is singular', () => {
      const folders = [{ name: 'Documents', path: '/Documents' }];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      expect(result.current('document')).toEqual(folders[0]);
    });

    test('matches singular when category is plural', () => {
      const folders = [{ name: 'Document', path: '/Document' }];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      expect(result.current('documents')).toEqual(folders[0]);
    });

    test('matches photos to photo', () => {
      const folders = [{ name: 'Photos', path: '/Photos' }];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      expect(result.current('photo')).toEqual(folders[0]);
    });
  });

  describe('whitespace variant matching', () => {
    test('matches with spaces removed', () => {
      const folders = [{ name: 'My Documents', path: '/My Documents' }];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      expect(result.current('mydocuments')).toEqual(folders[0]);
    });

    test('matches with hyphens instead of spaces', () => {
      const folders = [{ name: 'My Documents', path: '/My Documents' }];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      expect(result.current('my-documents')).toEqual(folders[0]);
    });

    test('matches with underscores instead of spaces', () => {
      const folders = [{ name: 'My Documents', path: '/My Documents' }];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      expect(result.current('my_documents')).toEqual(folders[0]);
    });
  });

  describe('caching', () => {
    test('returns cached result on repeated calls', () => {
      const folders = [{ name: 'Documents', path: '/Documents' }];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      const first = result.current('documents');
      const second = result.current('documents');

      expect(first).toBe(second);
    });

    test('caches null results for unmatched categories', () => {
      const folders = [{ name: 'Documents', path: '/Documents' }];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      const first = result.current('nonexistent');
      const second = result.current('nonexistent');

      expect(first).toBeNull();
      expect(second).toBeNull();
    });
  });

  describe('no matching folder', () => {
    test('returns null when no folder matches', () => {
      const folders = [{ name: 'Documents', path: '/Documents' }];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      expect(result.current('Videos')).toBeNull();
    });
  });

  describe('empty smart folders', () => {
    test('returns null for any category with empty folders', () => {
      const { result } = renderHook(() => useSmartFolderMatcher([]));

      expect(result.current('Documents')).toBeNull();
    });
  });

  describe('folder with missing name', () => {
    test('handles folder with null name', () => {
      const folders = [{ name: null, path: '/Documents' }];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      expect(result.current('documents')).toBeNull();
    });

    test('handles folder with undefined name', () => {
      const folders = [{ path: '/Documents' }];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      expect(result.current('documents')).toBeNull();
    });
  });

  describe('memoization', () => {
    test('returns same function when smartFolders unchanged', () => {
      const folders = [{ name: 'Documents', path: '/Documents' }];
      const { result, rerender } = renderHook(() => useSmartFolderMatcher(folders));

      const first = result.current;
      rerender();
      const second = result.current;

      expect(first).toBe(second);
    });

    test('returns new function when smartFolders change', () => {
      const initialFolders = [{ name: 'Documents', path: '/Documents' }];
      const { result, rerender } = renderHook(({ folders }) => useSmartFolderMatcher(folders), {
        initialProps: { folders: initialFolders }
      });

      const first = result.current;

      const newFolders = [{ name: 'Photos', path: '/Photos' }];
      rerender({ folders: newFolders });

      const second = result.current;

      expect(first).not.toBe(second);
      expect(second('photos')).toEqual(newFolders[0]);
    });
  });

  describe('complex folder names', () => {
    test('matches folders with numbers', () => {
      const folders = [{ name: 'Project2024', path: '/Project2024' }];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      expect(result.current('project2024')).toEqual(folders[0]);
    });

    test('matches folders with special characters', () => {
      const folders = [{ name: 'Work & Personal', path: '/Work & Personal' }];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      expect(result.current('work & personal')).toEqual(folders[0]);
    });
  });

  describe('trimming', () => {
    test('trims whitespace from category', () => {
      const folders = [{ name: 'Documents', path: '/Documents' }];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      expect(result.current('  documents  ')).toEqual(folders[0]);
    });

    test('trims whitespace from folder names', () => {
      const folders = [{ name: '  Documents  ', path: '/Documents' }];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      expect(result.current('documents')).toEqual(folders[0]);
    });
  });

  describe('priority matching', () => {
    test('matches first folder in order when variants overlap', () => {
      const folders = [
        { name: 'Document', path: '/Document' },
        { name: 'Documents', path: '/Documents' }
      ];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      // First folder match wins - "Document" variant includes "documents"
      expect(result.current('documents').name).toBe('Document');
    });

    test('exact match wins when folder is first', () => {
      const folders = [
        { name: 'Documents', path: '/Documents' },
        { name: 'Document', path: '/Document' }
      ];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      // Exact case-insensitive match
      expect(result.current('documents').name).toBe('Documents');
    });

    test('first folder match wins when multiple variants match', () => {
      const folders = [
        { name: 'My Files', path: '/My Files' },
        { name: 'MyFiles', path: '/MyFiles' }
      ];
      const { result } = renderHook(() => useSmartFolderMatcher(folders));

      // "myfiles" could match either via space removal
      const match = result.current('myfiles');
      expect(match).not.toBeNull();
    });
  });
});
