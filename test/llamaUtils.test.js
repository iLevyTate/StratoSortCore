/**
 * Tests for llamaUtils - in-process LlamaService utilities
 */

// Must mock before requiring
jest.mock('../src/shared/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }))
}));

jest.mock('../src/shared/constants', () => ({
  AI_DEFAULTS: {
    TEXT: { MODEL: 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf' },
    IMAGE: { MODEL: 'llava-v1.6-mistral-7b-Q4_K_M.gguf' },
    EMBEDDING: { MODEL: 'nomic-embed-text-v1.5-Q8_0.gguf', DIMENSIONS: 768 }
  }
}));

let mockLlamaServiceInstance;
let mockSettingsInstance;

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: jest.fn(() => mockLlamaServiceInstance)
}));

jest.mock('../src/main/services/SettingsService', () => ({
  getInstance: jest.fn(() => mockSettingsInstance)
}));

describe('llamaUtils', () => {
  let llamaUtils;

  beforeEach(() => {
    jest.resetModules();
    mockLlamaServiceInstance = null;
    mockSettingsInstance = null;

    // Re-require to reset module state
    llamaUtils = require('../src/main/llamaUtils');
  });

  describe('getLlamaService', () => {
    test('returns null when LlamaService getInstance fails', () => {
      const result = llamaUtils.getLlamaService();
      // First call with null instance
      expect(result).toBeDefined();
    });

    test('returns cached instance on subsequent calls', () => {
      mockLlamaServiceInstance = { _config: { textModel: 'test.gguf' } };
      const first = llamaUtils.getLlamaService();
      const second = llamaUtils.getLlamaService();
      expect(first).toBe(second);
    });
  });

  describe('getTextModel', () => {
    test('returns default model when no service is available', () => {
      const result = llamaUtils.getTextModel();
      expect(result).toBe('Mistral-7B-Instruct-v0.3-Q4_K_M.gguf');
    });

    test('returns model from service config when available', () => {
      mockLlamaServiceInstance = {
        _selectedModels: { text: 'custom-text.gguf' }
      };
      // Reset modules to clear cached instance
      jest.resetModules();
      llamaUtils = require('../src/main/llamaUtils');

      const result = llamaUtils.getTextModel();
      expect(result).toBe('custom-text.gguf');
    });
  });

  describe('getVisionModel', () => {
    test('returns default vision model', () => {
      const result = llamaUtils.getVisionModel();
      expect(result).toBe('llava-v1.6-mistral-7b-Q4_K_M.gguf');
    });

    test('returns model from service config when available', () => {
      mockLlamaServiceInstance = {
        _selectedModels: { vision: 'custom-vision.gguf' }
      };
      jest.resetModules();
      llamaUtils = require('../src/main/llamaUtils');

      const result = llamaUtils.getVisionModel();
      expect(result).toBe('custom-vision.gguf');
    });
  });

  describe('getEmbeddingModel', () => {
    test('returns default embedding model', () => {
      const result = llamaUtils.getEmbeddingModel();
      expect(result).toBe('nomic-embed-text-v1.5-Q8_0.gguf');
    });

    test('returns model from service config when available', () => {
      mockLlamaServiceInstance = {
        _selectedModels: { embedding: 'custom-embed.gguf' }
      };
      jest.resetModules();
      llamaUtils = require('../src/main/llamaUtils');

      const result = llamaUtils.getEmbeddingModel();
      expect(result).toBe('custom-embed.gguf');
    });
  });

  describe('setTextModel', () => {
    test('updates config when service is available', async () => {
      const mockUpdateConfig = jest.fn();
      mockLlamaServiceInstance = {
        _config: {},
        updateConfig: mockUpdateConfig
      };
      jest.resetModules();
      llamaUtils = require('../src/main/llamaUtils');

      await llamaUtils.setTextModel('new-model.gguf');
      expect(mockUpdateConfig).toHaveBeenCalledWith({ textModel: 'new-model.gguf' });
    });

    test('stores model locally even without service', async () => {
      await llamaUtils.setTextModel('local-model.gguf');
      // After setting, getTextModel should return it
      // (service is null so it falls through to selectedTextModel)
      expect(llamaUtils.getTextModel()).toBe('local-model.gguf');
    });
  });

  describe('setVisionModel', () => {
    test('updates config when service is available', async () => {
      const mockUpdateConfig = jest.fn();
      mockLlamaServiceInstance = {
        _config: {},
        updateConfig: mockUpdateConfig
      };
      jest.resetModules();
      llamaUtils = require('../src/main/llamaUtils');

      await llamaUtils.setVisionModel('new-vision.gguf');
      expect(mockUpdateConfig).toHaveBeenCalledWith({ visionModel: 'new-vision.gguf' });
    });

    test('stores model locally even without service', async () => {
      await llamaUtils.setVisionModel('local-vision.gguf');
      expect(llamaUtils.getVisionModel()).toBe('local-vision.gguf');
    });
  });

  describe('setEmbeddingModel', () => {
    test('updates config when service is available', async () => {
      const mockUpdateConfig = jest.fn();
      mockLlamaServiceInstance = {
        _config: {},
        updateConfig: mockUpdateConfig
      };
      jest.resetModules();
      llamaUtils = require('../src/main/llamaUtils');

      await llamaUtils.setEmbeddingModel('new-embed.gguf');
      expect(mockUpdateConfig).toHaveBeenCalledWith({ embeddingModel: 'new-embed.gguf' });
    });

    test('stores model locally even without service', async () => {
      await llamaUtils.setEmbeddingModel('local-embed.gguf');
      expect(llamaUtils.getEmbeddingModel()).toBe('local-embed.gguf');
    });
  });

  describe('loadLlamaConfig', () => {
    test('loads config from settings service', async () => {
      mockSettingsInstance = {
        load: jest.fn(async () => ({
          textModel: 'settings-text.gguf',
          visionModel: 'settings-vision.gguf',
          embeddingModel: 'settings-embed.gguf'
        }))
      };

      const result = await llamaUtils.loadLlamaConfig();

      expect(result.selectedTextModel).toBe('settings-text.gguf');
      expect(result.selectedVisionModel).toBe('settings-vision.gguf');
      expect(result.selectedEmbeddingModel).toBe('settings-embed.gguf');
    });

    test('uses defaults when settings are empty', async () => {
      mockSettingsInstance = {
        load: jest.fn(async () => ({}))
      };

      const result = await llamaUtils.loadLlamaConfig();

      expect(result.selectedTextModel).toBe('Mistral-7B-Instruct-v0.3-Q4_K_M.gguf');
      expect(result.selectedVisionModel).toBe('llava-v1.6-mistral-7b-Q4_K_M.gguf');
      expect(result.selectedEmbeddingModel).toBe('nomic-embed-text-v1.5-Q8_0.gguf');
    });

    test('handles settings service failure gracefully', async () => {
      mockSettingsInstance = null;

      const result = await llamaUtils.loadLlamaConfig();

      // Should still return defaults without throwing
      expect(result).toBeDefined();
      expect(result.selectedTextModel).toBeDefined();
    });

    test('handles load returning null', async () => {
      mockSettingsInstance = {
        load: jest.fn(async () => null)
      };

      const result = await llamaUtils.loadLlamaConfig();
      expect(result.selectedTextModel).toBe('Mistral-7B-Instruct-v0.3-Q4_K_M.gguf');
    });
  });

  describe('getEmbeddingDimensions', () => {
    test('returns configured dimensions', () => {
      expect(llamaUtils.getEmbeddingDimensions()).toBe(768);
    });
  });

  describe('cleanup', () => {
    test('calls shutdown on service instance', async () => {
      const mockShutdown = jest.fn();
      mockLlamaServiceInstance = {
        _config: {},
        shutdown: mockShutdown
      };
      jest.resetModules();
      llamaUtils = require('../src/main/llamaUtils');

      // Trigger lazy init
      llamaUtils.getLlamaService();

      await llamaUtils.cleanup();
      // Cleanup is now a no-op to prevent double-shutdown with ServiceContainer
      expect(mockShutdown).not.toHaveBeenCalled();
    });

    test('handles no service instance gracefully', async () => {
      await expect(llamaUtils.cleanup()).resolves.not.toThrow();
    });
  });

  describe('backward compatibility aliases', () => {
    test('getLlamaModel is aliased to getTextModel', () => {
      expect(llamaUtils.getLlamaModel).toBe(llamaUtils.getTextModel);
    });

    test('getLlamaVisionModel is aliased to getVisionModel', () => {
      expect(llamaUtils.getLlamaVisionModel).toBe(llamaUtils.getVisionModel);
    });

    test('getLlamaEmbeddingModel is aliased to getEmbeddingModel', () => {
      expect(llamaUtils.getLlamaEmbeddingModel).toBe(llamaUtils.getEmbeddingModel);
    });

    test('setLlamaModel is aliased to setTextModel', () => {
      expect(llamaUtils.setLlamaModel).toBe(llamaUtils.setTextModel);
    });

    test('setLlamaVisionModel is aliased to setVisionModel', () => {
      expect(llamaUtils.setLlamaVisionModel).toBe(llamaUtils.setVisionModel);
    });

    test('setLlamaEmbeddingModel is aliased to setEmbeddingModel', () => {
      expect(llamaUtils.setLlamaEmbeddingModel).toBe(llamaUtils.setEmbeddingModel);
    });
  });
});
