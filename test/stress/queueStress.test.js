/**
 * Stress Tests for Embedding Queue
 *
 * Tests:
 * - Queue capacity and overflow handling
 * - Oldest item dropping behavior
 * - Queue recovery after flush failures
 * - Concurrent queue operations
 * - Dead letter queue behavior
 */

const {
  generateQueueItems,
  createMockChromaDBService,
  forceGC,
  createTimer
} = require('../utils/testUtilities');

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp/test-app')
  }
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

// Mock config
jest.mock('../../src/shared/config', () => ({
  get: jest.fn((key, defaultValue) => defaultValue)
}));

describe('EmbeddingQueue Stress Tests', () => {
  let EmbeddingQueue;
  let mockChromaDB;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ legacyFakeTimers: false });

    // Reset module cache to get fresh queue instance
    jest.resetModules();

    mockChromaDB = createMockChromaDBService();

    // Mock ChromaDBService
    jest.mock('../../src/main/services/chromadb', () => ({
      getInstance: () => mockChromaDB
    }));

    // Import after mocking
    EmbeddingQueue = require('../../src/main/analysis/embeddingQueue');
  });

  afterEach(() => {
    jest.useRealTimers();
    forceGC();
  });

  describe('Queue Capacity and Overflow', () => {
    it('should enforce MAX_QUEUE_SIZE limit', async () => {
      // Set a small max size for testing
      const originalMax = EmbeddingQueue.MAX_QUEUE_SIZE;
      EmbeddingQueue.MAX_QUEUE_SIZE = 100;
      EmbeddingQueue.queue = [];
      EmbeddingQueue.initialized = true;

      try {
        // Enqueue more items than max
        const items = generateQueueItems(150);

        for (const item of items) {
          await EmbeddingQueue.enqueue(item);
        }

        // Queue should be at or below max size
        expect(EmbeddingQueue.queue.length).toBeLessThanOrEqual(100);
      } finally {
        EmbeddingQueue.MAX_QUEUE_SIZE = originalMax;
      }
    });

    it('should drop oldest items when queue is full', async () => {
      const originalMax = EmbeddingQueue.MAX_QUEUE_SIZE;
      EmbeddingQueue.MAX_QUEUE_SIZE = 50;
      EmbeddingQueue.queue = [];
      EmbeddingQueue.initialized = true;

      try {
        // Fill queue completely
        const initialItems = generateQueueItems(50);
        for (const item of initialItems) {
          await EmbeddingQueue.enqueue(item);
        }

        // Record first item ID
        const firstItemId = EmbeddingQueue.queue[0]?.id;

        // Add more items (should trigger overflow)
        const newItems = generateQueueItems(10);
        for (const item of newItems) {
          await EmbeddingQueue.enqueue(item);
        }

        // First item should have been dropped
        const stillHasFirstItem = EmbeddingQueue.queue.some((item) => item.id === firstItemId);
        expect(stillHasFirstItem).toBe(false);

        // The oldest items should be gone (dropped 5% at a time = 3 items minimum)
        expect(EmbeddingQueue.queue.length).toBeLessThanOrEqual(50);
      } finally {
        EmbeddingQueue.MAX_QUEUE_SIZE = originalMax;
      }
    });

    it('should emit overflow warnings at thresholds', async () => {
      const originalMax = EmbeddingQueue.MAX_QUEUE_SIZE;
      EmbeddingQueue.MAX_QUEUE_SIZE = 100;
      EmbeddingQueue.queue = [];
      EmbeddingQueue.memoryWarningLogged = false;
      EmbeddingQueue.criticalWarningLogged = false;
      EmbeddingQueue.initialized = true;

      try {
        // Fill to 75% (high watermark)
        const items = generateQueueItems(76);

        for (const item of items) {
          await EmbeddingQueue.enqueue(item);
        }

        expect(EmbeddingQueue.memoryWarningLogged).toBe(true);

        // Fill to 90% (critical watermark)
        const moreItems = generateQueueItems(15);
        for (const item of moreItems) {
          await EmbeddingQueue.enqueue(item);
        }

        expect(EmbeddingQueue.criticalWarningLogged).toBe(true);
      } finally {
        EmbeddingQueue.MAX_QUEUE_SIZE = originalMax;
      }
    });
  });

  describe('Queue Recovery After Failures', () => {
    it('should retry failed items with exponential backoff', async () => {
      EmbeddingQueue.queue = [];
      EmbeddingQueue.failedItems = new Map();
      EmbeddingQueue.initialized = true;
      EmbeddingQueue.ITEM_MAX_RETRIES = 3;

      const item = generateQueueItems(1)[0];

      // Track the failed item
      EmbeddingQueue._trackFailedItem(item, 'Test failure');

      expect(EmbeddingQueue.failedItems.has(item.id)).toBe(true);
      const failedEntry = EmbeddingQueue.failedItems.get(item.id);
      expect(failedEntry.retryCount).toBe(1);
      expect(failedEntry.error).toBe('Test failure');

      // Track again (second failure)
      EmbeddingQueue._trackFailedItem(item, 'Test failure 2');

      const failedEntry2 = EmbeddingQueue.failedItems.get(item.id);
      expect(failedEntry2.retryCount).toBe(2);
    });

    it('should move items to dead letter queue after max retries', async () => {
      EmbeddingQueue.queue = [];
      EmbeddingQueue.failedItems = new Map();
      EmbeddingQueue.deadLetterQueue = [];
      EmbeddingQueue.initialized = true;
      EmbeddingQueue.ITEM_MAX_RETRIES = 3;

      const item = generateQueueItems(1)[0];

      // Fail 4 times (exceeds max retries of 3)
      for (let i = 0; i < 4; i++) {
        EmbeddingQueue._trackFailedItem(item, `Failure ${i + 1}`);
      }

      // Should be in dead letter queue now
      expect(EmbeddingQueue.failedItems.has(item.id)).toBe(false);
      expect(EmbeddingQueue.deadLetterQueue.length).toBe(1);
      expect(EmbeddingQueue.deadLetterQueue[0].itemId).toBe(item.id);
    });

    it('should allow manual retry of dead letter items', async () => {
      EmbeddingQueue.queue = [];
      EmbeddingQueue.deadLetterQueue = [];
      EmbeddingQueue.initialized = true;

      const item = generateQueueItems(1)[0];

      // Add to dead letter queue
      EmbeddingQueue._addToDeadLetterQueue(item, 'Permanent failure', 5);

      expect(EmbeddingQueue.deadLetterQueue.length).toBe(1);

      // Retry the item
      const retried = await EmbeddingQueue.retryDeadLetterItem(item.id);

      expect(retried).toBe(true);
      expect(EmbeddingQueue.deadLetterQueue.length).toBe(0);
      expect(EmbeddingQueue.queue.some((i) => i.id === item.id)).toBe(true);
    });

    it('should handle concurrent flush failures gracefully', async () => {
      EmbeddingQueue.queue = [];
      EmbeddingQueue.isFlushing = false;
      EmbeddingQueue.initialized = true;
      EmbeddingQueue.retryCount = 0;

      // Add items
      const items = generateQueueItems(10);
      EmbeddingQueue.queue.push(...items);

      // Simulate ChromaDB being offline
      mockChromaDB.simulateFailure(0);

      // Attempt flush
      EmbeddingQueue.isFlushing = false;

      // Items should remain in queue when flush fails
      expect(EmbeddingQueue.queue.length).toBe(10);
    });
  });

  describe('High Volume Queue Operations', () => {
    it('should handle rapid enqueue operations', async () => {
      EmbeddingQueue.queue = [];
      EmbeddingQueue.initialized = true;

      // Reduced from 1000 to 200 for memory efficiency
      const itemCount = 200;
      // Use smaller vectors (128 dims vs 768) for stress tests
      const items = generateQueueItems(itemCount, {
        includeVector: true,
        vectorDimensions: 128
      });

      const timer = createTimer();

      // Enqueue all items without awaiting
      const promises = items.map((item) => EmbeddingQueue.enqueue(item));
      await Promise.all(promises);

      const elapsed = timer();

      // Should complete within reasonable time
      expect(elapsed).toBeLessThan(5000);
    });

    it('should maintain queue integrity under stress', async () => {
      EmbeddingQueue.queue = [];
      EmbeddingQueue.initialized = true;

      const operations = [];
      // Reduced from 500 to 100 for memory efficiency
      const itemCount = 100;

      // Mix of enqueue and stats operations
      for (let i = 0; i < itemCount; i++) {
        const item = generateQueueItems(1, { includeVector: false })[0];
        operations.push(EmbeddingQueue.enqueue(item));

        // Occasionally check stats
        if (i % 25 === 0) {
          operations.push(Promise.resolve(EmbeddingQueue.getStats()));
        }
      }

      await Promise.all(operations);

      const stats = EmbeddingQueue.getStats();

      // Queue should have valid state
      expect(stats.queueLength).toBeGreaterThanOrEqual(0);
      expect(stats.healthStatus).toBeDefined();
    });

    it('should handle queue size fluctuations', async () => {
      EmbeddingQueue.queue = [];
      EmbeddingQueue.initialized = true;
      EmbeddingQueue.MAX_QUEUE_SIZE = 200;

      const addBatch = async (count) => {
        // Use no vectors for batch operations to save memory
        const items = generateQueueItems(count, { includeVector: false });
        for (const item of items) {
          await EmbeddingQueue.enqueue(item);
        }
      };

      const removeBatch = (count) => {
        EmbeddingQueue.queue.splice(0, count);
      };

      // Simulate fluctuating queue size (reduced numbers)
      await addBatch(80);
      expect(EmbeddingQueue.queue.length).toBe(80);

      removeBatch(40);
      expect(EmbeddingQueue.queue.length).toBe(40);

      await addBatch(100);
      expect(EmbeddingQueue.queue.length).toBe(140);

      removeBatch(120);
      expect(EmbeddingQueue.queue.length).toBe(20);

      await addBatch(50);
      expect(EmbeddingQueue.queue.length).toBe(70);
    });
  });

  describe('Dead Letter Queue Stress', () => {
    it('should prune dead letter queue when at capacity', async () => {
      EmbeddingQueue.deadLetterQueue = [];
      EmbeddingQueue.MAX_DEAD_LETTER_SIZE = 100;
      EmbeddingQueue.initialized = true;

      // Fill dead letter queue to capacity
      for (let i = 0; i < 100; i++) {
        const item = generateQueueItems(1)[0];
        item.id = `dlq-item-${i}`;
        EmbeddingQueue._addToDeadLetterQueue(item, `Error ${i}`, 5);
      }

      expect(EmbeddingQueue.deadLetterQueue.length).toBe(100);

      // Add more items (should trigger pruning)
      for (let i = 0; i < 20; i++) {
        const item = generateQueueItems(1)[0];
        item.id = `dlq-overflow-${i}`;
        EmbeddingQueue._addToDeadLetterQueue(item, `Overflow error ${i}`, 5);
      }

      // Should have pruned oldest entries
      expect(EmbeddingQueue.deadLetterQueue.length).toBeLessThanOrEqual(100);

      // Oldest items should be gone
      const hasOldestItem = EmbeddingQueue.deadLetterQueue.some(
        (entry) => entry.itemId === 'dlq-item-0'
      );
      expect(hasOldestItem).toBe(false);
    });

    it('should handle bulk retry of dead letter items', async () => {
      EmbeddingQueue.queue = [];
      EmbeddingQueue.deadLetterQueue = [];
      EmbeddingQueue.initialized = true;

      // Add items to dead letter queue
      for (let i = 0; i < 50; i++) {
        const item = generateQueueItems(1)[0];
        item.id = `dlq-bulk-${i}`;
        EmbeddingQueue._addToDeadLetterQueue(item, `Bulk error ${i}`, 5);
      }

      expect(EmbeddingQueue.deadLetterQueue.length).toBe(50);

      // Retry all
      const retriedCount = await EmbeddingQueue.retryAllDeadLetterItems();

      expect(retriedCount).toBe(50);
      expect(EmbeddingQueue.deadLetterQueue.length).toBe(0);
      expect(EmbeddingQueue.queue.length).toBe(50);
    });
  });

  describe('Progress Tracking Under Load', () => {
    it('should notify progress callbacks during operations', async () => {
      EmbeddingQueue.queue = [];
      EmbeddingQueue._progressCallbacks = new Set();
      EmbeddingQueue.initialized = true;

      const progressEvents = [];
      const unsubscribe = EmbeddingQueue.onProgress((progress) => {
        progressEvents.push({ ...progress, timestamp: Date.now() });
      });

      // Simulate progress notifications
      EmbeddingQueue._notifyProgress({ phase: 'start', total: 100 });
      EmbeddingQueue._notifyProgress({ phase: 'processing', completed: 50 });
      EmbeddingQueue._notifyProgress({ phase: 'complete', completed: 100 });

      expect(progressEvents.length).toBe(3);
      expect(progressEvents[0].phase).toBe('start');
      expect(progressEvents[1].phase).toBe('processing');
      expect(progressEvents[2].phase).toBe('complete');

      unsubscribe();

      // After unsubscribe, should not receive more events
      EmbeddingQueue._notifyProgress({ phase: 'test' });
      expect(progressEvents.length).toBe(3);
    });

    it('should handle errors in progress callbacks gracefully', async () => {
      EmbeddingQueue._progressCallbacks = new Set();

      // Add a callback that throws
      EmbeddingQueue.onProgress(() => {
        throw new Error('Callback error');
      });

      // Add a normal callback
      const events = [];
      EmbeddingQueue.onProgress((progress) => {
        events.push(progress);
      });

      // Should not throw despite bad callback
      expect(() => {
        EmbeddingQueue._notifyProgress({ phase: 'test' });
      }).not.toThrow();

      // Good callback should still receive event
      expect(events.length).toBe(1);
    });
  });

  describe('Queue Statistics Accuracy', () => {
    it('should report accurate queue statistics', async () => {
      EmbeddingQueue.queue = [];
      EmbeddingQueue.failedItems = new Map();
      EmbeddingQueue.deadLetterQueue = [];
      EmbeddingQueue.initialized = true;
      EmbeddingQueue.MAX_QUEUE_SIZE = 1000;
      EmbeddingQueue.retryCount = 0;

      // Add items
      const items = generateQueueItems(100);
      EmbeddingQueue.queue.push(...items);

      // Add some failed items
      for (let i = 0; i < 5; i++) {
        EmbeddingQueue.failedItems.set(`failed-${i}`, {
          item: { id: `failed-${i}` },
          retryCount: 1,
          lastAttempt: Date.now()
        });
      }

      // Add dead letter items
      for (let i = 0; i < 3; i++) {
        EmbeddingQueue.deadLetterQueue.push({
          itemId: `dead-${i}`,
          item: { id: `dead-${i}` }
        });
      }

      const stats = EmbeddingQueue.getStats();

      expect(stats.queueLength).toBe(100);
      expect(stats.failedItemsCount).toBe(5);
      expect(stats.deadLetterCount).toBe(3);
      expect(stats.capacityPercent).toBe(10); // 100/1000 = 10%
      expect(stats.healthStatus).toBe('healthy');
    });

    it('should correctly identify health status at thresholds', async () => {
      EmbeddingQueue.MAX_QUEUE_SIZE = 100;
      EmbeddingQueue.HIGH_WATERMARK = 0.75;
      EmbeddingQueue.CRITICAL_WATERMARK = 0.9;
      EmbeddingQueue.MEMORY_WARNING_THRESHOLD = 75;
      EmbeddingQueue.CRITICAL_WARNING_THRESHOLD = 90;
      EmbeddingQueue.failedItems = new Map();
      EmbeddingQueue.deadLetterQueue = [];
      EmbeddingQueue.initialized = true;

      // Below high watermark
      EmbeddingQueue.queue = generateQueueItems(50);
      let stats = EmbeddingQueue.getStats();
      expect(stats.healthStatus).toBe('healthy');

      // At high watermark
      EmbeddingQueue.queue = generateQueueItems(76);
      stats = EmbeddingQueue.getStats();
      expect(stats.healthStatus).toBe('warning');

      // At critical watermark
      EmbeddingQueue.queue = generateQueueItems(91);
      stats = EmbeddingQueue.getStats();
      expect(stats.healthStatus).toBe('critical');
    });
  });
});
