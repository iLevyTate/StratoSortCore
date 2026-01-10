const { contextBridge, ipcRenderer } = require('electron');
const { Logger, LOG_LEVELS } = require('../shared/logger');
// Import IPC_CHANNELS from shared constants to avoid duplication
const { IPC_CHANNELS } = require('../shared/constants');
// Import performance constants for configuration values
const { LIMITS: PERF_LIMITS } = require('../shared/performanceConstants');
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
  DEPENDENCIES: Object.values(IPC_CHANNELS.DEPENDENCIES || {})
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

/**
 * Enhanced IPC validation with security checks
 */
class SecureIPCManager {
  constructor() {
    this.activeListeners = new Map();
    this.rateLimiter = new Map();
    this.maxRequestsPerSecond = PERF_LIMITS.MAX_IPC_REQUESTS_PER_SECOND; // From centralized config
  }

  /**
   * Rate limiting to prevent IPC abuse
   * Fixed: Add cleanup to prevent memory leaks
   */
  checkRateLimit(channel) {
    const now = Date.now();
    const channelData = this.rateLimiter.get(channel) || {
      count: 0,
      resetTime: now + 1000
    };

    if (now > channelData.resetTime) {
      channelData.count = 1;
      channelData.resetTime = now + 1000;
    } else {
      channelData.count++;
    }

    this.rateLimiter.set(channel, channelData);

    // Fixed: Cleanup old rate limit entries to prevent memory leak
    if (this.rateLimiter.size > PERF_LIMITS.RATE_LIMIT_CLEANUP_THRESHOLD) {
      // Arbitrary limit
      const staleEntries = [];
      for (const [ch, data] of this.rateLimiter.entries()) {
        // Remove entries that are more than 1 minute old
        if (now > data.resetTime + PERF_LIMITS.RATE_LIMIT_STALE_MS) {
          staleEntries.push(ch);
        }
      }
      staleEntries.forEach((ch) => this.rateLimiter.delete(ch));
    }

    if (channelData.count > this.maxRequestsPerSecond) {
      const resetIn = Math.ceil((channelData.resetTime - now) / 1000);
      throw new Error(
        `Rate limit exceeded for channel: ${channel}. Please wait ${resetIn}s before retrying. Consider reducing concurrent requests.`
      );
    }

    return true;
  }

  /**
   * Secure invoke with validation and error handling
   */
  async safeInvoke(channel, ...args) {
    try {
      // Channel validation
      if (!ALL_SEND_CHANNELS.includes(channel)) {
        log.warn(`Blocked invoke to unauthorized channel: ${channel}`);
        throw new Error(`Unauthorized IPC channel: ${channel}`);
      }

      // Rate limiting
      this.checkRateLimit(channel);

      // Argument sanitization
      const sanitizedArgs = this.sanitizeArguments(args);

      // Reduce log noise for high-frequency polling channels
      if (channel === IPC_CHANNELS.EMBEDDINGS.GET_STATS) {
        // Only log at debug level for stats polling
        if (process.env.NODE_ENV === 'development') {
          log.debug(`Secure invoke: ${channel}`);
        }
      } else {
        log.info(`Secure invoke: ${channel}${sanitizedArgs.length > 0 ? ' [with args]' : ''}`);
      }

      // Add retry logic for handler not registered errors
      // 5 attempts with exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms (total ~3.1s)
      const MAX_RETRIES = 5;
      let lastError;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const result = await ipcRenderer.invoke(channel, ...sanitizedArgs);
          // Result validation
          return this.validateResult(result, channel);
        } catch (error) {
          lastError = error;
          // Check if it's a "No handler registered" error
          if (error.message && error.message.includes('No handler registered')) {
            log.warn(`Handler not ready for ${channel}, attempt ${attempt + 1}/${MAX_RETRIES}`);
            // Wait before retrying (exponential backoff)
            // Base delay: 100ms, doubles with each attempt
            const RETRY_BASE_DELAY_MS = 100;
            await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** attempt));
            continue;
          }
          // For other errors, throw immediately
          throw error;
        }
      }

      // If we exhausted retries, throw the last error
      throw lastError;
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
        if (!this.validateEventSource(event)) {
          log.warn(`Rejected event from invalid source on channel: ${channel}`);
          return;
        }

        // Sanitize incoming data
        const sanitizedArgs = this.sanitizeArguments(args);

        // Special handling for different event types
        if (channel === 'system-metrics' && sanitizedArgs.length === 1) {
          const data = sanitizedArgs[0];
          if (this.isValidSystemMetrics(data)) {
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
   * Validate event source to prevent spoofing
   */
  validateEventSource(event) {
    // Basic validation - in production, implement more sophisticated checks
    return event && event.sender && typeof event.sender === 'object';
  }

  /**
   * Sanitize arguments to prevent injection attacks
   * Fixed: Detect file path arguments and skip HTML sanitization for them
   */
  sanitizeArguments(args) {
    return args.map((arg) => {
      // Check if this argument looks like a file path
      const isFilePath = typeof arg === 'string' && this.looksLikeFilePath(arg);
      return this.sanitizeObject(arg, isFilePath);
    });
  }

  /**
   * Deep sanitization for objects
   * Fixed: Added prototype pollution protection
   * Fixed: File paths should NOT be HTML sanitized (breaks file system operations)
   */
  sanitizeObject(obj, isFilePath = false) {
    if (typeof obj === 'string') {
      // File paths should NOT be HTML sanitized - they need to remain valid file system paths
      if (isFilePath || this.looksLikeFilePath(obj)) {
        // Only remove null bytes and dangerous characters, but preserve path structure
        return this.stripControlChars(obj).replace(/[<>"|?*]/g, '');
      }
      // URLs should NOT be HTML sanitized - encoding slashes breaks URL validation
      if (this.looksLikeUrl(obj)) {
        // Only remove null bytes and dangerous characters, preserve URL structure
        return this.stripControlChars(obj).replace(/[<>"|*]/g, '');
      }
      // Basic HTML sanitization for non-file-path, non-URL strings
      return this.basicSanitizeHtml(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item, isFilePath));
    }

    if (obj && typeof obj === 'object') {
      const sanitized = {};
      // Dangerous keys that could lead to prototype pollution
      const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

      for (const [key, value] of Object.entries(obj)) {
        // Skip dangerous keys
        if (dangerousKeys.includes(key)) {
          log.warn(`Blocked dangerous object key: ${key}`);
          continue;
        }

        // Check if this key/value pair represents a file path
        const isPathKey = key.toLowerCase().includes('path') || key.toLowerCase().includes('file');
        const cleanKey = isPathKey ? key : this.basicSanitizeHtml(key);

        // Double-check the cleaned key isn't dangerous
        if (dangerousKeys.includes(cleanKey)) {
          log.warn(`Blocked dangerous sanitized key: ${cleanKey}`);
          continue;
        }

        sanitized[cleanKey] = this.sanitizeObject(value, isPathKey);
      }
      return sanitized;
    }

    return obj;
  }

  /**
   * Remove ASCII control characters from a string without using control-char regexes
   */
  stripControlChars(str) {
    if (typeof str !== 'string') return str;
    let output = '';
    for (let i = 0; i < str.length; i += 1) {
      const code = str.charCodeAt(i);
      if (code >= 32) {
        output += str[i];
      }
    }
    return output;
  }

  /**
   * Check if a string looks like a file path
   * File paths typically contain drive letters (Windows) or start with / (Unix)
   */
  looksLikeFilePath(str) {
    if (typeof str !== 'string' || str.length === 0) return false;

    // Check for HTML tags first - if it contains < or >, it's likely HTML, not a file path
    if (str.includes('<') || str.includes('>')) {
      return false;
    }

    // MEDIUM PRIORITY FIX (MED-6): Enhanced Unicode and space support for path detection
    // Windows path: C:\ or C:/ (drive letter can be any letter)
    if (/^[A-Za-z]:[\\/]/.test(str)) return true;

    // Unix absolute path: starts with /
    // Support Unicode characters and spaces in path names
    // Match any non-null character after the slash (Unicode-safe)
    // eslint-disable-next-line no-useless-escape
    if (/^\/[\p{L}\p{N}\p{M}\s._-]/u.test(str)) return true;

    // UNC paths: \\server\share or //server/share
    if (/^[\\/]{2}[\p{L}\p{N}\p{M}\s._-]/u.test(str)) return true;

    // Relative path with typical file extensions
    // Support Unicode letters, numbers, combining marks, spaces
    if (/^[\p{L}\p{N}\p{M}\s_.-]+\/[\p{L}\p{N}\p{M}\s_./-]+\.[\p{L}\p{N}]+$/u.test(str)) {
      return true;
    }

    // If it contains backslash (Windows path separator), it's likely a path
    if (str.includes('\\')) {
      // But not if it also contains HTML-like content
      if (!str.includes('=') && !str.includes('"')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a string looks like a URL
   * Used to skip HTML sanitization which would break URL structure
   */
  looksLikeUrl(str) {
    if (typeof str !== 'string' || str.length === 0) return false;

    // Check for HTML tags first - if it contains < or >, it's likely HTML, not a URL
    if (str.includes('<') || str.includes('>')) {
      return false;
    }

    // HTTP/HTTPS URLs
    if (/^https?:\/\//i.test(str)) return true;

    // Common localhost patterns (with port)
    if (/^localhost(:\d+)?/i.test(str)) return true;

    // IP address with optional port
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/.test(str)) return true;

    // IPv6 URLs
    if (/^\[[\da-fA-F:]+\](:\d+)?/.test(str)) return true;

    return false;
  }

  /**
   * Basic HTML sanitization without external library
   * Removes HTML tags and dangerous characters
   */
  basicSanitizeHtml(str) {
    if (typeof str !== 'string') return str;

    // Strategy: Remove all HTML content including tags and their contents for dangerous elements
    let cleaned = str;

    // First, remove script tags and their contents entirely
    cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    // Handle unclosed script tags
    cleaned = cleaned.replace(/<script\b[^>]*>[\s\S]*$/gi, '');

    // Remove style tags and their contents
    cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    // Handle unclosed style tags
    cleaned = cleaned.replace(/<style\b[^>]*>[\s\S]*$/gi, '');

    // Remove iframe tags and their contents
    cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

    // Now remove all remaining HTML tags (but keep the text content between them)
    // This regex matches from < to the next > or to the end of string
    cleaned = cleaned.replace(/<[^>]*>?/g, '');

    // FIX: More efficient handling of remaining < characters
    // Replace while loop with a single indexOf + substring operation
    // This handles malformed tags that don't close properly
    const openTagIndex = cleaned.indexOf('<');
    if (openTagIndex !== -1) {
      cleaned = cleaned.substring(0, openTagIndex);
    }

    // FIX: Removed excessive HTML entity encoding that caused &#x27; to appear
    // React already escapes content automatically when rendering, so double-encoding
    // characters like apostrophes, quotes, and slashes causes them to display as
    // literal HTML entities (e.g., "don&#x27;t" instead of "don't")
    // Only escape < and > which could be used for tag injection
    cleaned = cleaned.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return cleaned;
  }

  /**
   * Validate system metrics data structure
   */
  isValidSystemMetrics(data) {
    // Accept flexible shapes produced by main: ensure object with some expected keys
    if (!data || typeof data !== 'object') return false;
    const hasUptime = typeof data.uptime === 'number' || typeof data.uptime === 'string';
    const hasMemory = typeof data.memory === 'object' || typeof data.memory?.used === 'number';
    return hasUptime || hasMemory;
  }

  /**
   * Validate IPC results
   */
  validateResult(result, channel) {
    // Channel-specific validation
    switch (channel) {
      case 'get-system-metrics':
        return this.isValidSystemMetrics(result) ? result : null;
      case 'select-directory':
        // Main returns { success, folder } now
        return result && typeof result === 'object' ? result : { success: false, folder: null };
      case 'get-custom-folders':
        return Array.isArray(result) ? result : [];
      default:
        return result;
    }
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
    getStats: (filePath) => secureIPC.safeInvoke(IPC_CHANNELS.FILES.GET_FILE_STATS, filePath),
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
            const url = new URL(filePath);
            const pathname = decodeURIComponent(url.pathname || '');
            if (/^\/[a-zA-Z]:[\\/]/.test(pathname)) {
              filePath = pathname.slice(1); // drop leading slash before drive letter
            } else {
              filePath = pathname;
            }
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
      secureIPC.safeInvoke(IPC_CHANNELS.EMBEDDINGS.FIND_DUPLICATES, options || {})
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
    recordFeedback: (file, suggestion, accepted) =>
      secureIPC.safeInvoke(IPC_CHANNELS.SUGGESTIONS.RECORD_FEEDBACK, {
        file,
        suggestion,
        accepted
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
    onStateChanged: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (event, data) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.UNDO_REDO.STATE_CHANGED, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.UNDO_REDO.STATE_CHANGED, listener);
    }
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
    // Listen for semantic search trigger from tray/global shortcut
    onOpenSemanticSearch: (callback) => {
      const channel = 'open-semantic-search';
      const handler = () => {
        try {
          callback();
        } catch (error) {
          log.error('[Preload] Error in semantic search callback:', error);
        }
      };
      ipcRenderer.on(channel, handler);
      // Return cleanup function
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    }
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
    onStartupProgress: (callback) => secureIPC.safeOn('startup-progress', callback),
    onStartupError: (callback) => secureIPC.safeOn('startup-error', callback),
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
    // Send error report to main process (uses send, not invoke)
    sendError: (errorData) => {
      try {
        // Validate error data structure
        if (!errorData || typeof errorData !== 'object' || !errorData.message) {
          log.warn('[events.sendError] Invalid error data structure');
          return;
        }
        // Validate channel is allowed
        const channel = 'renderer-error-report';
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
    get: () => secureIPC.safeInvoke(IPC_CHANNELS.SETTINGS.GET),
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
