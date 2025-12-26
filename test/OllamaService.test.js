/**
 * Tests for OllamaService
 * TIER 1 - CRITICAL: Core Ollama integration service
 * Testing the centralized Ollama operations wrapper
 */

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

// Mock ollama utils
jest.mock('../src/main/ollamaUtils', () => ({
  loadOllamaConfig: jest.fn().mockResolvedValue(true),
  saveOllamaConfig: jest.fn().mockResolvedValue(true),
  getOllama: jest.fn(),
  getOllamaHost: jest.fn().mockReturnValue('http://localhost:11434'),
  getOllamaModel: jest.fn().mockReturnValue('llama2'),
  getOllamaVisionModel: jest.fn().mockReturnValue('llava'),
  getOllamaEmbeddingModel: jest.fn().mockReturnValue('mxbai-embed-large'),
  setOllamaHost: jest.fn().mockResolvedValue(true),
  setOllamaModel: jest.fn().mockResolvedValue(true),
  setOllamaVisionModel: jest.fn().mockResolvedValue(true),
  setOllamaEmbeddingModel: jest.fn().mockResolvedValue(true)
}));

// Mock Ollama constructor
jest.mock('ollama', () => {
  const mockOllamaInstance = {
    list: jest.fn(),
    pull: jest.fn(),
    embeddings: jest.fn(), // Legacy API (deprecated)
    embed: jest.fn(), // New API
    generate: jest.fn()
  };

  return {
    Ollama: jest.fn().mockImplementation(() => mockOllamaInstance)
  };
});

// Mock OllamaClient
jest.mock('../src/main/services/OllamaClient', () => ({
  getInstance: jest.fn(() => ({
    initialize: jest.fn().mockResolvedValue(true),
    getHealthStatus: jest.fn(() => ({
      isHealthy: true,
      activeRequests: 0,
      queuedRequests: 0,
      offlineQueueSize: 0,
      consecutiveFailures: 0,
      lastHealthCheck: Date.now()
    })),
    getStats: jest.fn(() => ({
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retriedRequests: 0,
      avgLatencyMs: 0
    }))
  }))
}));

jest.mock('../src/main/services/PerformanceService', () => ({
  buildOllamaOptions: jest.fn().mockResolvedValue({ num_gpu: -1, main_gpu: 0 })
}));

// Import the service module (mocks are applied before this)
const OllamaServiceModule = require('../src/main/services/OllamaService');

describe('OllamaService', () => {
  let mockOllama;
  let MockOllama;
  const {
    saveOllamaConfig,
    getOllama,
    getOllamaHost,
    getOllamaModel,
    getOllamaVisionModel,
    getOllamaEmbeddingModel,
    setOllamaHost,
    setOllamaModel,
    setOllamaVisionModel,
    setOllamaEmbeddingModel
  } = require('../src/main/ollamaUtils');

  beforeEach(() => {
    // Reset the service singleton state using its built-in method
    OllamaServiceModule.resetInstance();

    // Clear all mock calls
    jest.clearAllMocks();

    // Setup mock Ollama client
    mockOllama = {
      list: jest.fn(),
      pull: jest.fn(),
      embeddings: jest.fn(), // Legacy API (deprecated)
      embed: jest.fn(), // New API
      generate: jest.fn()
    };

    getOllama.mockReturnValue(mockOllama);

    // Get the mocked Ollama constructor and make it return our mock instance
    MockOllama = require('ollama').Ollama;
    MockOllama.mockReturnValue(mockOllama);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getConfig', () => {
    test('should return current configuration', async () => {
      const config = await OllamaServiceModule.getConfig();

      expect(config).toEqual({
        host: 'http://localhost:11434',
        textModel: 'llama2',
        visionModel: 'llava',
        embeddingModel: 'mxbai-embed-large'
      });
      expect(getOllamaHost).toHaveBeenCalled();
      expect(getOllamaModel).toHaveBeenCalled();
      expect(getOllamaVisionModel).toHaveBeenCalled();
      expect(getOllamaEmbeddingModel).toHaveBeenCalled();
    });
  });

  describe('updateConfig', () => {
    test('should update all config fields', async () => {
      const newConfig = {
        host: 'http://localhost:11435',
        textModel: 'mistral',
        visionModel: 'bakllava',
        embeddingModel: 'mxbai-embed-large'
      };

      const result = await OllamaServiceModule.updateConfig(newConfig);

      expect(result.success).toBe(true);
      expect(setOllamaHost).toHaveBeenCalledWith('http://localhost:11435');
      expect(setOllamaModel).toHaveBeenCalledWith('mistral');
      expect(setOllamaVisionModel).toHaveBeenCalledWith('bakllava');
      expect(setOllamaEmbeddingModel).toHaveBeenCalledWith('mxbai-embed-large');
      expect(saveOllamaConfig).toHaveBeenCalled();
    });

    test('should update partial config', async () => {
      const result = await OllamaServiceModule.updateConfig({
        textModel: 'llama3'
      });

      expect(result.success).toBe(true);
      expect(setOllamaModel).toHaveBeenCalledWith('llama3');
      expect(setOllamaHost).not.toHaveBeenCalled();
      expect(setOllamaVisionModel).not.toHaveBeenCalled();
      expect(saveOllamaConfig).toHaveBeenCalled();
    });

    test('should handle update errors gracefully', async () => {
      setOllamaHost.mockRejectedValueOnce(new Error('Invalid host'));

      const result = await OllamaServiceModule.updateConfig({
        host: 'invalid-host'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid host');
    });
  });

  describe('testConnection', () => {
    test('should test connection successfully', async () => {
      mockOllama.list.mockResolvedValue({
        models: [{ name: 'llama2' }, { name: 'mistral' }]
      });

      const result = await OllamaServiceModule.testConnection();

      expect(result.success).toBe(true);
      expect(result.ollamaHealth.status).toBe('healthy');
      expect(result.modelCount).toBe(2);
      expect(result.ollamaHealth.modelCount).toBe(2);
      expect(result.ollamaHealth.host).toBe('http://localhost:11434');
      expect(MockOllama).toHaveBeenCalled();
      expect(mockOllama.list).toHaveBeenCalled();
    });

    test('should test connection with custom host', async () => {
      mockOllama.list.mockResolvedValue({ models: [] });
      const customHost = 'http://192.168.1.100:11434';

      const result = await OllamaServiceModule.testConnection(customHost);

      expect(result.success).toBe(true);
      expect(result.ollamaHealth.host).toBe(customHost);
      expect(MockOllama).toHaveBeenCalledWith({ host: customHost });
    });

    test('should handle connection failure', async () => {
      mockOllama.list.mockRejectedValue(new Error('Connection refused'));

      const result = await OllamaServiceModule.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
      expect(result.ollamaHealth.status).toBe('unhealthy');
      expect(result.ollamaHealth.error).toBe('Connection refused');
    });

    test('should handle empty model list', async () => {
      mockOllama.list.mockResolvedValue({ models: [] });

      const result = await OllamaServiceModule.testConnection();

      expect(result.success).toBe(true);
      expect(result.modelCount).toBe(0);
    });
  });

  describe('getModels', () => {
    test('should categorize models correctly', async () => {
      mockOllama.list.mockResolvedValue({
        models: [
          { name: 'llama2' },
          { name: 'mistral' },
          { name: 'llava' },
          { name: 'llava:13b' },
          { name: 'mxbai-embed-large' },
          { name: 'nomic-embed-text' }
        ]
      });

      const result = await OllamaServiceModule.getModels();

      expect(result.success).toBe(true);
      expect(result.models).toHaveLength(6);
      expect(result.categories.text).toEqual(['llama2', 'mistral']);
      expect(result.categories.vision).toEqual(['llava', 'llava:13b']);
      expect(result.categories.embedding).toEqual(['mxbai-embed-large', 'nomic-embed-text']);
    });

    test('should include current selections', async () => {
      mockOllama.list.mockResolvedValue({ models: [] });

      const result = await OllamaServiceModule.getModels();

      expect(result.selected).toEqual({
        textModel: 'llama2',
        visionModel: 'llava',
        embeddingModel: 'mxbai-embed-large'
      });
    });

    test('should handle model list errors', async () => {
      mockOllama.list.mockRejectedValue(new Error('List failed'));

      const result = await OllamaServiceModule.getModels();

      expect(result.success).toBe(false);
      expect(result.error).toBe('List failed');
      expect(result.models).toEqual([]);
      expect(result.categories).toEqual({
        text: [],
        vision: [],
        embedding: []
      });
      expect(result.ollamaHealth.status).toBe('unhealthy');
    });

    test('should handle vision models with various naming patterns', async () => {
      mockOllama.list.mockResolvedValue({
        models: [{ name: 'llava:latest' }, { name: 'bakllava' }, { name: 'vision-model' }]
      });

      const result = await OllamaServiceModule.getModels();

      expect(result.categories.vision).toContain('llava:latest');
      expect(result.categories.vision).toContain('bakllava');
      expect(result.categories.vision).toContain('vision-model');
    });

    test('should handle embedding models with various naming patterns', async () => {
      mockOllama.list.mockResolvedValue({
        models: [
          { name: 'mxbai-embed-large' },
          { name: 'nomic-embed-text' },
          { name: 'all-minilm' } // 'embed' not in name
        ]
      });

      const result = await OllamaServiceModule.getModels();

      expect(result.categories.embedding).toContain('mxbai-embed-large');
      expect(result.categories.embedding).toContain('nomic-embed-text');
      // 'all-minilm' won't be in embedding since it doesn't match the pattern
    });
  });

  describe('pullModels', () => {
    test('should pull multiple models successfully', async () => {
      mockOllama.pull.mockResolvedValue({ status: 'success' });

      const result = await OllamaServiceModule.pullModels(['llama2', 'mistral']);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toEqual({ model: 'llama2', success: true });
      expect(result.results[1]).toEqual({ model: 'mistral', success: true });
      expect(mockOllama.pull).toHaveBeenCalledTimes(2);
    });

    test('should handle partial failures', async () => {
      mockOllama.pull
        .mockResolvedValueOnce({ status: 'success' })
        .mockRejectedValueOnce(new Error('Model not found'));

      const result = await OllamaServiceModule.pullModels(['llama2', 'invalid-model']);

      expect(result.success).toBe(true); // At least one succeeded
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);
      expect(result.results[1].error).toBe('Model not found');
    });

    test('should handle empty model list', async () => {
      const result = await OllamaServiceModule.pullModels([]);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No models specified');
      expect(result.results).toEqual([]);
      expect(mockOllama.pull).not.toHaveBeenCalled();
    });

    test('should handle non-array input', async () => {
      const result = await OllamaServiceModule.pullModels(null);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No models specified');
    });

    test('should handle all failures', async () => {
      mockOllama.pull.mockRejectedValue(new Error('Network error'));

      const result = await OllamaServiceModule.pullModels(['model1', 'model2']);

      expect(result.success).toBe(false);
      expect(result.results.every((r) => !r.success)).toBe(true);
    });
  });

  describe('generateEmbedding', () => {
    test('should generate embedding successfully', async () => {
      const mockEmbedding = new Array(1024).fill(0.1);
      // New API uses embed() with embeddings array response
      mockOllama.embed.mockResolvedValue({ embeddings: [mockEmbedding] });

      const result = await OllamaServiceModule.generateEmbedding('test text');

      expect(result.success).toBe(true);
      expect(result.embedding).toEqual(mockEmbedding);
      // New API uses embed() with 'input' instead of embeddings() with 'prompt'
      expect(mockOllama.embed).toHaveBeenCalledWith({
        model: 'mxbai-embed-large',
        input: 'test text',
        options: { num_gpu: -1, main_gpu: 0 }
      });
    });

    test('should use custom model', async () => {
      mockOllama.embed.mockResolvedValue({ embeddings: [[]] });

      await OllamaServiceModule.generateEmbedding('text', {
        model: 'custom-embed-model'
      });

      expect(mockOllama.embed).toHaveBeenCalledWith({
        model: 'custom-embed-model',
        input: 'text',
        options: { num_gpu: -1, main_gpu: 0 }
      });
    });

    test('should pass ollama options', async () => {
      mockOllama.embed.mockResolvedValue({ embeddings: [[]] });

      await OllamaServiceModule.generateEmbedding('text', {
        ollamaOptions: { temperature: 0.5 }
      });

      expect(mockOllama.embed).toHaveBeenCalledWith({
        model: 'mxbai-embed-large',
        input: 'text',
        options: { num_gpu: -1, main_gpu: 0, temperature: 0.5 }
      });
    });

    test('should handle embedding errors', async () => {
      mockOllama.embed.mockRejectedValue(new Error('Embedding failed'));

      const result = await OllamaServiceModule.generateEmbedding('text');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Embedding failed');
    });
  });

  describe('analyzeText', () => {
    test('should analyze text successfully', async () => {
      mockOllama.generate.mockResolvedValue({
        response: 'Analysis result'
      });

      const result = await OllamaServiceModule.analyzeText('Analyze this text');

      expect(result.success).toBe(true);
      expect(result.response).toBe('Analysis result');
      expect(mockOllama.generate).toHaveBeenCalledWith({
        model: 'llama2',
        prompt: 'Analyze this text',
        format: undefined,
        system: undefined,
        options: { num_gpu: -1, main_gpu: 0 },
        stream: false
      });
    });

    test('should use custom model', async () => {
      mockOllama.generate.mockResolvedValue({ response: 'result' });

      await OllamaServiceModule.analyzeText('text', { model: 'mistral' });

      expect(mockOllama.generate).toHaveBeenCalledWith({
        model: 'mistral',
        prompt: 'text',
        format: undefined,
        system: undefined,
        options: { num_gpu: -1, main_gpu: 0 },
        stream: false
      });
    });

    test('should pass ollama options', async () => {
      mockOllama.generate.mockResolvedValue({ response: 'result' });

      await OllamaServiceModule.analyzeText('text', {
        ollamaOptions: { temperature: 0.7, num_predict: 100 }
      });

      expect(mockOllama.generate).toHaveBeenCalledWith({
        model: 'llama2',
        prompt: 'text',
        format: undefined,
        system: undefined,
        options: { num_gpu: -1, main_gpu: 0, temperature: 0.7, num_predict: 100 },
        stream: false
      });
    });

    test('should handle analysis errors', async () => {
      mockOllama.generate.mockRejectedValue(new Error('Analysis failed'));

      const result = await OllamaServiceModule.analyzeText('text');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Analysis failed');
    });
  });

  describe('analyzeImage', () => {
    test('should analyze image successfully', async () => {
      const imageBase64 = 'base64encodedimage';
      mockOllama.generate.mockResolvedValue({
        response: 'Image analysis result'
      });

      const result = await OllamaServiceModule.analyzeImage('Describe this image', imageBase64);

      expect(result.success).toBe(true);
      expect(result.response).toBe('Image analysis result');
      expect(mockOllama.generate).toHaveBeenCalledWith({
        model: 'llava',
        prompt: 'Describe this image',
        images: [imageBase64],
        format: undefined,
        options: { num_gpu: -1, main_gpu: 0 },
        stream: false
      });
    });

    test('should use custom vision model', async () => {
      mockOllama.generate.mockResolvedValue({ response: 'result' });

      await OllamaServiceModule.analyzeImage('prompt', 'image', {
        model: 'bakllava'
      });

      expect(mockOllama.generate).toHaveBeenCalledWith({
        model: 'bakllava',
        prompt: 'prompt',
        images: ['image'],
        format: undefined,
        options: { num_gpu: -1, main_gpu: 0 },
        stream: false
      });
    });

    test('should pass ollama options', async () => {
      mockOllama.generate.mockResolvedValue({ response: 'result' });

      await OllamaServiceModule.analyzeImage('prompt', 'image', {
        ollamaOptions: { temperature: 0.3 }
      });

      expect(mockOllama.generate).toHaveBeenCalledWith({
        model: 'llava',
        prompt: 'prompt',
        images: ['image'],
        format: undefined,
        options: { num_gpu: -1, main_gpu: 0, temperature: 0.3 },
        stream: false
      });
    });

    test('should handle image analysis errors', async () => {
      mockOllama.generate.mockRejectedValue(new Error('Vision model failed'));

      const result = await OllamaServiceModule.analyzeImage('prompt', 'image');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Vision model failed');
    });
  });

  describe('Edge Cases and Integration', () => {
    test('should handle concurrent operations', async () => {
      // New API uses embed() with embeddings array response
      mockOllama.embed.mockResolvedValue({ embeddings: [[0.1]] });
      mockOllama.generate.mockResolvedValue({ response: 'result' });

      const results = await Promise.all([
        OllamaServiceModule.generateEmbedding('text1'),
        OllamaServiceModule.generateEmbedding('text2'),
        OllamaServiceModule.analyzeText('text3'),
        OllamaServiceModule.analyzeText('text4')
      ]);

      expect(results).toHaveLength(4);
      expect(results.every((r) => r.success)).toBe(true);
    });

    test('should maintain state across multiple operations', async () => {
      mockOllama.list.mockResolvedValue({ models: [{ name: 'llama2' }] });

      await OllamaServiceModule.initialize();
      await OllamaServiceModule.getConfig();

      await OllamaServiceModule.updateConfig({ textModel: 'mistral' });
      getOllamaModel.mockReturnValue('mistral');

      const config2 = await OllamaServiceModule.getConfig();

      expect(config2.textModel).toBe('mistral');
    });

    test('should handle rapid repeated calls', async () => {
      // New API uses embed() with embeddings array response
      mockOllama.embed.mockResolvedValue({ embeddings: [[0.1]] });

      const calls = Array(100)
        .fill(null)
        .map((_, i) => OllamaServiceModule.generateEmbedding(`text${i}`));

      const results = await Promise.all(calls);

      expect(results).toHaveLength(100);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });
});
