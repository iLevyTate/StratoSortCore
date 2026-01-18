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
    rm: jest.fn().mockResolvedValue(undefined),
    rename: jest.fn().mockResolvedValue(undefined)
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
  peek: jest.fn().mockResolvedValue({ embeddings: [] }),
  count: jest.fn().mockResolvedValue(0)
};

jest.mock('chromadb', () => ({
  ChromaClient: jest.fn().mockImplementation(() => ({
    getOrCreateCollection: jest.fn().mockResolvedValue(mockCollection),
    createCollection: jest.fn().mockResolvedValue(mockCollection),
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
  on: jest.fn(),
  removeAllListeners: jest.fn()
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
  on: jest.fn(),
  removeAllListeners: jest.fn()
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
  // FIX: Return proper result object with success flag
  deleteFileEmbedding: jest.fn().mockResolvedValue({ success: true }),
  batchDeleteFileEmbeddings: jest.fn().mockResolvedValue(3),
  updateFilePaths: jest.fn().mockResolvedValue({ updated: 2 }),
  querySimilarFiles: jest.fn().mockResolvedValue([]),
  resetFiles: jest.fn().mockResolvedValue(mockCollection)
}));

// Mock chunk operations
jest.mock('../src/main/services/chromadb/chunkOperations', () => ({
  batchUpsertFileChunks: jest.fn().mockResolvedValue(5),
  querySimilarFileChunks: jest.fn().mockResolvedValue([]),
  resetFileChunks: jest.fn().mockResolvedValue(mockCollection),
  markChunksOrphaned: jest.fn().mockResolvedValue({ marked: 0, failed: 0 }),
  getOrphanedChunks: jest.fn().mockResolvedValue([]),
  updateFileChunkPaths: jest.fn().mockResolvedValue(2)
}));

// Mock folder embeddings
jest.mock('../src/main/services/chromadb/folderEmbeddings', () => ({
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

  describe('explicitEmbeddingsOnlyEmbeddingFunction', () => {
    test('throws if SDK tries to auto-embed', async () => {
      const module = require('../src/main/services/chromadb/ChromaDBServiceCore');
      await expect(module.explicitEmbeddingsOnlyEmbeddingFunction.generate()).rejects.toThrow(
        'embeddingFunction was invoked unexpectedly'
      );
      await expect(
        module.explicitEmbeddingsOnlyEmbeddingFunction.generateForQueries()
      ).rejects.toThrow('embeddingFunction was invoked unexpectedly');
    });
  });

  describe('_isChromaNotFoundError', () => {
    test('detects not-found style errors', () => {
      expect(service._isChromaNotFoundError({ name: 'ChromaNotFoundError', message: 'x' })).toBe(
        true
      );
      expect(
        service._isChromaNotFoundError({ message: 'Requested resource could not be found' })
      ).toBe(true);
      expect(service._isChromaNotFoundError({ message: 'not found' })).toBe(true);
      expect(service._isChromaNotFoundError({ message: 'other' })).toBe(false);
    });
  });

  describe('validateEmbeddingDimension', () => {
    test('accepts first insert into empty collection and caches dimension', async () => {
      service.fileCollection = { peek: jest.fn().mockResolvedValue({ embeddings: [] }) };
      const res = await service.validateEmbeddingDimension([1, 2, 3], 'files');
      expect(res.valid).toBe(true);
      // cached dimension
      expect(service._collectionDimensions.files).toBe(3);
    });

    test('rejects dimension mismatch and emits event', async () => {
      // Collection has stored embeddings of dimension 2
      service.fileCollection = { peek: jest.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) };
      const emitSpy = jest.spyOn(service, 'emit');
      const res = await service.validateEmbeddingDimension([1, 2, 3], 'files');
      expect(res.valid).toBe(false);
      expect(res.error).toBe('dimension_mismatch');
      expect(emitSpy).toHaveBeenCalledWith(
        'dimension-mismatch',
        expect.objectContaining({ collectionType: 'files', expectedDim: 2, actualDim: 3 })
      );
    });
  });

  describe('_executeWithNotFoundRecovery', () => {
    test('reinitializes once and retries on not-found error', async () => {
      const forceSpy = jest.spyOn(service, '_forceReinitialize').mockResolvedValue(undefined);
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce('ok');

      const res = await service._executeWithNotFoundRecovery('op', fn);
      expect(res).toBe('ok');
      expect(forceSpy).toHaveBeenCalled();
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('throws after max not-found retries', async () => {
      jest.spyOn(service, '_forceReinitialize').mockResolvedValue(undefined);
      const fn = jest.fn().mockRejectedValue(new Error('not found'));
      await expect(service._executeWithNotFoundRecovery('op', fn)).rejects.toThrow('failed after');
    });
  });

  describe('_addInflightQuery', () => {
    test('evicts oldest inflight query when at capacity and cleans up on settle', async () => {
      service.MAX_INFLIGHT_QUERIES = 1;

      let resolveP2;
      const p1 = new Promise(() => {}); // never settles
      const p2 = new Promise((resolve) => {
        resolveP2 = resolve;
      });

      service._addInflightQuery('k1', p1);
      expect(service.inflightQueries.size).toBe(1);

      // Adding second should evict k1
      service._addInflightQuery('k2', p2);
      expect(service.inflightQueries.has('k1')).toBe(false);
      expect(service.inflightQueries.has('k2')).toBe(true);

      resolveP2('done');
      await p2;
      // allow finally handler to run
      await Promise.resolve();

      expect(service.inflightQueries.has('k2')).toBe(false);
    });
  });

  describe('_onCircuitStateChange', () => {
    test('emits circuitStateChange and flushes offline queue on CLOSED', async () => {
      const flushSpy = jest.spyOn(service, '_flushOfflineQueue').mockResolvedValue({
        processed: 0,
        failed: 0,
        remaining: 0
      });
      const emitSpy = jest.spyOn(service, 'emit');

      service._onCircuitStateChange({
        previousState: 'OPEN',
        currentState: 'CLOSED',
        timestamp: Date.now()
      });

      // flush is async and called without await
      await Promise.resolve();
      expect(emitSpy).toHaveBeenCalledWith(
        'circuitStateChange',
        expect.objectContaining({ currentState: 'CLOSED' })
      );
      expect(flushSpy).toHaveBeenCalled();
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

    test('warns and emits security-warning for insecure HTTP remote host', () => {
      delete process.env.CHROMA_SERVER_URL;
      process.env.CHROMA_SERVER_PROTOCOL = 'http';
      process.env.CHROMA_SERVER_HOST = 'example.com';
      process.env.CHROMA_SERVER_PORT = '8000';

      jest.resetModules();
      // Re-require logger after resetModules so we assert against the active mock instance.
      const { logger } = require('../src/shared/logger');
      const module = require('../src/main/services/chromadb/ChromaDBServiceCore');
      const emitSpy = jest.spyOn(module.ChromaDBServiceCore.prototype, 'emit');
      // Construct after spying so we catch constructor-time emit
      // eslint-disable-next-line no-new
      new module.ChromaDBServiceCore();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('SECURITY WARNING'),
        expect.any(Object)
      );
      expect(emitSpy).toHaveBeenCalledWith(
        'security-warning',
        expect.objectContaining({ type: 'insecure_connection', host: 'example.com' })
      );
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

      const { executeQueryFolders } = require('../src/main/services/chromadb/folderEmbeddings');
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

      const { executeQueryFolders } = require('../src/main/services/chromadb/folderEmbeddings');

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

      const { queryFoldersByEmbedding } = require('../src/main/services/chromadb/folderEmbeddings');
      queryFoldersByEmbedding.mockResolvedValueOnce([{ id: 'folder-1' }]);

      const results = await service.queryFoldersByEmbedding([0.1, 0.2], 5);

      expect(queryFoldersByEmbedding).toHaveBeenCalled();
      expect(results).toEqual([{ id: 'folder-1' }]);
    });
  });

  describe('getAllFolders', () => {
    test('gets all folders', async () => {
      await service.initialize();

      const { getAllFolders } = require('../src/main/services/chromadb/folderEmbeddings');
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
      const { updateFileChunkPaths } = require('../src/main/services/chromadb/chunkOperations');

      await service.updateFilePaths(pathUpdates);

      expect(updateFilePaths).toHaveBeenCalled();
      expect(updateFileChunkPaths).toHaveBeenCalled();
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

      const { resetFolders } = require('../src/main/services/chromadb/folderEmbeddings');

      await service.resetFolders();

      expect(resetFolders).toHaveBeenCalled();
    });
  });

  describe('resetAll', () => {
    test('resets both collections', async () => {
      await service.initialize();

      const { resetFiles } = require('../src/main/services/chromadb/fileOperations');
      const { resetFolders } = require('../src/main/services/chromadb/folderEmbeddings');

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

  describe('auto-reset prevention', () => {
    let fsSync;
    let originalExistsSync;

    beforeEach(() => {
      jest.resetModules();
      fsSync = require('fs');
      originalExistsSync = fsSync.existsSync;
      delete process.env.STRATOSORT_ALLOW_CHROMADB_AUTO_RESET;
    });

    afterEach(() => {
      fsSync.existsSync = originalExistsSync;
      delete process.env.STRATOSORT_ALLOW_CHROMADB_AUTO_RESET;
    });

    test('does NOT rename DB directory when auto-reset is disabled (default)', async () => {
      const { checkHealthViaHttp } = require('../src/main/services/chromadb/ChromaHealthChecker');
      checkHealthViaHttp.mockResolvedValueOnce({ healthy: true });

      const fs = require('fs');
      const fsPromises = require('fs').promises;
      const renameSpy = jest.spyOn(fsPromises, 'rename');
      fs.existsSync = jest.fn().mockReturnValue(true);

      const { ChromaClient } = require('chromadb');
      ChromaClient.mockImplementationOnce(() => ({
        getOrCreateCollection: jest.fn().mockRejectedValue(new Error('default_tenant not found'))
      }));

      const module = require('../src/main/services/chromadb/ChromaDBServiceCore');
      const ChromaDBServiceCore = module.ChromaDBServiceCore;
      const testService = new ChromaDBServiceCore();

      await expect(testService.initialize()).rejects.toThrow();

      // Should NOT rename the DB directory when auto-reset is disabled
      expect(renameSpy).not.toHaveBeenCalled();

      renameSpy.mockRestore();
    });

    test('renames DB directory when auto-reset is explicitly enabled', async () => {
      process.env.STRATOSORT_ALLOW_CHROMADB_AUTO_RESET = '1';

      const { checkHealthViaHttp } = require('../src/main/services/chromadb/ChromaHealthChecker');
      checkHealthViaHttp.mockResolvedValueOnce({ healthy: true });

      const fs = require('fs');
      const fsPromises = require('fs').promises;
      const renameSpy = jest.spyOn(fsPromises, 'rename');
      fs.existsSync = jest.fn().mockReturnValue(true);

      const { ChromaClient } = require('chromadb');
      ChromaClient.mockImplementationOnce(() => ({
        getOrCreateCollection: jest.fn().mockRejectedValue(new Error('default_tenant not found'))
      }));

      const module = require('../src/main/services/chromadb/ChromaDBServiceCore');
      const ChromaDBServiceCore = module.ChromaDBServiceCore;
      const testService = new ChromaDBServiceCore();

      await expect(testService.initialize()).rejects.toThrow();

      // Should rename the DB directory when auto-reset is explicitly enabled
      expect(renameSpy).toHaveBeenCalled();
      expect(renameSpy.mock.calls[0][1]).toMatch(/\.bak\.\d+$/);

      renameSpy.mockRestore();
    });

    test('does NOT rename DB directory when server is unhealthy', async () => {
      process.env.STRATOSORT_ALLOW_CHROMADB_AUTO_RESET = '1';

      const { checkHealthViaHttp } = require('../src/main/services/chromadb/ChromaHealthChecker');
      checkHealthViaHttp.mockRejectedValueOnce(new Error('Server unreachable'));

      const fsPromises = require('fs').promises;
      const renameSpy = jest.spyOn(fsPromises, 'rename');

      const { ChromaClient } = require('chromadb');
      ChromaClient.mockImplementationOnce(() => ({
        getOrCreateCollection: jest.fn().mockRejectedValue(new Error('default_tenant not found'))
      }));

      const module = require('../src/main/services/chromadb/ChromaDBServiceCore');
      const ChromaDBServiceCore = module.ChromaDBServiceCore;
      const testService = new ChromaDBServiceCore();

      await expect(testService.initialize()).rejects.toThrow();

      // Should NOT rename when server is unhealthy (could be transient)
      expect(renameSpy).not.toHaveBeenCalled();

      renameSpy.mockRestore();
    });

    test('does NOT rename DB directory for non-corruption errors', async () => {
      process.env.STRATOSORT_ALLOW_CHROMADB_AUTO_RESET = '1';

      const { checkHealthViaHttp } = require('../src/main/services/chromadb/ChromaHealthChecker');
      checkHealthViaHttp.mockResolvedValueOnce({ healthy: true });

      const fsPromises = require('fs').promises;
      const renameSpy = jest.spyOn(fsPromises, 'rename');

      const { ChromaClient } = require('chromadb');
      ChromaClient.mockImplementationOnce(() => ({
        getOrCreateCollection: jest.fn().mockRejectedValue(new Error('Network timeout'))
      }));

      const module = require('../src/main/services/chromadb/ChromaDBServiceCore');
      const ChromaDBServiceCore = module.ChromaDBServiceCore;
      const testService = new ChromaDBServiceCore();

      await expect(testService.initialize()).rejects.toThrow();

      // Should NOT rename for non-corruption errors
      expect(renameSpy).not.toHaveBeenCalled();

      renameSpy.mockRestore();
    });

    test('only attempts auto-reset once per instance', async () => {
      process.env.STRATOSORT_ALLOW_CHROMADB_AUTO_RESET = '1';

      const { checkHealthViaHttp } = require('../src/main/services/chromadb/ChromaHealthChecker');
      checkHealthViaHttp.mockResolvedValue({ healthy: true });

      const fs = require('fs');
      const fsPromises = require('fs').promises;
      const renameSpy = jest.spyOn(fsPromises, 'rename');
      fs.existsSync = jest.fn().mockReturnValue(true);

      const { ChromaClient } = require('chromadb');
      ChromaClient.mockImplementation(() => ({
        getOrCreateCollection: jest.fn().mockRejectedValue(new Error('default_tenant not found'))
      }));

      const module = require('../src/main/services/chromadb/ChromaDBServiceCore');
      const ChromaDBServiceCore = module.ChromaDBServiceCore;
      const testService = new ChromaDBServiceCore();

      // First attempt - should rename
      await expect(testService.initialize()).rejects.toThrow();
      expect(renameSpy).toHaveBeenCalledTimes(1);
      expect(testService._recoveryAttempted).toBe(true);

      // Reset the promise to allow retry, but keep _recoveryAttempted = true
      testService._initPromise = null;
      testService._isInitializing = false;
      // DO NOT reset _recoveryAttempted - this is the key test

      // Second attempt - should NOT rename again because _recoveryAttempted is still true
      await expect(testService.initialize()).rejects.toThrow();
      expect(renameSpy).toHaveBeenCalledTimes(1); // Still only once

      renameSpy.mockRestore();
    });

    test('detects various corruption-like error patterns', async () => {
      const corruptionErrors = [
        'default_tenant not found',
        'Could not find tenant',
        'no such table: embeddings',
        'SQLite error: database disk image is malformed'
      ];

      for (const errorMsg of corruptionErrors) {
        jest.resetModules();
        delete process.env.STRATOSORT_ALLOW_CHROMADB_AUTO_RESET;

        const { checkHealthViaHttp } = require('../src/main/services/chromadb/ChromaHealthChecker');
        checkHealthViaHttp.mockResolvedValueOnce({ healthy: true });

        const logger = require('../src/shared/logger');
        const warnSpy = jest.spyOn(logger.logger, 'warn');

        const { ChromaClient } = require('chromadb');
        ChromaClient.mockImplementationOnce(() => ({
          getOrCreateCollection: jest.fn().mockRejectedValue(new Error(errorMsg))
        }));

        const module = require('../src/main/services/chromadb/ChromaDBServiceCore');
        const ChromaDBServiceCore = module.ChromaDBServiceCore;
        const testService = new ChromaDBServiceCore();

        await expect(testService.initialize()).rejects.toThrow();

        // Should log corruption detection
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('[ChromaDB] Detected likely DB/tenant corruption'),
          expect.any(Object)
        );

        warnSpy.mockRestore();
      }
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

    test('removes all listeners from CircuitBreaker and OfflineQueue', async () => {
      await service.initialize();

      await service.cleanup();

      expect(mockCircuitBreaker.removeAllListeners).toHaveBeenCalled();
      expect(mockOfflineQueue.removeAllListeners).toHaveBeenCalled();
    });
  });

  describe('inflightQueries', () => {
    test('adds and removes inflight queries', async () => {
      await service.initialize();

      // Create a promise that we control
      let resolvePromise;
      const controlledPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      // Add an inflight query
      service._addInflightQuery('test-key', controlledPromise);

      // Verify it was added
      expect(service.inflightQueries.has('test-key')).toBe(true);

      // Resolve the promise
      resolvePromise({ data: 'test' });

      // Wait for .finally() to execute
      await controlledPromise;
      await new Promise((r) => setTimeout(r, 10));

      // Verify it was removed via .finally()
      expect(service.inflightQueries.has('test-key')).toBe(false);
    });

    // Note: Rejection cleanup uses the same .finally() mechanism as success cleanup
    // Both paths are covered by the test above since .finally() runs regardless of outcome
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
