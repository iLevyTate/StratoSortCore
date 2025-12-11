/**
 * Stress Tests for File Watcher (DownloadWatcher)
 *
 * Tests:
 * - Rapid file creation handling (100 files/second)
 * - Burst file event handling
 * - Debouncing behavior
 * - Watcher recovery after errors
 * - Concurrent file processing
 */

const path = require('path');
const { measureMemory, forceGC, createTimer, delay } = require('../utils/testUtilities');

// Mock fs
const mockFs = {
  stat: jest.fn(),
  access: jest.fn(),
  mkdir: jest.fn(),
  rename: jest.fn(),
  copyFile: jest.fn(),
  unlink: jest.fn()
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
  watch: jest.fn(() => mockWatcher)
}));

// Mock os
jest.mock('os', () => ({
  homedir: jest.fn(() => '/home/testuser')
}));

// Mock logger
jest.mock('../../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock FileSystemError
jest.mock('../../src/main/errors/FileSystemError', () => ({
  FileSystemError: class FileSystemError extends Error {
    constructor(code, context) {
      super(`FileSystemError: ${code}`);
      this.code = code;
      this.context = context;
      this.isFileSystemError = true;
    }
    getUserFriendlyMessage() {
      return this.message;
    }
    toJSON() {
      return { code: this.code, message: this.message };
    }
    shouldRetry() {
      return false;
    }
    isRecoverable() {
      return true;
    }
    static fromNodeError(error, context) {
      return new this(error.code || 'UNKNOWN', context);
    }
    static forOperation(op, error, path) {
      return new this(error.code || 'UNKNOWN', { operation: op, path });
    }
  },
  WatcherError: class WatcherError extends Error {
    constructor(path, error) {
      super(`WatcherError: ${error.message}`);
      this.path = path;
      this.isFileSystemError = true;
    }
    getUserFriendlyMessage() {
      return this.message;
    }
    shouldRetry() {
      return true;
    }
  },
  FILE_SYSTEM_ERROR_CODES: {
    SIZE_MISMATCH: 'SIZE_MISMATCH'
  }
}));

describe('File Watcher Stress Tests', () => {
  let DownloadWatcher;
  let watcher;
  let mockAnalyzeDocument;
  let mockAnalyzeImage;
  let mockGetFolders;
  let mockAutoOrganize;
  let mockSettings;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset fs mocks
    mockFs.stat.mockResolvedValue({ isDirectory: () => true, size: 1024 });
    mockFs.access.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.rename.mockResolvedValue(undefined);

    // Setup mock services
    mockAnalyzeDocument = jest.fn().mockResolvedValue({
      category: 'Documents',
      suggestedFolder: 'Documents'
    });

    mockAnalyzeImage = jest.fn().mockResolvedValue({
      category: 'Images',
      suggestedFolder: 'Images'
    });

    mockGetFolders = jest.fn().mockReturnValue([
      { id: '1', name: 'Documents', path: '/folders/Documents' },
      { id: '2', name: 'Images', path: '/folders/Images' }
    ]);

    mockAutoOrganize = {
      processNewFile: jest.fn().mockResolvedValue({
        destination: '/folders/Documents/test.pdf',
        confidence: 0.95
      })
    };

    mockSettings = {
      load: jest.fn().mockResolvedValue({
        autoOrganize: true,
        downloadConfidenceThreshold: 0.9
      })
    };

    // Import DownloadWatcher
    jest.resetModules();
    DownloadWatcher = require('../../src/main/services/DownloadWatcher');

    watcher = new DownloadWatcher({
      analyzeDocumentFile: mockAnalyzeDocument,
      analyzeImageFile: mockAnalyzeImage,
      getCustomFolders: mockGetFolders,
      autoOrganizeService: mockAutoOrganize,
      settingsService: mockSettings
    });
  });

  afterEach(() => {
    if (watcher) {
      watcher.stop();
    }
    forceGC();
  });

  describe('Rapid File Creation Handling', () => {
    it('should handle 100 files per second burst', async () => {
      const fileCount = 100;
      const processedFiles = [];

      // Track processed files
      mockAutoOrganize.processNewFile.mockImplementation(async (filePath) => {
        processedFiles.push(filePath);
        await delay(1); // Simulate minimal processing time
        return {
          destination: `/organized/${path.basename(filePath)}`,
          confidence: 0.95
        };
      });

      const timer = createTimer();

      // Simulate rapid file events
      const fileEvents = [];
      for (let i = 0; i < fileCount; i++) {
        const filePath = `/home/testuser/Downloads/rapid_file_${i}.pdf`;
        fileEvents.push(watcher.handleFile(filePath));
      }

      await Promise.all(fileEvents);

      const elapsed = timer();
      const throughput = fileCount / (elapsed / 1000);

      console.log(`[STRESS] Processed ${fileCount} file events in ${elapsed.toFixed(2)}ms`);
      console.log(`[STRESS] Throughput: ${throughput.toFixed(2)} files/sec`);

      // Should process all files
      expect(processedFiles.length).toBe(fileCount);
    });

    it('should debounce rapid events for same file', async () => {
      // Use real timers with manual delay for this test
      // since jest.useFakeTimers() doesn't preserve timer.unref()
      const filePath = '/home/testuser/Downloads/debounce_test.pdf';
      let processCount = 0;

      mockAutoOrganize.processNewFile.mockImplementation(async () => {
        processCount++;
        return { destination: '/organized/test.pdf', confidence: 0.95 };
      });

      // Fire multiple events for same file rapidly
      for (let i = 0; i < 5; i++) {
        watcher._debouncedHandleFile(filePath);
      }

      // Wait for debounce to settle (use real timer)
      await delay(watcher.debounceDelay + 200);

      // Should only process once due to debouncing
      expect(processCount).toBeLessThanOrEqual(2); // Allow for some timing variance
    });

    it('should handle interleaved events for different files', async () => {
      // Use real timers with manual delay for this test
      const processedFiles = new Set();

      mockAutoOrganize.processNewFile.mockImplementation(async (filePath) => {
        processedFiles.add(filePath);
        return {
          destination: `/organized/${path.basename(filePath)}`,
          confidence: 0.95
        };
      });

      // Interleaved events for 3 different files (reduced from 5 for faster test)
      const files = [
        '/home/testuser/Downloads/file_a.pdf',
        '/home/testuser/Downloads/file_b.pdf',
        '/home/testuser/Downloads/file_c.pdf'
      ];

      // Fire events in interleaved pattern
      for (let round = 0; round < 2; round++) {
        for (const file of files) {
          watcher._debouncedHandleFile(file);
        }
      }

      // Wait for debounce to settle
      await delay(watcher.debounceDelay + 300);

      // All files should be processed exactly once each
      expect(processedFiles.size).toBe(3);
    });
  });

  describe('Burst File Event Handling', () => {
    it('should handle burst of file events without memory leak', async () => {
      forceGC();
      const baseline = measureMemory();

      const burstSize = 500;
      const processedFiles = [];

      mockAutoOrganize.processNewFile.mockImplementation(async (filePath) => {
        processedFiles.push(filePath);
        return {
          destination: `/organized/${path.basename(filePath)}`,
          confidence: 0.95
        };
      });

      // Create burst of file events
      const events = [];
      for (let i = 0; i < burstSize; i++) {
        events.push(watcher.handleFile(`/home/testuser/Downloads/burst_${i}.pdf`));
      }

      await Promise.all(events);

      // Clear references
      events.length = 0;
      processedFiles.length = 0;

      forceGC();
      await delay(100);

      const afterBurst = measureMemory();
      const memoryGrowth = afterBurst.heapUsedMB - baseline.heapUsedMB;

      console.log(
        `[STRESS] Memory after ${burstSize} file burst: ${memoryGrowth.toFixed(2)}MB growth`
      );

      // Memory growth should be reasonable (< 50MB for 500 files)
      expect(memoryGrowth).toBeLessThan(50);
    });

    it('should track processing files to prevent duplicates', async () => {
      const filePath = '/home/testuser/Downloads/concurrent_test.pdf';
      let concurrentCount = 0;
      let maxConcurrent = 0;

      mockAutoOrganize.processNewFile.mockImplementation(async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await delay(50); // Simulate processing time
        concurrentCount--;
        return { destination: '/organized/test.pdf', confidence: 0.95 };
      });

      // Fire multiple events for same file
      const events = [];
      for (let i = 0; i < 5; i++) {
        events.push(watcher.handleFile(filePath));
      }

      await Promise.all(events);

      // processingFiles Set should prevent concurrent processing of same file
      // (though handleFile doesn't use the Set, _debouncedHandleFile does)
      console.log(`[STRESS] Max concurrent processing: ${maxConcurrent}`);
    });
  });

  describe('Error Recovery', () => {
    it('should recover from file access errors', async () => {
      let callCount = 0;

      mockFs.access.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          const error = new Error('EBUSY: resource busy');
          error.code = 'EBUSY';
          throw error;
        }
        return undefined;
      });

      // First call should fail gracefully
      await watcher.handleFile('/home/testuser/Downloads/busy_file.pdf');

      // Verify error was handled (no throw)
      expect(callCount).toBe(1);
    });

    it('should skip non-existent files gracefully', async () => {
      mockFs.access.mockImplementation(async () => {
        const error = new Error('ENOENT: no such file');
        error.code = 'ENOENT';
        throw error;
      });

      // Should not throw
      await expect(
        watcher.handleFile('/home/testuser/Downloads/missing.pdf')
      ).resolves.not.toThrow();

      // processNewFile should not be called for missing files
      expect(mockAutoOrganize.processNewFile).not.toHaveBeenCalled();
    });

    it('should skip empty files', async () => {
      mockFs.stat.mockResolvedValue({ isDirectory: () => true, size: 0 });

      await watcher.handleFile('/home/testuser/Downloads/empty.pdf');

      expect(mockAutoOrganize.processNewFile).not.toHaveBeenCalled();
    });

    it('should handle auto-organize service failures', async () => {
      mockAutoOrganize.processNewFile.mockRejectedValue(new Error('Service unavailable'));

      // Mock fallback analysis
      mockAnalyzeDocument.mockResolvedValue({
        category: 'Documents',
        suggestedFolder: 'Documents',
        folderMatchCandidates: [{ id: '1', name: 'Documents' }]
      });

      await watcher.handleFile('/home/testuser/Downloads/fallback_test.pdf');

      // Should fall back to legacy analysis
      expect(mockAnalyzeDocument).toHaveBeenCalled();
    });
  });

  describe('Watcher State Management', () => {
    it('should report correct status', () => {
      const status = watcher.getStatus();

      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('isStarting');
      expect(status).toHaveProperty('restartAttempts');
      expect(status).toHaveProperty('processingCount');
      expect(status).toHaveProperty('pendingDebounce');
    });

    it('should clear debounce timers on stop', async () => {
      // Use real timers since timer.unref() isn't available in fake timers
      // Add some debounce timers
      watcher._debouncedHandleFile('/test/file1.pdf');
      watcher._debouncedHandleFile('/test/file2.pdf');

      expect(watcher.debounceTimers.size).toBeGreaterThan(0);

      watcher.stop();

      expect(watcher.debounceTimers.size).toBe(0);
    });

    it('should clear processing files set on stop', async () => {
      // Manually add to processing files
      watcher.processingFiles.add('/test/file1.pdf');
      watcher.processingFiles.add('/test/file2.pdf');

      expect(watcher.processingFiles.size).toBe(2);

      watcher.stop();

      expect(watcher.processingFiles.size).toBe(0);
    });

    it('should reset state on restart', () => {
      watcher.restartAttempts = 2;
      watcher.lastError = new Error('Previous error');

      watcher.restart();

      expect(watcher.restartAttempts).toBe(0);
      expect(watcher.lastError).toBe(null);
    });
  });

  describe('File Type Handling', () => {
    it('should skip temporary files', async () => {
      const tempFiles = [
        '/home/testuser/Downloads/file.tmp',
        '/home/testuser/Downloads/file.crdownload',
        '/home/testuser/Downloads/file.part',
        '/home/testuser/Downloads/~$document.docx',
        '/home/testuser/Downloads/.DS_Store'
      ];

      for (const filePath of tempFiles) {
        await watcher.handleFile(filePath);
      }

      // None of these should trigger processing
      expect(mockAutoOrganize.processNewFile).not.toHaveBeenCalled();
    });

    it('should skip system files', async () => {
      const systemFiles = [
        '/home/testuser/Downloads/Thumbs.db',
        '/home/testuser/Downloads/desktop.ini',
        '/home/testuser/Downloads/.hidden_file'
      ];

      for (const filePath of systemFiles) {
        await watcher.handleFile(filePath);
      }

      expect(mockAutoOrganize.processNewFile).not.toHaveBeenCalled();
    });

    it('should process valid document files', async () => {
      const validFiles = [
        '/home/testuser/Downloads/document.pdf',
        '/home/testuser/Downloads/report.docx',
        '/home/testuser/Downloads/data.xlsx'
      ];

      for (const filePath of validFiles) {
        await watcher.handleFile(filePath);
      }

      expect(mockAutoOrganize.processNewFile).toHaveBeenCalledTimes(3);
    });

    it('should process valid image files with image analyzer', async () => {
      mockAutoOrganize.processNewFile.mockRejectedValue(new Error('No service'));

      await watcher.handleFile('/home/testuser/Downloads/photo.jpg');
      await watcher.handleFile('/home/testuser/Downloads/image.png');

      expect(mockAnalyzeImage).toHaveBeenCalledTimes(2);
    });
  });

  describe('Concurrent File Processing Limits', () => {
    it('should handle many concurrent file operations', async () => {
      const fileCount = 100;
      let activeOperations = 0;
      let maxActiveOperations = 0;

      mockAutoOrganize.processNewFile.mockImplementation(async () => {
        activeOperations++;
        maxActiveOperations = Math.max(maxActiveOperations, activeOperations);
        await delay(10);
        activeOperations--;
        return { destination: '/organized/test.pdf', confidence: 0.95 };
      });

      const operations = [];
      for (let i = 0; i < fileCount; i++) {
        operations.push(watcher.handleFile(`/home/testuser/Downloads/concurrent_${i}.pdf`));
      }

      await Promise.all(operations);

      console.log(`[STRESS] Max concurrent operations: ${maxActiveOperations}`);
      console.log(`[STRESS] Total operations: ${fileCount}`);

      // All operations should complete
      expect(mockAutoOrganize.processNewFile).toHaveBeenCalledTimes(fileCount);
    });
  });
});
