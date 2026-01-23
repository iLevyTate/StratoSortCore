/**
 * @jest-environment node
 *
 * Integration tests for CacheInvalidationBus with AnalysisCacheService
 * Verifies that cache entries are properly invalidated on file operations.
 */

// Must import before mocking
const {
  CacheInvalidationBus,
  InvalidationType,
  resetInstance
} = require('../src/shared/cacheInvalidation');

// Mock the logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    setContext: jest.fn()
  },
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    setContext: jest.fn()
  }))
}));

describe('CacheInvalidationBus Integration Tests', () => {
  let bus;

  beforeEach(() => {
    resetInstance();
    bus = new CacheInvalidationBus();
  });

  afterEach(() => {
    bus.shutdown();
  });

  describe('Subscription Management', () => {
    test('subscribe() returns unsubscribe function', () => {
      const unsubscribe = bus.subscribe('TestCache', {
        onInvalidate: jest.fn()
      });

      expect(typeof unsubscribe).toBe('function');
      expect(bus.getStats().subscriberCount).toBe(1);
    });

    test('unsubscribe() removes subscriber', () => {
      const unsubscribe = bus.subscribe('TestCache', {
        onInvalidate: jest.fn()
      });

      expect(bus.getStats().subscriberCount).toBe(1);
      unsubscribe();
      expect(bus.getStats().subscriberCount).toBe(0);
    });

    test('duplicate subscription replaces existing', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      bus.subscribe('TestCache', { onInvalidate: callback1 });
      bus.subscribe('TestCache', { onInvalidate: callback2 });

      expect(bus.getStats().subscriberCount).toBe(1);

      // Trigger invalidation - only callback2 should be called
      bus.invalidateAll('test');
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });
  });

  describe('Path Change Invalidation', () => {
    test('invalidateForPathChange() notifies subscribers', () => {
      const onPathChange = jest.fn();
      const onInvalidate = jest.fn();

      bus.subscribe('TestCache', { onPathChange, onInvalidate });

      bus.invalidateForPathChange('/old/path/file.txt', '/new/path/file.txt', 'move');

      expect(onPathChange).toHaveBeenCalledWith(
        '/old/path/file.txt',
        '/new/path/file.txt',
        expect.objectContaining({
          type: InvalidationType.PATH_CHANGED,
          changeType: 'move'
        })
      );
      expect(onInvalidate).toHaveBeenCalled();
    });

    test('path change updates statistics', () => {
      bus.subscribe('TestCache', { onInvalidate: jest.fn() });

      bus.invalidateForPathChange('/old', '/new');

      const stats = bus.getStats();
      expect(stats.pathChanges).toBe(1);
      expect(stats.totalInvalidations).toBe(1);
    });
  });

  describe('Deletion Invalidation', () => {
    test('invalidateForDeletion() notifies subscribers', () => {
      const onDeletion = jest.fn();
      const onInvalidate = jest.fn();

      bus.subscribe('TestCache', { onDeletion, onInvalidate });

      bus.invalidateForDeletion('/path/to/deleted.txt');

      expect(onDeletion).toHaveBeenCalledWith(
        '/path/to/deleted.txt',
        expect.objectContaining({
          type: InvalidationType.FILE_DELETED,
          path: '/path/to/deleted.txt'
        })
      );
      expect(onInvalidate).toHaveBeenCalled();
    });

    test('deletion updates statistics', () => {
      bus.subscribe('TestCache', { onInvalidate: jest.fn() });

      bus.invalidateForDeletion('/deleted/file.txt');

      const stats = bus.getStats();
      expect(stats.deletions).toBe(1);
    });
  });

  describe('Batch Invalidation', () => {
    test('invalidateBatch() notifies subscribers with all changes', () => {
      const onBatch = jest.fn();

      bus.subscribe('TestCache', { onBatch, onInvalidate: jest.fn() });

      const changes = [
        { oldPath: '/old1', newPath: '/new1' },
        { oldPath: '/old2', newPath: '/new2' }
      ];

      bus.invalidateBatch(changes, 'move');

      expect(onBatch).toHaveBeenCalledWith(
        changes,
        expect.objectContaining({
          type: InvalidationType.BATCH_CHANGE,
          count: 2
        })
      );
    });

    test('batch updates statistics correctly', () => {
      bus.subscribe('TestCache', { onInvalidate: jest.fn() });

      bus.invalidateBatch([
        { oldPath: '/a', newPath: '/b' },
        { oldPath: '/c', newPath: '/d' }
      ]);

      const stats = bus.getStats();
      expect(stats.batchOperations).toBe(1);
      expect(stats.totalInvalidations).toBe(2);
    });
  });

  describe('Full Invalidation', () => {
    test('invalidateAll() notifies all subscribers', () => {
      const onInvalidate = jest.fn();

      bus.subscribe('TestCache', { onInvalidate });

      bus.invalidateAll('test-reason');

      expect(onInvalidate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: InvalidationType.FULL_INVALIDATE,
          reason: 'test-reason'
        })
      );
    });
  });

  describe('Error Handling', () => {
    test('subscriber error does not affect other subscribers', () => {
      const errorCallback = jest.fn(() => {
        throw new Error('Subscriber error');
      });
      const goodCallback = jest.fn();

      bus.subscribe('ErrorCache', { onInvalidate: errorCallback });
      bus.subscribe('GoodCache', { onInvalidate: goodCallback });

      // Should not throw
      expect(() => bus.invalidateAll('test')).not.toThrow();

      // Good callback should still be called
      expect(goodCallback).toHaveBeenCalled();
    });
  });

  describe('Queue Coalescing', () => {
    test('queueInvalidation() batches rapid invalidations', async () => {
      const onBatch = jest.fn();
      const onPathChange = jest.fn();

      bus.subscribe('TestCache', { onBatch, onPathChange, onInvalidate: jest.fn() });

      // Queue multiple rapid invalidations
      bus.queueInvalidation('/old1', '/new1');
      bus.queueInvalidation('/old2', '/new2');
      bus.queueInvalidation('/old3', '/new3');

      // Wait for coalesce timeout (default 50ms)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have been batched into one call
      expect(onBatch).toHaveBeenCalledTimes(1);
      expect(onBatch).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ oldPath: '/old1', newPath: '/new1' })]),
        expect.anything()
      );
    });

    test('single queued invalidation uses regular path change', async () => {
      const onPathChange = jest.fn();

      bus.subscribe('TestCache', { onPathChange, onInvalidate: jest.fn() });

      bus.queueInvalidation('/old', '/new');

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(onPathChange).toHaveBeenCalledWith('/old', '/new', expect.anything());
    });
  });
});

describe('AnalysisCacheService Bus Integration', () => {
  // Use real bus but mock singletonFactory
  jest.resetModules();

  // Re-import with real bus after resetting modules
  const {
    getInstance: getCacheInvalidationBus,
    resetInstance: resetBus
  } = require('../src/shared/cacheInvalidation');

  beforeEach(() => {
    resetBus();
  });

  test('AnalysisCacheService subscribes to bus on construction', () => {
    // Create a fresh cache service
    const AnalysisCacheService = require('../src/main/services/AnalysisCacheService');
    const cache = new AnalysisCacheService({ name: 'IntegrationTestCache' });

    const bus = getCacheInvalidationBus();
    const stats = bus.getStats();

    expect(stats.subscribers).toContain('IntegrationTestCache');

    cache.shutdown();
  });

  test('Cache entries are cleared on path change', () => {
    const AnalysisCacheService = require('../src/main/services/AnalysisCacheService');
    const cache = new AnalysisCacheService({ name: 'PathChangeTestCache' });

    // Add entries with paths in the key
    cache.set('key-/path/to/file.txt-data', 'value1');
    cache.set('key-/other/file.txt-data', 'value2');

    // Trigger path change
    const bus = getCacheInvalidationBus();
    bus.invalidateForPathChange('/path/to/file.txt', '/new/path/file.txt');

    // Entry with old path should be gone
    expect(cache.has('key-/path/to/file.txt-data')).toBe(false);
    // Entry with different path should remain
    expect(cache.has('key-/other/file.txt-data')).toBe(true);

    cache.shutdown();
  });

  test('Cache entries are cleared on deletion', () => {
    const AnalysisCacheService = require('../src/main/services/AnalysisCacheService');
    const cache = new AnalysisCacheService({ name: 'DeletionTestCache' });

    cache.set('key-/deleted/file.txt-data', 'value1');
    cache.set('key-/other/file.txt-data', 'value2');

    const bus = getCacheInvalidationBus();
    bus.invalidateForDeletion('/deleted/file.txt');

    expect(cache.has('key-/deleted/file.txt-data')).toBe(false);
    expect(cache.has('key-/other/file.txt-data')).toBe(true);

    cache.shutdown();
  });

  test('All cache entries cleared on full invalidation', () => {
    const AnalysisCacheService = require('../src/main/services/AnalysisCacheService');
    const cache = new AnalysisCacheService({ name: 'FullInvalidateCache' });

    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.set('key3', 'value3');

    const bus = getCacheInvalidationBus();
    bus.invalidateAll('test');

    expect(cache.getStats().size).toBe(0);

    cache.shutdown();
  });

  test('Cache unsubscribes on shutdown', () => {
    const AnalysisCacheService = require('../src/main/services/AnalysisCacheService');
    const cache = new AnalysisCacheService({ name: 'ShutdownTestCache' });

    const bus = getCacheInvalidationBus();
    expect(bus.getStats().subscribers).toContain('ShutdownTestCache');

    cache.shutdown();

    expect(bus.getStats().subscribers).not.toContain('ShutdownTestCache');
  });
});
