/**
 * Tests for OllamaService
 * TIER 1 - CRITICAL: Core Ollama integration service
 * Testing the centralized Ollama operations wrapper
 */

const OllamaService = require('../src/main/services/OllamaService');

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
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
  setOllamaEmbeddingModel: jest.fn().mockResolvedValue(true),
}));

// Mock Ollama constructor
jest.mock('ollama', () => {
  const mockOllamaInstance = {
    list: jest.fn(),
    pull: jest.fn(),
    embeddings: jest.fn(),
    generate: jest.fn(),
  };

  return {
    Ollama: jest.fn().mockImplementation(() => mockOllamaInstance),
  };
});

describe('OllamaService', () => {
  let mockOllama;
  let MockOllama;
  const {
    loadOllamaConfig,
    saveOllamaConfig,
    getOllama,
    getOllamaHost,
    getOllamaModel,
    getOllamaVisionModel,
    getOllamaEmbeddingModel,
    setOllamaHost,
    setOllamaModel,
    setOllamaVisionModel,
    setOllamaEmbeddingModel,
  } = require('../src/main/ollamaUtils');

  beforeEach(() => {
    // Reset the service singleton state
    OllamaService.initialized = false;

    // Setup mock Ollama client
    mockOllama = {
      list: jest.fn(),
      pull: jest.fn(),
      embeddings: jest.fn(),
      generate: jest.fn(),
    };

    getOllama.mockReturnValue(mockOllama);

    // Get the mocked Ollama constructor and make it return our mock instance
    MockOllama = require('ollama').Ollama;
    MockOllama.mockReturnValue(mockOllama);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    test('should initialize successfully', async () => {
      await OllamaService.initialize();

      expect(OllamaService.initialized).toBe(true);
      expect(loadOllamaConfig).toHaveBeenCalled();
    });

    test('should not re-initialize if already initialized', async () => {
      await OllamaService.initialize();
      await OllamaService.initialize();

      expect(loadOllamaConfig).toHaveBeenCalledTimes(1);
    });

    test('should throw error if initialization fails', async () => {
      loadOllamaConfig.mockRejectedValueOnce(new Error('Config load failed'));

      await expect(OllamaService.initialize()).rejects.toThrow(
        'Config load failed',
      );
      expect(OllamaService.initialized).toBe(false);
    });
  });

  describe('getConfig', () => {
    test('should return current configuration', async () => {
      const config = await OllamaService.getConfig();

      expect(config).toEqual({
        host: 'http://localhost:11434',
        textModel: 'llama2',
        visionModel: 'llava',
        embeddingModel: 'mxbai-embed-large',
      });
      expect(getOllamaHost).toHaveBeenCalled();
      expect(getOllamaModel).toHaveBeenCalled();
      expect(getOllamaVisionModel).toHaveBeenCalled();
      expect(getOllamaEmbeddingModel).toHaveBeenCalled();
    });

    test('should initialize before returning config', async () => {
      OllamaService.initialized = false;

      await OllamaService.getConfig();

      expect(loadOllamaConfig).toHaveBeenCalled();
    });
  });

  describe('updateConfig', () => {
    test('should update all config fields', async () => {
      const newConfig = {
        host: 'http://localhost:11435',
        textModel: 'mistral',
        visionModel: 'bakllava',
        embeddingModel: 'nomic-embed-text',
      };

      const result = await OllamaService.updateConfig(newConfig);

      expect(result.success).toBe(true);
      expect(setOllamaHost).toHaveBeenCalledWith('http://localhost:11435');
      expect(setOllamaModel).toHaveBeenCalledWith('mistral');
      expect(setOllamaVisionModel).toHaveBeenCalledWith('bakllava');
      expect(setOllamaEmbeddingModel).toHaveBeenCalledWith(
        'nomic-embed-text',
      );
      expect(saveOllamaConfig).toHaveBeenCalled();
    });

    test('should update partial config', async () => {
      const result = await OllamaService.updateConfig({
        textModel: 'llama3',
      });

      expect(result.success).toBe(true);
      expect(setOllamaModel).toHaveBeenCalledWith('llama3');
      expect(setOllamaHost).not.toHaveBeenCalled();
      expect(setOllamaVisionModel).not.toHaveBeenCalled();
      expect(saveOllamaConfig).toHaveBeenCalled();
    });

    test('should handle update errors gracefully', async () => {
      setOllamaHost.mockRejectedValueOnce(new Error('Invalid host'));

      const result = await OllamaService.updateConfig({
        host: 'invalid-host',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid host');
    });
  });

  describe('testConnection', () => {
    test('should test connection successfully', async () => {
      mockOllama.list.mockResolvedValue({
        models: [{ name: 'llama2' }, { name: 'mistral' }],
      });

      const result = await OllamaService.testConnection();

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

      const result = await OllamaService.testConnection(customHost);

      expect(result.success).toBe(true);
      expect(result.ollamaHealth.host).toBe(customHost);
      expect(MockOllama).toHaveBeenCalledWith({ host: customHost });
    });

    test('should handle connection failure', async () => {
      mockOllama.list.mockRejectedValue(new Error('Connection refused'));

      const result = await OllamaService.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
      expect(result.ollamaHealth.status).toBe('unhealthy');
      expect(result.ollamaHealth.error).toBe('Connection refused');
    });

    test('should handle empty model list', async () => {
      mockOllama.list.mockResolvedValue({ models: [] });

      const result = await OllamaService.testConnection();

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
          { name: 'nomic-embed-text' },
        ],
      });

      const result = await OllamaService.getModels();

      expect(result.success).toBe(true);
      expect(result.models).toHaveLength(6);
      expect(result.categories.text).toEqual(['llama2', 'mistral']);
      expect(result.categories.vision).toEqual(['llava', 'llava:13b']);
      expect(result.categories.embedding).toEqual([
        'mxbai-embed-large',
        'nomic-embed-text',
      ]);
    });

    test('should include current selections', async () => {
      mockOllama.list.mockResolvedValue({ models: [] });

      const result = await OllamaService.getModels();

      expect(result.selected).toEqual({
        textModel: 'llama2',
        visionModel: 'llava',
        embeddingModel: 'mxbai-embed-large',
      });
    });

    test('should handle model list errors', async () => {
      mockOllama.list.mockRejectedValue(new Error('List failed'));

      const result = await OllamaService.getModels();

      expect(result.success).toBe(false);
      expect(result.error).toBe('List failed');
      expect(result.models).toEqual([]);
      expect(result.categories).toEqual({
        text: [],
        vision: [],
        embedding: [],
      });
      expect(result.ollamaHealth.status).toBe('unhealthy');
    });

    test('should handle vision models with various naming patterns', async () => {
      mockOllama.list.mockResolvedValue({
        models: [
          { name: 'llava:latest' },
          { name: 'bakllava' },
          { name: 'vision-model' },
        ],
      });

      const result = await OllamaService.getModels();

      expect(result.categories.vision).toContain('llava:latest');
      expect(result.categories.vision).toContain('bakllava');
      expect(result.categories.vision).toContain('vision-model');
    });

    test('should handle embedding models with various naming patterns', async () => {
      mockOllama.list.mockResolvedValue({
        models: [
          { name: 'mxbai-embed-large' },
          { name: 'nomic-embed-text' },
          { name: 'all-minilm' }, // 'embed' not in name
        ],
      });

      const result = await OllamaService.getModels();

      expect(result.categories.embedding).toContain('mxbai-embed-large');
      expect(result.categories.embedding).toContain('nomic-embed-text');
      // 'all-minilm' won't be in embedding since it doesn't match the pattern
    });
  });

  describe('pullModels', () => {
    test('should pull multiple models successfully', async () => {
      mockOllama.pull.mockResolvedValue({ status: 'success' });

      const result = await OllamaService.pullModels(['llama2', 'mistral']);

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

      const result = await OllamaService.pullModels(['llama2', 'invalid-model']);

      expect(result.success).toBe(true); // At least one succeeded
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);
      expect(result.results[1].error).toBe('Model not found');
    });

    test('should handle empty model list', async () => {
      const result = await OllamaService.pullModels([]);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No models specified');
      expect(result.results).toEqual([]);
      expect(mockOllama.pull).not.toHaveBeenCalled();
    });

    test('should handle non-array input', async () => {
      const result = await OllamaService.pullModels(null);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No models specified');
    });

    test('should handle all failures', async () => {
      mockOllama.pull.mockRejectedValue(new Error('Network error'));

      const result = await OllamaService.pullModels(['model1', 'model2']);

      expect(result.success).toBe(false);
      expect(result.results.every((r) => !r.success)).toBe(true);
    });
  });

  describe('generateEmbedding', () => {
    test('should generate embedding successfully', async () => {
      const mockEmbedding = new Array(1024).fill(0.1);
      mockOllama.embeddings.mockResolvedValue({ embedding: mockEmbedding });

      const result = await OllamaService.generateEmbedding('test text');

      expect(result.success).toBe(true);
      expect(result.embedding).toEqual(mockEmbedding);
      expect(mockOllama.embeddings).toHaveBeenCalledWith({
        model: 'mxbai-embed-large',
        prompt: 'test text',
        options: {},
      });
    });

    test('should use custom model', async () => {
      mockOllama.embeddings.mockResolvedValue({ embedding: [] });

      await OllamaService.generateEmbedding('text', {
        model: 'custom-embed-model',
      });

      expect(mockOllama.embeddings).toHaveBeenCalledWith({
        model: 'custom-embed-model',
        prompt: 'text',
        options: {},
      });
    });

    test('should pass ollama options', async () => {
      mockOllama.embeddings.mockResolvedValue({ embedding: [] });

      await OllamaService.generateEmbedding('text', {
        ollamaOptions: { temperature: 0.5 },
      });

      expect(mockOllama.embeddings).toHaveBeenCalledWith({
        model: 'mxbai-embed-large',
        prompt: 'text',
        options: { temperature: 0.5 },
      });
    });

    test('should handle embedding errors', async () => {
      mockOllama.embeddings.mockRejectedValue(new Error('Embedding failed'));

      const result = await OllamaService.generateEmbedding('text');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Embedding failed');
    });
  });

  describe('analyzeText', () => {
    test('should analyze text successfully', async () => {
      mockOllama.generate.mockResolvedValue({
        response: 'Analysis result',
      });

      const result = await OllamaService.analyzeText('Analyze this text');

      expect(result.success).toBe(true);
      expect(result.response).toBe('Analysis result');
      expect(mockOllama.generate).toHaveBeenCalledWith({
        model: 'llama2',
        prompt: 'Analyze this text',
        options: {},
        stream: false,
      });
    });

    test('should use custom model', async () => {
      mockOllama.generate.mockResolvedValue({ response: 'result' });

      await OllamaService.analyzeText('text', { model: 'mistral' });

      expect(mockOllama.generate).toHaveBeenCalledWith({
        model: 'mistral',
        prompt: 'text',
        options: {},
        stream: false,
      });
    });

    test('should pass ollama options', async () => {
      mockOllama.generate.mockResolvedValue({ response: 'result' });

      await OllamaService.analyzeText('text', {
        ollamaOptions: { temperature: 0.7, num_predict: 100 },
      });

      expect(mockOllama.generate).toHaveBeenCalledWith({
        model: 'llama2',
        prompt: 'text',
        options: { temperature: 0.7, num_predict: 100 },
        stream: false,
      });
    });

    test('should handle analysis errors', async () => {
      mockOllama.generate.mockRejectedValue(new Error('Analysis failed'));

      const result = await OllamaService.analyzeText('text');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Analysis failed');
    });
  });

  describe('analyzeImage', () => {
    test('should analyze image successfully', async () => {
      const imageBase64 = 'base64encodedimage';
      mockOllama.generate.mockResolvedValue({
        response: 'Image analysis result',
      });

      const result = await OllamaService.analyzeImage(
        'Describe this image',
        imageBase64,
      );

      expect(result.success).toBe(true);
      expect(result.response).toBe('Image analysis result');
      expect(mockOllama.generate).toHaveBeenCalledWith({
        model: 'llava',
        prompt: 'Describe this image',
        images: [imageBase64],
        options: {},
        stream: false,
      });
    });

    test('should use custom vision model', async () => {
      mockOllama.generate.mockResolvedValue({ response: 'result' });

      await OllamaService.analyzeImage('prompt', 'image', {
        model: 'bakllava',
      });

      expect(mockOllama.generate).toHaveBeenCalledWith({
        model: 'bakllava',
        prompt: 'prompt',
        images: ['image'],
        options: {},
        stream: false,
      });
    });

    test('should pass ollama options', async () => {
      mockOllama.generate.mockResolvedValue({ response: 'result' });

      await OllamaService.analyzeImage('prompt', 'image', {
        ollamaOptions: { temperature: 0.3 },
      });

      expect(mockOllama.generate).toHaveBeenCalledWith({
        model: 'llava',
        prompt: 'prompt',
        images: ['image'],
        options: { temperature: 0.3 },
        stream: false,
      });
    });

    test('should handle image analysis errors', async () => {
      mockOllama.generate.mockRejectedValue(new Error('Vision model failed'));

      const result = await OllamaService.analyzeImage('prompt', 'image');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Vision model failed');
    });
  });

  describe('Edge Cases and Integration', () => {
    test('should handle concurrent operations', async () => {
      mockOllama.embeddings.mockResolvedValue({ embedding: [0.1] });
      mockOllama.generate.mockResolvedValue({ response: 'result' });

      const results = await Promise.all([
        OllamaService.generateEmbedding('text1'),
        OllamaService.generateEmbedding('text2'),
        OllamaService.analyzeText('text3'),
        OllamaService.analyzeText('text4'),
      ]);

      expect(results).toHaveLength(4);
      expect(results.every((r) => r.success)).toBe(true);
    });

    test('should maintain state across multiple operations', async () => {
      mockOllama.list.mockResolvedValue({ models: [{ name: 'llama2' }] });

      await OllamaService.initialize();
      await OllamaService.getConfig();

      await OllamaService.updateConfig({ textModel: 'mistral' });
      getOllamaModel.mockReturnValue('mistral');

      const config2 = await OllamaService.getConfig();

      expect(config2.textModel).toBe('mistral');
    });

    test('should handle rapid repeated calls', async () => {
      mockOllama.embeddings.mockResolvedValue({ embedding: [0.1] });

      const calls = Array(100)
        .fill(null)
        .map((_, i) => OllamaService.generateEmbedding(`text${i}`));

      const results = await Promise.all(calls);

      expect(results).toHaveLength(100);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });
});
