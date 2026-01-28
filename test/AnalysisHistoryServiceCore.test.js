/**
 * Tests for AnalysisHistoryServiceCore
 * Tests the core analysis history service functionality
 */

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/mock/userData')
  }
}));

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
  LIMITS: {
    MAX_HISTORY_ENTRIES: 10000,
    MAX_QUEUE_SIZE: 3
  },
  TIMEOUTS: {
    MUTEX_ACQUIRE: 50,
    DELAY_LOCK_RETRY: 5
  }
}));

// Mock cacheManager
const mockCacheStore = {
  stats: { data: null, timestamp: 0 },
  recent: { data: null, timestamp: 0 },
  search: new Map(),
  category: new Map(),
  tag: new Map(),
  incrementalStats: null
};

jest.mock('../src/main/services/analysisHistory/cacheManager', () => ({
  createCacheStore: jest.fn(() => ({ ...mockCacheStore })),
  getCacheTTLs: jest.fn(() => ({
    CACHE_TTL_MS: 60000,
    STATS_CACHE_TTL_MS: 30000,
    SEARCH_CACHE_TTL_MS: 10000
  })),
  invalidateCachesOnAdd: jest.fn(),
  invalidateCachesOnRemove: jest.fn(),
  updateIncrementalStatsOnAdd: jest.fn(),
  updateIncrementalStatsOnRemove: jest.fn(),
  clearCaches: jest.fn(),
  warmCache: jest.fn()
}));

// Mock persistence
jest.mock('../src/main/services/analysisHistory/persistence', () => ({
  loadConfig: jest.fn().mockResolvedValue({ schemaVersion: '1.0.0' }),
  saveConfig: jest.fn().mockResolvedValue(undefined),
  loadHistory: jest.fn().mockResolvedValue({
    schemaVersion: '1.0.0',
    entries: {},
    totalAnalyzed: 0,
    totalSize: 0,
    metadata: { totalEntries: 0 }
  }),
  saveHistory: jest.fn().mockResolvedValue(undefined),
  loadIndex: jest.fn().mockResolvedValue({
    schemaVersion: '1.0.0',
    byPath: {},
    byCategory: {},
    byTag: {},
    byDate: {}
  }),
  saveIndex: jest.fn().mockResolvedValue(undefined),
  createDefaultStructures: jest.fn().mockResolvedValue({
    config: { schemaVersion: '1.0.0' },
    history: { entries: {}, totalAnalyzed: 0, totalSize: 0, metadata: {} },
    index: { byPath: {}, byCategory: {}, byTag: {}, byDate: {} }
  })
}));

// Mock indexManager
jest.mock('../src/main/services/analysisHistory/indexManager', () => ({
  createEmptyIndex: jest.fn((version) => ({
    schemaVersion: version,
    byPath: {},
    byCategory: {},
    byTag: {},
    byDate: {}
  })),
  generateFileHash: jest.fn((path, size, lastModified) => `hash-${path}-${size}-${lastModified}`),
  updateIndexes: jest.fn(),
  removeFromIndexes: jest.fn()
}));

// Mock search
jest.mock('../src/main/services/analysisHistory/search', () => ({
  searchAnalysis: jest.fn().mockResolvedValue([])
}));

// Mock statistics
jest.mock('../src/main/services/analysisHistory/statistics', () => ({
  getStatistics: jest.fn().mockResolvedValue({
    totalFiles: 0,
    totalSize: 0,
    categories: {}
  }),
  getQuickStats: jest.fn().mockResolvedValue({
    totalFiles: 0,
    recentCount: 0
  })
}));

// Mock queries
jest.mock('../src/main/services/analysisHistory/queries', () => ({
  getAnalysisByPath: jest.fn().mockResolvedValue(null),
  getAnalysisByCategory: jest.fn().mockResolvedValue([]),
  getAnalysisByTag: jest.fn().mockResolvedValue([]),
  getRecentAnalysis: jest.fn().mockResolvedValue([]),
  getAnalysisByDateRange: jest.fn().mockResolvedValue([]),
  getCategories: jest.fn().mockResolvedValue([]),
  getTags: jest.fn().mockResolvedValue([])
}));

// Mock maintenance
jest.mock('../src/main/services/analysisHistory/maintenance', () => ({
  performMaintenanceIfNeeded: jest.fn().mockResolvedValue(undefined),
  migrateHistory: jest.fn((history) => history)
}));

describe('AnalysisHistoryServiceCore', () => {
  let AnalysisHistoryServiceCore;
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    AnalysisHistoryServiceCore = require('../src/main/services/analysisHistory/AnalysisHistoryServiceCore');
    service = new AnalysisHistoryServiceCore();
  });

  describe('constructor', () => {
    test('initializes with correct paths', () => {
      expect(service.userDataPath).toBe('/mock/userData');
      expect(service.historyPath).toContain('analysis-history.json');
      expect(service.indexPath).toContain('analysis-index.json');
      expect(service.configPath).toContain('analysis-config.json');
    });

    test('initializes with null state', () => {
      expect(service.analysisHistory).toBeNull();
      expect(service.analysisIndex).toBeNull();
      expect(service.config).toBeNull();
      expect(service.initialized).toBe(false);
    });

    test('sets schema version', () => {
      expect(service.SCHEMA_VERSION).toBe('1.0.0');
    });

    test('creates cache store', () => {
      expect(service._cache).toBeDefined();
    });
  });

  describe('getDefaultConfig', () => {
    test('returns default configuration', () => {
      const config = service.getDefaultConfig();

      expect(config.schemaVersion).toBe('1.0.0');
      expect(config.retentionDays).toBe(365);
      expect(config.enableRAG).toBe(true);
      expect(config.enableFullTextSearch).toBe(true);
      expect(config.backupEnabled).toBe(true);
      expect(config.createdAt).toBeDefined();
      expect(config.updatedAt).toBeDefined();
    });
  });

  describe('createEmptyHistory', () => {
    test('returns empty history structure', () => {
      const history = service.createEmptyHistory();

      expect(history.schemaVersion).toBe('1.0.0');
      expect(history.totalAnalyzed).toBe(0);
      expect(history.totalSize).toBe(0);
      expect(history.entries).toEqual({});
      expect(history.metadata).toBeDefined();
      expect(history.createdAt).toBeDefined();
    });
  });

  describe('initialize', () => {
    test('initializes successfully', async () => {
      await service.initialize();

      expect(service.initialized).toBe(true);
    });

    test('skips if already initialized', async () => {
      service.initialized = true;

      await service.initialize();

      const { loadConfig } = require('../src/main/services/analysisHistory/persistence');
      expect(loadConfig).not.toHaveBeenCalled();
    });

    test('creates default structures on error', async () => {
      const {
        loadConfig,
        createDefaultStructures
      } = require('../src/main/services/analysisHistory/persistence');
      loadConfig.mockRejectedValueOnce(new Error('Load failed'));

      await service.initialize();

      expect(createDefaultStructures).toHaveBeenCalled();
      expect(service.initialized).toBe(true);
    });
  });

  describe('recordAnalysis', () => {
    const mockFileInfo = {
      path: '/test/file.pdf',
      size: 1024,
      lastModified: '2024-01-01T00:00:00Z',
      mimeType: 'application/pdf'
    };

    const mockAnalysisResults = {
      subject: 'Test Document',
      category: 'documents',
      tags: ['test', 'pdf'],
      confidence: 0.85,
      summary: 'A test document',
      model: 'test-model',
      processingTime: 500
    };

    beforeEach(async () => {
      jest.useFakeTimers();
      await service.initialize();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    // Helper to flush write buffer - need to run timers and allow async to complete
    const flushWriteBuffer = async () => {
      // Run all pending timers
      jest.runAllTimers();
      // Allow microtasks to flush using Promise.resolve chain
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    };

    test('records analysis entry', async () => {
      const recordPromise = service.recordAnalysis(mockFileInfo, mockAnalysisResults);
      await flushWriteBuffer();
      const id = await recordPromise;

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    test('updates history totals', async () => {
      const recordPromise = service.recordAnalysis(mockFileInfo, mockAnalysisResults);
      await flushWriteBuffer();
      await recordPromise;

      expect(service.analysisHistory.totalAnalyzed).toBe(1);
      expect(service.analysisHistory.totalSize).toBe(1024);
    });

    test('updates indexes', async () => {
      const { updateIndexes } = require('../src/main/services/analysisHistory/indexManager');

      const recordPromise = service.recordAnalysis(mockFileInfo, mockAnalysisResults);
      await flushWriteBuffer();
      await recordPromise;

      expect(updateIndexes).toHaveBeenCalled();
    });

    test('invalidates caches', async () => {
      const {
        invalidateCachesOnAdd
      } = require('../src/main/services/analysisHistory/cacheManager');

      const recordPromise = service.recordAnalysis(mockFileInfo, mockAnalysisResults);
      await flushWriteBuffer();
      await recordPromise;

      expect(invalidateCachesOnAdd).toHaveBeenCalled();
    });

    test('saves history and index', async () => {
      const {
        saveHistory,
        saveIndex
      } = require('../src/main/services/analysisHistory/persistence');

      const recordPromise = service.recordAnalysis(mockFileInfo, mockAnalysisResults);
      await flushWriteBuffer();
      await recordPromise;

      expect(saveHistory).toHaveBeenCalled();
      expect(saveIndex).toHaveBeenCalled();
    });

    test('performs maintenance if needed', async () => {
      const {
        performMaintenanceIfNeeded
      } = require('../src/main/services/analysisHistory/maintenance');

      const recordPromise = service.recordAnalysis(mockFileInfo, mockAnalysisResults);
      await flushWriteBuffer();
      await recordPromise;

      expect(performMaintenanceIfNeeded).toHaveBeenCalled();
    });

    test('rejects when write buffer is full', async () => {
      service.MAX_PENDING_WRITES = 1;
      const firstRecord = service.recordAnalysis(mockFileInfo, mockAnalysisResults);

      await expect(service.recordAnalysis(mockFileInfo, mockAnalysisResults)).rejects.toMatchObject(
        { code: 'WRITE_BUFFER_FULL' }
      );

      await flushWriteBuffer();
      await firstRecord;
    });

    test('recovers from stale write lock after timeout', async () => {
      service._writeLock = new Promise(() => {});

      const acquirePromise = service._acquireWriteLock('test-timeout');
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      const releaseLock = await acquirePromise;
      expect(typeof releaseLock).toBe('function');

      releaseLock();
      expect(service._writeLock).toBeNull();
    });
  });

  describe('searchAnalysis', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    test('delegates to search helper', async () => {
      const { searchAnalysis } = require('../src/main/services/analysisHistory/search');
      searchAnalysis.mockResolvedValueOnce([{ id: 'result-1' }]);

      const results = await service.searchAnalysis('test query');

      expect(searchAnalysis).toHaveBeenCalled();
      expect(results).toEqual([{ id: 'result-1' }]);
    });

    test('passes options to search', async () => {
      const { searchAnalysis } = require('../src/main/services/analysisHistory/search');

      await service.searchAnalysis('query', { limit: 10 });

      expect(searchAnalysis).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'query',
        { limit: 10 }
      );
    });
  });

  describe('removeEntriesByPath', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    test('removes entries that match originalPath or organization.actual', async () => {
      // Seed history with two entries pointing to the same current file via different fields.
      service.analysisHistory.entries = {
        a: {
          id: 'a',
          fileHash: 'h1',
          timestamp: new Date().toISOString(),
          originalPath: '/old/file.pdf',
          fileName: 'file.pdf',
          fileSize: 1,
          analysis: { tags: [] },
          organization: { actual: '/new/file.pdf' }
        },
        b: {
          id: 'b',
          fileHash: 'h2',
          timestamp: new Date().toISOString(),
          originalPath: '/new/file.pdf',
          fileName: 'file.pdf',
          fileSize: 1,
          analysis: { tags: [] },
          organization: {}
        }
      };

      const res = await service.removeEntriesByPath('/new/file.pdf');
      expect(res.removed).toBe(2);
      expect(Object.keys(service.analysisHistory.entries)).toHaveLength(0);
    });
  });

  describe('getAnalysisByPath', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    test('returns analysis for path', async () => {
      const { getAnalysisByPath } = require('../src/main/services/analysisHistory/queries');
      getAnalysisByPath.mockResolvedValueOnce({ id: 'entry-1' });

      const result = await service.getAnalysisByPath('/test/file.pdf');

      expect(result).toEqual({ id: 'entry-1' });
    });
  });

  describe('getAnalysisByCategory', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    test('returns entries for category', async () => {
      const { getAnalysisByCategory } = require('../src/main/services/analysisHistory/queries');
      getAnalysisByCategory.mockResolvedValueOnce([{ id: 'entry-1' }]);

      const results = await service.getAnalysisByCategory('documents');

      expect(results).toEqual([{ id: 'entry-1' }]);
    });
  });

  describe('getAnalysisByTag', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    test('returns entries for tag', async () => {
      const { getAnalysisByTag } = require('../src/main/services/analysisHistory/queries');
      getAnalysisByTag.mockResolvedValueOnce([{ id: 'entry-1' }]);

      const results = await service.getAnalysisByTag('important');

      expect(results).toEqual([{ id: 'entry-1' }]);
    });
  });

  describe('getRecentAnalysis', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    test('returns recent entries with defaults', async () => {
      const { getRecentAnalysis } = require('../src/main/services/analysisHistory/queries');
      getRecentAnalysis.mockResolvedValueOnce([{ id: 'recent-1' }]);

      const results = await service.getRecentAnalysis();

      expect(getRecentAnalysis).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        50,
        0
      );
      expect(results).toEqual([{ id: 'recent-1' }]);
    });

    test('respects limit and offset', async () => {
      const { getRecentAnalysis } = require('../src/main/services/analysisHistory/queries');

      await service.getRecentAnalysis(20, 10);

      expect(getRecentAnalysis).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        20,
        10
      );
    });
  });

  describe('getStatistics', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    test('returns statistics', async () => {
      const { getStatistics } = require('../src/main/services/analysisHistory/statistics');
      getStatistics.mockResolvedValueOnce({ totalFiles: 100 });

      const stats = await service.getStatistics();

      expect(stats).toEqual({ totalFiles: 100 });
    });
  });

  describe('getQuickStats', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    test('returns quick stats', async () => {
      const { getQuickStats } = require('../src/main/services/analysisHistory/statistics');
      getQuickStats.mockResolvedValueOnce({ totalFiles: 50 });

      const stats = await service.getQuickStats();

      expect(stats).toEqual({ totalFiles: 50 });
    });
  });

  describe('getAnalysisByDateRange', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    test('returns entries in date range', async () => {
      const { getAnalysisByDateRange } = require('../src/main/services/analysisHistory/queries');
      getAnalysisByDateRange.mockResolvedValueOnce([{ id: 'entry-1' }]);

      const results = await service.getAnalysisByDateRange(
        new Date('2024-01-01'),
        new Date('2024-12-31')
      );

      expect(results).toEqual([{ id: 'entry-1' }]);
    });
  });

  describe('getCategories', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    test('returns available categories', async () => {
      const { getCategories } = require('../src/main/services/analysisHistory/queries');
      getCategories.mockResolvedValueOnce(['documents', 'images']);

      const categories = await service.getCategories();

      expect(categories).toEqual(['documents', 'images']);
    });
  });

  describe('getTags', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    test('returns available tags', async () => {
      const { getTags } = require('../src/main/services/analysisHistory/queries');
      getTags.mockResolvedValueOnce(['important', 'work']);

      const tags = await service.getTags();

      expect(tags).toEqual(['important', 'work']);
    });
  });

  describe('warmCache', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    test('warms cache', async () => {
      const { warmCache } = require('../src/main/services/analysisHistory/cacheManager');

      await service.warmCache();

      expect(warmCache).toHaveBeenCalled();
    });
  });

  describe('clearCaches', () => {
    test('clears all caches', () => {
      const { clearCaches } = require('../src/main/services/analysisHistory/cacheManager');

      service.clearCaches();

      expect(clearCaches).toHaveBeenCalled();
    });
  });
});
