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
});
