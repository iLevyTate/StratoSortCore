/**
 * Tests for StartupManagerCore
 * Tests the core startup manager functionality
 */

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock ServiceContainer
jest.mock('../src/main/services/ServiceContainer', () => ({
  container: {
    get: jest.fn(),
    register: jest.fn()
  }
}));

// Mock asyncSpawnUtils
jest.mock('../src/main/utils/asyncSpawnUtils', () => ({
  hasPythonModuleAsync: jest.fn().mockResolvedValue(true)
}));

// Mock promiseUtils
jest.mock('../src/shared/promiseUtils', () => ({
  withTimeout: jest.fn((promise) => promise),
  delay: jest.fn().mockResolvedValue(undefined)
}));

// Mock preflightChecks
jest.mock('../src/main/services/startup/preflightChecks', () => ({
  runPreflightChecks: jest.fn().mockResolvedValue({ success: true }),
  isPortAvailable: jest.fn().mockResolvedValue(true)
}));

// Mock chromaService
jest.mock('../src/main/services/startup/chromaService', () => ({
  startChromaDB: jest.fn().mockResolvedValue({ success: true }),
  isChromaDBRunning: jest.fn().mockResolvedValue(true),
  checkChromaDBHealth: jest.fn().mockResolvedValue(true)
}));

// Mock ollamaService
jest.mock('../src/main/services/startup/ollamaService', () => ({
  startOllama: jest.fn().mockResolvedValue({ success: true }),
  isOllamaRunning: jest.fn().mockResolvedValue(true),
  checkOllamaHealth: jest.fn().mockResolvedValue(true)
}));

// Mock healthMonitoring
jest.mock('../src/main/services/startup/healthMonitoring', () => ({
  createHealthMonitor: jest.fn().mockReturnValue(setInterval(() => {}, 100000))
}));

// Mock shutdownHandler
jest.mock('../src/main/services/startup/shutdownHandler', () => ({
  shutdown: jest.fn().mockResolvedValue(undefined)
}));

describe('StartupManagerCore', () => {
  let StartupManager;
  let manager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    jest.useFakeTimers();

    // Clear global state
    delete global.degradedMode;

    const module = require('../src/main/services/startup/StartupManagerCore');
    StartupManager = module.StartupManager;
    manager = new StartupManager();
  });

  afterEach(() => {
    jest.useRealTimers();
    if (manager.healthMonitor) {
      clearInterval(manager.healthMonitor);
    }
  });

  describe('constructor', () => {
    test('initializes with default config', () => {
      expect(manager.config.startupTimeout).toBe(60000);
      expect(manager.config.healthCheckInterval).toBe(120000);
      expect(manager.config.maxRetries).toBe(3);
    });

    test('accepts custom options', () => {
      const customManager = new StartupManager({
        startupTimeout: 30000,
        maxRetries: 5
      });

      expect(customManager.config.startupTimeout).toBe(30000);
      expect(customManager.config.maxRetries).toBe(5);
    });

    test('initializes service status', () => {
      expect(manager.serviceStatus.chromadb.status).toBe('not_started');
      expect(manager.serviceStatus.ollama.status).toBe('not_started');
    });

    test('initializes startup state', () => {
      expect(manager.startupState).toBe('initializing');
      expect(manager.startupPhase).toBe('idle');
      expect(manager.errors).toEqual([]);
    });
  });

  describe('hasPythonModule', () => {
    test('checks for python module', async () => {
      const { hasPythonModuleAsync } = require('../src/main/utils/asyncSpawnUtils');

      const result = await manager.hasPythonModule('chromadb');

      expect(hasPythonModuleAsync).toHaveBeenCalledWith('chromadb');
      expect(result).toBe(true);
    });
  });

  describe('setProgressCallback', () => {
    test('sets progress callback', () => {
      const callback = jest.fn();
      manager.setProgressCallback(callback);

      expect(manager.onProgressCallback).toBe(callback);
    });
  });

  describe('reportProgress', () => {
    test('updates startup phase', () => {
      manager.reportProgress('services', 'Starting services', 50);

      expect(manager.startupPhase).toBe('services');
    });

    test('calls progress callback', () => {
      const callback = jest.fn();
      manager.setProgressCallback(callback);

      manager.reportProgress('services', 'Starting services', 50, {
        detail: 'test'
      });

      expect(callback).toHaveBeenCalledWith({
        phase: 'services',
        message: 'Starting services',
        progress: 50,
        serviceStatus: expect.any(Object),
        errors: expect.any(Array),
        details: { detail: 'test' }
      });
    });

    test('logs progress', () => {
      const { logger } = require('../src/shared/logger');

      manager.reportProgress('test', 'Test message', 25);

      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe('runPreflightChecks', () => {
    test('delegates to preflightChecks module', async () => {
      const { runPreflightChecks } = require('../src/main/services/startup/preflightChecks');

      await manager.runPreflightChecks();

      expect(runPreflightChecks).toHaveBeenCalled();
    });
  });

  describe('isPortAvailable', () => {
    test('checks port availability', async () => {
      const { isPortAvailable } = require('../src/main/services/startup/preflightChecks');

      const result = await manager.isPortAvailable('localhost', 8000);

      expect(isPortAvailable).toHaveBeenCalledWith('localhost', 8000);
      expect(result).toBe(true);
    });
  });

  describe('startServiceWithRetry', () => {
    test('starts service successfully', async () => {
      const startFunc = jest.fn().mockResolvedValue({ success: true });
      const checkFunc = jest.fn().mockResolvedValue(true);

      const result = await manager.startServiceWithRetry('testService', startFunc, checkFunc, {
        required: false
      });

      expect(result.success).toBe(true);
      expect(manager.serviceStatus.testService.status).toBe('running');
    });

    test('returns early if service already running', async () => {
      const startFunc = jest.fn();
      const checkFunc = jest.fn().mockResolvedValue(true);

      const result = await manager.startServiceWithRetry('testService', startFunc, checkFunc);

      expect(result.success).toBe(true);
      expect(result.alreadyRunning).toBe(true);
      expect(startFunc).not.toHaveBeenCalled();
    });

    test('retries on failure', async () => {
      const startFunc = jest.fn().mockResolvedValue({ success: true });
      const checkFunc = jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      // Need to use real timers for retry delays
      jest.useRealTimers();

      const result = await manager.startServiceWithRetry('testService', startFunc, checkFunc, {
        required: false,
        verifyTimeout: 100
      });

      jest.useFakeTimers();

      expect(result.success).toBe(true);
    });

    test('handles external service', async () => {
      const startFunc = jest.fn().mockResolvedValue({ external: true });
      const checkFunc = jest.fn().mockResolvedValue(false);

      const result = await manager.startServiceWithRetry('testService', startFunc, checkFunc);

      expect(result.success).toBe(true);
      expect(result.external).toBe(true);
      expect(manager.serviceStatus.testService.external).toBe(true);
    });

    test('throws for required service failure', async () => {
      const startFunc = jest.fn().mockRejectedValue(new Error('Start failed'));
      const checkFunc = jest.fn().mockResolvedValue(false);

      await expect(
        manager.startServiceWithRetry('testService', startFunc, checkFunc, {
          required: true,
          maxRetries: 1
        })
      ).rejects.toThrow('Critical service');
    });

    test('returns fallback mode for non-required service failure', async () => {
      const startFunc = jest.fn().mockRejectedValue(new Error('Start failed'));
      const checkFunc = jest.fn().mockResolvedValue(false);

      const result = await manager.startServiceWithRetry('testService', startFunc, checkFunc, {
        required: false,
        maxRetries: 1
      });

      expect(result.success).toBe(false);
      expect(result.fallbackMode).toBe(true);
    });

    test('stores process reference', async () => {
      const mockProcess = { pid: 12345 };
      const startFunc = jest.fn().mockResolvedValue({ process: mockProcess });
      const checkFunc = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      jest.useRealTimers();

      await manager.startServiceWithRetry('testService', startFunc, checkFunc, {
        verifyTimeout: 500
      });

      jest.useFakeTimers();

      expect(manager.serviceProcesses.get('testService')).toBe(mockProcess);
    });
  });

  describe('startChromaDB', () => {
    test('starts ChromaDB service', async () => {
      const {
        startChromaDB,
        isChromaDBRunning
      } = require('../src/main/services/startup/chromaService');
      startChromaDB.mockResolvedValue({ success: true });
      isChromaDBRunning.mockResolvedValue(true);

      const result = await manager.startChromaDB();

      expect(result.success).toBe(true);
    });

    test('handles disabled ChromaDB', async () => {
      const { startChromaDB } = require('../src/main/services/startup/chromaService');
      startChromaDB.mockResolvedValue({
        disabled: true,
        reason: 'Missing dependency'
      });

      const result = await manager.startChromaDB();

      expect(result.disabled).toBe(true);
    });

    test('sets dependency missing flag', async () => {
      const { startChromaDB } = require('../src/main/services/startup/chromaService');
      startChromaDB.mockResolvedValue({
        setDependencyMissing: true,
        disabled: true
      });

      await manager.startChromaDB();

      expect(manager.chromadbDependencyMissing).toBe(true);
    });
  });

  describe('startOllama', () => {
    test('starts Ollama service', async () => {
      const {
        startOllama,
        isOllamaRunning
      } = require('../src/main/services/startup/ollamaService');
      startOllama.mockResolvedValue({ success: true });
      isOllamaRunning.mockResolvedValue(true);

      const result = await manager.startOllama();

      expect(result.success).toBe(true);
    });
  });

  describe('initializeServices', () => {
    test('initializes both services in parallel', async () => {
      const {
        startChromaDB,
        isChromaDBRunning
      } = require('../src/main/services/startup/chromaService');
      const {
        startOllama,
        isOllamaRunning
      } = require('../src/main/services/startup/ollamaService');

      startChromaDB.mockResolvedValue({ success: true });
      isChromaDBRunning.mockResolvedValue(true);
      startOllama.mockResolvedValue({ success: true });
      isOllamaRunning.mockResolvedValue(true);

      const result = await manager.initializeServices();

      expect(result.chromadb).toBeDefined();
      expect(result.ollama).toBeDefined();
    });

    test('reports progress', async () => {
      const callback = jest.fn();
      manager.setProgressCallback(callback);

      await manager.initializeServices();

      expect(callback).toHaveBeenCalled();
    });

    test('handles partial failures', async () => {
      const {
        startChromaDB,
        isChromaDBRunning
      } = require('../src/main/services/startup/chromaService');
      const {
        startOllama,
        isOllamaRunning
      } = require('../src/main/services/startup/ollamaService');

      startChromaDB.mockResolvedValue({ success: true });
      isChromaDBRunning.mockResolvedValue(true);
      startOllama.mockRejectedValue(new Error('Ollama failed'));
      isOllamaRunning.mockResolvedValue(false);

      const result = await manager.initializeServices();

      expect(result.chromadb.success).toBe(true);
      expect(result.ollama.success).toBe(false);
    });
  });

  describe('startup', () => {
    beforeEach(() => {
      const {
        startChromaDB,
        isChromaDBRunning
      } = require('../src/main/services/startup/chromaService');
      const {
        startOllama,
        isOllamaRunning
      } = require('../src/main/services/startup/ollamaService');

      startChromaDB.mockResolvedValue({ success: true });
      isChromaDBRunning.mockResolvedValue(true);
      startOllama.mockResolvedValue({ success: true });
      isOllamaRunning.mockResolvedValue(true);
    });

    test('completes startup sequence', async () => {
      jest.useRealTimers();

      const result = await manager.startup();

      expect(manager.startupState).toBe('completed');
      expect(result).toHaveProperty('preflight');
      expect(result).toHaveProperty('services');

      jest.useFakeTimers();
    });

    test('starts health monitoring on success', async () => {
      jest.useRealTimers();

      const { createHealthMonitor } = require('../src/main/services/startup/healthMonitoring');

      await manager.startup();

      expect(createHealthMonitor).toHaveBeenCalled();

      jest.useFakeTimers();
    });

    test('handles startup timeout', async () => {
      manager.config.startupTimeout = 10;

      const { runPreflightChecks } = require('../src/main/services/startup/preflightChecks');
      runPreflightChecks.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      jest.useRealTimers();

      await expect(manager.startup()).rejects.toThrow('timeout');

      jest.useFakeTimers();
    });

    test('enables graceful degradation on failure', async () => {
      const { runPreflightChecks } = require('../src/main/services/startup/preflightChecks');
      runPreflightChecks.mockRejectedValue(new Error('Preflight failed'));

      jest.useRealTimers();

      await expect(manager.startup()).rejects.toThrow();

      expect(manager.startupState).toBe('failed');

      jest.useFakeTimers();
    });
  });

  describe('enableGracefulDegradation', () => {
    test('sets global degraded mode', async () => {
      manager.serviceStatus.chromadb.status = 'failed';
      manager.serviceStatus.ollama.status = 'failed';

      await manager.enableGracefulDegradation();

      expect(global.degradedMode.enabled).toBe(true);
      expect(global.degradedMode.missingServices).toContain('chromadb');
      expect(global.degradedMode.missingServices).toContain('ollama');
    });

    test('adds limitations for missing services', async () => {
      manager.serviceStatus.chromadb.status = 'failed';

      await manager.enableGracefulDegradation();

      expect(global.degradedMode.limitations).toContain('Semantic search disabled');
    });
  });

  describe('startHealthMonitoring', () => {
    test('creates health monitor', () => {
      const { createHealthMonitor } = require('../src/main/services/startup/healthMonitoring');

      manager.startHealthMonitoring();

      expect(createHealthMonitor).toHaveBeenCalled();
      expect(manager.healthMonitor).toBeDefined();
    });

    test('clears existing monitor before creating new one', () => {
      const existingMonitor = setInterval(() => {}, 10000);
      manager.healthMonitor = existingMonitor;

      manager.startHealthMonitoring();

      // Should have cleared and created new
      expect(manager.healthMonitor).not.toBe(existingMonitor);
    });
  });

  describe('checkChromaDBHealth', () => {
    test('delegates to chromaService', async () => {
      const { checkChromaDBHealth } = require('../src/main/services/startup/chromaService');

      await manager.checkChromaDBHealth();

      expect(checkChromaDBHealth).toHaveBeenCalled();
    });
  });

  describe('checkOllamaHealth', () => {
    test('delegates to ollamaService', async () => {
      const { checkOllamaHealth } = require('../src/main/services/startup/ollamaService');

      await manager.checkOllamaHealth();

      expect(checkOllamaHealth).toHaveBeenCalled();
    });
  });

  describe('getServiceStatus', () => {
    test('returns current status', () => {
      manager.startupState = 'completed';
      manager.startupPhase = 'ready';
      manager.errors.push({ error: 'test' });

      const status = manager.getServiceStatus();

      expect(status.startup).toBe('completed');
      expect(status.phase).toBe('ready');
      expect(status.services).toBeDefined();
      expect(status.errors).toHaveLength(1);
    });

    test('returns degraded status', () => {
      global.degradedMode = { enabled: true };

      const status = manager.getServiceStatus();

      expect(status.degraded).toBe(true);
    });
  });

  describe('shutdown', () => {
    test('delegates to shutdown handler', async () => {
      const { shutdown } = require('../src/main/services/startup/shutdownHandler');

      await manager.shutdown();

      expect(shutdown).toHaveBeenCalled();
    });
  });

  describe('delay', () => {
    test('delegates to promiseUtils', async () => {
      const { delay } = require('../src/shared/promiseUtils');

      await manager.delay(100);

      expect(delay).toHaveBeenCalledWith(100);
    });
  });
});
