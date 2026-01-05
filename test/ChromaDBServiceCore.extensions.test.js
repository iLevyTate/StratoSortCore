const { app } = require('electron');
const { ChromaClient } = require('chromadb');
const fs = require('fs').promises;
const { logger } = require('../src/shared/logger');
const { get: getConfig } = require('../src/shared/config/index');
const { CircuitBreaker } = require('../src/main/utils/CircuitBreaker');
const { OfflineQueue } = require('../src/main/utils/OfflineQueue');
const { ChromaDBServiceCore } = require('../src/main/services/chromadb/ChromaDBServiceCore');

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

jest.mock('../src/main/utils/CircuitBreaker', () => {
  const EventEmitter = require('events');
  class MockCircuitBreaker extends EventEmitter {
    constructor() {
      super();
      this.isAllowed = jest.fn().mockReturnValue(true);
      this.execute = jest.fn(async (fn) => fn());
      this.recordSuccess = jest.fn();
      this.recordFailure = jest.fn();
      this.getState = jest.fn().mockReturnValue('CLOSED');
      this.getStats = jest.fn().mockReturnValue({});
      this.isAvailable = jest.fn().mockReturnValue(true);
      this.reset = jest.fn();
      this.cleanup = jest.fn();
    }
  }
  return { CircuitBreaker: MockCircuitBreaker, CircuitState: { CLOSED: 'CLOSED' } };
});

jest.mock('../src/main/utils/OfflineQueue', () => {
  const EventEmitter = require('events');
  class MockOfflineQueue extends EventEmitter {
    constructor() {
      super();
      this.enqueue = jest.fn();
      this.initialize = jest.fn();
      this.isEmpty = jest.fn().mockReturnValue(true);
      this.size = jest.fn().mockReturnValue(0);
      this.flush = jest.fn().mockResolvedValue({});
      this.getStats = jest.fn().mockReturnValue({});
      this.cleanup = jest.fn();
    }
  }
  return { OfflineQueue: MockOfflineQueue, OperationType: {} };
});

jest.mock('../src/main/services/chromadb/ChromaHealthChecker', () => ({
  checkHealthViaHttp: jest.fn(),
  checkHealthViaClient: jest.fn(),
  isServerAvailable: jest.fn()
}));

describe('ChromaDBServiceCore Extensions', () => {
  let service;
  let mockFileCollection;
  let mockFolderCollection;

  beforeEach(() => {
    jest.clearAllMocks();
    getConfig.mockImplementation((key, defaultVal) => defaultVal);

    service = new ChromaDBServiceCore();

    mockFileCollection = {
      peek: jest.fn(),
      count: jest.fn().mockResolvedValue(0)
    };
    mockFolderCollection = {
      peek: jest.fn(),
      count: jest.fn().mockResolvedValue(0)
    };

    service.fileCollection = mockFileCollection;
    service.folderCollection = mockFolderCollection;
    service.initialized = true; // Skip init for method testing
  });

  describe('validateEmbeddingDimension', () => {
    test('returns valid for empty collection', async () => {
      mockFileCollection.peek.mockResolvedValue({ embeddings: [] });

      const result = await service.validateEmbeddingDimension([1, 2, 3], 'files');

      expect(result.valid).toBe(true);
      expect(service._collectionDimensions.files).toBe(3);
    });

    test('returns valid when dimension matches', async () => {
      mockFileCollection.peek.mockResolvedValue({ embeddings: [[1, 2, 3]] });

      const result = await service.validateEmbeddingDimension([4, 5, 6], 'files');

      expect(result.valid).toBe(true);
    });

    test('detects dimension mismatch', async () => {
      mockFileCollection.peek.mockResolvedValue({ embeddings: [[1, 2, 3]] }); // 3 dims

      const result = await service.validateEmbeddingDimension([1, 2], 'files'); // 2 dims

      expect(result.valid).toBe(false);
      expect(result.error).toBe('dimension_mismatch');
      expect(result.expectedDim).toBe(3);
      expect(result.actualDim).toBe(2);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Embedding dimension mismatch')
      );
    });

    test('handles invalid input', async () => {
      const result = await service.validateEmbeddingDimension([], 'files');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('invalid_vector');
    });

    test('handles collection error gracefully', async () => {
      mockFileCollection.peek.mockRejectedValue(new Error('Peek failed'));
      // Should treat as empty/unknown and allow
      const result = await service.validateEmbeddingDimension([1], 'files');
      expect(result.valid).toBe(true);
    });
  });

  describe('_executeWithNotFoundRecovery', () => {
    test('retries on ChromaNotFoundError', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce({ name: 'ChromaNotFoundError' })
        .mockResolvedValueOnce('success');

      service._forceReinitialize = jest.fn().mockResolvedValue();

      const result = await service._executeWithNotFoundRecovery('testOp', fn);

      expect(result).toBe('success');
      expect(service._forceReinitialize).toHaveBeenCalled();
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('gives up after max retries', async () => {
      const fn = jest.fn().mockRejectedValue({ name: 'ChromaNotFoundError' });
      service._forceReinitialize = jest.fn().mockResolvedValue();

      await expect(service._executeWithNotFoundRecovery('testOp', fn)).rejects.toThrow(
        'failed after 2 recovery attempts'
      );

      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    test('rethrows non-not-found errors', async () => {
      const error = new Error('Other error');
      const fn = jest.fn().mockRejectedValue(error);
      jest.spyOn(service, '_forceReinitialize').mockResolvedValue();

      await expect(service._executeWithNotFoundRecovery('testOp', fn)).rejects.toThrow(
        'Other error'
      );
      expect(service._forceReinitialize).not.toHaveBeenCalled();
    });
  });

  describe('_initializeServerConfig', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.CHROMA_SERVER_URL;
      delete process.env.CHROMA_SERVER_PROTOCOL;
      delete process.env.CHROMA_SERVER_HOST;
      delete process.env.CHROMA_SERVER_PORT;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    test('parses valid CHROMA_SERVER_URL', () => {
      process.env.CHROMA_SERVER_URL = 'https://remote-host:9000';
      service._initializeServerConfig();
      expect(service.serverProtocol).toBe('https');
      expect(service.serverHost).toBe('remote-host');
      expect(service.serverPort).toBe(9000);
    });

    test('handles invalid CHROMA_SERVER_URL and falls back to defaults', () => {
      process.env.CHROMA_SERVER_URL = 'invalid-url';
      service._initializeServerConfig();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid CHROMA_SERVER_URL'),
        expect.any(Object)
      );
      expect(service.serverHost).toBe('127.0.0.1'); // Default
    });

    test('parses individual env vars', () => {
      process.env.CHROMA_SERVER_PROTOCOL = 'https';
      process.env.CHROMA_SERVER_HOST = 'custom-host';
      process.env.CHROMA_SERVER_PORT = '5000';

      service._initializeServerConfig();

      expect(service.serverProtocol).toBe('https');
      expect(service.serverHost).toBe('custom-host');
      expect(service.serverPort).toBe(5000);
    });

    test('warns on insecure remote connection', () => {
      process.env.CHROMA_SERVER_URL = 'http://remote-host:8000';
      service._initializeServerConfig();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('SECURITY WARNING'),
        expect.any(Object)
      );
    });
  });

  describe('migrateFromJsonl', () => {
    test('migrates valid lines', async () => {
      const jsonlContent =
        JSON.stringify({ id: '1', vector: [0.1], meta: { name: 'f1' } }) +
        '\n' +
        JSON.stringify({ id: '2', vector: [0.2], meta: { name: 'f2' } });

      fs.readFile.mockResolvedValue(jsonlContent);
      service.upsertFile = jest.fn().mockResolvedValue();

      const count = await service.migrateFromJsonl('data.jsonl', 'file');

      expect(count).toBe(2);
      expect(service.upsertFile).toHaveBeenCalledTimes(2);
    });

    test('handles invalid lines gracefully', async () => {
      const jsonlContent = 'invalid-json\n' + JSON.stringify({ id: '1', vector: [] });
      fs.readFile.mockResolvedValue(jsonlContent);
      service.upsertFile = jest.fn().mockResolvedValue();

      const count = await service.migrateFromJsonl('data.jsonl', 'file');

      expect(count).toBe(1);
      expect(logger.warn).toHaveBeenCalled();
    });

    test('returns 0 if file not found', async () => {
      const error = new Error('Not found');
      error.code = 'ENOENT';
      fs.readFile.mockRejectedValue(error);

      const count = await service.migrateFromJsonl('missing.jsonl');

      expect(count).toBe(0);
    });
  });

  describe('_addInflightQuery', () => {
    test('evicts oldest query when at capacity', async () => {
      service.MAX_INFLIGHT_QUERIES = 2;
      const p1 = new Promise(() => {});
      const p2 = new Promise(() => {});
      const p3 = new Promise(() => {});

      service._addInflightQuery('k1', p1);
      service._addInflightQuery('k2', p2);

      expect(service.inflightQueries.size).toBe(2);

      service._addInflightQuery('k3', p3);

      expect(service.inflightQueries.size).toBe(2);
      expect(service.inflightQueries.has('k1')).toBe(false); // Oldest evicted
      expect(service.inflightQueries.has('k3')).toBe(true);
    });

    test('removes query when promise settles', async () => {
      let resolveP;
      const p = new Promise((r) => (resolveP = r));

      service._addInflightQuery('k1', p);
      expect(service.inflightQueries.has('k1')).toBe(true);

      resolveP();
      await p;

      expect(service.inflightQueries.has('k1')).toBe(false);
    });
  });
});
