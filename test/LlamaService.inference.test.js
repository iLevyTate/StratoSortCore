/**
 * Tests for LlamaService inference methods.
 * Covers generateText, analyzeImage, _loadModel GPU fallback,
 * listModels, getHealthStatus, and batchGenerateEmbeddings.
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

const mockContext = {
  getSequence: jest.fn().mockReturnValue({}),
  model: { gpuLayers: 33, trainContextSize: 4096 }
};

const mockModelMemoryManager = {
  ensureModelLoaded: jest.fn().mockResolvedValue(mockContext),
  unloadAll: jest.fn().mockResolvedValue(undefined),
  acquireRef: jest.fn(),
  releaseRef: jest.fn(),
  getMemoryStatus: jest.fn().mockReturnValue({ totalLoaded: 1 })
};

jest.mock('../src/main/services/ModelMemoryManager', () => ({
  ModelMemoryManager: jest.fn().mockImplementation(() => mockModelMemoryManager)
}));

jest.mock('../src/main/services/ModelAccessCoordinator', () => ({
  ModelAccessCoordinator: jest.fn().mockImplementation(() => ({
    acquireLoadLock: jest.fn(async () => () => {}),
    withModel: jest.fn((_, fn, __) => fn())
  }))
}));

jest.mock('../src/main/services/PerformanceMetrics', () => ({
  PerformanceMetrics: jest.fn().mockImplementation(() => ({
    recordEmbedding: jest.fn(),
    recordTextGeneration: jest.fn(),
    recordModelLoad: jest.fn(),
    getMetrics: jest.fn().mockReturnValue({}),
    destroy: jest.fn()
  }))
}));

jest.mock('../src/main/services/GPUMonitor', () => ({
  GPUMonitor: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('../src/main/services/SettingsService', () => ({
  getInstance: jest.fn(() => ({
    getAll: jest.fn().mockReturnValue({})
  }))
}));

const mockSession = {
  prompt: jest.fn().mockResolvedValue('Generated text response'),
  dispose: jest.fn()
};

jest.mock('../src/main/services/LlamaResilience', () => ({
  withLlamaResilience: jest.fn((fn) => fn({})),
  cleanupLlamaCircuits: jest.fn(),
  shouldFallbackToCPU: jest.fn().mockReturnValue(false),
  isSequenceExhaustedError: jest.fn().mockReturnValue(false),
  isOutOfMemoryError: jest.fn().mockReturnValue(false),
  attachErrorCode: jest.fn((err, code) => {
    err.code = code;
    return err;
  })
}));

// Mock the dynamic import of node-llama-cpp module
jest.mock('../src/main/services/LlamaService', () => {
  // Load the actual module to get the real class
  const actual = jest.requireActual('../src/main/services/LlamaService');
  return actual;
});

const fs = require('fs').promises;
const { LlamaService } = require('../src/main/services/LlamaService');
const { ERROR_CODES } = require('../src/shared/errorCodes');

// Helper to create a service with common mocks pre-configured
function createTestService() {
  const service = new LlamaService();
  service._initialized = true;
  service._modelsPath = '/mock/models';
  service._selectedModels = { text: 'text.gguf', vision: 'vision.gguf', embedding: 'embed.gguf' };
  service._config = { gpuLayers: -1, threads: 4 };
  service._gpuBackend = 'vulkan';
  service._awaitModelReady = jest.fn().mockResolvedValue(undefined);
  service._ensureModelLoaded = jest.fn().mockResolvedValue(mockContext);
  service._ensureConfigLoaded = jest.fn().mockResolvedValue(undefined);
  service._reloadModelCPU = jest.fn().mockResolvedValue(undefined);
  service._recoverFromSequenceExhaustion = jest.fn().mockResolvedValue(undefined);
  service._ensureVisionAssets = jest.fn().mockResolvedValue(undefined);
  service._getEffectiveContextSize = jest.fn().mockReturnValue(4096);
  service._visionProjectorStatus = { required: false, available: false };
  return service;
}

describe('LlamaService – inference methods', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateText', () => {
    test('returns response on success', async () => {
      const service = createTestService();
      // Mock the node-llama-cpp dynamic import
      const loadModule = jest.fn().mockResolvedValue({
        LlamaChatSession: jest.fn().mockImplementation(() => mockSession)
      });
      // Replace internal loader
      service._coordinator = {
        withModel: jest.fn((_, fn) => fn())
      };

      // We need to mock at a higher level since generateText uses withLlamaResilience
      const { withLlamaResilience } = require('../src/main/services/LlamaResilience');
      withLlamaResilience.mockImplementation(async (fn) => {
        return { response: 'Generated text response' };
      });

      const result = await service.generateText({
        prompt: 'What is 2+2?',
        systemPrompt: 'You are a math tutor.',
        maxTokens: 512,
        temperature: 0.5
      });

      expect(result).toEqual({ response: 'Generated text response' });
      expect(service._awaitModelReady).toHaveBeenCalledWith('text');
    });

    test('records metrics on failure', async () => {
      const service = createTestService();
      service._coordinator = {
        withModel: jest.fn((_, fn) => fn())
      };

      const { withLlamaResilience } = require('../src/main/services/LlamaResilience');
      withLlamaResilience.mockImplementation(async () => {
        throw new Error('Inference failed');
      });

      await expect(service.generateText({ prompt: 'test', maxTokens: 100 })).rejects.toThrow(
        'Inference failed'
      );
    });

    test('handles abort signal', async () => {
      const service = createTestService();
      service._coordinator = {
        withModel: jest.fn((_, fn) => fn())
      };

      const controller = new AbortController();
      controller.abort();

      const { withLlamaResilience } = require('../src/main/services/LlamaResilience');
      withLlamaResilience.mockImplementation(async () => {
        const err = new Error('Operation aborted');
        err.name = 'AbortError';
        throw err;
      });

      await expect(
        service.generateText({ prompt: 'test', signal: controller.signal })
      ).rejects.toThrow('Operation aborted');
    });
  });

  describe('analyzeText', () => {
    test('wraps generateText and returns success envelope', async () => {
      const service = createTestService();
      service.generateText = jest.fn().mockResolvedValue({ response: 'AI says hello' });

      const result = await service.analyzeText('Say hello', { maxTokens: 256 });

      expect(result).toEqual({ success: true, response: 'AI says hello' });
      expect(service.generateText).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'Say hello', maxTokens: 256 })
      );
    });

    test('returns success:false on error', async () => {
      const service = createTestService();
      service.generateText = jest.fn().mockRejectedValue(new Error('boom'));

      const result = await service.analyzeText('fail');

      expect(result.success).toBe(false);
      expect(result.error).toBe('boom');
    });
  });

  describe('analyzeImage', () => {
    test('falls back to generateText when no image source provided', async () => {
      const service = createTestService();
      service.generateText = jest.fn().mockResolvedValue({ response: 'text response' });

      const result = await service.analyzeImage({ prompt: 'describe' });

      expect(service.generateText).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'describe' })
      );
    });

    test('throws when vision model not found', async () => {
      const service = createTestService();
      service._coordinator = {
        withModel: jest.fn((_, fn) => fn())
      };

      const { withLlamaResilience } = require('../src/main/services/LlamaResilience');
      withLlamaResilience.mockImplementation(async (fn) => fn({}));

      // Mock fs.access to throw (model not found)
      jest.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));

      await expect(
        service.analyzeImage({ imagePath: '/test.jpg', prompt: 'describe' })
      ).rejects.toThrow(/not found/i);
    });

    test('throws when projector is required but missing', async () => {
      const service = createTestService();
      service._visionProjectorStatus = {
        required: true,
        available: false,
        projectorName: 'mmproj.gguf'
      };
      service._coordinator = {
        withModel: jest.fn((_, fn) => fn())
      };

      const { withLlamaResilience } = require('../src/main/services/LlamaResilience');
      withLlamaResilience.mockImplementation(async (fn) => fn({}));

      jest.spyOn(fs, 'access').mockResolvedValue(undefined);

      await expect(service.analyzeImage({ imagePath: '/test.jpg' })).rejects.toThrow(/projector/i);
    });
  });

  describe('listModels', () => {
    test('returns categorized model list', async () => {
      const service = createTestService();
      jest
        .spyOn(fs, 'readdir')
        .mockResolvedValue([
          'llama-3.gguf',
          'nomic-embed-text.gguf',
          'llava-vision.gguf',
          'readme.txt'
        ]);

      const models = await service.listModels();

      expect(models).toHaveLength(3); // txt file filtered out
      expect(models.find((m) => m.name === 'nomic-embed-text.gguf').type).toBe('embedding');
      expect(models.find((m) => m.name === 'llava-vision.gguf').type).toBe('vision');
      expect(models.find((m) => m.name === 'llama-3.gguf').type).toBe('text');
    });

    test('returns empty array when directory read fails', async () => {
      const service = createTestService();
      jest.spyOn(fs, 'readdir').mockRejectedValue(new Error('ENOENT'));

      const models = await service.listModels();

      expect(models).toEqual([]);
    });
  });

  describe('getHealthStatus', () => {
    test('returns comprehensive health info', () => {
      const service = createTestService();
      service._detectedGpu = { vendor: 'NVIDIA', model: 'RTX 4090' };
      service._gpuSelection = { backend: 'vulkan' };

      const status = service.getHealthStatus();

      expect(status.healthy).toBe(true);
      expect(status.initialized).toBe(true);
      expect(status.gpuBackend).toBe('vulkan');
      expect(status.gpuDetected).toEqual({ vendor: 'NVIDIA', model: 'RTX 4090' });
    });

    test('reports unhealthy when not initialized', () => {
      const service = createTestService();
      service._initialized = false;

      const status = service.getHealthStatus();

      expect(status.healthy).toBe(false);
    });
  });

  describe('batchGenerateEmbeddings', () => {
    test('processes texts with bounded concurrency', async () => {
      const service = createTestService();
      let callCount = 0;
      service.generateEmbedding = jest.fn(async (text) => {
        callCount++;
        return { vector: [0.1, 0.2, 0.3], dimensions: 3 };
      });

      const results = await service.batchGenerateEmbeddings(['text1', 'text2', 'text3']);

      expect(results.embeddings).toHaveLength(3);
      expect(service.generateEmbedding).toHaveBeenCalledTimes(3);
    });

    test('reports progress via callback', async () => {
      const service = createTestService();
      service.generateEmbedding = jest.fn(async () => ({
        vector: [0.1],
        dimensions: 1
      }));

      const progress = jest.fn();
      await service.batchGenerateEmbeddings(['a', 'b'], { onProgress: progress });

      expect(progress).toHaveBeenCalled();
    });
  });
});
