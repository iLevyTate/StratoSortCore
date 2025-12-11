/**
 * Tests for Embedding Queue Persistence Module
 * Tests file I/O operations for queue persistence
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
  access: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  rename: jest.fn(),
  unlink: jest.fn()
};
jest.mock('fs', () => ({
  promises: mockFs
}));

describe('Embedding Queue Persistence', () => {
  let loadPersistedData;
  let atomicWriteFile;
  let safeUnlink;
  let persistQueueData;
  let persistFailedItems;
  let persistDeadLetterQueue;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Default mocks
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readFile.mockResolvedValue('[]');
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.rename.mockResolvedValue(undefined);
    mockFs.unlink.mockResolvedValue(undefined);

    const module = require('../src/main/analysis/embeddingQueue/persistence');
    loadPersistedData = module.loadPersistedData;
    atomicWriteFile = module.atomicWriteFile;
    safeUnlink = module.safeUnlink;
    persistQueueData = module.persistQueueData;
    persistFailedItems = module.persistFailedItems;
    persistDeadLetterQueue = module.persistDeadLetterQueue;
  });

  describe('loadPersistedData', () => {
    test('loads and parses existing file', async () => {
      const data = [{ id: 'item1' }, { id: 'item2' }];
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(data));

      const onLoad = jest.fn();
      await loadPersistedData('/path/to/file.json', onLoad, 'test data');

      expect(onLoad).toHaveBeenCalledWith(data);
    });

    test('does not call onLoad if file does not exist', async () => {
      mockFs.access.mockRejectedValueOnce({ code: 'ENOENT' });

      const onLoad = jest.fn();
      await loadPersistedData('/path/to/file.json', onLoad, 'test data');

      expect(onLoad).not.toHaveBeenCalled();
    });

    test('handles parse errors by backing up corrupt file', async () => {
      const { logger } = require('../src/shared/logger');
      mockFs.readFile.mockResolvedValueOnce('invalid json{');

      const onLoad = jest.fn();
      await loadPersistedData('/path/to/file.json', onLoad, 'test data');

      expect(onLoad).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
      expect(mockFs.rename).toHaveBeenCalledWith(
        '/path/to/file.json',
        expect.stringContaining('.corrupt.')
      );
    });

    test('handles file read errors', async () => {
      const { logger } = require('../src/shared/logger');
      mockFs.access.mockResolvedValueOnce(undefined);
      mockFs.readFile.mockRejectedValueOnce(new Error('Read error'));

      const onLoad = jest.fn();
      await loadPersistedData('/path/to/file.json', onLoad, 'test data');

      expect(onLoad).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('atomicWriteFile', () => {
    test('writes data using temp file pattern', async () => {
      const data = { key: 'value' };

      await atomicWriteFile('/path/to/file.json', data);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.tmp.'),
        JSON.stringify(data),
        'utf8'
      );
      expect(mockFs.rename).toHaveBeenCalled();
    });

    test('pretty prints when option is set', async () => {
      const data = { key: 'value' };

      await atomicWriteFile('/path/to/file.json', data, { pretty: true });

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        JSON.stringify(data, null, 2),
        'utf8'
      );
    });

    test('retries rename on EPERM error', async () => {
      const epermError = new Error('EPERM');
      epermError.code = 'EPERM';
      mockFs.rename.mockRejectedValueOnce(epermError).mockResolvedValueOnce(undefined);

      const data = { key: 'value' };
      await atomicWriteFile('/path/to/file.json', data);

      expect(mockFs.rename).toHaveBeenCalledTimes(2);
    });

    test('cleans up temp file on write error', async () => {
      mockFs.writeFile.mockResolvedValueOnce(undefined);
      mockFs.rename.mockRejectedValueOnce(new Error('Rename failed'));

      await expect(atomicWriteFile('/path/to/file.json', { key: 'value' })).rejects.toThrow(
        'Rename failed'
      );

      expect(mockFs.unlink).toHaveBeenCalled();
    });
  });

  describe('safeUnlink', () => {
    test('deletes existing file', async () => {
      await safeUnlink('/path/to/file.json');

      expect(mockFs.unlink).toHaveBeenCalledWith('/path/to/file.json');
    });

    test('ignores ENOENT error', async () => {
      const enoentError = new Error('ENOENT');
      enoentError.code = 'ENOENT';
      mockFs.unlink.mockRejectedValueOnce(enoentError);

      // Should not throw
      await expect(safeUnlink('/path/to/file.json')).resolves.not.toThrow();
    });

    test('throws other errors', async () => {
      const permError = new Error('Permission denied');
      permError.code = 'EPERM';
      mockFs.unlink.mockRejectedValueOnce(permError);

      await expect(safeUnlink('/path/to/file.json')).rejects.toThrow('Permission denied');
    });
  });

  describe('persistQueueData', () => {
    test('writes queue data to file', async () => {
      const queue = [{ id: 'item1' }, { id: 'item2' }];

      await persistQueueData('/path/to/queue.json', queue);

      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    test('deletes file when queue is empty', async () => {
      await persistQueueData('/path/to/queue.json', []);

      expect(mockFs.unlink).toHaveBeenCalledWith('/path/to/queue.json');
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    test('handles write errors silently', async () => {
      mockFs.writeFile.mockRejectedValueOnce(new Error('Write failed'));

      // Should not throw
      await expect(
        persistQueueData('/path/to/queue.json', [{ id: 'item' }])
      ).resolves.not.toThrow();
    });
  });

  describe('persistFailedItems', () => {
    test('writes failed items as array of entries', async () => {
      const failedItems = new Map([
        ['id1', { item: { id: 'id1' }, retryCount: 1 }],
        ['id2', { item: { id: 'id2' }, retryCount: 2 }]
      ]);

      await persistFailedItems('/path/to/failed.json', failedItems);

      expect(mockFs.writeFile).toHaveBeenCalled();
      const writtenContent = mockFs.writeFile.mock.calls[0][1];
      const parsed = JSON.parse(writtenContent);
      expect(parsed).toHaveLength(2);
    });

    test('deletes file when map is empty', async () => {
      const failedItems = new Map();

      await persistFailedItems('/path/to/failed.json', failedItems);

      expect(mockFs.unlink).toHaveBeenCalled();
    });
  });

  describe('persistDeadLetterQueue', () => {
    test('writes dead letter queue with pretty printing', async () => {
      const deadLetterQueue = [
        { itemId: 'item1', error: 'Error 1' },
        { itemId: 'item2', error: 'Error 2' }
      ];

      await persistDeadLetterQueue('/path/to/dlq.json', deadLetterQueue);

      expect(mockFs.writeFile).toHaveBeenCalled();
      const writtenContent = mockFs.writeFile.mock.calls[0][1];
      // Should be pretty-printed (has newlines)
      expect(writtenContent).toContain('\n');
    });

    test('deletes file when queue is empty', async () => {
      await persistDeadLetterQueue('/path/to/dlq.json', []);

      expect(mockFs.unlink).toHaveBeenCalled();
    });
  });
});
