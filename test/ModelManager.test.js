/**
 * Tests for ModelManager
 * Covers initialization race protection, capability analysis, selection/fallback, and timeouts.
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/shared/singletonFactory', () => ({
  createSingletonHelpers: () => ({
    getInstance: jest.fn(),
    createInstance: jest.fn(),
    registerWithContainer: jest.fn(),
    resetInstance: jest.fn()
  })
}));

jest.mock('../src/shared/promiseUtils', () => ({
  withTimeout: jest.fn((p) => p)
}));

describe('ModelManager', () => {
  function loadWithMocks({ llamaOverrides = {}, settingsOverrides = {} } = {}) {
    jest.resetModules();

    const mockLlama = {
      listModels: jest.fn().mockResolvedValue([]),
      generateText: jest.fn().mockResolvedValue({ response: 'ok' }),
      ...llamaOverrides
    };

    const mockSettings = {
      load: jest.fn().mockResolvedValue({}),
      save: jest.fn().mockResolvedValue(undefined),
      ...settingsOverrides
    };

    jest.doMock('../src/main/services/LlamaService', () => ({
      getInstance: () => mockLlama
    }));

    jest.doMock('../src/main/services/SettingsService', () => ({
      getInstance: () => mockSettings
    }));

    const { ModelManager } = require('../src/main/services/ModelManager');
    return { ModelManager, mockLlama, mockSettings };
  }

  test('initialize reuses a single in-flight promise to prevent races', async () => {
    const { ModelManager } = loadWithMocks();
    const manager = new ModelManager();

    manager.loadConfig = jest.fn().mockResolvedValue(undefined);
    manager.discoverModels = jest.fn().mockResolvedValue([{ name: 'm1' }]);
    manager.ensureWorkingModel = jest.fn().mockResolvedValue('m1');

    const spy = jest.spyOn(manager, '_doInitialize');

    const p1 = manager.initialize();
    const p2 = manager.initialize();

    await expect(Promise.all([p1, p2])).resolves.toEqual([true, true]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(manager.initialized).toBe(true);
  });

  test('analyzeModelCapabilities detects vision and code models by name', () => {
    const { ModelManager } = loadWithMocks();
    const manager = new ModelManager();

    const visionCaps = manager.analyzeModelCapabilities({
      name: 'llava-v1.6-mistral-7b.Q4_K_M.gguf'
    });
    expect(visionCaps.vision).toBe(true);

    const codeCaps = manager.analyzeModelCapabilities({
      name: 'deepseek-coder-6.7b-instruct.gguf'
    });
    expect(codeCaps.code).toBe(true);

    const plainCaps = manager.analyzeModelCapabilities({ name: 'mistral-7b-instruct.gguf' });
    expect(plainCaps.text).toBe(true);
    expect(plainCaps.chat).toBe(true);
  });

  test('findBestModel prefers preferred models when they test successfully', async () => {
    const { ModelManager } = loadWithMocks();
    const manager = new ModelManager();

    manager.availableModels = [
      { name: 'random.gguf' },
      { name: 'mistral-7b-instruct.gguf' },
      { name: 'llama-3.2-3b-instruct.gguf' }
    ];
    manager.availableModels.forEach((m) => manager.analyzeModelCapabilities(m));

    manager.testModel = jest
      .fn()
      .mockImplementation(async (name) => name === 'llama-3.2-3b-instruct.gguf');

    const best = await manager.findBestModel();
    expect(best).toBe('llama-3.2-3b-instruct.gguf');
  });

  test('discoverModels stores available models and analyzes capabilities', async () => {
    const { ModelManager, mockLlama } = loadWithMocks({
      llamaOverrides: {
        listModels: jest.fn().mockResolvedValue([
          { name: 'llava-7b', size: 1 },
          { name: 'coder-7b', size: 2 }
        ])
      }
    });
    const manager = new ModelManager();

    const models = await manager.discoverModels();
    expect(models).toHaveLength(2);
    expect(mockLlama.listModels).toHaveBeenCalled();

    expect(manager.modelCapabilities.get('llava-7b')).toEqual(
      expect.objectContaining({ vision: true })
    );
    expect(manager.modelCapabilities.get('coder-7b')).toEqual(
      expect.objectContaining({ code: true })
    );
  });

  test('ensureWorkingModel returns user-configured model without testing fallbacks', async () => {
    const { ModelManager, mockSettings, mockLlama } = loadWithMocks({
      settingsOverrides: {
        load: jest.fn().mockResolvedValue({ textModel: 'user-picked.gguf' })
      }
    });
    const manager = new ModelManager();
    manager.availableModels = []; // nothing discovered yet

    const selected = await manager.ensureWorkingModel();
    expect(selected).toBe('user-picked.gguf');
    expect(manager.selectedModel).toBe('user-picked.gguf');

    expect(mockSettings.load).toHaveBeenCalled();
    expect(mockLlama.generateText).not.toHaveBeenCalled();
  });

  test('generateWithFallback tries selected model then falls back', async () => {
    const { ModelManager, mockLlama } = loadWithMocks({
      llamaOverrides: {
        generateText: jest
          .fn()
          .mockRejectedValueOnce(new Error('primary failed'))
          .mockResolvedValueOnce({ response: 'ok' })
      }
    });
    const manager = new ModelManager();
    manager.availableModels = [{ name: 'primary.gguf' }, { name: 'backup.gguf' }];
    manager.selectedModel = 'primary.gguf';
    manager.fallbackPreferences = ['backup.gguf'];

    const result = await manager.generateWithFallback('Hello');
    expect(result).toEqual({ success: true, model: 'backup.gguf', response: 'ok' });
    expect(mockLlama.generateText).toHaveBeenCalledTimes(2);
  });

  test('setSelectedModel rejects unavailable model and persists on success', async () => {
    const { ModelManager, mockSettings } = loadWithMocks();
    const manager = new ModelManager();

    manager.availableModels = [{ name: 'm1.gguf' }];
    manager.analyzeModelCapabilities(manager.availableModels[0]);

    await expect(manager.setSelectedModel('missing.gguf')).rejects.toEqual(
      expect.objectContaining({ code: 'LLAMA_002' })
    );

    await manager.setSelectedModel('m1.gguf');
    expect(manager.selectedModel).toBe('m1.gguf');
    expect(mockSettings.save).toHaveBeenCalledWith({ textModel: 'm1.gguf' });
  });

  test('testModel times out, aborts, and returns false', async () => {
    let capturedSignal = null;
    const { ModelManager } = loadWithMocks({
      llamaOverrides: {
        generateText: jest.fn().mockImplementation(({ signal }) => {
          capturedSignal = signal;
          return new Promise(() => {});
        })
      }
    });

    const manager = new ModelManager();
    jest.useFakeTimers();

    const p = manager.testModel('m1.gguf', 50);
    jest.advanceTimersByTime(60);

    await expect(p).resolves.toBe(false);
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal.aborted).toBe(true);

    jest.useRealTimers();
  });
});
