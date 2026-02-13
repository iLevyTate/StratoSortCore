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
    recordModelLoad: jest.fn(),
    destroy: jest.fn()
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
  withLlamaResilience: (fn) => fn({}),
  cleanupLlamaCircuits: jest.fn(),
  resetLlamaCircuit: jest.fn(),
  shouldFallbackToCPU: jest.fn()
}));

const { LlamaService } = require('../src/main/services/LlamaService');
const { AI_DEFAULTS } = require('../src/shared/constants');
const { ERROR_CODES } = require('../src/shared/errorCodes');
const fs = require('fs').promises;

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
        { embeddingModel: 'not-a-real-text-model.gguf' },
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

    test('accepts legacy llama* keys for gpu/context settings', async () => {
      const service = new LlamaService();
      service._ensureConfigLoaded = jest.fn().mockResolvedValue(undefined);

      await service.updateConfig(
        {
          llamaGpuLayers: 21,
          llamaContextSize: 12288
        },
        { skipSave: true }
      );

      expect(service._config.gpuLayers).toBe(21);
      expect(service._config.contextSize).toBe(12288);
    });
  });

  describe('generateEmbedding', () => {
    test('throws INVALID_INPUT for non-string input', async () => {
      const service = new LlamaService();
      service._initialized = true;
      service._ensureConfigLoaded = jest.fn().mockResolvedValue(undefined);
      service._metrics = { recordEmbedding: jest.fn() };
      service._coordinator = { withModel: (_type, fn) => fn() };

      await expect(service.generateEmbedding({ text: 'nope' })).rejects.toEqual(
        expect.objectContaining({ code: ERROR_CODES.INVALID_INPUT })
      );
    });

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

  describe('embedding fallback chain', () => {
    function createServiceForFallback(primaryModel = 'missing-embed.gguf') {
      const service = new LlamaService();
      service._initialized = true;
      service._ensureConfigLoaded = jest.fn().mockResolvedValue(undefined);
      service._metrics = { recordEmbedding: jest.fn() };
      service._coordinator = { withModel: (_type, fn) => fn() };
      service._modelMemoryManager = {
        acquireRef: jest.fn(),
        releaseRef: jest.fn(),
        unloadModel: jest.fn().mockResolvedValue(undefined)
      };
      service._selectedModels = { embedding: primaryModel };
      return service;
    }

    test('tries fallback models when primary fails with MODEL_NOT_FOUND', async () => {
      const service = createServiceForFallback('missing-embed.gguf');

      const notFoundErr = new Error('Model not found: missing-embed.gguf');
      notFoundErr.code = ERROR_CODES.LLAMA_MODEL_NOT_FOUND;

      service._executeEmbeddingInference = jest.fn().mockRejectedValue(notFoundErr);
      service._executeEmbeddingInferenceWithModel = jest.fn().mockResolvedValue({
        embedding: [1, 2, 3],
        model: AI_DEFAULTS.EMBEDDING.FALLBACK_MODELS[0]
      });

      const result = await service.generateEmbedding('hello');

      expect(result.embedding).toEqual([1, 2, 3]);
      expect(result.model).toBe(AI_DEFAULTS.EMBEDDING.FALLBACK_MODELS[0]);
      expect(service._selectedModels.embedding).toBe('missing-embed.gguf');
      expect(service._modelMemoryManager.unloadModel).not.toHaveBeenCalled();
    });

    test('tries fallback on MODEL_LOAD_FAILED', async () => {
      const service = createServiceForFallback('corrupt-embed.gguf');

      const loadFailErr = new Error('Model corrupted');
      loadFailErr.code = ERROR_CODES.LLAMA_MODEL_LOAD_FAILED;

      service._executeEmbeddingInference = jest.fn().mockRejectedValue(loadFailErr);
      service._executeEmbeddingInferenceWithModel = jest
        .fn()
        .mockResolvedValue({ embedding: [4, 5], model: AI_DEFAULTS.EMBEDDING.FALLBACK_MODELS[0] });

      const result = await service.generateEmbedding('world');

      expect(result.embedding).toEqual([4, 5]);
      expect(service._selectedModels.embedding).toBe('corrupt-embed.gguf');
    });

    test('does not trigger fallback for LLAMA_INFERENCE_FAILED', async () => {
      const service = createServiceForFallback(AI_DEFAULTS.EMBEDDING.MODEL);

      const inferenceErr = new Error('inference blew up');
      inferenceErr.code = ERROR_CODES.LLAMA_INFERENCE_FAILED;
      service._executeEmbeddingInference = jest.fn().mockRejectedValue(inferenceErr);

      await expect(service.generateEmbedding('hello')).rejects.toEqual(
        expect.objectContaining({ code: ERROR_CODES.LLAMA_INFERENCE_FAILED })
      );
      expect(service._modelMemoryManager.unloadModel).not.toHaveBeenCalled();
    });

    test('does not trigger fallback for OOM', async () => {
      const service = createServiceForFallback(AI_DEFAULTS.EMBEDDING.MODEL);

      const oomErr = new Error('out of memory');
      oomErr.code = ERROR_CODES.LLAMA_OOM;
      service._executeEmbeddingInference = jest.fn().mockRejectedValue(oomErr);

      await expect(service.generateEmbedding('hello')).rejects.toEqual(
        expect.objectContaining({ code: ERROR_CODES.LLAMA_OOM })
      );
      expect(service._modelMemoryManager.unloadModel).not.toHaveBeenCalled();
    });

    test('restores original model name when all fallbacks fail', async () => {
      const primaryModel = 'custom-embed.gguf';
      const service = createServiceForFallback(primaryModel);

      const notFoundErr = new Error('Model not found');
      notFoundErr.code = ERROR_CODES.LLAMA_MODEL_NOT_FOUND;

      service._executeEmbeddingInference = jest.fn().mockRejectedValue(notFoundErr);
      service._executeEmbeddingInferenceWithModel = jest.fn().mockRejectedValue(notFoundErr);

      await expect(service.generateEmbedding('hello')).rejects.toBe(notFoundErr);
      expect(service._selectedModels.embedding).toBe(primaryModel);
    });

    test('skips fallback models that match the primary model', async () => {
      // Primary is the first fallback model — should skip it and try the second
      const originalFallbacks = [...AI_DEFAULTS.EMBEDDING.FALLBACK_MODELS];
      AI_DEFAULTS.EMBEDDING.FALLBACK_MODELS = [
        'nomic-embed-text-v1.5-Q4_K_M.gguf',
        'nomic-embed-text-v1.5-Q8_0.gguf'
      ];

      try {
        const service = createServiceForFallback(AI_DEFAULTS.EMBEDDING.FALLBACK_MODELS[0]);

        const notFoundErr = new Error('Model not found');
        notFoundErr.code = ERROR_CODES.LLAMA_MODEL_NOT_FOUND;

        service._executeEmbeddingInference = jest.fn().mockRejectedValue(notFoundErr);
        service._executeEmbeddingInferenceWithModel = jest.fn().mockResolvedValue({
          embedding: [7, 8],
          model: AI_DEFAULTS.EMBEDDING.FALLBACK_MODELS[1]
        });

        const result = await service.generateEmbedding('hello');

        expect(result.model).toBe(AI_DEFAULTS.EMBEDDING.FALLBACK_MODELS[1]);
      } finally {
        AI_DEFAULTS.EMBEDDING.FALLBACK_MODELS = originalFallbacks;
      }
    });

    test('handles wrapped errors from resilience layer via originalError.code', async () => {
      const service = createServiceForFallback('missing-embed.gguf');

      // In production, withLlamaResilience wraps the error AFTER the inner catch.
      // The wrapped error has no .code but .originalError has the real code.
      // Mock _executeEmbeddingInference directly to simulate this.
      const innerErr = new Error('Model not found: missing-embed.gguf');
      innerErr.code = ERROR_CODES.LLAMA_MODEL_NOT_FOUND;
      const wrappedErr = new Error(`Llama operation failed: ${innerErr.message}`);
      wrappedErr.originalError = innerErr;

      service._executeEmbeddingInference = jest.fn().mockRejectedValue(wrappedErr);
      service._executeEmbeddingInferenceWithModel = jest
        .fn()
        .mockResolvedValue({ embedding: [9], model: AI_DEFAULTS.EMBEDDING.FALLBACK_MODELS[0] });

      const result = await service.generateEmbedding('hello');

      expect(result.embedding).toEqual([9]);
      expect(service._selectedModels.embedding).toBe('missing-embed.gguf');
    });

    test('retries fallback model on CPU when initial GPU load fails', async () => {
      const { shouldFallbackToCPU } = require('../src/main/services/LlamaResilience');
      shouldFallbackToCPU.mockImplementation((error) => /gpu/i.test(error?.message || ''));

      const service = createServiceForFallback('missing-embed.gguf');
      service._modelsPath = '/mock/models';
      service._llama = {
        loadModel: jest
          .fn()
          .mockRejectedValueOnce(new Error('GPU allocation failed'))
          .mockResolvedValueOnce({
            createEmbeddingContext: jest.fn().mockResolvedValue({
              getEmbeddingFor: jest.fn().mockResolvedValue({
                vector: Float32Array.from([0.1, 0.2, 0.3])
              }),
              dispose: jest.fn().mockResolvedValue(undefined)
            }),
            dispose: jest.fn().mockResolvedValue(undefined)
          })
      };
      service._config.gpuLayers = 24;
      const accessSpy = jest.spyOn(fs, 'access').mockResolvedValue(undefined);

      try {
        const result = await service._executeEmbeddingInferenceWithModel(
          'hello world',
          'nomic-embed-text-v1.5-Q8_0.gguf'
        );

        expect(result.embedding).toHaveLength(3);
        expect(result.embedding[0]).toBeCloseTo(0.1, 5);
        expect(result.embedding[1]).toBeCloseTo(0.2, 5);
        expect(result.embedding[2]).toBeCloseTo(0.3, 5);
        expect(service._llama.loadModel).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            gpuLayers: 24
          })
        );
        expect(service._llama.loadModel).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            gpuLayers: 0
          })
        );
      } finally {
        accessSpy.mockRestore();
      }
    });
  });

  describe('shutdown', () => {
    test('skips unload/dispose when operations are still active', async () => {
      const service = new LlamaService();
      service._metrics = { destroy: jest.fn() };
      service._modelMemoryManager = { unloadAll: jest.fn() };
      const llama = { dispose: jest.fn() };
      service._llama = llama;
      service._waitForIdleOperations = jest.fn().mockResolvedValue(false);

      await service.shutdown();

      expect(service._modelMemoryManager.unloadAll).not.toHaveBeenCalled();
      expect(llama.dispose).not.toHaveBeenCalled();
    });

    test('unloads and disposes when idle', async () => {
      const service = new LlamaService();
      service._metrics = { destroy: jest.fn() };
      service._modelMemoryManager = { unloadAll: jest.fn() };
      const llama = { dispose: jest.fn() };
      service._llama = llama;
      service._waitForIdleOperations = jest.fn().mockResolvedValue(true);

      await service.shutdown();

      expect(service._modelMemoryManager.unloadAll).toHaveBeenCalled();
      expect(llama.dispose).toHaveBeenCalled();
    });

    test('waits for existing config-change gate before unloading', async () => {
      const service = new LlamaService();
      service._metrics = { destroy: jest.fn() };
      service._modelMemoryManager = { unloadAll: jest.fn() };
      const llama = { dispose: jest.fn() };
      service._llama = llama;
      service._waitForIdleOperations = jest.fn().mockResolvedValue(true);

      let resolveGate;
      const gatePromise = new Promise((resolve) => {
        resolveGate = resolve;
      });
      service._configChangeGate = { promise: gatePromise, resolve: resolveGate };

      const shutdownPromise = service.shutdown();
      await Promise.resolve();

      expect(service._modelMemoryManager.unloadAll).not.toHaveBeenCalled();

      resolveGate();
      await shutdownPromise;

      expect(service._modelMemoryManager.unloadAll).toHaveBeenCalled();
    });

    test('clears stale model reload gates during shutdown', async () => {
      const service = new LlamaService();
      service._metrics = { destroy: jest.fn() };
      service._modelMemoryManager = { unloadAll: jest.fn() };
      service._llama = { dispose: jest.fn() };
      service._waitForIdleOperations = jest.fn().mockResolvedValue(true);

      service._beginModelReloadGate('text');
      service._beginModelReloadGate('vision');
      expect(service._modelReloadGates.size).toBe(2);

      await service.shutdown();

      expect(service._modelReloadGates.size).toBe(0);
    }, 15000);
  });
});
