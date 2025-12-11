/**
 * Tests for failedItemHandler
 * Tests retry logic, dead letter queue, and LRU eviction
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

// Mock performanceConstants
jest.mock('../src/shared/performanceConstants', () => ({
  RETRY: {
    BACKOFF_BASE_MS: 100 // Short for testing
  }
}));

// Mock persistence functions
jest.mock('../src/main/analysis/embeddingQueue/persistence', () => ({
  persistFailedItems: jest.fn().mockResolvedValue(undefined),
  persistDeadLetterQueue: jest.fn().mockResolvedValue(undefined)
}));

const {
  createFailedItemHandler
} = require('../src/main/analysis/embeddingQueue/failedItemHandler');
const {
  persistFailedItems,
  persistDeadLetterQueue
} = require('../src/main/analysis/embeddingQueue/persistence');

describe('failedItemHandler', () => {
  let handler;

  beforeEach(() => {
    jest.clearAllMocks();

    handler = createFailedItemHandler({
      itemMaxRetries: 3,
      maxDeadLetterSize: 10,
      maxFailedItemsSize: 5,
      failedItemsPath: '/tmp/failed.json',
      deadLetterPath: '/tmp/deadletter.json'
    });
  });

  describe('trackFailedItem', () => {
    test('tracks first failure of an item', () => {
      const item = { id: 'file:test.txt', vector: [0.1, 0.2] };

      handler.trackFailedItem(item, 'Test error');

      expect(handler.failedItems.size).toBe(1);
      expect(handler.failedItems.get(item.id)).toEqual(
        expect.objectContaining({
          item,
          retryCount: 1,
          error: 'Test error'
        })
      );
    });

    test('increments retry count on subsequent failures', () => {
      const item = { id: 'file:test.txt', vector: [0.1, 0.2] };

      handler.trackFailedItem(item, 'Error 1');
      handler.trackFailedItem(item, 'Error 2');

      expect(handler.failedItems.get(item.id).retryCount).toBe(2);
      expect(handler.failedItems.get(item.id).error).toBe('Error 2');
    });

    test('moves item to dead letter queue after max retries', () => {
      const item = { id: 'file:test.txt', vector: [0.1, 0.2] };

      handler.trackFailedItem(item, 'Error 1');
      handler.trackFailedItem(item, 'Error 2');
      handler.trackFailedItem(item, 'Error 3');
      handler.trackFailedItem(item, 'Error 4'); // Exceeds max (3)

      expect(handler.failedItems.size).toBe(0);
      expect(handler.deadLetterQueue.length).toBe(1);
      expect(handler.deadLetterQueue[0].itemId).toBe(item.id);
    });

    test('persists failed items to disk', () => {
      const item = { id: 'file:test.txt', vector: [0.1, 0.2] };

      handler.trackFailedItem(item, 'Test error');

      expect(persistFailedItems).toHaveBeenCalledWith('/tmp/failed.json', handler.failedItems);
    });

    test('evicts oldest item when at capacity (LRU)', () => {
      // Fill to capacity
      for (let i = 0; i < 5; i++) {
        handler.trackFailedItem({ id: `file:test${i}.txt`, vector: [0.1] }, `Error ${i}`);
      }
      expect(handler.failedItems.size).toBe(5);

      // Add one more - should evict oldest
      handler.trackFailedItem({ id: 'file:new.txt', vector: [0.1] }, 'New error');

      expect(handler.failedItems.size).toBe(5);
      expect(handler.failedItems.has('file:test0.txt')).toBe(false); // Evicted
      expect(handler.failedItems.has('file:new.txt')).toBe(true);
      expect(handler.deadLetterQueue.length).toBe(1); // Evicted item moved here
    });
  });

  describe('addToDeadLetterQueue', () => {
    test('adds item to dead letter queue', () => {
      const item = { id: 'file:test.txt', vector: [0.1, 0.2] };

      handler.addToDeadLetterQueue(item, 'Final error', 3);

      expect(handler.deadLetterQueue.length).toBe(1);
      expect(handler.deadLetterQueue[0]).toEqual(
        expect.objectContaining({
          item,
          error: 'Final error',
          retryCount: 3,
          itemId: 'file:test.txt',
          itemType: 'file'
        })
      );
    });

    test('detects folder item type', () => {
      const item = { id: 'folder:documents', vector: [0.1, 0.2] };

      handler.addToDeadLetterQueue(item, 'Error', 1);

      expect(handler.deadLetterQueue[0].itemType).toBe('folder');
    });

    test('prunes oldest entries when at capacity', () => {
      // Fill to capacity
      for (let i = 0; i < 10; i++) {
        handler.addToDeadLetterQueue({ id: `file:test${i}.txt`, vector: [0.1] }, `Error ${i}`, 1);
      }
      expect(handler.deadLetterQueue.length).toBe(10);

      // Add one more - should prune 10% (1 item)
      handler.addToDeadLetterQueue({ id: 'file:new.txt', vector: [0.1] }, 'New error', 1);

      expect(handler.deadLetterQueue.length).toBe(10);
      expect(handler.deadLetterQueue[0].itemId).toBe('file:test1.txt'); // test0 was pruned
    });

    test('persists dead letter queue to disk', () => {
      const item = { id: 'file:test.txt', vector: [0.1, 0.2] };

      handler.addToDeadLetterQueue(item, 'Error', 1);

      expect(persistDeadLetterQueue).toHaveBeenCalledWith(
        '/tmp/deadletter.json',
        handler.deadLetterQueue
      );
    });
  });

  describe('getItemsToRetry', () => {
    test('returns items ready for retry based on backoff', async () => {
      const item = { id: 'file:test.txt', vector: [0.1, 0.2] };

      handler.trackFailedItem(item, 'Error');

      // Wait for backoff (100ms * 2 * 2^0 = 200ms)
      await new Promise((resolve) => setTimeout(resolve, 250));

      const itemsToRetry = handler.getItemsToRetry();

      expect(itemsToRetry).toHaveLength(1);
      expect(itemsToRetry[0]).toEqual(item);
      expect(handler.failedItems.size).toBe(0); // Removed after getting
    });

    test('does not return items still in backoff', () => {
      const item = { id: 'file:test.txt', vector: [0.1, 0.2] };

      handler.trackFailedItem(item, 'Error');

      // Immediately check - should still be in backoff
      const itemsToRetry = handler.getItemsToRetry();

      expect(itemsToRetry).toHaveLength(0);
      expect(handler.failedItems.size).toBe(1); // Still tracked
    });

    test('uses exponential backoff based on retry count', async () => {
      const item = { id: 'file:test.txt', vector: [0.1, 0.2] };

      handler.trackFailedItem(item, 'Error 1');
      handler.trackFailedItem(item, 'Error 2'); // retryCount = 2

      // First backoff: 100 * 2 * 2^0 = 200ms
      // Second backoff: 100 * 2 * 2^1 = 400ms

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(handler.getItemsToRetry()).toHaveLength(0); // Still waiting

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(handler.getItemsToRetry()).toHaveLength(1); // Now ready
    });
  });

  describe('retryFailedItems', () => {
    test('adds ready items to queue', async () => {
      const item = { id: 'file:test.txt', vector: [0.1, 0.2] };
      const queue = [];
      const persistQueue = jest.fn().mockResolvedValue(undefined);

      handler.trackFailedItem(item, 'Error');

      await new Promise((resolve) => setTimeout(resolve, 250));
      await handler.retryFailedItems(queue, persistQueue);

      expect(queue).toContain(item);
      expect(persistQueue).toHaveBeenCalled();
    });

    test('adds items to front of queue for priority', async () => {
      const failedItem = { id: 'file:failed.txt', vector: [0.1] };
      const queue = [{ id: 'file:existing.txt', vector: [0.2] }];
      const persistQueue = jest.fn().mockResolvedValue(undefined);

      handler.trackFailedItem(failedItem, 'Error');

      await new Promise((resolve) => setTimeout(resolve, 250));
      await handler.retryFailedItems(queue, persistQueue);

      expect(queue[0]).toEqual(failedItem); // At front
    });
  });

  describe('dead letter queue operations', () => {
    beforeEach(() => {
      // Add some items to dead letter queue
      for (let i = 0; i < 3; i++) {
        handler.addToDeadLetterQueue({ id: `file:test${i}.txt`, vector: [0.1] }, `Error ${i}`, 3);
      }
    });

    test('getDeadLetterItems returns items', () => {
      const items = handler.getDeadLetterItems();

      expect(items).toHaveLength(3);
    });

    test('getDeadLetterItems respects limit', () => {
      const items = handler.getDeadLetterItems(2);

      expect(items).toHaveLength(2);
    });

    test('clearDeadLetterQueue removes all items', async () => {
      const count = await handler.clearDeadLetterQueue();

      expect(count).toBe(3);
      expect(handler.deadLetterQueue.length).toBe(0);
      expect(persistDeadLetterQueue).toHaveBeenCalled();
    });

    test('retryDeadLetterItem moves specific item to queue', async () => {
      const queue = [];
      const persistQueue = jest.fn().mockResolvedValue(undefined);

      const result = await handler.retryDeadLetterItem('file:test1.txt', queue, persistQueue);

      expect(result).toBe(true);
      expect(queue).toHaveLength(1);
      expect(queue[0].id).toBe('file:test1.txt');
      expect(handler.deadLetterQueue.length).toBe(2);
    });

    test('retryDeadLetterItem returns false for non-existent item', async () => {
      const queue = [];
      const persistQueue = jest.fn();

      const result = await handler.retryDeadLetterItem('file:nonexistent.txt', queue, persistQueue);

      expect(result).toBe(false);
      expect(queue).toHaveLength(0);
    });

    test('retryAllDeadLetterItems moves all items to queue', async () => {
      const queue = [];
      const persistQueue = jest.fn().mockResolvedValue(undefined);

      const count = await handler.retryAllDeadLetterItems(queue, persistQueue);

      expect(count).toBe(3);
      expect(queue).toHaveLength(3);
      expect(handler.deadLetterQueue.length).toBe(0);
    });

    test('retryAllDeadLetterItems returns 0 for empty queue', async () => {
      await handler.clearDeadLetterQueue();
      const queue = [];
      const persistQueue = jest.fn();

      const count = await handler.retryAllDeadLetterItems(queue, persistQueue);

      expect(count).toBe(0);
    });
  });

  describe('setDeadLetterQueue', () => {
    test('sets dead letter queue from persisted data', () => {
      const items = [
        { itemId: 'file:a.txt', item: { id: 'file:a.txt' } },
        { itemId: 'file:b.txt', item: { id: 'file:b.txt' } }
      ];

      handler.setDeadLetterQueue(items);

      expect(handler.deadLetterQueue).toEqual(items);
    });
  });

  describe('persistAll', () => {
    test('persists both failed items and dead letter queue', async () => {
      handler.trackFailedItem({ id: 'file:test.txt', vector: [0.1] }, 'Error');

      await handler.persistAll();

      expect(persistFailedItems).toHaveBeenCalled();
      expect(persistDeadLetterQueue).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    test('returns correct statistics', () => {
      handler.trackFailedItem({ id: 'file:test.txt', vector: [0.1] }, 'Error');
      handler.addToDeadLetterQueue({ id: 'file:dead.txt', vector: [0.1] }, 'Error', 3);

      const stats = handler.getStats();

      expect(stats).toEqual({
        failedItemsCount: 1,
        maxFailedItemsSize: 5,
        deadLetterCount: 1,
        maxDeadLetterSize: 10,
        itemMaxRetries: 3
      });
    });
  });
});
