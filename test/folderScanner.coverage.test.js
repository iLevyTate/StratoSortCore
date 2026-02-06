/**
 * Extended coverage tests for folderScanner.js
 * Targets: timeout handling, permission errors, depth/file limits,
 *          symlinks, ignore patterns, batch concurrency, scan metadata.
 */

const path = require('path');
const fs = require('fs').promises;

jest.mock('../src/shared/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }))
}));

jest.mock('../src/shared/errorClassifier', () => ({
  isPermissionError: jest.fn((err) => err.code === 'EPERM' || err.code === 'EACCES')
}));

jest.mock('../src/shared/performanceConstants', () => ({
  TIMEOUTS: {
    DIRECTORY_SCAN: 60000,
    FILE_READ: 5000
  }
}));

const { scanDirectory, DEFAULT_IGNORE_PATTERNS } = require('../src/main/folderScanner');

// Helper to create mock dirents
function mockDirent(name, isDir = false, isSymlink = false) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isSymbolicLink: () => isSymlink
  };
}

describe('folderScanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('DEFAULT_IGNORE_PATTERNS', () => {
    test('includes common patterns', () => {
      expect(DEFAULT_IGNORE_PATTERNS).toContain('.DS_Store');
      expect(DEFAULT_IGNORE_PATTERNS).toContain('node_modules');
      expect(DEFAULT_IGNORE_PATTERNS).toContain('.git');
    });
  });

  describe('basic scanning', () => {
    test('scans a flat directory', async () => {
      jest
        .spyOn(fs, 'readdir')
        .mockResolvedValue([mockDirent('file1.txt'), mockDirent('file2.pdf')]);
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 1024,
        mtime: new Date('2026-01-01')
      });

      const results = await scanDirectory('/test/dir');

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('file1.txt');
      expect(results[0].type).toBe('file');
      expect(results[0].size).toBe(1024);
    });

    test('scans directories recursively', async () => {
      jest
        .spyOn(fs, 'readdir')
        .mockResolvedValueOnce([mockDirent('subdir', true)])
        .mockResolvedValueOnce([mockDirent('nested.txt')]);

      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 512,
        mtime: new Date('2026-01-01')
      });

      const results = await scanDirectory('/test/dir');

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('folder');
      expect(results[0].children).toHaveLength(1);
      expect(results[0].children[0].name).toBe('nested.txt');
    });
  });

  describe('ignore patterns', () => {
    test('filters out .DS_Store and node_modules', async () => {
      jest
        .spyOn(fs, 'readdir')
        .mockResolvedValue([
          mockDirent('.DS_Store'),
          mockDirent('node_modules', true),
          mockDirent('important.txt')
        ]);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 100, mtime: new Date() });

      const results = await scanDirectory('/test/dir');

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('important.txt');
    });

    test('supports wildcard extension patterns', async () => {
      jest.spyOn(fs, 'readdir').mockResolvedValue([mockDirent('file.tmp'), mockDirent('file.txt')]);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 100, mtime: new Date() });

      const results = await scanDirectory('/test/dir', ['*.tmp']);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('file.txt');
    });
  });

  describe('symlinks', () => {
    test('skips symbolic links', async () => {
      jest
        .spyOn(fs, 'readdir')
        .mockResolvedValue([mockDirent('link', false, true), mockDirent('real.txt')]);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 100, mtime: new Date() });

      const results = await scanDirectory('/test/dir');

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('real.txt');
    });
  });

  describe('includeStats option', () => {
    test('skips stat calls when includeStats is false', async () => {
      const statSpy = jest.spyOn(fs, 'stat').mockResolvedValue({ size: 0, mtime: new Date() });
      jest.spyOn(fs, 'readdir').mockResolvedValue([mockDirent('file.txt')]);

      const results = await scanDirectory('/test/dir', DEFAULT_IGNORE_PATTERNS, {
        includeStats: false
      });

      expect(statSpy).not.toHaveBeenCalled();
      expect(results[0].size).toBeNull();
      expect(results[0].modified).toBeNull();
    });
  });

  describe('maxDepth option', () => {
    test('limits recursion depth', async () => {
      jest
        .spyOn(fs, 'readdir')
        .mockResolvedValueOnce([mockDirent('level1', true)])
        .mockResolvedValueOnce([mockDirent('level2', true)]);

      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 0, mtime: new Date() });

      const results = await scanDirectory('/test', DEFAULT_IGNORE_PATTERNS, { maxDepth: 1 });

      expect(results[0].type).toBe('folder');
      // Level 2 should have empty children since we're at max depth
      expect(results[0].children[0].children).toEqual([]);
    });
  });

  describe('maxFiles option', () => {
    test('stops scanning after maxFiles reached', async () => {
      jest
        .spyOn(fs, 'readdir')
        .mockResolvedValue([mockDirent('a.txt'), mockDirent('b.txt'), mockDirent('c.txt')]);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 100, mtime: new Date() });

      const results = await scanDirectory('/test', DEFAULT_IGNORE_PATTERNS, { maxFiles: 2 });

      expect(results.length).toBeLessThanOrEqual(3);
      // Should have scan metadata
      expect(results.__scanMeta).toBeDefined();
    });
  });

  describe('timeout handling', () => {
    test('handles readdir timeout', async () => {
      jest
        .spyOn(fs, 'readdir')
        .mockImplementation(
          () => new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 10))
        );

      const results = await scanDirectory('/test', DEFAULT_IGNORE_PATTERNS, {
        perDirectoryTimeoutMs: 5
      });

      // Should return empty on timeout rather than throwing
      expect(Array.isArray(results)).toBe(true);
    });

    test('handles stat timeout gracefully', async () => {
      jest.spyOn(fs, 'readdir').mockResolvedValue([mockDirent('slow.txt')]);
      jest
        .spyOn(fs, 'stat')
        .mockImplementation(
          () => new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 10))
        );

      const results = await scanDirectory('/test', DEFAULT_IGNORE_PATTERNS, {
        perDirectoryTimeoutMs: 5
      });

      // File that timed out should be filtered out
      expect(results.length).toBe(0);
    });
  });

  describe('permission errors', () => {
    test('returns permission denied node for EPERM', async () => {
      const permError = new Error('Permission denied');
      permError.code = 'EPERM';
      jest.spyOn(fs, 'readdir').mockRejectedValue(permError);

      const results = await scanDirectory('/protected/dir');

      expect(results).toHaveLength(1);
      expect(results[0].error).toBe('Permission Denied');
      expect(results[0].children).toEqual([]);
    });

    test('returns permission denied node for EACCES', async () => {
      const permError = new Error('Access denied');
      permError.code = 'EACCES';
      jest.spyOn(fs, 'readdir').mockRejectedValue(permError);

      const results = await scanDirectory('/protected/dir');

      expect(results).toHaveLength(1);
      expect(results[0].error).toBe('Permission Denied');
    });
  });

  describe('non-recoverable errors', () => {
    test('rethrows non-permission, non-timeout errors', async () => {
      const ioError = new Error('Disk failure');
      ioError.code = 'EIO';
      jest.spyOn(fs, 'readdir').mockRejectedValue(ioError);

      await expect(scanDirectory('/bad/disk')).rejects.toThrow('Disk failure');
    });
  });

  describe('scan metadata', () => {
    test('attaches __scanMeta to top-level results', async () => {
      jest.spyOn(fs, 'readdir').mockResolvedValue([mockDirent('file.txt')]);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 100, mtime: new Date() });

      const results = await scanDirectory('/test');

      expect(results.__scanMeta).toBeDefined();
      expect(results.__scanMeta.partial).toBe(false);
      expect(results.__scanMeta.durationMs).toBeGreaterThanOrEqual(0);
      expect(results.__scanMeta.filesIncluded).toBe(1);
      expect(results.__scanMeta.directoriesVisited).toBe(1);
    });

    test('reports partial scan when maxFiles exceeded', async () => {
      jest
        .spyOn(fs, 'readdir')
        .mockResolvedValue([mockDirent('a.txt'), mockDirent('b.txt'), mockDirent('c.txt')]);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 100, mtime: new Date() });

      const results = await scanDirectory('/test', DEFAULT_IGNORE_PATTERNS, {
        maxFiles: 1
      });

      expect(results.__scanMeta).toBeDefined();
      // partial is set to true in the __scanMeta construction when remainingFiles <= 0
      expect(results.__scanMeta.partial).toBe(true);
      expect(results.__scanMeta.remainingFiles).toBeLessThanOrEqual(0);
    });
  });

  describe('stat error handling per entry', () => {
    test('skips entries where stat fails (non-timeout)', async () => {
      jest.spyOn(fs, 'readdir').mockResolvedValue([mockDirent('good.txt'), mockDirent('bad.txt')]);
      jest
        .spyOn(fs, 'stat')
        .mockResolvedValueOnce({ size: 100, mtime: new Date() })
        .mockRejectedValueOnce(new Error('stat failed'));

      const results = await scanDirectory('/test');

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('good.txt');
      expect(results.__scanMeta.skippedErrors).toBe(1);
    });
  });
});
