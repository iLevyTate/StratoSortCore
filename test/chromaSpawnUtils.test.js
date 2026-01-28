/**
 * Tests for chromaSpawnUtils
 * Tests ChromaDB executable resolution and spawn plan building
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

// Mock fs.promises
const mockFs = {
  access: jest.fn(),
  realpath: jest.fn((p) => Promise.resolve(p))
};
jest.mock('fs', () => ({
  promises: mockFs
}));

// Mock asyncSpawnUtils
jest.mock('../src/main/utils/asyncSpawnUtils', () => ({
  asyncSpawn: jest.fn(),
  findPythonLauncherAsync: jest.fn(),
  checkChromaExecutableAsync: jest.fn()
}));

// Mock platformUtils
jest.mock('../src/shared/platformUtils', () => ({
  getChromaDbBinCandidates: jest.fn().mockReturnValue(['chromadb']),
  getChromaDbBinName: jest.fn().mockReturnValue('chromadb')
}));

describe('chromaSpawnUtils', () => {
  let chromaSpawnUtils;
  let asyncSpawnUtils;
  let platformUtils;

  const defaultConfig = {
    dbPath: '/data/chroma',
    host: 'localhost',
    port: 8000
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Reset environment
    delete process.env.CHROMA_SERVER_COMMAND;

    asyncSpawnUtils = require('../src/main/utils/asyncSpawnUtils');
    platformUtils = require('../src/shared/platformUtils');
    chromaSpawnUtils = require('../src/main/utils/chromaSpawnUtils');

    // Default: python scripts dir resolution returns empty, so existing tests behave the same
    asyncSpawnUtils.asyncSpawn.mockResolvedValue({
      status: 0,
      stdout: '',
      stderr: ''
    });
  });

  describe('resolveChromaCliExecutable', () => {
    test('returns path when local CLI exists', async () => {
      mockFs.access.mockResolvedValue(undefined);

      const result = await chromaSpawnUtils.resolveChromaCliExecutable();

      expect(result).toContain('node_modules');
      expect(result).toContain('chromadb');
    });

    test('returns null when local CLI does not exist', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));

      const result = await chromaSpawnUtils.resolveChromaCliExecutable();

      expect(result).toBeNull();
    });

    test('uses platform-specific binary name', async () => {
      platformUtils.getChromaDbBinCandidates.mockReturnValue(['chroma.cmd']);
      mockFs.access.mockResolvedValue(undefined);

      const result = await chromaSpawnUtils.resolveChromaCliExecutable();

      expect(result).toContain('chroma.cmd');
    });
  });

  describe('buildChromaSpawnPlan', () => {
    test('uses custom command from environment variable', async () => {
      process.env.CHROMA_SERVER_COMMAND = '/custom/chroma run --port 9000';

      const result = await chromaSpawnUtils.buildChromaSpawnPlan(defaultConfig);

      expect(result.command).toBe('/custom/chroma');
      expect(result.args).toContain('run');
      expect(result.args).toContain('--port');
      expect(result.args).toContain('9000');
      expect(result.source).toBe('custom-command');
    });

    test('handles quoted arguments in custom command', async () => {
      process.env.CHROMA_SERVER_COMMAND = 'chroma run --path "/path with spaces/db"';

      const result = await chromaSpawnUtils.buildChromaSpawnPlan(defaultConfig);

      expect(result.command).toBe('chroma');
      expect(result.args).toContain('/path with spaces/db');
    });

    test('uses local CLI when available', async () => {
      mockFs.access.mockResolvedValue(undefined);

      const result = await chromaSpawnUtils.buildChromaSpawnPlan(defaultConfig);

      expect(result.source).toBe('local-cli');
      expect(result.args).toContain('run');
      expect(result.args).toContain('--path');
      expect(result.args).toContain('/data/chroma');
      expect(result.args).toContain('--host');
      expect(result.args).toContain('localhost');
      expect(result.args).toContain('--port');
      expect(result.args).toContain('8000');
    });

    test('falls back to system chroma when local CLI not found', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      asyncSpawnUtils.checkChromaExecutableAsync.mockResolvedValue(true);

      const result = await chromaSpawnUtils.buildChromaSpawnPlan(defaultConfig);

      expect(result.source).toBe('system-chroma');
      expect(result.command).toBe('chroma');
    });

    test('uses chroma from Python scripts directory when pip --user is used (Windows)', async () => {
      // Force Windows exe naming
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'win32' });

      // Local CLI not found
      mockFs.access.mockImplementation(async (p) => {
        // Succeed only for the python-scripts chroma exe
        const s = String(p);
        if (s.toLowerCase().includes('python') && s.toLowerCase().endsWith('chroma.exe'))
          return undefined;
        throw new Error('ENOENT');
      });

      asyncSpawnUtils.findPythonLauncherAsync.mockResolvedValue({ command: 'py', args: ['-3'] });
      asyncSpawnUtils.asyncSpawn.mockResolvedValue({
        status: 0,
        stdout: '/python/scripts\n',
        stderr: ''
      });

      asyncSpawnUtils.checkChromaExecutableAsync.mockResolvedValue(false);

      const result = await chromaSpawnUtils.buildChromaSpawnPlan(defaultConfig);

      expect(result.source).toBe('python-scripts-chroma');
      expect(result.command.toLowerCase()).toContain('chroma.exe');

      // Restore process.platform
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
    });

    test('tries multiple Python script directories (sysconfig + userbase) when resolving chroma (Windows)', async () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'win32' });

      // Local CLI not found, and chroma not on PATH
      mockFs.access.mockImplementation(async (p) => {
        const s = String(p).toLowerCase();
        // Only userbase path contains chroma.exe
        if (s.includes('userbase') && s.endsWith('chroma.exe')) return undefined;
        throw new Error('ENOENT');
      });

      asyncSpawnUtils.findPythonLauncherAsync.mockResolvedValue({ command: 'py', args: ['-3'] });
      asyncSpawnUtils.asyncSpawn.mockResolvedValue({
        status: 0,
        stdout: 'C:\\WindowsApps\\Scripts\r\nC:\\UserBase\\Scripts\r\n',
        stderr: ''
      });
      asyncSpawnUtils.checkChromaExecutableAsync.mockResolvedValue(false);

      const result = await chromaSpawnUtils.buildChromaSpawnPlan(defaultConfig);

      expect(result.source).toBe('python-scripts-chroma');
      expect(result.command.toLowerCase()).toContain('userbase');
      expect(result.command.toLowerCase()).toContain('chroma.exe');

      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
    });

    test('defaults to no shell for system chroma', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      asyncSpawnUtils.checkChromaExecutableAsync.mockResolvedValue(true);

      const result = await chromaSpawnUtils.buildChromaSpawnPlan(defaultConfig);

      expect(result.options.shell).toBe(false);
    });

    test('returns null when no launch method available', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      asyncSpawnUtils.checkChromaExecutableAsync.mockResolvedValue(false);
      asyncSpawnUtils.findPythonLauncherAsync.mockResolvedValue(null);

      const result = await chromaSpawnUtils.buildChromaSpawnPlan(defaultConfig);

      expect(result).toBeNull();
    });

    test('passes config values to spawn args', async () => {
      mockFs.access.mockResolvedValue(undefined);

      const customConfig = {
        dbPath: '/custom/path',
        host: '0.0.0.0',
        port: 9999
      };

      const result = await chromaSpawnUtils.buildChromaSpawnPlan(customConfig);

      expect(result.args).toContain('/custom/path');
      expect(result.args).toContain('0.0.0.0');
      expect(result.args).toContain('9999');
    });

    test('converts port to string', async () => {
      mockFs.access.mockResolvedValue(undefined);

      const result = await chromaSpawnUtils.buildChromaSpawnPlan({
        ...defaultConfig,
        port: 8080
      });

      const portIndex = result.args.indexOf('--port');
      expect(result.args[portIndex + 1]).toBe('8080');
      expect(typeof result.args[portIndex + 1]).toBe('string');
    });

    test('includes windowsHide option', async () => {
      mockFs.access.mockResolvedValue(undefined);

      const result = await chromaSpawnUtils.buildChromaSpawnPlan(defaultConfig);

      expect(result.options.windowsHide).toBe(true);
    });
  });

  describe('findPythonLauncher', () => {
    test('delegates to async version', async () => {
      asyncSpawnUtils.findPythonLauncherAsync.mockResolvedValue({
        command: 'python3',
        args: []
      });

      const result = await chromaSpawnUtils.findPythonLauncher();

      expect(asyncSpawnUtils.findPythonLauncherAsync).toHaveBeenCalled();
      expect(result.command).toBe('python3');
    });
  });

  describe('splitCommandLine', () => {
    // Test via buildChromaSpawnPlan since splitCommandLine is not exported
    test('handles empty command', async () => {
      process.env.CHROMA_SERVER_COMMAND = '';

      const result = await chromaSpawnUtils.buildChromaSpawnPlan(defaultConfig);

      // Should fall through to other methods
      expect(result.source).not.toBe('custom-command');
    });

    test('handles command with multiple spaces', async () => {
      process.env.CHROMA_SERVER_COMMAND = 'chroma   run   --port   8000';

      const result = await chromaSpawnUtils.buildChromaSpawnPlan(defaultConfig);

      expect(result.command).toBe('chroma');
      expect(result.args).toContain('run');
    });
  });
});
