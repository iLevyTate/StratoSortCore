jest.mock('os', () => ({
  totalmem: jest.fn(() => 16 * 1024 * 1024 * 1024),
  freemem: jest.fn(() => 8 * 1024 * 1024 * 1024)
}));

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

const { ModelMemoryManager } = require('../src/main/services/ModelMemoryManager');

describe('ModelMemoryManager', () => {
  test('canLoadModel respects max memory', () => {
    const llamaService = { _models: {}, _contexts: {}, _loadModel: jest.fn() };
    const manager = new ModelMemoryManager(llamaService);
    manager._maxMemoryUsage = 1;
    manager._modelSizeEstimates.embedding = 10;

    expect(manager.canLoadModel('embedding')).toBe(false);
  });

  test('ensureModelLoaded loads and caches model', async () => {
    const context = { dispose: jest.fn() };
    const llamaService = {
      _models: { embedding: context },
      _contexts: { embedding: context },
      _loadModel: jest.fn().mockResolvedValue(context)
    };
    const manager = new ModelMemoryManager(llamaService);
    manager._maxMemoryUsage = manager._modelSizeEstimates.embedding * 2;

    const result = await manager.ensureModelLoaded('embedding');

    expect(result).toBe(context);
    expect(manager._loadedModels.has('embedding')).toBe(true);
    expect(llamaService._loadModel).toHaveBeenCalledWith('embedding', expect.anything());
  });

  test('ensureModelLoaded returns cached context on subsequent calls', async () => {
    const context = { dispose: jest.fn() };
    const llamaService = {
      _models: { embedding: context },
      _contexts: { embedding: context },
      _loadModel: jest.fn().mockResolvedValue(context)
    };
    const manager = new ModelMemoryManager(llamaService);
    manager._maxMemoryUsage = manager._modelSizeEstimates.embedding * 2;

    await manager.ensureModelLoaded('embedding');
    const second = await manager.ensureModelLoaded('embedding');

    expect(second).toBe(context);
    expect(llamaService._loadModel).toHaveBeenCalledTimes(1);
  });

  test('_unloadModel disposes and clears references', async () => {
    const context = { dispose: jest.fn() };
    const llamaService = {
      _models: { embedding: context },
      _contexts: { embedding: context },
      _loadModel: jest.fn()
    };
    const manager = new ModelMemoryManager(llamaService);
    manager._loadedModels.set('embedding', {
      context,
      lastUsed: Date.now(),
      sizeBytes: manager._modelSizeEstimates.embedding
    });
    manager._currentMemoryUsage = manager._modelSizeEstimates.embedding;

    await manager._unloadModel('embedding');

    expect(context.dispose).toHaveBeenCalled();
    expect(manager._loadedModels.has('embedding')).toBe(false);
    expect(llamaService._models.embedding).toBeNull();
    expect(llamaService._contexts.embedding).toBeNull();
  });

  test('unloadModel does not unload when active refs remain after timeout', async () => {
    const context = { dispose: jest.fn() };
    const llamaService = {
      _models: { embedding: context },
      _contexts: { embedding: context },
      _loadModel: jest.fn()
    };
    const manager = new ModelMemoryManager(llamaService);
    manager._loadedModels.set('embedding', {
      context,
      lastUsed: Date.now(),
      sizeBytes: manager._modelSizeEstimates.embedding
    });
    manager._activeRefs.set('embedding', 1);

    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(6000);

    const unloaded = await manager.unloadModel('embedding');

    expect(unloaded).toBe(false);
    expect(context.dispose).not.toHaveBeenCalled();
    expect(manager._loadedModels.has('embedding')).toBe(true);
    nowSpy.mockRestore();
  });
});
