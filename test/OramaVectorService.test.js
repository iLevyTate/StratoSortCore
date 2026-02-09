/**
 * Tests for OramaVectorService
 * TIER 1 - CRITICAL for vector storage and search
 */

const fs = require('fs').promises;
const path = require('path');
let app;
let OramaVectorService;
let mockLogger;

// Mock dependencies
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn()
  }
}));

// Mock logger
jest.mock('../src/shared/logger', () => {
  mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };
  return {
    createLogger: () => mockLogger,
    __mockLogger: mockLogger
  };
});

// Mock singleton factory
jest.mock('../src/shared/singletonFactory', () => ({
  createSingletonHelpers: () => ({
    getInstance: jest.fn(),
    createInstance: jest.fn(),
    registerWithContainer: jest.fn(),
    resetInstance: jest.fn()
  })
}));

// Mock Orama persistence plugin to avoid jest ESM issues
jest.mock('@orama/plugin-data-persistence', () => ({
  persist: jest.fn(async () => '{}'),
  restore: jest.fn(async () => {
    throw new Error('restore not available in test');
  })
}));

// Mock llama utils for deterministic embedding model selection
jest.mock('../src/main/llamaUtils', () => ({
  getEmbeddingModel: jest.fn(() => 'nomic-embed-text-v1.5-Q8_0.gguf'),
  loadLlamaConfig: jest.fn().mockResolvedValue({
    selectedEmbeddingModel: 'nomic-embed-text-v1.5-Q8_0.gguf'
  })
}));

// Use a temporary directory for tests
const TEMP_DIR = path.join(__dirname, 'temp-orama-test');

// Load mocked modules after jest.mock calls
({ app } = require('electron'));
({ OramaVectorService } = require('../src/main/services/OramaVectorService'));

describe('OramaVectorService', () => {
  let service;

  beforeAll(async () => {
    // Create temp directory
    try {
      await fs.mkdir(TEMP_DIR, { recursive: true });
    } catch (e) {
      // Ignore
    }
  });

  afterAll(async () => {
    // Cleanup temp directory
    try {
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
    } catch (e) {
      // Ignore
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    app.getPath.mockReturnValue(TEMP_DIR);
    service = new OramaVectorService();
    const llamaUtils = require('../src/main/llamaUtils');
    llamaUtils.getEmbeddingModel.mockReturnValue('nomic-embed-text-v1.5-Q8_0.gguf');
  });

  afterEach(async () => {
    await service.cleanup();
  });

  describe('initialization', () => {
    test('initializes successfully', async () => {
      await service.initialize();
      expect(service._initialized).toBe(true);
      expect(service._databases.files).toBeDefined();
      expect(service._databases.folders).toBeDefined();
    });

    test('creates data directory', async () => {
      await service.initialize();
      const stats = await fs.stat(path.join(TEMP_DIR, 'vector-db'));
      expect(stats.isDirectory()).toBe(true);
    });

    test('uses active embedding model dimension', async () => {
      const llamaUtils = require('../src/main/llamaUtils');
      llamaUtils.getEmbeddingModel.mockReturnValue('mxbai-embed-large-v1-f16.gguf');

      await service.initialize();
      const stats = await service.getStats();

      expect(stats.dimension).toBe(1024);
    });
  });

  describe('file operations', () => {
    const testFile = {
      id: 'file-1',
      vector: new Array(768).fill(0.1),
      meta: {
        path: '/docs/test.pdf',
        fileName: 'test.pdf',
        fileType: 'application/pdf',
        analyzedAt: new Date().toISOString()
      }
    };

    beforeEach(async () => {
      await service.initialize();
    });

    test('upserts and retrieves file embedding', async () => {
      const result = await service.upsertFile(testFile);
      expect(result.success).toBe(true);

      const file = await service.getFile('file-1');
      expect(file).toBeDefined();
      expect(file.id).toBe('file-1');
      expect(file.embedding).toEqual(testFile.vector);
    });

    test('queries similar files', async () => {
      await service.upsertFile(testFile);

      // Query with same vector
      const results = await service.querySimilarFiles(testFile.vector, 5);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('file-1');
      expect(results[0].score).toBeGreaterThan(0.9); // Should be very close to 1
    });

    test('deletes file embedding', async () => {
      await service.upsertFile(testFile);

      const deleteResult = await service.deleteFileEmbedding('file-1');
      expect(deleteResult).toBe(true);

      const file = await service.getFile('file-1');
      expect(file).toBeNull();
    });

    test('validates vector dimensions', async () => {
      const invalidFile = {
        ...testFile,
        vector: [0.1, 0.2] // Wrong dimension
      };

      const result = await service.upsertFile(invalidFile);
      expect(result.success).toBe(false);
      expect(result.error).toBe('dimension_mismatch');
    });
  });

  describe('folder operations', () => {
    const testFolder = {
      id: 'folder-1',
      vector: new Array(768).fill(0.2),
      meta: {
        name: 'Documents',
        path: '/Documents',
        description: 'My documents'
      }
    };

    beforeEach(async () => {
      await service.initialize();
    });

    test('upserts and queries folders', async () => {
      await service.upsertFolder(testFolder);

      const results = await service.queryFoldersByEmbedding(testFolder.vector, 5);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('folder-1');
      expect(results[0].metadata.folderName).toBe('Documents');
    });
  });

  describe('move/rename coordination', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    test('updateFilePaths updates filePath and can re-key the id', async () => {
      await service.upsertFile({
        id: 'old-id',
        vector: new Array(768).fill(0.11),
        meta: {
          path: 'C:\\old\\a.pdf',
          fileName: 'a.pdf',
          fileType: 'application/pdf',
          analyzedAt: new Date().toISOString()
        }
      });

      const updated = await service.updateFilePaths([
        {
          oldId: 'old-id',
          newId: 'new-id',
          newPath: 'C:\\new\\a-renamed.pdf',
          newName: 'a-renamed.pdf'
        }
      ]);

      expect(updated).toBe(1);
      await expect(service.getFile('old-id')).resolves.toBeNull();

      const file = await service.getFile('new-id');
      expect(file).toBeDefined();
      expect(file.id).toBe('new-id');
      expect(file.filePath).toBe('C:\\new\\a-renamed.pdf');
      expect(file.fileName).toBe('a-renamed.pdf');
    });

    test('updateFilePaths supports FilePathCoordinator-style newMeta payloads', async () => {
      await service.upsertFile({
        id: 'file:C:\\old\\b.pdf',
        vector: new Array(768).fill(0.22),
        meta: {
          path: 'C:\\old\\b.pdf',
          fileName: 'b.pdf',
          fileType: 'application/pdf',
          analyzedAt: new Date().toISOString()
        }
      });

      const updated = await service.updateFilePaths([
        {
          oldId: 'file:C:\\old\\b.pdf',
          newId: 'file:C:\\new\\b.pdf',
          newMeta: { path: 'C:\\new\\b.pdf', name: 'b.pdf' }
        }
      ]);

      expect(updated).toBe(1);
      await expect(service.getFile('file:C:\\old\\b.pdf')).resolves.toBeNull();
      const file = await service.getFile('file:C:\\new\\b.pdf');
      expect(file).toBeDefined();
      expect(file.filePath).toBe('C:\\new\\b.pdf');
      expect(file.fileName).toBe('b.pdf');
    });
  });

  describe('persistence scheduling', () => {
    beforeEach(async () => {
      await service.initialize();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('debounces persistence writes', async () => {
      const spy = jest.spyOn(service, '_doPersist').mockResolvedValue(undefined);
      service._lastPersist = Date.now();

      service._schedulePersist();
      service._schedulePersist();
      service._schedulePersist();

      expect(spy).not.toHaveBeenCalled();
      jest.advanceTimersByTime(5000);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test('forces persist immediately when max wait exceeded', async () => {
      const spy = jest.spyOn(service, '_doPersist').mockResolvedValue(undefined);
      service._lastPersist = Date.now() - 60_000;

      service._schedulePersist();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('persistence', () => {
    test('persists data to disk', async () => {
      await service.initialize();

      // Upsert data
      await service.upsertFile({
        id: 'persist-file',
        vector: new Array(768).fill(0.5),
        meta: { fileName: 'persist.txt' }
      });

      // Force persist
      await service.persistAll();

      // Ensure persistence did not error
      expect(mockLogger.error).not.toHaveBeenCalled();

      // Check for any files.json persistence output
      const dataDir = path.join(TEMP_DIR, 'vector-db');
      const entries = await fs.readdir(dataDir);
      const hasFilesPersist = entries.some((name) => name.startsWith('files.json'));
      expect(hasFilesPersist).toBe(true);
    });
  });
});
