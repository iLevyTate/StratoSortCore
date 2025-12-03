/**
 * Tests for Analysis History Cache Manager
 * Tests multi-level caching, invalidation, and LRU maintenance
 */

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock config
jest.mock('../src/shared/config/index', () => ({
  get: jest.fn((key, defaultValue) => defaultValue),
}));

// Mock performanceConstants
jest.mock('../src/shared/performanceConstants', () => ({
  CACHE: {
    MAX_LRU_CACHE: 100,
    SEARCH_CACHE_TTL_MS: 60000,
  },
}));

describe('Analysis History Cache Manager', () => {
  let cacheManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    cacheManager = require('../src/main/services/analysisHistory/cacheManager');
  });

  describe('createCacheStore', () => {
    test('creates cache store with correct structure', () => {
      const cache = cacheManager.createCacheStore();

      expect(cache.sortedEntries).toBeNull();
      expect(cache.sortedEntriesTime).toBe(0);
      expect(cache.sortedEntriesValid).toBe(false);
      expect(cache.statistics).toBeNull();
      expect(cache.searchResults).toBeInstanceOf(Map);
      expect(cache.categoryResults).toBeInstanceOf(Map);
      expect(cache.tagResults).toBeInstanceOf(Map);
      expect(cache.incrementalStats).toBeDefined();
    });

    test('initializes incremental stats correctly', () => {
      const cache = cacheManager.createCacheStore();

      expect(cache.incrementalStats.totalConfidence).toBe(0);
      expect(cache.incrementalStats.totalProcessingTime).toBe(0);
      expect(cache.incrementalStats.entryCount).toBe(0);
      expect(cache.incrementalStats.initialized).toBe(false);
    });
  });

  describe('getCacheTTLs', () => {
    test('returns default TTL values', () => {
      const ttls = cacheManager.getCacheTTLs();

      expect(ttls.CACHE_TTL_MS).toBe(5000);
      expect(ttls.STATS_CACHE_TTL_MS).toBe(30000);
      expect(ttls.SEARCH_CACHE_TTL_MS).toBe(60000);
    });
  });

  describe('invalidateCaches', () => {
    test('clears all caches', () => {
      const cache = cacheManager.createCacheStore();
      const state = { _statsNeedFullRecalc: false };

      // Populate some cache data
      cache.sortedEntries = [{ id: 1 }];
      cache.sortedEntriesValid = true;
      cache.statistics = { total: 10 };
      cache.searchResults.set('query', { results: [] });
      cache.categoryResults.set('docs', { results: [] });
      cache.tagResults.set('tag1', { results: [] });

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
    test('invalidates only relevant caches', () => {
      const cache = cacheManager.createCacheStore();

      cache.sortedEntries = [{ id: 1 }];
      cache.sortedEntriesValid = true;
      cache.statistics = { total: 10 };
      cache.searchResults.set('query', { results: [] });
      cache.categoryResults.set('docs', { results: [] });

      cacheManager.invalidateCachesOnAdd(cache);

      expect(cache.sortedEntriesValid).toBe(false);
      expect(cache.statistics).toBeNull();
      // Search results should be preserved
      expect(cache.searchResults.size).toBe(1);
      // Category/tag results should be cleared
      expect(cache.categoryResults.size).toBe(0);
    });
  });

  describe('invalidateCachesOnRemove', () => {
    test('performs full invalidation', () => {
      const cache = cacheManager.createCacheStore();
      const state = { _statsNeedFullRecalc: false };

      cache.sortedEntries = [{ id: 1 }];
      cache.searchResults.set('query', { results: [] });

      cacheManager.invalidateCachesOnRemove(cache, state);

      expect(cache.sortedEntries).toBeNull();
      expect(cache.searchResults.size).toBe(0);
      expect(state._statsNeedFullRecalc).toBe(true);
    });
  });

  describe('maintainCacheSize', () => {
    test('evicts oldest entries when size exceeded', () => {
      const cacheMap = new Map();
      cacheMap.set('key1', { data: 1 });
      cacheMap.set('key2', { data: 2 });
      cacheMap.set('key3', { data: 3 });
      cacheMap.set('key4', { data: 4 });
      cacheMap.set('key5', { data: 5 });

      cacheManager.maintainCacheSize(cacheMap, 3);

      expect(cacheMap.size).toBe(3);
      expect(cacheMap.has('key1')).toBe(false);
      expect(cacheMap.has('key2')).toBe(false);
      expect(cacheMap.has('key5')).toBe(true);
    });

    test('does nothing when under max size', () => {
      const cacheMap = new Map();
      cacheMap.set('key1', { data: 1 });
      cacheMap.set('key2', { data: 2 });

      cacheManager.maintainCacheSize(cacheMap, 5);

      expect(cacheMap.size).toBe(2);
    });
  });

  describe('getSearchCacheKey', () => {
    test('generates key from query and options', () => {
      const key = cacheManager.getSearchCacheKey('test query', {
        limit: 50,
        offset: 10,
      });

      expect(key).toBe('test query:50:10');
    });

    test('uses defaults for missing options', () => {
      const key = cacheManager.getSearchCacheKey('test', {});

      expect(key).toBe('test:100:0');
    });
  });

  describe('updateIncrementalStatsOnAdd', () => {
    test('updates stats when initialized', () => {
      const cache = cacheManager.createCacheStore();
      cache.incrementalStats.initialized = true;
      cache.incrementalStats.totalConfidence = 5;
      cache.incrementalStats.totalProcessingTime = 1000;
      cache.incrementalStats.entryCount = 2;

      const entry = {
        analysis: { confidence: 0.8 },
        processing: { processingTimeMs: 500 },
      };

      cacheManager.updateIncrementalStatsOnAdd(cache, entry);

      expect(cache.incrementalStats.totalConfidence).toBe(5.8);
      expect(cache.incrementalStats.totalProcessingTime).toBe(1500);
      expect(cache.incrementalStats.entryCount).toBe(3);
    });

    test('does nothing when not initialized', () => {
      const cache = cacheManager.createCacheStore();
      cache.incrementalStats.initialized = false;

      const entry = {
        analysis: { confidence: 0.8 },
        processing: { processingTimeMs: 500 },
      };

      cacheManager.updateIncrementalStatsOnAdd(cache, entry);

      expect(cache.incrementalStats.entryCount).toBe(0);
    });
  });

  describe('updateIncrementalStatsOnRemove', () => {
    test('decrements stats when initialized', () => {
      const cache = cacheManager.createCacheStore();
      cache.incrementalStats.initialized = true;
      cache.incrementalStats.totalConfidence = 5;
      cache.incrementalStats.totalProcessingTime = 1000;
      cache.incrementalStats.entryCount = 2;

      const entry = {
        analysis: { confidence: 0.8 },
        processing: { processingTimeMs: 500 },
      };

      cacheManager.updateIncrementalStatsOnRemove(cache, entry);

      expect(cache.incrementalStats.totalConfidence).toBeCloseTo(4.2);
      expect(cache.incrementalStats.totalProcessingTime).toBe(500);
      expect(cache.incrementalStats.entryCount).toBe(1);
    });

    test('prevents negative entry count', () => {
      const cache = cacheManager.createCacheStore();
      cache.incrementalStats.initialized = true;
      cache.incrementalStats.entryCount = 0;

      const entry = {
        analysis: { confidence: 0 },
        processing: { processingTimeMs: 0 },
      };

      cacheManager.updateIncrementalStatsOnRemove(cache, entry);

      expect(cache.incrementalStats.entryCount).toBe(0);
    });
  });

  describe('recalculateIncrementalStats', () => {
    test('calculates stats from scratch', () => {
      const cache = cacheManager.createCacheStore();
      const state = { _statsNeedFullRecalc: true };
      const analysisHistory = {
        entries: {
          entry1: {
            analysis: { confidence: 0.8 },
            processing: { processingTimeMs: 100 },
          },
          entry2: {
            analysis: { confidence: 0.9 },
            processing: { processingTimeMs: 200 },
          },
        },
      };

      cacheManager.recalculateIncrementalStats(cache, analysisHistory, state);

      expect(cache.incrementalStats.initialized).toBe(true);
      expect(cache.incrementalStats.totalConfidence).toBeCloseTo(1.7);
      expect(cache.incrementalStats.totalProcessingTime).toBe(300);
      expect(cache.incrementalStats.entryCount).toBe(2);
      expect(state._statsNeedFullRecalc).toBe(false);
    });

    test('handles entries with missing values', () => {
      const cache = cacheManager.createCacheStore();
      const state = { _statsNeedFullRecalc: true };
      const analysisHistory = {
        entries: {
          entry1: {
            analysis: {},
            processing: {},
          },
        },
      };

      cacheManager.recalculateIncrementalStats(cache, analysisHistory, state);

      expect(cache.incrementalStats.totalConfidence).toBe(0);
      expect(cache.incrementalStats.totalProcessingTime).toBe(0);
      expect(cache.incrementalStats.entryCount).toBe(1);
    });
  });

  describe('clearCaches', () => {
    test('calls invalidateCaches', () => {
      const cache = cacheManager.createCacheStore();
      const state = { _statsNeedFullRecalc: false };

      cache.sortedEntries = [{ id: 1 }];
      cache.statistics = { total: 10 };

      cacheManager.clearCaches(cache, state);

      expect(cache.sortedEntries).toBeNull();
      expect(cache.statistics).toBeNull();
    });
  });

  describe('warmCache', () => {
    test('warms cache with recent analysis', async () => {
      const cache = cacheManager.createCacheStore();
      const state = { _statsNeedFullRecalc: false };
      const analysisHistory = { entries: {} };
      const getRecentAnalysis = jest.fn().mockResolvedValue({ results: [] });

      await cacheManager.warmCache(cache, getRecentAnalysis, analysisHistory, state);

      expect(getRecentAnalysis).toHaveBeenCalledWith(50);
    });

    test('initializes incremental stats if needed', async () => {
      const cache = cacheManager.createCacheStore();
      const state = { _statsNeedFullRecalc: true };
      const analysisHistory = {
        entries: {
          entry1: {
            analysis: { confidence: 0.8 },
            processing: { processingTimeMs: 100 },
          },
        },
      };
      const getRecentAnalysis = jest.fn().mockResolvedValue({ results: [] });

      await cacheManager.warmCache(cache, getRecentAnalysis, analysisHistory, state);

      expect(cache.incrementalStats.initialized).toBe(true);
    });
  });
});
