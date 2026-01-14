/**
 * FileOperationTracker - Shared registry for tracking file operations
 *
 * Prevents infinite loops by allowing watchers to skip self-triggered events.
 * When a watcher moves/renames/analyzes a file, it records the operation here.
 * Other watchers (or the same watcher) can then check if a file was recently
 * operated on before processing it.
 *
 * @module shared/fileOperationTracker
 */

const path = require('path');
const { logger } = require('./logger');

logger.setContext('FileOperationTracker');

/**
 * Default cooldown period in milliseconds.
 * Files operated on within this window will be skipped by watchers.
 */
const DEFAULT_COOLDOWN_MS = 5000;

/**
 * Cleanup interval - how often to purge expired entries
 */
const CLEANUP_INTERVAL_MS = 10000;

class FileOperationTracker {
  /**
   * @param {number} cooldownMs - Cooldown period in milliseconds
   */
  constructor(cooldownMs = DEFAULT_COOLDOWN_MS) {
    /** @type {Map<string, {timestamp: number, operationType: string, source: string}>} */
    this.recentOperations = new Map();
    this.cooldownMs = cooldownMs;
    this._cleanupTimer = null;
    this._isShutdown = false;
  }

  /**
   * Normalize file path for consistent lookups across platforms
   * @param {string} filePath - Path to normalize
   * @returns {string} Normalized path
   * @private
   */
  _normalizePath(filePath) {
    // Normalize path separators and resolve to absolute
    const normalized = path.normalize(filePath);
    // On Windows, use lowercase for case-insensitive comparison
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  /**
   * Record an operation on a file
   * @param {string} filePath - Path to the file that was operated on
   * @param {string} operationType - Type of operation ('move', 'analyze', 'rename', etc.)
   * @param {string} source - Source of the operation ('downloadWatcher', 'smartFolderWatcher', etc.)
   */
  recordOperation(filePath, operationType, source) {
    if (this._isShutdown) {
      return;
    }

    const normalizedPath = this._normalizePath(filePath);

    this.recentOperations.set(normalizedPath, {
      timestamp: Date.now(),
      operationType,
      source
    });

    logger.debug('[FILE-OP-TRACKER] Recorded operation:', {
      path: normalizedPath,
      type: operationType,
      source,
      cooldownMs: this.cooldownMs
    });

    this._scheduleCleanup();
  }

  /**
   * Check if a file was recently operated on
   * @param {string} filePath - Path to check
   * @param {string} [excludeSource] - Optional source to exclude (allows same source to re-process)
   * @returns {boolean} True if file is in cooldown period
   */
  wasRecentlyOperated(filePath, excludeSource = null) {
    if (this._isShutdown) {
      return false;
    }

    const normalizedPath = this._normalizePath(filePath);
    const entry = this.recentOperations.get(normalizedPath);

    if (!entry) {
      return false;
    }

    const elapsed = Date.now() - entry.timestamp;

    // Check if still within cooldown
    if (elapsed > this.cooldownMs) {
      // Expired - clean up and return false
      this.recentOperations.delete(normalizedPath);
      return false;
    }

    // Optionally allow same source to re-process (for legitimate re-analysis)
    if (excludeSource && entry.source === excludeSource) {
      return false;
    }

    logger.debug('[FILE-OP-TRACKER] File in cooldown:', {
      path: normalizedPath,
      source: entry.source,
      type: entry.operationType,
      elapsedMs: elapsed,
      remainingMs: this.cooldownMs - elapsed
    });

    return true;
  }

  /**
   * Get operation info for a file (for debugging/logging)
   * @param {string} filePath - Path to check
   * @returns {object|null} Operation info or null if not found/expired
   */
  getOperationInfo(filePath) {
    const normalizedPath = this._normalizePath(filePath);
    const entry = this.recentOperations.get(normalizedPath);

    if (!entry) {
      return null;
    }

    const elapsed = Date.now() - entry.timestamp;
    if (elapsed > this.cooldownMs) {
      this.recentOperations.delete(normalizedPath);
      return null;
    }

    return {
      ...entry,
      elapsedMs: elapsed,
      remainingMs: this.cooldownMs - elapsed
    };
  }

  /**
   * Schedule cleanup of expired entries
   * @private
   */
  _scheduleCleanup() {
    if (this._cleanupTimer || this._isShutdown) {
      return;
    }

    this._cleanupTimer = setTimeout(() => {
      this._cleanupTimer = null;
      this._cleanupExpired();
    }, CLEANUP_INTERVAL_MS);

    // Don't prevent process exit
    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  /**
   * Remove expired entries from the map
   * @private
   */
  _cleanupExpired() {
    if (this._isShutdown) {
      return;
    }

    const now = Date.now();
    let cleaned = 0;

    for (const [filePath, entry] of this.recentOperations) {
      if (now - entry.timestamp > this.cooldownMs) {
        this.recentOperations.delete(filePath);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('[FILE-OP-TRACKER] Cleaned expired entries:', cleaned);
    }

    // Schedule another cleanup if there are still entries
    if (this.recentOperations.size > 0) {
      this._scheduleCleanup();
    }
  }

  /**
   * Clear all tracked operations (useful for testing)
   */
  clear() {
    this.recentOperations.clear();
    if (this._cleanupTimer) {
      clearTimeout(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }

  /**
   * Shutdown the tracker and release resources
   */
  shutdown() {
    this._isShutdown = true;
    this.clear();
    logger.debug('[FILE-OP-TRACKER] Shutdown complete');
  }

  /**
   * Reset for testing - allows creating fresh instance
   */
  static resetInstance() {
    if (_instance) {
      _instance.shutdown();
      _instance = null;
    }
  }
}

// Singleton instance for cross-watcher coordination
let _instance = null;

/**
 * Get the singleton FileOperationTracker instance
 * @param {number} [cooldownMs] - Optional cooldown override (only used on first call)
 * @returns {FileOperationTracker}
 */
function getInstance(cooldownMs) {
  if (!_instance) {
    _instance = new FileOperationTracker(cooldownMs);
  }
  return _instance;
}

module.exports = {
  FileOperationTracker,
  getInstance,
  DEFAULT_COOLDOWN_MS
};
