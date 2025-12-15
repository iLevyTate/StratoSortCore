/**
 * DependencyManagerService tests (Windows-focused)
 *
 * Covers: getStatus, installOllama (happy path + failure), installChromaDb (python missing, pip args).
 */

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Force Windows behavior via platform utils
jest.mock('../src/shared/platformUtils', () => ({
  isWindows: true,
  shouldUseShell: jest.fn().mockReturnValue(false)
}));

// Mock preflight checks used for status
jest.mock('../src/main/services/startup/preflightChecks', () => ({
  checkPythonInstallation: jest.fn(),
  checkOllamaInstallation: jest.fn()
}));

jest.mock('../src/main/services/startup/ollamaService', () => ({
  isOllamaRunning: jest.fn()
}));

jest.mock('../src/main/services/startup/chromaService', () => ({
  isChromaDBRunning: jest.fn()
}));

jest.mock('../src/main/utils/asyncSpawnUtils', () => ({
  asyncSpawn: jest.fn(),
  hasPythonModuleAsync: jest.fn(),
  findPythonLauncherAsync: jest.fn()
}));

jest.mock('child_process', () => ({
  spawn: jest.fn().mockReturnValue({ unref: jest.fn() })
}));

// The service's downloadToFile uses require('https') and require('fs') dynamically.
// Provide mocks for https.get and fs.createWriteStream + fs.promises.
const mockHttpsGet = jest.fn();
jest.mock('https', () => ({
  get: (...args) => mockHttpsGet(...args)
}));

const mockFsPromises = {
  mkdir: jest.fn().mockResolvedValue(undefined),
  access: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined)
};
const mockCreateWriteStream = jest.fn();
jest.mock('fs', () => ({
  promises: mockFsPromises,
  createWriteStream: (...args) => mockCreateWriteStream(...args)
}));

describe('DependencyManagerService', () => {
  let DependencyManagerService;
  let preflight;
  let asyncSpawnUtils;
  let ollamaService;
  let chromaService;
  let childProcess;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    preflight = require('../src/main/services/startup/preflightChecks');
    asyncSpawnUtils = require('../src/main/utils/asyncSpawnUtils');
    ollamaService = require('../src/main/services/startup/ollamaService');
    chromaService = require('../src/main/services/startup/chromaService');
    childProcess = require('child_process');

    // Re-require after resetModules so it picks up mocks.
    DependencyManagerService =
      require('../src/main/services/DependencyManagerService').DependencyManagerService;
  });

  test('getStatus aggregates python/ollama/chromadb status', async () => {
    preflight.checkPythonInstallation.mockResolvedValue({
      installed: true,
      version: 'Python 3.12'
    });
    preflight.checkOllamaInstallation.mockResolvedValue({ installed: true, version: '0.1.0' });
    asyncSpawnUtils.hasPythonModuleAsync.mockResolvedValue(true);
    ollamaService.isOllamaRunning.mockResolvedValue(true);
    chromaService.isChromaDBRunning.mockResolvedValue(false);

    const svc = new DependencyManagerService();
    const status = await svc.getStatus();

    expect(status.python.installed).toBe(true);
    expect(status.ollama.installed).toBe(true);
    expect(status.chromadb.pythonModuleInstalled).toBe(true);
    expect(status.ollama.running).toBe(true);
    expect(status.chromadb.running).toBe(false);
  });

  test('installChromaDb returns error when Python is missing', async () => {
    preflight.checkPythonInstallation.mockResolvedValue({ installed: false, version: null });

    const svc = new DependencyManagerService();
    const result = await svc.installChromaDb();

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('Python 3 is required');
  });

  test('installChromaDb runs pip install with --user and --upgrade when requested', async () => {
    preflight.checkPythonInstallation.mockResolvedValue({
      installed: true,
      version: 'Python 3.12'
    });
    asyncSpawnUtils.findPythonLauncherAsync.mockResolvedValue({ command: 'py', args: ['-3'] });

    // First call is pip upgrade (best-effort), second is chromadb install
    asyncSpawnUtils.asyncSpawn.mockResolvedValueOnce({ status: 0 }).mockResolvedValueOnce({
      status: 0,
      stdout: '',
      stderr: ''
    });
    asyncSpawnUtils.hasPythonModuleAsync.mockResolvedValue(true);

    const svc = new DependencyManagerService();
    const result = await svc.installChromaDb({ upgrade: true, userInstall: true });

    expect(result.success).toBe(true);
    const installCall = asyncSpawnUtils.asyncSpawn.mock.calls.find((c) =>
      Array.isArray(c[1]) ? c[1].includes('chromadb') : false
    );
    expect(installCall).toBeDefined();
    const args = installCall[1];
    expect(args).toEqual(
      expect.arrayContaining(['-m', 'pip', 'install', '--upgrade', '--user', 'chromadb'])
    );
  });

  test('installOllama short-circuits when already installed', async () => {
    preflight.checkOllamaInstallation.mockResolvedValue({ installed: true, version: '0.1.0' });

    const svc = new DependencyManagerService();
    const result = await svc.installOllama();

    expect(result.success).toBe(true);
    expect(result.alreadyInstalled).toBe(true);
  });

  test('installOllama downloads installer, runs silent install, and attempts to spawn ollama serve', async () => {
    preflight.checkOllamaInstallation
      .mockResolvedValueOnce({ installed: false, version: null }) // pre
      .mockResolvedValueOnce({ installed: true, version: '0.2.0' }); // post

    // Mock https download: emit 2 chunks then end.
    const resHandlers = {};
    const res = {
      statusCode: 200,
      headers: { 'content-length': '4' },
      on: jest.fn((evt, cb) => {
        resHandlers[evt] = cb;
      })
    };
    const req = { on: jest.fn() };
    mockHttpsGet.mockImplementation((_url, cb) => {
      cb(res);
      // simulate data/end asynchronously-ish
      resHandlers.data?.(Buffer.from('ab'));
      resHandlers.data?.(Buffer.from('cd'));
      resHandlers.end?.();
      return req;
    });

    // Mock file stream with event handler support for error handling
    mockCreateWriteStream.mockReturnValue({
      write: jest.fn(),
      end: jest.fn((cb) => cb && cb()),
      close: jest.fn(),
      destroy: jest.fn(),
      on: jest.fn()
    });

    asyncSpawnUtils.asyncSpawn
      // installer run succeeds
      .mockResolvedValueOnce({ status: 0, stdout: '', stderr: '' })
      // detectOllamaExePath PATH check: `ollama --version` fails so fallback to file paths
      .mockResolvedValueOnce({ status: 1, stdout: '', stderr: 'not found' });

    // Make fileExists checks succeed for the default Program Files candidate by faking fs.access
    mockFsPromises.access.mockResolvedValue(undefined);

    // Ollama health flips quickly
    ollamaService.isOllamaRunning.mockResolvedValue(true);

    const onProgress = jest.fn();
    const svc = new DependencyManagerService({ onProgress });
    const result = await svc.installOllama();

    expect(result.success).toBe(true);
    expect(asyncSpawnUtils.asyncSpawn).toHaveBeenCalledWith(
      expect.stringContaining('OllamaSetup.exe'),
      ['/S'],
      expect.objectContaining({ shell: false })
    );
    expect(childProcess.spawn).toHaveBeenCalledWith(
      expect.any(String),
      ['serve'],
      expect.objectContaining({ stdio: 'ignore' })
    );
    expect(onProgress).toHaveBeenCalled();
  });
});
