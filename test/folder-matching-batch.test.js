/**
 * Tests for FolderMatchingService Batch Operations
 */

const FolderMatchingService = require('../src/main/services/FolderMatchingService');

// Mock ollama utils
jest.mock('../src/main/ollamaUtils', () => ({
  getOllama: jest.fn(),
  getOllamaEmbeddingModel: jest.fn().mockReturnValue('mxbai-embed-large')
}));

// Mock ParallelEmbeddingService
const mockBatchEmbedFolders = jest.fn();
jest.mock('../src/main/services/ParallelEmbeddingService', () => ({
  getInstance: jest.fn(() => ({
    batchEmbedFolders: mockBatchEmbedFolders,
    embedText: jest.fn(),
    getStats: jest.fn().mockReturnValue({}),
    setConcurrencyLimit: jest.fn(),
    concurrencyLimit: 5
  }))
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

describe('FolderMatchingService Batch Operations', () => {
  let service;
  let mockChromaDBService;
  let mockOllama;

  beforeEach(() => {
    // Setup mock ChromaDB Service
    mockChromaDBService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      upsertFolder: jest.fn().mockResolvedValue({ success: true }),
      batchUpsertFolders: jest.fn().mockResolvedValue({ count: 2, skipped: [] }),
      getStats: jest.fn().mockResolvedValue({ folders: 0, files: 0 })
    };

    // Setup mock Ollama
    mockOllama = {
      embeddings: jest.fn().mockResolvedValue({
        embedding: new Array(1024).fill(0.1)
      })
    };

    const { getOllama } = require('../src/main/ollamaUtils');
    getOllama.mockReturnValue(mockOllama);

    // Reset the mockBatchEmbedFolders for each test
    mockBatchEmbedFolders.mockReset();

    service = new FolderMatchingService(mockChromaDBService);
    service.initialize();
  });

  afterEach(() => {
    service.shutdown();
    jest.clearAllMocks();
  });

  test('batchUpsertFolders processes multiple folders', async () => {
    // Setup mock for ParallelEmbeddingService to return successful embeddings
    mockBatchEmbedFolders.mockResolvedValue({
      results: [
        {
          id: 'folder:1',
          vector: new Array(1024).fill(0.1),
          model: 'mxbai-embed-large',
          success: true
        },
        {
          id: 'folder:2',
          vector: new Array(1024).fill(0.2),
          model: 'mxbai-embed-large',
          success: true
        }
      ],
      errors: [],
      stats: { total: 2, successful: 2, failed: 0 }
    });

    const folders = [
      { name: 'F1', description: 'D1' },
      { name: 'F2', description: 'D2' }
    ];

    const result = await service.batchUpsertFolders(folders);

    expect(mockBatchEmbedFolders).toHaveBeenCalledTimes(1);
    expect(mockChromaDBService.batchUpsertFolders).toHaveBeenCalledTimes(1);

    // Verify payload passed to ChromaDB
    const payload = mockChromaDBService.batchUpsertFolders.mock.calls[0][0];
    expect(payload).toHaveLength(2);
    expect(payload[0].name).toBe('F1');
    expect(payload[1].name).toBe('F2');
    expect(result.count).toBe(2);
  });

  test('batchUpsertFolders handles empty input', async () => {
    const result = await service.batchUpsertFolders([]);
    expect(result.count).toBe(0);
    expect(mockChromaDBService.batchUpsertFolders).not.toHaveBeenCalled();
  });

  test('batchUpsertFolders handles errors gracefully with fallback', async () => {
    // Mock ParallelEmbeddingService to return one success and one fallback
    mockBatchEmbedFolders.mockResolvedValue({
      results: [
        {
          id: 'folder:1',
          vector: new Array(1024).fill(0.1),
          model: 'mxbai-embed-large',
          success: true
        },
        { id: 'folder:2', vector: new Array(1024).fill(0), model: 'fallback', success: true }
      ],
      errors: [],
      stats: { total: 2, successful: 2, failed: 0 }
    });

    const folders = [
      { name: 'Success', description: 'D1' },
      { name: 'Fail', description: 'D2' }
    ];

    const result = await service.batchUpsertFolders(folders);

    // ParallelEmbeddingService handles errors internally and uses fallback
    expect(mockChromaDBService.batchUpsertFolders).toHaveBeenCalledTimes(1);
    const payload = mockChromaDBService.batchUpsertFolders.mock.calls[0][0];
    expect(payload).toHaveLength(2);
    expect(payload[0].name).toBe('Success');
    expect(payload[1].name).toBe('Fail');
    expect(payload[1].model).toBe('fallback');

    // Skipped should be empty as fallback was used
    expect(result.skipped).toHaveLength(0);
  });

  test('batchUpsertFolders tracks errors when embedding fails completely', async () => {
    // Mock ParallelEmbeddingService to return one success and one error
    mockBatchEmbedFolders.mockResolvedValue({
      results: [
        {
          id: 'folder:1',
          vector: new Array(1024).fill(0.1),
          model: 'mxbai-embed-large',
          success: true
        }
      ],
      errors: [{ id: 'folder:2', error: 'Embedding failed' }],
      stats: { total: 2, successful: 1, failed: 1 }
    });

    const folders = [
      { name: 'Success', description: 'D1' },
      { name: 'Fail', description: 'D2' }
    ];

    const result = await service.batchUpsertFolders(folders);

    // Only one folder should be upserted
    expect(mockChromaDBService.batchUpsertFolders).toHaveBeenCalledTimes(1);
    const payload = mockChromaDBService.batchUpsertFolders.mock.calls[0][0];
    expect(payload).toHaveLength(1);
    expect(payload[0].name).toBe('Success');

    // One should be in skipped
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].error).toBe('Embedding failed');
  });
});
