/**
 * Tests for ChromaDBServiceCore
 * Tests the core ChromaDB vector database service functionality
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

// Mock config
jest.mock('../src/shared/config/index', () => ({
  get: jest.fn((key, defaultValue) => defaultValue)
}));

// Mock performanceConstants
jest.mock('../src/shared/performanceConstants', () => ({
  NETWORK: {
    MAX_PORT: 65535,
    MIN_PORT: 1
  },
  TIMEOUTS: {
    HEALTH_CHECK: 5000
  }
}));

// Mock promiseUtils
jest.mock('../src/shared/promiseUtils', () => ({
  withTimeout: jest.fn((promise) => promise)
}));

// Mock fs
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue(''),
    rm: jest.fn().mockResolvedValue(undefined)
  },
  existsSync: jest.fn().mockReturnValue(false)
}));

// Mock chromadb
const mockCollection = {
  add: jest.fn().mockResolvedValue(undefined),
  upsert: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(undefined),
  query: jest.fn().mockResolvedValue({ ids: [[]], distances: [[]], metadatas: [[]] }),
  get: jest.fn().mockResolvedValue({ ids: [], metadatas: [] }),
  count: jest.fn().mockResolvedValue(0)
};

jest.mock('chromadb', () => ({
  ChromaClient: jest.fn().mockImplementation(() => ({
    getOrCreateCollection: jest.fn().mockResolvedValue(mockCollection),
    deleteCollection: jest.fn().mockResolvedValue(undefined)
  }))
}));

// Mock CircuitBreaker
const mockCircuitBreaker = {
  isAllowed: jest.fn().mockReturnValue(true),
  isAvailable: jest.fn().mockReturnValue(true),
  execute: jest.fn((fn) => fn()),
  recordSuccess: jest.fn(),
  recordFailure: jest.fn(),
  getState: jest.fn().mockReturnValue('CLOSED'),
  getStats: jest.fn().mockReturnValue({ failures: 0, successes: 0 }),
  reset: jest.fn(),
  cleanup: jest.fn(),
  on: jest.fn()
};

jest.mock('../src/main/utils/CircuitBreaker', () => ({
  CircuitBreaker: jest.fn().mockImplementation(() => mockCircuitBreaker),
  CircuitState: {
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    HALF_OPEN: 'HALF_OPEN'
  }
}));

// Mock OfflineQueue
const mockOfflineQueue = {
  initialize: jest.fn().mockResolvedValue(undefined),
  enqueue: jest.fn(),
  flush: jest.fn().mockResolvedValue({ processed: 0, failed: 0, remaining: 0 }),
  isEmpty: jest.fn().mockReturnValue(true),
  size: jest.fn().mockReturnValue(0),
  getStats: jest.fn().mockReturnValue({ size: 0, pending: 0 }),
  cleanup: jest.fn().mockResolvedValue(undefined),
  on: jest.fn()
};

jest.mock('../src/main/utils/OfflineQueue', () => ({
  OfflineQueue: jest.fn().mockImplementation(() => mockOfflineQueue),
  OperationType: {
    UPSERT_FILE: 'UPSERT_FILE',
    UPSERT_FOLDER: 'UPSERT_FOLDER',
    DELETE_FILE: 'DELETE_FILE',
    DELETE_FOLDER: 'DELETE_FOLDER',
    BATCH_UPSERT_FILES: 'BATCH_UPSERT_FILES',
    BATCH_UPSERT_FOLDERS: 'BATCH_UPSERT_FOLDERS',
    BATCH_DELETE_FILES: 'BATCH_DELETE_FILES',
    BATCH_DELETE_FOLDERS: 'BATCH_DELETE_FOLDERS',
    UPDATE_FILE_PATHS: 'UPDATE_FILE_PATHS'
  }
}));

// Mock ChromaQueryCache
const mockQueryCache = {
  get: jest.fn().mockReturnValue(null),
  set: jest.fn(),
  clear: jest.fn(),
  invalidateForFile: jest.fn(),
  invalidateForFolder: jest.fn(),
  getStats: jest.fn().mockReturnValue({ hits: 0, misses: 0, size: 0 })
};

jest.mock('../src/main/services/chromadb/ChromaQueryCache', () => ({
  ChromaQueryCache: jest.fn().mockImplementation(() => mockQueryCache)
}));

// Mock health checker
jest.mock('../src/main/services/chromadb/ChromaHealthChecker', () => ({
  checkHealthViaHttp: jest.fn().mockResolvedValue({ healthy: true }),
  checkHealthViaClient: jest.fn().mockResolvedValue(true),
  isServerAvailable: jest.fn().mockResolvedValue(true)
}));

// Mock file operations
jest.mock('../src/main/services/chromadb/fileOperations', () => ({
  directUpsertFile: jest.fn().mockResolvedValue({ success: true }),
  directBatchUpsertFiles: jest.fn().mockResolvedValue(5),
  deleteFileEmbedding: jest.fn().mockResolvedValue(undefined),
  batchDeleteFileEmbeddings: jest.fn().mockResolvedValue(3),
  updateFilePaths: jest.fn().mockResolvedValue({ updated: 2 }),
  querySimilarFiles: jest.fn().mockResolvedValue([]),
  resetFiles: jest.fn().mockResolvedValue(mockCollection)
}));

// Mock folder operations
jest.mock('../src/main/services/chromadb/folderOperations', () => ({
  directUpsertFolder: jest.fn().mockResolvedValue({ success: true }),
  directBatchUpsertFolders: jest.fn().mockResolvedValue({ count: 3, skipped: [] }),
  queryFoldersByEmbedding: jest.fn().mockResolvedValue([]),
  executeQueryFolders: jest.fn().mockResolvedValue([]),
  batchQueryFolders: jest.fn().mockResolvedValue(new Map()),
  getAllFolders: jest.fn().mockResolvedValue([]),
  resetFolders: jest.fn().mockResolvedValue(mockCollection)
}));

describe('ChromaDBServiceCore', () => {
  let ChromaDBServiceCore;
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Reset environment
    delete process.env.CHROMA_SERVER_URL;
    delete process.env.CHROMA_SERVER_HOST;
    delete process.env.CHROMA_SERVER_PORT;
    delete process.env.CHROMA_SERVER_PROTOCOL;

    const module = require('../src/main/services/chromadb/ChromaDBServiceCore');
    ChromaDBServiceCore = module.ChromaDBServiceCore;
    service = new ChromaDBServiceCore();
  });

  describe('constructor', () => {
    test('initializes with default server config', () => {
      expect(service.serverHost).toBe('127.0.0.1');
      expect(service.serverPort).toBe(8000);
      expect(service.serverProtocol).toBe('http');
    });

    test('initializes circuit breaker', () => {
      const { CircuitBreaker } = require('../src/main/utils/CircuitBreaker');
      expect(CircuitBreaker).toHaveBeenCalled();
    });

    test('initializes offline queue', () => {
      const { OfflineQueue } = require('../src/main/utils/OfflineQueue');
      expect(OfflineQueue).toHaveBeenCalled();
    });

    test('initializes query cache', () => {
      const { ChromaQueryCache } = require('../src/main/services/chromadb/ChromaQueryCache');
      expect(ChromaQueryCache).toHaveBeenCalled();
    });

    test('starts not initialized', () => {
      expect(service.initialized).toBe(false);
      expect(service.isOnline).toBe(false);
    });
  });

  describe('server configuration', () => {
    test('parses CHROMA_SERVER_URL environment variable', () => {
      process.env.CHROMA_SERVER_URL = 'http://localhost:9000';

      jest.resetModules();
      const module = require('../src/main/services/chromadb/ChromaDBServiceCore');
      const newService = new module.ChromaDBServiceCore();

      expect(newService.serverHost).toBe('localhost');
      expect(newService.serverPort).toBe(9000);
    });

    test('uses defaults for invalid URL', () => {
      process.env.CHROMA_SERVER_URL = 'invalid-url';

      jest.resetModules();
      const module = require('../src/main/services/chromadb/ChromaDBServiceCore');
      const newService = new module.ChromaDBServiceCore();

      expect(newService.serverHost).toBe('127.0.0.1');
      expect(newService.serverPort).toBe(8000);
    });
  });

  describe('initialize', () => {
    test('initializes successfully', async () => {
      await service.initialize();

      expect(service.initialized).toBe(true);
      expect(service.isOnline).toBe(true);
    });

    test('handles concurrent initialization calls', async () => {
      // Both concurrent calls should complete without error
      await Promise.all([service.initialize(), service.initialize()]);

      // Service should be initialized after both complete
      expect(service.initialized).toBe(true);
    });

    test('skips if already initialized and healthy', async () => {
      await service.initialize();

      const { checkHealthViaHttp } = require('../src/main/services/chromadb/ChromaHealthChecker');
      checkHealthViaHttp.mockResolvedValueOnce({ healthy: true });

      await service.initialize();

      // Should not throw
      expect(service.initialized).toBe(true);
    });
  });

  describe('checkHealth', () => {
    test('returns true when healthy', async () => {
      const { checkHealthViaHttp } = require('../src/main/services/chromadb/ChromaHealthChecker');
      checkHealthViaHttp.mockResolvedValueOnce({ healthy: true });

      const result = await service.checkHealth();

      expect(result).toBe(true);
      expect(mockCircuitBreaker.recordSuccess).toHaveBeenCalled();
    });

    test('returns false when unhealthy', async () => {
      const {
        checkHealthViaHttp,
        checkHealthViaClient
      } = require('../src/main/services/chromadb/ChromaHealthChecker');
      checkHealthViaHttp.mockResolvedValueOnce({ healthy: false });
      checkHealthViaClient.mockResolvedValueOnce(false);

      const result = await service.checkHealth();

      expect(result).toBe(false);
      expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();
    });
  });

  describe('upsertFile', () => {
    const mockFile = {
      id: 'file-1',
      vector: [0.1, 0.2, 0.3],
      meta: { name: 'test.pdf' }
    };

    test('upserts file when circuit is closed', async () => {
      await service.initialize();

      const result = await service.upsertFile(mockFile);

      expect(result.success).toBe(true);
    });

    test('queues operation when circuit is open', async () => {
      mockCircuitBreaker.isAllowed.mockReturnValueOnce(false);

      const result = await service.upsertFile(mockFile);

      expect(result.queued).toBe(true);
      expect(mockOfflineQueue.enqueue).toHaveBeenCalled();
    });

    test('throws on invalid file data', async () => {
      await expect(service.upsertFile({ id: 'no-vector' })).rejects.toThrow('Invalid file data');
    });
  });

  describe('batchUpsertFiles', () => {
    const mockFiles = [
      { id: 'file-1', vector: [0.1, 0.2], meta: {} },
      { id: 'file-2', vector: [0.3, 0.4], meta: {} }
    ];

    test('batch upserts files', async () => {
      await service.initialize();

      const result = await service.batchUpsertFiles(mockFiles);

      expect(result.queued).toBe(false);
      expect(result.count).toBe(5);
    });

    test('returns early for empty array', async () => {
      const result = await service.batchUpsertFiles([]);

      expect(result.count).toBe(0);
    });

    test('queues when circuit is open', async () => {
      mockCircuitBreaker.isAllowed.mockReturnValueOnce(false);

      const result = await service.batchUpsertFiles(mockFiles);

      expect(result.queued).toBe(true);
    });
  });

  describe('deleteFileEmbedding', () => {
    test('deletes file embedding', async () => {
      await service.initialize();

      const { deleteFileEmbedding } = require('../src/main/services/chromadb/fileOperations');

      await service.deleteFileEmbedding('file-1');

      expect(deleteFileEmbedding).toHaveBeenCalled();
    });
  });

  describe('batchDeleteFileEmbeddings', () => {
    test('batch deletes file embeddings', async () => {
      await service.initialize();

      const result = await service.batchDeleteFileEmbeddings(['file-1', 'file-2']);

      expect(result.count).toBe(3);
    });

    test('returns early for empty array', async () => {
      const result = await service.batchDeleteFileEmbeddings([]);

      expect(result.count).toBe(0);
    });
  });

  describe('upsertFolder', () => {
    const mockFolder = {
      id: 'folder-1',
      vector: [0.1, 0.2, 0.3],
      name: 'Documents'
    };

    test('upserts folder', async () => {
      await service.initialize();

      const result = await service.upsertFolder(mockFolder);

      expect(result.success).toBe(true);
    });

    test('queues when circuit is open', async () => {
      mockCircuitBreaker.isAllowed.mockReturnValueOnce(false);

      const result = await service.upsertFolder(mockFolder);

      expect(result.queued).toBe(true);
    });

    test('throws on invalid folder data', async () => {
      await expect(service.upsertFolder({ id: 'no-vector' })).rejects.toThrow(
        'Invalid folder data'
      );
    });
  });

  describe('batchUpsertFolders', () => {
    const mockFolders = [
      { id: 'folder-1', vector: [0.1, 0.2], name: 'Docs' },
      { id: 'folder-2', vector: [0.3, 0.4], name: 'Images' }
    ];

    test('batch upserts folders', async () => {
      await service.initialize();

      const result = await service.batchUpsertFolders(mockFolders);

      expect(result.queued).toBe(false);
    });

    test('returns early for empty array', async () => {
      const result = await service.batchUpsertFolders([]);

      expect(result.count).toBe(0);
    });
  });

  describe('queryFolders', () => {
    test('queries folders for file', async () => {
      await service.initialize();

      const { executeQueryFolders } = require('../src/main/services/chromadb/folderOperations');
      executeQueryFolders.mockResolvedValueOnce([{ id: 'folder-1', score: 0.9 }]);

      const results = await service.queryFolders('file-1', 5);

      expect(results).toHaveLength(1);
    });

    test('returns cached results', async () => {
      await service.initialize();

      mockQueryCache.get.mockReturnValueOnce([{ id: 'cached-folder' }]);

      const results = await service.queryFolders('file-1', 5);

      expect(results).toEqual([{ id: 'cached-folder' }]);
    });

    test('deduplicates concurrent queries', async () => {
      await service.initialize();

      const { executeQueryFolders } = require('../src/main/services/chromadb/folderOperations');

      // Track how many times executeQueryFolders is called
      let callCount = 0;
      executeQueryFolders.mockImplementation(() => {
        callCount++;
        return Promise.resolve([{ id: 'folder-1' }]);
      });

      // Make concurrent queries with same key
      const [result1, result2] = await Promise.all([
        service.queryFolders('file-1', 5),
        service.queryFolders('file-1', 5)
      ]);

      // Both should return same results
      expect(result1).toEqual(result2);
      expect(callCount).toBe(1);
      // The function was only called once due to cache hit on second call
      // (first call populates cache, second call hits cache)
    });
  });

  describe('queryFoldersByEmbedding', () => {
    test('queries folders by embedding vector', async () => {
      await service.initialize();

      const { queryFoldersByEmbedding } = require('../src/main/services/chromadb/folderOperations');
      queryFoldersByEmbedding.mockResolvedValueOnce([{ id: 'folder-1' }]);

      const results = await service.queryFoldersByEmbedding([0.1, 0.2], 5);

      expect(queryFoldersByEmbedding).toHaveBeenCalled();
      expect(results).toEqual([{ id: 'folder-1' }]);
    });
  });

  describe('getAllFolders', () => {
    test('gets all folders', async () => {
      await service.initialize();

      const { getAllFolders } = require('../src/main/services/chromadb/folderOperations');
      getAllFolders.mockResolvedValueOnce([{ id: 'folder-1' }, { id: 'folder-2' }]);

      const results = await service.getAllFolders();

      expect(results).toHaveLength(2);
    });
  });

  describe('querySimilarFiles', () => {
    test('queries similar files', async () => {
      await service.initialize();

      const { querySimilarFiles } = require('../src/main/services/chromadb/fileOperations');
      querySimilarFiles.mockResolvedValueOnce([{ id: 'similar-1' }]);

      const results = await service.querySimilarFiles([0.1, 0.2], 10);

      expect(results).toHaveLength(1);
    });
  });

  describe('updateFilePaths', () => {
    test('updates file paths', async () => {
      await service.initialize();

      const pathUpdates = [{ id: 'file-1', newPath: '/new/path.pdf' }];

      const { updateFilePaths } = require('../src/main/services/chromadb/fileOperations');

      await service.updateFilePaths(pathUpdates);

      expect(updateFilePaths).toHaveBeenCalled();
    });
  });

  describe('resetFiles', () => {
    test('resets file collection', async () => {
      await service.initialize();

      const { resetFiles } = require('../src/main/services/chromadb/fileOperations');

      await service.resetFiles();

      expect(resetFiles).toHaveBeenCalled();
    });
  });

  describe('resetFolders', () => {
    test('resets folder collection', async () => {
      await service.initialize();

      const { resetFolders } = require('../src/main/services/chromadb/folderOperations');

      await service.resetFolders();

      expect(resetFolders).toHaveBeenCalled();
    });
  });

  describe('resetAll', () => {
    test('resets both collections', async () => {
      await service.initialize();

      const { resetFiles } = require('../src/main/services/chromadb/fileOperations');
      const { resetFolders } = require('../src/main/services/chromadb/folderOperations');

      await service.resetAll();

      expect(resetFiles).toHaveBeenCalled();
      expect(resetFolders).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    test('returns service statistics', async () => {
      await service.initialize();

      const stats = await service.getStats();

      expect(stats).toHaveProperty('files');
      expect(stats).toHaveProperty('folders');
      expect(stats).toHaveProperty('dbPath');
      expect(stats).toHaveProperty('serverUrl');
      expect(stats).toHaveProperty('initialized');
      expect(stats).toHaveProperty('queryCache');
    });
  });

  describe('circuit breaker methods', () => {
    test('getCircuitState returns state', () => {
      const state = service.getCircuitState();
      expect(state).toBe('CLOSED');
    });

    test('getCircuitStats returns stats', () => {
      const stats = service.getCircuitStats();
      expect(stats).toHaveProperty('failures');
    });

    test('isServiceAvailable returns availability', () => {
      const available = service.isServiceAvailable();
      expect(available).toBe(true);
    });

    test('forceRecovery resets circuit breaker', () => {
      service.forceRecovery();
      expect(mockCircuitBreaker.reset).toHaveBeenCalled();
    });
  });

  describe('queue methods', () => {
    test('getQueueStats returns queue stats', () => {
      const stats = service.getQueueStats();
      expect(stats).toHaveProperty('size');
    });
  });

  describe('health monitoring', () => {
    test('startHealthCheck starts interval', () => {
      jest.useFakeTimers();

      service.startHealthCheck();

      expect(service.healthCheckInterval).toBeDefined();

      service.stopHealthCheck();
      jest.useRealTimers();
    });

    test('stopHealthCheck clears interval', () => {
      jest.useFakeTimers();

      service.startHealthCheck();
      service.stopHealthCheck();

      expect(service.healthCheckInterval).toBeNull();

      jest.useRealTimers();
    });
  });

  describe('cache methods', () => {
    test('clearQueryCache clears cache', () => {
      service.clearQueryCache();
      expect(mockQueryCache.clear).toHaveBeenCalled();
    });

    test('getQueryCacheStats returns stats', () => {
      const stats = service.getQueryCacheStats();
      expect(stats).toHaveProperty('hits');
    });

    test('legacy cache methods work', () => {
      service._setCachedQuery('key', 'data');
      expect(mockQueryCache.set).toHaveBeenCalledWith('key', 'data');

      service._getCachedQuery('key');
      expect(mockQueryCache.get).toHaveBeenCalledWith('key');

      service._invalidateCacheForFile('file-1');
      expect(mockQueryCache.invalidateForFile).toHaveBeenCalledWith('file-1');

      service._invalidateCacheForFolder();
      expect(mockQueryCache.invalidateForFolder).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    test('cleans up resources', async () => {
      await service.initialize();
      service.startHealthCheck();

      await service.cleanup();

      expect(service.initialized).toBe(false);
      expect(service.client).toBeNull();
      expect(mockCircuitBreaker.cleanup).toHaveBeenCalled();
      expect(mockOfflineQueue.cleanup).toHaveBeenCalled();
      expect(mockQueryCache.clear).toHaveBeenCalled();
    });
  });

  describe('getServerConfig', () => {
    test('returns server configuration', () => {
      const config = service.getServerConfig();

      expect(config.host).toBe('127.0.0.1');
      expect(config.port).toBe(8000);
      expect(config.protocol).toBe('http');
      expect(config.url).toContain('http://127.0.0.1:8000');
    });
  });
});
