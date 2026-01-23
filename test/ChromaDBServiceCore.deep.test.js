const { ChromaDBServiceCore } = require('../src/main/services/chromadb/ChromaDBServiceCore');
const { CircuitState } = require('../src/main/utils/CircuitBreaker');
const { OperationType } = require('../src/main/utils/OfflineQueue');
const { logger } = require('../src/shared/logger');

// Mock dependencies
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/mock/user/data')
  }
}));

jest.mock('chromadb', () => ({
  ChromaClient: jest.fn().mockImplementation(() => ({
    getOrCreateCollection: jest.fn().mockResolvedValue({
      count: jest.fn().mockResolvedValue(0)
    })
  }))
}));

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(),
    readFile: jest.fn(),
    rename: jest.fn()
  },
  existsSync: jest.fn()
}));

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../src/shared/config/index', () => ({
  get: jest.fn((key, defaultVal) => defaultVal)
}));

// Mock CircuitBreaker to control state and events
const mockCircuitBreaker = {
  on: jest.fn(),
  removeAllListeners: jest.fn(),
  cleanup: jest.fn(),
  getState: jest.fn(),
  getStats: jest.fn(),
  isAllowed: jest.fn(),
  execute: jest.fn(),
  recordSuccess: jest.fn(),
  recordFailure: jest.fn(),
  reset: jest.fn(),
  isAvailable: jest.fn().mockReturnValue(true)
};

jest.mock('../src/main/utils/CircuitBreaker', () => ({
  CircuitBreaker: jest.fn(() => mockCircuitBreaker),
  CircuitState: {
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    HALF_OPEN: 'HALF_OPEN'
  }
}));

// Mock OfflineQueue to control flushing
const mockOfflineQueue = {
  on: jest.fn(),
  removeAllListeners: jest.fn(),
  cleanup: jest.fn(),
  initialize: jest.fn(),
  isEmpty: jest.fn(),
  size: jest.fn(),
  enqueue: jest.fn(),
  flush: jest.fn(),
  getStats: jest.fn()
};

jest.mock('../src/main/utils/OfflineQueue', () => ({
  OfflineQueue: jest.fn(() => mockOfflineQueue),
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

// Mock internal operations
jest.mock('../src/main/services/chromadb/fileOperations', () => ({
  directUpsertFile: jest.fn(),
  directBatchUpsertFiles: jest.fn(),
  deleteFileEmbedding: jest.fn(),
  batchDeleteFileEmbeddings: jest.fn(),
  updateFilePaths: jest.fn(),
  querySimilarFiles: jest.fn(),
  resetFiles: jest.fn()
}));

jest.mock('../src/main/services/chromadb/folderEmbeddings', () => ({
  directUpsertFolder: jest.fn(),
  directBatchUpsertFolders: jest.fn(),
  queryFoldersByEmbedding: jest.fn(),
  executeQueryFolders: jest.fn(),
  batchQueryFolders: jest.fn(),
  getAllFolders: jest.fn(),
  resetFolders: jest.fn()
}));

jest.mock('../src/main/services/chromadb/ChromaHealthChecker', () => ({
  checkHealthViaHttp: jest.fn(),
  checkHealthViaClient: jest.fn(),
  isServerAvailable: jest.fn()
}));

describe('ChromaDBServiceCore Deep Coverage', () => {
  let service;
  let fileOps;
  let folderOps;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChromaDBServiceCore();
    fileOps = require('../src/main/services/chromadb/fileOperations');
    folderOps = require('../src/main/services/chromadb/folderEmbeddings');

    // Setup service state
    service.initialized = true;
    service.isOnline = true;
  });

  describe('_flushOfflineQueue coverage', () => {
    test('processes all operation types correctly', async () => {
      // Mock flush to execute the processor for each item we want to test
      mockOfflineQueue.isEmpty.mockReturnValue(false);
      mockOfflineQueue.size.mockReturnValue(9);

      mockOfflineQueue.flush.mockImplementation(async (processor) => {
        // Simulate processing each type
        await processor({ type: OperationType.UPSERT_FILE, data: { id: 'f1' } });
        await processor({ type: OperationType.UPSERT_FOLDER, data: { id: 'd1' } });
        await processor({ type: OperationType.DELETE_FILE, data: { fileId: 'f2' } });
        await processor({ type: OperationType.DELETE_FOLDER, data: { folderId: 'd2' } });
        // FIX: Use non-empty arrays to trigger the batch operations
        // Empty arrays skip the processing loop (for loop condition: 0 < 0 is false)
        await processor({
          type: OperationType.BATCH_UPSERT_FILES,
          data: { files: [{ id: 'batch-f1' }] }
        });
        await processor({
          type: OperationType.BATCH_UPSERT_FOLDERS,
          data: { folders: [{ id: 'batch-d1' }] }
        });
        await processor({ type: OperationType.BATCH_DELETE_FILES, data: { fileIds: ['del-f1'] } });
        await processor({
          type: OperationType.BATCH_DELETE_FOLDERS,
          data: { folderIds: ['del-d1'] }
        });
        await processor({ type: OperationType.UPDATE_FILE_PATHS, data: { pathUpdates: [] } });

        // Also test unknown type
        await processor({ type: 'UNKNOWN_TYPE', data: {} });

        return { processed: 9, failed: 0, remaining: 0 };
      });

      // Stub methods that might be called
      service.deleteFileEmbedding = jest.fn();
      service.updateFilePaths = jest.fn();
      // FIX: Set folderCollection BEFORE flush so DELETE_FOLDER operations can use it
      service.folderCollection = { delete: jest.fn().mockResolvedValue() };
      service.fileCollection = { delete: jest.fn().mockResolvedValue() };

      // Spy on private/direct methods if needed or use the mocked imported modules
      // Since we mocked the imported modules, we check those

      await service._flushOfflineQueue();

      expect(fileOps.directUpsertFile).toHaveBeenCalled();
      expect(folderOps.directUpsertFolder).toHaveBeenCalled();
      expect(service.deleteFileEmbedding).toHaveBeenCalledWith('f2');

      expect(fileOps.directBatchUpsertFiles).toHaveBeenCalled();
      expect(folderOps.directBatchUpsertFolders).toHaveBeenCalled();

      // For BATCH_DELETE_FILES, it calls _directBatchDeleteFiles which calls fileOps.batchDeleteFileEmbeddings
      expect(fileOps.batchDeleteFileEmbeddings).toHaveBeenCalled();

      // Let's verify logger.warn for unknown operation type
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unknown operation type'),
        expect.anything()
      );
    });

    test('returns early if queue is empty', async () => {
      mockOfflineQueue.isEmpty.mockReturnValue(true);
      const result = await service._flushOfflineQueue();
      expect(result).toEqual({ processed: 0, failed: 0, remaining: 0 });
      expect(mockOfflineQueue.flush).not.toHaveBeenCalled();
    });
  });

  describe('Circuit Breaker Events', () => {
    test('handles circuit OPEN event - only emits after initialization', () => {
      // Get the 'open' handler registered in constructor
      const openHandler = mockCircuitBreaker.on.mock.calls.find((call) => call[0] === 'open')[1];
      const emitSpy = jest.spyOn(service, 'emit');

      // Before initialization, events should NOT be emitted (guards prevent confusing UI state)
      openHandler({ failureCount: 5 });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Circuit breaker opened'),
        expect.anything()
      );
      // FIX: Event NOT emitted before initialization complete
      expect(emitSpy).not.toHaveBeenCalledWith('offline', expect.anything());

      // After initialization, events SHOULD be emitted
      emitSpy.mockClear();
      service._initializationComplete = true;
      openHandler({ failureCount: 5 });

      expect(emitSpy).toHaveBeenCalledWith('offline', {
        reason: 'circuit_open',
        failureCount: 5
      });
    });

    test('handles circuit HALF_OPEN event - only emits after initialization', () => {
      const halfOpenHandler = mockCircuitBreaker.on.mock.calls.find(
        (call) => call[0] === 'halfOpen'
      )[1];
      const emitSpy = jest.spyOn(service, 'emit');

      // Before initialization, events should NOT be emitted
      halfOpenHandler();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Circuit breaker half-open')
      );
      // FIX: Event NOT emitted before initialization complete
      expect(emitSpy).not.toHaveBeenCalledWith('recovering', expect.anything());

      // After initialization, events SHOULD be emitted
      emitSpy.mockClear();
      service._initializationComplete = true;
      halfOpenHandler();

      expect(emitSpy).toHaveBeenCalledWith('recovering', { reason: 'circuit_half_open' });
    });

    test('handles circuit CLOSE event - only emits after initialization', () => {
      const closeHandler = mockCircuitBreaker.on.mock.calls.find((call) => call[0] === 'close')[1];
      const emitSpy = jest.spyOn(service, 'emit');

      // Before initialization, events should NOT be emitted
      closeHandler();

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Circuit breaker closed'));
      // FIX: Event NOT emitted before initialization complete
      expect(emitSpy).not.toHaveBeenCalledWith('online', expect.anything());

      // After initialization, events SHOULD be emitted
      emitSpy.mockClear();
      service._initializationComplete = true;
      closeHandler();

      expect(emitSpy).toHaveBeenCalledWith('online', { reason: 'circuit_closed' });
    });

    test('handles stateChange event', () => {
      const stateChangeHandler = mockCircuitBreaker.on.mock.calls.find(
        (call) => call[0] === 'stateChange'
      )[1];
      const emitSpy = jest.spyOn(service, 'emit');
      // Mock flush to prevent errors
      mockOfflineQueue.isEmpty.mockReturnValue(true);

      stateChangeHandler({ previousState: 'OPEN', currentState: 'CLOSED', timestamp: 123 });

      expect(emitSpy).toHaveBeenCalledWith(
        'circuitStateChange',
        expect.objectContaining({
          previousState: 'OPEN',
          currentState: 'CLOSED'
        })
      );
    });
  });

  describe('Hostname Validation Regex', () => {
    test('validates various hostnames', () => {
      // Access the regex implicitly via _initializeServerConfig
      const setHost = (host) => {
        delete process.env.CHROMA_SERVER_URL;
        process.env.CHROMA_SERVER_HOST = host;
        service._initializeServerConfig();
        return service.serverHost;
      };

      expect(setHost('localhost')).toBe('localhost');
      expect(setHost('127.0.0.1')).toBe('127.0.0.1');
      expect(setHost('example.com')).toBe('example.com');
      expect(setHost('sub.domain.co.uk')).toBe('sub.domain.co.uk');
      expect(setHost('192.168.1.1')).toBe('192.168.1.1');

      // Invalid ones - should trigger warning and use default/previous (which is default 127.0.0.1 in constructor)
      // Note: the test creates a NEW service each time so it resets to default 127.0.0.1
      // If we pass an invalid host, it logs warning and doesn't set it, so it remains 127.0.0.1

      // Reset mocks
      logger.warn.mockClear();
      expect(setHost('invalid_char$')).toBe('127.0.0.1');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid hostname format'),
        expect.anything()
      );

      logger.warn.mockClear();
      expect(setHost('-start-dash')).toBe('127.0.0.1'); // Regex expects start with alnum
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('Circuit Breaker Integration', () => {
    test('batchUpsertFolders queues when circuit is open', async () => {
      mockCircuitBreaker.isAllowed.mockReturnValueOnce(false);
      const folders = [{ id: 'f1', vector: [] }];

      const result = await service.batchUpsertFolders(folders);

      expect(result.queued).toBe(true);
      expect(result.count).toBe(1);
      expect(mockOfflineQueue.enqueue).toHaveBeenCalledWith(OperationType.BATCH_UPSERT_FOLDERS, {
        folders
      });
    });

    test('batchDeleteFileEmbeddings queues when circuit is open', async () => {
      mockCircuitBreaker.isAllowed.mockReturnValueOnce(false);
      const fileIds = ['f1', 'f2'];

      const result = await service.batchDeleteFileEmbeddings(fileIds);

      expect(result.queued).toBe(true);
      expect(result.count).toBe(2);
      expect(mockOfflineQueue.enqueue).toHaveBeenCalledWith(OperationType.BATCH_DELETE_FILES, {
        fileIds
      });
    });

    test('deleteFolderEmbedding queues when circuit is open', async () => {
      mockCircuitBreaker.isAllowed.mockReturnValueOnce(false);

      const result = await service.deleteFolderEmbedding('d1');

      expect(result.queued).toBe(true);
      expect(result.success).toBe(true);
      expect(mockOfflineQueue.enqueue).toHaveBeenCalledWith(OperationType.DELETE_FOLDER, {
        folderId: 'd1'
      });
    });

    test('batchDeleteFolders queues when circuit is open', async () => {
      mockCircuitBreaker.isAllowed.mockReturnValueOnce(false);
      const folderIds = ['d1'];

      const result = await service.batchDeleteFolders(folderIds);

      expect(result.queued).toBe(true);
      expect(result.count).toBe(1);
      expect(mockOfflineQueue.enqueue).toHaveBeenCalledWith(OperationType.BATCH_DELETE_FOLDERS, {
        folderIds
      });
    });

    test('deleteFolderEmbedding executes directly when circuit is closed', async () => {
      mockCircuitBreaker.isAllowed.mockReturnValue(true);

      // Ensure health check passes so initialize() doesn't reset everything
      const { checkHealthViaHttp } = require('../src/main/services/chromadb/ChromaHealthChecker');
      checkHealthViaHttp.mockResolvedValue({ healthy: true });

      const mockDelete = jest.fn().mockResolvedValue();
      service.folderCollection = { delete: mockDelete };

      const result = await service.deleteFolderEmbedding('d1');

      expect(result.queued).toBe(false);
      expect(result.success).toBe(true);
      // It calls _directDeleteFolder -> folderCollection.delete
      expect(mockDelete).toHaveBeenCalledWith({ ids: ['d1'] });
    });
  });

  describe('Direct Folder Operations', () => {
    test('_directDeleteFolder handles errors', async () => {
      service.folderCollection = {
        delete: jest.fn().mockRejectedValue(new Error('Delete failed'))
      };

      // Should catch error and log warning
      await service._directDeleteFolder('d1');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete folder embedding'),
        expect.anything()
      );
    });

    test('_directBatchDeleteFolders handles errors', async () => {
      service.folderCollection = {
        delete: jest.fn().mockRejectedValue(new Error('Batch delete failed'))
      };

      await expect(service._directBatchDeleteFolders(['d1', 'd2'])).rejects.toThrow(
        'Batch delete failed'
      );

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Batch folder delete failed'),
        expect.anything()
      );
    });

    test('_directBatchDeleteFolders returns 0 for empty list', async () => {
      const result = await service._directBatchDeleteFolders([]);
      expect(result).toBe(0);
    });
  });
});
