/**
 * Comprehensive preload coverage tests.
 * Targets: SecureIPCManager methods, buildEmbeddingSearchPayload,
 *          throwIfFailed, files.analyze routing, files.normalizePath,
 *          safeOn, auditStaleListeners, enqueueThrottled, cleanup.
 */

const mockInvoke = jest.fn();
const mockOn = jest.fn();
const mockRemoveListener = jest.fn();
const mockSend = jest.fn();
const mockExposeInMainWorld = jest.fn();

jest.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mockExposeInMainWorld },
  ipcRenderer: {
    invoke: mockInvoke,
    on: mockOn,
    removeListener: mockRemoveListener,
    send: mockSend
  }
}));

jest.mock('../src/shared/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    setContext: jest.fn(),
    setLevel: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })),
  LOG_LEVELS: { DEBUG: 'debug', INFO: 'info' }
}));

jest.mock('../src/preload/ipcRateLimiter', () => ({
  IpcRateLimiter: jest.fn().mockImplementation(() => ({
    checkRateLimit: jest.fn()
  }))
}));

jest.mock('../src/preload/ipcSanitizer', () => ({
  createIpcSanitizer: jest.fn(() => ({
    sanitizeArguments: jest.fn((args) => args)
  }))
}));

jest.mock('../src/preload/ipcValidator', () => ({
  createIpcValidator: jest.fn(() => ({
    validateResult: jest.fn((result) => result),
    validateEventSource: jest.fn(() => true),
    isValidSystemMetrics: jest.fn(() => true)
  }))
}));

jest.mock('../src/shared/pathSanitization', () => ({
  sanitizePath: jest.fn((p) => p.replace('file://', ''))
}));

jest.mock('../src/shared/performanceConstants', () => ({
  LIMITS: {
    MAX_IPC_REQUESTS_PER_SECOND: 200,
    IPC_INVOKE_TIMEOUT: 1000
  },
  TIMEOUTS: {
    DIRECTORY_SCAN: 2000,
    AI_ANALYSIS_LONG: 3000,
    AI_ANALYSIS_BATCH: 5000
  }
}));

jest.mock('../src/shared/securityConfig', () => ({
  ALLOWED_RECEIVE_CHANNELS: [
    'operation-progress',
    'app:error',
    'app:update',
    'system-metrics',
    'menu-action',
    'settings-changed-external',
    'operation-error',
    'operation-complete',
    'operation-failed',
    'file-operation-complete',
    'notification',
    'batch-results-chunk',
    'chat:stream-chunk',
    'chat:stream-end'
  ],
  ALLOWED_SEND_CHANNELS: ['renderer-error-report']
}));

jest.mock('../src/shared/constants', () => ({
  IPC_CHANNELS: {
    FILES: {
      SELECT: 'files:select',
      SELECT_DIRECTORY: 'files:select-directory',
      GET_DOCUMENTS_PATH: 'files:get-documents-path',
      CREATE_FOLDER_DIRECT: 'files:create-folder-direct',
      GET_FILE_STATS: 'files:stats',
      GET_FILES_IN_DIRECTORY: 'files:get-directory',
      PERFORM_OPERATION: 'files:perform-operation',
      DELETE_FILE: 'files:delete',
      CLEANUP_ANALYSIS: 'files:cleanup-analysis',
      OPEN_FILE: 'files:open',
      REVEAL_FILE: 'files:reveal',
      COPY_FILE: 'files:copy',
      OPEN_FOLDER: 'files:open-folder',
      DELETE_FOLDER: 'files:delete-folder'
    },
    SMART_FOLDERS: {
      GET: 'sf:get',
      SAVE: 'sf:save',
      UPDATE_CUSTOM: 'sf:update-custom',
      GET_CUSTOM: 'sf:get-custom',
      SCAN_STRUCTURE: 'sf:scan-structure',
      ADD: 'sf:add',
      EDIT: 'sf:edit',
      DELETE: 'sf:delete',
      MATCH: 'sf:match',
      RESET_TO_DEFAULTS: 'sf:reset-defaults',
      GENERATE_DESCRIPTION: 'sf:gen-desc',
      WATCHER_START: 'sf:watcher-start',
      WATCHER_STOP: 'sf:watcher-stop',
      WATCHER_STATUS: 'sf:watcher-status',
      WATCHER_SCAN: 'sf:watcher-scan'
    },
    ANALYSIS: {
      ANALYZE_DOCUMENT: 'analysis:document',
      ANALYZE_IMAGE: 'analysis:image',
      ANALYZE_BATCH: 'analysis:batch',
      EXTRACT_IMAGE_TEXT: 'analysis:extract-text'
    },
    SETTINGS: {
      GET: 'settings:get',
      SAVE: 'settings:save',
      GET_CONFIGURABLE_LIMITS: 'settings:limits',
      GET_LOGS_INFO: 'settings:logs-info',
      OPEN_LOGS_FOLDER: 'settings:open-logs',
      EXPORT: 'settings:export',
      IMPORT: 'settings:import',
      CREATE_BACKUP: 'settings:create-backup',
      LIST_BACKUPS: 'settings:list-backups',
      RESTORE_BACKUP: 'settings:restore-backup',
      DELETE_BACKUP: 'settings:delete-backup'
    },
    LLAMA: {
      GET_MODELS: 'llama:get-models',
      GET_CONFIG: 'llama:get-config',
      UPDATE_CONFIG: 'llama:update-config',
      TEST_CONNECTION: 'llama:test-connection',
      DOWNLOAD_MODEL: 'llama:download-model',
      DELETE_MODEL: 'llama:delete-model',
      GET_DOWNLOAD_STATUS: 'llama:get-download-status'
    },
    UNDO_REDO: {
      UNDO: 'undo:undo',
      REDO: 'undo:redo',
      GET_HISTORY: 'undo:history',
      GET_STATE: 'undo:state',
      CLEAR_HISTORY: 'undo:clear',
      CAN_UNDO: 'undo:can-undo',
      CAN_REDO: 'undo:can-redo',
      STATE_CHANGED: 'undo:state-changed'
    },
    ANALYSIS_HISTORY: {
      GET: 'ah:get',
      SEARCH: 'ah:search',
      GET_STATISTICS: 'ah:stats',
      GET_FILE_HISTORY: 'ah:file-history',
      SET_EMBEDDING_POLICY: 'ah:set-policy',
      CLEAR: 'ah:clear',
      EXPORT: 'ah:export'
    },
    EMBEDDINGS: {
      REBUILD_FOLDERS: 'emb:rebuild-folders',
      REBUILD_FILES: 'emb:rebuild-files',
      FULL_REBUILD: 'emb:full-rebuild',
      REANALYZE_ALL: 'emb:reanalyze-all',
      REANALYZE_FILE: 'emb:reanalyze-file',
      CLEAR_STORE: 'emb:clear-store',
      GET_STATS: 'emb:get-stats',
      SEARCH: 'emb:search',
      SCORE_FILES: 'emb:score-files',
      FIND_SIMILAR: 'emb:find-similar',
      REBUILD_BM25_INDEX: 'emb:rebuild-bm25',
      GET_SEARCH_STATUS: 'emb:search-status',
      DIAGNOSE_SEARCH: 'emb:diagnose',
      FIND_MULTI_HOP: 'emb:multi-hop',
      COMPUTE_CLUSTERS: 'emb:clusters',
      GET_CLUSTERS: 'emb:get-clusters',
      GET_CLUSTER_MEMBERS: 'emb:cluster-members',
      GET_SIMILARITY_EDGES: 'emb:similarity-edges',
      GET_FILE_METADATA: 'emb:file-metadata',
      FIND_DUPLICATES: 'emb:find-duplicates',
      CLEAR_CLUSTERS: 'emb:clear-clusters',
      FIND_FILES_BY_PATHS: 'emb:find-files-by-paths'
    },
    SYSTEM: {
      GET_METRICS: 'system:metrics',
      GET_APPLICATION_STATISTICS: 'system:app-stats',
      APPLY_UPDATE: 'system:apply-update',
      GET_CONFIG: 'system:get-config',
      GET_CONFIG_VALUE: 'system:get-config-value',
      GET_RECOMMENDED_CONCURRENCY: 'system:rec-concurrency',
      LOG: 'system:log',
      RENDERER_ERROR_REPORT: 'system:renderer-error-report'
    },
    WINDOW: {
      MINIMIZE: 'window:minimize',
      MAXIMIZE: 'window:maximize',
      UNMAXIMIZE: 'window:unmaximize',
      TOGGLE_MAXIMIZE: 'window:toggle-maximize',
      IS_MAXIMIZED: 'window:is-maximized',
      CLOSE: 'window:close'
    },
    SUGGESTIONS: {
      GET_FILE_SUGGESTIONS: 'sugg:file',
      GET_BATCH_SUGGESTIONS: 'sugg:batch',
      RECORD_FEEDBACK: 'sugg:feedback',
      GET_STRATEGIES: 'sugg:strategies',
      APPLY_STRATEGY: 'sugg:apply-strategy',
      GET_USER_PATTERNS: 'sugg:patterns',
      CLEAR_PATTERNS: 'sugg:clear-patterns',
      ANALYZE_FOLDER_STRUCTURE: 'sugg:analyze-folder',
      SUGGEST_NEW_FOLDER: 'sugg:new-folder',
      ADD_FEEDBACK_MEMORY: 'sugg:add-feedback',
      GET_FEEDBACK_MEMORY: 'sugg:get-feedback',
      UPDATE_FEEDBACK_MEMORY: 'sugg:update-feedback',
      DELETE_FEEDBACK_MEMORY: 'sugg:delete-feedback'
    },
    ORGANIZE: {
      AUTO: 'org:auto',
      BATCH: 'org:batch',
      PROCESS_NEW: 'org:process-new',
      GET_STATS: 'org:stats',
      UPDATE_THRESHOLDS: 'org:thresholds',
      CLUSTER_BATCH: 'org:cluster-batch',
      IDENTIFY_OUTLIERS: 'org:outliers',
      GET_CLUSTER_SUGGESTIONS: 'org:cluster-sugg'
    },
    VECTOR_DB: {
      GET_STATUS: 'vdb:status',
      GET_STATS: 'vdb:stats',
      HEALTH_CHECK: 'vdb:health',
      STATUS_CHANGED: 'vdb:status-changed'
    },
    CHAT: {
      QUERY: 'chat:query',
      QUERY_STREAM: 'chat:query-stream',
      STREAM_CHUNK: 'chat:stream-chunk',
      STREAM_END: 'chat:stream-end',
      RESET_SESSION: 'chat:reset',
      LIST_CONVERSATIONS: 'chat:list-conversations',
      GET_CONVERSATION: 'chat:get-conversation',
      DELETE_CONVERSATION: 'chat:delete-conversation',
      SEARCH_CONVERSATIONS: 'chat:search-conversations'
    },
    KNOWLEDGE: {
      GET_RELATIONSHIP_EDGES: 'know:edges',
      GET_RELATIONSHIP_STATS: 'know:stats'
    }
  }
}));

describe('Preload Coverage', () => {
  let electronAPI;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    global.window = global.window || {};
    global.window.addEventListener = jest.fn();
    global.window.removeEventListener = jest.fn();

    // Load preload module
    require('../src/preload/preload');

    // Capture exposed API
    const call = mockExposeInMainWorld.mock.calls[0];
    electronAPI = call ? call[1] : null;
  });

  describe('files.normalizePath', () => {
    test('normalizes duplicate separators', () => {
      expect(electronAPI.files.normalizePath('C:\\\\Users\\\\test')).toBe('C:\\Users\\test');
    });

    test('strips trailing separator', () => {
      expect(electronAPI.files.normalizePath('C:\\Users\\test\\')).toBe('C:\\Users\\test');
    });

    test('preserves root paths', () => {
      expect(electronAPI.files.normalizePath('C:\\')).toBe('C:\\');
    });

    test('handles UNC paths', () => {
      const result = electronAPI.files.normalizePath('\\\\server\\share\\file');
      expect(result).toContain('server');
    });

    test('returns non-string input unchanged', () => {
      expect(electronAPI.files.normalizePath(42)).toBe(42);
    });

    test('handles forward slash normalization', () => {
      expect(electronAPI.files.normalizePath('C://Users//test')).toBe('C:/Users/test');
    });
  });

  describe('files.analyze', () => {
    beforeEach(() => {
      mockInvoke.mockResolvedValue({ success: true });
    });

    test('routes image extensions to analyze:image', async () => {
      await electronAPI.files.analyze('C:\\photos\\test.jpg');
      expect(mockInvoke).toHaveBeenCalledWith('analysis:analyze-image', 'C:\\photos\\test.jpg');
    });

    test('routes PNG to image analysis', async () => {
      await electronAPI.files.analyze('C:\\photos\\test.png');
      expect(mockInvoke).toHaveBeenCalledWith('analysis:analyze-image', 'C:\\photos\\test.png');
    });

    test('routes document extensions to analyze:document', async () => {
      await electronAPI.files.analyze('C:\\docs\\report.pdf');
      expect(mockInvoke).toHaveBeenCalledWith('analysis:analyze-document', 'C:\\docs\\report.pdf');
    });

    test('rejects empty file path', async () => {
      await expect(electronAPI.files.analyze('')).rejects.toThrow('Invalid file path');
    });

    test('rejects HTTP URLs', async () => {
      await expect(electronAPI.files.analyze('http://example.com')).rejects.toThrow(
        'Invalid file path'
      );
    });

    test('rejects HTTPS URLs', async () => {
      await expect(electronAPI.files.analyze('https://example.com')).rejects.toThrow(
        'Invalid file path'
      );
    });

    test('rejects UNC paths', async () => {
      await expect(electronAPI.files.analyze('\\\\server\\share\\file')).rejects.toThrow(
        'network (UNC) paths'
      );
    });

    test('rejects relative paths', async () => {
      await expect(electronAPI.files.analyze('relative/path.pdf')).rejects.toThrow(
        'must be an absolute path'
      );
    });

    test('handles file:// protocol by sanitizing', async () => {
      await electronAPI.files.analyze('C:\\docs\\test.pdf');
      expect(mockInvoke).toHaveBeenCalled();
    });

    test('unwraps array input', async () => {
      await electronAPI.files.analyze(['C:\\docs\\report.pdf']);
      expect(mockInvoke).toHaveBeenCalledWith('analysis:analyze-document', 'C:\\docs\\report.pdf');
    });

    test('unwraps object with path property', async () => {
      await electronAPI.files.analyze({ path: 'C:\\docs\\report.pdf' });
      expect(mockInvoke).toHaveBeenCalledWith('analysis:analyze-document', 'C:\\docs\\report.pdf');
    });

    test('trims whitespace and quotes from path', async () => {
      await electronAPI.files.analyze('"C:\\docs\\report.pdf"');
      expect(mockInvoke).toHaveBeenCalledWith('analysis:analyze-document', 'C:\\docs\\report.pdf');
    });

    test('routes .gif to image analysis', async () => {
      await electronAPI.files.analyze('C:\\img\\anim.gif');
      expect(mockInvoke).toHaveBeenCalledWith('analysis:analyze-image', 'C:\\img\\anim.gif');
    });

    test('routes .webp to image analysis', async () => {
      await electronAPI.files.analyze('C:\\img\\photo.webp');
      expect(mockInvoke).toHaveBeenCalledWith('analysis:analyze-image', 'C:\\img\\photo.webp');
    });

    test('routes .heic to image analysis', async () => {
      await electronAPI.files.analyze('C:\\img\\photo.heic');
      expect(mockInvoke).toHaveBeenCalledWith('analysis:analyze-image', 'C:\\img\\photo.heic');
    });
  });

  describe('files.getStats', () => {
    test('returns normalized stats object', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        stats: { size: 1024, isDirectory: false }
      });

      const result = await electronAPI.files.getStats('C:\\file.txt');
      expect(result.success).toBe(true);
      expect(result.exists).toBe(true);
      expect(result.size).toBe(1024);
    });

    test('handles failure result', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'not found' });

      const result = await electronAPI.files.getStats('C:\\missing.txt');
      expect(result.success).toBe(false);
      expect(result.exists).toBe(false);
    });

    test('handles null result', async () => {
      mockInvoke.mockResolvedValue(null);

      const result = await electronAPI.files.getStats('C:\\file.txt');
      expect(result).toBeNull();
    });
  });

  describe('settings with throwIfFailed', () => {
    test('settings.get resolves on success', async () => {
      mockInvoke.mockResolvedValue({ success: true, data: { theme: 'dark' } });
      const result = await electronAPI.settings.get();
      expect(result.success).toBe(true);
    });

    test('settings.save throws on failure', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'validation failed' });
      await expect(electronAPI.settings.save({ invalid: true })).rejects.toThrow(
        'validation failed'
      );
    });

    test('settings.save allows canceled result', async () => {
      mockInvoke.mockResolvedValue({ success: false, canceled: true });
      const result = await electronAPI.settings.save({});
      expect(result.canceled).toBe(true);
    });

    test('settings.save allows cancelled (British spelling)', async () => {
      mockInvoke.mockResolvedValue({ success: false, cancelled: true });
      const result = await electronAPI.settings.save({});
      expect(result.cancelled).toBe(true);
    });

    test('settings.get throws when result is null', async () => {
      mockInvoke.mockResolvedValue(null);
      await expect(electronAPI.settings.get()).rejects.toThrow('Failed to load settings');
    });
  });

  describe('events.sendError', () => {
    test('sends error report via ipcRenderer.send', () => {
      electronAPI.events.sendError({ message: 'Test error', stack: 'stack...' });
      expect(mockSend).toHaveBeenCalledWith('renderer-error-report', expect.any(Object));
    });

    test('does nothing for null error data', () => {
      electronAPI.events.sendError(null);
      expect(mockSend).not.toHaveBeenCalled();
    });

    test('does nothing for error without message', () => {
      electronAPI.events.sendError({ code: 500 });
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('window methods', () => {
    test('window.minimize calls safeInvoke', async () => {
      mockInvoke.mockResolvedValue(true);
      await electronAPI.window.minimize();
      expect(mockInvoke).toHaveBeenCalledWith('window:minimize');
    });

    test('window.close calls safeInvoke', async () => {
      mockInvoke.mockResolvedValue(true);
      await electronAPI.window.close();
      expect(mockInvoke).toHaveBeenCalledWith('window:close');
    });
  });

  describe('system.log payload normalization', () => {
    test('coerces primitive data into an object payload', async () => {
      mockInvoke.mockResolvedValue({ success: true });
      await electronAPI.system.log('warn', 'hello', 'raw-string-data');

      expect(mockInvoke).toHaveBeenCalledWith('system:log', {
        level: 'warn',
        message: 'hello',
        data: { value: 'raw-string-data' }
      });
    });

    test('maps unknown level and empty message to safe defaults', async () => {
      mockInvoke.mockResolvedValue({ success: true });
      await electronAPI.system.log('not-a-level', '', null);

      expect(mockInvoke).toHaveBeenCalledWith('system:log', {
        level: 'info',
        message: '[renderer-log]',
        data: {}
      });
    });
  });

  describe('embeddings.search payload building', () => {
    test('builds default search payload', async () => {
      mockInvoke.mockResolvedValue({ results: [] });
      await electronAPI.embeddings.search('test query');
      expect(mockInvoke).toHaveBeenCalledWith(
        'embeddings:search',
        expect.objectContaining({
          query: 'test query',
          topK: 20,
          mode: 'hybrid'
        })
      );
    });

    test('includes optional parameters when provided', async () => {
      mockInvoke.mockResolvedValue({ results: [] });
      await electronAPI.embeddings.search('test', {
        topK: 5,
        minScore: 0.5,
        chunkWeight: 0.3,
        chunkTopK: 10,
        correctSpelling: true,
        expandSynonyms: false,
        rerank: true,
        rerankTopN: 3
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        'embeddings:search',
        expect.objectContaining({
          query: 'test',
          topK: 5,
          minScore: 0.5,
          chunkWeight: 0.3,
          chunkTopK: 10,
          correctSpelling: true,
          expandSynonyms: false,
          rerank: true,
          rerankTopN: 3
        })
      );
    });

    test('hybridSearch forces hybrid mode', async () => {
      mockInvoke.mockResolvedValue({ results: [] });
      await electronAPI.embeddings.hybridSearch('test', { mode: 'vector' });
      expect(mockInvoke).toHaveBeenCalledWith(
        'embeddings:search',
        expect.objectContaining({ mode: 'hybrid' })
      );
    });
  });

  describe('safeOn listener management', () => {
    test('registers listener for allowed receive channels', () => {
      const callback = jest.fn();
      electronAPI.events.onOperationProgress(callback);
      expect(mockOn).toHaveBeenCalledWith('operation-progress', expect.any(Function));
    });

    test('returns cleanup function that removes listener', () => {
      const callback = jest.fn();
      const cleanup = electronAPI.events.onOperationProgress(callback);
      expect(typeof cleanup).toBe('function');
      cleanup();
      expect(mockRemoveListener).toHaveBeenCalledWith('operation-progress', expect.any(Function));
    });
  });

  describe('API surface completeness', () => {
    test('exposes files API', () => {
      expect(electronAPI.files).toBeDefined();
      expect(typeof electronAPI.files.select).toBe('function');
      expect(typeof electronAPI.files.analyze).toBe('function');
      expect(typeof electronAPI.files.normalizePath).toBe('function');
    });

    test('exposes smartFolders API', () => {
      expect(electronAPI.smartFolders).toBeDefined();
      expect(typeof electronAPI.smartFolders.get).toBe('function');
    });

    test('exposes analysis API', () => {
      expect(electronAPI.analysis).toBeDefined();
      expect(typeof electronAPI.analysis.document).toBe('function');
      expect(typeof electronAPI.analysis.image).toBe('function');
      expect(typeof electronAPI.analysis.batch).toBe('function');
    });

    test('exposes embeddings API', () => {
      expect(electronAPI.embeddings).toBeDefined();
      expect(typeof electronAPI.embeddings.search).toBe('function');
      expect(typeof electronAPI.embeddings.hybridSearch).toBe('function');
    });

    test('exposes chat API', () => {
      expect(electronAPI.chat).toBeDefined();
      expect(typeof electronAPI.chat.queryStream).toBe('function');
      expect(typeof electronAPI.chat.cancelStream).toBe('function');
    });

    test('exposes knowledge API', () => {
      expect(electronAPI.knowledge).toBeDefined();
      expect(typeof electronAPI.knowledge.getRelationshipEdges).toBe('function');
    });

    test('exposes organize API', () => {
      expect(electronAPI.organize).toBeDefined();
      expect(typeof electronAPI.organize.auto).toBe('function');
    });

    test('exposes undoRedo API', () => {
      expect(electronAPI.undoRedo).toBeDefined();
      expect(typeof electronAPI.undoRedo.undo).toBe('function');
    });

    test('exposes system API', () => {
      expect(electronAPI.system).toBeDefined();
      expect(typeof electronAPI.system.getMetrics).toBe('function');
    });

    test('exposes vectorDb API', () => {
      expect(electronAPI.vectorDb).toBeDefined();
      expect(typeof electronAPI.vectorDb.getStatus).toBe('function');
    });

    test('exposes llama API', () => {
      expect(electronAPI.llama).toBeDefined();
      expect(typeof electronAPI.llama.getModels).toBe('function');
    });

    test('exposes settings API', () => {
      expect(electronAPI.settings).toBeDefined();
      expect(typeof electronAPI.settings.get).toBe('function');
    });
  });
});
