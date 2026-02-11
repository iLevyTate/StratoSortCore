/**
 * Restore-path tests for OramaVectorService.
 * Ensures docs missing embeddings retain BM25 recall via placeholder vectors.
 */

const mockCreate = jest.fn();
const mockInsert = jest.fn();
const mockUpdate = jest.fn();
let mockLogger;

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/mock-user-data')
  }
}));

jest.mock('../src/shared/logger', () => {
  mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };
  return {
    createLogger: () => mockLogger
  };
});

jest.mock('../src/shared/singletonFactory', () => ({
  createSingletonHelpers: () => ({
    getInstance: jest.fn(),
    createInstance: jest.fn(),
    registerWithContainer: jest.fn(),
    resetInstance: jest.fn()
  })
}));

jest.mock('@orama/orama', () => ({
  create: (...args) => mockCreate(...args),
  insert: (...args) => mockInsert(...args),
  search: jest.fn(),
  remove: jest.fn(),
  update: (...args) => mockUpdate(...args),
  count: jest.fn(),
  getByID: jest.fn()
}));

jest.mock('@orama/plugin-data-persistence', () => ({
  persist: jest.fn(),
  restore: jest.fn()
}));

jest.mock('lz4-napi', () => ({
  compress: jest.fn(async (buf) => buf),
  uncompress: jest.fn(async () => {
    throw new Error('Not used in this test');
  })
}));

const mockFs = {
  readFile: jest.fn(),
  unlink: jest.fn(),
  rename: jest.fn(),
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  stat: jest.fn()
};

jest.mock('fs', () => ({
  promises: mockFs
}));

const { OramaVectorService } = require('../src/main/services/OramaVectorService');
const { getByID: mockGetByID, search: mockSearch } = require('@orama/orama');
const { persist: mockPersist } = require('@orama/plugin-data-persistence');

describe('OramaVectorService restore behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({ _name: 'mock-db' });
    mockInsert.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
  });

  test('uses zero-vector placeholders for documents missing embeddings during restore', async () => {
    const persisted = JSON.stringify({
      docs: {
        docs: {
          a: {
            id: 'a',
            embedding: null,
            filePath: '/a.txt',
            fileName: 'a.txt',
            fileType: 'text/plain',
            analyzedAt: new Date().toISOString()
          },
          b: {
            id: 'b',
            embedding: [0.1, 0.2, 0.3],
            filePath: '/b.txt',
            fileName: 'b.txt',
            fileType: 'text/plain',
            analyzedAt: new Date().toISOString()
          }
        }
      }
    });

    mockFs.readFile.mockImplementation(async (targetPath) => {
      const filePath = String(targetPath);
      if (filePath.endsWith('.lz4')) {
        const e = new Error('ENOENT');
        e.code = 'ENOENT';
        throw e;
      }
      if (filePath.endsWith('files.json')) return persisted;
      if (filePath.endsWith('files.sidecar.json')) return JSON.stringify({});
      throw new Error(`Unexpected readFile path: ${filePath}`);
    });

    const service = new OramaVectorService();
    service._dataPath = '/mock-user-data/vector-db';
    service._dimension = 3;
    service._embeddingStore = {};
    service._collectionDimensions = {};
    service._clearQueryCache = jest.fn();

    const schema = { id: 'string', embedding: 'vector[3]' };
    const db = await service._createOrRestoreDatabase('files', schema);

    expect(db).toEqual({ _name: 'mock-db' });
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockInsert).toHaveBeenCalledWith(
      { _name: 'mock-db' },
      expect.objectContaining({ id: 'a', embedding: [0, 0, 0] })
    );
    expect(mockInsert).toHaveBeenCalledWith(
      { _name: 'mock-db' },
      expect.objectContaining({ id: 'b' })
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Using zero-vector placeholder for files doc missing embedding during restore'
      ),
      expect.objectContaining({ id: 'a' })
    );
  });

  test('restores missing embeddings from sidecar before placeholder fallback', async () => {
    const persisted = JSON.stringify({
      docs: {
        docs: {
          a: {
            id: 'a',
            embedding: null,
            filePath: '/a.txt',
            fileName: 'a.txt',
            fileType: 'text/plain',
            analyzedAt: new Date().toISOString()
          }
        }
      }
    });

    mockFs.readFile.mockImplementation(async (targetPath) => {
      const filePath = String(targetPath);
      if (filePath.endsWith('.lz4')) {
        const e = new Error('ENOENT');
        e.code = 'ENOENT';
        throw e;
      }
      if (filePath.endsWith('files.json')) return persisted;
      if (filePath.endsWith('files.sidecar.json')) return JSON.stringify({ a: [0.1, 0.2, 0.3] });
      throw new Error(`Unexpected readFile path: ${filePath}`);
    });

    const service = new OramaVectorService();
    service._dataPath = '/mock-user-data/vector-db';
    service._dimension = 3;
    service._embeddingStore = {};
    service._collectionDimensions = {};
    service._clearQueryCache = jest.fn();

    const schema = { id: 'string', embedding: 'vector[3]' };
    await service._createOrRestoreDatabase('files', schema);

    expect(mockInsert).toHaveBeenCalledWith(
      { _name: 'mock-db' },
      expect.objectContaining({ id: 'a', embedding: [0.1, 0.2, 0.3] })
    );
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Using zero-vector placeholder'),
      expect.anything()
    );
  });

  test('normalizes sidecar embeddings persisted as numeric-key objects', async () => {
    const persisted = JSON.stringify({
      docs: {
        docs: {
          a: {
            id: 'a',
            embedding: null,
            filePath: '/a.txt',
            fileName: 'a.txt',
            fileType: 'text/plain',
            analyzedAt: new Date().toISOString()
          }
        }
      }
    });

    mockFs.readFile.mockImplementation(async (targetPath) => {
      const filePath = String(targetPath);
      if (filePath.endsWith('.lz4')) {
        const e = new Error('ENOENT');
        e.code = 'ENOENT';
        throw e;
      }
      if (filePath.endsWith('files.json')) return persisted;
      if (filePath.endsWith('files.sidecar.json'))
        return JSON.stringify({ a: { 0: 0.1, 1: 0.2, 2: 0.3 } });
      throw new Error(`Unexpected readFile path: ${filePath}`);
    });

    const service = new OramaVectorService();
    service._dataPath = '/mock-user-data/vector-db';
    service._dimension = 3;
    service._embeddingStore = {};
    service._collectionDimensions = {};
    service._clearQueryCache = jest.fn();

    const schema = { id: 'string', embedding: 'vector[3]' };
    await service._createOrRestoreDatabase('files', schema);

    expect(mockInsert).toHaveBeenCalledWith(
      { _name: 'mock-db' },
      expect.objectContaining({ id: 'a', embedding: [0.1, 0.2, 0.3] })
    );
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Using zero-vector placeholder'),
      expect.anything()
    );
  });

  test('cloneFileEmbedding prefers sidecar embedding when source document embedding is missing', async () => {
    mockGetByID.mockResolvedValueOnce({
      id: 'file:source',
      embedding: undefined,
      hasVector: false,
      filePath: '/source.txt',
      fileName: 'source.txt',
      fileType: 'text/plain',
      analyzedAt: new Date().toISOString(),
      suggestedName: '',
      keywords: [],
      tags: [],
      isOrphaned: false,
      orphanedAt: '',
      extractionMethod: ''
    });

    const service = new OramaVectorService();
    service.initialize = jest.fn().mockResolvedValue(undefined);
    service._databases = { files: { _name: 'mock-files-db' } };
    service._dimension = 3;
    service._embeddingStore = {
      files: new Map([['file:source', [0.1, 0.2, 0.3]]])
    };
    service._invalidateCacheForFile = jest.fn();
    service._schedulePersist = jest.fn();

    const result = await service.cloneFileEmbedding('file:source', 'file:dest', {
      path: '/dest.txt',
      name: 'dest.txt'
    });

    expect(result).toEqual({ success: true, cloned: true });
    expect(mockInsert).toHaveBeenCalledWith(
      service._databases.files,
      expect.objectContaining({
        id: 'file:dest',
        embedding: [0.1, 0.2, 0.3],
        hasVector: true,
        filePath: '/dest.txt',
        fileName: 'dest.txt'
      })
    );
    expect(service._embeddingStore.files.get('file:dest')).toEqual([0.1, 0.2, 0.3]);
  });

  test('cloneFileEmbedding fails safely when no valid source embedding exists', async () => {
    mockGetByID.mockResolvedValueOnce({
      id: 'file:source',
      embedding: undefined,
      hasVector: false,
      filePath: '/source.txt',
      fileName: 'source.txt',
      fileType: 'text/plain'
    });

    const service = new OramaVectorService();
    service.initialize = jest.fn().mockResolvedValue(undefined);
    service._databases = { files: { _name: 'mock-files-db' } };
    service._dimension = 3;
    service._embeddingStore = { files: new Map() };

    const result = await service.cloneFileEmbedding('file:source', 'file:dest', {
      path: '/dest.txt',
      name: 'dest.txt'
    });

    expect(result).toEqual({
      success: false,
      cloned: false,
      error: 'Source file has no valid embedding to clone'
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('rebuild repair uses full persistence snapshot (not capped search slices)', async () => {
    const docCount = 10020;
    const docs = {};
    for (let i = 0; i < docCount; i++) {
      docs[`file:${i}`] = {
        id: `file:${i}`,
        embedding: [0.1, 0.2, 0.3],
        filePath: `/doc-${i}.txt`,
        fileName: `doc-${i}.txt`,
        fileType: 'text/plain',
        analyzedAt: new Date().toISOString(),
        keywords: [],
        tags: []
      };
    }

    mockPersist.mockResolvedValueOnce({
      docs: {
        docs
      }
    });

    const service = new OramaVectorService();
    service._dimension = 3;
    service._schemas = {
      files: { id: 'string', embedding: 'vector[3]', hasVector: 'boolean', filePath: 'string' }
    };
    service._databases = { files: { _name: 'files-db' } };
    service._embeddingStore = { files: new Map() };
    service._collectionDimensions = {};
    service._clearQueryCache = jest.fn();
    service.persistAll = jest.fn().mockResolvedValue(undefined);

    const result = await service._repairFilesVectorIndexFromCurrentState();

    expect(result).toEqual(
      expect.objectContaining({
        repaired: true,
        repairedDocs: docCount
      })
    );
    expect(mockPersist).toHaveBeenCalledWith({ _name: 'files-db' });
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledTimes(docCount);
    expect(service.persistAll).toHaveBeenCalledTimes(1);
  });
});
