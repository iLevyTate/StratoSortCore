jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/main/services/LlamaService', () => {
  const defaultInstance = {
    initialize: jest.fn().mockResolvedValue(),
    getHealthStatus: jest.fn(() => ({ gpuBackend: 'cpu' })),
    testConnection: jest.fn().mockResolvedValue({ success: true, status: 'healthy' }),
    shutdown: jest.fn().mockResolvedValue()
  };
  const mod = {
    getInstance: jest.fn(() => defaultInstance),
    registerWithContainer: jest.fn((cont, id) => {
      if (!cont.has(id)) {
        // Delegate to getInstance() so test overrides are picked up by container.resolve()
        cont.registerSingleton(id, () => mod.getInstance());
      }
    })
  };
  return mod;
});

jest.mock('../src/main/services/OramaVectorService', () => {
  const defaultInstance = {
    initialize: jest.fn().mockResolvedValue(),
    shutdown: jest.fn().mockResolvedValue()
  };
  const mod = {
    getInstance: jest.fn(() => defaultInstance),
    registerWithContainer: jest.fn((cont, id) => {
      if (!cont.has(id)) {
        // Delegate to getInstance() so test overrides are picked up by container.resolve()
        cont.registerSingleton(id, () => mod.getInstance());
      }
    })
  };
  return mod;
});

jest.mock('../src/main/services/migration', () => ({
  getDataMigrationService: jest.fn(() => ({
    needsMigration: jest.fn().mockResolvedValue(false),
    migrate: jest.fn().mockResolvedValue({ success: true })
  }))
}));

jest.mock('../src/main/services/startup/shutdownHandler', () => ({
  shutdown: jest.fn()
}));

const { StartupManager } = require('../src/main/services/startup/StartupManagerCore');
const { container } = require('../src/main/services/ServiceContainer');

describe('StartupManagerCore', () => {
  beforeEach(() => {
    // Reset the DI container to prevent cached singletons from leaking between tests
    container.reset();
  });

  test('startup completes and returns success', async () => {
    const manager = new StartupManager({ startupTimeout: 1000 });
    manager.startHealthMonitoring = jest.fn();

    const result = await manager.startup();

    expect(result.success).toBe(true);
    expect(manager.startupState).toBe('completed');
  });

  test('_runStartupSequence handles migration warning', async () => {
    const { getDataMigrationService } = require('../src/main/services/migration');
    getDataMigrationService.mockReturnValueOnce({
      needsMigration: jest.fn().mockResolvedValue(true),
      migrate: jest.fn().mockResolvedValue({ success: false, errors: ['fail'] })
    });

    const manager = new StartupManager();
    await manager._runStartupSequence();
    expect(manager.errors.some((e) => e.phase === 'migration')).toBe(true);
  });

  test('initializeServices sets service status', async () => {
    const manager = new StartupManager();
    const result = await manager.initializeServices();

    expect(result.vectorDb.success).toBe(true);
    expect(result.llama.success).toBe(true);
    expect(manager.serviceStatus.vectorDb.status).toBe('running');
    expect(manager.serviceStatus.llama.status).toBe('running');
  });

  describe('Migration: parallel initialization', () => {
    test('OramaVectorService and LlamaService initialize in parallel', async () => {
      const callOrder = [];
      const { getInstance: getOrama } = require('../src/main/services/OramaVectorService');
      const { getInstance: getLlama } = require('../src/main/services/LlamaService');

      getOrama.mockReturnValue({
        initialize: jest.fn(async () => {
          callOrder.push('orama-start');
          await new Promise((r) => setTimeout(r, 10));
          callOrder.push('orama-end');
        }),
        shutdown: jest.fn().mockResolvedValue()
      });

      getLlama.mockReturnValue({
        initialize: jest.fn(async () => {
          callOrder.push('llama-start');
          await new Promise((r) => setTimeout(r, 10));
          callOrder.push('llama-end');
        }),
        getHealthStatus: jest.fn(() => ({ gpuBackend: 'cpu' })),
        testConnection: jest.fn().mockResolvedValue({ success: true, status: 'healthy' }),
        shutdown: jest.fn().mockResolvedValue()
      });

      const manager = new StartupManager();
      await manager.initializeServices();

      // Both should start before either ends (parallel execution)
      expect(callOrder.indexOf('orama-start')).toBeLessThan(callOrder.indexOf('orama-end'));
      expect(callOrder.indexOf('llama-start')).toBeLessThan(callOrder.indexOf('llama-end'));
      // Both start calls should appear before both end calls
      const firstEnd = Math.min(callOrder.indexOf('orama-end'), callOrder.indexOf('llama-end'));
      const lastStart = Math.max(
        callOrder.indexOf('orama-start'),
        callOrder.indexOf('llama-start')
      );
      expect(lastStart).toBeLessThan(firstEnd);
    });

    test('partial failure: Orama up, Llama down', async () => {
      const { getInstance: getOrama } = require('../src/main/services/OramaVectorService');
      const { getInstance: getLlama } = require('../src/main/services/LlamaService');

      getOrama.mockReturnValue({
        initialize: jest.fn().mockResolvedValue(),
        shutdown: jest.fn().mockResolvedValue()
      });

      getLlama.mockReturnValue({
        initialize: jest.fn().mockRejectedValue(new Error('No GPU available')),
        getHealthStatus: jest.fn(() => ({ gpuBackend: null })),
        shutdown: jest.fn().mockResolvedValue()
      });

      const manager = new StartupManager();
      const result = await manager.initializeServices();

      expect(result.vectorDb.success).toBe(true);
      expect(result.llama.success).toBe(false);
      expect(manager.serviceStatus.vectorDb.status).toBe('running');
      expect(manager.serviceStatus.vectorDb.health).toBe('healthy');
      expect(manager.serviceStatus.llama.status).toBe('failed');
      expect(manager.serviceStatus.llama.health).toBe('unhealthy');
    });

    test('partial failure: Llama up, Orama down', async () => {
      const { getInstance: getOrama } = require('../src/main/services/OramaVectorService');
      const { getInstance: getLlama } = require('../src/main/services/LlamaService');

      getOrama.mockReturnValue({
        initialize: jest.fn().mockRejectedValue(new Error('DB corrupt')),
        shutdown: jest.fn().mockResolvedValue()
      });

      getLlama.mockReturnValue({
        initialize: jest.fn().mockResolvedValue(),
        getHealthStatus: jest.fn(() => ({ gpuBackend: 'vulkan' })),
        testConnection: jest.fn().mockResolvedValue({ success: true, status: 'healthy' }),
        shutdown: jest.fn().mockResolvedValue()
      });

      const manager = new StartupManager();
      const result = await manager.initializeServices();

      expect(result.vectorDb.success).toBe(false);
      expect(result.llama.success).toBe(true);
      expect(manager.serviceStatus.vectorDb.status).toBe('failed');
      expect(manager.serviceStatus.llama.status).toBe('running');
    });

    test('serviceStatus has correct structure for new architecture', () => {
      const manager = new StartupManager();

      // Initial state should reference vectorDb and llama (not chromadb/ollama)
      expect(manager.serviceStatus).toHaveProperty('vectorDb');
      expect(manager.serviceStatus).toHaveProperty('llama');
      expect(manager.serviceStatus).not.toHaveProperty('chromadb');
      expect(manager.serviceStatus).not.toHaveProperty('ollama');

      expect(manager.serviceStatus.vectorDb).toEqual({
        status: 'not_started',
        health: 'unknown'
      });
      expect(manager.serviceStatus.llama).toEqual({
        status: 'not_started',
        health: 'unknown'
      });
    });

    test('getServiceStatus returns correct degraded flag when llama fails', async () => {
      const { getInstance: getLlama } = require('../src/main/services/LlamaService');
      getLlama.mockReturnValue({
        initialize: jest.fn().mockRejectedValue(new Error('fail')),
        getHealthStatus: jest.fn(),
        shutdown: jest.fn().mockResolvedValue()
      });

      const manager = new StartupManager();
      await manager.initializeServices();

      const status = manager.getServiceStatus();
      expect(status.degraded).toBe(true);
      expect(status.services.llama.status).toBe('failed');
    });

    test('llama service records GPU backend on success', async () => {
      const { getInstance: getLlama } = require('../src/main/services/LlamaService');
      getLlama.mockReturnValue({
        initialize: jest.fn().mockResolvedValue(),
        getHealthStatus: jest.fn(() => ({ gpuBackend: 'metal' })),
        testConnection: jest.fn().mockResolvedValue({ success: true, status: 'healthy' }),
        shutdown: jest.fn().mockResolvedValue()
      });

      const manager = new StartupManager();
      await manager.initializeServices();

      expect(manager.serviceStatus.llama.gpu).toBe('metal');
    });

    test('shutdown calls both getLlamaService().shutdown and getOramaService().shutdown', async () => {
      const { getInstance: getOrama } = require('../src/main/services/OramaVectorService');
      const { getInstance: getLlama } = require('../src/main/services/LlamaService');

      const oramaMock = { shutdown: jest.fn().mockResolvedValue() };
      const llamaMock = { shutdown: jest.fn().mockResolvedValue() };
      getOrama.mockReturnValue(oramaMock);
      getLlama.mockReturnValue(llamaMock);

      const manager = new StartupManager();
      await manager.shutdown();

      expect(llamaMock.shutdown).toHaveBeenCalled();
      expect(oramaMock.shutdown).toHaveBeenCalled();
    });
  });
});
