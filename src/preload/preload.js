const { contextBridge, ipcRenderer } = require('electron');
const { Logger, LOG_LEVELS } = require('../shared/logger');
// Import IPC_CHANNELS from shared constants to avoid duplication
const { IPC_CHANNELS } = require('../shared/constants');
const { IpcRateLimiter } = require('./ipcRateLimiter');
const { createIpcSanitizer } = require('./ipcSanitizer');
const { createIpcValidator } = require('./ipcValidator');
const { sanitizePath } = require('../shared/pathSanitization');
// Import performance constants for configuration values
const { LIMITS: PERF_LIMITS, TIMEOUTS } = require('../shared/performanceConstants');
// Import centralized security config to avoid channel definition drift
const {
  ALLOWED_RECEIVE_CHANNELS: SECURITY_RECEIVE_CHANNELS,
  ALLOWED_SEND_CHANNELS: SECURITY_SEND_CHANNELS
} = require('../shared/securityConfig');

const preloadLogger = new Logger();
preloadLogger.setContext('Preload');
preloadLogger.setLevel(
  process?.env?.NODE_ENV === 'development' ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO
);

const log = {
  debug: (message, data) => preloadLogger.debug(message, data),
  info: (message, data) => preloadLogger.info(message, data),
  warn: (message, data) => preloadLogger.warn(message, data),
  error: (message, error) => {
    let errorPayload = error;
    if (error instanceof Error) {
      errorPayload = {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    } else if (typeof error === 'string') {
      errorPayload = { detail: error };
    }
    preloadLogger.error(message, errorPayload);
  }
};

log.info('Secure preload script loaded');

// Dynamically derive allowed send channels from centralized IPC_CHANNELS to prevent drift
// FIX: Removed hardcoded SETTINGS_EXTENDED - now all settings channels are in IPC_CHANNELS.SETTINGS
const ALLOWED_CHANNELS = {
  FILES: Object.values(IPC_CHANNELS.FILES),
  SMART_FOLDERS: Object.values(IPC_CHANNELS.SMART_FOLDERS),
  ANALYSIS: Object.values(IPC_CHANNELS.ANALYSIS),
  SETTINGS: Object.values(IPC_CHANNELS.SETTINGS), // Now includes all extended settings channels
  OLLAMA: Object.values(IPC_CHANNELS.OLLAMA),
  UNDO_REDO: Object.values(IPC_CHANNELS.UNDO_REDO),
  ANALYSIS_HISTORY: Object.values(IPC_CHANNELS.ANALYSIS_HISTORY),
  EMBEDDINGS: Object.values(IPC_CHANNELS.EMBEDDINGS),
  SYSTEM: Object.values(IPC_CHANNELS.SYSTEM),
  WINDOW: Object.values(IPC_CHANNELS.WINDOW || {}),
  SUGGESTIONS: Object.values(IPC_CHANNELS.SUGGESTIONS || {}),
  ORGANIZE: Object.values(IPC_CHANNELS.ORGANIZE || {}),
  CHROMADB: Object.values(IPC_CHANNELS.CHROMADB || {}),
  DEPENDENCIES: Object.values(IPC_CHANNELS.DEPENDENCIES || {}),
  CHAT: Object.values(IPC_CHANNELS.CHAT || {}),
  KNOWLEDGE: Object.values(IPC_CHANNELS.KNOWLEDGE || {})
};

// FIX: Use centralized security config to prevent drift between preload and main process
// FIX: Use IPC_CHANNELS constant instead of hardcoded string
const ALLOWED_RECEIVE_CHANNELS = [
  ...SECURITY_RECEIVE_CHANNELS,
  IPC_CHANNELS.CHROMADB.STATUS_CHANGED, // ChromaDB status events
  'open-semantic-search' // Global shortcut trigger from tray
];

// Allowed send channels (for ipcRenderer.send, not invoke)
// FIX: Use centralized security config
const ALLOWED_SEND_CHANNELS = [...SECURITY_SEND_CHANNELS];

// Flatten allowed send channels for validation
const ALL_SEND_CHANNELS = Object.values(ALLOWED_CHANNELS).flat();

const THROTTLED_CHANNELS = new Map([
  // Avoid request bursts on large folder scans.
  [IPC_CHANNELS.FILES.GET_FILE_STATS, 25]
]);

/**
 * Enhanced IPC validation with security checks
 */
class SecureIPCManager {
  constructor() {
    this.activeListeners = new Map();
    this.rateLimiter = new IpcRateLimiter({
      maxRequestsPerSecond: PERF_LIMITS.MAX_IPC_REQUESTS_PER_SECOND,
      perfLimits: PERF_LIMITS
    });
    this.channelQueues = new Map();
    this.sanitizer = createIpcSanitizer({ log });
    this.validator = createIpcValidator({ log });
  }

  /**
   * Rate limiting to prevent IPC abuse
   * Fixed: Add cleanup to prevent memory leaks
   */
  checkRateLimit(channel) {
    return this.rateLimiter.checkRateLimit(channel);
  }

  _getInvokeTimeout(channel) {
    let timeout = PERF_LIMITS.IPC_INVOKE_TIMEOUT || 30000;
    // Folder scans can legitimately take longer than default IPC timeout,
    // especially for large folders or slower/network drives.
    if (channel === IPC_CHANNELS.SMART_FOLDERS.SCAN_STRUCTURE) {
      timeout = TIMEOUTS.DIRECTORY_SCAN || 60000;
    }
    if (
      channel === IPC_CHANNELS.ANALYSIS.ANALYZE_IMAGE ||
      channel === IPC_CHANNELS.ANALYSIS.ANALYZE_DOCUMENT ||
      channel === IPC_CHANNELS.FILES.PERFORM_OPERATION ||
      channel === IPC_CHANNELS.ORGANIZE.BATCH
    ) {
      timeout = TIMEOUTS.AI_ANALYSIS_LONG || 120000;
    }
    return timeout;
  }

  async _invokeWithTimeout(channel, sanitizedArgs, timeout) {
    let completed = false;
    let timeoutId;

    try {
      const invokePromise = ipcRenderer.invoke(channel, ...sanitizedArgs);
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          if (!completed) {
            reject(new Error(`IPC timeout after ${timeout}ms for channel: ${channel}`));
          }
        }, timeout);
      });
      const result = await Promise.race([invokePromise, timeoutPromise]);
      completed = true;
      clearTimeout(timeoutId);
      return this.validator.validateResult(result, channel);
    } catch (error) {
      completed = true;
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async _invokeWithRetries(channel, sanitizedArgs, timeout) {
    const MAX_RETRIES = 5;
    let lastError;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this._invokeWithTimeout(channel, sanitizedArgs, timeout);
      } catch (error) {
        lastError = error;
        if (error.message && error.message.includes('No handler registered')) {
          log.warn(`Handler not ready for ${channel}, attempt ${attempt + 1}/${MAX_RETRIES}`);
          const RETRY_BASE_DELAY_MS = 100;
          await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** attempt));
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  }

  /**
   * FIX: Periodic audit of stale listeners to prevent memory leaks
   * Listeners that haven't been cleaned up in over 30 minutes are considered stale
   */
  auditStaleListeners() {
    const now = Date.now();
    const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
    let staleCount = 0;

    for (const [key] of this.activeListeners.entries()) {
      // Extract timestamp from key (format: channel_timestamp)
      const parts = key.split('_');
      const timestamp = parseInt(parts[parts.length - 1], 10);

      if (!isNaN(timestamp) && now - timestamp > STALE_THRESHOLD_MS) {
        staleCount++;
      }
    }

    // Audit listeners periodically
    if (staleCount > 0) {
      log.warn(`[SecureIPC] Found ${staleCount} potentially stale listeners`, {
        totalListeners: this.activeListeners.size,
        staleCount
      });
      // FIX HIGH-37: Force cleanup of stale listeners to prevent memory leak
      // We assume listeners older than 30m are leaks in a single-page app context
      for (const [key] of this.activeListeners.entries()) {
        const parts = key.split('_');
        const timestamp = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(timestamp) && now - timestamp > STALE_THRESHOLD_MS) {
          const listener = this.activeListeners.get(key);
          if (listener) {
            ipcRenderer.removeListener(listener.channel, listener.callback);
            this.activeListeners.delete(key);
          }
        }
      }
    }

    return staleCount;
  }

  // FIX CRIT-35: Remove async to ensure synchronous execution up to return
  enqueueThrottled(channel, task) {
    const delayMs = THROTTLED_CHANNELS.get(channel) || 0;
    const prev = this.channelQueues.get(channel) || Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        return task();
      })
      .finally(() => {
        if (this.channelQueues.get(channel) === next) {
          this.channelQueues.delete(channel);
        }
      });
    this.channelQueues.set(channel, next);
    return next;
  }

  /**
   * Secure invoke with validation and error handling
   */
  async safeInvoke(channel, ...args) {
    if (THROTTLED_CHANNELS.has(channel)) {
      return this.enqueueThrottled(channel, () => this.safeInvokeCore(channel, ...args));
    }
    return this.safeInvokeCore(channel, ...args);
  }

  async safeInvokeCore(channel, ...args) {
    try {
      // Channel validation
      if (!ALL_SEND_CHANNELS.includes(channel)) {
        log.warn(`Blocked invoke to unauthorized channel: ${channel}`);
        throw new Error(`Unauthorized IPC channel: ${channel}`);
      }

      // Rate limiting
      this.checkRateLimit(channel);

      // Argument sanitization
      const sanitizedArgs = this.sanitizer.sanitizeArguments(args);

      // Reduce log noise for high-frequency polling channels
      if (channel === IPC_CHANNELS.EMBEDDINGS.GET_STATS) {
        // Only log at debug level for stats polling
        if (process.env.NODE_ENV === 'development') {
          log.debug(`Secure invoke: ${channel}`);
        }
      } else {
        log.info(`Secure invoke: ${channel}${sanitizedArgs.length > 0 ? ' [with args]' : ''}`);
      }

      const timeout = this._getInvokeTimeout(channel);
      return await this._invokeWithRetries(channel, sanitizedArgs, timeout);
    } catch (error) {
      log.error(`IPC invoke error for ${channel}: ${error.message}`);
      throw new Error(`IPC Error: ${error.message}`);
    }
  }

  /**
   * Secure event listener with cleanup tracking
   */
  safeOn(channel, callback) {
    if (!ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
      log.warn(`Blocked listener on unauthorized channel: ${channel}`);
      return () => {};
    }

    const wrappedCallback = (event, ...args) => {
      try {
        // Validate event source
        if (!this.validator.validateEventSource(event)) {
          log.warn(`Rejected event from invalid source on channel: ${channel}`);
          return;
        }

        // Sanitize incoming data
        const sanitizedArgs = this.sanitizer.sanitizeArguments(args);

        // Special handling for different event types
        if (channel === 'system-metrics' && sanitizedArgs.length === 1) {
          const data = sanitizedArgs[0];
          if (this.validator.isValidSystemMetrics(data)) {
            callback(data);
          } else {
            log.warn('Invalid system-metrics data rejected');
          }
        } else {
          callback(...sanitizedArgs);
        }
      } catch (error) {
        log.error(`Error in ${channel} event handler:`, error);
      }
    };

    ipcRenderer.on(channel, wrappedCallback);

    // Track listener for cleanup
    const listenerKey = `${channel}_${Date.now()}`;
    this.activeListeners.set(listenerKey, {
      channel,
      callback: wrappedCallback
    });

    // Return cleanup function
    return () => {
      ipcRenderer.removeListener(channel, wrappedCallback);
      this.activeListeners.delete(listenerKey);
    };
  }

  /**
   * Cleanup all active listeners
   */
  cleanup() {
    for (const { channel, callback } of this.activeListeners.values()) {
      ipcRenderer.removeListener(channel, callback);
    }
    this.activeListeners.clear();
    log.info('All IPC listeners cleaned up');
  }
}

// Initialize secure IPC manager
const secureIPC = new SecureIPCManager();

// Log derived invoke timeouts once at startup to help diagnose preload caching/reload issues.
try {
  log.info('[SecureIPC] Invoke timeouts', {
    defaultInvokeTimeoutMs: PERF_LIMITS.IPC_INVOKE_TIMEOUT || 30000,
    directoryScanTimeoutMs: TIMEOUTS.DIRECTORY_SCAN || 60000,
    scanStructureInvokeTimeoutMs: secureIPC._getInvokeTimeout(
      IPC_CHANNELS.SMART_FOLDERS.SCAN_STRUCTURE
    )
  });
} catch {
  // Non-fatal (logging only)
}

// FIX: Periodic listener audit to detect potential memory leaks (every 10 minutes)
// Store interval ID for cleanup on window unload
const LISTENER_AUDIT_INTERVAL_MS = 10 * 60 * 1000;
const listenerAuditIntervalId = setInterval(() => {
  try {
    secureIPC.auditStaleListeners();
  } catch (err) {
    // Silently ignore audit errors to avoid disrupting app functionality
  }
}, LISTENER_AUDIT_INTERVAL_MS);

/**
 * Throw on structured failure responses.
 *
 * Many IPC handlers return { success: boolean, error?: string } rather than throwing.
 * For operations that must not silently fail (like settings persistence), use this helper
 * to convert failures into exceptions so the renderer can show a real error.
 */
function throwIfFailed(result, opts = {}) {
  const { allowCanceled = true, defaultMessage = 'Operation failed' } = opts;
  if (!result || typeof result !== 'object') return result;
  if (!Object.prototype.hasOwnProperty.call(result, 'success')) return result;
  if (result.success !== false) return result;
  if (allowCanceled && (result.canceled === true || result.cancelled === true)) return result;
  const msg =
    (typeof result.error === 'string' && result.error) ||
    (typeof result.message === 'string' && result.message) ||
    defaultMessage;
  const err = new Error(msg);
  err.details = result;
  throw err;
}

// Cleanup on window unload
window.addEventListener('beforeunload', () => {
  // FIX: Clear the listener audit interval to prevent memory leaks on window recreation
  clearInterval(listenerAuditIntervalId);
  secureIPC.cleanup();
});

// Expose secure, typed API through context bridge
contextBridge.exposeInMainWorld('electronAPI', {
  // File Operations
  files: {
    select: () => secureIPC.safeInvoke(IPC_CHANNELS.FILES.SELECT),
    selectDirectory: () => secureIPC.safeInvoke(IPC_CHANNELS.FILES.SELECT_DIRECTORY),
    getDocumentsPath: () => secureIPC.safeInvoke(IPC_CHANNELS.FILES.GET_DOCUMENTS_PATH),
    createFolder: (fullPath) =>
      secureIPC.safeInvoke(IPC_CHANNELS.FILES.CREATE_FOLDER_DIRECT, fullPath),
    normalizePath: (p) => {
      try {
        if (typeof p !== 'string') return p;
        // CRITICAL FIX: Do NOT convert backslashes to forward slashes
        // This causes HTML encoding issues when paths go through IPC sanitization
        // Let the main process handle path normalization with Node.js path module

        // Only remove duplicate slashes (keeping backslash or forward slash as-is)
        let normalized = p.replace(/([\\/])+/g, '$1');

        // Remove trailing slash unless it's the root (check both separator types)
        if (normalized.length > 3 && (normalized.endsWith('/') || normalized.endsWith('\\'))) {
          // Keep trailing separator for roots like C:\ or /
          if (!(normalized.match(/^[A-Za-z]:[\\/]$/) || normalized === '/')) {
            normalized = normalized.slice(0, -1);
          }
        }
        return normalized;
      } catch {
        return p;
      }
    },
    getStats: async (filePath) => {
      const result = await secureIPC.safeInvoke(IPC_CHANNELS.FILES.GET_FILE_STATS, filePath);
      if (!result || typeof result !== 'object') {
        return result;
      }
      const success = result.success !== false;
      const stats = result.stats && typeof result.stats === 'object' ? result.stats : {};
      return {
        success,
        exists: success,
        error: result.error,
        ...stats
      };
    },
    getDirectoryContents: (dirPath) =>
      secureIPC.safeInvoke(IPC_CHANNELS.FILES.GET_FILES_IN_DIRECTORY, dirPath),
    organize: (operations) =>
      secureIPC.safeInvoke(IPC_CHANNELS.FILES.PERFORM_OPERATION, {
        type: 'batch_organize',
        operations
      }),
    performOperation: (operations) =>
      secureIPC.safeInvoke(IPC_CHANNELS.FILES.PERFORM_OPERATION, operations),
    delete: (filePath) => secureIPC.safeInvoke(IPC_CHANNELS.FILES.DELETE_FILE, filePath),
    // Add missing file operations that the UI is calling
    open: (filePath) => secureIPC.safeInvoke(IPC_CHANNELS.FILES.OPEN_FILE, filePath),
    reveal: (filePath) => secureIPC.safeInvoke(IPC_CHANNELS.FILES.REVEAL_FILE, filePath),
    copy: (sourcePath, destinationPath) =>
      secureIPC.safeInvoke(IPC_CHANNELS.FILES.COPY_FILE, sourcePath, destinationPath),
    openFolder: (folderPath) => secureIPC.safeInvoke(IPC_CHANNELS.FILES.OPEN_FOLDER, folderPath),
    deleteFolder: (folderPath) =>
      secureIPC.safeInvoke(IPC_CHANNELS.FILES.DELETE_FOLDER, folderPath),
    // Add file analysis method that routes to appropriate analyzer
    analyze: (filePath) => {
      // Fixed: Enhanced path validation to prevent directory traversal and unauthorized access
      // CRITICAL FIX: Do NOT normalize path separators here - let main process handle it
      // Converting backslashes to forward slashes causes HTML encoding issues
      try {
        // Normalize incoming value (arrays, objects, quoted strings)
        if (Array.isArray(filePath) && filePath.length > 0) {
          filePath = filePath[0];
        }
        if (filePath && typeof filePath === 'object' && filePath.path) {
          filePath = filePath.path;
        }
        if (typeof filePath === 'string') {
          filePath = filePath.trim().replace(/^['"](.*)['"]$/, '$1');
        }

        // Normalize file:// URIs to filesystem paths (handles Windows drive prefix)
        if (typeof filePath === 'string' && filePath.toLowerCase().startsWith('file://')) {
          try {
            filePath = sanitizePath(filePath);
          } catch {
            // fall through to validation
          }
        }

        // Allow any non-empty local path; block obvious remote URLs
        if (
          !filePath ||
          typeof filePath !== 'string' ||
          filePath.length === 0 ||
          filePath.startsWith('http://') ||
          filePath.startsWith('https://')
        ) {
          throw new Error('Invalid file path');
        }

        // Require absolute filesystem path to avoid CWD-relative resolution
        const isAbsolute =
          /^[a-zA-Z]:[\\/]/.test(filePath) ||
          filePath.startsWith('\\\\') ||
          filePath.startsWith('/');
        if (!isAbsolute) {
          throw new Error('Invalid file path: must be an absolute path');
        }

        // Extract file extension without path module (check both separator types)
        const lastDot = filePath.lastIndexOf('.');
        const lastForwardSlash = filePath.lastIndexOf('/');
        const lastBackSlash = filePath.lastIndexOf('\\');
        const lastSlash = Math.max(lastForwardSlash, lastBackSlash);
        let ext = '';

        if (lastDot > lastSlash && lastDot > 0) {
          ext = filePath.slice(lastDot + 1).toLowerCase();
        }

        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'tiff'];

        if (imageExts.includes(ext)) {
          return secureIPC.safeInvoke(IPC_CHANNELS.ANALYSIS.ANALYZE_IMAGE, filePath);
        }
        // Audio analysis removed - all non-image files go to document analysis
        return secureIPC.safeInvoke(IPC_CHANNELS.ANALYSIS.ANALYZE_DOCUMENT, filePath);
      } catch (error) {
        log.error('File analysis security check failed:', error);
        return Promise.reject(error);
      }
    }
  },

  // Smart Folders
  smartFolders: {
    get: () => secureIPC.safeInvoke(IPC_CHANNELS.SMART_FOLDERS.GET),
    save: (folders) => secureIPC.safeInvoke(IPC_CHANNELS.SMART_FOLDERS.SAVE, folders),
    updateCustom: (folders) =>
      secureIPC.safeInvoke(IPC_CHANNELS.SMART_FOLDERS.UPDATE_CUSTOM, folders),
    getCustom: () => secureIPC.safeInvoke(IPC_CHANNELS.SMART_FOLDERS.GET_CUSTOM),
    scanStructure: (rootPath) =>
      secureIPC.safeInvoke(IPC_CHANNELS.SMART_FOLDERS.SCAN_STRUCTURE, rootPath),
    add: (folder) => secureIPC.safeInvoke(IPC_CHANNELS.SMART_FOLDERS.ADD, folder),
    edit: (folderId, updatedFolder) =>
      secureIPC.safeInvoke(IPC_CHANNELS.SMART_FOLDERS.EDIT, folderId, updatedFolder),
    delete: (folderId) => secureIPC.safeInvoke(IPC_CHANNELS.SMART_FOLDERS.DELETE, folderId),
    match: (text, folders) =>
      secureIPC.safeInvoke(IPC_CHANNELS.SMART_FOLDERS.MATCH, {
        text,
        smartFolders: folders
      }),
    resetToDefaults: () => secureIPC.safeInvoke(IPC_CHANNELS.SMART_FOLDERS.RESET_TO_DEFAULTS),
    generateDescription: (folderName) =>
      secureIPC.safeInvoke(IPC_CHANNELS.SMART_FOLDERS.GENERATE_DESCRIPTION, folderName),
    // Smart Folder Watcher - auto-analyze files in smart folders
    watcherStart: () => secureIPC.safeInvoke(IPC_CHANNELS.SMART_FOLDERS.WATCHER_START),
    watcherStop: () => secureIPC.safeInvoke(IPC_CHANNELS.SMART_FOLDERS.WATCHER_STOP),
    watcherStatus: () => secureIPC.safeInvoke(IPC_CHANNELS.SMART_FOLDERS.WATCHER_STATUS),
    watcherScan: () => secureIPC.safeInvoke(IPC_CHANNELS.SMART_FOLDERS.WATCHER_SCAN)
  },

  // Analysis
  analysis: {
    document: (filePath) => secureIPC.safeInvoke(IPC_CHANNELS.ANALYSIS.ANALYZE_DOCUMENT, filePath),
    image: (filePath) => secureIPC.safeInvoke(IPC_CHANNELS.ANALYSIS.ANALYZE_IMAGE, filePath),
    extractText: (filePath) =>
      secureIPC.safeInvoke(IPC_CHANNELS.ANALYSIS.EXTRACT_IMAGE_TEXT, filePath)
  },

  // Analysis History
  analysisHistory: {
    get: (options) => secureIPC.safeInvoke(IPC_CHANNELS.ANALYSIS_HISTORY.GET, options),
    search: (query, options) =>
      secureIPC.safeInvoke(IPC_CHANNELS.ANALYSIS_HISTORY.SEARCH, query, options),
    getStatistics: () => secureIPC.safeInvoke(IPC_CHANNELS.ANALYSIS_HISTORY.GET_STATISTICS),
    getFileHistory: (filePath) =>
      secureIPC.safeInvoke(IPC_CHANNELS.ANALYSIS_HISTORY.GET_FILE_HISTORY, filePath),
    clear: () => secureIPC.safeInvoke(IPC_CHANNELS.ANALYSIS_HISTORY.CLEAR),
    export: (format) => secureIPC.safeInvoke(IPC_CHANNELS.ANALYSIS_HISTORY.EXPORT, format)
  },

  // Embeddings / Semantic
  embeddings: {
    rebuildFolders: () => secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.REBUILD_FOLDERS),
    rebuildFiles: () => secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.REBUILD_FILES),
    fullRebuild: () => secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.FULL_REBUILD),
    reanalyzeAll: (options) => secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.REANALYZE_ALL, options),
    clearStore: () => secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.CLEAR_STORE),
    getStats: () => secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.GET_STATS),
    // Enhanced search with hybrid BM25 + vector fusion
    // Options: { topK, mode: 'hybrid'|'vector'|'bm25', minScore, chunkWeight, chunkTopK, ... }
    search: (query, options = {}) => {
      const {
        topK = 20,
        mode = 'hybrid',
        minScore,
        chunkWeight,
        chunkTopK,
        correctSpelling,
        expandSynonyms,
        rerank,
        rerankTopN
      } = options;

      return secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.SEARCH, {
        query,
        topK,
        mode,
        // Optional numerical/boolean parameters
        ...(typeof minScore === 'number' && { minScore }),
        ...(typeof chunkWeight === 'number' && { chunkWeight }),
        ...(Number.isInteger(chunkTopK) && { chunkTopK }),
        ...(typeof correctSpelling === 'boolean' && { correctSpelling }),
        ...(typeof expandSynonyms === 'boolean' && { expandSynonyms }),
        ...(typeof rerank === 'boolean' && { rerank }),
        ...(Number.isInteger(rerankTopN) && { rerankTopN })
      });
    },
    scoreFiles: (query, fileIds) =>
      secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.SCORE_FILES, {
        query,
        fileIds
      }),
    findSimilar: (fileId, topK = 10) =>
      secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.FIND_SIMILAR, {
        fileId,
        topK
      }),
    // NOTE: hybridSearch removed - use search() with mode: 'hybrid' instead
    rebuildBM25Index: () => secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.REBUILD_BM25_INDEX),
    getSearchStatus: () => secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.GET_SEARCH_STATUS),
    // Diagnostic endpoint for troubleshooting search issues
    diagnoseSearch: (testQuery = 'test') =>
      secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.DIAGNOSE_SEARCH, { testQuery }),
    // Multi-hop expansion
    findMultiHop: (seedIds, options = {}) =>
      secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.FIND_MULTI_HOP, {
        seedIds,
        options
      }),
    // Clustering
    computeClusters: (k = 'auto') =>
      secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.COMPUTE_CLUSTERS, { k }),
    getClusters: () => secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.GET_CLUSTERS),
    getClusterMembers: (clusterId) =>
      secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.GET_CLUSTER_MEMBERS, { clusterId }),
    getSimilarityEdges: (fileIds, options = {}) =>
      secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.GET_SIMILARITY_EDGES, {
        fileIds,
        threshold: options.threshold,
        maxEdgesPerNode: options.maxEdgesPerNode
      }),
    // Get fresh file metadata from ChromaDB (for current paths after moves)
    getFileMetadata: (fileIds) =>
      secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.GET_FILE_METADATA, { fileIds }),
    // Find near-duplicate files based on embedding similarity
    findDuplicates: (options) =>
      secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.FIND_DUPLICATES, options || {}),
    // FIX: Clear cluster cache manually (allows forcing recalculation)
    clearClusters: () => secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.CLEAR_CLUSTERS)
  },

  // Chat / Document QA
  chat: {
    query: (payload) => secureIPC.safeInvoke(IPC_CHANNELS.CHAT.QUERY, payload),
    resetSession: (sessionId) =>
      secureIPC.safeInvoke(IPC_CHANNELS.CHAT.RESET_SESSION, { sessionId })
  },

  // Knowledge relationships
  knowledge: {
    getRelationshipEdges: (fileIds, options = {}) =>
      secureIPC.safeInvoke(IPC_CHANNELS.KNOWLEDGE.GET_RELATIONSHIP_EDGES, {
        fileIds,
        minWeight: options.minWeight,
        maxEdges: options.maxEdges
      })
  },

  // Organization Suggestions
  suggestions: {
    getFileSuggestions: (file, options) =>
      secureIPC.safeInvoke(IPC_CHANNELS.SUGGESTIONS.GET_FILE_SUGGESTIONS, {
        file,
        options
      }),
    getBatchSuggestions: (files, options) =>
      secureIPC.safeInvoke(IPC_CHANNELS.SUGGESTIONS.GET_BATCH_SUGGESTIONS, {
        files,
        options
      }),
    recordFeedback: (file, suggestion, accepted, note) =>
      secureIPC.safeInvoke(IPC_CHANNELS.SUGGESTIONS.RECORD_FEEDBACK, {
        file,
        suggestion,
        accepted,
        note
      }),
    getStrategies: () => secureIPC.safeInvoke(IPC_CHANNELS.SUGGESTIONS.GET_STRATEGIES),
    applyStrategy: (files, strategyId) =>
      secureIPC.safeInvoke(IPC_CHANNELS.SUGGESTIONS.APPLY_STRATEGY, {
        files,
        strategyId
      }),
    getUserPatterns: () => secureIPC.safeInvoke(IPC_CHANNELS.SUGGESTIONS.GET_USER_PATTERNS),
    clearPatterns: () => secureIPC.safeInvoke(IPC_CHANNELS.SUGGESTIONS.CLEAR_PATTERNS),
    analyzeFolderStructure: (files) =>
      secureIPC.safeInvoke(IPC_CHANNELS.SUGGESTIONS.ANALYZE_FOLDER_STRUCTURE, {
        files
      }),
    suggestNewFolder: (file) =>
      secureIPC.safeInvoke(IPC_CHANNELS.SUGGESTIONS.SUGGEST_NEW_FOLDER, {
        file
      }),
    addFeedbackMemory: (text, metadata) =>
      secureIPC.safeInvoke(IPC_CHANNELS.SUGGESTIONS.ADD_FEEDBACK_MEMORY, {
        text,
        metadata
      }),
    getFeedbackMemory: () => secureIPC.safeInvoke(IPC_CHANNELS.SUGGESTIONS.GET_FEEDBACK_MEMORY),
    updateFeedbackMemory: (id, text, metadata) =>
      secureIPC.safeInvoke(IPC_CHANNELS.SUGGESTIONS.UPDATE_FEEDBACK_MEMORY, {
        id,
        text,
        metadata
      }),
    deleteFeedbackMemory: (id) =>
      secureIPC.safeInvoke(IPC_CHANNELS.SUGGESTIONS.DELETE_FEEDBACK_MEMORY, {
        id
      })
  },

  // Auto-Organize
  organize: {
    auto: (params) => secureIPC.safeInvoke(IPC_CHANNELS.ORGANIZE.AUTO, params),
    batch: (params) => secureIPC.safeInvoke(IPC_CHANNELS.ORGANIZE.BATCH, params),
    processNew: (params) => secureIPC.safeInvoke(IPC_CHANNELS.ORGANIZE.PROCESS_NEW, params),
    getStats: () => secureIPC.safeInvoke(IPC_CHANNELS.ORGANIZE.GET_STATS),
    updateThresholds: (thresholds) =>
      secureIPC.safeInvoke(IPC_CHANNELS.ORGANIZE.UPDATE_THRESHOLDS, {
        thresholds
      }),
    // Cluster-based organization
    clusterBatch: (files, smartFolders) =>
      secureIPC.safeInvoke(IPC_CHANNELS.ORGANIZE.CLUSTER_BATCH, { files, smartFolders }),
    identifyOutliers: (files) =>
      secureIPC.safeInvoke(IPC_CHANNELS.ORGANIZE.IDENTIFY_OUTLIERS, { files }),
    getClusterSuggestions: (file, smartFolders) =>
      secureIPC.safeInvoke(IPC_CHANNELS.ORGANIZE.GET_CLUSTER_SUGGESTIONS, { file, smartFolders })
  },

  // Undo/Redo System
  undoRedo: {
    undo: () => secureIPC.safeInvoke(IPC_CHANNELS.UNDO_REDO.UNDO),
    redo: () => secureIPC.safeInvoke(IPC_CHANNELS.UNDO_REDO.REDO),
    getHistory: (limit) => secureIPC.safeInvoke(IPC_CHANNELS.UNDO_REDO.GET_HISTORY, limit),
    clear: () => secureIPC.safeInvoke(IPC_CHANNELS.UNDO_REDO.CLEAR_HISTORY),
    canUndo: () => secureIPC.safeInvoke(IPC_CHANNELS.UNDO_REDO.CAN_UNDO),
    canRedo: () => secureIPC.safeInvoke(IPC_CHANNELS.UNDO_REDO.CAN_REDO),
    // FIX H-3: Listen for state changes after undo/redo operations
    // FIX: Use secureIPC.safeOn() for proper event source validation and cleanup tracking
    onStateChanged: (callback) => secureIPC.safeOn(IPC_CHANNELS.UNDO_REDO.STATE_CHANGED, callback)
  },

  // System Monitoring
  system: {
    getMetrics: () => secureIPC.safeInvoke(IPC_CHANNELS.SYSTEM.GET_METRICS),
    getApplicationStatistics: () =>
      secureIPC.safeInvoke(IPC_CHANNELS.SYSTEM.GET_APPLICATION_STATISTICS),
    applyUpdate: () =>
      IPC_CHANNELS.SYSTEM.APPLY_UPDATE
        ? secureIPC.safeInvoke(IPC_CHANNELS.SYSTEM.APPLY_UPDATE)
        : undefined,
    // FIX: Expose config handlers that were registered but not exposed
    getConfig: () => secureIPC.safeInvoke(IPC_CHANNELS.SYSTEM.GET_CONFIG),
    getConfigValue: (path) => secureIPC.safeInvoke(IPC_CHANNELS.SYSTEM.GET_CONFIG_VALUE, path),
    // Get recommended concurrency based on system capabilities (VRAM, etc.)
    getRecommendedConcurrency: () =>
      secureIPC.safeInvoke(IPC_CHANNELS.SYSTEM.GET_RECOMMENDED_CONCURRENCY),
    // Listen for semantic search trigger from tray/global shortcut
    // FIX: Use secureIPC.safeOn() for proper event source validation and cleanup tracking
    onOpenSemanticSearch: (callback) => secureIPC.safeOn('open-semantic-search', callback)
  },

  // Window controls (Windows custom title bar)
  window: {
    minimize: () =>
      IPC_CHANNELS.WINDOW?.MINIMIZE
        ? secureIPC.safeInvoke(IPC_CHANNELS.WINDOW.MINIMIZE)
        : undefined,
    maximize: () =>
      IPC_CHANNELS.WINDOW?.MAXIMIZE
        ? secureIPC.safeInvoke(IPC_CHANNELS.WINDOW.MAXIMIZE)
        : undefined,
    unmaximize: () =>
      IPC_CHANNELS.WINDOW?.UNMAXIMIZE
        ? secureIPC.safeInvoke(IPC_CHANNELS.WINDOW.UNMAXIMIZE)
        : undefined,
    toggleMaximize: () =>
      IPC_CHANNELS.WINDOW?.TOGGLE_MAXIMIZE
        ? secureIPC.safeInvoke(IPC_CHANNELS.WINDOW.TOGGLE_MAXIMIZE)
        : undefined,
    isMaximized: () =>
      IPC_CHANNELS.WINDOW?.IS_MAXIMIZED
        ? secureIPC.safeInvoke(IPC_CHANNELS.WINDOW.IS_MAXIMIZED)
        : undefined,
    close: () =>
      IPC_CHANNELS.WINDOW?.CLOSE ? secureIPC.safeInvoke(IPC_CHANNELS.WINDOW.CLOSE) : undefined
  },

  // Ollama (only implemented endpoints)
  ollama: {
    getModels: () => secureIPC.safeInvoke(IPC_CHANNELS.OLLAMA.GET_MODELS),
    testConnection: (hostUrl) => secureIPC.safeInvoke(IPC_CHANNELS.OLLAMA.TEST_CONNECTION, hostUrl),
    pullModels: (models) => secureIPC.safeInvoke(IPC_CHANNELS.OLLAMA.PULL_MODELS, models),
    deleteModel: (model) => secureIPC.safeInvoke(IPC_CHANNELS.OLLAMA.DELETE_MODEL, model)
  },

  // Event Listeners (with automatic cleanup)
  events: {
    onOperationProgress: (callback) => secureIPC.safeOn('operation-progress', callback),
    onAppError: (callback) => secureIPC.safeOn('app:error', callback),
    onAppUpdate: (callback) => secureIPC.safeOn('app:update', callback),
    // NOTE: startup-progress and startup-error listeners removed (dead code - events never sent)
    onSystemMetrics: (callback) => secureIPC.safeOn('system-metrics', callback),
    onMenuAction: (callback) => secureIPC.safeOn('menu-action', callback),
    onSettingsChanged: (callback) => secureIPC.safeOn('settings-changed-external', callback),
    onOperationError: (callback) => secureIPC.safeOn('operation-error', callback),
    onOperationComplete: (callback) => secureIPC.safeOn('operation-complete', callback),
    onOperationFailed: (callback) => secureIPC.safeOn('operation-failed', callback),
    // File operation events (move/delete) for search index invalidation
    onFileOperationComplete: (callback) => secureIPC.safeOn('file-operation-complete', callback),
    // Notification events from watchers (SmartFolderWatcher, DownloadWatcher)
    onNotification: (callback) => secureIPC.safeOn('notification', callback),
    // FIX: Batch results chunk events for progressive streaming during batch operations
    onBatchResultsChunk: (callback) => secureIPC.safeOn('batch-results-chunk', callback),
    // Send error report to main process (uses send, not invoke)
    sendError: (errorData) => {
      try {
        // Validate error data structure
        if (!errorData || typeof errorData !== 'object' || !errorData.message) {
          log.warn('[events.sendError] Invalid error data structure');
          return;
        }
        // FIX: Use constant instead of hardcoded string
        const channel = IPC_CHANNELS.SYSTEM.RENDERER_ERROR_REPORT;
        if (!ALLOWED_SEND_CHANNELS.includes(channel)) {
          log.warn(`[events.sendError] Blocked send to unauthorized channel: ${channel}`);
          return;
        }
        // Send error report to main process
        // This uses send instead of invoke since it's fire-and-forget
        ipcRenderer.send(channel, errorData);
      } catch (error) {
        log.error('[events.sendError] Failed to send error report:', error);
      }
    }
  },

  // Settings - FIX: Use centralized IPC_CHANNELS constants to prevent drift
  settings: {
    get: async () => {
      const result = await secureIPC.safeInvoke(IPC_CHANNELS.SETTINGS.GET);
      return throwIfFailed(result, {
        allowCanceled: false,
        defaultMessage: 'Failed to load settings'
      });
    },
    save: async (settings) => {
      const result = await secureIPC.safeInvoke(IPC_CHANNELS.SETTINGS.SAVE, settings);
      // If persistence fails, throw so renderer can't "pretend" it saved.
      return throwIfFailed(result, {
        allowCanceled: false,
        defaultMessage: 'Failed to save settings'
      });
    },
    getConfigurableLimits: () =>
      secureIPC.safeInvoke(IPC_CHANNELS.SETTINGS.GET_CONFIGURABLE_LIMITS),
    getLogsInfo: () => secureIPC.safeInvoke(IPC_CHANNELS.SETTINGS.GET_LOGS_INFO),
    openLogsFolder: () => secureIPC.safeInvoke(IPC_CHANNELS.SETTINGS.OPEN_LOGS_FOLDER),
    export: async (exportPath) => {
      const result = await secureIPC.safeInvoke(IPC_CHANNELS.SETTINGS.EXPORT, exportPath);
      return throwIfFailed(result, {
        allowCanceled: true,
        defaultMessage: 'Failed to export settings'
      });
    },
    import: async (importPath) => {
      const result = await secureIPC.safeInvoke(IPC_CHANNELS.SETTINGS.IMPORT, importPath);
      return throwIfFailed(result, {
        allowCanceled: true,
        defaultMessage: 'Failed to import settings'
      });
    },
    createBackup: () => secureIPC.safeInvoke(IPC_CHANNELS.SETTINGS.CREATE_BACKUP),
    listBackups: () => secureIPC.safeInvoke(IPC_CHANNELS.SETTINGS.LIST_BACKUPS),
    restoreBackup: async (backupPath) => {
      const result = await secureIPC.safeInvoke(IPC_CHANNELS.SETTINGS.RESTORE_BACKUP, backupPath);
      return throwIfFailed(result, {
        allowCanceled: false,
        defaultMessage: 'Failed to restore settings backup'
      });
    },
    deleteBackup: async (backupPath) => {
      const result = await secureIPC.safeInvoke(IPC_CHANNELS.SETTINGS.DELETE_BACKUP, backupPath);
      return throwIfFailed(result, {
        allowCanceled: false,
        defaultMessage: 'Failed to delete settings backup'
      });
    }
  },

  // ChromaDB Service Status
  chromadb: {
    getStatus: () => secureIPC.safeInvoke(IPC_CHANNELS.CHROMADB.GET_STATUS),
    getCircuitStats: () => secureIPC.safeInvoke(IPC_CHANNELS.CHROMADB.GET_CIRCUIT_STATS),
    getQueueStats: () => secureIPC.safeInvoke(IPC_CHANNELS.CHROMADB.GET_QUEUE_STATS),
    forceRecovery: () => secureIPC.safeInvoke(IPC_CHANNELS.CHROMADB.FORCE_RECOVERY),
    healthCheck: () => secureIPC.safeInvoke(IPC_CHANNELS.CHROMADB.HEALTH_CHECK),
    // FIX: Use IPC_CHANNELS constant instead of hardcoded string
    onStatusChanged: (callback) => secureIPC.safeOn(IPC_CHANNELS.CHROMADB.STATUS_CHANGED, callback)
  },

  // Dependency Management (Ollama + ChromaDB)
  dependencies: {
    getStatus: () => secureIPC.safeInvoke(IPC_CHANNELS.DEPENDENCIES.GET_STATUS),
    installOllama: () => secureIPC.safeInvoke(IPC_CHANNELS.DEPENDENCIES.INSTALL_OLLAMA),
    installChromaDb: () => secureIPC.safeInvoke(IPC_CHANNELS.DEPENDENCIES.INSTALL_CHROMADB),
    updateOllama: () => secureIPC.safeInvoke(IPC_CHANNELS.DEPENDENCIES.UPDATE_OLLAMA),
    updateChromaDb: () => secureIPC.safeInvoke(IPC_CHANNELS.DEPENDENCIES.UPDATE_CHROMADB),
    // Event listener for service status changes (ChromaDB/Ollama start/stop/health)
    onServiceStatusChanged: (callback) =>
      secureIPC.safeOn(IPC_CHANNELS.DEPENDENCIES.SERVICE_STATUS_CHANGED, callback)
  }
});

// Legacy compatibility layer removed - use window.electronAPI instead

log.info('Secure context bridge exposed with structured API');
