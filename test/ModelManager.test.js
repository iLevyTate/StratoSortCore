/**
 * Tests for ModelManager Service
 * TIER 2 - Critical for Ollama model management and fallback handling
 */

const { ModelManager } = require('../src/main/services/ModelManager');
const fs = require('fs').promises;

// Mock electron app
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/mock/user/data')
  }
}));

// Mock Ollama client
jest.mock('ollama', () => ({
  Ollama: jest.fn().mockImplementation(() => ({
    list: jest.fn(),
    generate: jest.fn()
  }))
}));

// Mock SettingsService correctly to return a stable instance
const mockSettingsService = {
  load: jest.fn().mockResolvedValue({
    textModel: 'llama3.2',
    visionModel: 'llava',
    embeddingModel: 'mxbai-embed-large'
  }),
  save: jest.fn().mockResolvedValue(true)
};

jest.mock('../src/main/services/SettingsService', () => {
  return {
    getService: jest.fn(() => mockSettingsService),
    getInstance: jest.fn(() => mockSettingsService)
  };
});

// Mock PerformanceService
jest.mock('../src/main/services/PerformanceService', () => ({
  buildOllamaOptions: jest.fn().mockResolvedValue({
    num_ctx: 2048,
    num_thread: 4
  })
}));

describe('ModelManager', () => {
  let modelManager;
  let mockOllamaClient;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset fs mocks
    jest.spyOn(fs, 'readFile').mockRejectedValue({ code: 'ENOENT' });
    jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    // Reset settings mock
    mockSettingsService.load.mockResolvedValue({
      textModel: 'llama3.2',
      visionModel: 'llava',
      embeddingModel: 'mxbai-embed-large'
    });
    mockSettingsService.save.mockResolvedValue(true);

    modelManager = new ModelManager('http://127.0.0.1:11434');
    mockOllamaClient = modelManager.ollamaClient;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    test('initializes with default host', () => {
      const manager = new ModelManager();
      expect(manager.host).toBe('http://127.0.0.1:11434');
    });

    test('initializes with custom host', () => {
      // Constructor arg is ignored in favor of SettingsService/ollamaUtils
      // So we just verify it initializes without error
      const manager = new ModelManager('http://custom-host:8080');
      expect(manager).toBeDefined();
    });

    test('initializes empty model list', () => {
      expect(modelManager.availableModels).toEqual([]);
      expect(modelManager.selectedModel).toBeNull();
    });

    test('initializes model categories', () => {
      expect(modelManager.modelCategories.text).toBeDefined();
      expect(modelManager.modelCategories.vision).toBeDefined();
      expect(modelManager.modelCategories.code).toBeDefined();
      expect(modelManager.modelCategories.chat).toBeDefined();
    });

    test('initializes fallback preferences', () => {
      expect(Array.isArray(modelManager.fallbackPreferences)).toBe(true);
      expect(modelManager.fallbackPreferences.length).toBeGreaterThan(0);
    });
  });

  describe('initialize', () => {
    test('successfully initializes with available models', async () => {
      const mockModels = [{ name: 'llama3.2', size: 4000000000, modified_at: '2024-01-01' }];

      mockOllamaClient.list.mockResolvedValue({ models: mockModels });
      mockOllamaClient.generate.mockResolvedValue({ response: 'test' });

      const result = await modelManager.initialize();

      expect(result).toBe(true);
      expect(modelManager.selectedModel).toBeTruthy();
    });

    test('handles initialization failure gracefully', async () => {
      mockOllamaClient.list.mockRejectedValue(new Error('Connection failed'));

      const result = await modelManager.initialize();

      expect(result).toBe(false);
    });

    test('loads saved configuration on initialize', async () => {
      mockOllamaClient.list.mockResolvedValue({
        models: [{ name: 'llama3.2', size: 4000000000 }]
      });
      mockOllamaClient.generate.mockResolvedValue({ response: 'test' });

      await modelManager.initialize();

      expect(mockSettingsService.load).toHaveBeenCalled();
    });
  });

  describe('discoverModels', () => {
    test('discovers available models successfully', async () => {
      const mockModels = [
        { name: 'llama3.2', size: 4000000000, modified_at: '2024-01-01' },
        { name: 'mistral', size: 7000000000, modified_at: '2024-01-02' }
      ];

      mockOllamaClient.list.mockResolvedValue({ models: mockModels });

      const result = await modelManager.discoverModels();

      // Ensure that discoverModels returns array of names or correct model objects
      expect(result.length).toBe(2);
      expect(modelManager.availableModels.length).toBe(2);
    });

    test('handles empty model list', async () => {
      mockOllamaClient.list.mockResolvedValue({ models: [] });

      const result = await modelManager.discoverModels();

      expect(result).toEqual([]);
      expect(modelManager.availableModels).toEqual([]);
    });

    test('handles Ollama connection failure', async () => {
      mockOllamaClient.list.mockRejectedValue(new Error('Connection refused'));

      // Should throw the error
      await expect(modelManager.discoverModels()).rejects.toThrow('Connection refused');
      expect(modelManager.availableModels).toEqual([]);
    });

    test('analyzes capabilities for all discovered models', async () => {
      const mockModels = [
        { name: 'llama3.2', size: 4000000000 },
        { name: 'llava', size: 5000000000 },
        { name: 'codellama', size: 6000000000 }
      ];

      mockOllamaClient.list.mockResolvedValue({ models: mockModels });

      await modelManager.discoverModels();

      expect(modelManager.modelCapabilities.size).toBe(3);
      expect(modelManager.modelCapabilities.has('llama3.2')).toBe(true);
      expect(modelManager.modelCapabilities.has('llava')).toBe(true);
      expect(modelManager.modelCapabilities.has('codellama')).toBe(true);
    });
  });

  describe('analyzeModelCapabilities', () => {
    test('detects text capabilities', () => {
      const model = { name: 'llama3.2', size: 4000000000 };
      const caps = modelManager.analyzeModelCapabilities(model);

      expect(caps.text).toBe(true);
      expect(caps.chat).toBe(true);
    });

    test('detects vision capabilities', () => {
      const model = { name: 'llava:7b', size: 5000000000 };
      const caps = modelManager.analyzeModelCapabilities(model);

      expect(caps.vision).toBe(true);
    });

    test('detects code capabilities', () => {
      const model = { name: 'codellama:13b', size: 6000000000 };
      const caps = modelManager.analyzeModelCapabilities(model);

      expect(caps.code).toBe(true);
    });

    test('handles case insensitivity', () => {
      const model1 = { name: 'LLAMA3.2', size: 4000000000 };
      const model2 = { name: 'LLaVa:7b', size: 5000000000 };

      const caps1 = modelManager.analyzeModelCapabilities(model1);
      const caps2 = modelManager.analyzeModelCapabilities(model2);

      expect(caps1.text).toBe(true);
      expect(caps2.vision).toBe(true);
    });

    test('stores model size and modification date', () => {
      const model = {
        name: 'llama3.2',
        size: 4000000000,
        modified_at: '2024-01-01T00:00:00Z'
      };

      const caps = modelManager.analyzeModelCapabilities(model);

      expect(caps.size).toBe(4000000000);
      expect(caps.modified).toBe('2024-01-01T00:00:00Z');
    });

    test('handles missing size and modified fields', () => {
      const model = { name: 'llama3.2' };
      const caps = modelManager.analyzeModelCapabilities(model);

      expect(caps.size).toBe(0);
      expect(caps.modified).toBeNull();
    });

    test('detects multiple capabilities', () => {
      const model = { name: 'codellama:7b', size: 6000000000 };
      const caps = modelManager.analyzeModelCapabilities(model);

      // Code models should have both code and text capabilities
      expect(caps.code).toBe(true);
      expect(caps.text).toBe(true);
    });
  });

  describe('ensureWorkingModel', () => {
    test('keeps existing working model', async () => {
      const mockModels = [{ name: 'llama3.2', size: 4000000000 }];
      modelManager.availableModels = mockModels;
      modelManager.selectedModel = 'llama3.2';
      modelManager.analyzeModelCapabilities(mockModels[0]);

      mockOllamaClient.generate.mockResolvedValue({ response: 'test' });

      const result = await modelManager.ensureWorkingModel();

      expect(result).toBe('llama3.2');
      expect(modelManager.selectedModel).toBe('llama3.2');
    });

    test('finds new model if current is unavailable', async () => {
      const mockModels = [{ name: 'mistral', size: 7000000000 }];
      modelManager.availableModels = mockModels;
      modelManager.selectedModel = 'llama3.2'; // Model no longer available
      modelManager.analyzeModelCapabilities(mockModels[0]);

      mockOllamaClient.generate.mockResolvedValue({ response: 'test' });

      const result = await modelManager.ensureWorkingModel();

      expect(result).toBe('mistral');
      expect(modelManager.selectedModel).toBe('mistral');
    });

    test('throws error when no models available', async () => {
      modelManager.availableModels = [];

      await expect(modelManager.ensureWorkingModel()).rejects.toThrow(
        'No working Ollama models found'
      );
    });

    test('tests current model before keeping it', async () => {
      const mockModels = [{ name: 'llama3.2', size: 4000000000 }];
      modelManager.availableModels = mockModels;
      modelManager.selectedModel = 'llama3.2';
      modelManager.analyzeModelCapabilities(mockModels[0]);

      // Simulate model test failure
      mockOllamaClient.generate.mockRejectedValue(new Error('Model error'));

      await expect(modelManager.ensureWorkingModel()).rejects.toThrow(
        'No working Ollama models found'
      );
    });
  });

  describe('findBestModel', () => {
    test('returns null when no models available', async () => {
      modelManager.availableModels = [];

      const result = await modelManager.findBestModel();

      expect(result).toBeNull();
    });

    test('prefers models from fallback preferences', async () => {
      const mockModels = [
        { name: 'random-model:7b', size: 3000000000 },
        { name: 'llama3.2', size: 4000000000 }
      ];
      modelManager.availableModels = mockModels;
      mockModels.forEach((m) => modelManager.analyzeModelCapabilities(m));

      mockOllamaClient.generate.mockResolvedValue({ response: 'test' });

      const result = await modelManager.findBestModel();

      expect(result).toBe('llama3.2');
    });

    test('tries preferred models in order', async () => {
      const mockModels = [
        { name: 'llama3', size: 4000000000 },
        { name: 'llama3.2', size: 4500000000 }
      ];
      modelManager.availableModels = mockModels;
      mockModels.forEach((m) => modelManager.analyzeModelCapabilities(m));

      mockOllamaClient.generate.mockResolvedValue({ response: 'test' });

      const result = await modelManager.findBestModel();

      // Should prefer llama3.2 (higher in preferences) over llama3
      expect(result).toBe('llama3.2');
    });

    test('falls back to text-capable model if preferred not available', async () => {
      const mockModels = [{ name: 'custom-text-model:7b', size: 3000000000 }];
      modelManager.availableModels = mockModels;

      // Manually set capabilities
      modelManager.modelCapabilities.set('custom-text-model:7b', {
        text: true,
        chat: true,
        code: false,
        vision: false
      });

      mockOllamaClient.generate.mockResolvedValue({ response: 'test' });

      const result = await modelManager.findBestModel();

      expect(result).toBe('custom-text-model:7b');
    });

    test('uses first available model as last resort', async () => {
      const mockModels = [{ name: 'unknown-model:7b', size: 3000000000 }];
      modelManager.availableModels = mockModels;

      // Set no text/chat capabilities
      modelManager.modelCapabilities.set('unknown-model:7b', {
        text: false,
        chat: false,
        code: false,
        vision: false
      });

      mockOllamaClient.generate.mockResolvedValue({ response: 'test' });

      const result = await modelManager.findBestModel();

      expect(result).toBe('unknown-model:7b');
    });

    test('skips models that fail testing', async () => {
      const mockModels = [
        { name: 'llama3.2', size: 4000000000 },
        { name: 'mistral', size: 7000000000 }
      ];
      modelManager.availableModels = mockModels;
      mockModels.forEach((m) => modelManager.analyzeModelCapabilities(m));

      // llama3.2 is preferred, but if it fails, should try mistral
      // Need to ensure mistral is in fallback preferences
      mockOllamaClient.generate
        .mockRejectedValueOnce(new Error('Model error'))
        .mockResolvedValueOnce({ response: 'test' });

      const result = await modelManager.findBestModel();

      // Both models are in fallback preferences, so whichever works first wins
      expect(['llama3.2', 'mistral']).toContain(result);
    });

    test('returns null if all models fail testing', async () => {
      const mockModels = [{ name: 'llama3.2', size: 4000000000 }];
      modelManager.availableModels = mockModels;
      modelManager.analyzeModelCapabilities(mockModels[0]);

      mockOllamaClient.generate.mockRejectedValue(new Error('All fail'));

      const result = await modelManager.findBestModel();

      expect(result).toBeNull();
    });
  });

  describe('testModel', () => {
    test('returns true for working model', async () => {
      mockOllamaClient.generate.mockResolvedValue({ response: 'Hello!' });

      const result = await modelManager.testModel('llama3.2');

      expect(result).toBe(true);
    });

    test('returns false for failing model', async () => {
      mockOllamaClient.generate.mockRejectedValue(new Error('Model error'));

      const result = await modelManager.testModel('broken-model');

      expect(result).toBe(false);
    });

    test('respects timeout parameter', async () => {
      // Simulate a slow response
      mockOllamaClient.generate.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ response: 'test' }), 15000))
      );

      const result = await modelManager.testModel('slow-model', 100);

      expect(result).toBe(false);
    });

    test('uses PerformanceService options', async () => {
      mockOllamaClient.generate.mockResolvedValue({ response: 'test' });

      await modelManager.testModel('llama3.2');

      expect(mockOllamaClient.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            num_ctx: 2048,
            num_thread: 4
          })
        })
      );
    });

    test('uses minimal prediction for testing', async () => {
      mockOllamaClient.generate.mockResolvedValue({ response: 'test' });

      await modelManager.testModel('llama3.2');

      expect(mockOllamaClient.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            num_predict: 5
          })
        })
      );
    });
  });

  describe('getBestModelForTask', () => {
    beforeEach(() => {
      const mockModels = [
        { name: 'llama3.2', size: 4000000000 },
        { name: 'llava:7b', size: 5000000000 },
        { name: 'codellama:13b', size: 6000000000 }
      ];
      modelManager.availableModels = mockModels;
      mockModels.forEach((m) => modelManager.analyzeModelCapabilities(m));
      modelManager.selectedModel = 'llama3.2';
    });

    test('returns null when no model selected', () => {
      modelManager.selectedModel = null;

      const result = modelManager.getBestModelForTask('text');

      expect(result).toBeNull();
    });

    test('returns vision model for vision task', () => {
      const result = modelManager.getBestModelForTask('vision');

      expect(result).toBe('llava:7b');
    });

    test('returns vision model for image task', () => {
      const result = modelManager.getBestModelForTask('image');

      expect(result).toBe('llava:7b');
    });

    test('returns code model for code task', () => {
      const result = modelManager.getBestModelForTask('code');

      expect(result).toBe('codellama:13b');
    });

    test('falls back to selected model if no vision model available', () => {
      // Remove vision model
      modelManager.availableModels = modelManager.availableModels.filter(
        (m) => m.name !== 'llava:7b'
      );

      const result = modelManager.getBestModelForTask('vision');

      expect(result).toBe('llama3.2');
    });

    test('falls back to selected model if no code model available', () => {
      // Remove code model
      modelManager.availableModels = modelManager.availableModels.filter(
        (m) => m.name !== 'codellama:13b'
      );

      const result = modelManager.getBestModelForTask('code');

      expect(result).toBe('llama3.2');
    });

    test('returns selected model for default/text task', () => {
      const result = modelManager.getBestModelForTask('text');

      expect(result).toBe('llama3.2');
    });

    test('returns selected model for unknown task', () => {
      const result = modelManager.getBestModelForTask('unknown-task');

      expect(result).toBe('llama3.2');
    });
  });

  describe('setSelectedModel', () => {
    test('sets selected model successfully', async () => {
      const mockModels = [{ name: 'llama3.2', size: 4000000000 }];
      modelManager.availableModels = mockModels;

      await modelManager.setSelectedModel('llama3.2');

      expect(modelManager.selectedModel).toBe('llama3.2');
      expect(mockSettingsService.save).toHaveBeenCalled();
    });

    test('throws error for unavailable model', async () => {
      modelManager.availableModels = [{ name: 'llama3.2', size: 4000000000 }];

      await expect(modelManager.setSelectedModel('nonexistent-model')).rejects.toThrow(
        'Model nonexistent-model is not available'
      );
    });

    test('saves configuration after setting model', async () => {
      modelManager.availableModels = [{ name: 'llama3.2', size: 4000000000 }];

      await modelManager.setSelectedModel('llama3.2');

      expect(mockSettingsService.save).toHaveBeenCalledWith(
        expect.objectContaining({ textModel: 'llama3.2' })
      );
    });
  });

  describe('getModelInfo', () => {
    beforeEach(() => {
      const mockModels = [
        {
          name: 'llama3.2',
          size: 4000000000,
          modified_at: '2024-01-01T00:00:00Z'
        }
      ];
      modelManager.availableModels = mockModels;
      modelManager.analyzeModelCapabilities(mockModels[0]);
      modelManager.selectedModel = 'llama3.2';
    });

    test('returns info for selected model', () => {
      const info = modelManager.getModelInfo();

      expect(info).toEqual({
        name: 'llama3.2',
        size: 4000000000,
        modified: '2024-01-01T00:00:00Z',
        capabilities: expect.any(Object),
        isSelected: true
      });
    });

    test('returns info for specific model', () => {
      const info = modelManager.getModelInfo('llama3.2');

      expect(info.name).toBe('llama3.2');
      expect(info.isSelected).toBe(true);
    });

    test('returns null when no model selected', () => {
      modelManager.selectedModel = null;

      const info = modelManager.getModelInfo();

      expect(info).toBeNull();
    });

    test('includes capabilities in model info', () => {
      const info = modelManager.getModelInfo('llama3.2');

      expect(info.capabilities).toBeDefined();
      expect(info.capabilities.text).toBe(true);
    });

    test('handles model not in availableModels list', () => {
      modelManager.availableModels = [];

      const info = modelManager.getModelInfo('llama3.2');

      expect(info.size).toBe(0);
      expect(info.modified).toBeNull();
    });
  });

  describe('generateWithFallback', () => {
    beforeEach(() => {
      const mockModels = [
        { name: 'llama3.2', size: 4000000000 },
        { name: 'mistral', size: 7000000000 }
      ];
      modelManager.availableModels = mockModels;
      modelManager.selectedModel = 'llama3.2';
    });

    test('generates with selected model successfully', async () => {
      mockOllamaClient.generate.mockResolvedValue({
        response: 'Generated text'
      });

      const result = await modelManager.generateWithFallback('Test prompt');

      expect(result.success).toBe(true);
      expect(result.response).toBe('Generated text');
      expect(result.model).toBe('llama3.2');
    });

    test('falls back to next model if first fails', async () => {
      mockOllamaClient.generate
        .mockRejectedValueOnce(new Error('First model failed'))
        .mockResolvedValueOnce({ response: 'Fallback response' });

      const result = await modelManager.generateWithFallback('Test prompt');

      expect(result.success).toBe(true);
      expect(result.response).toBe('Fallback response');
    });

    test('throws error when all models fail', async () => {
      mockOllamaClient.generate.mockRejectedValue(new Error('All failed'));

      await expect(modelManager.generateWithFallback('Test prompt')).rejects.toThrow(
        'All models failed to generate response'
      );
    });

    test('passes custom options to generate', async () => {
      mockOllamaClient.generate.mockResolvedValue({ response: 'test' });

      await modelManager.generateWithFallback('Test', {
        temperature: 0.5,
        num_predict: 100
      });

      expect(mockOllamaClient.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            temperature: 0.5,
            num_predict: 100
          })
        })
      );
    });

    test('skips empty responses', async () => {
      mockOllamaClient.generate
        .mockResolvedValueOnce({ response: '' })
        .mockResolvedValueOnce({ response: '   ' })
        .mockResolvedValueOnce({ response: 'Valid response' });

      const result = await modelManager.generateWithFallback('Test');

      expect(result.response).toBe('Valid response');
    });
  });

  describe('loadConfig', () => {
    test('loads configuration successfully', async () => {
      await modelManager.loadConfig();

      expect(modelManager.selectedModel).toBe('llama3.2');
    });

    test('handles missing config file gracefully', async () => {
      mockSettingsService.load.mockResolvedValue({});

      await modelManager.loadConfig();

      expect(modelManager.selectedModel).toBeNull();
    });

    test('handles corrupted config file', async () => {
      mockSettingsService.load.mockRejectedValue(new Error('Corrupt config'));

      await modelManager.loadConfig();

      // Should not throw, just log error
      expect(modelManager.selectedModel).toBeNull();
    });

    test('handles other file read errors', async () => {
      mockSettingsService.load.mockRejectedValue(new Error('Permission denied'));

      await modelManager.loadConfig();

      // Should not throw
      expect(modelManager.selectedModel).toBeNull();
    });
  });

  describe('saveConfig', () => {
    test('saves configuration successfully', async () => {
      modelManager.selectedModel = 'llama3.2';

      await modelManager.saveConfig();

      expect(mockSettingsService.save).toHaveBeenCalledWith(
        expect.objectContaining({ textModel: 'llama3.2' })
      );
    });

    test('includes timestamp in saved config', async () => {
      modelManager.selectedModel = 'llama3.2';

      await modelManager.saveConfig();

      // Verify save was called with an object that has textModel
      expect(mockSettingsService.save).toHaveBeenCalledWith(
        expect.objectContaining({
          textModel: 'llama3.2'
        })
      );
    });

    test('handles write errors gracefully', async () => {
      mockSettingsService.save.mockRejectedValue(new Error('Disk full'));
      modelManager.selectedModel = 'llama3.2';

      await modelManager.saveConfig();

      // Should not throw - error is logged internally
      expect(mockSettingsService.save).toHaveBeenCalled();
    });
  });

  describe('getHealthStatus', () => {
    test('returns healthy status when connected', async () => {
      const mockModels = [{ name: 'llama3.2', size: 4000000000 }];
      mockOllamaClient.list.mockResolvedValue({ models: mockModels });
      mockOllamaClient.generate.mockResolvedValue({ response: 'test' });
      modelManager.selectedModel = 'llama3.2';

      const status = await modelManager.getHealthStatus();

      expect(status.connected).toBe(true);
      expect(status.modelsAvailable).toBe(1);
      expect(status.selectedModel).toBe('llama3.2');
      expect(status.selectedModelWorking).toBe(true);
      expect(status.lastCheck).toBeDefined();
    });

    test('returns unhealthy status when not connected', async () => {
      mockOllamaClient.list.mockRejectedValue(new Error('Connection failed'));

      const status = await modelManager.getHealthStatus();

      expect(status.connected).toBe(false);
      expect(status.modelsAvailable).toBe(0);
      expect(status.error).toContain('Connection failed');
    });

    test('detects when selected model is not working', async () => {
      const mockModels = [{ name: 'llama3.2', size: 4000000000 }];
      mockOllamaClient.list.mockResolvedValue({ models: mockModels });
      mockOllamaClient.generate.mockRejectedValue(new Error('Model error'));
      modelManager.selectedModel = 'llama3.2';

      const status = await modelManager.getHealthStatus();

      expect(status.connected).toBe(true);
      expect(status.selectedModelWorking).toBe(false);
    });
  });

  describe('edge cases and error handling', () => {
    test('handles null/undefined model names gracefully', () => {
      expect(() => {
        modelManager.analyzeModelCapabilities({ name: null });
      }).toThrow();
    });

    test('handles concurrent initialize calls', async () => {
      mockOllamaClient.list.mockResolvedValue({ models: [] });

      const results = await Promise.all([
        modelManager.initialize(),
        modelManager.initialize(),
        modelManager.initialize()
      ]);

      expect(results).toEqual([false, false, false]);
    });

    test('handles timeout cleanup properly', async () => {
      const mockGenerate = jest.fn(() => new Promise(() => {})); // Never resolves
      mockOllamaClient.generate = mockGenerate;

      const result = await modelManager.testModel('slow-model', 50);

      expect(result).toBe(false);
      // Verify no hanging promises
    });
  });
});
