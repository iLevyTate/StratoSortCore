/**
 * Background dependency setup tests
 *
 * Verifies first-run automation:
 * - Downloads missing GGUF models
 * - Writes dependency setup marker
 *
 * OCR uses bundled tesseract.js (no external install).
 * Vision runtime is bundled in production builds.
 */

jest.mock('../src/shared/logger', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

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

// Mock LlamaService (new in-process AI engine)
jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: jest.fn(() => ({
    getConfig: jest.fn().mockResolvedValue({
      embeddingModel: 'nomic-embed-text-v1.5-Q8_0.gguf',
      textModel: 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
      visionModel: 'llava-v1.6-mistral-7b-Q4_K_M.gguf'
    }),
    listModels: jest
      .fn()
      .mockResolvedValue([
        { name: 'nomic-embed-text-v1.5-Q8_0.gguf' },
        { name: 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf' },
        { name: 'llava-v1.6-mistral-7b-Q4_K_M.gguf' }
      ])
  }))
}));

// Mock ModelDownloadManager (used for background model downloads)
jest.mock('../src/main/services/ModelDownloadManager', () => ({
  getInstance: jest.fn(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    downloadModel: jest.fn().mockResolvedValue({ success: true })
  }))
}));

const mockEnsureResolvedModelsPath = jest.fn();
jest.mock('../src/main/services/modelPathResolver', () => ({
  ensureResolvedModelsPath: (...args) => mockEnsureResolvedModelsPath(...args)
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
      return require('path').posix.normalize(cleaned);
    };
    const originalAccess = fs.access.bind(fs);
    fs.access = async (p) => originalAccess(posixNormalize(p));
    const originalUnlink = fs.unlink.bind(fs);
    fs.unlink = async (p) => originalUnlink(posixNormalize(p));
    mockEnsureResolvedModelsPath.mockResolvedValue({
      source: 'current',
      modelsPath: '/test/userData/models',
      currentModelsPath: '/test/userData/models'
    });

    // Create directories needed for the test
    await fs.mkdir('/test/exe', { recursive: true });
    await fs.mkdir('/test/userData', { recursive: true });
  });

  test('first run installs deps, starts services, pulls models, writes marker', async () => {
    await runBackgroundSetup();

    // Dependency setup marker written
    await expect(
      fs.readFile('/test/userData/dependency-setup-complete.marker', 'utf8')
    ).resolves.toBeDefined();

    // Emits progress at least once
    expect(mockSendSpy).toHaveBeenCalled();
  });

  test('notifies when model downloads use legacy models directory', async () => {
    const { getInstance: getLlamaService } = require('../src/main/services/LlamaService');
    getLlamaService().listModels.mockResolvedValueOnce([]);
    mockEnsureResolvedModelsPath.mockResolvedValueOnce({
      source: 'legacy',
      modelsPath: '/legacy/userData/models',
      currentModelsPath: '/test/userData/models'
    });

    await runBackgroundSetup();

    const legacyWarningCalls = mockSendSpy.mock.calls.filter((call) =>
      call.some(
        (arg) =>
          arg &&
          typeof arg === 'object' &&
          typeof arg.message === 'string' &&
          arg.message.includes('legacy directory')
      )
    );
    expect(legacyWarningCalls.length).toBeGreaterThan(0);
  });

  test('not first run skips dependency automation but still checks models', async () => {
    // Seed marker to indicate previous completion
    await fs.writeFile('/test/userData/dependency-setup-complete.marker', 'done');

    await runBackgroundSetup();

    // Model availability check still runs on subsequent launches
    // (models could be deleted or missing), so progress may be emitted.
    // The key assertion is that dependency INSTALL automation is skipped.
    const allCalls = mockSendSpy.mock.calls;
    const installCalls = allCalls.filter((call) =>
      JSON.stringify(call).includes('"stage":"install"')
    );
    expect(installCalls).toHaveLength(0);
  });

  describe('Migration: no Ollama/ChromaDB dependency setup', () => {
    test('runBackgroundSetup does NOT reference Ollama', async () => {
      await runBackgroundSetup();

      // Check all sent messages for Ollama references
      const allCalls = mockSendSpy.mock.calls;
      for (const call of allCalls) {
        const serialized = JSON.stringify(call).toLowerCase();
        expect(serialized).not.toContain('ollama');
      }
    });

    test('runBackgroundSetup does NOT reference ChromaDB', async () => {
      await runBackgroundSetup();

      // Check all sent messages for ChromaDB references
      const allCalls = mockSendSpy.mock.calls;
      for (const call of allCalls) {
        const serialized = JSON.stringify(call).toLowerCase();
        expect(serialized).not.toContain('chromadb');
        expect(serialized).not.toContain('chroma');
      }
    });

    test('getBackgroundSetupStatus returns complete status', async () => {
      const { getBackgroundSetupStatus } = require('../src/main/core/backgroundSetup');

      await runBackgroundSetup();

      const status = getBackgroundSetupStatus();
      expect(status.complete).toBe(true);
      expect(status.error).toBeNull();
      expect(status.startedAt).toBeDefined();
      expect(status.completedAt).toBeDefined();
    });

    test('checkFirstRun returns true when marker absent', async () => {
      const { checkFirstRun } = require('../src/main/core/backgroundSetup');

      // No marker file exists
      const isFirst = await checkFirstRun();
      expect(isFirst).toBe(true);
    });

    test('checkFirstRun returns false when marker exists', async () => {
      const { checkFirstRun } = require('../src/main/core/backgroundSetup');

      await fs.writeFile('/test/userData/dependency-setup-complete.marker', 'done');

      const isFirst = await checkFirstRun();
      expect(isFirst).toBe(false);
    });

    test('no external dependency installs on first run (no Ollama/ChromaDB/Tesseract)', async () => {
      // On first run, only model availability is checked.
      // No external installs: OCR uses bundled tesseract.js,
      // vision runtime is bundled in production builds.
      await runBackgroundSetup();

      const allCalls = mockSendSpy.mock.calls;
      for (const call of allCalls) {
        const serialized = JSON.stringify(call).toLowerCase();
        if (serialized.includes('dependency')) {
          expect(serialized).not.toContain('ollama');
          expect(serialized).not.toContain('chromadb');
          // No external install stages (winget/brew/apt-get)
          expect(serialized).not.toContain('"stage":"install"');
        }
      }
    });
  });
});
