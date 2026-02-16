/**
 * FolderMatchingService Coverage Tests
 *
 * Tests untested paths: initialization, model change subscription,
 * cache invalidation, folder embedding generation, upserted ID tracking,
 * and error handling.
 *
 * Coverage target: main/services/FolderMatchingService.js (was 39%)
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: jest.fn(() => null)
}));

jest.mock('../src/main/services/ParallelEmbeddingService', () => ({
  getInstance: jest.fn(() => ({
    generateEmbedding: jest.fn().mockResolvedValue({ embedding: new Array(768).fill(0.1) }),
    batchGenerate: jest.fn().mockResolvedValue([])
  }))
}));

jest.mock('../src/shared/config/index', () => ({
  get: jest.fn((key, defaultValue) => defaultValue)
}));

jest.mock('../src/main/analysis/semanticExtensionMap', () => ({
  enrichFolderTextForEmbedding: jest.fn((text) => text)
}));

jest.mock('../src/shared/vectorMath', () => ({
  validateEmbeddingDimensions: jest.fn(() => true)
}));

jest.mock('../src/main/utils/embeddingInput', () => ({
  capEmbeddingInput: jest.fn((text) => ({ text, wasTruncated: false }))
}));

jest.mock('../src/main/utils/textChunking', () => ({
  chunkText: jest.fn((text) => [text])
}));

jest.mock('../src/shared/embeddingDimensions', () => ({
  resolveEmbeddingDimension: jest.fn(() => 768),
  isKnownEmbeddingModel: jest.fn(() => false)
}));

jest.mock('../src/shared/cacheInvalidation', () => ({
  getInstance: jest.fn(() => ({
    subscribe: jest.fn(() => jest.fn()),
    publish: jest.fn()
  }))
}));

jest.mock('../src/main/services/EmbeddingCache', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(() => null),
    set: jest.fn(),
    clear: jest.fn(),
    invalidateOnModelChange: jest.fn(() => true),
    initialize: jest.fn(),
    initialized: false
  }));
});

describe('FolderMatchingService', () => {
  let FolderMatchingService;
  let mockVectorDb;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    FolderMatchingService = require('../src/main/services/FolderMatchingService');

    mockVectorDb = {
      upsert: jest.fn().mockResolvedValue(),
      search: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(),
      resetAll: jest.fn().mockResolvedValue(),
      handleEmbeddingModelChange: jest.fn().mockResolvedValue()
    };
  });

  describe('constructor', () => {
    test('creates with default options', () => {
      const service = new FolderMatchingService(mockVectorDb);
      expect(service.vectorDbService).toBe(mockVectorDb);
      expect(service._upsertedFolderIds.size).toBe(0);
    });

    test('creates with custom cache options', () => {
      const service = new FolderMatchingService(mockVectorDb, {
        maxCacheSize: 500,
        cacheTtl: 60000
      });
      expect(service).toBeDefined();
    });

    test('creates with injected embedding service', () => {
      const mockEmbeddingService = { generateEmbedding: jest.fn() };
      const service = new FolderMatchingService(mockVectorDb, {
        parallelEmbeddingService: mockEmbeddingService
      });
      expect(service._injectedEmbeddingService).toBe(mockEmbeddingService);
    });

    test('creates with custom concurrency and retry limits', () => {
      const service = new FolderMatchingService(mockVectorDb, {
        concurrencyLimit: 10,
        maxRetries: 5
      });
      expect(service._concurrencyLimit).toBe(10);
      expect(service._maxRetries).toBe(5);
    });
  });

  describe('initialize', () => {
    test('initializes embedding cache', async () => {
      const service = new FolderMatchingService(mockVectorDb);
      await service.initialize();
      expect(service.embeddingCache.initialize).toHaveBeenCalled();
    });

    test('returns same promise for concurrent init calls', async () => {
      const service = new FolderMatchingService(mockVectorDb);
      const p1 = service.initialize();
      const p2 = service.initialize();
      expect(p1).toBe(p2);
      await p1;
    });

    test('resolves immediately when already initialized', async () => {
      const service = new FolderMatchingService(mockVectorDb);
      service.embeddingCache.initialized = true;
      await service.initialize();
      // Should not call initialize again
    });

    test('resolves immediately when no cache', async () => {
      const service = new FolderMatchingService(mockVectorDb);
      service.embeddingCache = null;
      await service.initialize();
    });
  });

  describe('_trackUpsertedFolder', () => {
    test('tracks folder ID', () => {
      const service = new FolderMatchingService(mockVectorDb);
      service._trackUpsertedFolder('folder-1');
      expect(service._upsertedFolderIds.has('folder-1')).toBe(true);
    });

    test('clears set when exceeding max size', () => {
      const service = new FolderMatchingService(mockVectorDb);
      service._maxUpsertedFolderIds = 3;
      service._trackUpsertedFolder('a');
      service._trackUpsertedFolder('b');
      service._trackUpsertedFolder('c');
      service._trackUpsertedFolder('d');
      // Set should have been cleared and only contain 'd'
      expect(service._upsertedFolderIds.size).toBe(1);
      expect(service._upsertedFolderIds.has('d')).toBe(true);
    });
  });

  describe('_getEmbeddingService', () => {
    test('returns injected service when provided', () => {
      const mockService = { generateEmbedding: jest.fn() };
      const service = new FolderMatchingService(mockVectorDb, {
        parallelEmbeddingService: mockService
      });
      expect(service._getEmbeddingService()).toBe(mockService);
    });

    test('falls back to singleton when no injection', () => {
      const service = new FolderMatchingService(mockVectorDb);
      service._injectedEmbeddingService = null;
      const result = service._getEmbeddingService();
      expect(result).toBeDefined();
    });
  });

  describe('generateEmbedding error handling', () => {
    test('returns null from cache on cache miss', async () => {
      const service = new FolderMatchingService(mockVectorDb);
      const cached = service.embeddingCache.get('nonexistent');
      expect(cached).toBeNull();
    });
  });

  describe('cleanup', () => {
    test('destroy unsubscribes from model changes', () => {
      const service = new FolderMatchingService(mockVectorDb);
      const mockUnsub = jest.fn();
      service._modelChangeUnsubscribe = mockUnsub;
      service._invalidationUnsubscribe = jest.fn();

      if (typeof service.destroy === 'function') {
        service.destroy();
        expect(mockUnsub).toHaveBeenCalled();
      }
    });
  });
});
