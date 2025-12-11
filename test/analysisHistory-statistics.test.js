/**
 * Tests for Analysis History Statistics
 * Tests statistics calculation with incremental updates and caching
 */

// Mock dependencies
jest.mock('../src/main/services/analysisHistory/cacheManager', () => ({
  recalculateIncrementalStats: jest.fn()
}));

describe('statistics', () => {
  let statistics;
  let recalculateIncrementalStats;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    recalculateIncrementalStats =
      require('../src/main/services/analysisHistory/cacheManager').recalculateIncrementalStats;
    statistics = require('../src/main/services/analysisHistory/statistics');
  });

  describe('getOldestTimestamp', () => {
    test('returns oldest from sorted cache when valid', () => {
      const cache = {
        sortedEntriesValid: true,
        sortedEntries: [
          { timestamp: '2024-01-20' },
          { timestamp: '2024-01-15' },
          { timestamp: '2024-01-10' }
        ]
      };

      const result = statistics.getOldestTimestamp(cache, []);

      expect(result).toBe('2024-01-10');
    });

    test('finds oldest when cache not valid', () => {
      const cache = { sortedEntriesValid: false };
      const entries = [
        { timestamp: '2024-01-15' },
        { timestamp: '2024-01-10' },
        { timestamp: '2024-01-20' }
      ];

      const result = statistics.getOldestTimestamp(cache, entries);

      expect(result).toBe('2024-01-10');
    });

    test('returns null for empty entries', () => {
      const cache = { sortedEntriesValid: false };

      const result = statistics.getOldestTimestamp(cache, []);

      expect(result).toBeNull();
    });

    test('returns null for null entries', () => {
      const cache = { sortedEntriesValid: false };

      const result = statistics.getOldestTimestamp(cache, null);

      expect(result).toBeNull();
    });
  });

  describe('getNewestTimestamp', () => {
    test('returns newest from sorted cache when valid', () => {
      const cache = {
        sortedEntriesValid: true,
        sortedEntries: [
          { timestamp: '2024-01-20' },
          { timestamp: '2024-01-15' },
          { timestamp: '2024-01-10' }
        ]
      };

      const result = statistics.getNewestTimestamp(cache, []);

      expect(result).toBe('2024-01-20');
    });

    test('finds newest when cache not valid', () => {
      const cache = { sortedEntriesValid: false };
      const entries = [
        { timestamp: '2024-01-15' },
        { timestamp: '2024-01-20' },
        { timestamp: '2024-01-10' }
      ];

      const result = statistics.getNewestTimestamp(cache, entries);

      expect(result).toBe('2024-01-20');
    });

    test('returns null for empty entries', () => {
      const cache = { sortedEntriesValid: false };

      const result = statistics.getNewestTimestamp(cache, []);

      expect(result).toBeNull();
    });
  });

  describe('getTopItems', () => {
    test('returns top items by count', () => {
      const index = {
        documents: [1, 2, 3, 4, 5],
        images: [6, 7],
        audio: [8, 9, 10]
      };

      const result = statistics.getTopItems(index, 2);

      expect(result).toEqual([
        { name: 'documents', count: 5 },
        { name: 'audio', count: 3 }
      ]);
    });

    test('returns all items if limit exceeds count', () => {
      const index = {
        documents: [1],
        images: [2]
      };

      const result = statistics.getTopItems(index, 10);

      expect(result.length).toBe(2);
    });

    test('returns empty array for empty index', () => {
      const result = statistics.getTopItems({}, 5);

      expect(result).toEqual([]);
    });
  });

  describe('getSizeDistribution', () => {
    test('returns size distribution', () => {
      const sizeIndex = {
        tiny: [1, 2],
        small: [3, 4, 5],
        large: [6]
      };

      const result = statistics.getSizeDistribution(sizeIndex);

      expect(result).toEqual({
        tiny: 2,
        small: 3,
        large: 1
      });
    });

    test('returns empty object for empty index', () => {
      const result = statistics.getSizeDistribution({});

      expect(result).toEqual({});
    });
  });

  describe('getStatistics', () => {
    const createAnalysisHistory = () => ({
      entries: {
        1: { timestamp: '2024-01-15' },
        2: { timestamp: '2024-01-20' }
      },
      totalSize: 5000,
      updatedAt: '2024-01-20T10:00:00Z'
    });

    const createAnalysisIndex = () => ({
      categoryIndex: {
        documents: [1],
        images: [2]
      },
      tagIndex: {
        invoice: [1],
        photo: [2]
      },
      sizeIndex: {
        small: [1, 2]
      }
    });

    const createCache = () => ({
      statistics: null,
      statisticsTime: 0,
      incrementalStats: {
        initialized: true,
        totalConfidence: 1.5,
        totalProcessingTime: 300,
        entryCount: 2
      },
      sortedEntriesValid: false
    });

    test('calculates statistics from history', () => {
      const history = createAnalysisHistory();
      const index = createAnalysisIndex();
      const cache = createCache();
      const state = { _statsNeedFullRecalc: false };

      const result = statistics.getStatistics(history, index, cache, state, 30000);

      expect(result.totalFiles).toBe(2);
      expect(result.totalSize).toBe(5000);
      expect(result.categoriesCount).toBe(2);
      expect(result.tagsCount).toBe(2);
      expect(result.averageConfidence).toBe(0.75);
      expect(result.averageProcessingTime).toBe(150);
      expect(result.isEmpty).toBe(false);
    });

    test('uses cached statistics when valid', () => {
      const history = createAnalysisHistory();
      const index = createAnalysisIndex();
      const cachedStats = { totalFiles: 100 };
      const cache = {
        statistics: cachedStats,
        statisticsTime: Date.now(),
        incrementalStats: { initialized: true, entryCount: 100 }
      };
      const state = {};

      const result = statistics.getStatistics(history, index, cache, state, 30000);

      expect(result).toBe(cachedStats);
    });

    test('recalculates when stats need full recalc', () => {
      const history = createAnalysisHistory();
      const index = createAnalysisIndex();
      const cache = {
        statistics: null,
        statisticsTime: 0,
        incrementalStats: { initialized: false },
        sortedEntriesValid: false
      };
      const state = { _statsNeedFullRecalc: true };

      statistics.getStatistics(history, index, cache, state, 30000);

      expect(recalculateIncrementalStats).toHaveBeenCalled();
    });

    test('returns empty statistics for no entries', () => {
      const history = { entries: {}, totalSize: 0, updatedAt: null };
      const index = { categoryIndex: {}, tagIndex: {}, sizeIndex: {} };
      const cache = {
        statistics: null,
        statisticsTime: 0,
        incrementalStats: { initialized: true, entryCount: 0 },
        sortedEntriesValid: false
      };
      const state = {};

      const result = statistics.getStatistics(history, index, cache, state, 30000);

      expect(result.totalFiles).toBe(0);
      expect(result.isEmpty).toBe(true);
      expect(result.averageConfidence).toBe(0);
    });

    test('caches calculated statistics', () => {
      const history = createAnalysisHistory();
      const index = createAnalysisIndex();
      const cache = createCache();
      const state = {};

      statistics.getStatistics(history, index, cache, state, 30000);

      expect(cache.statistics).not.toBeNull();
      expect(cache.statisticsTime).toBeGreaterThan(0);
    });
  });

  describe('getQuickStats', () => {
    test('returns quick stats without full calculation', () => {
      const history = {
        entries: { 1: {}, 2: {}, 3: {} },
        totalSize: 10000,
        updatedAt: '2024-01-20T10:00:00Z'
      };
      const index = {
        categoryIndex: { a: [], b: [] },
        tagIndex: { x: [], y: [], z: [] }
      };

      const result = statistics.getQuickStats(history, index);

      expect(result.totalFiles).toBe(3);
      expect(result.totalSize).toBe(10000);
      expect(result.categoriesCount).toBe(2);
      expect(result.tagsCount).toBe(3);
      expect(result.lastUpdated).toBe('2024-01-20T10:00:00Z');
    });
  });
});
