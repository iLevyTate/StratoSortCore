/**
 * Tests for Analysis History Cache Manager
 * Tests caching, invalidation, and incremental stats
 */

// Mock dependencies
jest.mock('../src/shared/config/index', () => ({
  get: jest.fn().mockReturnValue(5000)
}));

jest.mock('../src/shared/performanceConstants', () => ({
  CACHE: {
    MAX_LRU_CACHE: 100,
    SEARCH_CACHE_TTL_MS: 60000
  }
}));

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('cacheManager', () => {
  let cacheManager;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    cacheManager = require('../src/main/services/analysisHistory/cacheManager');
  });

  describe('createCacheStore', () => {
    test('creates cache store with default structure', () => {
      const cache = cacheManager.createCacheStore();

      expect(cache.sortedEntries).toBeNull();
      expect(cache.sortedEntriesTime).toBe(0);
      expect(cache.sortedEntriesValid).toBe(false);
      expect(cache.statistics).toBeNull();
      expect(cache.statisticsTime).toBe(0);
      expect(cache.searchResults).toBeInstanceOf(Map);
      expect(cache.categoryResults).toBeInstanceOf(Map);
      expect(cache.tagResults).toBeInstanceOf(Map);
      expect(cache.incrementalStats).toBeDefined();
      expect(cache.incrementalStats.initialized).toBe(false);
    });
  });

  describe('getCacheTTLs', () => {
    test('returns cache TTL values', () => {
      const ttls = cacheManager.getCacheTTLs();

      expect(ttls.CACHE_TTL_MS).toBeDefined();
      expect(ttls.STATS_CACHE_TTL_MS).toBeDefined();
      expect(ttls.SEARCH_CACHE_TTL_MS).toBeDefined();
    });
  });

  describe('invalidateCaches', () => {
    test('clears all caches', () => {
      const cache = cacheManager.createCacheStore();
      const state = { _statsNeedFullRecalc: false };

      cache.sortedEntries = ['entry'];
      cache.sortedEntriesValid = true;
      cache.statistics = { count: 10 };
      cache.searchResults.set('key', 'value');
      cache.categoryResults.set('cat', 'value');
      cache.tagResults.set('tag', 'value');

      cacheManager.invalidateCaches(cache, state);

      expect(cache.sortedEntries).toBeNull();
      expect(cache.sortedEntriesValid).toBe(false);
      expect(cache.statistics).toBeNull();
      expect(cache.searchResults.size).toBe(0);
      expect(cache.categoryResults.size).toBe(0);
      expect(cache.tagResults.size).toBe(0);
      expect(state._statsNeedFullRecalc).toBe(true);
    });
  });

  describe('invalidateCachesOnAdd', () => {
    test('invalidates sorted entries and category/tag caches', () => {
      const cache = cacheManager.createCacheStore();

      cache.sortedEntriesValid = true;
      cache.statistics = { count: 10 };
      cache.searchResults.set('key', 'value');
      cache.categoryResults.set('cat', 'value');
      cache.tagResults.set('tag', 'value');

      cacheManager.invalidateCachesOnAdd(cache);

      expect(cache.sortedEntriesValid).toBe(false);
      expect(cache.statistics).toBeNull();
      expect(cache.searchResults.size).toBe(1); // Search cache preserved
      expect(cache.categoryResults.size).toBe(0);
      expect(cache.tagResults.size).toBe(0);
    });
  });

  describe('invalidateCachesOnRemove', () => {
    test('performs full invalidation', () => {
      const cache = cacheManager.createCacheStore();
      const state = { _statsNeedFullRecalc: false };

      cache.sortedEntries = ['entry'];
      cache.searchResults.set('key', 'value');

      cacheManager.invalidateCachesOnRemove(cache, state);

      expect(cache.sortedEntries).toBeNull();
      expect(cache.searchResults.size).toBe(0);
      expect(state._statsNeedFullRecalc).toBe(true);
    });
  });

  describe('maintainCacheSize', () => {
    test('removes oldest entries when size exceeded', () => {
      const map = new Map();
      map.set('a', 1);
      map.set('b', 2);
      map.set('c', 3);
      map.set('d', 4);

      cacheManager.maintainCacheSize(map, 2);

      expect(map.size).toBe(2);
      expect(map.has('a')).toBe(false);
      expect(map.has('b')).toBe(false);
      expect(map.has('c')).toBe(true);
      expect(map.has('d')).toBe(true);
    });

    test('does nothing when under size limit', () => {
      const map = new Map();
      map.set('a', 1);
      map.set('b', 2);

      cacheManager.maintainCacheSize(map, 5);

      expect(map.size).toBe(2);
    });
  });

  describe('getSearchCacheKey', () => {
    test('generates cache key from query and options', () => {
      const key = cacheManager.getSearchCacheKey('test query', {
        limit: 50,
        offset: 10
      });

      expect(key).toBe('test query:50:10');
    });

    test('uses defaults for missing options', () => {
      const key = cacheManager.getSearchCacheKey('query', {});

      expect(key).toBe('query:100:0');
    });
  });

  describe('updateIncrementalStatsOnAdd', () => {
    test('updates stats when initialized', () => {
      const cache = cacheManager.createCacheStore();
      cache.incrementalStats.initialized = true;
      cache.incrementalStats.totalConfidence = 0.5;
      cache.incrementalStats.totalProcessingTime = 100;
      cache.incrementalStats.entryCount = 1;

      const entry = {
        analysis: { confidence: 0.8 },
        processing: { processingTimeMs: 200 }
      };

      cacheManager.updateIncrementalStatsOnAdd(cache, entry);

      expect(cache.incrementalStats.totalConfidence).toBe(1.3);
      expect(cache.incrementalStats.totalProcessingTime).toBe(300);
      expect(cache.incrementalStats.entryCount).toBe(2);
    });

    test('does nothing when not initialized', () => {
      const cache = cacheManager.createCacheStore();

      cacheManager.updateIncrementalStatsOnAdd(cache, {
        analysis: { confidence: 0.8 },
        processing: { processingTimeMs: 200 }
      });

      expect(cache.incrementalStats.entryCount).toBe(0);
    });
  });

  describe('updateIncrementalStatsOnRemove', () => {
    test('decrements stats when initialized', () => {
      const cache = cacheManager.createCacheStore();
      cache.incrementalStats.initialized = true;
      cache.incrementalStats.totalConfidence = 1.5;
      cache.incrementalStats.totalProcessingTime = 300;
      cache.incrementalStats.entryCount = 3;

      const entry = {
        analysis: { confidence: 0.5 },
        processing: { processingTimeMs: 100 }
      };

      cacheManager.updateIncrementalStatsOnRemove(cache, entry);

      expect(cache.incrementalStats.totalConfidence).toBe(1);
      expect(cache.incrementalStats.totalProcessingTime).toBe(200);
      expect(cache.incrementalStats.entryCount).toBe(2);
    });

    test('prevents negative entry count', () => {
      const cache = cacheManager.createCacheStore();
      cache.incrementalStats.initialized = true;
      cache.incrementalStats.entryCount = 0;

      cacheManager.updateIncrementalStatsOnRemove(cache, {
        analysis: { confidence: 0.5 },
        processing: { processingTimeMs: 100 }
      });

      expect(cache.incrementalStats.entryCount).toBe(0);
    });
  });

  describe('recalculateIncrementalStats', () => {
    test('recalculates stats from entries', () => {
      const cache = cacheManager.createCacheStore();
      const state = { _statsNeedFullRecalc: true };
      const analysisHistory = {
        entries: {
          1: { analysis: { confidence: 0.8 }, processing: { processingTimeMs: 100 } },
          2: { analysis: { confidence: 0.6 }, processing: { processingTimeMs: 200 } }
        }
      };

      cacheManager.recalculateIncrementalStats(cache, analysisHistory, state);

      expect(cache.incrementalStats.initialized).toBe(true);
      expect(cache.incrementalStats.totalConfidence).toBe(1.4);
      expect(cache.incrementalStats.totalProcessingTime).toBe(300);
      expect(cache.incrementalStats.entryCount).toBe(2);
      expect(state._statsNeedFullRecalc).toBe(false);
    });
  });

  describe('clearCaches', () => {
    test('clears all caches', () => {
      const cache = cacheManager.createCacheStore();
      const state = { _statsNeedFullRecalc: false };

      cache.sortedEntries = ['entry'];
      cache.statistics = { count: 10 };

      cacheManager.clearCaches(cache, state);

      expect(cache.sortedEntries).toBeNull();
      expect(cache.statistics).toBeNull();
    });
  });

  describe('warmCache', () => {
    test('warms cache by calling getRecentAnalysis', async () => {
      const cache = cacheManager.createCacheStore();
      const getRecentAnalysis = jest.fn().mockResolvedValue({ results: [] });
      const analysisHistory = { entries: {} };
      const state = { _statsNeedFullRecalc: false };

      await cacheManager.warmCache(cache, getRecentAnalysis, analysisHistory, state);

      expect(getRecentAnalysis).toHaveBeenCalledWith(50);
    });

    test('initializes incremental stats if needed', async () => {
      const cache = cacheManager.createCacheStore();
      const getRecentAnalysis = jest.fn().mockResolvedValue({ results: [] });
      const analysisHistory = { entries: {} };
      const state = { _statsNeedFullRecalc: false };

      await cacheManager.warmCache(cache, getRecentAnalysis, analysisHistory, state);

      expect(cache.incrementalStats.initialized).toBe(true);
    });
  });
});
