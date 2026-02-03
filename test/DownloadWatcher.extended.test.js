const path = require('path');

const { ErrorCategory } = require('../src/shared/errorClassifier');

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    stat: jest.fn(),
    access: jest.fn(),
    mkdir: jest.fn().mockResolvedValue(undefined),
    rename: jest.fn().mockResolvedValue(undefined)
  },
  constants: { R_OK: 4 }
}));

const mockFs = require('fs').promises;

jest.mock('chokidar', () => ({
  watch: jest.fn().mockReturnValue({
    on: jest.fn().mockReturnThis(),
    close: jest.fn(),
    removeAllListeners: jest.fn()
  })
}));

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

jest.mock('../src/shared/config/index', () => ({
  get: jest.fn((key, defaultVal) => defaultVal)
}));

jest.mock('../src/shared/errorClassifier', () => ({
  isNotFoundError: jest.fn(),
  isCrossDeviceError: jest.fn(),
  isExistsError: jest.fn(),
  getErrorCategory: jest.fn(),
  ErrorCategory: {
    FILE_IN_USE: 'FILE_IN_USE',
    NOT_FOUND: 'NOT_FOUND',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    UNKNOWN: 'UNKNOWN'
  }
}));

jest.mock('../src/shared/atomicFileOperations', () => ({
  crossDeviceMove: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../src/main/ipc/analysisUtils', () => ({
  recordAnalysisResult: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../src/main/services/autoOrganize/namingUtils', () => ({
  generateSuggestedNameFromAnalysis: jest.fn()
}));

// Mock fileOperationTracker to prevent infinite loop protection from interfering with tests
jest.mock('../src/shared/fileOperationTracker', () => ({
  getInstance: jest.fn(() => ({
    wasRecentlyOperated: jest.fn().mockReturnValue(false),
    recordOperation: jest.fn(),
    clear: jest.fn(),
    shutdown: jest.fn()
  })),
  FileOperationTracker: jest.fn(),
  DEFAULT_COOLDOWN_MS: 5000
}));

jest.mock('../src/main/errors/FileSystemError', () => ({
  FileSystemError: class FileSystemError extends Error {
    constructor(code, metadata = {}) {
      super(`FileSystemError: ${code}`);
      this.code = code;
      this.metadata = metadata;
      this.isFileSystemError = true;
    }
    getUserFriendlyMessage() {
      return this.message;
    }
    static fromNodeError(err) {
      return new FileSystemError(err.code || 'UNKNOWN');
    }
    static forOperation(op, err) {
      return new FileSystemError(`${op.toUpperCase()}_FAILED`);
    }
  },
  WatcherError: class WatcherError extends Error {
    constructor(path, error) {
      super('WatcherError');
      this.code = 'WATCHER_ERROR';
      this.isFileSystemError = true;
    }
    getUserFriendlyMessage() {
      return 'Watcher error';
    }
    shouldRetry() {
      return false;
    }
    toJSON() {
      return { message: 'Watcher error' };
    }
  }
}));

describe('DownloadWatcher Extended Coverage', () => {
  let DownloadWatcher;
  let watcher;
  let mockDependencies;
  let errorClassifier;
  let analysisUtils;
  let namingUtils;
  let originalSetTimeout;

  beforeEach(() => {
    jest.clearAllMocks();

    mockFs.stat.mockReset();
    mockFs.access.mockReset();
    mockFs.rename.mockReset();
    mockFs.mkdir.mockReset();

    // Setup setTimeout mock for retry logic
    originalSetTimeout = global.setTimeout;
    global.setTimeout = jest.fn((fn, delay) => {
      // Execute immediately for tests unless we want to control it
      if (typeof fn === 'function') fn();
      return { unref: jest.fn() };
    });

    DownloadWatcher = require('../src/main/services/DownloadWatcher');
    errorClassifier = require('../src/shared/errorClassifier');
    analysisUtils = require('../src/main/ipc/analysisUtils');
    namingUtils = require('../src/main/services/autoOrganize/namingUtils');

    mockDependencies = {
      analyzeDocumentFile: jest.fn(),
      analyzeImageFile: jest.fn(),
      getCustomFolders: jest.fn().mockReturnValue([{ id: '1', name: 'Docs', path: '/docs' }]),
      autoOrganizeService: {
        processNewFile: jest.fn()
      },
      settingsService: {
        load: jest.fn().mockResolvedValue({
          autoOrganize: true,
          confidenceThreshold: 0.75,
          namingConvention: 'subject-date'
        })
      },
      notificationService: {
        notifyFileOrganized: jest.fn(),
        notifyLowConfidence: jest.fn()
      },
      analysisHistoryService: {}
    };

    watcher = new DownloadWatcher(mockDependencies);

    // Setup default mock behaviors
    mockFs.stat.mockResolvedValue({
      isDirectory: () => false,
      size: 100,
      birthtime: new Date(),
      mtime: new Date()
    });
    mockFs.access.mockResolvedValue(undefined);
    mockFs.rename.mockResolvedValue(undefined); // Reset rename behavior
    mockFs.mkdir.mockResolvedValue(undefined);

    errorClassifier.isNotFoundError.mockReturnValue(false);
    errorClassifier.isCrossDeviceError.mockReturnValue(false);
    errorClassifier.isExistsError.mockReturnValue(false);
    errorClassifier.getErrorCategory.mockReturnValue('UNKNOWN');
  });

  afterEach(() => {
    global.setTimeout = originalSetTimeout;
  });

  describe('File Validation Edge Cases', () => {
    test('rejects files with .git in path', async () => {
      const filePath = path.join(path.sep, 'downloads', 'project', '.git', 'config');
      const result = await watcher._validateFile(filePath);
      expect(result).toBe(false);
    });

    test('rejects files with node_modules in path', async () => {
      const filePath = path.join(path.sep, 'downloads', 'project', 'node_modules', 'lib.js');
      const result = await watcher._validateFile(filePath);
      expect(result).toBe(false);
    });

    test('rejects empty files', async () => {
      mockFs.stat.mockResolvedValueOnce({ size: 0 });
      const result = await watcher._validateFile('/downloads/empty.txt');
      expect(result).toBe(false);
    });

    test('handles file disappearing during validation (TOCTOU)', async () => {
      // FIX: Now using fs.stat instead of fs.access for atomic existence check
      mockFs.stat.mockRejectedValueOnce(new Error('ENOENT'));
      errorClassifier.isNotFoundError.mockReturnValueOnce(true);

      const result = await watcher._validateFile('/downloads/gone.txt');
      expect(result).toBe(false);
    });

    test('rejects specific temp patterns', async () => {
      const patterns = [
        'file.tmp',
        'file.crdownload',
        'file.part',
        '~$doc.docx',
        '.DS_Store',
        'Thumbs.db'
      ];

      for (const name of patterns) {
        const result = await watcher._validateFile(`/downloads/${name}`);
        expect(result).toBe(false);
      }
    });
  });

  describe('_moveFile Retry Logic', () => {
    test('retries on FILE_IN_USE error and succeeds', async () => {
      // Fail twice with FILE_IN_USE, then succeed
      mockFs.rename
        .mockRejectedValueOnce(new Error('EBUSY'))
        .mockRejectedValueOnce(new Error('EBUSY'))
        .mockResolvedValueOnce(undefined);

      errorClassifier.getErrorCategory
        .mockReturnValueOnce(ErrorCategory.FILE_IN_USE)
        .mockReturnValueOnce(ErrorCategory.FILE_IN_USE);

      await watcher._moveFile('/src', '/dest');

      expect(mockFs.rename).toHaveBeenCalledTimes(3);
    });

    test('gives up after max retries for FILE_IN_USE', async () => {
      mockFs.rename.mockRejectedValue(new Error('EBUSY'));
      errorClassifier.getErrorCategory.mockReturnValue(ErrorCategory.FILE_IN_USE);

      await expect(watcher._moveFile('/src', '/dest')).rejects.toThrow();

      // Initial + 5 retries = 6 calls
      expect(mockFs.rename).toHaveBeenCalledTimes(6);
    });

    test('stops retrying if file disappears', async () => {
      mockFs.rename.mockRejectedValueOnce(new Error('EBUSY'));
      errorClassifier.getErrorCategory.mockReturnValueOnce(ErrorCategory.FILE_IN_USE);

      // FIX: stat check fails with NOT_FOUND (now using fs.stat instead of fs.access)
      // _handleDuplicateMove also performs a stat on destination; reject enough times to
      // ensure the retry check sees the NOT_FOUND error.
      mockFs.stat
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockRejectedValueOnce(new Error('ENOENT'));
      errorClassifier.isNotFoundError.mockReturnValueOnce(true);

      await watcher._moveFile('/src', '/dest');

      expect(mockFs.rename).toHaveBeenCalledTimes(1);
      // Stat called to verify existence before retry
      expect(mockFs.stat).toHaveBeenCalledWith('/src');
    });
  });

  describe('_moveFileWithConflictHandling', () => {
    test('generates unique name if destination exists', async () => {
      // First rename fails with EEXIST (destination occupied)
      mockFs.rename.mockRejectedValueOnce(new Error('EEXIST'));
      errorClassifier.isExistsError.mockReturnValueOnce(true);

      // Second rename (_1 suffix) succeeds
      mockFs.rename.mockResolvedValueOnce(undefined);

      await watcher._moveFileWithConflictHandling('/src/file.txt', '/dest/file.txt', '.txt');

      // Should have tried _1 suffix directly via rename (no fs.access TOCTOU)
      expect(mockFs.rename).toHaveBeenLastCalledWith(
        '/src/file.txt',
        expect.stringContaining('file_1.txt')
      );
    });

    test('increments counter until free name found', async () => {
      // First rename fails with EEXIST
      mockFs.rename.mockRejectedValueOnce(new Error('EEXIST'));
      errorClassifier.isExistsError.mockReturnValueOnce(true);

      // _1 rename fails with EEXIST
      mockFs.rename.mockRejectedValueOnce(new Error('EEXIST'));
      errorClassifier.isExistsError.mockReturnValueOnce(true);
      // _2 rename fails with EEXIST
      mockFs.rename.mockRejectedValueOnce(new Error('EEXIST'));
      errorClassifier.isExistsError.mockReturnValueOnce(true);
      // _3 rename succeeds
      mockFs.rename.mockResolvedValueOnce(undefined);

      await watcher._moveFileWithConflictHandling('/src/file.txt', '/dest/file.txt', '.txt');

      expect(mockFs.rename).toHaveBeenLastCalledWith(
        '/src/file.txt',
        expect.stringContaining('file_3.txt')
      );
    });

    test('falls back to crossDeviceMove on EXDEV', async () => {
      const { crossDeviceMove } = require('../src/shared/atomicFileOperations');
      mockFs.rename.mockRejectedValueOnce(new Error('EXDEV'));
      errorClassifier.isCrossDeviceError.mockReturnValueOnce(true);

      await watcher._moveFileWithConflictHandling('/src', '/dest', '.txt');

      expect(crossDeviceMove).toHaveBeenCalledWith('/src', '/dest', { verify: true });
    });
  });

  describe('Auto-Organize Integration', () => {
    test('records analysis history on success', async () => {
      mockDependencies.autoOrganizeService.processNewFile.mockResolvedValue({
        destination: '/docs/file.txt',
        confidence: 0.9,
        category: 'Docs'
      });

      await watcher._attemptAutoOrganize('/downloads/file.txt');

      expect(analysisUtils.recordAnalysisResult).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: '/docs/file.txt',
          result: expect.objectContaining({
            category: 'Docs',
            confidence: 90
          })
        })
      );
    });

    test('notifies on low confidence', async () => {
      mockDependencies.autoOrganizeService.processNewFile.mockResolvedValue({
        destination: null,
        confidence: 0.5,
        suggestedFolder: 'Docs'
      });

      await watcher._attemptAutoOrganize('/downloads/file.txt');

      expect(mockDependencies.notificationService.notifyLowConfidence).toHaveBeenCalledWith(
        'file.txt',
        50,
        75,
        'Docs'
      );
    });

    test('handles disappearing file before move (TOCTOU)', async () => {
      mockDependencies.autoOrganizeService.processNewFile.mockResolvedValue({
        destination: '/docs/file.txt',
        confidence: 1.0
      });

      // Mock _moveFile to throw NOT_FOUND
      mockFs.rename.mockRejectedValue(new Error('ENOENT'));
      errorClassifier.isNotFoundError.mockReturnValue(true);

      const result = await watcher._attemptAutoOrganize('/downloads/file.txt');

      // Should handle it gracefully
      expect(result.handled).toBe(true);
      expect(result.shouldFallback).toBe(false);
    });
  });

  describe('Directory Verification', () => {
    test('handles stat failure', async () => {
      mockFs.stat.mockRejectedValue(new Error('EACCES'));

      // We need to call _verifyDirectory directly or via start
      // It's private, but accessible in test
      const result = await watcher._verifyDirectory('/downloads');

      expect(result).toBe(false);
      expect(watcher.lastError).toBeDefined();
      expect(require('../src/shared/logger').logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Cannot access downloads directory'),
        expect.anything()
      );
    });

    test('handles non-directory path', async () => {
      mockFs.stat.mockResolvedValue({ isDirectory: () => false });

      const result = await watcher._verifyDirectory('/downloads');

      expect(result).toBe(false);
      expect(require('../src/shared/logger').logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Path is not a directory'),
        expect.anything()
      );
    });
  });

  describe('Watcher Error Handling', () => {
    test('stops watcher on fatal error', () => {
      watcher.restartAttempts = 3;
      watcher.maxRestartAttempts = 3;

      const mockChokidarWatcher = require('chokidar').watch();
      watcher.watcher = mockChokidarWatcher; // Set active watcher

      // Create a non-recoverable error
      const error = new Error('Fatal error');

      watcher._handleWatcherError(error);

      expect(mockChokidarWatcher.close).toHaveBeenCalled();
      expect(watcher.watcher).toBeNull();
    });
  });

  describe('Fallback Organize', () => {
    test('uses naming convention if enabled', async () => {
      mockDependencies.analyzeDocumentFile.mockResolvedValue({
        category: 'Docs',
        summary: 'test doc'
      });

      namingUtils.generateSuggestedNameFromAnalysis.mockReturnValue('NewName.pdf');

      await watcher._fallbackOrganize('/downloads/original.pdf');

      // Should have tried to rename to NewName.pdf
      // _moveFileWithConflictHandling calls fs.rename
      expect(mockFs.rename).toHaveBeenCalledWith(
        '/downloads/original.pdf',
        expect.stringContaining('NewName.pdf')
      );
    });

    test('handles file disappearing during analysis', async () => {
      mockDependencies.analyzeDocumentFile.mockRejectedValue(new Error('ENOENT'));
      errorClassifier.isNotFoundError.mockReturnValue(true);

      await watcher._fallbackOrganize('/downloads/ghost.pdf');

      // Should log debug and return, not error
      // Check logger
      expect(require('../src/shared/logger').logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('File disappeared'),
        expect.any(String)
      );
    });
  });
});
