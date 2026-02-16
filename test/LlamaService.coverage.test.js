/**
 * LlamaService Coverage Tests
 *
 * Tests untested paths: testConnection, config management, model change
 * subscriptions, analyzeText, health status, pin/unpin, embedding input
 * validation, and shutdown.
 *
 * Coverage target: main/services/LlamaService.js (was 40%)
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
  handleError: jest.fn().mockResolvedValue({ action: 'none' }),
  destroy: jest.fn()
};

jest.mock('../src/main/services/DegradationManager', () => ({
  DegradationManager: jest.fn().mockImplementation(() => mockDegradation)
}));

jest.mock('../src/main/services/ModelMemoryManager', () => ({
  ModelMemoryManager: jest.fn().mockImplementation(() => ({
    ensureModelLoaded: jest.fn().mockResolvedValue(true),
    unloadAll: jest.fn().mockResolvedValue(undefined),
    unloadModel: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn(() => ({})),
    destroy: jest.fn()
  }))
}));

jest.mock('../src/main/services/ModelAccessCoordinator', () => ({
  ModelAccessCoordinator: jest.fn().mockImplementation(() => ({
    acquireLoadLock: jest.fn(async () => () => {}),
    withModel: jest.fn((_, fn) => fn()),
    destroy: jest.fn()
  }))
}));

jest.mock('../src/main/services/PerformanceMetrics', () => ({
  PerformanceMetrics: jest.fn().mockImplementation(() => ({
    recordEmbedding: jest.fn(),
    recordModelLoad: jest.fn(),
    getMetrics: jest.fn(() => ({})),
    destroy: jest.fn()
  }))
}));

jest.mock('../src/main/services/GPUMonitor', () => ({
  GPUMonitor: jest.fn().mockImplementation(() => ({
    getInfo: jest.fn(() => ({ vendor: 'test', vram: 8192 })),
    destroy: jest.fn()
  }))
}));

const mockSettings = {
  getAll: jest.fn(),
  set: jest.fn()
};

jest.mock('../src/main/services/SettingsService', () => ({
  getInstance: jest.fn(() => mockSettings)
}));

jest.mock('../src/main/services/VisionService', () => ({
  getInstance: jest.fn(() => null)
}));

jest.mock('../src/main/services/modelPathResolver', () => ({
  ensureResolvedModelsPath: jest.fn()
}));

jest.mock('../src/main/services/LlamaResilience', () => ({
  withLlamaResilience: (fn) => fn({}),
  cleanupLlamaCircuits: jest.fn(),
  resetLlamaCircuit: jest.fn(),
  shouldFallbackToCPU: jest.fn(() => false)
}));

const { LlamaService } = require('../src/main/services/LlamaService');
const { ERROR_CODES } = require('../src/shared/errorCodes');

describe('LlamaService - extended coverage', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LlamaService();
  });

  describe('constructor', () => {
    test('initializes all managers', () => {
      expect(service).toBeDefined();
      expect(service._initialized).toBe(false);
      expect(service._isShuttingDown).toBeFalsy();
    });

    test('extends EventEmitter', () => {
      const handler = jest.fn();
      service.on('test-event', handler);
      service.emit('test-event', 'data');
      expect(handler).toHaveBeenCalledWith('data');
    });
  });

  describe('getConfig', () => {
    test('returns current config when loaded', async () => {
      service._config = { textModel: 'test.gguf', contextSize: 4096 };
      service._configLoaded = true;

      const config = await service.getConfig();
      expect(config.textModel).toBe('test.gguf');
    });

    test('loads config from settings when not yet loaded', async () => {
      mockSettings.getAll.mockReturnValue({
        textModel: 'from-settings.gguf',
        contextSize: 8192
      });
      service._configLoaded = false;
      service._ensureConfigLoaded = jest.fn(async () => {
        service._config = { textModel: 'from-settings.gguf', contextSize: 8192 };
        service._configLoaded = true;
      });

      const config = await service.getConfig();
      expect(config.textModel).toBe('from-settings.gguf');
    });
  });

  describe('testConnection', () => {
    test('returns healthy status when config is loaded', async () => {
      service._configLoaded = true;
      service._config = { textModel: 'test.gguf' };
      service._ensureConfigLoaded = jest.fn().mockResolvedValue();

      const result = await service.testConnection();
      expect(result.success).toBe(true);
    });
  });

  describe('onModelChange', () => {
    test('subscribes and returns unsubscribe function', () => {
      const callback = jest.fn();
      const unsubscribe = service.onModelChange(callback);
      expect(typeof unsubscribe).toBe('function');
    });

    test('unsubscribe removes callback from set', () => {
      const callback = jest.fn();
      const unsubscribe = service.onModelChange(callback);
      expect(service._modelChangeCallbacks.has(callback)).toBe(true);

      unsubscribe();
      expect(service._modelChangeCallbacks.has(callback)).toBe(false);
    });

    test('ignores non-function callbacks', () => {
      const unsub = service.onModelChange('not-a-function');
      expect(typeof unsub).toBe('function');
      // Should not throw when called
      unsub();
    });
  });

  describe('getHealthStatus', () => {
    test('returns comprehensive status object', () => {
      service._initialized = true;
      service._config = { textModel: 'test.gguf' };

      const status = service.getHealthStatus();
      expect(status).toHaveProperty('initialized');
      expect(status.initialized).toBe(true);
    });

    test('returns uninitialized status', () => {
      const status = service.getHealthStatus();
      expect(status.initialized).toBe(false);
    });
  });

  describe('pinModel / unpinModel', () => {
    test('pinModel delegates to memory manager acquireRef', () => {
      service._modelMemoryManager = { acquireRef: jest.fn(), releaseRef: jest.fn() };
      service.pinModel('text');
      expect(service._modelMemoryManager.acquireRef).toHaveBeenCalledWith('text');
    });

    test('unpinModel delegates to memory manager releaseRef', () => {
      service._modelMemoryManager = { acquireRef: jest.fn(), releaseRef: jest.fn() };
      service.unpinModel('text');
      expect(service._modelMemoryManager.releaseRef).toHaveBeenCalledWith('text');
    });

    test('pinModel is safe without memory manager', () => {
      service._modelMemoryManager = null;
      expect(() => service.pinModel('text')).not.toThrow();
    });

    test('unpinModel is safe without memory manager', () => {
      service._modelMemoryManager = null;
      expect(() => service.unpinModel('text')).not.toThrow();
    });
  });

  describe('normalizeEmbeddingInput validation', () => {
    test('rejects non-string input for generateEmbedding', async () => {
      service._initialized = true;
      service._ensureConfigLoaded = jest.fn().mockResolvedValue();
      service._config = { embeddingModel: 'embed.gguf' };

      await expect(service.generateEmbedding(123)).rejects.toThrow(/string/);
    });

    test('rejects empty string input for generateEmbedding', async () => {
      service._initialized = true;
      service._ensureConfigLoaded = jest.fn().mockResolvedValue();
      service._config = { embeddingModel: 'embed.gguf' };

      await expect(service.generateEmbedding('   ')).rejects.toThrow(/non-empty/);
    });
  });

  describe('analyzeText', () => {
    test('returns error when not initialized', async () => {
      service._initialized = false;
      service._ensureConfigLoaded = jest.fn().mockResolvedValue();
      service._initializePromise = null;
      service._llama = null;

      const result = await service.analyzeText('Test prompt');
      expect(result.success).toBe(false);
    });

    test('wraps generateText for convenience', async () => {
      service._initialized = true;
      service._config = { textModel: 'test.gguf' };
      service.generateText = jest.fn().mockResolvedValue({
        response: 'Analyzed result'
      });

      const result = await service.analyzeText('Test prompt');
      expect(result.success).toBe(true);
      expect(result.response).toBe('Analyzed result');
    });

    test('handles generateText failure gracefully', async () => {
      service._initialized = true;
      service._config = { textModel: 'test.gguf' };
      service.generateText = jest.fn().mockRejectedValue(new Error('Model not loaded'));

      const result = await service.analyzeText('Test prompt');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Model not loaded/);
    });
  });

  describe('shutdown', () => {
    test('completes and resets state', async () => {
      service._initialized = false;

      await service.shutdown();
      // _isShuttingDown is reset to false at end of shutdown for re-initialization
      expect(service._isShuttingDown).toBe(false);
      expect(service._initialized).toBe(false);
    });

    test('is safe to call multiple times (re-entrance guard)', async () => {
      await service.shutdown();
      await service.shutdown(); // Second call skips since _isShuttingDown resets
      // Should not throw
      expect(service._initialized).toBe(false);
    });

    test('unloads models when memory manager and coordinator available', async () => {
      service._initialized = true;
      const unloadAll = jest.fn().mockResolvedValue();
      service._modelMemoryManager = { unloadAll, destroy: jest.fn() };
      service._metrics = { destroy: jest.fn() };
      // Need a coordinator that resolves idle check
      service._coordinator = {
        _waitForIdleOperations: jest.fn().mockResolvedValue(true)
      };
      service._waitForIdleOperations = jest.fn().mockResolvedValue(true);

      await service.shutdown();

      expect(unloadAll).toHaveBeenCalled();
    });
  });

  describe('acquireModelLoadLock', () => {
    test('returns release function from coordinator', async () => {
      const release = await service.acquireModelLoadLock('text');
      expect(typeof release).toBe('function');
    });
  });

  describe('listModels', () => {
    test('returns empty array when models path not configured', async () => {
      service._config = {};
      service._ensureConfigLoaded = jest.fn().mockResolvedValue();

      const models = await service.listModels();
      expect(Array.isArray(models)).toBe(true);
    });
  });

  describe('supportsVisionInput', () => {
    test('returns false when vision service unavailable', async () => {
      const result = await service.supportsVisionInput();
      expect(result).toBe(false);
    });
  });

  describe('batchGenerateEmbeddings', () => {
    test('rejects non-array input', async () => {
      service._initialized = true;
      service._ensureConfigLoaded = jest.fn().mockResolvedValue();
      service._config = { embeddingModel: 'embed.gguf' };

      await expect(service.batchGenerateEmbeddings('not-array')).rejects.toThrow();
    });

    test('returns empty result for empty array', async () => {
      service._initialized = true;
      service._ensureConfigLoaded = jest.fn().mockResolvedValue();
      service._config = { embeddingModel: 'embed.gguf' };

      const result = await service.batchGenerateEmbeddings([]);
      expect(result).toEqual({ embeddings: [] });
    });
  });
});
