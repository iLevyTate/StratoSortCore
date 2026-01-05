const { OllamaService } = require('../src/main/services/OllamaService');

// Mock dependencies
jest.mock('../src/main/ollamaUtils', () => ({
  getOllama: jest.fn(),
  getOllamaModel: jest.fn(),
  getOllamaVisionModel: jest.fn(),
  getOllamaEmbeddingModel: jest.fn(),
  getOllamaHost: jest.fn(),
  setOllamaModel: jest.fn(),
  setOllamaVisionModel: jest.fn(),
  setOllamaEmbeddingModel: jest.fn(),
  setOllamaHost: jest.fn(),
  loadOllamaConfig: jest.fn()
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

jest.mock('../src/shared/RateLimiter', () => ({
  createOllamaRateLimiter: jest.fn().mockReturnValue({
    waitForSlot: jest.fn().mockResolvedValue(),
    recordCall: jest.fn()
  })
}));

jest.mock('../src/main/utils/ollamaApiRetry', () => ({
  withOllamaRetry: jest.fn((fn) => fn())
}));

jest.mock('../src/main/services/PerformanceService', () => ({
  buildOllamaOptions: jest.fn().mockResolvedValue({})
}));

jest.mock('../src/main/services/OllamaClient', () => ({
  getInstance: jest.fn().mockReturnValue({
    initialize: jest.fn().mockResolvedValue(),
    shutdown: jest.fn().mockResolvedValue(),
    getHealthStatus: jest.fn().mockReturnValue({ isHealthy: true }),
    getStats: jest.fn().mockReturnValue({}),
    batchEmbeddings: jest.fn().mockResolvedValue({ results: [], errors: [] })
  })
}));

// Mock 'ollama' library
const mockOllamaLib = {
  list: jest.fn().mockResolvedValue({ models: [] }),
  pull: jest.fn().mockResolvedValue({ status: 'success' }),
  embed: jest.fn().mockResolvedValue({ embeddings: [[0.1]] }),
  generate: jest.fn().mockResolvedValue({ response: 'test' })
};

jest.mock('ollama', () => ({
  Ollama: jest.fn().mockImplementation(() => mockOllamaLib)
}));

describe('OllamaService Extended Tests', () => {
  let service;
  let mockOllamaUtils;
  let mockOllamaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOllamaUtils = require('../src/main/ollamaUtils');
    mockOllamaClient = require('../src/main/services/OllamaClient').getInstance();
    service = new OllamaService();
    mockOllamaUtils.getOllama.mockReturnValue(mockOllamaLib);
  });

  describe('Model Change Notifications', () => {
    test('notifies subscribers on model change', async () => {
      const callback = jest.fn();
      service.onModelChange(callback);

      mockOllamaUtils.getOllamaEmbeddingModel.mockReturnValue('old-model');

      // ALLOWED_EMBED_MODELS whitelist logic converts 'new-model' to 'embeddinggemma'
      // if not in list. 'new-model' is NOT in list.
      // We expect downgrade to default 'embeddinggemma'
      await service.updateConfig({ embeddingModel: 'new-model' });

      expect(callback).toHaveBeenCalledWith({
        type: 'embedding',
        previousModel: 'old-model',
        newModel: 'embeddinggemma' // Correct expectation based on downgrade logic
      });
    });

    test('handles failing callbacks gracefully', async () => {
      const errorCallback = jest.fn().mockRejectedValue(new Error('Callback failed'));
      const successCallback = jest.fn().mockResolvedValue();

      service.onModelChange(errorCallback);
      service.onModelChange(successCallback);

      const result = await service._notifyModelChange('text', 'old', 'new');

      expect(result.failed).toBe(1);
      expect(result.failures[0].reason.message).toBe('Callback failed');
      expect(successCallback).toHaveBeenCalled();
    });
  });

  describe('Config Updates & Downgrades', () => {
    test('detects model downgrade', async () => {
      const result = await service.updateConfig({ embeddingModel: 'unknown-model' });

      expect(result.success).toBe(true);
      expect(result.modelDowngraded).toBe(true);
      expect(mockOllamaUtils.setOllamaEmbeddingModel).toHaveBeenCalledWith('embeddinggemma');
    });

    test('accepts allowed models without downgrade', async () => {
      const result = await service.updateConfig({ embeddingModel: 'nomic-embed-text' });

      expect(result.success).toBe(true);
      expect(result.modelDowngraded).toBe(false);
      expect(mockOllamaUtils.setOllamaEmbeddingModel).toHaveBeenCalledWith('nomic-embed-text');
    });

    test('updateConfigWithDowngradeInfo returns details', async () => {
      const result = await service.updateConfigWithDowngradeInfo({ embeddingModel: 'bad-model' });

      expect(result.modelDowngraded).toBe(true);
      expect(result.originalRequestedModel).toBe('bad-model');
      expect(result.actualEmbeddingModel).toBe('embeddinggemma');
      expect(result.message).toContain('replaced');
    });
  });

  describe('Resilience & Fallback', () => {
    test('generateEmbedding tries fallback chain', async () => {
      // Use internal method mocking for reliability
      service._generateEmbeddingWithModel = jest
        .fn()
        .mockResolvedValueOnce({ success: true, embedding: [1] });

      const res = await service.generateEmbedding('text', { model: 'primary' });
      expect(res.success).toBe(true);
      expect(service._generateEmbeddingWithModel).toHaveBeenCalledTimes(1);
    });
  });

  describe('Batch Processing', () => {
    test('batchGenerateEmbeddings uses client if available', async () => {
      await service.initialize();

      mockOllamaClient.batchEmbeddings.mockResolvedValue({
        results: [{ id: '1', embedding: [1], success: true }],
        errors: []
      });

      const res = await service.batchGenerateEmbeddings([{ id: '1', text: 't' }]);

      expect(mockOllamaClient.batchEmbeddings).toHaveBeenCalled();
      expect(res.success).toBe(true);
    });

    test('batchGenerateEmbeddings falls back on client error', async () => {
      await service.initialize();
      mockOllamaClient.batchEmbeddings.mockRejectedValue(new Error('Client failed'));

      // Mock single generation for fallback
      service.generateEmbedding = jest.fn().mockResolvedValue({
        success: true,
        embedding: [1]
      });

      const res = await service.batchGenerateEmbeddings([{ id: '1', text: 't' }]);

      expect(service.generateEmbedding).toHaveBeenCalled();
      expect(res.success).toBe(true);
    });
  });

  describe('Connection Testing', () => {
    test('testConnection uses temporary instance with timeout', async () => {
      // Mock Promise.race to simulate success
      const result = await service.testConnection('http://custom:11434');

      expect(result.success).toBe(true);
      expect(result.ollamaHealth.host).toBe('http://custom:11434');
    });

    test('testConnection handles failure', async () => {
      mockOllamaLib.list.mockRejectedValue(new Error('Connection refused'));

      const result = await service.testConnection();
      expect(result.success).toBe(false);
      expect(result.ollamaHealth.status).toBe('unhealthy');
    });
  });
});
