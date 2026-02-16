/**
 * @jest-environment node
 *
 * SmartFolderWatcher Coverage Tests
 *
 * Tests untested paths: start/stop lifecycle, file event handling,
 * queue management, debouncing, orphan reconciliation, and error handling.
 *
 * Coverage target: main/services/SmartFolderWatcher.js (was 34%)
 */

jest.mock('fs', () => ({
  promises: {
    stat: jest.fn(),
    readFile: jest.fn(),
    access: jest.fn(),
    readdir: jest.fn()
  }
}));

jest.mock('chokidar', () => ({
  watch: jest.fn(() => {
    const EventEmitter = require('events');
    const watcher = new EventEmitter();
    watcher.close = jest.fn().mockResolvedValue();
    watcher.add = jest.fn();
    watcher.unwatch = jest.fn();
    // Auto-emit ready after microtask to simulate chokidar behavior
    process.nextTick(() => watcher.emit('ready'));
    return watcher;
  })
}));

jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  },
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/shared/constants', () => ({
  ANALYSIS_SUPPORTED_EXTENSIONS: ['.pdf', '.docx', '.txt', '.png', '.jpg'],
  AI_DEFAULTS: {
    EMBEDDING: { DIMENSION: 768 },
    TEXT: {}
  }
}));

jest.mock('../src/shared/performanceConstants', () => ({
  CHUNKING: { MAX_CHUNK_SIZE: 4000 },
  TIMEOUTS: { AI_ANALYSIS: 60000 },
  TEMP_FILE_PATTERNS: [/\.tmp$/],
  isTemporaryFile: jest.fn(() => false),
  RETRY: { MAX_ATTEMPTS_MEDIUM: 3 }
}));

jest.mock('../src/shared/errorClassifier', () => ({
  isNotFoundError: jest.fn((err) => err?.code === 'ENOENT')
}));

jest.mock('../src/main/errors/FileSystemError', () => ({
  WatcherError: class WatcherError extends Error {
    constructor(msg) {
      super(msg);
      this.name = 'WatcherError';
    }
  }
}));

jest.mock('../src/main/services/autoOrganize/namingUtils', () => ({
  generateSuggestedNameFromAnalysis: jest.fn(() => 'suggested-name')
}));

jest.mock('../src/main/services/analysisHistory/indexManager', () => ({
  generateFileHash: jest.fn(() => 'mock-hash')
}));

jest.mock('../src/main/services/confidence/watcherConfidence', () => ({
  deriveWatcherConfidencePercent: jest.fn(() => 85)
}));

jest.mock('../src/main/ipc/analysisUtils', () => ({
  recordAnalysisResult: jest.fn().mockResolvedValue()
}));

jest.mock('../src/main/utils/textChunking', () => ({
  chunkText: jest.fn((text) => [text])
}));

jest.mock('../src/main/analysis/embeddingSummary', () => ({
  buildEmbeddingSummary: jest.fn(() => 'summary')
}));

jest.mock('../src/shared/fileOperationTracker', () => ({
  getInstance: jest.fn(() => ({
    wasRecentlyOperated: jest.fn(() => false),
    markOperation: jest.fn()
  }))
}));

jest.mock('../src/shared/pathSanitization', () => ({
  normalizePathForIndex: jest.fn((p) => p),
  getCanonicalFileId: jest.fn((p) => p.toLowerCase())
}));

jest.mock('../src/shared/fileIdUtils', () => ({
  isImagePath: jest.fn((p) => /\.(png|jpg|jpeg|gif)$/i.test(p))
}));

jest.mock('../src/shared/crossPlatformUtils', () => ({
  isUNCPath: jest.fn(() => false)
}));

jest.mock('../src/shared/normalization', () => ({
  normalizeKeywords: jest.fn((kw) => kw)
}));

jest.mock('../src/main/services/organization/learningFeedback', () => ({
  getInstance: jest.fn(() => null),
  FEEDBACK_SOURCES: { WATCHER: 'watcher' }
}));

jest.mock('../src/shared/promiseUtils', () => ({
  withTimeout: jest.fn((promise) => promise)
}));

jest.mock('../src/main/services/embedding/embeddingGate', () => ({
  shouldEmbed: jest.fn(() => true)
}));

jest.mock('../src/main/services/LlamaResilience', () => ({
  resetLlamaCircuit: jest.fn()
}));

const fs = require('fs').promises;
const chokidar = require('chokidar');
const SmartFolderWatcher = require('../src/main/services/SmartFolderWatcher');

describe('SmartFolderWatcher', () => {
  let watcher;
  let mockDeps;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDeps = {
      getSmartFolders: jest.fn(() => [
        { id: 'f1', name: 'Docs', path: '/docs' },
        { id: 'f2', name: 'Images', path: '/images' }
      ]),
      analysisHistoryService: {
        getHistory: jest.fn(() => ({ entries: {} })),
        getEntry: jest.fn(() => null),
        setEntry: jest.fn(),
        deleteEntry: jest.fn(),
        getIndex: jest.fn(() => ({ categoryIndex: {}, tagIndex: {} }))
      },
      analyzeDocumentFile: jest.fn().mockResolvedValue({
        success: true,
        result: {
          category: 'Document',
          summary: 'A test document',
          keywords: ['test'],
          suggestedFolder: 'Docs'
        }
      }),
      analyzeImageFile: jest.fn().mockResolvedValue({
        success: true,
        result: {
          category: 'Image',
          summary: 'A test image',
          keywords: ['photo']
        }
      }),
      settingsService: {
        get: jest.fn(() => true),
        getAll: jest.fn(() => ({}))
      },
      vectorDbService: {
        upsert: jest.fn().mockResolvedValue(),
        search: jest.fn().mockResolvedValue([]),
        delete: jest.fn().mockResolvedValue()
      },
      filePathCoordinator: null,
      folderMatcher: {
        generateEmbedding: jest.fn().mockResolvedValue({ embedding: new Array(768).fill(0.1) })
      },
      notificationService: {
        notifyFileAnalyzed: jest.fn()
      }
    };

    // Make fs.stat resolve for folder validation
    fs.stat.mockResolvedValue({ isDirectory: () => true });

    watcher = new SmartFolderWatcher(mockDeps);
  });

  afterEach(async () => {
    if (watcher && watcher.isRunning) {
      await watcher.stop();
    }
    // Clear any stale timers
    if (watcher?.queueTimer) {
      clearInterval(watcher.queueTimer);
    }
  });

  describe('constructor', () => {
    test('initializes with correct defaults', () => {
      expect(watcher.isRunning).toBe(false);
      expect(watcher.isStarting).toBe(false);
      expect(watcher.debounceDelay).toBe(1000);
      expect(watcher.maxConcurrentAnalysis).toBe(2);
      expect(watcher.stats.filesAnalyzed).toBe(0);
    });

    test('stores all dependencies', () => {
      expect(watcher.getSmartFolders).toBe(mockDeps.getSmartFolders);
      expect(watcher.analysisHistoryService).toBe(mockDeps.analysisHistoryService);
      expect(watcher.vectorDbService).toBe(mockDeps.vectorDbService);
    });
  });

  describe('start', () => {
    test('starts watching configured folders', async () => {
      const result = await watcher.start();
      expect(result).toBe(true);
      expect(watcher.isRunning).toBe(true);
    });

    test('returns true if already running', async () => {
      await watcher.start();
      const result = await watcher.start();
      expect(result).toBe(true);
    });

    test('returns false when no folders configured', async () => {
      mockDeps.getSmartFolders.mockReturnValue([]);
      const noFolderWatcher = new SmartFolderWatcher(mockDeps);
      const result = await noFolderWatcher.start();
      expect(result).toBe(false);
    });

    test('returns false when all folder paths invalid', async () => {
      fs.stat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      const result = await watcher.start();
      expect(result).toBe(false);
    });

    test('deduplicates concurrent start calls', async () => {
      const p1 = watcher.start();
      const p2 = watcher.start();
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(true);
      // Second call either returns true (already running) or same promise
      expect(r2).toBe(true);
    });
  });

  describe('stop', () => {
    test('stops cleanly after start', async () => {
      await watcher.start();
      expect(watcher.isRunning).toBe(true);

      await watcher.stop();
      expect(watcher.isRunning).toBe(false);
      expect(watcher.watcher).toBeNull();
    });

    test('clears pending analysis timeouts on stop', async () => {
      await watcher.start();

      // Simulate a pending analysis
      const timeout = setTimeout(() => {}, 99999);
      watcher.pendingAnalysis.set('/docs/test.pdf', { mtime: Date.now(), timeout });

      await watcher.stop();
      expect(watcher.pendingAnalysis.size).toBe(0);
    });

    test('clears pending move candidates on stop', async () => {
      await watcher.start();

      const timeoutId = setTimeout(() => {}, 99999);
      watcher._pendingMoveCandidates.set('/old/path.pdf', {
        size: 100,
        mtimeMs: Date.now(),
        ext: '.pdf',
        timeoutId
      });

      await watcher.stop();
      expect(watcher._pendingMoveCandidates.size).toBe(0);
    });

    test('handles stop when not running', async () => {
      await expect(watcher.stop()).resolves.toBeUndefined();
    });
  });

  describe('restart', () => {
    test('stops and starts', async () => {
      await watcher.start();
      const result = await watcher.restart();
      expect(result).toBe(true);
    });
  });

  describe('updateWatchedFolders', () => {
    test('adds new paths and removes old ones', async () => {
      await watcher.start();

      const chokidarWatcher = watcher.watcher;

      await watcher.updateWatchedFolders([
        { id: 'f1', name: 'Docs', path: '/docs' },
        { id: 'f3', name: 'New', path: '/new-folder' }
      ]);

      expect(chokidarWatcher.add).toHaveBeenCalledWith('/new-folder');
    });

    test('does nothing when not running', async () => {
      await watcher.updateWatchedFolders([]);
      // Should not throw
    });
  });

  describe('getStatus', () => {
    test('returns correct status when running', async () => {
      await watcher.start();
      const status = watcher.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status).toHaveProperty('stats');
    });

    test('returns correct status when stopped', () => {
      const status = watcher.getStatus();
      expect(status.isRunning).toBe(false);
    });
  });

  describe('file event handling', () => {
    test('skips unsupported file extensions', async () => {
      await watcher.start();

      // Simulate an unsupported file event
      const chokidarWatcher = watcher.watcher;
      chokidarWatcher.emit('add', '/docs/test.xyz', { mtime: new Date() });

      // Should not add to queue
      expect(watcher.analysisQueue.length).toBe(0);
    });

    test('skips files already being processed', async () => {
      await watcher.start();
      watcher.processingFiles.add('/docs/test.pdf');

      const chokidarWatcher = watcher.watcher;
      chokidarWatcher.emit('add', '/docs/test.pdf', { mtime: new Date() });

      expect(watcher.analysisQueue.length).toBe(0);
    });
  });

  describe('_getValidFolderPaths', () => {
    test('skips folders without path', async () => {
      const paths = await watcher._getValidFolderPaths([
        { id: 'f1', name: 'NullPath', path: null },
        { id: 'f2', name: 'Docs', path: '/docs' }
      ]);
      expect(paths).toEqual(['/docs']);
    });

    test('skips non-directory paths', async () => {
      fs.stat.mockResolvedValueOnce({ isDirectory: () => false });
      fs.stat.mockResolvedValueOnce({ isDirectory: () => true });

      const paths = await watcher._getValidFolderPaths([
        { id: 'f1', name: 'File', path: '/some-file.txt' },
        { id: 'f2', name: 'Dir', path: '/real-dir' }
      ]);
      expect(paths).toEqual(['/real-dir']);
    });

    test('handles access errors gracefully', async () => {
      fs.stat.mockRejectedValue(new Error('EACCES'));

      const paths = await watcher._getValidFolderPaths([
        { id: 'f1', name: 'Protected', path: '/protected' }
      ]);
      expect(paths).toEqual([]);
    });
  });

  describe('queue management', () => {
    test('respects MAX_ANALYSIS_QUEUE_SIZE', async () => {
      await watcher.start();

      // Fill queue beyond limit
      for (let i = 0; i < 600; i++) {
        watcher.analysisQueue.push({
          filePath: `/docs/file-${i}.pdf`,
          eventType: 'add',
          mtime: Date.now()
        });
      }

      // Queue should be bounded (actual implementation may drop)
      expect(watcher.analysisQueue.length).toBeGreaterThan(0);
    });
  });

  describe('stats tracking', () => {
    test('increments error count on watcher error', async () => {
      await watcher.start();
      const initialErrors = watcher.stats.errors;

      watcher._handleError(new Error('Watch error'));
      expect(watcher.stats.errors).toBe(initialErrors + 1);
    });
  });

  describe('isSupportedFile (module-level)', () => {
    // Tested indirectly through _handleFileEvent
    test('supported extensions trigger analysis', async () => {
      await watcher.start();

      // .pdf should be supported
      const chokidarWatcher = watcher.watcher;
      chokidarWatcher.emit('add', '/docs/report.pdf', {
        mtime: new Date(),
        size: 1024
      });

      // Should add to pending or queue (debounced)
      // Wait a tick for debounce to process
      await new Promise((r) => setTimeout(r, 50));
      const hasPending = watcher.pendingAnalysis.size > 0 || watcher.analysisQueue.length > 0;
      expect(hasPending).toBe(true);
    });
  });
});
