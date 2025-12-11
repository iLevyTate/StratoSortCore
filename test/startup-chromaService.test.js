/**
 * Tests for ChromaDB Service Startup
 * Tests ChromaDB startup and health checking functions
 */

// Mock dependencies
jest.mock('child_process', () => ({
  spawn: jest.fn().mockReturnValue({
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    on: jest.fn(),
    pid: 12345
  })
}));

jest.mock('axios');

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../src/main/utils/ollamaApiRetry', () => ({
  axiosWithRetry: jest.fn()
}));

jest.mock('../src/main/utils/asyncSpawnUtils', () => ({
  hasPythonModuleAsync: jest.fn()
}));

jest.mock('../src/main/utils/chromaSpawnUtils', () => ({
  buildChromaSpawnPlan: jest.fn()
}));

jest.mock('../src/main/services/chromadb', () => ({
  getInstance: jest.fn().mockReturnValue({
    getServerConfig: jest.fn().mockReturnValue({
      host: '127.0.0.1',
      port: 8000
    })
  })
}));

// Mock ServiceContainer to provide chromaDb service
jest.mock('../src/main/services/ServiceContainer', () => ({
  container: {
    resolve: jest.fn().mockReturnValue({
      getServerConfig: jest.fn().mockReturnValue({
        host: '127.0.0.1',
        port: 8000
      })
    })
  },
  ServiceIds: {
    CHROMA_DB: 'chromaDb'
  }
}));

describe('chromaService', () => {
  let chromaService;
  let axios;
  let axiosWithRetry;
  let spawn;
  let hasPythonModuleAsync;
  let buildChromaSpawnPlan;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // Reset environment
    delete process.env.CHROMA_SERVER_URL;
    delete process.env.CHROMA_SERVER_PROTOCOL;
    delete process.env.CHROMA_SERVER_HOST;
    delete process.env.CHROMA_SERVER_PORT;
    delete process.env.STRATOSORT_DISABLE_CHROMADB;

    axios = require('axios');
    axiosWithRetry = require('../src/main/utils/ollamaApiRetry').axiosWithRetry;
    spawn = require('child_process').spawn;
    hasPythonModuleAsync = require('../src/main/utils/asyncSpawnUtils').hasPythonModuleAsync;
    buildChromaSpawnPlan = require('../src/main/utils/chromaSpawnUtils').buildChromaSpawnPlan;

    chromaService = require('../src/main/services/startup/chromaService');
  });

  describe('checkChromaDBHealth', () => {
    test('returns true when heartbeat succeeds', async () => {
      axios.get.mockResolvedValue({ status: 200 });

      const result = await chromaService.checkChromaDBHealth();

      expect(result).toBe(true);
    });

    test('tries multiple endpoints', async () => {
      axios.get
        .mockRejectedValueOnce(new Error('404'))
        .mockRejectedValueOnce(new Error('404'))
        .mockResolvedValueOnce({ status: 200 });

      const result = await chromaService.checkChromaDBHealth();

      expect(result).toBe(true);
      expect(axios.get).toHaveBeenCalledTimes(3);
    });

    test('returns false when all endpoints fail', async () => {
      axios.get.mockRejectedValue(new Error('Connection failed'));

      const result = await chromaService.checkChromaDBHealth();

      expect(result).toBe(false);
    });

    test('uses default URL when env not set', async () => {
      axios.get.mockResolvedValue({ status: 200 });

      await chromaService.checkChromaDBHealth();

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('http://127.0.0.1:8000'),
        expect.any(Object)
      );
    });

    test('uses CHROMA_SERVER_URL when set', async () => {
      process.env.CHROMA_SERVER_URL = 'http://custom:9000';

      // Re-require to pick up env change - need to re-mock axios after resetModules
      jest.resetModules();
      const freshAxios = require('axios');
      freshAxios.get = jest.fn().mockResolvedValue({ status: 200 });
      const freshModule = require('../src/main/services/startup/chromaService');

      await freshModule.checkChromaDBHealth();

      expect(freshAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('http://custom:9000'),
        expect.any(Object)
      );
    });

    test('returns false on non-200 status', async () => {
      axios.get.mockResolvedValue({ status: 500 });

      const result = await chromaService.checkChromaDBHealth();

      expect(result).toBe(false);
    });
  });

  describe('isChromaDBRunning', () => {
    test('returns true when heartbeat succeeds', async () => {
      axiosWithRetry.mockResolvedValue({ status: 200, data: {} });

      const result = await chromaService.isChromaDBRunning();

      expect(result).toBe(true);
    });

    test('returns false when all endpoints fail', async () => {
      axiosWithRetry.mockRejectedValue(new Error('Connection failed'));

      const result = await chromaService.isChromaDBRunning();

      expect(result).toBe(false);
    });

    test('continues to next endpoint when error in response', async () => {
      axiosWithRetry
        .mockResolvedValueOnce({ status: 200, data: { error: 'some error' } })
        .mockResolvedValueOnce({ status: 200, data: {} });

      const result = await chromaService.isChromaDBRunning();

      expect(result).toBe(true);
    });

    test('uses retry logic', async () => {
      axiosWithRetry.mockResolvedValue({ status: 200, data: {} });

      await chromaService.isChromaDBRunning();

      expect(axiosWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          maxRetries: 2,
          initialDelay: 500
        })
      );
    });
  });

  describe('startChromaDB', () => {
    let serviceStatus;
    let errors;

    beforeEach(() => {
      serviceStatus = {
        chromadb: { status: 'stopped', health: 'unknown' }
      };
      errors = [];
      hasPythonModuleAsync.mockResolvedValue(true);
      buildChromaSpawnPlan.mockResolvedValue({
        command: 'chroma',
        args: ['run'],
        options: {},
        source: 'local-cli'
      });
    });

    test('returns disabled when STRATOSORT_DISABLE_CHROMADB is set', async () => {
      process.env.STRATOSORT_DISABLE_CHROMADB = '1';

      jest.resetModules();
      const freshModule = require('../src/main/services/startup/chromaService');

      const result = await freshModule.startChromaDB({
        serviceStatus,
        errors,
        chromadbDependencyMissing: false,
        cachedChromaSpawnPlan: null,
        setCachedSpawnPlan: jest.fn()
      });

      expect(result.success).toBe(true);
      expect(result.disabled).toBe(true);
      expect(serviceStatus.chromadb.status).toBe('disabled');
    });

    test('returns disabled when dependency previously missing', async () => {
      const result = await chromaService.startChromaDB({
        serviceStatus,
        errors,
        chromadbDependencyMissing: true,
        cachedChromaSpawnPlan: null,
        setCachedSpawnPlan: jest.fn()
      });

      expect(result.success).toBe(false);
      expect(result.disabled).toBe(true);
      expect(result.reason).toBe('missing_dependency');
    });

    test('checks for chromadb Python module', async () => {
      hasPythonModuleAsync.mockResolvedValue(false);

      const result = await chromaService.startChromaDB({
        serviceStatus,
        errors,
        chromadbDependencyMissing: false,
        cachedChromaSpawnPlan: null,
        setCachedSpawnPlan: jest.fn()
      });

      expect(hasPythonModuleAsync).toHaveBeenCalledWith('chromadb');
      expect(result.setDependencyMissing).toBe(true);
    });

    test('adds error when chromadb module missing', async () => {
      hasPythonModuleAsync.mockResolvedValue(false);

      await chromaService.startChromaDB({
        serviceStatus,
        errors,
        chromadbDependencyMissing: false,
        cachedChromaSpawnPlan: null,
        setCachedSpawnPlan: jest.fn()
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].service).toBe('chromadb');
    });

    test('uses cached spawn plan when available', async () => {
      const cachedPlan = {
        command: 'chroma',
        args: ['run', '--cached'],
        options: {}
      };

      await chromaService.startChromaDB({
        serviceStatus,
        errors,
        chromadbDependencyMissing: false,
        cachedChromaSpawnPlan: cachedPlan,
        setCachedSpawnPlan: jest.fn()
      });

      expect(buildChromaSpawnPlan).not.toHaveBeenCalled();
      expect(spawn).toHaveBeenCalledWith('chroma', ['run', '--cached'], {});
    });

    test('builds spawn plan when not cached', async () => {
      await chromaService.startChromaDB({
        serviceStatus,
        errors,
        chromadbDependencyMissing: false,
        cachedChromaSpawnPlan: null,
        setCachedSpawnPlan: jest.fn()
      });

      expect(buildChromaSpawnPlan).toHaveBeenCalled();
    });

    test('caches spawn plan for local-cli source', async () => {
      const setCachedSpawnPlan = jest.fn();

      await chromaService.startChromaDB({
        serviceStatus,
        errors,
        chromadbDependencyMissing: false,
        cachedChromaSpawnPlan: null,
        setCachedSpawnPlan
      });

      expect(setCachedSpawnPlan).toHaveBeenCalled();
    });

    test('does not cache non-local-cli spawn plan', async () => {
      buildChromaSpawnPlan.mockResolvedValue({
        command: 'python',
        args: ['-m', 'chromadb'],
        options: {},
        source: 'fallback'
      });

      const setCachedSpawnPlan = jest.fn();

      await chromaService.startChromaDB({
        serviceStatus,
        errors,
        chromadbDependencyMissing: false,
        cachedChromaSpawnPlan: null,
        setCachedSpawnPlan
      });

      expect(setCachedSpawnPlan).not.toHaveBeenCalled();
    });

    test('throws when no spawn plan found', async () => {
      buildChromaSpawnPlan.mockResolvedValue(null);

      await expect(
        chromaService.startChromaDB({
          serviceStatus,
          errors,
          chromadbDependencyMissing: false,
          cachedChromaSpawnPlan: null,
          setCachedSpawnPlan: jest.fn()
        })
      ).rejects.toThrow('No viable ChromaDB startup plan found');
    });

    test('spawns ChromaDB process', async () => {
      const result = await chromaService.startChromaDB({
        serviceStatus,
        errors,
        chromadbDependencyMissing: false,
        cachedChromaSpawnPlan: null,
        setCachedSpawnPlan: jest.fn()
      });

      expect(spawn).toHaveBeenCalled();
      expect(result.process).toBeDefined();
    });

    test('sets up stdout handler', async () => {
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        pid: 12345
      };
      spawn.mockReturnValue(mockProcess);

      await chromaService.startChromaDB({
        serviceStatus,
        errors,
        chromadbDependencyMissing: false,
        cachedChromaSpawnPlan: null,
        setCachedSpawnPlan: jest.fn()
      });

      expect(mockProcess.stdout.on).toHaveBeenCalledWith('data', expect.any(Function));
    });

    test('sets up stderr handler', async () => {
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        pid: 12345
      };
      spawn.mockReturnValue(mockProcess);

      await chromaService.startChromaDB({
        serviceStatus,
        errors,
        chromadbDependencyMissing: false,
        cachedChromaSpawnPlan: null,
        setCachedSpawnPlan: jest.fn()
      });

      expect(mockProcess.stderr.on).toHaveBeenCalledWith('data', expect.any(Function));
    });

    test('sets up error handler', async () => {
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        pid: 12345
      };
      spawn.mockReturnValue(mockProcess);

      await chromaService.startChromaDB({
        serviceStatus,
        errors,
        chromadbDependencyMissing: false,
        cachedChromaSpawnPlan: null,
        setCachedSpawnPlan: jest.fn()
      });

      expect(mockProcess.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    test('sets up exit handler that updates status', async () => {
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        pid: 12345
      };
      spawn.mockReturnValue(mockProcess);

      await chromaService.startChromaDB({
        serviceStatus,
        errors,
        chromadbDependencyMissing: false,
        cachedChromaSpawnPlan: null,
        setCachedSpawnPlan: jest.fn()
      });

      // Find and call the exit handler
      const exitCall = mockProcess.on.mock.calls.find((call) => call[0] === 'exit');
      const exitHandler = exitCall[1];
      exitHandler(0, null);

      expect(serviceStatus.chromadb.status).toBe('stopped');
    });
  });
});
