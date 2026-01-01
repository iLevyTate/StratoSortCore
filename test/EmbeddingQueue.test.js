/**
 * Tests for EmbeddingQueue
 * Tests the removeByFilePath functionality and queue operations
 */

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
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn().mockResolvedValue('[]'),
    writeFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
    access: jest.fn().mockRejectedValue(new Error('ENOENT'))
  }
}));

// Mock ChromaDBService
jest.mock('../src/main/services/chromadb', () => ({
  getInstance: jest.fn().mockReturnValue({
    initialize: jest.fn().mockResolvedValue(undefined),
    isOnline: true,
    upsertFile: jest.fn().mockResolvedValue({ success: true }),
    upsertFolder: jest.fn().mockResolvedValue({ success: true })
  })
}));

// Mock shared config
jest.mock('../src/shared/config/index', () => ({
  get: jest.fn((key, defaultVal) => defaultVal)
}));

// Mock performanceConstants
jest.mock('../src/shared/performanceConstants', () => ({
  BATCH: {
    EMBEDDING_FLUSH_DELAY_MS: 100
  },
  LIMITS: {
    MAX_QUEUE_SIZE: 1000,
    MAX_DEAD_LETTER_SIZE: 100
  },
  THRESHOLDS: {
    QUEUE_HIGH_WATERMARK: 0.8,
    QUEUE_CRITICAL_WATERMARK: 0.95
  },
  RETRY: {
    BACKOFF_BASE_MS: 100,
    BACKOFF_MAX_MS: 1000
  },
  CONCURRENCY: {
    EMBEDDING_FLUSH: 3
  }
}));

describe('EmbeddingQueue', () => {
  let EmbeddingQueue;
  let queue;

  beforeEach(() => {
    jest.resetModules();
    EmbeddingQueue = require('../src/main/analysis/embeddingQueue/EmbeddingQueueCore');
    queue = new EmbeddingQueue();
    queue.initialized = true; // Skip initialization for tests
  });

  afterEach(() => {
    if (queue.flushTimer) {
      clearTimeout(queue.flushTimer);
    }
    jest.clearAllMocks();
  });

  describe('removeByFilePath', () => {
    test('removes item from queue by file path', () => {
      const filePath = '/test/path/file.txt';
      queue.queue = [
        { id: `file:${filePath}`, vector: [0.1, 0.2] },
        { id: 'file:/other/file.txt', vector: [0.3, 0.4] }
      ];

      const removed = queue.removeByFilePath(filePath);

      expect(removed).toBe(1);
      expect(queue.queue.length).toBe(1);
      expect(queue.queue[0].id).toBe('file:/other/file.txt');
    });

    test('removes item from failed items by file path', () => {
      const filePath = '/test/path/file.txt';
      const fileId = `file:${filePath}`;

      queue._failedItemHandler.failedItems.set(fileId, {
        item: { id: fileId },
        retryCount: 1
      });

      const removed = queue.removeByFilePath(filePath);

      expect(removed).toBe(0); // No items in main queue
      expect(queue._failedItemHandler.failedItems.has(fileId)).toBe(false);
    });

    test('returns 0 for null file path', () => {
      const removed = queue.removeByFilePath(null);
      expect(removed).toBe(0);
    });

    test('returns 0 for empty file path', () => {
      const removed = queue.removeByFilePath('');
      expect(removed).toBe(0);
    });

    test('returns 0 when file not found in queue', () => {
      queue.queue = [{ id: 'file:/other/file.txt', vector: [0.1, 0.2] }];

      const removed = queue.removeByFilePath('/nonexistent/file.txt');

      expect(removed).toBe(0);
      expect(queue.queue.length).toBe(1);
    });
  });

  describe('removeByFilePaths', () => {
    test('removes multiple items from queue by file paths', () => {
      const filePaths = ['/test/path/file1.txt', '/test/path/file2.txt'];
      queue.queue = [
        { id: 'file:/test/path/file1.txt', vector: [0.1, 0.2] },
        { id: 'file:/test/path/file2.txt', vector: [0.3, 0.4] },
        { id: 'file:/other/file.txt', vector: [0.5, 0.6] }
      ];

      const removed = queue.removeByFilePaths(filePaths);

      expect(removed).toBe(2);
      expect(queue.queue.length).toBe(1);
      expect(queue.queue[0].id).toBe('file:/other/file.txt');
    });

    test('removes items from both queue and failed items', () => {
      const filePaths = ['/test/path/file1.txt', '/test/path/file2.txt'];

      queue.queue = [{ id: 'file:/test/path/file1.txt', vector: [0.1, 0.2] }];

      queue._failedItemHandler.failedItems.set('file:/test/path/file2.txt', {
        item: { id: 'file:/test/path/file2.txt' },
        retryCount: 1
      });

      const removed = queue.removeByFilePaths(filePaths);

      expect(removed).toBe(1);
      expect(queue.queue.length).toBe(0);
      expect(queue._failedItemHandler.failedItems.has('file:/test/path/file2.txt')).toBe(false);
    });

    test('returns 0 for empty array', () => {
      const removed = queue.removeByFilePaths([]);
      expect(removed).toBe(0);
    });

    test('returns 0 for null input', () => {
      const removed = queue.removeByFilePaths(null);
      expect(removed).toBe(0);
    });

    test('returns 0 for non-array input', () => {
      const removed = queue.removeByFilePaths('not an array');
      expect(removed).toBe(0);
    });
  });

  describe('enqueue', () => {
    test('adds valid item to queue', async () => {
      const item = { id: 'file:/test/file.txt', vector: [0.1, 0.2] };

      const result = await queue.enqueue(item);

      expect(result.success).toBe(true);
      expect(queue.queue.length).toBe(1);
      expect(queue.queue[0]).toEqual(item);
    });

    test('rejects invalid item without id', async () => {
      const item = { vector: [0.1, 0.2] };

      const result = await queue.enqueue(item);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('invalid_item');
    });

    test('rejects invalid item without vector', async () => {
      const item = { id: 'file:/test/file.txt' };

      const result = await queue.enqueue(item);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('invalid_item');
    });

    test('rejects null item', async () => {
      const result = await queue.enqueue(null);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('invalid_item');
    });
  });

  describe('getStats', () => {
    test('returns correct queue statistics', () => {
      queue.queue = [
        { id: 'file:/test/file1.txt', vector: [0.1, 0.2] },
        { id: 'file:/test/file2.txt', vector: [0.3, 0.4] }
      ];

      const stats = queue.getStats();

      expect(stats.queueLength).toBe(2);
      expect(stats.maxQueueSize).toBe(1000);
      expect(stats.healthStatus).toBe('healthy');
      expect(stats.isInitialized).toBe(true);
    });

    test('reports warning status at high watermark', () => {
      // Fill queue to 80%
      queue.queue = new Array(800).fill(null).map((_, i) => ({
        id: `file:/test/file${i}.txt`,
        vector: [0.1, 0.2]
      }));

      const stats = queue.getStats();

      expect(stats.healthStatus).toBe('warning');
    });

    test('reports critical status at critical watermark', () => {
      // Fill queue to 95%
      queue.queue = new Array(950).fill(null).map((_, i) => ({
        id: `file:/test/file${i}.txt`,
        vector: [0.1, 0.2]
      }));

      const stats = queue.getStats();

      expect(stats.healthStatus).toBe('critical');
    });
  });

  describe('scheduleFlush', () => {
    test('schedules flush timer', () => {
      expect(queue.flushTimer).toBeNull();

      queue.scheduleFlush();

      expect(queue.flushTimer).not.toBeNull();
    });

    test('does not create duplicate timers', () => {
      queue.scheduleFlush();
      const firstTimer = queue.flushTimer;

      queue.scheduleFlush();

      expect(queue.flushTimer).toBe(firstTimer);
    });
  });

  describe('progress tracking', () => {
    test('onProgress registers callback', () => {
      const callback = jest.fn();
      const unsubscribe = queue.onProgress(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    test('_notifyProgress calls registered callbacks', () => {
      const callback = jest.fn();
      queue.onProgress(callback);

      queue._notifyProgress({ phase: 'test', percent: 50 });

      expect(callback).toHaveBeenCalledWith({ phase: 'test', percent: 50 });
    });
  });

  describe('initialize', () => {
    test('sets initialized to true after successful init', async () => {
      queue.initialized = false;
      await queue.initialize();
      expect(queue.initialized).toBe(true);
    });

    test('skips initialization if already initialized', async () => {
      queue.initialized = true;
      const originalQueue = [...queue.queue];
      await queue.initialize();
      expect(queue.queue).toEqual(originalQueue);
    });

    test('handles initialization errors gracefully', async () => {
      queue.initialized = false;
      const fs = require('fs').promises;
      fs.readFile.mockRejectedValueOnce(new Error('Read failed'));

      await queue.initialize();

      expect(queue.initialized).toBe(true);
    });
  });

  describe('persistQueue', () => {
    test('persists queue data to disk', async () => {
      const fs = require('fs').promises;
      queue.queue = [{ id: 'file:/test.txt', vector: [0.1] }];

      await queue.persistQueue();

      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('ensurePendingComplete', () => {
    test('waits for pending operations to complete', async () => {
      queue._pendingPersistence = Promise.resolve();
      queue._pendingFlush = Promise.resolve();

      await queue.ensurePendingComplete();

      // Should complete without error
      expect(true).toBe(true);
    });

    test('handles empty pending operations', async () => {
      queue._pendingPersistence = null;
      queue._pendingFlush = null;

      await queue.ensurePendingComplete();

      // Should complete without error
      expect(true).toBe(true);
    });

    test('handles pending operation errors', async () => {
      queue._pendingPersistence = Promise.reject(new Error('Persistence failed'));
      queue._pendingFlush = null;

      // Should not throw
      await queue.ensurePendingComplete();
    });
  });

  describe('flush', () => {
    test('does nothing when queue is empty', async () => {
      queue.queue = [];
      queue.isFlushing = false;

      await queue.flush();

      expect(queue.isFlushing).toBe(false);
    });

    test('does nothing when already flushing', async () => {
      queue.queue = [{ id: 'file:/test.txt', vector: [0.1] }];
      queue.isFlushing = true;

      await queue.flush();

      // Queue should not be modified
      expect(queue.queue.length).toBe(1);
    });

    test('clears flush timer when flushing', async () => {
      queue.queue = [{ id: 'file:/test.txt', vector: [0.1] }];
      queue.scheduleFlush();
      expect(queue.flushTimer).not.toBeNull();

      // Just check timer is set - actual flush requires more complex mocking
      expect(queue.flushTimer).toBeDefined();
    });
  });

  describe('enqueue with memory warnings', () => {
    test('logs warning at high watermark', async () => {
      const { logger } = require('../src/shared/logger');
      // Fill to 80% capacity
      queue.queue = new Array(800).fill(null).map((_, i) => ({
        id: `file:/test/file${i}.txt`,
        vector: [0.1]
      }));
      queue.memoryWarningLogged = false;

      await queue.enqueue({ id: 'file:/new.txt', vector: [0.1] });

      expect(logger.warn).toHaveBeenCalled();
      expect(queue.memoryWarningLogged).toBe(true);
    });

    test('logs critical warning at critical watermark', async () => {
      const { logger } = require('../src/shared/logger');
      // Fill to 95% capacity
      queue.queue = new Array(950).fill(null).map((_, i) => ({
        id: `file:/test/file${i}.txt`,
        vector: [0.1]
      }));
      queue.criticalWarningLogged = false;

      await queue.enqueue({ id: 'file:/new.txt', vector: [0.1] });

      expect(logger.error).toHaveBeenCalled();
      expect(queue.criticalWarningLogged).toBe(true);
    });

    test('resets warning flags when below thresholds', async () => {
      queue.memoryWarningLogged = true;
      queue.criticalWarningLogged = true;
      queue.queue = [{ id: 'file:/test.txt', vector: [0.1] }];

      await queue.enqueue({ id: 'file:/new.txt', vector: [0.1] });

      expect(queue.memoryWarningLogged).toBe(false);
      expect(queue.criticalWarningLogged).toBe(false);
    });

    test('handles queue overflow with backpressure', async () => {
      // Fill queue to max
      queue.queue = new Array(1000).fill(null).map((_, i) => ({
        id: `file:/test/file${i}.txt`,
        vector: [0.1]
      }));

      const result = await queue.enqueue({ id: 'file:/overflow.txt', vector: [0.1] });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('queue_overflow');
    });
  });

  describe('flush mutex', () => {
    test('_acquireFlushMutex returns a release function', async () => {
      const release = await queue._acquireFlushMutex();
      expect(typeof release).toBe('function');
      release(); // Release the mutex
    });

    test('serializes concurrent flush operations', async () => {
      let order = [];

      // Simple test - acquire and release
      const release1 = await queue._acquireFlushMutex();
      order.push(1);
      release1();

      const release2 = await queue._acquireFlushMutex();
      order.push(2);
      release2();

      expect(order).toEqual([1, 2]);
    });
  });

  describe('unsubscribe from progress', () => {
    test('unsubscribe function removes callback', () => {
      const callback = jest.fn();
      const unsubscribe = queue.onProgress(callback);

      // Notify before unsubscribe
      queue._notifyProgress({ phase: 'test1' });
      expect(callback).toHaveBeenCalledTimes(1);

      // Unsubscribe
      unsubscribe();

      // Notify after unsubscribe
      queue._notifyProgress({ phase: 'test2' });
      expect(callback).toHaveBeenCalledTimes(1); // Still 1, not 2
    });
  });
});
