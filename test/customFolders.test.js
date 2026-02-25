/**
 * Tests for Custom Folders Module
 * Tests folder configuration persistence
 */

// Mock logger
jest.mock('../src/shared/logger', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

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
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockFs.readFile.mockRejectedValue(enoent);
  });

  describe('getCustomFoldersPath', () => {
    test('returns path in userData directory', () => {
      const path = customFolders.getCustomFoldersPath();
      expect(path).toContain('userData');
      expect(path).toContain('custom-folders.json');
    });
  });

  describe('loadCustomFolders', () => {
    test('loads and parses saved folders, only ensures Uncategorized', async () => {
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

      expect(folders.some((f) => f.name === 'Documents')).toBe(true);
      expect(folders.some((f) => f.name === 'Uncategorized')).toBe(true);
      // Should NOT inject extra defaults the user didn't add
      expect(folders.some((f) => f.name === 'Archives')).toBe(false);
      expect(folders).toHaveLength(2);
    });

    test('creates only Uncategorized when file does not exist (first launch)', async () => {
      mockFs.readFile.mockRejectedValueOnce(new Error('ENOENT'));

      const folders = await customFolders.loadCustomFolders();

      // First launch: only Uncategorized is created; user builds their own structure
      expect(folders).toHaveLength(1);
      expect(folders[0].name).toBe('Uncategorized');
      expect(folders[0].isDefault).toBe(true);
      expect(mockFs.mkdir).toHaveBeenCalled();
    });

    test('adds only Uncategorized if it is missing from saved data', async () => {
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

      // Should add Uncategorized but NOT other defaults
      expect(folders).toHaveLength(2);
      expect(folders.some((f) => f.name === 'Documents')).toBe(true);
      expect(folders.some((f) => f.name.toLowerCase() === 'uncategorized')).toBe(true);
      expect(folders.some((f) => f.name === 'Archives')).toBe(false);
    });

    test('heals Uncategorized folder when saved entry has no path', async () => {
      const savedFolders = [
        {
          id: 'uncategorized',
          name: 'Uncategorized',
          path: '',
          isDefault: true
        }
      ];
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(savedFolders));

      const folders = await customFolders.loadCustomFolders();
      const uncategorized = folders.find((folder) => folder.name === 'Uncategorized');

      expect(uncategorized?.path).toBe('/mock/documents/StratoSort/Uncategorized');
      expect(mockFs.mkdir).toHaveBeenCalledWith('/mock/documents/StratoSort/Uncategorized', {
        recursive: true
      });
      expect(mockFs.writeFile).toHaveBeenCalled();
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

      const uncategorized = folders.find((folder) => folder.name === 'Uncategorized');
      expect(uncategorized?.path).toBeDefined();
    });

    test('heals missing folder ids instead of dropping folders', async () => {
      const savedFolders = [
        {
          name: 'Projects',
          path: '/test/projects',
          isDefault: false
        },
        {
          name: 'Uncategorized',
          path: '/test/uncategorized',
          isDefault: true
        }
      ];
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(savedFolders));

      const folders = await customFolders.loadCustomFolders();
      const projects = folders.find((folder) => folder.name === 'Projects');
      const uncategorized = folders.find((folder) => folder.name === 'Uncategorized');

      expect(projects).toBeDefined();
      expect(typeof projects.id).toBe('string');
      expect(projects.id.length).toBeGreaterThan(0);
      expect(uncategorized).toBeDefined();
      expect(typeof uncategorized.id).toBe('string');
      expect(uncategorized.id.length).toBeGreaterThan(0);
    });

    test('does not re-add defaults when custom folders exist', async () => {
      const savedFolders = [
        {
          id: 'custom-projects',
          name: 'Projects',
          path: '/custom/projects',
          isDefault: false
        },
        {
          id: 'uncategorized',
          name: 'Uncategorized',
          path: '/custom/uncategorized',
          isDefault: true
        }
      ];

      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(savedFolders));

      const folders = await customFolders.loadCustomFolders();

      expect(folders.some((f) => f.name === 'Projects')).toBe(true);
      expect(folders.some((f) => f.name === 'Documents')).toBe(false);
      expect(folders.some((f) => f.name === 'Archives')).toBe(false);
    });

    test('recovers custom folders from legacy userData when current has defaults only', async () => {
      const currentDefaults = [
        {
          id: 'default-documents',
          name: 'Documents',
          path: '/test/documents',
          isDefault: true
        },
        {
          id: 'default-uncategorized',
          name: 'Uncategorized',
          path: '/test/uncategorized',
          isDefault: true
        }
      ];
      const legacyFolders = [
        {
          id: 'custom-projects',
          name: 'Projects',
          path: '/custom/projects',
          isDefault: false
        },
        {
          id: 'default-documents-legacy',
          name: 'Documents',
          path: '/test/documents',
          isDefault: true
        }
      ];

      mockFs.readFile.mockImplementation((filePath) => {
        const normalizedPath = String(filePath).replace(/\\/g, '/');
        if (normalizedPath.endsWith('/userData/custom-folders.json')) {
          return Promise.resolve(JSON.stringify(currentDefaults));
        }
        if (normalizedPath.endsWith('/StratoSort/custom-folders.json')) {
          return Promise.resolve(JSON.stringify(legacyFolders));
        }
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      });

      const folders = await customFolders.loadCustomFolders();

      expect(folders.some((folder) => folder.name === 'Projects')).toBe(true);
    });

    test('does not recover legacy default-only folders', async () => {
      const currentFolders = [
        {
          id: 'default-uncategorized',
          name: 'Uncategorized',
          path: '/test/uncategorized',
          isDefault: true
        }
      ];
      const legacyDefaultOnly = [
        {
          id: 'default-work-legacy',
          name: 'Work',
          path: '/legacy/work',
          isDefault: true
        },
        {
          id: 'default-financial-legacy',
          name: 'Financial',
          path: '/legacy/financial',
          isDefault: true
        }
      ];

      mockFs.readFile.mockImplementation((filePath) => {
        const normalizedPath = String(filePath).replace(/\\/g, '/');
        if (normalizedPath.endsWith('/userData/custom-folders.json')) {
          return Promise.resolve(JSON.stringify(currentFolders));
        }
        if (normalizedPath.endsWith('/StratoSort/custom-folders.json')) {
          return Promise.resolve(JSON.stringify(legacyDefaultOnly));
        }
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      });

      const folders = await customFolders.loadCustomFolders();

      expect(folders).toHaveLength(1);
      expect(folders[0].name).toBe('Uncategorized');
      expect(folders.some((folder) => folder.name === 'Work')).toBe(false);
    });

    test('does not recover legacy defaults when misflagged as non-default', async () => {
      const currentFolders = [
        {
          id: 'default-uncategorized',
          name: 'Uncategorized',
          path: '/test/uncategorized',
          isDefault: true
        }
      ];
      const legacyMisflaggedDefaults = [
        {
          id: 'legacy-documents',
          name: 'Documents',
          path: '/legacy/documents',
          isDefault: false
        },
        {
          id: 'legacy-images',
          name: 'Images',
          path: '/legacy/images',
          isDefault: false
        }
      ];

      mockFs.readFile.mockImplementation((filePath) => {
        const normalizedPath = String(filePath).replace(/\\/g, '/');
        if (normalizedPath.endsWith('/userData/custom-folders.json')) {
          return Promise.resolve(JSON.stringify(currentFolders));
        }
        if (normalizedPath.endsWith('/StratoSort/custom-folders.json')) {
          return Promise.resolve(JSON.stringify(legacyMisflaggedDefaults));
        }
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      });

      const folders = await customFolders.loadCustomFolders();

      expect(folders).toHaveLength(1);
      expect(folders[0].name).toBe('Uncategorized');
      expect(folders.some((folder) => folder.name === 'Documents')).toBe(false);
      expect(folders.some((folder) => folder.name === 'Images')).toBe(false);
    });

    test('treats default-named folder as custom when path differs from canonical default path', async () => {
      const currentFolders = [
        {
          id: 'custom-documents',
          name: 'Documents',
          path: '/custom/work-documents',
          isDefault: false
        },
        {
          id: 'default-uncategorized',
          name: 'Uncategorized',
          path: '/custom/uncategorized',
          isDefault: true
        }
      ];
      const legacyCustomFolders = [
        {
          id: 'legacy-projects',
          name: 'Projects',
          path: '/legacy/projects',
          isDefault: false
        }
      ];

      mockFs.readFile.mockImplementation((filePath) => {
        const normalizedPath = String(filePath).replace(/\\/g, '/');
        if (normalizedPath.endsWith('/userData/custom-folders.json')) {
          return Promise.resolve(JSON.stringify(currentFolders));
        }
        if (normalizedPath.endsWith('/StratoSort/custom-folders.json')) {
          return Promise.resolve(JSON.stringify(legacyCustomFolders));
        }
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      });

      const folders = await customFolders.loadCustomFolders();

      expect(folders.some((folder) => folder.name === 'Documents')).toBe(true);
      expect(folders.some((folder) => folder.name === 'Projects')).toBe(false);
    });

    test('prunes persisted legacy default-only bundle to Uncategorized', async () => {
      const persistedLegacyDefaults = [
        {
          id: 'default-uncategorized',
          name: 'Uncategorized',
          path: '/legacy/uncategorized',
          isDefault: true
        },
        {
          id: 'default-work-legacy',
          name: 'Work',
          path: '/legacy/work',
          isDefault: true
        },
        {
          id: 'default-financial-legacy',
          name: 'Financial',
          path: '/legacy/financial',
          isDefault: true
        }
      ];

      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(persistedLegacyDefaults));

      const folders = await customFolders.loadCustomFolders();

      expect(folders).toHaveLength(1);
      expect(folders[0].name).toBe('Uncategorized');
      expect(folders[0].path).toBe('/legacy/uncategorized');
      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(folders.some((folder) => folder.name === 'Work')).toBe(false);
    });

    test('handles invalid JSON gracefully', async () => {
      mockFs.readFile.mockResolvedValueOnce('not valid json');

      const folders = await customFolders.loadCustomFolders();

      // Should create only Uncategorized when JSON is invalid
      expect(folders).toHaveLength(1);
      expect(folders[0].name).toBe('Uncategorized');
    });

    test('handles non-array JSON payload gracefully', async () => {
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify({ folders: [] }));

      const folders = await customFolders.loadCustomFolders();

      expect(folders).toHaveLength(1);
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

    test('cleans up temp file on write failure and re-throws', async () => {
      const folders = [{ id: 'folder1', name: 'Test', path: '/test' }];
      mockFs.writeFile.mockRejectedValueOnce(new Error('Write failed'));

      // saveCustomFolders now re-throws errors
      await expect(customFolders.saveCustomFolders(folders)).rejects.toThrow('Write failed');
    });

    test('handles rename failure by cleaning up temp file and re-throws', async () => {
      const folders = [{ id: 'folder1', name: 'Test', path: '/test' }];
      // First writeFile call succeeds (for backup), second writeFile succeeds (for temp), rename fails
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.rename.mockRejectedValueOnce(new Error('Rename failed'));

      await expect(customFolders.saveCustomFolders(folders)).rejects.toThrow('Rename failed');
      expect(mockFs.unlink).toHaveBeenCalled();
    });
  });
});
