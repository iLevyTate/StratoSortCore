const { app } = require('electron');
const { logger } = require('../src/shared/logger');
const { container } = require('../src/main/services/ServiceContainer');
const { get: getConfig } = require('../src/shared/config/index');
const { persistQueueData } = require('../src/main/analysis/embeddingQueue/persistence');
const {
  createFailedItemHandler
} = require('../src/main/analysis/embeddingQueue/failedItemHandler');
const { processItemsInParallel } = require('../src/main/analysis/embeddingQueue/parallelProcessor');
const { createProgressTracker } = require('../src/main/analysis/embeddingQueue/progress');
const EmbeddingQueue = require('../src/main/analysis/embeddingQueue/EmbeddingQueueCore');

// Mock external dependencies
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/mock/user/data')
  }
}));

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../src/main/services/ServiceContainer', () => ({
  container: {
    resolve: jest.fn()
  },
  ServiceIds: {
    CHROMA_DB: 'chroma-db'
  }
}));

jest.mock('../src/shared/config/index', () => ({
  get: jest.fn()
}));

jest.mock('../src/main/analysis/embeddingQueue/persistence', () => ({
  loadPersistedData: jest.fn(),
  persistQueueData: jest.fn()
}));

jest.mock('../src/main/analysis/embeddingQueue/failedItemHandler', () => ({
  createFailedItemHandler: jest.fn()
}));

jest.mock('../src/main/analysis/embeddingQueue/parallelProcessor', () => ({
  processItemsInParallel: jest.fn()
}));

jest.mock('../src/main/analysis/embeddingQueue/progress', () => ({
  createProgressTracker: jest.fn()
}));

// Mock performance constants
jest.mock('../src/shared/performanceConstants', () => ({
  BATCH: { EMBEDDING_FLUSH_DELAY_MS: 5 },
  LIMITS: { MAX_QUEUE_SIZE: 100, MAX_DEAD_LETTER_SIZE: 50 },
  THRESHOLDS: { QUEUE_HIGH_WATERMARK: 0.8, QUEUE_CRITICAL_WATERMARK: 0.9 },
  RETRY: { BACKOFF_BASE_MS: 5, BACKOFF_MAX_MS: 20 },
  CONCURRENCY: { EMBEDDING_FLUSH: 2 },
  TIMEOUTS: { DELAY_BATCH: 5 }
}));

describe('EmbeddingQueueCore Deep Tests', () => {
  let embeddingQueue;
  let mockFailedItemHandler;
  let mockProgressTracker;
  let mockChromaDbService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    getConfig.mockImplementation((key, defaultVal) => defaultVal);

    mockFailedItemHandler = {
      failedItems: new Map(),
      trackFailedItem: jest.fn(),
      retryFailedItems: jest.fn(),
      persistAll: jest.fn(),
      getStats: jest.fn().mockReturnValue({})
    };
    createFailedItemHandler.mockReturnValue(mockFailedItemHandler);

    mockProgressTracker = {
      onProgress: jest.fn(),
      notify: jest.fn(),
      clear: jest.fn()
    };
    createProgressTracker.mockReturnValue(mockProgressTracker);

    mockChromaDbService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      isOnline: true
    };
    container.resolve.mockReturnValue(mockChromaDbService);

    embeddingQueue = new EmbeddingQueue();
    embeddingQueue.initialized = true;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Concurrency and Mutex', () => {
    test('prevents concurrent flush execution', async () => {
      // Setup: a slow processItemsInParallel
      let resolveProcess;
      const processPromise = new Promise((resolve) => {
        resolveProcess = resolve;
      });
      processItemsInParallel.mockReturnValue(processPromise);

      embeddingQueue.queue = [{ id: '1', vector: [] }];

      // Start first flush
      const flush1 = embeddingQueue.flush();

      // Wait for flush1 to reach processing
      let retries = 0;
      while (!embeddingQueue.isFlushing && retries < 20) {
        await Promise.resolve();
        retries++;
      }
      expect(embeddingQueue.isFlushing).toBe(true);

      // Attempt second flush immediately
      embeddingQueue.queue.push({ id: '2', vector: [] }); // Add another item
      const flush2 = embeddingQueue.flush();

      // Resolve first process
      resolveProcess(1);
      await flush1;

      // flush1 completes. flush2 should now proceed.
      // Note: flush1 slices BATCH_SIZE (50). If queue had 1, it took it. Then we added '2'.
      // So flush2 should process '2'.

      // We need to ensure processItemsInParallel was called again for flush2.
      // But we need to mock its return value for the second call or it will hang if we reused the promise.
      processItemsInParallel.mockResolvedValueOnce(1); // For flush2

      await flush2;

      expect(processItemsInParallel).toHaveBeenCalledTimes(2);
    });

    test('forceFlush waits for active flush', async () => {
      // Setup slow flush
      let resolveProcess;
      const processPromise = new Promise((resolve) => {
        resolveProcess = resolve;
      });
      processItemsInParallel.mockReturnValue(processPromise);

      embeddingQueue.queue = [{ id: '1', vector: [] }];

      // Start flush
      const flushPromise = embeddingQueue.flush();

      // Wait for flush to start
      let retries = 0;
      while (!embeddingQueue.isFlushing && retries < 20) {
        await Promise.resolve();
        retries++;
      }
      expect(embeddingQueue.isFlushing).toBe(true);

      // Start forceFlush
      const forceFlushPromise = embeddingQueue.forceFlush();

      // forceFlush should be waiting for isFlushing to become false
      // It uses a polling loop with setTimeout(..., TIMEOUTS.DELAY_BATCH)

      // Resolve the original flush
      resolveProcess(1);
      await flushPromise;

      // Now advance timers to allow forceFlush loop to check isFlushing
      await jest.runAllTimersAsync();

      await forceFlushPromise;

      expect(embeddingQueue.isFlushing).toBe(false);
      expect(persistQueueData).toHaveBeenCalled();
    });
  });

  describe('Offline Handling and Retry', () => {
    test('retries on offline database with backoff', async () => {
      mockChromaDbService.isOnline = false;
      embeddingQueue.queue = [{ id: '1', vector: [] }];
      embeddingQueue.MAX_RETRY_COUNT = 3;

      // Spy on scheduleFlush
      const scheduleSpy = jest.spyOn(embeddingQueue, 'scheduleFlush');

      // First attempt
      await embeddingQueue.flush();

      expect(embeddingQueue.retryCount).toBe(1);
      expect(mockFailedItemHandler.trackFailedItem).not.toHaveBeenCalled(); // Not failed yet

      // Run timer for backoff (base * 2^0 = 5ms)
      await jest.advanceTimersByTimeAsync(10);

      expect(scheduleSpy).toHaveBeenCalled(); // Scheduled retry triggered
    });

    test('moves items to failed queue after max retries', async () => {
      mockChromaDbService.isOnline = false;
      embeddingQueue.queue = [{ id: '1', vector: [] }];
      embeddingQueue.MAX_RETRY_COUNT = 1;
      embeddingQueue.retryCount = 0;

      await embeddingQueue.flush();

      expect(mockFailedItemHandler.trackFailedItem).toHaveBeenCalledWith(
        expect.objectContaining({ id: '1' }),
        'Database offline'
      );
      expect(embeddingQueue.queue).toHaveLength(0);
      expect(embeddingQueue.retryCount).toBe(0); // Resets after failure
    });
  });

  describe('Queue Overflow Backpressure', () => {
    test('persists queue when backpressure triggers', async () => {
      embeddingQueue.MAX_QUEUE_SIZE = 1;
      embeddingQueue.queue = [{ id: 'existing', vector: [] }];

      const result = await embeddingQueue.enqueue({ id: 'new', vector: [] });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('queue_overflow');
      expect(persistQueueData).toHaveBeenCalled();
    });
  });
});
