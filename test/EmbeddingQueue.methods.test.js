const { app } = require('electron');
const { logger } = require('../src/shared/logger');
const { container } = require('../src/main/services/ServiceContainer');
const { get: getConfig } = require('../src/shared/config/index');
const {
  loadPersistedData,
  persistQueueData
} = require('../src/main/analysis/embeddingQueue/persistence');
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

describe('EmbeddingQueueCore Methods', () => {
  let embeddingQueue;
  let mockFailedItemHandler;
  let mockProgressTracker;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocks
    getConfig.mockImplementation((key, defaultVal) => defaultVal);

    mockFailedItemHandler = {
      failedItems: new Map(),
      deadLetterQueue: [],
      trackFailedItem: jest.fn(),
      retryFailedItems: jest.fn(),
      getStats: jest.fn().mockReturnValue({ failedCount: 0, deadLetterCount: 0 }),
      getDeadLetterItems: jest.fn(),
      clearDeadLetterQueue: jest.fn(),
      retryDeadLetterItem: jest.fn(),
      retryAllDeadLetterItems: jest.fn(),
      persistAll: jest.fn(),
      setDeadLetterQueue: jest.fn()
    };
    createFailedItemHandler.mockReturnValue(mockFailedItemHandler);

    mockProgressTracker = {
      onProgress: jest.fn(),
      notify: jest.fn(),
      clear: jest.fn()
    };
    createProgressTracker.mockReturnValue(mockProgressTracker);

    loadPersistedData.mockResolvedValue(null);
    persistQueueData.mockResolvedValue(undefined);

    embeddingQueue = new EmbeddingQueue();
  });

  describe('constructor', () => {
    test('initializes with default values', () => {
      expect(embeddingQueue.queue).toEqual([]);
      expect(embeddingQueue.initialized).toBe(false);
      // logger.setContext is called at module level, so we skip checking it here as mocks are cleared
      expect(createFailedItemHandler).toHaveBeenCalled();
      expect(createProgressTracker).toHaveBeenCalled();
    });
  });

  describe('initialize', () => {
    test('loads persisted data and initializes', async () => {
      const mockQueue = [{ id: '1', vector: [] }];
      loadPersistedData.mockImplementation((path, callback, label) => {
        if (label === 'pending embeddings') callback(mockQueue);
      });

      await embeddingQueue.initialize();

      expect(embeddingQueue.initialized).toBe(true);
      expect(embeddingQueue.queue).toEqual(mockQueue);
      expect(loadPersistedData).toHaveBeenCalledTimes(3); // queue, failed, deadletter
    });

    test('handles load errors gracefully', async () => {
      loadPersistedData.mockRejectedValue(new Error('Load failed'));
      await embeddingQueue.initialize();
      expect(embeddingQueue.initialized).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Initialization error'),
        expect.any(Error)
      );
    });

    test('does not re-initialize if already initialized', async () => {
      embeddingQueue.initialized = true;
      await embeddingQueue.initialize();
      expect(loadPersistedData).not.toHaveBeenCalled();
    });
  });

  describe('enqueue', () => {
    const validItem = { id: 'file:1', vector: [0.1] };

    beforeEach(async () => {
      await embeddingQueue.initialize();
    });

    test('rejects invalid items', async () => {
      const result = await embeddingQueue.enqueue({ id: 'bad' }); // missing vector
      expect(result.success).toBe(false);
      expect(result.reason).toBe('invalid_item');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid item'),
        expect.any(Object)
      );
    });

    test('enqueues valid item and schedules flush', async () => {
      const result = await embeddingQueue.enqueue(validItem);

      expect(result.success).toBe(true);
      expect(embeddingQueue.queue).toContain(validItem);
      expect(persistQueueData).toHaveBeenCalled();
      // Wait a tick for scheduleFlush check if needed, but since it sets a timer, we check timer state or spy on flush
      expect(embeddingQueue.flushTimer).not.toBeNull();
    });

    test('initializes if not already initialized', async () => {
      embeddingQueue.initialized = false;
      await embeddingQueue.enqueue(validItem);
      expect(loadPersistedData).toHaveBeenCalled();
    });

    test('warns when approaching high watermark', async () => {
      embeddingQueue.MEMORY_WARNING_THRESHOLD = 1;
      embeddingQueue.queue = [validItem]; // 1 item is >= threshold 1

      const result = await embeddingQueue.enqueue({ id: 'file:2', vector: [] });

      expect(result.warnings).toContain('high_watermark');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('approaching high watermark')
      );
    });

    test('rejects when queue is full (backpressure)', async () => {
      embeddingQueue.MAX_QUEUE_SIZE = 1;
      embeddingQueue.queue = [validItem];

      const result = await embeddingQueue.enqueue({ id: 'file:2', vector: [] });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('queue_overflow');
      expect(mockFailedItemHandler.trackFailedItem).toHaveBeenCalledWith(
        expect.any(Object),
        'queue_overflow'
      );
    });

    test('triggers immediate flush when batch size reached', async () => {
      embeddingQueue.BATCH_SIZE = 2;
      embeddingQueue.queue = [validItem];

      // Spy on flush
      const flushSpy = jest.spyOn(embeddingQueue, 'flush').mockResolvedValue();

      await embeddingQueue.enqueue({ id: 'file:2', vector: [] });

      expect(flushSpy).toHaveBeenCalled();
    });
  });

  describe('removal methods', () => {
    beforeEach(() => {
      embeddingQueue.queue = [
        { id: 'file:/path/1', vector: [] },
        { id: 'file:/path/2', vector: [] }
      ];
      mockFailedItemHandler.failedItems.set('file:/path/1', {});
    });

    test('removeByFilePath removes from queue and failed items', () => {
      const removed = embeddingQueue.removeByFilePath('/path/1');

      expect(removed).toBe(1);
      expect(embeddingQueue.queue).toHaveLength(1);
      expect(embeddingQueue.queue[0].id).toBe('file:/path/2');
      expect(mockFailedItemHandler.failedItems.has('file:/path/1')).toBe(false);
      expect(persistQueueData).toHaveBeenCalled();
    });

    test('removeByFilePaths removes multiple items', () => {
      const removed = embeddingQueue.removeByFilePaths(['/path/1', '/path/2']);

      expect(removed).toBe(2);
      expect(embeddingQueue.queue).toHaveLength(0);
      expect(persistQueueData).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    test('returns correct stats structure', () => {
      embeddingQueue.queue = [1, 2, 3];
      const stats = embeddingQueue.getStats();

      expect(stats).toMatchObject({
        queueLength: 3,
        healthStatus: 'healthy',
        isInitialized: false, // default in this test setup
        failedCount: 0
      });
    });
  });

  describe('shutdown and lifecycle', () => {
    test('ensurePendingComplete waits for operations', async () => {
      let resolvePersist;
      embeddingQueue._pendingPersistence = new Promise((r) => (resolvePersist = r));

      const ensurePromise = embeddingQueue.ensurePendingComplete();
      resolvePersist();
      await ensurePromise;

      expect(persistQueueData).toHaveBeenCalled();
    });

    test('shutdown clears timers and persists data', async () => {
      embeddingQueue.flushTimer = setTimeout(() => {}, 1000);

      await embeddingQueue.shutdown();

      expect(embeddingQueue.flushTimer).toBeNull();
      expect(mockProgressTracker.clear).toHaveBeenCalled();
      expect(persistQueueData).toHaveBeenCalled();
      expect(mockFailedItemHandler.persistAll).toHaveBeenCalled();
    });
  });

  describe('dead letter operations', () => {
    test('delegates to failedItemHandler', async () => {
      await embeddingQueue.getDeadLetterItems();
      expect(mockFailedItemHandler.getDeadLetterItems).toHaveBeenCalled();

      await embeddingQueue.clearDeadLetterQueue();
      expect(mockFailedItemHandler.clearDeadLetterQueue).toHaveBeenCalled();

      await embeddingQueue.retryDeadLetterItem('id');
      expect(mockFailedItemHandler.retryDeadLetterItem).toHaveBeenCalled();

      await embeddingQueue.retryAllDeadLetterItems();
      expect(mockFailedItemHandler.retryAllDeadLetterItems).toHaveBeenCalled();
    });
  });

  describe('forceFlush', () => {
    test('waits for existing flush then flushes remaining', async () => {
      embeddingQueue.queue = [{ id: '1', vector: [] }];
      const flushSpy = jest.spyOn(embeddingQueue, 'flush').mockResolvedValue();

      await embeddingQueue.forceFlush();

      expect(flushSpy).toHaveBeenCalled();
      expect(persistQueueData).toHaveBeenCalled();
      expect(mockFailedItemHandler.persistAll).toHaveBeenCalled();
    });
  });
});
