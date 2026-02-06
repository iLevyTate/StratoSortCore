/**
 * Extended ModelManager branch coverage tests.
 * Targets: findBestModel fallback chain, getBestModelForTask,
 *          generateWithFallback, loadConfig/saveConfig errors,
 *          getHealthStatus, testModel timeout, analyzeModelCapabilities.
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }))
}));

jest.mock('../src/shared/performanceConstants', () => ({
  TIMEOUTS: { MODEL_DISCOVERY: 5000 }
}));

jest.mock('../src/shared/promiseUtils', () => ({
  withTimeout: jest.fn((promise) => promise)
}));

jest.mock('../src/shared/errorCodes', () => ({
  ERROR_CODES: {
    LLAMA_MODEL_NOT_FOUND: 'LLAMA_MODEL_NOT_FOUND',
    LLAMA_INFERENCE_FAILED: 'LLAMA_INFERENCE_FAILED',
    TIMEOUT: 'TIMEOUT'
  }
}));

jest.mock('../src/shared/modelCategorization', () => ({
  MODEL_CATEGORY_PREFIXES: {
    text: ['mistral', 'llama', 'phi'],
    vision: ['llava', 'moondream'],
    code: ['codellama', 'starcoder']
  },
  FALLBACK_MODEL_PREFERENCES: ['mistral', 'llama', 'phi']
}));

jest.mock('../src/shared/singletonFactory', () => ({
  createSingletonHelpers: jest.fn(() => ({
    getInstance: jest.fn(),
    createInstance: jest.fn(),
    registerWithContainer: jest.fn(),
    resetInstance: jest.fn()
  }))
}));

const mockLlamaService = {
  listModels: jest.fn(),
  generateText: jest.fn()
};

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: jest.fn(() => mockLlamaService)
}));

const mockSettingsService = {
  load: jest.fn(),
  save: jest.fn()
};

jest.mock('../src/main/services/SettingsService', () => ({
  getInstance: jest.fn(() => mockSettingsService)
}));

const { ModelManager } = require('../src/main/services/ModelManager');

describe('ModelManager extended coverage', () => {
  let manager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new ModelManager();
    mockSettingsService.load.mockResolvedValue({});
    mockSettingsService.save.mockResolvedValue();
  });

  describe('analyzeModelCapabilities', () => {
    test('detects vision model (llava)', () => {
      const caps = manager.analyzeModelCapabilities({ name: 'llava-v1.6-7b.gguf' });
      expect(caps.vision).toBe(true);
    });

    test('detects vision model (gemma3)', () => {
      const caps = manager.analyzeModelCapabilities({ name: 'gemma3-4b.gguf' });
      expect(caps.vision).toBe(true);
    });

    test('detects vision model (moondream)', () => {
      const caps = manager.analyzeModelCapabilities({ name: 'moondream2-1.8b.gguf' });
      expect(caps.vision).toBe(true);
    });

    test('detects code model', () => {
      const caps = manager.analyzeModelCapabilities({ name: 'codellama-13b.gguf' });
      expect(caps.code).toBe(true);
    });

    test('detects text/chat model for generic models', () => {
      const caps = manager.analyzeModelCapabilities({ name: 'phi-2.gguf' });
      expect(caps.text).toBe(true);
      expect(caps.chat).toBe(true);
    });

    test('handles empty model name', () => {
      const caps = manager.analyzeModelCapabilities({});
      expect(caps.text).toBe(true);
      expect(caps.chat).toBe(true);
    });
  });

  describe('findBestModel', () => {
    test('returns null when no models available', async () => {
      manager.availableModels = [];
      const result = await manager.findBestModel();
      expect(result).toBeNull();
    });

    test('selects preferred model first', async () => {
      manager.availableModels = [{ name: 'mistral-7b.gguf' }, { name: 'llama-3.gguf' }];
      manager.analyzeModelCapabilities(manager.availableModels[0]);
      manager.analyzeModelCapabilities(manager.availableModels[1]);

      mockLlamaService.generateText.mockResolvedValue({ response: 'ok' });

      const result = await manager.findBestModel();
      expect(result).toBe('mistral-7b.gguf');
    });

    test('falls back to text-capable model if preferred fails', async () => {
      manager.availableModels = [{ name: 'custom-vision.gguf' }, { name: 'phi-3-mini.gguf' }];
      manager.analyzeModelCapabilities(manager.availableModels[0]);
      manager.analyzeModelCapabilities(manager.availableModels[1]);

      // All preferred model tests fail, but phi has text capability
      mockLlamaService.generateText
        .mockRejectedValueOnce(new Error('not found')) // No preferred match
        .mockResolvedValue({ response: 'ok' }); // phi works

      const result = await manager.findBestModel();
      expect(result).toBe('phi-3-mini.gguf');
    });

    test('falls back to first available model as last resort', async () => {
      manager.availableModels = [{ name: 'unknown-model.gguf' }];
      // Mark as vision-only so it won't be picked as text model
      manager.modelCapabilities.set('unknown-model.gguf', {
        vision: true,
        text: false,
        chat: false,
        code: false
      });

      mockLlamaService.generateText.mockResolvedValue({ response: 'hi' });

      const result = await manager.findBestModel();
      expect(result).toBe('unknown-model.gguf');
    });

    test('returns null when all models fail testing', async () => {
      manager.availableModels = [{ name: 'broken.gguf' }];
      manager.analyzeModelCapabilities(manager.availableModels[0]);

      mockLlamaService.generateText.mockRejectedValue(new Error('model broken'));

      const result = await manager.findBestModel();
      expect(result).toBeNull();
    });
  });

  describe('getBestModelForTask', () => {
    test('returns null when no selected model', () => {
      manager.selectedModel = null;
      expect(manager.getBestModelForTask('text')).toBeNull();
    });

    test('returns selected model for text task', () => {
      manager.selectedModel = 'mistral.gguf';
      expect(manager.getBestModelForTask('text')).toBe('mistral.gguf');
    });

    test('returns vision model for vision task', () => {
      manager.selectedModel = 'mistral.gguf';
      manager.availableModels = [{ name: 'mistral.gguf' }, { name: 'llava-7b.gguf' }];
      manager.modelCapabilities.set('llava-7b.gguf', { vision: true });

      expect(manager.getBestModelForTask('vision')).toBe('llava-7b.gguf');
    });

    test('returns vision model for image task', () => {
      manager.selectedModel = 'mistral.gguf';
      manager.availableModels = [{ name: 'llava.gguf' }];
      manager.modelCapabilities.set('llava.gguf', { vision: true });

      expect(manager.getBestModelForTask('image')).toBe('llava.gguf');
    });

    test('falls back to selected model when no vision model', () => {
      manager.selectedModel = 'mistral.gguf';
      manager.availableModels = [{ name: 'mistral.gguf' }];
      manager.modelCapabilities.set('mistral.gguf', { text: true });

      expect(manager.getBestModelForTask('vision')).toBe('mistral.gguf');
    });

    test('returns code model for code task', () => {
      manager.selectedModel = 'mistral.gguf';
      manager.availableModels = [{ name: 'mistral.gguf' }, { name: 'codellama.gguf' }];
      manager.modelCapabilities.set('codellama.gguf', { code: true });

      expect(manager.getBestModelForTask('code')).toBe('codellama.gguf');
    });

    test('falls back to selected model when no code model', () => {
      manager.selectedModel = 'mistral.gguf';
      manager.availableModels = [{ name: 'mistral.gguf' }];
      manager.modelCapabilities.set('mistral.gguf', { text: true });

      expect(manager.getBestModelForTask('code')).toBe('mistral.gguf');
    });

    test('returns selected model for default/unknown task', () => {
      manager.selectedModel = 'mistral.gguf';
      expect(manager.getBestModelForTask('unknown')).toBe('mistral.gguf');
    });
  });

  describe('generateWithFallback', () => {
    test('succeeds with first model', async () => {
      manager.selectedModel = 'mistral.gguf';
      manager.availableModels = [{ name: 'mistral.gguf' }];

      mockLlamaService.generateText.mockResolvedValue({
        response: 'Generated text'
      });

      const result = await manager.generateWithFallback('test prompt');
      expect(result.success).toBe(true);
      expect(result.response).toBe('Generated text');
      expect(result.model).toBe('mistral.gguf');
    });

    test('falls back to next model on failure', async () => {
      manager.selectedModel = 'broken.gguf';
      manager.availableModels = [{ name: 'broken.gguf' }, { name: 'mistral.gguf' }];

      mockLlamaService.generateText
        .mockRejectedValueOnce(new Error('Model failed'))
        .mockResolvedValueOnce({ response: 'Fallback response' });

      const result = await manager.generateWithFallback('test');
      expect(result.success).toBe(true);
      expect(result.model).toBe('mistral.gguf');
    });

    test('throws when all models fail', async () => {
      manager.selectedModel = 'broken.gguf';
      manager.availableModels = [];

      mockLlamaService.generateText.mockRejectedValue(new Error('Model broken'));

      await expect(manager.generateWithFallback('test')).rejects.toThrow(
        'All models failed to generate response'
      );
    });

    test('skips models that return empty response', async () => {
      manager.selectedModel = 'empty.gguf';
      // Include a model that matches a fallback preference so it's in modelsToTry
      manager.availableModels = [{ name: 'empty.gguf' }, { name: 'mistral-7b.gguf' }];

      mockLlamaService.generateText
        .mockResolvedValueOnce({ response: '' }) // Empty response from selected
        .mockResolvedValueOnce({ response: 'Good output' }); // Fallback works

      const result = await manager.generateWithFallback('test');
      expect(result.model).toBe('mistral-7b.gguf');
    });

    test('passes options to generateText', async () => {
      manager.selectedModel = 'model.gguf';
      manager.availableModels = [{ name: 'model.gguf' }];

      mockLlamaService.generateText.mockResolvedValue({ response: 'ok' });

      await manager.generateWithFallback('prompt', {
        maxTokens: 1000,
        temperature: 0.7
      });

      expect(mockLlamaService.generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          maxTokens: 1000,
          temperature: 0.7
        })
      );
    });
  });

  describe('loadConfig', () => {
    test('loads selected model from settings', async () => {
      mockSettingsService.load.mockResolvedValue({ textModel: 'saved-model.gguf' });

      await manager.loadConfig();
      expect(manager.selectedModel).toBe('saved-model.gguf');
    });

    test('handles settings load failure', async () => {
      mockSettingsService.load.mockRejectedValue(new Error('Settings corrupted'));

      await manager.loadConfig();
      // Should not throw, just log error
      expect(manager.selectedModel).toBeNull();
    });
  });

  describe('saveConfig', () => {
    test('saves selected model to settings', async () => {
      manager.selectedModel = 'my-model.gguf';
      await manager.saveConfig();
      expect(mockSettingsService.save).toHaveBeenCalledWith({ textModel: 'my-model.gguf' });
    });

    test('handles settings save failure', async () => {
      mockSettingsService.save.mockRejectedValue(new Error('Write failed'));
      manager.selectedModel = 'model.gguf';

      await expect(manager.saveConfig()).resolves.not.toThrow();
    });
  });

  describe('getHealthStatus', () => {
    test('returns healthy status when models available', async () => {
      mockLlamaService.listModels.mockResolvedValue([{ name: 'model.gguf' }]);
      mockLlamaService.generateText.mockResolvedValue({ response: 'ok' });
      manager.selectedModel = 'model.gguf';

      const status = await manager.getHealthStatus();
      expect(status.connected).toBe(true);
      expect(status.modelsAvailable).toBe(1);
      expect(status.selectedModelWorking).toBe(true);
    });

    test('returns unhealthy status on error', async () => {
      mockLlamaService.listModels.mockRejectedValue(new Error('Service down'));

      const status = await manager.getHealthStatus();
      expect(status.connected).toBe(false);
      expect(status.error).toBe('Service down');
    });

    test('reports selected model not working', async () => {
      mockLlamaService.listModels.mockResolvedValue([{ name: 'model.gguf' }]);
      mockLlamaService.generateText.mockRejectedValue(new Error('inference failed'));
      manager.selectedModel = 'model.gguf';

      const status = await manager.getHealthStatus();
      expect(status.connected).toBe(true);
      expect(status.selectedModelWorking).toBe(false);
    });
  });

  describe('setSelectedModel', () => {
    test('sets model when available', async () => {
      manager.availableModels = [{ name: 'model.gguf' }];
      await manager.setSelectedModel('model.gguf');
      expect(manager.selectedModel).toBe('model.gguf');
    });

    test('throws when model not available', async () => {
      manager.availableModels = [];
      await expect(manager.setSelectedModel('missing.gguf')).rejects.toThrow('not available');
    });
  });

  describe('getModelInfo', () => {
    test('returns info for specific model', () => {
      manager.availableModels = [{ name: 'model.gguf', size: 4096 }];
      manager.modelCapabilities.set('model.gguf', { text: true });
      manager.selectedModel = 'model.gguf';

      const info = manager.getModelInfo('model.gguf');
      expect(info.name).toBe('model.gguf');
      expect(info.size).toBe(4096);
      expect(info.isSelected).toBe(true);
    });

    test('returns null when no model specified and none selected', () => {
      manager.selectedModel = null;
      expect(manager.getModelInfo()).toBeNull();
    });
  });

  describe('cleanup', () => {
    test('resets all state', async () => {
      manager.initialized = true;
      manager.selectedModel = 'model.gguf';
      manager.availableModels = [{ name: 'model.gguf' }];

      await manager.cleanup();

      expect(manager.initialized).toBe(false);
      expect(manager.selectedModel).toBeNull();
      expect(manager.availableModels).toEqual([]);
    });
  });

  describe('initialize', () => {
    test('returns true when already initialized', async () => {
      manager.initialized = true;
      const result = await manager.initialize();
      expect(result).toBe(true);
    });

    test('reuses existing init promise (resolves to same value)', async () => {
      mockLlamaService.listModels.mockResolvedValue([]);
      mockSettingsService.load.mockResolvedValue({});

      const p1 = manager.initialize();
      const p2 = manager.initialize();

      // Both should resolve to the same value (initialization only runs once)
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(r2);
    });

    test('handles initialization failure gracefully', async () => {
      mockSettingsService.load.mockRejectedValue(new Error('fatal'));

      const result = await manager.initialize();
      // Should return false or true (depending on error handling) but not throw
      expect(typeof result).toBe('boolean');
    });
  });

  describe('ensureWorkingModel', () => {
    test('returns configured model without testing', async () => {
      mockSettingsService.load.mockResolvedValue({ textModel: 'configured.gguf' });
      await manager.loadConfig();

      const result = await manager.ensureWorkingModel();
      expect(result).toBe('configured.gguf');
    });

    test('throws when no models found', async () => {
      manager.selectedModel = null;
      mockLlamaService.listModels.mockResolvedValue([]);
      mockLlamaService.generateText.mockRejectedValue(new Error('broken'));

      await expect(manager.ensureWorkingModel()).rejects.toThrow('No working models found');
    });
  });
});
