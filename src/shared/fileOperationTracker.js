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
const fs = require('fs').promises;
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

/**
 * Persistence debounce time - don't save more often than this
 */
const PERSISTENCE_DEBOUNCE_MS = 1000;

class FileOperationTracker {
  /**
   * @param {Object|number} optionsOrCooldownMs - Options object or cooldown period
   * @param {number} [optionsOrCooldownMs.cooldownMs=5000] - Cooldown period in milliseconds
   * @param {string} [optionsOrCooldownMs.persistencePath] - Path to persist operations (optional)
   */
  constructor(optionsOrCooldownMs = DEFAULT_COOLDOWN_MS) {
    // Support both old (number) and new (object) constructor signatures
    const options =
      typeof optionsOrCooldownMs === 'number'
        ? { cooldownMs: optionsOrCooldownMs }
        : optionsOrCooldownMs || {};

    /** @type {Map<string, {timestamp: number, operationType: string, source: string}>} */
    this.recentOperations = new Map();
    this.cooldownMs = options.cooldownMs || DEFAULT_COOLDOWN_MS;
    this._persistencePath = options.persistencePath || null;
    this._cleanupTimer = null;
    this._persistenceTimer = null;
    this._isShutdown = false;
    this._initialized = false;
    this._initPromise = null;
  }

  /**
   * Initialize the tracker by loading persisted operations
   * Call this before using if persistence is enabled
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._initialized) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._loadPersistedOperations();
    await this._initPromise;
    this._initialized = true;
  }

  /**
   * Load persisted operations from disk
   * @private
   */
  async _loadPersistedOperations() {
    if (!this._persistencePath) return;

    try {
      const data = await fs.readFile(this._persistencePath, 'utf8');
      const parsed = JSON.parse(data);

      if (Array.isArray(parsed)) {
        const now = Date.now();
        let loaded = 0;

        for (const entry of parsed) {
          // Only load non-expired entries
          if (entry && entry.path && entry.timestamp && now - entry.timestamp <= this.cooldownMs) {
            this.recentOperations.set(entry.path, {
              timestamp: entry.timestamp,
              operationType: entry.operationType || 'unknown',
              source: entry.source || 'persisted'
            });
            loaded++;
          }
        }

        if (loaded > 0) {
          logger.info('[FILE-OP-TRACKER] Loaded persisted operations:', loaded);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn('[FILE-OP-TRACKER] Error loading persisted operations:', error.message);
      }
    }
  }

  /**
   * Persist operations to disk (debounced)
   * @private
   */
  _schedulePersistence() {
    if (!this._persistencePath || this._isShutdown) return;

    if (this._persistenceTimer) {
      clearTimeout(this._persistenceTimer);
    }

    this._persistenceTimer = setTimeout(async () => {
      this._persistenceTimer = null;
      await this._persistOperations();
    }, PERSISTENCE_DEBOUNCE_MS);

    if (this._persistenceTimer.unref) {
      this._persistenceTimer.unref();
    }
  }

  /**
   * Persist current operations to disk
   * @private
   */
  async _persistOperations() {
    if (!this._persistencePath || this._isShutdown) return;

    try {
      const data = Array.from(this.recentOperations.entries()).map(([filePath, entry]) => ({
        path: filePath,
        timestamp: entry.timestamp,
        operationType: entry.operationType,
        source: entry.source
      }));

      await fs.mkdir(path.dirname(this._persistencePath), { recursive: true });
      await fs.writeFile(this._persistencePath, JSON.stringify(data), 'utf8');
    } catch (error) {
      logger.warn('[FILE-OP-TRACKER] Error persisting operations:', error.message);
    }
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
    this._schedulePersistence();
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
    if (this._persistenceTimer) {
      clearTimeout(this._persistenceTimer);
      this._persistenceTimer = null;
    }
  }

  /**
   * Shutdown the tracker and release resources
   * Persists remaining operations before shutdown
   */
  async shutdown() {
    this._isShutdown = true;

    // Persist any remaining operations before clearing
    if (this._persistencePath && this.recentOperations.size > 0) {
      await this._persistOperations();
    }

    this.clear();
    logger.debug('[FILE-OP-TRACKER] Shutdown complete');
  }

  /**
   * Reset for testing - allows creating fresh instance
   */
  // static resetInstance() {
  //   if (_instance) {
  //     _instance.shutdown();
  //     _instance = null;
  //   }
  // }
}

// Use singleton factory to prevent race conditions in getInstance()
const { createSingletonHelpers } = require('./singletonFactory');

const { getInstance, resetInstance, registerWithContainer } = createSingletonHelpers({
  ServiceClass: FileOperationTracker,
  serviceId: 'FILE_OPERATION_TRACKER',
  serviceName: 'FileOperationTracker',
  containerPath: '../main/services/ServiceContainer',
  shutdownMethod: 'shutdown'
});

module.exports = {
  FileOperationTracker,
  getInstance,
  resetInstance,
  registerWithContainer,
  DEFAULT_COOLDOWN_MS
};
