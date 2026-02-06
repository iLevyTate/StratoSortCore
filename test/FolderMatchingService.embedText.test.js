/**
 * Focused tests for FolderMatchingService embedding behavior.
 * These cover the main correctness and regression risks:
 * - cache HIT vs MISS
 * - known-model dimension adjustment (pad/truncate)
 * - unknown-model dimension trust (no silent destruction)
 * - chunk pooling path on truncation
 */
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
  getConfig: jest.fn().mockReturnValue({ embeddingModel: 'mxbai-embed-large' }),
  onModelChange: jest.fn(() => () => {})
};

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: () => mockLlamaService
}));

const mockParallelEmbeddingService = {
  batchEmbedTexts: jest.fn()
};

jest.mock('../src/main/services/ParallelEmbeddingService', () => ({
  getInstance: () => mockParallelEmbeddingService
}));

jest.mock('../src/main/utils/embeddingInput', () => ({
  capEmbeddingInput: jest.fn((text) => ({
    text: String(text || ''),
    wasTruncated: false,
    estimatedTokens: 0,
    maxTokens: 0,
    maxChars: 2000
  }))
}));

describe('FolderMatchingService embedText', () => {
  let mockVectorDb;

  beforeEach(() => {
    jest.clearAllMocks();
    mockVectorDb = { initialize: jest.fn().mockResolvedValue(undefined) };
  });

  test('returns cached embedding on cache HIT (no llama call)', async () => {
    const svc = new FolderMatchingService(mockVectorDb, {
      parallelEmbeddingService: mockParallelEmbeddingService
    });

    svc.embeddingCache.get = jest.fn().mockReturnValue({
      vector: [1, 2, 3],
      model: 'mxbai-embed-large'
    });
    svc.embeddingCache.set = jest.fn();

    const result = await svc.embedText('hello');

    expect(result.vector).toEqual([1, 2, 3]);
    expect(mockLlamaService.generateEmbedding).not.toHaveBeenCalled();
    expect(svc.embeddingCache.set).not.toHaveBeenCalled();
  });

  test('pads vectors for known models when actual < expected dimension', async () => {
    mockLlamaService.getConfig.mockReturnValueOnce({ embeddingModel: 'mxbai-embed-large' }); // expected 1024
    mockLlamaService.generateEmbedding.mockResolvedValueOnce({
      embedding: new Array(1000).fill(0.5)
    });

    const svc = new FolderMatchingService(mockVectorDb, {
      parallelEmbeddingService: mockParallelEmbeddingService
    });

    const result = await svc.embedText('hi');
    expect(result.model).toBe('mxbai-embed-large');
    expect(result.vector).toHaveLength(1024);
    // padded tail
    expect(result.vector.slice(1000)).toEqual(new Array(24).fill(0));
  });

  test('truncates vectors for known models when actual > expected dimension', async () => {
    mockLlamaService.getConfig.mockReturnValueOnce({ embeddingModel: 'all-minilm' }); // expected 384
    mockLlamaService.generateEmbedding.mockResolvedValueOnce({
      embedding: new Array(768).fill(0.25)
    });

    const svc = new FolderMatchingService(mockVectorDb, {
      parallelEmbeddingService: mockParallelEmbeddingService
    });

    const result = await svc.embedText('hi');
    expect(result.model).toBe('all-minilm');
    expect(result.vector).toHaveLength(384);
    expect(result.vector).toEqual(new Array(384).fill(0.25));
  });

  test('does not adjust dimension for unknown model names', async () => {
    mockLlamaService.getConfig.mockReturnValueOnce({ embeddingModel: 'mystery-embed-v9' });
    mockLlamaService.generateEmbedding.mockResolvedValueOnce({
      embedding: new Array(10).fill(0.1)
    });

    const svc = new FolderMatchingService(mockVectorDb, {
      parallelEmbeddingService: mockParallelEmbeddingService
    });

    const result = await svc.embedText('hi');
    expect(result.model).toBe('mystery-embed-v9');
    expect(result.vector).toHaveLength(10);
  });

  test('uses chunk pooling when input is truncated and batch embeddings succeed', async () => {
    const { capEmbeddingInput } = require('../src/main/utils/embeddingInput');
    capEmbeddingInput.mockReturnValueOnce({
      text: 'TRUNCATED',
      wasTruncated: true,
      estimatedTokens: 99999,
      maxTokens: 4096,
      maxChars: 50
    });

    mockLlamaService.getConfig.mockReturnValueOnce({ embeddingModel: 'nomic-embed-text' }); // expected 768

    // Make chunk pooling path succeed
    mockParallelEmbeddingService.batchEmbedTexts.mockResolvedValueOnce({
      results: [
        { success: true, vector: new Array(768).fill(0.2), model: 'nomic-embed-text' },
        { success: true, vector: new Array(768).fill(0.4), model: 'nomic-embed-text' }
      ]
    });

    const svc = new FolderMatchingService(mockVectorDb, {
      parallelEmbeddingService: mockParallelEmbeddingService
    });
    svc.embeddingCache.set = jest.fn();

    const result = await svc.embedText('x'.repeat(1000));

    expect(mockParallelEmbeddingService.batchEmbedTexts).toHaveBeenCalled();
    expect(result.vector).toHaveLength(768);
    // mean pooled => 0.3
    expect(result.vector[0]).toBeCloseTo(0.3, 6);
    expect(svc.embeddingCache.set).toHaveBeenCalled();
    // Should not fall through to single embedding generation when pooling succeeds
    expect(mockLlamaService.generateEmbedding).not.toHaveBeenCalled();
  });
});
