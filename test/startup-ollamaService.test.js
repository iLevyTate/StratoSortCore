/**
 * Tests for Ollama Service Startup
 * Tests Ollama startup and health checking functions
 */

// Mock dependencies
jest.mock('child_process', () => ({
  spawn: jest.fn().mockReturnValue({
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    on: jest.fn(),
    kill: jest.fn(),
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

jest.mock('../src/main/utils/ollamaApiRetry', () => {
  const actual = jest.requireActual('../src/main/utils/ollamaApiRetry');
  return {
    ...actual,
    axiosWithRetry: jest.fn(),
    // checkOllamaHealth uses axios which is mocked, so use actual implementation
    checkOllamaHealth: actual.checkOllamaHealth
  };
});

jest.mock('../src/shared/performanceConstants', () => ({
  TIMEOUTS: {
    DELAY_MEDIUM: 100
  }
}));

jest.mock('../src/main/services/PerformanceService', () => ({
  getRecommendedEnvSettings: jest.fn().mockResolvedValue({
    recommendations: {
      OLLAMA_MAX_LOADED_MODELS: '1',
      OLLAMA_NUM_PARALLEL: '1',
      OLLAMA_KEEP_ALIVE: '10m'
    }
  })
}));

describe('ollamaService', () => {
  let ollamaService;
  let axios;
  let axiosWithRetry;
  let spawn;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Reset environment
    delete process.env.OLLAMA_BASE_URL;

    axios = require('axios');
    axiosWithRetry = require('../src/main/utils/ollamaApiRetry').axiosWithRetry;
    spawn = require('child_process').spawn;

    ollamaService = require('../src/main/services/startup/ollamaService');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('checkOllamaHealth', () => {
    test('returns true when API responds 200', async () => {
      axios.get.mockResolvedValue({ status: 200 });

      const result = await ollamaService.checkOllamaHealth();

      expect(result).toBe(true);
    });

    test('returns false when API fails', async () => {
      axios.get.mockRejectedValue(new Error('Connection failed'));

      const result = await ollamaService.checkOllamaHealth();

      expect(result).toBe(false);
    });

    test('uses default URL when env not set', async () => {
      axios.get.mockResolvedValue({ status: 200 });

      await ollamaService.checkOllamaHealth();

      expect(axios.get).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags', expect.any(Object));
    });

    test('uses OLLAMA_BASE_URL when set', async () => {
      process.env.OLLAMA_BASE_URL = 'http://custom:8080';

      // Re-mock axios after resetModules
      jest.resetModules();
      const freshAxios = require('axios');
      freshAxios.get = jest.fn().mockResolvedValue({ status: 200 });
      const freshModule = require('../src/main/services/startup/ollamaService');

      await freshModule.checkOllamaHealth();

      expect(freshAxios.get).toHaveBeenCalledWith(
        'http://custom:8080/api/tags',
        expect.any(Object)
      );
    });

    test('returns false on non-200 status', async () => {
      axios.get.mockResolvedValue({ status: 500 });

      const result = await ollamaService.checkOllamaHealth();

      expect(result).toBe(false);
    });

    test('uses 2000ms timeout', async () => {
      axios.get.mockResolvedValue({ status: 200 });

      await ollamaService.checkOllamaHealth();

      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ timeout: 2000 })
      );
    });
  });

  describe('isOllamaRunning', () => {
    test('returns true when API responds 200', async () => {
      axiosWithRetry.mockResolvedValue({ status: 200 });

      const result = await ollamaService.isOllamaRunning();

      expect(result).toBe(true);
    });

    test('returns false when API fails', async () => {
      axiosWithRetry.mockRejectedValue(new Error('Connection failed'));

      const result = await ollamaService.isOllamaRunning();

      expect(result).toBe(false);
    });

    test('uses retry logic', async () => {
      axiosWithRetry.mockResolvedValue({ status: 200 });

      await ollamaService.isOllamaRunning();

      expect(axiosWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          maxRetries: 2,
          initialDelay: 500,
          maxDelay: 2000
        })
      );
    });
  });

  describe('startOllama', () => {
    let serviceStatus;

    beforeEach(() => {
      serviceStatus = {
        ollama: { status: 'stopped', health: 'unknown' }
      };
    });

    test('returns external: true when Ollama already running', async () => {
      // FIX: Implementation checks for response.data.models array to verify it's actually Ollama
      axios.get.mockResolvedValue({ status: 200, data: { models: [] } });

      const result = await ollamaService.startOllama({ serviceStatus });

      expect(result.external).toBe(true);
      expect(result.process).toBeNull();
    });

    test('spawns Ollama when not already running', async () => {
      axios.get.mockRejectedValue({ code: 'ECONNREFUSED' });

      const promise = ollamaService.startOllama({ serviceStatus });

      await jest.advanceTimersByTimeAsync(200);

      const result = await promise;

      expect(spawn).toHaveBeenCalledWith(
        'ollama',
        ['serve'],
        expect.objectContaining({
          detached: false,
          stdio: 'pipe'
        })
      );
      expect(result.process).toBeDefined();
    });

    test('handles pre-check errors gracefully', async () => {
      const error = new Error('Network error');
      error.code = 'ENETUNREACH';
      axios.get.mockRejectedValue(error);

      const promise = ollamaService.startOllama({ serviceStatus });

      await jest.advanceTimersByTimeAsync(200);

      const result = await promise;

      expect(result.process).toBeDefined();
    });

    test('sets up stdout handler', async () => {
      axios.get.mockRejectedValue({ code: 'ECONNREFUSED' });

      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
        pid: 12345
      };
      spawn.mockReturnValue(mockProcess);

      const promise = ollamaService.startOllama({ serviceStatus });

      await jest.advanceTimersByTimeAsync(200);

      await promise;

      expect(mockProcess.stdout.on).toHaveBeenCalledWith('data', expect.any(Function));
    });

    test('sets up stderr handler', async () => {
      axios.get.mockRejectedValue({ code: 'ECONNREFUSED' });

      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
        pid: 12345
      };
      spawn.mockReturnValue(mockProcess);

      const promise = ollamaService.startOllama({ serviceStatus });

      await jest.advanceTimersByTimeAsync(200);

      await promise;

      expect(mockProcess.stderr.on).toHaveBeenCalledWith('data', expect.any(Function));
    });

    test('detects port-in-use error and returns external', async () => {
      axios.get.mockRejectedValue({ code: 'ECONNREFUSED' });

      let stderrHandler;
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: {
          on: jest.fn((event, cb) => {
            if (event === 'data') stderrHandler = cb;
          })
        },
        on: jest.fn(),
        kill: jest.fn(),
        pid: 12345
      };
      spawn.mockReturnValue(mockProcess);

      const promise = ollamaService.startOllama({ serviceStatus });

      // Wait for async flow to reach spawn and attach handlers
      await jest.advanceTimersByTimeAsync(0);

      // Simulate port-in-use error message
      stderrHandler(Buffer.from('address already in use'));

      await jest.advanceTimersByTimeAsync(200);

      const result = await promise;

      expect(result.external).toBe(true);
      expect(result.portInUse).toBe(true);
      expect(mockProcess.kill).toHaveBeenCalled();
    });

    test('detects Windows socket binding error', async () => {
      axios.get.mockRejectedValue({ code: 'ECONNREFUSED' });

      let stderrHandler;
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: {
          on: jest.fn((event, cb) => {
            if (event === 'data') stderrHandler = cb;
          })
        },
        on: jest.fn(),
        kill: jest.fn(),
        pid: 12345
      };
      spawn.mockReturnValue(mockProcess);

      const promise = ollamaService.startOllama({ serviceStatus });

      // Wait for async flow to reach spawn and attach handlers
      await jest.advanceTimersByTimeAsync(0);

      stderrHandler(Buffer.from('bind: Only one usage of each socket address'));

      await jest.advanceTimersByTimeAsync(200);

      const result = await promise;

      expect(result.portInUse).toBe(true);
    });

    test('detects listen tcp port error', async () => {
      axios.get.mockRejectedValue({ code: 'ECONNREFUSED' });

      let stderrHandler;
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: {
          on: jest.fn((event, cb) => {
            if (event === 'data') stderrHandler = cb;
          })
        },
        on: jest.fn(),
        kill: jest.fn(),
        pid: 12345
      };
      spawn.mockReturnValue(mockProcess);

      const promise = ollamaService.startOllama({ serviceStatus });

      // Wait for async flow to reach spawn and attach handlers
      await jest.advanceTimersByTimeAsync(0);

      stderrHandler(Buffer.from('listen tcp 127.0.0.1:11434'));

      await jest.advanceTimersByTimeAsync(200);

      const result = await promise;

      expect(result.portInUse).toBe(true);
    });

    test('sets up error handler', async () => {
      axios.get.mockRejectedValue({ code: 'ECONNREFUSED' });

      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
        pid: 12345
      };
      spawn.mockReturnValue(mockProcess);

      const promise = ollamaService.startOllama({ serviceStatus });

      await jest.advanceTimersByTimeAsync(200);

      await promise;

      expect(mockProcess.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    test('throws on startup error', async () => {
      axios.get.mockRejectedValue({ code: 'ECONNREFUSED' });

      let errorHandler;
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
          if (event === 'error') errorHandler = cb;
        }),
        kill: jest.fn(),
        pid: 12345
      };
      spawn.mockReturnValue(mockProcess);

      const promise = ollamaService.startOllama({ serviceStatus });

      // Wait for async flow to reach spawn and attach handlers
      await jest.advanceTimersByTimeAsync(0);

      // Trigger error handler
      errorHandler(new Error('spawn failed'));

      // Advance time to let the error propagate
      jest.advanceTimersByTime(200);

      // Verify promise rejects with the correct error
      await expect(promise).rejects.toThrow('Failed to start Ollama');
    });

    test('sets up exit handler that updates status', async () => {
      axios.get.mockRejectedValue({ code: 'ECONNREFUSED' });

      let exitHandler;
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
          if (event === 'exit') exitHandler = cb;
        }),
        kill: jest.fn(),
        pid: 12345
      };
      spawn.mockReturnValue(mockProcess);

      const promise = ollamaService.startOllama({ serviceStatus });

      await jest.advanceTimersByTimeAsync(200);

      await promise;

      // Simulate exit
      exitHandler(0, null);

      expect(serviceStatus.ollama.status).toBe('stopped');
    });

    // FIX M1: Tests for cleanup function return
    test('returns cleanup function on successful startup', async () => {
      axios.get.mockRejectedValue({ code: 'ECONNREFUSED' });

      const mockProcess = {
        stdout: { on: jest.fn(), removeListener: jest.fn() },
        stderr: { on: jest.fn(), removeListener: jest.fn() },
        on: jest.fn(),
        removeListener: jest.fn(),
        kill: jest.fn(),
        pid: 12345
      };
      spawn.mockReturnValue(mockProcess);

      const promise = ollamaService.startOllama({ serviceStatus });

      await jest.advanceTimersByTimeAsync(200);

      const result = await promise;

      // Verify cleanup function is returned
      expect(result.cleanup).toBeDefined();
      expect(typeof result.cleanup).toBe('function');
    });

    test('cleanup function removes all event listeners', async () => {
      axios.get.mockRejectedValue({ code: 'ECONNREFUSED' });

      const mockProcess = {
        stdout: { on: jest.fn(), removeListener: jest.fn() },
        stderr: { on: jest.fn(), removeListener: jest.fn() },
        on: jest.fn(),
        removeListener: jest.fn(),
        kill: jest.fn(),
        pid: 12345
      };
      spawn.mockReturnValue(mockProcess);

      const promise = ollamaService.startOllama({ serviceStatus });

      await jest.advanceTimersByTimeAsync(200);

      const result = await promise;

      // Call cleanup
      result.cleanup();

      // Verify all listeners were removed
      expect(mockProcess.stdout.removeListener).toHaveBeenCalledWith('data', expect.any(Function));
      expect(mockProcess.stderr.removeListener).toHaveBeenCalledWith('data', expect.any(Function));
      expect(mockProcess.removeListener).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockProcess.removeListener).toHaveBeenCalledWith('exit', expect.any(Function));
    });

    test('cleanup is called on PORT_IN_USE before returning', async () => {
      axios.get.mockRejectedValue({ code: 'ECONNREFUSED' });

      let stderrHandler;
      const mockProcess = {
        stdout: { on: jest.fn(), removeListener: jest.fn() },
        stderr: {
          on: jest.fn((event, cb) => {
            if (event === 'data') stderrHandler = cb;
          }),
          removeListener: jest.fn()
        },
        on: jest.fn(),
        removeListener: jest.fn(),
        kill: jest.fn(),
        pid: 12345
      };
      spawn.mockReturnValue(mockProcess);

      const promise = ollamaService.startOllama({ serviceStatus });

      await jest.advanceTimersByTimeAsync(0);

      // Trigger port in use
      stderrHandler(Buffer.from('address already in use'));

      await jest.advanceTimersByTimeAsync(200);

      const result = await promise;

      expect(result.portInUse).toBe(true);
      // Cleanup should have been called before returning
      expect(mockProcess.stdout.removeListener).toHaveBeenCalled();
      expect(mockProcess.stderr.removeListener).toHaveBeenCalled();
    });

    test('no cleanup function returned for external Ollama', async () => {
      // Ollama already running
      // FIX: Implementation checks for response.data.models array to verify it's actually Ollama
      axios.get.mockResolvedValue({ status: 200, data: { models: [] } });

      const result = await ollamaService.startOllama({ serviceStatus });

      expect(result.external).toBe(true);
      expect(result.cleanup).toBeUndefined();
    });
  });
});
