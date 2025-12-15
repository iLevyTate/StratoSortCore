/**
 * Background dependency setup tests
 *
 * Verifies first-run automation:
 * - Removes installer marker
 * - Installs Ollama + ChromaDB when missing
 * - Starts services best-effort
 * - Pulls configured models
 * - Writes dependency setup marker
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

// Mock electron (backgroundSetup imports app + BrowserWindow)
const mockSendSpy = jest.fn();
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn((name) => {
      if (name === 'userData') return '/test/userData';
      if (name === 'exe') return '/test/exe/StratoSort.exe';
      return '/test';
    })
  },
  BrowserWindow: {
    getAllWindows: jest.fn(() => [
      {
        isDestroyed: () => false,
        webContents: { send: mockSendSpy }
      }
    ])
  }
}));

// Mock dependency manager
const mockInstallOllamaSpy = jest.fn().mockResolvedValue({ success: true });
const mockInstallChromaSpy = jest.fn().mockResolvedValue({ success: true });
const mockGetStatusSpy = jest.fn().mockResolvedValue({
  platform: 'win32',
  python: { installed: true, version: 'Python 3.12.0' },
  chromadb: { pythonModuleInstalled: false, running: false },
  ollama: { installed: false, version: null, running: false }
});
const mockDependencyManagerInstance = {
  getStatus: mockGetStatusSpy,
  installOllama: mockInstallOllamaSpy,
  installChromaDb: mockInstallChromaSpy,
  updateOllama: jest.fn().mockResolvedValue({ success: true }),
  updateChromaDb: jest.fn().mockResolvedValue({ success: true }),
  _onProgress: jest.fn()
};
jest.mock('../src/main/services/DependencyManagerService', () => ({
  DependencyManagerService: jest.fn().mockImplementation(() => mockDependencyManagerInstance),
  // getInstance returns singleton - used by backgroundSetup
  getInstance: jest.fn().mockImplementation((options) => {
    if (options?.onProgress) {
      mockDependencyManagerInstance._onProgress = options.onProgress;
    }
    return mockDependencyManagerInstance;
  }),
  resetInstance: jest.fn()
}));

// Mock StartupManager
const mockStartOllamaSpy = jest.fn().mockResolvedValue({ success: true });
const mockStartChromaSpy = jest.fn().mockResolvedValue({ success: true });
const mockStartupManagerInstance = {
  startOllama: mockStartOllamaSpy,
  startChromaDB: mockStartChromaSpy,
  chromadbDependencyMissing: false // Added for flag clearing fix
};
jest.mock('../src/main/services/startup', () => ({
  getStartupManager: () => mockStartupManagerInstance
}));

// Mock SettingsService getService()
jest.mock('../src/main/services/SettingsService', () => ({
  getService: () => ({
    load: jest.fn().mockResolvedValue({
      textModel: 'llama3.2:latest',
      visionModel: 'llava:latest',
      embeddingModel: 'mxbai-embed-large',
      autoUpdateOllama: false,
      autoUpdateChromaDb: false
    })
  })
}));

// Mock ollama client
const mockPullSpy = jest.fn().mockImplementation(async ({ stream }) => {
  if (typeof stream === 'function') {
    stream({ completed: 1, total: 2 });
  }
});
jest.mock('../src/main/ollamaUtils', () => ({
  getOllama: () => ({
    pull: mockPullSpy
  })
}));

// Import after mocks so module under test uses our fakes
const { runBackgroundSetup } = require('../src/main/core/backgroundSetup');

describe('backgroundSetup automated dependencies', () => {
  const fs = require('fs').promises;

  beforeEach(async () => {
    jest.clearAllMocks();

    // memfs in this repo normalizes writeFile/rename/readFile, but NOT access/unlink.
    // backgroundSetup uses fs.access/unlink with platform paths, so normalize them here.
    const posixNormalize = (p) => {
      const cleaned = String(p).replace(/\\/g, '/');
      // Collapse any ".." segments so "/a/b/../c" resolves correctly in memfs.
      // Use posix normalization regardless of host OS.
      // eslint-disable-next-line global-require
      return require('path').posix.normalize(cleaned);
    };
    const originalAccess = fs.access.bind(fs);
    fs.access = async (p) => originalAccess(posixNormalize(p));
    const originalUnlink = fs.unlink.bind(fs);
    fs.unlink = async (p) => originalUnlink(posixNormalize(p));

    // Create installer marker to ensure it is cleaned up
    await fs.mkdir('/test/exe', { recursive: true });
    await fs.writeFile('/test/exe/first-run.marker', 'marker');
    await fs.mkdir('/test/userData', { recursive: true });
  });

  test('first run installs deps, starts services, pulls models, writes marker', async () => {
    await runBackgroundSetup();

    // Installer marker removed
    await expect(fs.access('/test/exe/first-run.marker')).rejects.toBeDefined();

    // Dependency setup marker written
    await expect(
      fs.readFile('/test/userData/dependency-setup-complete.marker', 'utf8')
    ).resolves.toBeDefined();

    // Install paths hit
    expect(mockGetStatusSpy).toHaveBeenCalled();
    expect(mockInstallOllamaSpy).toHaveBeenCalled();
    expect(mockInstallChromaSpy).toHaveBeenCalled();

    // Services started best-effort
    expect(mockStartOllamaSpy).toHaveBeenCalled();
    expect(mockStartChromaSpy).toHaveBeenCalled();

    // Models pulled (embedding model normalized to latest)
    const modelsPulled = mockPullSpy.mock.calls.map((c) => c[0]?.model);
    expect(modelsPulled).toEqual(
      expect.arrayContaining(['llama3.2:latest', 'llava:latest', 'mxbai-embed-large:latest'])
    );

    // Emits progress at least once
    expect(mockSendSpy).toHaveBeenCalled();
  });

  test('not first run skips automation', async () => {
    // Seed marker to indicate previous completion
    await fs.writeFile('/test/userData/dependency-setup-complete.marker', 'done');

    await runBackgroundSetup();

    expect(mockInstallOllamaSpy).not.toHaveBeenCalled();
    expect(mockInstallChromaSpy).not.toHaveBeenCalled();
    expect(mockPullSpy).not.toHaveBeenCalled();
  });
});
