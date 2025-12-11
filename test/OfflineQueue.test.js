/**
 * Tests for OfflineQueue
 * Tests priority-based queueing, deduplication, and _sortRequired optimization
 */

const path = require('path');

// Mock electron app
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/tmp/test')
  }
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

// Mock fs.promises
const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  rename: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined)
};
jest.mock('fs', () => ({
  promises: mockFs
}));

describe('OfflineQueue', () => {
  let OfflineQueue;
  let OperationType;
  let queue;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // Reset mock implementations
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.rename.mockResolvedValue(undefined);

    const module = require('../src/main/utils/OfflineQueue');
    OfflineQueue = module.OfflineQueue;
    OperationType = module.OperationType;

    queue = new OfflineQueue({
      persistPath: path.join('/tmp/test', 'test-queue.json'),
      maxQueueSize: 100
    });
  });

  afterEach(async () => {
    if (queue._persistTimer) {
      clearTimeout(queue._persistTimer);
    }
    queue.removeAllListeners();
  });

  describe('enqueue', () => {
    test('adds operation to queue', () => {
      const result = queue.enqueue(OperationType.UPSERT_FILE, {
        id: 'file:test.txt',
        vector: [0.1, 0.2]
      });

      expect(result).toBe(true);
      expect(queue.size()).toBe(1);
      expect(queue.stats.totalEnqueued).toBe(1);
    });

    test('sets _sortRequired flag on enqueue', () => {
      expect(queue._sortRequired).toBe(false);

      queue.enqueue(OperationType.UPSERT_FILE, { id: 'file:test.txt' });

      expect(queue._sortRequired).toBe(true);
    });

    test('rejects invalid operation type', () => {
      const result = queue.enqueue('INVALID_TYPE', { id: 'test' });

      expect(result).toBe(false);
      expect(queue.size()).toBe(0);
    });

    test('deduplicates operations by key', () => {
      queue.enqueue(OperationType.UPSERT_FILE, {
        id: 'file:test.txt',
        data: 'v1'
      });
      queue.enqueue(OperationType.UPSERT_FILE, {
        id: 'file:test.txt',
        data: 'v2'
      });

      expect(queue.size()).toBe(1);
      expect(queue.stats.deduplicated).toBe(1);
    });

    test('drops lowest priority when queue full', () => {
      // Fill queue to max
      for (let i = 0; i < 100; i++) {
        queue.enqueue(OperationType.UPDATE_FILE_PATHS, {
          pathUpdates: [{ oldId: `old${i}`, newId: `new${i}` }]
        });
      }

      expect(queue.size()).toBe(100);

      // Add high priority operation
      queue.enqueue(OperationType.DELETE_FILE, { id: 'file:important.txt' });

      expect(queue.size()).toBe(100);
      expect(queue.stats.totalDropped).toBe(1);
    });
  });

  describe('dequeue', () => {
    test('returns null for empty queue', () => {
      const result = queue.dequeue();
      expect(result).toBeNull();
    });

    test('returns operations in priority order', () => {
      // Add operations in reverse priority order
      queue.enqueue(OperationType.UPDATE_FILE_PATHS, {
        pathUpdates: [{ oldId: 'old', newId: 'new' }]
      });
      queue.enqueue(OperationType.UPSERT_FILE, { id: 'file:test.txt' });
      queue.enqueue(OperationType.DELETE_FILE, { id: 'file:delete.txt' });

      // Should return delete first (priority 1)
      const first = queue.dequeue();
      expect(first.type).toBe(OperationType.DELETE_FILE);

      // Then upsert (priority 2)
      const second = queue.dequeue();
      expect(second.type).toBe(OperationType.UPSERT_FILE);

      // Then update (priority 4)
      const third = queue.dequeue();
      expect(third.type).toBe(OperationType.UPDATE_FILE_PATHS);
    });

    test('clears _sortRequired flag after sorting', () => {
      queue.enqueue(OperationType.UPSERT_FILE, { id: 'file:test.txt' });
      expect(queue._sortRequired).toBe(true);

      queue.dequeue();

      expect(queue._sortRequired).toBe(false);
    });

    test('only sorts when _sortRequired is true', () => {
      queue.enqueue(OperationType.UPSERT_FILE, { id: 'file:test1.txt' });
      queue.enqueue(OperationType.UPSERT_FILE, { id: 'file:test2.txt' });

      // First dequeue triggers sort
      queue.dequeue();
      expect(queue._sortRequired).toBe(false);

      // Second dequeue should not sort again (optimization)
      const sortSpy = jest.spyOn(queue.queue, 'sort');
      queue.dequeue();
      expect(sortSpy).not.toHaveBeenCalled();

      sortSpy.mockRestore();
    });
  });

  describe('peek', () => {
    test('returns null for empty queue', () => {
      const result = queue.peek();
      expect(result).toBeNull();
    });

    test('returns highest priority without removing', () => {
      queue.enqueue(OperationType.UPSERT_FILE, { id: 'file:test.txt' });
      queue.enqueue(OperationType.DELETE_FILE, { id: 'file:delete.txt' });

      const peeked = queue.peek();
      expect(peeked.type).toBe(OperationType.DELETE_FILE);
      expect(queue.size()).toBe(2); // Not removed
    });
  });

  describe('flush', () => {
    test('processes all operations', async () => {
      queue.enqueue(OperationType.UPSERT_FILE, { id: 'file:test1.txt' });
      queue.enqueue(OperationType.UPSERT_FILE, { id: 'file:test2.txt' });

      const processor = jest.fn().mockResolvedValue(undefined);
      const result = await queue.flush(processor);

      expect(result.processed).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.remaining).toBe(0);
      expect(processor).toHaveBeenCalledTimes(2);
    });

    test('clears _sortRequired before processing', async () => {
      queue.enqueue(OperationType.UPSERT_FILE, { id: 'file:test.txt' });
      expect(queue._sortRequired).toBe(true);

      await queue.flush(jest.fn().mockResolvedValue(undefined));

      expect(queue._sortRequired).toBe(false);
    });

    test('retries failed operations', async () => {
      queue.enqueue(OperationType.UPSERT_FILE, { id: 'file:test.txt' });

      const processor = jest.fn().mockRejectedValueOnce(new Error('Test error'));
      const result = await queue.flush(processor);

      expect(result.processed).toBe(0);
      expect(result.retriesPending).toBe(1);
      expect(queue.size()).toBe(1); // Re-queued for retry
    });

    test('drops operations after max retries', async () => {
      // maxRetries: 2 means the operation gets 1 retry before being dropped
      // First attempt: retries 0 -> 1 (< maxRetries, so re-queue)
      // Second attempt: retries 1 -> 2 (>= maxRetries, so drop)
      queue.enqueue(OperationType.UPSERT_FILE, { id: 'file:test.txt' }, { maxRetries: 2 });

      const processor = jest.fn().mockRejectedValue(new Error('Test error'));

      // First flush - retry pending (retries: 0 -> 1)
      await queue.flush(processor);
      expect(queue.size()).toBe(1); // Re-queued for retry

      // Second flush - max retries exceeded (retries: 1 -> 2)
      await queue.flush(processor);
      expect(queue.size()).toBe(0); // Dropped
      expect(queue.stats.totalFailed).toBe(1);
    });

    test('prevents concurrent flushes', async () => {
      queue.enqueue(OperationType.UPSERT_FILE, { id: 'file:test.txt' });

      const slowProcessor = jest
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));

      // Start first flush
      const flush1 = queue.flush(slowProcessor);
      // Try second flush immediately
      const flush2 = queue.flush(slowProcessor);

      const result2 = await flush2;
      expect(result2.processed).toBe(0); // Second flush should be rejected

      await flush1;
    });

    test('emits flushStart and flushComplete events', async () => {
      const startHandler = jest.fn();
      const completeHandler = jest.fn();

      queue.on('flushStart', startHandler);
      queue.on('flushComplete', completeHandler);

      queue.enqueue(OperationType.UPSERT_FILE, { id: 'file:test.txt' });
      await queue.flush(jest.fn().mockResolvedValue(undefined));

      expect(startHandler).toHaveBeenCalled();
      expect(completeHandler).toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    test('removes all operations from queue', async () => {
      queue.enqueue(OperationType.UPSERT_FILE, { id: 'file:test1.txt' });
      queue.enqueue(OperationType.UPSERT_FILE, { id: 'file:test2.txt' });

      await queue.clear();

      expect(queue.size()).toBe(0);
      expect(queue.operationMap.size).toBe(0);
    });

    test('emits cleared event', async () => {
      const handler = jest.fn();
      queue.on('cleared', handler);

      queue.enqueue(OperationType.UPSERT_FILE, { id: 'file:test.txt' });
      await queue.clear();

      expect(handler).toHaveBeenCalledWith({ clearedCount: 1 });
    });
  });

  describe('getStats', () => {
    test('returns correct statistics', () => {
      queue.enqueue(OperationType.UPSERT_FILE, { id: 'file:test.txt' });

      const stats = queue.getStats();

      expect(stats.queueSize).toBe(1);
      expect(stats.totalEnqueued).toBe(1);
      expect(stats.isFlushing).toBe(false);
    });
  });

  describe('initialize', () => {
    test('loads queue from disk', async () => {
      const savedData = {
        version: 1,
        timestamp: Date.now(),
        queue: [
          {
            id: 'test-1',
            type: OperationType.UPSERT_FILE,
            data: { id: 'file:test.txt' },
            key: 'upsert_file:file:test.txt',
            priority: 2
          }
        ],
        stats: { totalEnqueued: 1 }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(savedData));

      await queue.initialize();

      expect(queue.size()).toBe(1);
      expect(queue.isLoaded).toBe(true);
    });

    test('handles missing file gracefully', async () => {
      mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

      await queue.initialize();

      expect(queue.size()).toBe(0);
      expect(queue.isLoaded).toBe(true);
    });

    test('does not reinitialize if already loaded', async () => {
      queue.isLoaded = true;

      await queue.initialize();

      expect(mockFs.readFile).not.toHaveBeenCalled();
    });
  });

  describe('persistence', () => {
    test('uses atomic write with temp file', async () => {
      queue.enqueue(OperationType.UPSERT_FILE, { id: 'file:test.txt' });

      // Wait for debounced persist
      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(mockFs.rename).toHaveBeenCalled();

      const writeCall = mockFs.writeFile.mock.calls[0];
      expect(writeCall[0]).toContain('.tmp.');
    });
  });

  describe('operation types', () => {
    test('all operation types have priorities defined', () => {
      const { OperationPriority } = require('../src/main/utils/OfflineQueue');

      for (const type of Object.values(OperationType)) {
        expect(OperationPriority[type]).toBeDefined();
      }
    });

    test('delete operations have highest priority', () => {
      const { OperationPriority } = require('../src/main/utils/OfflineQueue');

      expect(OperationPriority[OperationType.DELETE_FILE]).toBe(1);
      expect(OperationPriority[OperationType.DELETE_FOLDER]).toBe(1);
      expect(OperationPriority[OperationType.UPSERT_FILE]).toBeGreaterThan(1);
    });
  });
});
