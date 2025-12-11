/**
 * Tests for AutoOrganize Folder Operations
 * Tests folder creation, path building, and fallback destination logic
 */

const path = require('path');

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/mock/documents')
  }
}));

// Mock fs
const mockFs = {
  mkdir: jest.fn().mockResolvedValue(undefined),
  lstat: jest.fn()
};
jest.mock('fs', () => ({
  promises: mockFs
}));

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

describe('AutoOrganize Folder Operations', () => {
  let isUNCPath;
  let createDefaultFolder;
  let getFallbackDestination;
  let buildDestinationPath;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Reset fs mock
    mockFs.lstat.mockRejectedValue({ code: 'ENOENT' });
    mockFs.mkdir.mockResolvedValue(undefined);

    const module = require('../src/main/services/autoOrganize/folderOperations');
    isUNCPath = module.isUNCPath;
    createDefaultFolder = module.createDefaultFolder;
    getFallbackDestination = module.getFallbackDestination;
    buildDestinationPath = module.buildDestinationPath;
  });

  describe('isUNCPath', () => {
    test('returns true for Windows UNC path', () => {
      expect(isUNCPath('\\\\server\\share')).toBe(true);
    });

    test('returns true for forward slash UNC path', () => {
      expect(isUNCPath('//server/share')).toBe(true);
    });

    test('returns false for regular Windows path', () => {
      expect(isUNCPath('C:\\Users\\Documents')).toBe(false);
    });

    test('returns false for Unix path', () => {
      expect(isUNCPath('/home/user/documents')).toBe(false);
    });

    test('returns false for null', () => {
      expect(isUNCPath(null)).toBe(false);
    });

    test('returns false for empty string', () => {
      expect(isUNCPath('')).toBe(false);
    });

    test('returns false for non-string', () => {
      expect(isUNCPath(123)).toBe(false);
    });
  });

  describe('createDefaultFolder', () => {
    test('creates emergency default folder', async () => {
      const smartFolders = [];

      const result = await createDefaultFolder(smartFolders);

      expect(result).toBeDefined();
      expect(result.name).toBe('Uncategorized');
      expect(result.isDefault).toBe(true);
      expect(smartFolders).toHaveLength(1);
    });

    test('reuses existing folder if already exists', async () => {
      mockFs.lstat.mockResolvedValueOnce({
        isDirectory: () => true,
        isSymbolicLink: () => false
      });

      const smartFolders = [];

      const result = await createDefaultFolder(smartFolders);

      expect(result).toBeDefined();
      expect(mockFs.mkdir).not.toHaveBeenCalled();
    });

    test('rejects symbolic links for security', async () => {
      mockFs.lstat.mockResolvedValueOnce({
        isDirectory: () => false,
        isSymbolicLink: () => true
      });

      const smartFolders = [];

      const result = await createDefaultFolder(smartFolders);

      expect(result).toBeNull();
    });

    test('returns null on error', async () => {
      mockFs.mkdir.mockRejectedValueOnce(new Error('Permission denied'));

      const smartFolders = [];

      const result = await createDefaultFolder(smartFolders);

      expect(result).toBeNull();
    });
  });

  describe('getFallbackDestination', () => {
    test('matches smart folder by file type', () => {
      const file = { name: 'photo.jpg', extension: 'jpg' };
      const smartFolders = [
        { name: 'Images', path: '/docs/Images' },
        { name: 'Documents', path: '/docs/Documents' }
      ];

      const result = getFallbackDestination(file, smartFolders, '/default');

      expect(result).toContain('Images');
      expect(result).toContain('photo.jpg');
    });

    test('uses analysis category if available', () => {
      const file = {
        name: 'report.pdf',
        extension: 'pdf',
        analysis: { category: 'Reports' }
      };
      const smartFolders = [{ name: 'Reports', path: '/docs/Reports' }];

      const result = getFallbackDestination(file, smartFolders, '/default');

      expect(result).toContain('Reports');
    });

    test('creates new folder path from category', () => {
      const file = {
        name: 'report.pdf',
        extension: 'pdf',
        analysis: { category: 'SpecialReports' }
      };
      const smartFolders = [];

      const result = getFallbackDestination(file, smartFolders, '/default');

      expect(result).toContain('SpecialReports');
      expect(result).toContain('report.pdf');
    });

    test('falls back to file type folder', () => {
      const file = { name: 'file.xyz', extension: 'xyz' };
      const smartFolders = [];

      const result = getFallbackDestination(file, smartFolders, '/default');

      expect(result).toContain('Files'); // Unknown type category
    });
  });

  describe('buildDestinationPath', () => {
    test('builds path from suggestion path', () => {
      const file = { name: 'doc.pdf' };
      const suggestion = { path: '/target/folder' };

      const result = buildDestinationPath(file, suggestion, '/default', false);

      expect(result).toBe(path.join('/target/folder', 'doc.pdf'));
    });

    test('builds path from folder name when no path', () => {
      const file = { name: 'doc.pdf' };
      const suggestion = { folder: 'Documents' };

      const result = buildDestinationPath(file, suggestion, '/default', false);

      expect(result).toBe(path.join('/default', 'Documents', 'doc.pdf'));
    });

    test('preserves original name when preserveNames is true', () => {
      const file = {
        name: 'original.pdf',
        analysis: { suggestedName: 'better_name.pdf' }
      };
      const suggestion = { folder: 'Docs' };

      const result = buildDestinationPath(file, suggestion, '/default', true);

      expect(result).toContain('original.pdf');
      expect(result).not.toContain('better_name.pdf');
    });

    test('uses suggested name when preserveNames is false', () => {
      const file = {
        name: 'original.pdf',
        analysis: { suggestedName: 'better_name.pdf' }
      };
      const suggestion = { folder: 'Docs' };

      const result = buildDestinationPath(file, suggestion, '/default', false);

      expect(result).toContain('better_name.pdf');
    });

    test('falls back to original name when no suggested name', () => {
      const file = {
        name: 'original.pdf',
        analysis: {}
      };
      const suggestion = { folder: 'Docs' };

      const result = buildDestinationPath(file, suggestion, '/default', false);

      expect(result).toContain('original.pdf');
    });
  });
});
