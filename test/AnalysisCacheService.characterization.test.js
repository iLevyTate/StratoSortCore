/**
 * @jest-environment node
 *
 * Characterization tests for AnalysisCacheService
 * These tests capture current behavior before refactoring.
 */

const AnalysisCacheService = require('../src/main/services/AnalysisCacheService');

// Mock the logger to avoid noise in tests
jest.mock('../src/shared/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    setContext: jest.fn()
  }
}));

// Mock the cache invalidation bus
jest.mock('../src/shared/cacheInvalidation', () => {
  const mockUnsubscribe = jest.fn();
  const mockBus = {
    subscribe: jest.fn(() => mockUnsubscribe),
    invalidateForPathChange: jest.fn(),
    invalidateForDeletion: jest.fn()
  };
  return {
    getInstance: jest.fn(() => mockBus),
    InvalidationType: {
      FULL_INVALIDATE: 'full-invalidate',
      PATH_CHANGED: 'path-changed',
      FILE_DELETED: 'file-deleted'
    },
    _mockBus: mockBus,
    _mockUnsubscribe: mockUnsubscribe
  };
});

describe('AnalysisCacheService Characterization Tests', () => {
  let cache;

  beforeEach(() => {
    cache = new AnalysisCacheService({
      maxEntries: 5,
      ttlMs: 1000,
      name: 'TestCache'
    });
  });

  afterEach(() => {
    cache.shutdown();
  });

  describe('Basic Cache Operations', () => {
    test('get() returns null for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    test('set() and get() store and retrieve values', () => {
      const value = { data: 'test' };
      cache.set('key1', value);
      expect(cache.get('key1')).toEqual(value);
    });

    test('has() returns false for non-existent keys', () => {
      expect(cache.has('nonexistent')).toBe(false);
    });

    test('has() returns true for existing keys', () => {
      cache.set('key1', 'value');
      expect(cache.has('key1')).toBe(true);
    });

    test('delete() removes a key', () => {
      cache.set('key1', 'value');
      expect(cache.has('key1')).toBe(true);
      cache.delete('key1');
      expect(cache.has('key1')).toBe(false);
    });

    test('clear() removes all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
    });
  });

  describe('TTL Behavior', () => {
    test('get() returns null for expired entries', async () => {
      // Use a short TTL cache
      const shortTtlCache = new AnalysisCacheService({
        maxEntries: 5,
        ttlMs: 50, // 50ms TTL
        name: 'ShortTTLCache'
      });

      shortTtlCache.set('expiring', 'value');
      expect(shortTtlCache.get('expiring')).toBe('value');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(shortTtlCache.get('expiring')).toBeNull();
      shortTtlCache.shutdown();
    });

    test('has() returns false for expired entries', async () => {
      const shortTtlCache = new AnalysisCacheService({
        maxEntries: 5,
        ttlMs: 50,
        name: 'ShortTTLCache'
      });

      shortTtlCache.set('expiring', 'value');
      expect(shortTtlCache.has('expiring')).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(shortTtlCache.has('expiring')).toBe(false);
      shortTtlCache.shutdown();
    });
  });

  describe('LRU Eviction Behavior', () => {
    test('set() evicts oldest when at capacity', () => {
      // Cache with maxEntries: 5
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      cache.set('key4', 'value4');
      cache.set('key5', 'value5');

      // Verify cache is at capacity using stats (avoids updating accessSeq)
      expect(cache.getStats().size).toBe(5);

      // Adding 6th entry should evict key1 (lowest accessSeq since no accesses)
      cache.set('key6', 'value6');
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key6')).toBe(true);
    });

    test('get() refreshes entry timestamp (LRU access behavior)', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      cache.set('key4', 'value4');
      cache.set('key5', 'value5');

      // Access key1 to refresh it
      cache.get('key1');

      // Add new entry - key2 should be evicted (oldest after key1 was refreshed)
      cache.set('key6', 'value6');
      expect(cache.has('key1')).toBe(true); // key1 was refreshed, so still present
      expect(cache.has('key2')).toBe(false); // key2 should be evicted
    });
  });

  describe('Key Generation', () => {
    test('generateKey() produces consistent hashes for same inputs', () => {
      const key1 = cache.generateKey('text', 'model', [{ name: 'folder1' }]);
      const key2 = cache.generateKey('text', 'model', [{ name: 'folder1' }]);
      expect(key1).toBe(key2);
    });

    test('generateKey() produces different hashes for different inputs', () => {
      const key1 = cache.generateKey('text1', 'model', []);
      const key2 = cache.generateKey('text2', 'model', []);
      expect(key1).not.toBe(key2);
    });

    test('generateKey() handles null/undefined inputs', () => {
      expect(() => cache.generateKey(null, null, null)).not.toThrow();
      expect(() => cache.generateKey(undefined, undefined, undefined)).not.toThrow();
    });

    test('generateFileSignature() includes model and folder info', () => {
      const stats = { size: 100, mtimeMs: 12345 };
      const sig = cache.generateFileSignature('/path/file.txt', stats, 'model', 'folderSig');
      expect(sig).toContain('model');
      expect(sig).toContain('folderSig');
      expect(sig).toContain('/path/file.txt');
    });

    test('generateFileSignature() returns null for invalid stats', () => {
      expect(cache.generateFileSignature('/path', null)).toBeNull();
    });
  });

  describe('Statistics', () => {
    test('getStats() returns current cache state', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.maxEntries).toBe(5);
      expect(stats.ttlMs).toBe(1000);
      expect(stats.name).toBe('TestCache');
    });
  });

  describe('evictExpired()', () => {
    test('evictExpired() removes expired entries', async () => {
      const shortTtlCache = new AnalysisCacheService({
        maxEntries: 10,
        ttlMs: 50,
        name: 'EvictionTestCache'
      });

      shortTtlCache.set('key1', 'value1');
      shortTtlCache.set('key2', 'value2');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 60));

      const evicted = shortTtlCache.evictExpired();
      expect(evicted).toBe(2);
      expect(shortTtlCache.getStats().size).toBe(0);
      shortTtlCache.shutdown();
    });
  });

  describe('Shutdown', () => {
    test('shutdown() clears cache and unsubscribes from bus', () => {
      const { _mockUnsubscribe } = require('../src/shared/cacheInvalidation');

      cache.set('key1', 'value');
      cache.shutdown();

      expect(cache.getStats().size).toBe(0);
      expect(_mockUnsubscribe).toHaveBeenCalled();
    });
  });
});

describe('createAnalysisCache Factory', () => {
  const {
    createAnalysisCache,
    CACHE_TYPE_DEFAULTS
  } = require('../src/main/services/AnalysisCacheService');

  test('createAnalysisCache() creates document cache with defaults', () => {
    const cache = createAnalysisCache('document');
    const stats = cache.getStats();

    expect(stats.maxEntries).toBe(CACHE_TYPE_DEFAULTS.document.maxEntries);
    expect(stats.ttlMs).toBe(CACHE_TYPE_DEFAULTS.document.ttlMs);
    expect(stats.name).toBe(CACHE_TYPE_DEFAULTS.document.name);

    cache.shutdown();
  });

  test('createAnalysisCache() creates image cache with defaults', () => {
    const cache = createAnalysisCache('image');
    const stats = cache.getStats();

    expect(stats.maxEntries).toBe(CACHE_TYPE_DEFAULTS.image.maxEntries);
    expect(stats.ttlMs).toBe(CACHE_TYPE_DEFAULTS.image.ttlMs);

    cache.shutdown();
  });

  test('createAnalysisCache() allows option overrides', () => {
    const cache = createAnalysisCache('document', { maxEntries: 1000 });
    expect(cache.getStats().maxEntries).toBe(1000);
    cache.shutdown();
  });
});
