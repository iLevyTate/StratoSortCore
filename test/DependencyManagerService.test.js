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
  createWriteStream: (...args) => mockCreateWriteStream(...args),
  unlink: jest.fn((_p, cb) => (typeof cb === 'function' ? cb(null) : undefined))
}));

// Mock ollamaDetection globally for all tests in this file
jest.mock('../src/main/utils/ollamaDetection', () => ({
  isOllamaInstalled: jest.fn().mockResolvedValue(true),
  getOllamaVersion: jest.fn().mockResolvedValue('0.1.0'),
  isOllamaRunning: jest.fn().mockResolvedValue(true),
  getInstalledModels: jest.fn().mockResolvedValue([])
}));

describe('DependencyManagerService', () => {
  let DependencyManagerService;
  let preflight;
  let asyncSpawnUtils;
  let ollamaService;
  // let chromaService;
  let childProcess;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    preflight = require('../src/main/services/startup/preflightChecks');
    asyncSpawnUtils = require('../src/main/utils/asyncSpawnUtils');
    ollamaService = require('../src/main/services/startup/ollamaService');
    // chromaService = require('../src/main/services/startup/chromaService');
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

    // Update asyncSpawnUtils mocks to match recent refactor
    asyncSpawnUtils.asyncSpawn.mockImplementation((cmd, args) => {
      if (cmd === 'ollama' && args.includes('--version')) {
        return Promise.resolve({ status: 0, stdout: 'ollama version 0.1.0' });
      }
      return Promise.resolve({ status: 0 });
    });

    const svc = new DependencyManagerService();
    // Re-mock getStatus to behave predictably if necessary, or just rely on proper mocks
    // The issue seems to be asyncSpawnUtils.hasPythonModuleAsync returns undefined sometimes or status mismatch
    // Actually, chromadb status comes from preflight or other checks.
    // In getStatus:
    // const chromadb = await checkChromaDBInstallation();
    // And checkChromaDBInstallation calls hasPythonModuleAsync.

    // Let's ensure hasPythonModuleAsync mock is solid.
    asyncSpawnUtils.hasPythonModuleAsync.mockResolvedValue(true);

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

  test('addProgressCallback supports multiple listeners and unsubscribe', async () => {
    const svc = new DependencyManagerService();
    const cb1 = jest.fn();
    const cb2 = jest.fn(() => {
      throw new Error('listener failed');
    });

    const unsub1 = svc.addProgressCallback(cb1);
    svc.addProgressCallback(cb2);

    // Should not throw even if one listener fails
    svc._emitProgress('msg', { stage: 'x' });
    expect(cb1).toHaveBeenCalledWith(expect.objectContaining({ message: 'msg', stage: 'x' }));

    unsub1();
    cb1.mockClear();
    svc._emitProgress('msg2');
    expect(cb1).not.toHaveBeenCalled();
  });

  test('installOllama downloads (follows redirect), runs installer, and spawns ollama serve', async () => {
    const ollamaDetection = require('../src/main/utils/ollamaDetection');
    ollamaDetection.isOllamaInstalled.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    ollamaDetection.getOllamaVersion.mockResolvedValue('0.2.0');
    ollamaDetection.isOllamaRunning.mockResolvedValue(true);

    // Redirect then 200
    const resHandlers1 = {};
    const res1 = {
      statusCode: 302,
      headers: { location: 'https://example.com/redirected.exe' },
      resume: jest.fn(),
      on: jest.fn((evt, cb) => {
        resHandlers1[evt] = cb;
      })
    };
    const resHandlers2 = {};
    const res2 = {
      statusCode: 200,
      headers: { 'content-length': '4' },
      on: jest.fn((evt, cb) => {
        resHandlers2[evt] = cb;
      }),
      destroy: jest.fn()
    };
    const req = { on: jest.fn() };
    mockHttpsGet.mockImplementation((url, cb) => {
      if (String(url).includes('OllamaSetup.exe')) {
        cb(res1);
        return req;
      }
      cb(res2);
      // simulate data/end
      resHandlers2.data?.(Buffer.from('ab'));
      resHandlers2.data?.(Buffer.from('cd'));
      resHandlers2.end?.();
      return req;
    });

    mockCreateWriteStream.mockReturnValue({
      write: jest.fn(),
      end: jest.fn((cb) => cb && cb()),
      destroy: jest.fn(),
      on: jest.fn()
    });

    // Installer succeeds, PATH detection succeeds (returns status 0)
    asyncSpawnUtils.asyncSpawn
      .mockResolvedValueOnce({ status: 0, stdout: '', stderr: '' }) // installer
      .mockResolvedValueOnce({ status: 0, stdout: 'ollama version 0.2.0', stderr: '' }); // detectOllamaExePath

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

  test('installOllama returns error when installer fails', async () => {
    const ollamaDetection = require('../src/main/utils/ollamaDetection');
    ollamaDetection.isOllamaInstalled.mockResolvedValueOnce(false);

    // Simple 200 download
    const resHandlers = {};
    const res = {
      statusCode: 200,
      headers: { 'content-length': '2' },
      on: jest.fn((evt, cb) => {
        resHandlers[evt] = cb;
      }),
      destroy: jest.fn()
    };
    const req = { on: jest.fn() };
    mockHttpsGet.mockImplementationOnce((_url, cb) => {
      cb(res);
      resHandlers.data?.(Buffer.from('ok'));
      resHandlers.end?.();
      return req;
    });
    mockCreateWriteStream.mockReturnValue({
      write: jest.fn(),
      end: jest.fn((cb) => cb && cb()),
      destroy: jest.fn(),
      on: jest.fn()
    });

    asyncSpawnUtils.asyncSpawn.mockResolvedValueOnce({ status: 1, stdout: '', stderr: 'fail' });

    const svc = new DependencyManagerService();
    const result = await svc.installOllama();
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('installer failed');
  });

  test('installChromaDb returns error when python launcher cannot be found', async () => {
    preflight.checkPythonInstallation.mockResolvedValue({
      installed: true,
      version: 'Python 3.12'
    });
    asyncSpawnUtils.findPythonLauncherAsync.mockResolvedValue(null);

    const svc = new DependencyManagerService();
    const result = await svc.installChromaDb();
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('Python launcher');
  });
});
