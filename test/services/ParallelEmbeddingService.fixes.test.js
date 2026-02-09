const { ParallelEmbeddingService } = require('../../src/main/services/ParallelEmbeddingService');
const { createLogger } = require('../../src/shared/logger');

// Mock dependencies
jest.mock('../../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../../src/main/services/LlamaService', () => ({
  getInstance: jest.fn().mockReturnValue({
    getConfig: jest.fn().mockResolvedValue({ embeddingModel: 'test-model' }),
    generateEmbedding: jest.fn().mockResolvedValue({ embedding: [0.1, 0.2], model: 'test-model' }),
    getHealthStatus: jest.fn().mockReturnValue({ initialized: true }),
    on: jest.fn(),
    pinModel: jest.fn(),
    unpinModel: jest.fn()
  })
}));

jest.mock('../../src/main/utils/workerPools', () => ({
  getEmbeddingPool: jest.fn().mockReturnValue(null) // Disable worker pool for this test
}));

jest.mock('../../src/main/services/PerformanceService', () => ({
  getRecommendedConcurrency: jest.fn().mockResolvedValue({ maxConcurrent: 5 })
}));

describe('ParallelEmbeddingService Fixes', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ParallelEmbeddingService({
      concurrencyLimit: 2,
      maxRetries: 1
    });
  });

  afterEach(async () => {
    await service.shutdown();
  });

  test('should limit concurrency', async () => {
    const LlamaService = require('../../src/main/services/LlamaService');
    let resolveEmbedding;
    const embeddingPromise = new Promise((r) => (resolveEmbedding = r));

    LlamaService.getInstance().generateEmbedding.mockImplementation(() => embeddingPromise);

    // Start 3 requests with limit 2
    const p1 = service.embedText('text1');
    const p2 = service.embedText('text2');
    const p3 = service.embedText('text3');

    // Allow event loop to process
    await new Promise((r) => setTimeout(r, 10));

    expect(service.activeRequests).toBe(2);
    expect(service.waitQueue.length).toBe(1);

    // Resolve embeddings
    resolveEmbedding({ embedding: [0.1], model: 'test-model' });

    await Promise.all([p1, p2, p3]);
  });

  test('should handle batch errors gracefully', async () => {
    const LlamaService = require('../../src/main/services/LlamaService');
    LlamaService.getInstance()
      .generateEmbedding.mockResolvedValueOnce({ embedding: [0.1], model: 'test-model' })
      .mockRejectedValueOnce(new Error('Embedding failed'))
      .mockResolvedValueOnce({ embedding: [0.3], model: 'test-model' });

    const items = [
      { id: '1', text: 'text1' },
      { id: '2', text: 'text2' },
      { id: '3', text: 'text3' }
    ];

    const result = await service.batchEmbedTexts(items);

    // The service returns all results, including failed ones (with success: false)
    expect(result.results.length).toBe(3);

    // Check successful items
    const successful = result.results.filter((r) => r.success);
    expect(successful.length).toBe(2);

    // Check errors
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].id).toBe('2');
    expect(result.stats.successful).toBe(2);
    expect(result.stats.failed).toBe(1);
  });

  test('should abort batch on model mismatch', async () => {
    const LlamaService = require('../../src/main/services/LlamaService');

    // First call returns model A, second returns model B
    LlamaService.getInstance()
      .generateEmbedding.mockResolvedValueOnce({ embedding: [0.1], model: 'model-A' })
      .mockResolvedValueOnce({ embedding: [0.2], model: 'model-B' });

    // Config returns model A initially
    LlamaService.getInstance().getConfig.mockResolvedValue({ embeddingModel: 'model-A' });

    const items = [
      { id: '1', text: 'text1' },
      { id: '2', text: 'text2' }
    ];

    // Item 2: generateEmbedding -> 'model-B'. Mismatch with batchModel 'model-A'.
    // The service catches this and returns it as an error in the result object
    const result = await service.batchEmbedTexts(items);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].error).toMatch(/Model mismatch/);
    expect(result.stats.failed).toBe(1);
  });
});
