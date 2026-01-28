/**
 * SmartFolderWatcher → AnalysisHistory persistence regression test
 *
 * Ensures watcher analysis results are recorded to history by passing the
 * correct argument shape to recordAnalysisResult (including analysisHistory).
 */

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

const mockRecordAnalysisResult = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/main/ipc/analysisUtils', () => ({
  recordAnalysisResult: (...args) => mockRecordAnalysisResult(...args)
}));

jest.mock('../src/main/services/autoOrganize/namingUtils', () => ({
  generateSuggestedNameFromAnalysis: jest.fn(() => 'mock-suggested.pdf')
}));

jest.mock('../src/main/ipc/semantic', () => ({
  getSearchServiceInstance: jest.fn(() => ({
    invalidateIndex: jest.fn()
  }))
}));

// Avoid chokidar touching the filesystem during module init
jest.mock('chokidar', () => ({
  watch: jest.fn(() => ({
    on: jest.fn().mockReturnThis(),
    close: jest.fn().mockResolvedValue(undefined)
  }))
}));

// Mock fileOperationTracker to prevent infinite loop protection from interfering with tests
jest.mock('../src/shared/fileOperationTracker', () => ({
  getInstance: jest.fn(() => ({
    wasRecentlyOperated: jest.fn().mockReturnValue(false),
    recordOperation: jest.fn(),
    clear: jest.fn(),
    shutdown: jest.fn()
  })),
  FileOperationTracker: jest.fn(),
  DEFAULT_COOLDOWN_MS: 5000
}));

// Mock crossPlatformUtils
jest.mock('../src/shared/crossPlatformUtils', () => ({
  isUNCPath: jest.fn((p) => p && (p.startsWith('\\\\') || p.startsWith('//')))
}));

describe('SmartFolderWatcher analysis history recording', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('calls recordAnalysisResult with analysisHistory service and normalized payload', async () => {
    const fs = require('fs').promises;
    jest.spyOn(fs, 'stat').mockResolvedValue({
      size: 123,
      birthtime: new Date('2026-01-01T00:00:00.000Z'),
      mtime: new Date('2026-01-02T00:00:00.000Z'),
      mtimeMs: Date.parse('2026-01-02T00:00:00.000Z')
    });

    const SmartFolderWatcher = require('../src/main/services/SmartFolderWatcher');

    const analysisHistoryService = { recordAnalysis: jest.fn() };
    const settingsService = {
      load: jest.fn().mockResolvedValue({
        namingConvention: 'keep-original',
        separator: '-',
        dateFormat: 'YYYY-MM-DD',
        caseConvention: 'kebab-case'
      })
    };

    const watcher = new SmartFolderWatcher({
      getSmartFolders: () => [],
      analysisHistoryService,
      analyzeDocumentFile: jest.fn().mockResolvedValue({
        analysis: {
          category: 'Invoices',
          keywords: ['invoice', '2026', 'customer'],
          confidence: 0.91,
          summary: 'Invoice for customer ABC with amount and date.',
          extractedText: 'Invoice 2026 ABC'
        },
        processingTimeMs: 250,
        model: 'llm'
      }),
      analyzeImageFile: jest.fn(),
      settingsService,
      chromaDbService: null,
      folderMatcher: null,
      notificationService: null
    });

    await watcher._analyzeFile({ filePath: 'C:\\tmp\\invoice.pdf', eventType: 'add' });

    expect(mockRecordAnalysisResult).toHaveBeenCalledTimes(1);
    const callArg = mockRecordAnalysisResult.mock.calls[0][0];

    expect(callArg).toEqual(
      expect.objectContaining({
        filePath: 'C:\\tmp\\invoice.pdf',
        analysisHistory: analysisHistoryService
      })
    );

    expect(callArg.result).toEqual(
      expect.objectContaining({
        category: 'Invoices',
        confidence: 0.91,
        keywords: ['invoice', '2026', 'customer']
      })
    );
  });

  test('detects move and updates paths without re-analysis', async () => {
    const fs = require('fs').promises;
    jest.spyOn(fs, 'access').mockResolvedValue(undefined);

    const oldPath = 'C:\\old\\doc.pdf';
    const newPath = 'C:\\new\\doc.pdf';
    const mtimeMs = Date.parse('2026-01-02T00:00:00.000Z');
    const fileSize = 123;

    const SmartFolderWatcher = require('../src/main/services/SmartFolderWatcher');

    const analysisHistoryService = {
      getAnalysisByPath: jest.fn().mockResolvedValue({
        originalPath: oldPath,
        organization: { actual: oldPath },
        fileSize,
        lastModified: mtimeMs
      })
    };

    const atomicPathUpdate = jest
      .fn()
      .mockResolvedValue({ success: true, errors: [], updated: {} });

    const watcher = new SmartFolderWatcher({
      getSmartFolders: () => [],
      analysisHistoryService,
      analyzeDocumentFile: jest.fn(),
      analyzeImageFile: jest.fn(),
      settingsService: { load: jest.fn().mockResolvedValue({}) },
      chromaDbService: null,
      filePathCoordinator: { atomicPathUpdate },
      folderMatcher: null,
      notificationService: null
    });

    await watcher._handleFileDeletion(oldPath);
    await watcher._queueFileForAnalysis(newPath, mtimeMs, 'add', {
      size: fileSize,
      mtimeMs,
      mtime: new Date(mtimeMs)
    });

    expect(atomicPathUpdate).toHaveBeenCalledWith(
      oldPath,
      newPath,
      expect.objectContaining({ type: 'move' })
    );
    expect(watcher.analyzeDocumentFile).not.toHaveBeenCalled();
    expect(watcher._pendingMoveCandidates.size).toBe(0);
  });
});

describe('SmartFolderWatcher start race condition (M3 fix)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('concurrent start() calls deduplicate and only call _doStart once', async () => {
    const SmartFolderWatcher = require('../src/main/services/SmartFolderWatcher');

    const watcher = new SmartFolderWatcher({
      getSmartFolders: () => [{ path: '/test/folder', name: 'Test' }],
      analysisHistoryService: { recordAnalysis: jest.fn() },
      analyzeDocumentFile: jest.fn(),
      analyzeImageFile: jest.fn(),
      settingsService: { load: jest.fn().mockResolvedValue({}) },
      chromaDbService: null,
      folderMatcher: null,
      notificationService: null
    });

    // Mock _doStart to simulate async operation
    watcher._doStart = jest.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return true;
    });

    // Start two concurrent calls
    const promise1 = watcher.start();
    const promise2 = watcher.start();

    const [result1, result2] = await Promise.all([promise1, promise2]);

    // Both should get the same result (true)
    expect(result1).toBe(true);
    expect(result2).toBe(true);

    // _doStart should only be called once (deduplication)
    expect(watcher._doStart).toHaveBeenCalledTimes(1);
  });

  test('start() returns true if already running', async () => {
    const SmartFolderWatcher = require('../src/main/services/SmartFolderWatcher');

    const watcher = new SmartFolderWatcher({
      getSmartFolders: () => [],
      analysisHistoryService: {},
      analyzeDocumentFile: jest.fn(),
      analyzeImageFile: jest.fn(),
      settingsService: { load: jest.fn().mockResolvedValue({}) },
      chromaDbService: null,
      folderMatcher: null,
      notificationService: null
    });

    // Simulate already running
    watcher.isRunning = true;

    const result = await watcher.start();

    expect(result).toBe(true);
  });

  test('_startPromise is cleared after start completes', async () => {
    const SmartFolderWatcher = require('../src/main/services/SmartFolderWatcher');

    const watcher = new SmartFolderWatcher({
      getSmartFolders: () => [{ path: '/test/folder', name: 'Test' }],
      analysisHistoryService: {},
      analyzeDocumentFile: jest.fn(),
      analyzeImageFile: jest.fn(),
      settingsService: { load: jest.fn().mockResolvedValue({}) },
      chromaDbService: null,
      folderMatcher: null,
      notificationService: null
    });

    // Mock _doStart
    watcher._doStart = jest.fn().mockResolvedValue(true);

    await watcher.start();

    // Promise should be cleared
    expect(watcher._startPromise).toBeNull();
    expect(watcher.isStarting).toBe(false);
  });

  test('isStarting flag is reset on start failure', async () => {
    const SmartFolderWatcher = require('../src/main/services/SmartFolderWatcher');

    const watcher = new SmartFolderWatcher({
      getSmartFolders: () => [{ path: '/test/folder', name: 'Test' }],
      analysisHistoryService: {},
      analyzeDocumentFile: jest.fn(),
      analyzeImageFile: jest.fn(),
      settingsService: { load: jest.fn().mockResolvedValue({}) },
      chromaDbService: null,
      folderMatcher: null,
      notificationService: null
    });

    // Mock _doStart to throw
    watcher._doStart = jest.fn().mockRejectedValue(new Error('Start failed'));

    try {
      await watcher.start();
    } catch {
      // Expected
    }

    // Flags should be reset even on failure
    expect(watcher._startPromise).toBeNull();
    expect(watcher.isStarting).toBe(false);
  });

  test('enables polling for UNC paths (network drive)', async () => {
    const SmartFolderWatcher = require('../src/main/services/SmartFolderWatcher');
    const chokidar = require('chokidar');

    const watcher = new SmartFolderWatcher({
      getSmartFolders: () => [{ path: '\\\\server\\share\\SmartFolder', name: 'NetworkFolder' }],
      analysisHistoryService: {},
      analyzeDocumentFile: jest.fn(),
      analyzeImageFile: jest.fn(),
      settingsService: { load: jest.fn().mockResolvedValue({}) },
      chromaDbService: null,
      folderMatcher: null,
      notificationService: null
    });

    // Mock _getValidFolderPaths to return the UNC path
    watcher._getValidFolderPaths = jest.fn().mockResolvedValue(['\\\\server\\share\\SmartFolder']);

    // Mock _startQueueProcessor
    watcher._startQueueProcessor = jest.fn();

    await watcher.start();

    expect(chokidar.watch).toHaveBeenCalledWith(
      expect.arrayContaining(['\\\\server\\share\\SmartFolder']),
      expect.objectContaining({
        usePolling: true,
        interval: 2000,
        binaryInterval: 2000
      })
    );
  });
});
