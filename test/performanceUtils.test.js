/**
 * Tests for Performance Utilities
 * Tests LRU cache, RAF throttle, and batch processor
 */

// Mock the shared promiseUtils module
jest.mock('../src/shared/promiseUtils', () => ({
  debounce: jest.fn((fn, delay) => {
    let timeoutId;
    const debounced = (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), delay);
    };
    debounced.cancel = () => clearTimeout(timeoutId);
    return debounced;
  }),
  throttle: jest.fn((fn, delay) => {
    let lastCall = 0;
    let timeoutId;
    const throttled = (...args) => {
      const now = Date.now();
      if (now - lastCall >= delay) {
        lastCall = now;
        fn(...args);
      } else {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(
          () => {
            lastCall = Date.now();
            fn(...args);
          },
          delay - (now - lastCall),
        );
      }
    };
    throttled.cancel = () => clearTimeout(timeoutId);
    return throttled;
  }),
}));

const {
  createLRUCache,
  rafThrottle,
  batchProcessor,
} = require('../src/renderer/utils/performance');

describe('performance utilities', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createLRUCache', () => {
    test('creates cache with get, set, has, delete, clear methods', () => {
      const cache = createLRUCache(10);

      expect(typeof cache.get).toBe('function');
      expect(typeof cache.set).toBe('function');
      expect(typeof cache.has).toBe('function');
      expect(typeof cache.delete).toBe('function');
      expect(typeof cache.clear).toBe('function');
    });

    test('stores and retrieves values', () => {
      const cache = createLRUCache(10);

      cache.set('key1', 'value1');
      cache.set('key2', { data: 'value2' });

      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toEqual({ data: 'value2' });
    });

    test('returns undefined for missing keys', () => {
      const cache = createLRUCache(10);

      expect(cache.get('nonexistent')).toBeUndefined();
    });

    test('checks if key exists', () => {
      const cache = createLRUCache(10);

      cache.set('key1', 'value1');

      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false);
    });

    test('deletes keys', () => {
      const cache = createLRUCache(10);

      cache.set('key1', 'value1');
      cache.delete('key1');

      expect(cache.has('key1')).toBe(false);
    });

    test('clears all entries', () => {
      const cache = createLRUCache(10);

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();

      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
      expect(cache.size).toBe(0);
    });

    test('evicts oldest entry when over capacity', () => {
      const cache = createLRUCache(3);

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      cache.set('key4', 'value4'); // Should evict key1

      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(true);
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });

    test('moves accessed entry to end (most recent)', () => {
      const cache = createLRUCache(3);

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Access key1, making it most recently used
      cache.get('key1');

      // Add new entry - should evict key2 (oldest)
      cache.set('key4', 'value4');

      expect(cache.has('key1')).toBe(true); // Was accessed, so kept
      expect(cache.has('key2')).toBe(false); // Evicted
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });

    test('updates existing key position on set', () => {
      const cache = createLRUCache(3);

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Update key1 - should move to end
      cache.set('key1', 'updated');

      // Add new entry - should evict key2
      cache.set('key4', 'value4');

      expect(cache.has('key1')).toBe(true);
      expect(cache.get('key1')).toBe('updated');
      expect(cache.has('key2')).toBe(false);
    });

    test('tracks size correctly', () => {
      const cache = createLRUCache(10);

      expect(cache.size).toBe(0);

      cache.set('key1', 'value1');
      expect(cache.size).toBe(1);

      cache.set('key2', 'value2');
      expect(cache.size).toBe(2);

      cache.delete('key1');
      expect(cache.size).toBe(1);
    });

    test('uses default size of 100', () => {
      const cache = createLRUCache();

      // Fill beyond 100
      for (let i = 0; i < 105; i++) {
        cache.set(`key${i}`, `value${i}`);
      }

      // Should have evicted first 5 entries
      expect(cache.has('key0')).toBe(false);
      expect(cache.has('key4')).toBe(false);
      expect(cache.has('key5')).toBe(true);
      expect(cache.has('key104')).toBe(true);
    });
  });

  describe('rafThrottle', () => {
    let mockRafId = 0;
    let rafCallbacks = [];

    beforeEach(() => {
      mockRafId = 0;
      rafCallbacks = [];

      global.requestAnimationFrame = jest.fn((callback) => {
        const id = ++mockRafId;
        rafCallbacks.push({ id, callback });
        return id;
      });

      global.cancelAnimationFrame = jest.fn((id) => {
        rafCallbacks = rafCallbacks.filter((item) => item.id !== id);
      });
    });

    afterEach(() => {
      delete global.requestAnimationFrame;
      delete global.cancelAnimationFrame;
    });

    test('schedules callback with requestAnimationFrame', () => {
      const callback = jest.fn();
      const throttled = rafThrottle(callback);

      throttled('arg1');

      expect(global.requestAnimationFrame).toHaveBeenCalled();
    });

    test('calls callback with latest args when RAF fires', () => {
      const callback = jest.fn();
      const throttled = rafThrottle(callback);

      throttled('first');
      throttled('second');
      throttled('third');

      // Simulate RAF firing
      rafCallbacks[0].callback();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('third');
    });

    test('only schedules one RAF at a time', () => {
      const callback = jest.fn();
      const throttled = rafThrottle(callback);

      throttled();
      throttled();
      throttled();

      expect(global.requestAnimationFrame).toHaveBeenCalledTimes(1);
    });

    test('can schedule again after RAF fires', () => {
      const callback = jest.fn();
      const throttled = rafThrottle(callback);

      throttled();
      rafCallbacks[0].callback();

      throttled();

      expect(global.requestAnimationFrame).toHaveBeenCalledTimes(2);
    });

    test('cancel prevents callback', () => {
      const callback = jest.fn();
      const throttled = rafThrottle(callback);

      throttled();
      throttled.cancel();

      expect(global.cancelAnimationFrame).toHaveBeenCalled();
    });
  });

  describe('batchProcessor', () => {
    test('creates processor with add, flush, and clear methods', () => {
      const processor = batchProcessor(jest.fn());

      expect(typeof processor.add).toBe('function');
      expect(typeof processor.flush).toBe('function');
      expect(typeof processor.clear).toBe('function');
    });

    test('batches items and processes after wait time', async () => {
      const processFn = jest.fn().mockResolvedValue(undefined);
      const processor = batchProcessor(processFn, 100);

      processor.add('item1');
      processor.add('item2');
      processor.add('item3');

      expect(processFn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);

      expect(processFn).toHaveBeenCalledWith(['item1', 'item2', 'item3']);
    });

    test('processes immediately when maxBatchSize reached', () => {
      const processFn = jest.fn().mockResolvedValue(undefined);
      const processor = batchProcessor(processFn, 1000, 2);

      processor.add('item1');
      processor.add('item2'); // Should trigger immediately

      expect(processFn).toHaveBeenCalledWith(['item1', 'item2']);
    });

    test('flush processes pending batch', async () => {
      const processFn = jest.fn().mockResolvedValue(undefined);
      const processor = batchProcessor(processFn, 1000);

      processor.add('item1');
      processor.add('item2');

      await processor.flush();

      expect(processFn).toHaveBeenCalledWith(['item1', 'item2']);
    });

    test('clear removes pending items', () => {
      const processFn = jest.fn().mockResolvedValue(undefined);
      const processor = batchProcessor(processFn, 100);

      processor.add('item1');
      processor.add('item2');
      processor.clear();

      jest.advanceTimersByTime(100);

      expect(processFn).not.toHaveBeenCalled();
    });

    test('starts new batch after processing', () => {
      const processFn = jest.fn().mockResolvedValue(undefined);
      const processor = batchProcessor(processFn, 100);

      processor.add('item1');
      jest.advanceTimersByTime(100);

      processor.add('item2');
      jest.advanceTimersByTime(100);

      expect(processFn).toHaveBeenCalledTimes(2);
      expect(processFn).toHaveBeenNthCalledWith(1, ['item1']);
      expect(processFn).toHaveBeenNthCalledWith(2, ['item2']);
    });

    test('uses default wait of 0', () => {
      const processFn = jest.fn().mockResolvedValue(undefined);
      const processor = batchProcessor(processFn);

      processor.add('item1');

      jest.advanceTimersByTime(0);

      expect(processFn).toHaveBeenCalled();
    });

    test('does not process empty batch', () => {
      const processFn = jest.fn().mockResolvedValue(undefined);
      batchProcessor(processFn, 100);

      jest.advanceTimersByTime(100);

      expect(processFn).not.toHaveBeenCalled();
    });
  });
});
