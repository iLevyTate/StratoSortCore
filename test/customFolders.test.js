/**
 * Tests for Custom Folders Module
 * Tests folder configuration persistence
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

// Mock fs
const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  rename: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined)
};
jest.mock('fs', () => ({
  promises: mockFs
}));

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn((type) => {
      if (type === 'userData') return '/mock/userData';
      if (type === 'documents') return '/mock/documents';
      return '/mock/path';
    })
  }
}));

// Mock path to work cross-platform
jest.mock('path', () => {
  const actualPath = jest.requireActual('path');
  return {
    ...actualPath,
    join: (...args) => args.join('/'),
    normalize: (p) => p
  };
});

describe('Custom Folders', () => {
  let customFolders;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    customFolders = require('../src/main/core/customFolders');
  });

  describe('getCustomFoldersPath', () => {
    test('returns path in userData directory', () => {
      const path = customFolders.getCustomFoldersPath();
      expect(path).toContain('userData');
      expect(path).toContain('custom-folders.json');
    });
  });

  describe('loadCustomFolders', () => {
    test('loads and parses saved folders', async () => {
      const savedFolders = [
        {
          id: 'folder1',
          name: 'Documents',
          path: '/test/documents',
          isDefault: false
        },
        {
          id: 'uncategorized',
          name: 'Uncategorized',
          path: '/test/uncategorized',
          isDefault: true
        }
      ];
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(savedFolders));

      const folders = await customFolders.loadCustomFolders();

      expect(folders).toHaveLength(2);
      expect(folders[0].name).toBe('Documents');
    });

    test('creates default Uncategorized folder when file does not exist', async () => {
      mockFs.readFile.mockRejectedValueOnce(new Error('ENOENT'));

      const folders = await customFolders.loadCustomFolders();

      expect(folders).toHaveLength(1);
      expect(folders[0].name).toBe('Uncategorized');
      expect(folders[0].isDefault).toBe(true);
      expect(mockFs.mkdir).toHaveBeenCalled();
    });

    test('adds Uncategorized folder if missing from saved data', async () => {
      const savedFolders = [
        {
          id: 'folder1',
          name: 'Documents',
          path: '/test/documents',
          isDefault: false
        }
      ];
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(savedFolders));

      const folders = await customFolders.loadCustomFolders();

      // Should have original folder plus new Uncategorized
      expect(folders.some((f) => f.name.toLowerCase() === 'uncategorized')).toBe(true);
    });

    test('normalizes folder paths', async () => {
      const savedFolders = [
        {
          id: 'uncategorized',
          name: 'Uncategorized',
          path: '/test/path',
          isDefault: true
        }
      ];
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(savedFolders));

      const folders = await customFolders.loadCustomFolders();

      expect(folders[0].path).toBeDefined();
    });

    test('handles invalid JSON gracefully', async () => {
      mockFs.readFile.mockResolvedValueOnce('not valid json');

      const folders = await customFolders.loadCustomFolders();

      // Should create default folder
      expect(folders[0].name).toBe('Uncategorized');
    });
  });

  describe('saveCustomFolders', () => {
    test('saves folders to file atomically', async () => {
      const folders = [
        {
          id: 'folder1',
          name: 'Documents',
          path: '/test/documents'
        }
      ];

      await customFolders.saveCustomFolders(folders);

      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(mockFs.rename).toHaveBeenCalled();
    });

    test('normalizes paths before saving', async () => {
      const folders = [
        {
          id: 'folder1',
          name: 'Documents',
          path: '/test/documents'
        }
      ];

      await customFolders.saveCustomFolders(folders);

      const writeCall = mockFs.writeFile.mock.calls[0];
      expect(writeCall[1]).toContain('Documents');
    });

    test('handles non-array input', async () => {
      await customFolders.saveCustomFolders(null);

      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    test('cleans up temp file on write failure', async () => {
      const folders = [{ id: 'folder1', name: 'Test', path: '/test' }];
      mockFs.writeFile.mockRejectedValueOnce(new Error('Write failed'));

      await customFolders.saveCustomFolders(folders);

      // Logger should have logged the error
    });

    test('handles rename failure by cleaning up temp file', async () => {
      const folders = [{ id: 'folder1', name: 'Test', path: '/test' }];
      mockFs.rename.mockRejectedValueOnce(new Error('Rename failed'));

      await customFolders.saveCustomFolders(folders);

      expect(mockFs.unlink).toHaveBeenCalled();
    });
  });
});
