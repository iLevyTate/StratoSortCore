/**
 * Tests for DownloadWatcher
 * Tests file watching, auto-organization, and error handling
 */

const path = require('path');

// Mock fs
const mockFs = {
  stat: jest.fn(),
  access: jest.fn(),
  mkdir: jest.fn().mockResolvedValue(undefined),
  rename: jest.fn().mockResolvedValue(undefined)
};
jest.mock('fs', () => ({
  promises: mockFs,
  constants: { R_OK: 4 }
}));

// Mock chokidar
const mockWatcher = {
  on: jest.fn().mockReturnThis(),
  close: jest.fn(),
  removeAllListeners: jest.fn()
};
jest.mock('chokidar', () => ({
  watch: jest.fn().mockReturnValue(mockWatcher)
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

// Mock FileSystemError
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
    isRecoverable() {
      return true;
    }
    shouldRetry() {
      return true;
    }
    toJSON() {
      return { code: this.code, message: this.message };
    }
    static fromNodeError(err, metadata) {
      const error = new this('NODE_ERROR', metadata);
      error.originalError = err;
      return error;
    }
    static forOperation(op, err, path) {
      return new this(`${op.toUpperCase()}_FAILED`, { path, operation: op });
    }
  },
  WatcherError: class WatcherError extends Error {
    constructor(path, originalError) {
      super('WatcherError');
      this.path = path;
      this.originalError = originalError;
      this.isFileSystemError = true;
    }
    getUserFriendlyMessage() {
      return 'Watcher error';
    }
    shouldRetry() {
      return true;
    }
    toJSON() {
      return { message: this.message };
    }
  }
}));

// Mock atomicFileOperations
jest.mock('../src/shared/atomicFileOperations', () => ({
  crossDeviceMove: jest.fn().mockResolvedValue(undefined)
}));

describe('DownloadWatcher', () => {
  let DownloadWatcher;
  let chokidar;
  let watcher;
  let mockDependencies;
  let originalSetTimeout;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock setTimeout to return an object with unref method
    originalSetTimeout = global.setTimeout;
    global.setTimeout = jest.fn((fn, delay) => {
      const id = originalSetTimeout(fn, delay);
      // Add unref method to the returned timer ID
      return {
        id,
        unref: jest.fn(),
        [Symbol.toPrimitive]: () => id
      };
    });

    mockFs.stat.mockResolvedValue({ isDirectory: () => true, size: 100 });
    mockFs.access.mockResolvedValue(undefined);

    chokidar = require('chokidar');
    DownloadWatcher = require('../src/main/services/DownloadWatcher');

    mockDependencies = {
      analyzeDocumentFile: jest.fn().mockResolvedValue({
        category: 'Documents',
        suggestedName: 'test-file'
      }),
      analyzeImageFile: jest.fn().mockResolvedValue({
        category: 'Images',
        suggestedName: 'test-image'
      }),
      getCustomFolders: jest.fn().mockReturnValue([
        { id: '1', name: 'Documents', path: '/custom/docs' },
        { id: '2', name: 'Images', path: '/custom/images' }
      ]),
      autoOrganizeService: {
        processNewFile: jest.fn().mockResolvedValue({
          destination: '/custom/docs/test.txt',
          confidence: 0.95
        })
      },
      settingsService: {
        load: jest.fn().mockResolvedValue({
          autoOrganize: true,
          downloadConfidenceThreshold: 0.9
        })
      }
    };

    watcher = new DownloadWatcher(mockDependencies);
  });

  afterEach(() => {
    // Restore original setTimeout
    global.setTimeout = originalSetTimeout;
    jest.clearAllTimers();
  });

  describe('constructor', () => {
    test('initializes with dependencies', () => {
      expect(watcher.analyzeDocumentFile).toBe(mockDependencies.analyzeDocumentFile);
      expect(watcher.analyzeImageFile).toBe(mockDependencies.analyzeImageFile);
      expect(watcher.watcher).toBeNull();
      expect(watcher.isStarting).toBe(false);
    });

    test('initializes tracking sets', () => {
      expect(watcher.processingFiles).toBeInstanceOf(Set);
      expect(watcher.debounceTimers).toBeInstanceOf(Map);
    });
  });

  describe('start', () => {
    test('creates chokidar watcher', async () => {
      watcher.start();

      // Wait for async verification to complete
      await new Promise((r) => originalSetTimeout(r, 100));

      expect(chokidar.watch).toHaveBeenCalledWith(
        expect.stringContaining('Downloads'),
        expect.objectContaining({
          ignoreInitial: true,
          depth: 0
        })
      );
    });

    test('does not start if already running', () => {
      watcher.watcher = mockWatcher;

      watcher.start();

      expect(chokidar.watch).not.toHaveBeenCalled();
    });

    test('does not start if already starting', () => {
      watcher.isStarting = true;

      watcher.start();

      expect(chokidar.watch).not.toHaveBeenCalled();
    });

    test('registers event handlers', async () => {
      watcher.start();

      // Wait for async operations to complete
      await new Promise((r) => originalSetTimeout(r, 100));

      expect(mockWatcher.on).toHaveBeenCalledWith('add', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('ready', expect.any(Function));
    });
  });

  describe('stop', () => {
    test('closes watcher and clears timers', () => {
      watcher.watcher = mockWatcher;
      watcher.debounceTimers.set(
        'test',
        setTimeout(() => {}, 1000)
      );

      watcher.stop();

      expect(mockWatcher.removeAllListeners).toHaveBeenCalled();
      expect(mockWatcher.close).toHaveBeenCalled();
      expect(watcher.watcher).toBeNull();
      expect(watcher.debounceTimers.size).toBe(0);
    });

    test('handles null watcher gracefully', () => {
      watcher.watcher = null;

      expect(() => watcher.stop()).not.toThrow();
    });
  });

  describe('_validateFile', () => {
    test('skips files with no extension', async () => {
      const result = await watcher._validateFile('/downloads/noextension');

      expect(result).toBe(false);
    });

    test('skips temporary files', async () => {
      const tempFiles = [
        '/downloads/file.tmp',
        '/downloads/file.crdownload',
        '/downloads/file.part',
        '/downloads/.hidden'
      ];

      for (const file of tempFiles) {
        const result = await watcher._validateFile(file);
        expect(result).toBe(false);
      }
    });

    test('skips files in .git directory', async () => {
      const result = await watcher._validateFile('/downloads/.git/config');

      expect(result).toBe(false);
    });

    test('skips files in node_modules', async () => {
      // Use path.join to get proper path separators for the current OS
      const filePath = path.join('downloads', 'node_modules', 'package', 'index.js');
      const result = await watcher._validateFile(filePath);

      expect(result).toBe(false);
    });

    test('skips empty files', async () => {
      mockFs.stat.mockResolvedValueOnce({ size: 0 });

      const result = await watcher._validateFile('/downloads/empty.txt');

      expect(result).toBe(false);
    });

    test('skips non-existent files', async () => {
      mockFs.access.mockRejectedValueOnce({ code: 'ENOENT' });

      const result = await watcher._validateFile('/downloads/missing.txt');

      expect(result).toBe(false);
    });

    test('returns true for valid files', async () => {
      const result = await watcher._validateFile('/downloads/document.pdf');

      expect(result).toBe(true);
    });
  });

  describe('_attemptAutoOrganize', () => {
    test('returns handled=true when file is organized', async () => {
      const result = await watcher._attemptAutoOrganize('/downloads/test.pdf');

      expect(result.handled).toBe(true);
      expect(result.shouldFallback).toBe(false);
    });

    test('moves file to destination', async () => {
      await watcher._attemptAutoOrganize('/downloads/test.pdf');

      expect(mockFs.rename).toHaveBeenCalledWith('/downloads/test.pdf', '/custom/docs/test.txt');
    });

    test('returns shouldFallback=true when service unavailable', async () => {
      watcher.autoOrganizeService = null;

      const result = await watcher._attemptAutoOrganize('/downloads/test.pdf');

      expect(result.handled).toBe(false);
      expect(result.shouldFallback).toBe(true);
    });

    test('returns shouldFallback=true on error', async () => {
      mockDependencies.autoOrganizeService.processNewFile.mockRejectedValueOnce(
        new Error('Service failed')
      );

      const result = await watcher._attemptAutoOrganize('/downloads/test.pdf');

      expect(result.handled).toBe(false);
      expect(result.shouldFallback).toBe(true);
    });

    test('handles low confidence results', async () => {
      mockDependencies.autoOrganizeService.processNewFile.mockResolvedValueOnce({
        destination: null,
        confidence: 0.5
      });

      const result = await watcher._attemptAutoOrganize('/downloads/test.pdf');

      expect(result.handled).toBe(true);
      expect(mockFs.rename).not.toHaveBeenCalled();
    });
  });

  describe('_fallbackOrganize', () => {
    test('analyzes document files', async () => {
      await watcher._fallbackOrganize('/downloads/document.pdf');

      expect(mockDependencies.analyzeDocumentFile).toHaveBeenCalledWith(
        '/downloads/document.pdf',
        expect.any(Array)
      );
    });

    test('analyzes image files', async () => {
      await watcher._fallbackOrganize('/downloads/photo.jpg');

      expect(mockDependencies.analyzeImageFile).toHaveBeenCalledWith(
        '/downloads/photo.jpg',
        expect.any(Array)
      );
    });

    test('skips non-existent files', async () => {
      mockFs.access.mockRejectedValueOnce({ code: 'ENOENT' });

      await watcher._fallbackOrganize('/downloads/missing.pdf');

      expect(mockDependencies.analyzeDocumentFile).not.toHaveBeenCalled();
    });

    test('handles analysis errors gracefully', async () => {
      mockDependencies.analyzeDocumentFile.mockRejectedValueOnce(new Error('Analysis failed'));

      await expect(watcher._fallbackOrganize('/downloads/document.pdf')).resolves.toBeUndefined();
    });
  });

  describe('resolveDestinationFolder', () => {
    const folders = [
      { id: '1', name: 'Documents', path: '/docs' },
      { id: '2', name: 'Images', path: '/images' }
    ];

    test('returns folder by smartFolder id', () => {
      const result = { smartFolder: { id: '1' } };

      const folder = watcher.resolveDestinationFolder(result, folders);

      expect(folder.name).toBe('Documents');
    });

    test('returns folder by folderMatchCandidates', () => {
      const result = {
        folderMatchCandidates: [{ id: '2', name: 'Images' }]
      };

      const folder = watcher.resolveDestinationFolder(result, folders);

      expect(folder.name).toBe('Images');
    });

    test('returns folder by category name', () => {
      const result = { category: 'Documents' };

      const folder = watcher.resolveDestinationFolder(result, folders);

      expect(folder.name).toBe('Documents');
    });

    test('returns undefined when no match found', () => {
      const result = { category: 'Unknown' };

      const folder = watcher.resolveDestinationFolder(result, folders);

      expect(folder).toBeUndefined();
    });

    test('returns null for null result', () => {
      const folder = watcher.resolveDestinationFolder(null, folders);

      expect(folder).toBeNull();
    });
  });

  describe('_moveFile', () => {
    test('uses rename for same device', async () => {
      await watcher._moveFile('/source/file.txt', '/dest/file.txt');

      expect(mockFs.rename).toHaveBeenCalledWith('/source/file.txt', '/dest/file.txt');
    });

    test('uses crossDeviceMove for different devices', async () => {
      const { crossDeviceMove } = require('../src/shared/atomicFileOperations');
      const exdevError = new Error('EXDEV');
      exdevError.code = 'EXDEV';
      mockFs.rename.mockRejectedValueOnce(exdevError);

      await watcher._moveFile('/source/file.txt', '/other/file.txt');

      expect(crossDeviceMove).toHaveBeenCalled();
    });
  });

  describe('_moveFileWithConflictHandling', () => {
    test('generates unique name on conflict', async () => {
      const existsError = new Error('EEXIST');
      existsError.code = 'EEXIST';
      mockFs.rename.mockRejectedValueOnce(existsError);
      mockFs.access.mockRejectedValueOnce({ code: 'ENOENT' }); // Check unique name exists

      await watcher._moveFileWithConflictHandling('/source/file.txt', '/dest/file.txt', '.txt');

      expect(mockFs.rename).toHaveBeenLastCalledWith(
        '/source/file.txt',
        expect.stringContaining('file_1.txt')
      );
    });
  });

  describe('_debouncedHandleFile', () => {
    test('debounces rapid file events', async () => {
      const handleFileSpy = jest.spyOn(watcher, 'handleFile').mockResolvedValue();

      watcher._debouncedHandleFile('/test/file.txt');
      watcher._debouncedHandleFile('/test/file.txt');
      watcher._debouncedHandleFile('/test/file.txt');

      expect(watcher.debounceTimers.size).toBe(1);

      // Wait for debounce to complete
      await new Promise((r) => originalSetTimeout(r, watcher.debounceDelay + 100));

      expect(handleFileSpy).toHaveBeenCalledTimes(1);
    });

    test('tracks files being processed', async () => {
      let checkedProcessing = false;
      jest.spyOn(watcher, 'handleFile').mockImplementation(async () => {
        checkedProcessing = watcher.processingFiles.has('/test/file.txt');
      });

      watcher._debouncedHandleFile('/test/file.txt');

      // Wait for debounce and file processing
      await new Promise((r) => originalSetTimeout(r, watcher.debounceDelay + 100));

      expect(checkedProcessing).toBe(true);
    });
  });

  describe('getStatus', () => {
    test('returns current status', () => {
      const status = watcher.getStatus();

      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('isStarting');
      expect(status).toHaveProperty('restartAttempts');
      expect(status).toHaveProperty('processingCount');
    });
  });

  describe('restart', () => {
    test('resets state and restarts', () => {
      watcher.restartAttempts = 2;
      watcher.lastError = new Error('test');
      watcher.watcher = mockWatcher;

      watcher.restart();

      expect(watcher.restartAttempts).toBe(0);
      expect(watcher.lastError).toBeNull();
    });
  });

  describe('_handleWatcherError', () => {
    test('increments restart attempts on recoverable error', () => {
      watcher.watcher = mockWatcher;
      watcher.restartAttempts = 0;

      // Mock WatcherError to control shouldRetry
      const mockError = {
        isFileSystemError: true,
        code: 'WATCHER_FAILED',
        getUserFriendlyMessage: () => 'Watcher error',
        shouldRetry: () => true,
        toJSON: () => ({ message: 'test' })
      };

      // Prevent actual restart by maxing out attempts
      watcher.maxRestartAttempts = 1;
      watcher._handleWatcherError(mockError);

      expect(watcher.restartAttempts).toBe(1);
    });

    test('stops when max restart attempts reached', () => {
      watcher.watcher = mockWatcher;
      watcher.restartAttempts = 3;
      watcher.maxRestartAttempts = 3;

      const mockError = {
        isFileSystemError: true,
        code: 'WATCHER_FAILED',
        getUserFriendlyMessage: () => 'Watcher error',
        shouldRetry: () => true,
        toJSON: () => ({ message: 'test' })
      };

      watcher._handleWatcherError(mockError);

      // Should have stopped the watcher
      expect(watcher.watcher).toBeNull();
    });
  });
});
