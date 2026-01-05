const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const {
  safeReadFile,
  safeWriteFile,
  ensureDirectory,
  processBatch,
  watchPath,
  moveFile,
  safeDelete,
  FileSystemError,
  WatcherError
} = require('../src/main/utils/asyncFileOps');

// Mock dependencies
jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs');
  return {
    ...originalFs,
    promises: {
      readFile: jest.fn(),
      writeFile: jest.fn(),
      rename: jest.fn(),
      unlink: jest.fn(),
      mkdir: jest.fn(),
      stat: jest.fn(),
      access: jest.fn(),
      copyFile: jest.fn(),
      readdir: jest.fn(),
      rmdir: jest.fn()
    },
    watch: jest.fn()
  };
});

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../src/shared/atomicFileOperations', () => ({
  crossDeviceMove: jest.fn()
}));

const { crossDeviceMove } = require('../src/shared/atomicFileOperations');

describe('asyncFileOps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('safeReadFile', () => {
    test('reads file successfully', async () => {
      fs.readFile.mockResolvedValue('content');
      const result = await safeReadFile('test.txt');
      expect(result.data).toBe('content');
      expect(result.error).toBeNull();
    });

    test('handles read error', async () => {
      const error = new Error('read failed');
      error.code = 'EACCES';
      fs.readFile.mockRejectedValue(error);

      const result = await safeReadFile('test.txt');
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(FileSystemError);
      expect(result.error.code).toBe('FILE_ACCESS_DENIED');
    });

    test('handles ENOENT silently (warning only)', async () => {
      const error = new Error('not found');
      error.code = 'ENOENT';
      fs.readFile.mockRejectedValue(error);

      await safeReadFile('test.txt');
      // Should not log warning for ENOENT based on implementation
      const { logger } = require('../src/shared/logger');
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('safeWriteFile', () => {
    test('writes file atomically (write -> stat -> rename)', async () => {
      fs.mkdir.mockResolvedValue(); // ensureDirectory
      fs.writeFile.mockResolvedValue();
      fs.stat.mockResolvedValue({ size: 4 }); // "test" is 4 bytes
      fs.rename.mockResolvedValue();

      const result = await safeWriteFile('test.txt', 'test');

      expect(result.success).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('test.txt.tmp'),
        'test',
        'utf8'
      );
      expect(fs.rename).toHaveBeenCalled();
    });

    test('detects partial write', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      fs.stat.mockResolvedValue({ size: 2 }); // "test" is 4 bytes, actual 2

      const result = await safeWriteFile('test.txt', 'test');

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('PARTIAL_WRITE');
      expect(fs.unlink).toHaveBeenCalled(); // Cleanup
    });

    test('handles write error', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockRejectedValue(new Error('write failed'));

      const result = await safeWriteFile('test.txt', 'test');

      expect(result.success).toBe(false);
      expect(fs.unlink).toHaveBeenCalled(); // Cleanup
    });
  });

  describe('ensureDirectory', () => {
    test('creates directory recursively', async () => {
      fs.mkdir.mockResolvedValue();
      const result = await ensureDirectory('/a/b/c');
      expect(result.success).toBe(true);
      expect(fs.mkdir).toHaveBeenCalledWith('/a/b/c', { recursive: true });
    });

    test('handles EEXIST gracefully', async () => {
      const err = new Error('exists');
      err.code = 'EEXIST';
      fs.mkdir.mockRejectedValue(err);

      const result = await ensureDirectory('/a');
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    test('handles other errors', async () => {
      const err = new Error('perm denied');
      err.code = 'EACCES';
      fs.mkdir.mockRejectedValue(err);

      const result = await ensureDirectory('/a');
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('FILE_ACCESS_DENIED');
    });
  });

  describe('moveFile', () => {
    test('moves file via rename', async () => {
      fs.access.mockRejectedValue(new Error('dest not found')); // Destination check
      fs.mkdir.mockResolvedValue(); // Parent dir check
      fs.rename.mockResolvedValue();

      const success = await moveFile('src', 'dest');
      expect(success).toBe(true);
      expect(fs.rename).toHaveBeenCalledWith('src', 'dest');
    });

    test('falls back to cross-device move on EXDEV', async () => {
      fs.access.mockRejectedValue(new Error('dest not found'));
      fs.mkdir.mockResolvedValue();
      const exdevError = new Error('cross-device');
      exdevError.code = 'EXDEV';
      fs.rename.mockRejectedValue(exdevError);

      crossDeviceMove.mockResolvedValue();

      const success = await moveFile('src', 'dest');
      expect(success).toBe(true);
      expect(crossDeviceMove).toHaveBeenCalledWith('src', 'dest', { verify: true });
    });
  });

  describe('processBatch', () => {
    test('processes items in batches', async () => {
      const items = [1, 2, 3, 4, 5];
      const processor = jest.fn().mockImplementation((i) => Promise.resolve(i * 2));

      const results = await processBatch(items, processor, 2);

      expect(results).toEqual([2, 4, 6, 8, 10]);
      expect(processor).toHaveBeenCalledTimes(5);
    });

    test('handles processor errors gracefully', async () => {
      const items = [1, 2];
      const processor = jest.fn().mockResolvedValueOnce(2).mockRejectedValueOnce(new Error('fail'));

      const results = await processBatch(items, processor, 2);

      expect(results).toEqual([2, null]);
    });
  });

  describe('watchPath', () => {
    test('starts watcher successfully', async () => {
      fs.access.mockResolvedValue(); // Path exists
      const mockWatcher = {
        on: jest.fn(),
        close: jest.fn()
      };
      fsSync.watch.mockReturnValue(mockWatcher);

      const result = await watchPath('test-dir', jest.fn());

      expect(result.isActive()).toBe(true);
      expect(fsSync.watch).toHaveBeenCalled();
    });

    test('handles path not found', async () => {
      fs.access.mockRejectedValue(new Error('ENOENT'));

      const result = await watchPath('missing', jest.fn());

      expect(result.isActive()).toBe(false);
      expect(result.error).toBeInstanceOf(FileSystemError);
    });

    test('handles watcher error event', async () => {
      fs.access.mockResolvedValue();
      let errorCallback;
      const mockWatcher = {
        on: jest.fn((event, cb) => {
          if (event === 'error') errorCallback = cb;
        }),
        close: jest.fn()
      };
      fsSync.watch.mockReturnValue(mockWatcher);

      const onError = jest.fn();
      const result = await watchPath('dir', jest.fn(), { onError });

      // Simulate error
      errorCallback(new Error('watch fail'));

      expect(result.isActive()).toBe(false);
      expect(onError).toHaveBeenCalled();
      expect(result.getLastError()).toBeInstanceOf(WatcherError);
    });
  });
});
