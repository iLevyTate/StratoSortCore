/**
 * Tests for Preflight Checks
 * Tests pre-startup validation for system requirements
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

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/mock/userData')
  }
}));

// Mock fs
const mockFs = {
  access: jest.fn(),
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  unlink: jest.fn()
};
jest.mock('fs', () => ({
  promises: mockFs
}));

// Mock axios
jest.mock('axios', () => ({
  get: jest.fn()
}));

// Mock asyncSpawnUtils
jest.mock('../src/main/utils/asyncSpawnUtils', () => ({
  asyncSpawn: jest.fn()
}));

// Mock platformUtils
jest.mock('../src/shared/platformUtils', () => ({
  isWindows: false
}));

// Mock promiseUtils
jest.mock('../src/shared/promiseUtils', () => ({
  withTimeout: jest.fn((promise) => promise)
}));

describe('Preflight Checks', () => {
  let checkPythonInstallation;
  let checkOllamaInstallation;
  let isPortAvailable;
  let runPreflightChecks;
  let asyncSpawn;
  let axios;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Reset mock defaults
    mockFs.access.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.unlink.mockResolvedValue(undefined);

    asyncSpawn = require('../src/main/utils/asyncSpawnUtils').asyncSpawn;
    axios = require('axios');

    const module = require('../src/main/services/startup/preflightChecks');
    checkPythonInstallation = module.checkPythonInstallation;
    checkOllamaInstallation = module.checkOllamaInstallation;
    isPortAvailable = module.isPortAvailable;
    runPreflightChecks = module.runPreflightChecks;
  });

  describe('checkPythonInstallation', () => {
    test('returns installed when python3 is found', async () => {
      asyncSpawn.mockResolvedValueOnce({
        status: 0,
        stdout: 'Python 3.11.0',
        stderr: ''
      });

      const result = await checkPythonInstallation();

      expect(result.installed).toBe(true);
      expect(result.version).toContain('Python');
    });

    test('tries multiple python commands', async () => {
      asyncSpawn.mockRejectedValueOnce(new Error('Not found')).mockResolvedValueOnce({
        status: 0,
        stdout: 'Python 3.10.0',
        stderr: ''
      });

      const result = await checkPythonInstallation();

      expect(result.installed).toBe(true);
      expect(asyncSpawn).toHaveBeenCalledTimes(2);
    });

    test('returns not installed when all commands fail', async () => {
      asyncSpawn.mockRejectedValue(new Error('Not found'));

      const result = await checkPythonInstallation();

      expect(result.installed).toBe(false);
      expect(result.version).toBeNull();
    });

    test('handles non-zero exit status', async () => {
      asyncSpawn.mockResolvedValue({ status: 1, stdout: '', stderr: 'Error' });

      const result = await checkPythonInstallation();

      expect(result.installed).toBe(false);
    });
  });

  describe('checkOllamaInstallation', () => {
    test('returns installed when ollama is found', async () => {
      asyncSpawn.mockResolvedValueOnce({
        status: 0,
        stdout: 'ollama version 0.1.0',
        stderr: ''
      });

      const result = await checkOllamaInstallation();

      expect(result.installed).toBe(true);
      expect(result.version).toContain('ollama');
    });

    test('returns not installed on error', async () => {
      asyncSpawn.mockRejectedValueOnce(new Error('Not found'));

      const result = await checkOllamaInstallation();

      expect(result.installed).toBe(false);
      expect(result.version).toBeNull();
    });

    test('returns not installed on non-zero status', async () => {
      asyncSpawn.mockResolvedValueOnce({
        status: 127,
        stdout: '',
        stderr: 'command not found'
      });

      const result = await checkOllamaInstallation();

      expect(result.installed).toBe(false);
    });
  });

  describe('isPortAvailable', () => {
    test('returns true on ECONNREFUSED', async () => {
      const error = new Error('Connection refused');
      error.code = 'ECONNREFUSED';
      axios.get.mockRejectedValueOnce(error);

      const result = await isPortAvailable('127.0.0.1', 8000);

      expect(result).toBe(true);
    });

    test('returns false on ETIMEDOUT', async () => {
      const error = new Error('Timeout');
      error.code = 'ETIMEDOUT';
      axios.get.mockRejectedValueOnce(error);

      const result = await isPortAvailable('127.0.0.1', 8000);

      expect(result).toBe(false);
    });

    test('returns false when port responds', async () => {
      axios.get.mockResolvedValueOnce({ status: 200 });

      const result = await isPortAvailable('127.0.0.1', 8000);

      expect(result).toBe(false);
    });

    test('returns false on HTTP error response', async () => {
      const error = new Error('HTTP Error');
      error.response = { status: 500 };
      axios.get.mockRejectedValueOnce(error);

      const result = await isPortAvailable('127.0.0.1', 8000);

      expect(result).toBe(false);
    });

    test('returns false on ENOTFOUND', async () => {
      const error = new Error('DNS lookup failed');
      error.code = 'ENOTFOUND';
      axios.get.mockRejectedValueOnce(error);

      const result = await isPortAvailable('127.0.0.1', 8000);

      expect(result).toBe(false);
    });

    test('returns false on unknown error (conservative default)', async () => {
      // Unknown errors should not be treated as port availability
      const error = new Error('Unknown');
      error.code = 'UNKNOWN';
      axios.get.mockRejectedValueOnce(error);

      const result = await isPortAvailable('127.0.0.1', 8000);

      expect(result).toBe(false);
    });
  });

  describe('runPreflightChecks', () => {
    beforeEach(() => {
      // Default mocks for successful checks
      asyncSpawn.mockResolvedValue({
        status: 0,
        stdout: 'Python 3.11.0',
        stderr: ''
      });

      const connRefused = new Error('Connection refused');
      connRefused.code = 'ECONNREFUSED';
      axios.get.mockRejectedValue(connRefused);
    });

    test('runs all preflight checks', async () => {
      const reportProgress = jest.fn();
      const errors = [];

      const checks = await runPreflightChecks({ reportProgress, errors });

      expect(checks.length).toBeGreaterThanOrEqual(4);
      expect(reportProgress).toHaveBeenCalled();
    });

    test('checks data directory access', async () => {
      const reportProgress = jest.fn();
      const errors = [];

      const checks = await runPreflightChecks({ reportProgress, errors });

      const dataCheck = checks.find((c) => c.name === 'Data Directory');
      expect(dataCheck).toBeDefined();
      expect(dataCheck.status).toBe('ok');
    });

    test('creates data directory if not exists', async () => {
      mockFs.access.mockRejectedValueOnce(new Error('ENOENT'));

      const reportProgress = jest.fn();
      const errors = [];

      await runPreflightChecks({ reportProgress, errors });

      expect(mockFs.mkdir).toHaveBeenCalled();
    });

    test('reports data directory error', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      mockFs.mkdir.mockRejectedValue(new Error('Permission denied'));

      const reportProgress = jest.fn();
      const errors = [];

      const checks = await runPreflightChecks({ reportProgress, errors });

      const dataCheck = checks.find((c) => c.name === 'Data Directory');
      expect(dataCheck.status).toBe('fail');
      expect(errors.some((e) => e.critical)).toBe(true);
    });

    test('checks Python installation', async () => {
      asyncSpawn
        .mockResolvedValueOnce({
          status: 0,
          stdout: 'Python 3.11.0',
          stderr: ''
        })
        .mockResolvedValue({
          status: 0,
          stdout: 'ollama 0.1.0',
          stderr: ''
        });

      const reportProgress = jest.fn();
      const errors = [];

      const checks = await runPreflightChecks({ reportProgress, errors });

      const pythonCheck = checks.find((c) => c.name === 'Python Installation');
      expect(pythonCheck).toBeDefined();
    });

    test('reports missing Python as warning', async () => {
      asyncSpawn.mockRejectedValue(new Error('Not found'));

      const reportProgress = jest.fn();
      const errors = [];

      const checks = await runPreflightChecks({ reportProgress, errors });

      const pythonCheck = checks.find((c) => c.name === 'Python Installation');
      expect(pythonCheck.status).toBe('warn');
      expect(errors.some((e) => e.check === 'python')).toBe(true);
    });

    test('checks Ollama installation', async () => {
      asyncSpawn.mockResolvedValue({
        status: 0,
        stdout: 'ollama version 0.1.0',
        stderr: ''
      });

      const reportProgress = jest.fn();
      const errors = [];

      const checks = await runPreflightChecks({ reportProgress, errors });

      const ollamaCheck = checks.find((c) => c.name === 'Ollama Installation');
      expect(ollamaCheck).toBeDefined();
    });

    test('checks port availability', async () => {
      const connRefused = new Error('Connection refused');
      connRefused.code = 'ECONNREFUSED';
      axios.get.mockRejectedValue(connRefused);

      const reportProgress = jest.fn();
      const errors = [];

      const checks = await runPreflightChecks({ reportProgress, errors });

      const portCheck = checks.find((c) => c.name === 'Service Ports');
      expect(portCheck).toBeDefined();
      expect(portCheck.details).toBeDefined();
      expect(portCheck.details).toHaveProperty('chromaPort');
      expect(portCheck.details).toHaveProperty('ollamaPort');
    });

    test('checks disk space', async () => {
      const reportProgress = jest.fn();
      const errors = [];

      const checks = await runPreflightChecks({ reportProgress, errors });

      const diskCheck = checks.find((c) => c.name === 'Disk Space');
      expect(diskCheck).toBeDefined();
    });
  });
});
