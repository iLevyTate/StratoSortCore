// Verify SmartFolderWatcher requeues failed items instead of dropping them

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

// Avoid chokidar touching the filesystem during module init
jest.mock('chokidar', () => ({
  watch: jest.fn(() => ({
    on: jest.fn().mockReturnThis(),
    close: jest.fn().mockResolvedValue(undefined),
    removeAllListeners: jest.fn()
  }))
}));

// Mock fileOperationTracker to keep watcher init light
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

const SmartFolderWatcher = require('../src/main/services/SmartFolderWatcher');

describe('SmartFolderWatcher retries', () => {
  test('requeues failed analysis items up to retry limit', async () => {
    const watcher = new SmartFolderWatcher({
      getSmartFolders: () => [],
      analysisHistoryService: null,
      analyzeDocumentFile: jest.fn(),
      analyzeImageFile: jest.fn(),
      settingsService: { load: jest.fn().mockResolvedValue({}) },
      chromaDbService: null,
      folderMatcher: null,
      notificationService: null
    });

    const analyzeMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce();

    watcher._analyzeFile = analyzeMock;
    watcher.analysisQueue.push({ filePath: 'C:\\tmp\\doc.pdf', eventType: 'add' });

    // First attempt should fail and requeue
    await watcher._processQueue();
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(watcher.analysisQueue).toHaveLength(1);
    expect(watcher.stats.errors).toBe(1);

    // Second attempt should succeed and clear queue
    await watcher._processQueue();
    expect(analyzeMock).toHaveBeenCalledTimes(2);
    expect(watcher.analysisQueue).toHaveLength(0);
  });
});

describe('SmartFolderWatcher stop cleanup', () => {
  test('should clear pending move detection timeouts on stop', () => {
    const watcher = new SmartFolderWatcher({
      getSmartFolders: () => [],
      analysisHistoryService: null,
      analyzeDocumentFile: jest.fn(),
      analyzeImageFile: jest.fn(),
      settingsService: { load: jest.fn().mockResolvedValue({}) },
      chromaDbService: null,
      folderMatcher: null,
      notificationService: null
    });

    // Simulate pending move candidates with timeouts
    const mockTimeout1 = setTimeout(() => {}, 10000);
    const mockTimeout2 = setTimeout(() => {}, 10000);

    watcher._pendingMoveCandidates.set('/old/path1.pdf', {
      oldPath: '/old/path1.pdf',
      size: 1000,
      mtimeMs: Date.now(),
      ext: '.pdf',
      createdAt: Date.now(),
      timeoutId: mockTimeout1
    });

    watcher._pendingMoveCandidates.set('/old/path2.pdf', {
      oldPath: '/old/path2.pdf',
      size: 2000,
      mtimeMs: Date.now(),
      ext: '.pdf',
      createdAt: Date.now(),
      timeoutId: mockTimeout2
    });

    expect(watcher._pendingMoveCandidates.size).toBe(2);

    // Stop should clear all pending move candidates and their timeouts
    watcher.stop();

    expect(watcher._pendingMoveCandidates.size).toBe(0);
    expect(watcher._isStopping).toBe(true);
  });

  test('should clear pending analysis timeouts on stop', () => {
    const watcher = new SmartFolderWatcher({
      getSmartFolders: () => [],
      analysisHistoryService: null,
      analyzeDocumentFile: jest.fn(),
      analyzeImageFile: jest.fn(),
      settingsService: { load: jest.fn().mockResolvedValue({}) },
      chromaDbService: null,
      folderMatcher: null,
      notificationService: null
    });

    // Simulate pending analysis with timeouts
    const mockTimeout = setTimeout(() => {}, 10000);
    watcher.pendingAnalysis.set('/some/file.pdf', {
      mtime: Date.now(),
      timeout: mockTimeout,
      eventType: 'add'
    });

    expect(watcher.pendingAnalysis.size).toBe(1);

    watcher.stop();

    expect(watcher.pendingAnalysis.size).toBe(0);
  });
});
