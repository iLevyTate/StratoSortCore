/**
 * Tests for Embedding Queue Failed Item Handler
 * Tests failed item tracking, dead letter queue, and retry logic
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

// Mock persistence
jest.mock('../src/main/analysis/embeddingQueue/persistence', () => ({
  persistFailedItems: jest.fn().mockResolvedValue(undefined),
  persistDeadLetterQueue: jest.fn().mockResolvedValue(undefined)
}));

// Mock performance constants
jest.mock('../src/shared/performanceConstants', () => ({
  RETRY: {
    BACKOFF_BASE_MS: 100 // Use small values for testing
  }
}));

describe('Embedding Queue Failed Item Handler', () => {
  let createFailedItemHandler;
  let persistence;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    persistence = require('../src/main/analysis/embeddingQueue/persistence');
    const module = require('../src/main/analysis/embeddingQueue/failedItemHandler');
    createFailedItemHandler = module.createFailedItemHandler;
  });

  describe('createFailedItemHandler', () => {
    test('creates a handler instance', () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      expect(handler).toBeDefined();
      expect(typeof handler.trackFailedItem).toBe('function');
      expect(typeof handler.getItemsToRetry).toBe('function');
    });
  });

  describe('trackFailedItem', () => {
    test('tracks a failed item', () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      handler.trackFailedItem({ id: 'item1' }, 'Error message');

      expect(handler.failedItems.has('item1')).toBe(true);
      expect(handler.failedItems.get('item1').retryCount).toBe(1);
    });

    test('increments retry count on subsequent failures', () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      handler.trackFailedItem({ id: 'item1' }, 'Error 1');
      handler.trackFailedItem({ id: 'item1' }, 'Error 2');

      expect(handler.failedItems.get('item1').retryCount).toBe(2);
    });

    test('moves to dead letter queue after max retries', () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 2,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      handler.trackFailedItem({ id: 'item1' }, 'Error');
      handler.trackFailedItem({ id: 'item1' }, 'Error');
      handler.trackFailedItem({ id: 'item1' }, 'Error');

      expect(handler.failedItems.has('item1')).toBe(false);
      expect(handler.deadLetterQueue).toHaveLength(1);
    });

    test('enforces max failed items size with LRU eviction', () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        maxFailedItemsSize: 2,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      handler.trackFailedItem({ id: 'item1' }, 'Error');
      handler.trackFailedItem({ id: 'item2' }, 'Error');
      handler.trackFailedItem({ id: 'item3' }, 'Error');

      expect(handler.failedItems.size).toBe(2);
      expect(handler.failedItems.has('item1')).toBe(false);
      expect(handler.deadLetterQueue).toHaveLength(1);
    });

    test('persists failed items to disk', () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      handler.trackFailedItem({ id: 'item1' }, 'Error');

      expect(persistence.persistFailedItems).toHaveBeenCalledWith(
        '/path/failed.json',
        handler.failedItems
      );
    });
  });

  describe('addToDeadLetterQueue', () => {
    test('adds item to dead letter queue', () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      handler.addToDeadLetterQueue({ id: 'item1' }, 'Error', 3);

      expect(handler.deadLetterQueue).toHaveLength(1);
      expect(handler.deadLetterQueue[0].itemId).toBe('item1');
      expect(handler.deadLetterQueue[0].retryCount).toBe(3);
    });

    test('prunes oldest entries at capacity', () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 10,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      for (let i = 0; i < 12; i++) {
        handler.addToDeadLetterQueue({ id: `item${i}` }, 'Error', 3);
      }

      expect(handler.deadLetterQueue.length).toBeLessThanOrEqual(10);
    });

    test('sets correct item type for folders', () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      handler.addToDeadLetterQueue({ id: 'folder:test' }, 'Error', 3);

      expect(handler.deadLetterQueue[0].itemType).toBe('folder');
    });
  });

  describe('getItemsToRetry', () => {
    test('returns items ready for retry based on backoff', async () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      handler.trackFailedItem({ id: 'item1' }, 'Error');

      // Wait for backoff period
      await new Promise((r) => setTimeout(r, 250));

      const itemsToRetry = handler.getItemsToRetry();

      expect(itemsToRetry).toHaveLength(1);
      expect(handler.failedItems.has('item1')).toBe(false);
    });

    test('respects exponential backoff', async () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      handler.trackFailedItem({ id: 'item1' }, 'Error');

      // Should not be ready immediately
      const immediate = handler.getItemsToRetry();
      expect(immediate).toHaveLength(0);
    });
  });

  describe('retryFailedItems', () => {
    test('adds ready items to queue', async () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      handler.trackFailedItem({ id: 'item1' }, 'Error');

      // Wait for backoff
      await new Promise((r) => setTimeout(r, 250));

      const queue = [];
      const persistQueue = jest.fn().mockResolvedValue(undefined);

      await handler.retryFailedItems(queue, persistQueue);

      expect(queue).toHaveLength(1);
      expect(persistQueue).toHaveBeenCalled();
    });
  });

  describe('getDeadLetterItems', () => {
    test('returns dead letter items', () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      handler.addToDeadLetterQueue({ id: 'item1' }, 'Error', 3);
      handler.addToDeadLetterQueue({ id: 'item2' }, 'Error', 3);

      const items = handler.getDeadLetterItems();

      expect(items).toHaveLength(2);
    });

    test('respects limit parameter', () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      for (let i = 0; i < 5; i++) {
        handler.addToDeadLetterQueue({ id: `item${i}` }, 'Error', 3);
      }

      const items = handler.getDeadLetterItems(2);

      expect(items).toHaveLength(2);
    });
  });

  describe('clearDeadLetterQueue', () => {
    test('clears all dead letter items', async () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      handler.addToDeadLetterQueue({ id: 'item1' }, 'Error', 3);
      handler.addToDeadLetterQueue({ id: 'item2' }, 'Error', 3);

      const count = await handler.clearDeadLetterQueue();

      expect(count).toBe(2);
      expect(handler.deadLetterQueue).toHaveLength(0);
    });
  });

  describe('retryDeadLetterItem', () => {
    test('retries a specific dead letter item', async () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      handler.addToDeadLetterQueue({ id: 'item1' }, 'Error', 3);

      const queue = [];
      const persistQueue = jest.fn().mockResolvedValue(undefined);

      const success = await handler.retryDeadLetterItem('item1', queue, persistQueue);

      expect(success).toBe(true);
      expect(queue).toHaveLength(1);
      expect(handler.deadLetterQueue).toHaveLength(0);
    });

    test('returns false for non-existent item', async () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      const queue = [];
      const persistQueue = jest.fn().mockResolvedValue(undefined);

      const success = await handler.retryDeadLetterItem('nonexistent', queue, persistQueue);

      expect(success).toBe(false);
    });
  });

  describe('retryAllDeadLetterItems', () => {
    test('retries all dead letter items', async () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      handler.addToDeadLetterQueue({ id: 'item1' }, 'Error', 3);
      handler.addToDeadLetterQueue({ id: 'item2' }, 'Error', 3);

      const queue = [];
      const persistQueue = jest.fn().mockResolvedValue(undefined);

      const count = await handler.retryAllDeadLetterItems(queue, persistQueue);

      expect(count).toBe(2);
      expect(queue).toHaveLength(2);
      expect(handler.deadLetterQueue).toHaveLength(0);
    });

    test('returns 0 for empty queue', async () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      const count = await handler.retryAllDeadLetterItems([], jest.fn());

      expect(count).toBe(0);
    });
  });

  describe('setDeadLetterQueue', () => {
    test('sets dead letter queue items', () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      const items = [{ itemId: 'item1' }, { itemId: 'item2' }];
      handler.setDeadLetterQueue(items);

      expect(handler.deadLetterQueue).toEqual(items);
    });
  });

  describe('persistAll', () => {
    test('persists all state', async () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      handler.trackFailedItem({ id: 'item1' }, 'Error');

      await handler.persistAll();

      expect(persistence.persistFailedItems).toHaveBeenCalled();
      expect(persistence.persistDeadLetterQueue).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    test('returns handler statistics', () => {
      const handler = createFailedItemHandler({
        itemMaxRetries: 3,
        maxDeadLetterSize: 100,
        maxFailedItemsSize: 500,
        failedItemsPath: '/path/failed.json',
        deadLetterPath: '/path/dlq.json'
      });

      handler.trackFailedItem({ id: 'item1' }, 'Error');
      handler.addToDeadLetterQueue({ id: 'item2' }, 'Error', 3);

      const stats = handler.getStats();

      expect(stats.failedItemsCount).toBe(1);
      expect(stats.deadLetterCount).toBe(1);
      expect(stats.maxFailedItemsSize).toBe(500);
      expect(stats.maxDeadLetterSize).toBe(100);
      expect(stats.itemMaxRetries).toBe(3);
    });
  });
});
