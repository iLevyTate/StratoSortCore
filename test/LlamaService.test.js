/**
 * Tests for LlamaService
 * Focus: initialization flow and configuration loading.
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

const mockDegradation = {
  checkSystemReadiness: jest.fn().mockResolvedValue({ ready: true, issues: [], gpuInfo: {} }),
  handleError: jest.fn().mockResolvedValue({ action: 'none' })
};

jest.mock('../src/main/services/DegradationManager', () => ({
  DegradationManager: jest.fn().mockImplementation(() => mockDegradation)
}));

jest.mock('../src/main/services/ModelMemoryManager', () => ({
  ModelMemoryManager: jest.fn().mockImplementation(() => ({
    ensureModelLoaded: jest.fn().mockResolvedValue(true),
    unloadAll: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('../src/main/services/ModelAccessCoordinator', () => ({
  ModelAccessCoordinator: jest.fn().mockImplementation(() => ({
    acquireLoadLock: jest.fn(async () => () => {}),
    withModel: jest.fn((_, fn) => fn())
  }))
}));

jest.mock('../src/main/services/PerformanceMetrics', () => ({
  PerformanceMetrics: jest.fn().mockImplementation(() => ({
    recordEmbedding: jest.fn(),
    recordModelLoad: jest.fn()
  }))
}));

jest.mock('../src/main/services/GPUMonitor', () => ({
  GPUMonitor: jest.fn().mockImplementation(() => ({}))
}));

const mockSettings = {
  getAll: jest.fn()
};

jest.mock('../src/main/services/SettingsService', () => ({
  getInstance: jest.fn(() => mockSettings)
}));

jest.mock('../src/main/services/LlamaResilience', () => ({
  withLlamaResilience: (fn) => fn({})
}));

const { LlamaService } = require('../src/main/services/LlamaService');
const { AI_DEFAULTS } = require('../src/shared/constants');
const { ERROR_CODES } = require('../src/shared/errorCodes');

describe('LlamaService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    test('sets initialized and emits event', async () => {
      const service = new LlamaService();
      service._ensureConfigLoaded = jest.fn().mockResolvedValue(undefined);
      service._initializeLlama = jest.fn().mockResolvedValue(undefined);

      const onInit = jest.fn();
      service.on('initialized', onInit);

      await service.initialize();

      expect(service._initialized).toBe(true);
      expect(service._initializeLlama).toHaveBeenCalled();
      expect(onInit).toHaveBeenCalledWith(
        expect.objectContaining({ gpuBackend: service._gpuBackend })
      );
    });
  });

  describe('_loadConfig', () => {
    test('uses settings when available', async () => {
      const service = new LlamaService();
      mockSettings.getAll.mockReturnValue({
        textModel: 'text.gguf',
        visionModel: 'vision.gguf',
        embeddingModel: 'embed.gguf',
        llamaGpuLayers: 12
      });

      await service._loadConfig();

      expect(service._selectedModels.text).toBe('text.gguf');
      expect(service._selectedModels.vision).toBe('vision.gguf');
      expect(service._selectedModels.embedding).toBe('embed.gguf');
      expect(service._config.gpuLayers).toBe(12);
    });

    test('falls back to defaults on error', async () => {
      const service = new LlamaService();
      mockSettings.getAll.mockImplementation(() => {
        throw new Error('boom');
      });

      await service._loadConfig();

      expect(service._selectedModels.text).toBe(AI_DEFAULTS.TEXT.MODEL);
      expect(service._selectedModels.vision).toBe(AI_DEFAULTS.IMAGE.MODEL);
      expect(service._selectedModels.embedding).toBe(AI_DEFAULTS.EMBEDDING.MODEL);
    });
  });

  describe('testConnection', () => {
    test('returns healthy status when listModels succeeds', async () => {
      const service = new LlamaService();
      service._ensureConfigLoaded = jest.fn().mockResolvedValue(undefined);
      service.listModels = jest.fn().mockResolvedValue([{ name: 'model' }]);
      service._gpuBackend = 'cpu';

      const result = await service.testConnection();

      expect(result.success).toBe(true);
      expect(result.status).toBe('healthy');
      expect(result.modelCount).toBe(1);
    });

    test('returns unhealthy status when listModels fails', async () => {
      const service = new LlamaService();
      service._ensureConfigLoaded = jest.fn().mockResolvedValue(undefined);
      service.listModels = jest.fn().mockRejectedValue(new Error('fail'));

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.status).toBe('unhealthy');
    });
  });

  describe('updateConfig', () => {
    test('downgrades to default embedding model when requested model is not allowed', async () => {
      const service = new LlamaService();
      service._ensureConfigLoaded = jest.fn().mockResolvedValue(undefined);

      const res = await service.updateConfig(
        { embeddingModel: 'not-a-real-embed-model.gguf' },
        { skipSave: true }
      );

      expect(res.success).toBe(true);
      expect(res.modelDowngraded).toBe(true);
      expect(service._selectedModels.embedding).toBe(AI_DEFAULTS.EMBEDDING.MODEL);
    });

    test('emits model-change events for changed model types', async () => {
      const service = new LlamaService();
      service._ensureConfigLoaded = jest.fn().mockResolvedValue(undefined);
      service._selectedModels.embedding = AI_DEFAULTS.EMBEDDING.MODEL;

      const onChange = jest.fn();
      service.on('model-change', onChange);

      await service.updateConfig(
        { embeddingModel: 'mxbai-embed-large-v1-f16.gguf' },
        { skipSave: true }
      );

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'embedding',
          previousModel: AI_DEFAULTS.EMBEDDING.MODEL,
          newModel: 'mxbai-embed-large-v1-f16.gguf'
        })
      );
    });
  });

  describe('generateEmbedding', () => {
    test('throws with LLAMA_INFERENCE_FAILED code when embedding fails', async () => {
      const service = new LlamaService();
      service._initialized = true;
      service._ensureConfigLoaded = jest.fn().mockResolvedValue(undefined);
      service._metrics = { recordEmbedding: jest.fn() };
      service._coordinator = { withModel: (_type, fn) => fn() };

      const err = new Error('failure');
      const context = { getEmbeddingFor: jest.fn().mockRejectedValue(err) };
      service._ensureModelLoaded = jest.fn().mockResolvedValue(context);

      try {
        await service.generateEmbedding('hello');
        throw new Error('Expected generateEmbedding to throw');
      } catch (e) {
        expect(e).toBe(err);
        expect(e.code).toBe(ERROR_CODES.LLAMA_INFERENCE_FAILED);
      }
    });

    test('throws with LLAMA_OOM code when error indicates out of memory', async () => {
      const service = new LlamaService();
      service._initialized = true;
      service._ensureConfigLoaded = jest.fn().mockResolvedValue(undefined);
      service._metrics = { recordEmbedding: jest.fn() };
      service._coordinator = { withModel: (_type, fn) => fn() };

      const err = new Error('CUDA out of memory');
      const context = { getEmbeddingFor: jest.fn().mockRejectedValue(err) };
      service._ensureModelLoaded = jest.fn().mockResolvedValue(context);

      await expect(service.generateEmbedding('hello')).rejects.toEqual(
        expect.objectContaining({ code: ERROR_CODES.LLAMA_OOM })
      );
    });
  });
});
