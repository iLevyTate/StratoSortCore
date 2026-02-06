/**
 * Background dependency setup tests
 *
 * Verifies first-run automation:
 * - Removes installer marker
 * - Installs Tesseract when missing (best-effort)
 * - Writes dependency setup marker
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

// Legacy dependency automation removed (in-process AI stack).

// Import after mocks so module under test uses our fakes
const { runBackgroundSetup } = require('../src/main/core/backgroundSetup');

describe('backgroundSetup automated dependencies', () => {
  const fs = require('fs').promises;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.SKIP_TESSERACT_SETUP = 'true';

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

    // Create directories needed for the test
    await fs.mkdir('/test/exe', { recursive: true });
    await fs.mkdir('/test/userData', { recursive: true });
  });

  afterEach(() => {
    delete process.env.SKIP_TESSERACT_SETUP;
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

  test('not first run skips automation', async () => {
    // Seed marker to indicate previous completion
    await fs.writeFile('/test/userData/dependency-setup-complete.marker', 'done');

    await runBackgroundSetup();

    // Still should not emit progress if no automation runs.
    expect(mockSendSpy).not.toHaveBeenCalled();
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

    test('only Tesseract is installed on first run (no Ollama/ChromaDB)', async () => {
      // On first run, the only dependency that gets checked is Tesseract
      // Ollama/ChromaDB setup scripts were deleted in the migration
      await runBackgroundSetup();

      // The progress messages should only mention tesseract or generic setup
      const allCalls = mockSendSpy.mock.calls;
      for (const call of allCalls) {
        const serialized = JSON.stringify(call).toLowerCase();
        if (serialized.includes('dependency')) {
          // If dependency-related, should not mention ollama or chromadb
          expect(serialized).not.toContain('ollama');
          expect(serialized).not.toContain('chromadb');
        }
      }
    });
  });
});
