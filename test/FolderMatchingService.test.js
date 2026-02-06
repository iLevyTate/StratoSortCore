const FolderMatchingService = require('../src/main/services/FolderMatchingService');

jest.mock('../src/shared/logger', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

const mockLlamaService = {
  generateEmbedding: jest.fn(),
  getConfig: jest.fn().mockReturnValue({ embeddingModel: 'mxbai-embed-large' })
};

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: () => mockLlamaService
}));

describe('FolderMatchingService', () => {
  let service;
  let mockVectorDbService;

  beforeEach(() => {
    mockVectorDbService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      upsertFolder: jest.fn().mockResolvedValue({ success: true }),
      getStats: jest.fn().mockResolvedValue({ folders: 1, files: 2 })
    };

    mockLlamaService.generateEmbedding.mockResolvedValue({
      embedding: new Array(1024).fill(0.1)
    });

    service = new FolderMatchingService(mockVectorDbService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('embedText uses LlamaService and returns vector', async () => {
    const result = await service.embedText('Project invoices and receipts');
    expect(result.vector.length).toBe(1024);
    expect(mockLlamaService.generateEmbedding).toHaveBeenCalledTimes(1);
  });

  test('upsertFolderEmbedding writes to vector DB', async () => {
    const folder = { id: 'f1', name: 'Invoices', path: '/tmp/Invoices' };
    await service.upsertFolderEmbedding(folder);
    expect(mockVectorDbService.upsertFolder).toHaveBeenCalled();
  });

  test('getStats returns vector DB stats', async () => {
    const stats = await service.getStats();
    expect(stats.folders).toBe(1);
    expect(stats.files).toBe(2);
  });
});
