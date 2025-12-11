/**
 * Tests for ChromaQueryCache
 * Tests LRU cache with TTL support for ChromaDB query results
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

describe('ChromaQueryCache', () => {
  let ChromaQueryCache;
  let cache;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    const module = require('../src/main/services/chromadb/ChromaQueryCache');
    ChromaQueryCache = module.ChromaQueryCache;

    cache = new ChromaQueryCache({ maxSize: 5, ttlMs: 1000 });
  });

  describe('constructor', () => {
    test('creates cache with default options', () => {
      const defaultCache = new ChromaQueryCache();

      expect(defaultCache.maxSize).toBe(200);
      expect(defaultCache.ttlMs).toBe(120000);
    });

    test('accepts custom options', () => {
      const customCache = new ChromaQueryCache({ maxSize: 10, ttlMs: 5000 });

      expect(customCache.maxSize).toBe(10);
      expect(customCache.ttlMs).toBe(5000);
    });
  });

  describe('get', () => {
    test('returns null for non-existent key', () => {
      const result = cache.get('nonexistent');

      expect(result).toBeNull();
    });

    test('returns cached data for existing key', () => {
      cache.set('key1', { data: 'value1' });

      const result = cache.get('key1');

      expect(result).toEqual({ data: 'value1' });
    });

    test('returns null for expired entry', async () => {
      cache = new ChromaQueryCache({ maxSize: 5, ttlMs: 50 });
      cache.set('key1', { data: 'value1' });

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 100));

      const result = cache.get('key1');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    test('stores data with timestamp', () => {
      cache.set('key1', { data: 'value1' });

      expect(cache.size).toBe(1);
      expect(cache.get('key1')).toEqual({ data: 'value1' });
    });

    test('updates position for existing key (LRU behavior)', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Access key1 to update its position
      cache.set('key1', 'updated');

      // key1 should now be newest
      const keys = Array.from(cache.cache.keys());
      expect(keys[keys.length - 1]).toBe('key1');
    });

    test('evicts oldest entry when at capacity', () => {
      for (let i = 1; i <= 5; i++) {
        cache.set(`key${i}`, `value${i}`);
      }

      // Cache is at capacity (5)
      expect(cache.size).toBe(5);

      // Add one more
      cache.set('key6', 'value6');

      // Size should still be 5 (oldest evicted)
      expect(cache.size).toBe(5);

      // key1 should be evicted
      expect(cache.get('key1')).toBeNull();

      // key6 should exist
      expect(cache.get('key6')).toBe('value6');
    });
  });

  describe('has', () => {
    test('returns true for existing non-expired entry', () => {
      cache.set('key1', 'value1');

      expect(cache.has('key1')).toBe(true);
    });

    test('returns false for non-existent entry', () => {
      expect(cache.has('nonexistent')).toBe(false);
    });

    test('returns false for expired entry', async () => {
      cache = new ChromaQueryCache({ maxSize: 5, ttlMs: 50 });
      cache.set('key1', 'value1');

      await new Promise((r) => setTimeout(r, 100));

      expect(cache.has('key1')).toBe(false);
    });
  });

  describe('delete', () => {
    test('removes entry from cache', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      cache.delete('key1');

      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBe('value2');
    });

    test('handles non-existent key gracefully', () => {
      expect(() => cache.delete('nonexistent')).not.toThrow();
    });
  });

  describe('invalidateForFile', () => {
    test('removes entries containing file ID', () => {
      cache.set('query:file:abc123:top5', 'data1');
      cache.set('query:file:abc123:top10', 'data2');
      cache.set('query:file:def456:top5', 'data3');

      cache.invalidateForFile('abc123');

      expect(cache.get('query:file:abc123:top5')).toBeNull();
      expect(cache.get('query:file:abc123:top10')).toBeNull();
      expect(cache.get('query:file:def456:top5')).toBe('data3');
    });

    test('handles no matching entries', () => {
      cache.set('query:file:abc123:top5', 'data1');

      cache.invalidateForFile('nonexistent');

      expect(cache.get('query:file:abc123:top5')).toBe('data1');
    });
  });

  describe('invalidateForFolder', () => {
    test('removes folder query entries', () => {
      cache.set('query:folders:abc123:5', 'data1');
      cache.set('query:folders:def456:10', 'data2');
      cache.set('query:files:abc123:5', 'data3');

      cache.invalidateForFolder();

      expect(cache.get('query:folders:abc123:5')).toBeNull();
      expect(cache.get('query:folders:def456:10')).toBeNull();
      expect(cache.get('query:files:abc123:5')).toBe('data3');
    });
  });

  describe('clear', () => {
    test('removes all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      cache.clear();

      expect(cache.size).toBe(0);
    });

    test('logs cleared entries count', () => {
      const { logger } = require('../src/shared/logger');
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      cache.clear();

      expect(logger.info).toHaveBeenCalledWith('[QueryCache] Cache cleared', { entriesCleared: 2 });
    });
  });

  describe('getStats', () => {
    test('returns cache statistics', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(5);
      expect(stats.ttlMs).toBe(1000);
    });
  });

  describe('size property', () => {
    test('returns current cache size', () => {
      expect(cache.size).toBe(0);

      cache.set('key1', 'value1');
      expect(cache.size).toBe(1);

      cache.set('key2', 'value2');
      expect(cache.size).toBe(2);
    });
  });
});
