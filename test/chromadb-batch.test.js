const path = require('path');
const os = require('os');
const fs = require('fs').promises;

// Mock ChromaDB client
jest.mock('chromadb', () => {
  const mockCollections = new Map();

  class MockCollection {
    constructor(name) {
      this.name = name;
      this.items = new Map();
    }

    upsert({ ids, embeddings, metadatas, documents }) {
      for (let i = 0; i < ids.length; i++) {
        this.items.set(ids[i], {
          id: ids[i],
          embedding: embeddings[i],
          metadata: metadatas[i],
          document: documents[i]
        });
      }
      return Promise.resolve();
    }

    async get(params) {
      const result = { ids: [], embeddings: [], metadatas: [], documents: [] };
      if (params && params.ids && params.ids.length > 0) {
        for (const id of params.ids) {
          const item = this.items.get(id);
          if (item) {
            result.ids.push(item.id);
            result.embeddings.push(item.embedding);
            result.metadatas.push(item.metadata);
            result.documents.push(item.document);
          }
        }
      } else {
        for (const item of this.items.values()) {
          result.ids.push(item.id);
          result.embeddings.push(item.embedding);
          result.metadatas.push(item.metadata);
          result.documents.push(item.document);
        }
      }
      return result;
    }

    async delete({ ids }) {
      for (const id of ids) {
        this.items.delete(id);
      }
      return Promise.resolve();
    }

    async count() {
      return this.items.size;
    }
  }

  class MockChromaClient {
    constructor() {
      mockCollections.clear();
    }

    async getOrCreateCollection({ name }) {
      if (!mockCollections.has(name)) {
        mockCollections.set(name, new MockCollection(name));
      }
      return mockCollections.get(name);
    }
  }

  return {
    ChromaClient: MockChromaClient
  };
});

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

describe('ChromaDBService Batch Operations', () => {
  let tmpDir;
  let chromaDbService;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `chromadb-batch-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    // Mock electron app
    const electron = require('electron');
    // Ensure electron.app exists (it might be mocked by __mocks__/electron.js)
    if (!electron.app) {
      electron.app = { getPath: jest.fn() };
    }
    electron.app.getPath = jest.fn().mockReturnValue(tmpDir);

    const { ChromaDBService } = require('../src/main/services/chromadb');
    chromaDbService = new ChromaDBService();
    await chromaDbService.initialize();
  });

  afterEach(async () => {
    if (chromaDbService) {
      await chromaDbService.cleanup();
    }
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  test('batchUpsertFolders inserts multiple folders', async () => {
    const folders = [
      { id: 'f1', name: 'Folder 1', vector: [0.1, 0.1], description: 'Desc 1' },
      { id: 'f2', name: 'Folder 2', vector: [0.2, 0.2], description: 'Desc 2' }
    ];

    const result = await chromaDbService.batchUpsertFolders(folders);
    expect(result.count).toBe(2);
    expect(result.skipped).toHaveLength(0);

    const stats = await chromaDbService.getStats();
    expect(stats.folders).toBe(2);
  });

  test('batchUpsertFiles inserts multiple files', async () => {
    const files = [
      { id: 'file1', vector: [0.1, 0.1], meta: { path: '/p1', name: 'f1' } },
      { id: 'file2', vector: [0.2, 0.2], meta: { path: '/p2', name: 'f2' } }
    ];

    const result = await chromaDbService.batchUpsertFiles(files);
    expect(result.count).toBe(2);
    expect(result.queued).toBe(false);

    const stats = await chromaDbService.getStats();
    expect(stats.files).toBe(2);
  });

  test('updateFilePaths updates metadata and ids', async () => {
    // Setup initial file
    await chromaDbService.upsertFile({
      id: 'file:/old/path.txt',
      vector: [0.5, 0.5],
      meta: { path: '/old/path.txt', name: 'path.txt' }
    });

    // Update path
    const updates = [
      {
        oldId: 'file:/old/path.txt',
        newId: 'file:/new/path.txt',
        newMeta: { path: '/new/path.txt', name: 'path.txt' }
      }
    ];

    const updatedCount = await chromaDbService.updateFilePaths(updates);
    expect(updatedCount).toBe(1);

    // Verify old is gone and new exists
    const oldExists = await chromaDbService.fileCollection.get({
      ids: ['file:/old/path.txt']
    });
    expect(oldExists.ids).toHaveLength(0);

    const newExists = await chromaDbService.fileCollection.get({
      ids: ['file:/new/path.txt']
    });
    expect(newExists.ids).toHaveLength(1);
    // Normalize path separators for cross-platform compatibility
    expect(newExists.metadatas[0].path.replace(/\\/g, '/')).toBe('/new/path.txt');
  });

  test('updateFilePaths handles non-existent old files gracefully', async () => {
    const updates = [
      {
        oldId: 'file:nonexistent',
        newId: 'file:new',
        newMeta: { path: '/new' }
      }
    ];

    const count = await chromaDbService.updateFilePaths(updates);
    expect(count).toBe(0);
  });
});
