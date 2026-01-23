/**
 * Cache Invalidation Bus
 *
 * Unified event bus that all caches subscribe to for coordinated invalidation.
 * When file paths change (move, delete, copy), this bus broadcasts to all
 * registered caches to ensure they clear stale entries immediately.
 *
 * This solves the TTL mismatch problem where different caches have different
 * TTLs (2s to 1 hour), causing stale data to be returned after file operations.
 *
 * @module shared/cacheInvalidation
 */

const { EventEmitter } = require('events');
const path = require('path');

// Import path trace logger
let traceCacheInvalidate;
let traceCacheInvalidateBatch;
try {
  const pathTraceLogger = require('./pathTraceLogger');
  traceCacheInvalidate = pathTraceLogger.traceCacheInvalidate;
  traceCacheInvalidateBatch = pathTraceLogger.traceCacheInvalidateBatch;
} catch {
  // Fallback to no-ops if pathTraceLogger is not available
  traceCacheInvalidate = () => {};
  traceCacheInvalidateBatch = () => {};
}

// Use require for logger to work in both main and renderer
let logger;
try {
  const loggerModule = require('./logger');
  logger = loggerModule.createLogger
    ? loggerModule.createLogger('CacheInvalidationBus')
    : loggerModule.logger;
  if (logger?.setContext) logger.setContext('CacheInvalidationBus');
} catch {
  // Fallback logger for environments where logger module isn't available
  logger = {
    debug: () => {},
    // eslint-disable-next-line no-console
    info: console.log.bind(console, '[CacheInvalidation]'),
    // eslint-disable-next-line no-console
    warn: console.warn.bind(console, '[CacheInvalidation]'),
    // eslint-disable-next-line no-console
    error: console.error.bind(console, '[CacheInvalidation]')
  };
}

/**
 * Invalidation event types
 * @readonly
 * @enum {string}
 */
const InvalidationType = {
  PATH_CHANGED: 'path-changed',
  FILE_DELETED: 'file-deleted',
  FILE_COPIED: 'file-copied',
  BATCH_CHANGE: 'batch-change',
  FULL_INVALIDATE: 'full-invalidate',
  ANALYSIS_COMPLETE: 'analysis-complete'
};

/**
 * Cache subscriber interface
 * @typedef {Object} CacheSubscriber
 * @property {string} name - Subscriber name for logging
 * @property {Function} onInvalidate - Callback for invalidation events
 * @property {Function} [onPathChange] - Optional specific handler for path changes
 * @property {Function} [onDeletion] - Optional specific handler for deletions
 */

/**
 * CacheInvalidationBus class
 *
 * Central event bus for cache invalidation across the application.
 * Caches register themselves and receive immediate notifications
 * when file paths change, eliminating TTL-based staleness.
 */
class CacheInvalidationBus extends EventEmitter {
  constructor() {
    super();

    /** @type {Map<string, CacheSubscriber>} */
    this._subscribers = new Map();

    /** @type {Set<string>} */
    this._pendingInvalidations = new Set();

    // Batch coalescing for high-frequency operations
    this._batchTimer = null;
    this._batchQueue = [];
    this.BATCH_COALESCE_MS = 50; // Coalesce rapid invalidations

    // Statistics
    this._stats = {
      totalInvalidations: 0,
      pathChanges: 0,
      deletions: 0,
      batchOperations: 0,
      fullInvalidations: 0
    };

    logger.info('[CacheInvalidationBus] Initialized');
  }

  /**
   * Subscribe a cache to invalidation events
   *
   * @param {string} name - Unique subscriber name
   * @param {CacheSubscriber} subscriber - Subscriber object with callbacks
   * @returns {Function} Unsubscribe function
   */
  subscribe(name, subscriber) {
    if (this._subscribers.has(name)) {
      logger.warn(`[CacheInvalidationBus] Subscriber '${name}' already exists, replacing`);
    }

    this._subscribers.set(name, {
      name,
      onInvalidate: subscriber.onInvalidate || (() => {}),
      onPathChange: subscriber.onPathChange,
      onDeletion: subscriber.onDeletion,
      onBatch: subscriber.onBatch
    });

    logger.debug(`[CacheInvalidationBus] Subscribed: ${name}`, {
      totalSubscribers: this._subscribers.size
    });

    // Return unsubscribe function
    return () => this.unsubscribe(name);
  }

  /**
   * Unsubscribe a cache from invalidation events
   *
   * @param {string} name - Subscriber name
   * @returns {boolean} True if subscriber was found and removed
   */
  unsubscribe(name) {
    const removed = this._subscribers.delete(name);
    if (removed) {
      logger.debug(`[CacheInvalidationBus] Unsubscribed: ${name}`, {
        remainingSubscribers: this._subscribers.size
      });
    }
    return removed;
  }

  /**
   * Invalidate caches for a path change (move/rename)
   *
   * @param {string} oldPath - Original file path
   * @param {string} newPath - New file path
   * @param {string} [type='move'] - Change type
   */
  invalidateForPathChange(oldPath, newPath, type = 'move') {
    this._stats.pathChanges++;
    this._stats.totalInvalidations++;

    const event = {
      type: InvalidationType.PATH_CHANGED,
      changeType: type,
      oldPath,
      newPath,
      timestamp: Date.now()
    };

    logger.debug('[CacheInvalidationBus] Path change invalidation', {
      oldPath: path.basename(oldPath),
      newPath: path.basename(newPath),
      type,
      subscribers: this._subscribers.size
    });

    // PATH-TRACE: Log cache invalidation for path change
    traceCacheInvalidate(oldPath, newPath, this._subscribers.size, type);

    // Notify all subscribers
    this._notifySubscribers(event);

    // Emit for any direct listeners
    this.emit(InvalidationType.PATH_CHANGED, event);
  }

  /**
   * Invalidate caches for a file deletion
   *
   * @param {string} filePath - Deleted file path
   */
  invalidateForDeletion(filePath) {
    this._stats.deletions++;
    this._stats.totalInvalidations++;

    const event = {
      type: InvalidationType.FILE_DELETED,
      path: filePath,
      timestamp: Date.now()
    };

    logger.debug('[CacheInvalidationBus] Deletion invalidation', {
      path: path.basename(filePath),
      subscribers: this._subscribers.size
    });

    // PATH-TRACE: Log cache invalidation for deletion
    traceCacheInvalidate(filePath, null, this._subscribers.size, 'delete');

    // Notify all subscribers
    this._notifySubscribers(event);

    // Emit for any direct listeners
    this.emit(InvalidationType.FILE_DELETED, event);
  }

  /**
   * Invalidate caches for a batch of path changes
   *
   * @param {Array<{oldPath: string, newPath: string}>} changes - Path changes
   * @param {string} [type='move'] - Change type
   */
  invalidateBatch(changes, type = 'move') {
    if (!Array.isArray(changes) || changes.length === 0) return;

    this._stats.batchOperations++;
    this._stats.totalInvalidations += changes.length;

    const event = {
      type: InvalidationType.BATCH_CHANGE,
      changeType: type,
      changes,
      count: changes.length,
      timestamp: Date.now()
    };

    logger.debug('[CacheInvalidationBus] Batch invalidation', {
      count: changes.length,
      type,
      subscribers: this._subscribers.size
    });

    // PATH-TRACE: Log batch cache invalidation
    traceCacheInvalidateBatch(changes.length, this._subscribers.size);

    // Notify all subscribers
    this._notifySubscribers(event);

    // Emit for any direct listeners
    this.emit(InvalidationType.BATCH_CHANGE, event);
  }

  /**
   * Invalidate all caches completely (nuclear option)
   *
   * @param {string} [reason] - Reason for full invalidation
   */
  invalidateAll(reason = 'manual') {
    this._stats.fullInvalidations++;
    this._stats.totalInvalidations++;

    const event = {
      type: InvalidationType.FULL_INVALIDATE,
      reason,
      timestamp: Date.now()
    };

    logger.info('[CacheInvalidationBus] Full cache invalidation', {
      reason,
      subscribers: this._subscribers.size
    });

    // Notify all subscribers
    this._notifySubscribers(event);

    // Emit for any direct listeners
    this.emit(InvalidationType.FULL_INVALIDATE, event);
  }

  /**
   * Notify that analysis is complete for a file
   * Caches may want to pre-warm or update their entries
   *
   * @param {string} filePath - Analyzed file path
   * @param {Object} [metadata] - Analysis metadata
   */
  notifyAnalysisComplete(filePath, metadata = {}) {
    const event = {
      type: InvalidationType.ANALYSIS_COMPLETE,
      path: filePath,
      metadata,
      timestamp: Date.now()
    };

    logger.debug('[CacheInvalidationBus] Analysis complete notification', {
      path: path.basename(filePath)
    });

    // Notify all subscribers
    this._notifySubscribers(event);

    // Emit for any direct listeners
    this.emit(InvalidationType.ANALYSIS_COMPLETE, event);
  }

  /**
   * Coalesce rapid invalidations into batches
   * Call this instead of individual invalidations for high-frequency operations
   *
   * @param {string} oldPath - Original path
   * @param {string} newPath - New path
   */
  queueInvalidation(oldPath, newPath) {
    this._batchQueue.push({ oldPath, newPath });

    if (!this._batchTimer) {
      this._batchTimer = setTimeout(() => {
        this._flushBatchQueue();
      }, this.BATCH_COALESCE_MS);
    }
  }

  /**
   * Flush pending batch invalidations
   * @private
   */
  _flushBatchQueue() {
    this._batchTimer = null;

    if (this._batchQueue.length === 0) return;

    const changes = [...this._batchQueue];
    this._batchQueue = [];

    if (changes.length === 1) {
      // Single change, use regular invalidation
      this.invalidateForPathChange(changes[0].oldPath, changes[0].newPath);
    } else {
      // Multiple changes, use batch invalidation
      this.invalidateBatch(changes);
    }
  }

  /**
   * Notify all subscribers of an event
   * @private
   */
  _notifySubscribers(event) {
    for (const [name, subscriber] of this._subscribers) {
      try {
        // Call specific handler if available
        if (event.type === InvalidationType.PATH_CHANGED && subscriber.onPathChange) {
          subscriber.onPathChange(event.oldPath, event.newPath, event);
        } else if (event.type === InvalidationType.FILE_DELETED && subscriber.onDeletion) {
          subscriber.onDeletion(event.path, event);
        } else if (event.type === InvalidationType.BATCH_CHANGE && subscriber.onBatch) {
          subscriber.onBatch(event.changes, event);
        }

        // Always call general handler
        subscriber.onInvalidate(event);
      } catch (err) {
        logger.warn(`[CacheInvalidationBus] Error notifying subscriber '${name}'`, {
          error: err.message,
          eventType: event.type
        });
      }
    }
  }

  /**
   * Get invalidation statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      ...this._stats,
      subscriberCount: this._subscribers.size,
      subscribers: Array.from(this._subscribers.keys()),
      pendingBatchSize: this._batchQueue.length
    };
  }

  /**
   * Reset statistics (for testing)
   */
  resetStats() {
    this._stats = {
      totalInvalidations: 0,
      pathChanges: 0,
      deletions: 0,
      batchOperations: 0,
      fullInvalidations: 0
    };
  }

  /**
   * Shutdown the bus and clean up
   */
  shutdown() {
    if (this._batchTimer) {
      clearTimeout(this._batchTimer);
      this._batchTimer = null;
    }

    // Flush any pending invalidations
    if (this._batchQueue.length > 0) {
      this._flushBatchQueue();
    }

    this._subscribers.clear();
    this.removeAllListeners();

    logger.info('[CacheInvalidationBus] Shutdown complete');
  }
}

// ==================== Singleton Instance ====================

let _instance = null;

/**
 * Get the singleton CacheInvalidationBus instance
 * @returns {CacheInvalidationBus}
 */
function getInstance() {
  if (!_instance) {
    _instance = new CacheInvalidationBus();
  }
  return _instance;
}

/**
 * Reset the singleton (for testing)
 */
function resetInstance() {
  if (_instance) {
    _instance.shutdown();
    _instance = null;
  }
}

// ==================== Helper Functions ====================

/**
 * Create a cache subscriber helper that clears a Map-based cache
 *
 * @param {string} name - Subscriber name
 * @param {Map} cacheMap - The cache Map to clear
 * @returns {Function} Unsubscribe function
 */
function createMapCacheSubscriber(name, cacheMap) {
  const bus = getInstance();

  return bus.subscribe(name, {
    onInvalidate: (event) => {
      if (event.type === InvalidationType.FULL_INVALIDATE) {
        cacheMap.clear();
        return;
      }
    },
    onPathChange: (oldPath) => {
      // Try to find and update entries with the old path
      // For simple Map caches, we just delete entries containing the old path
      for (const [key] of cacheMap) {
        if (key.includes(oldPath)) {
          cacheMap.delete(key);
        }
      }
    },
    onDeletion: (filePath) => {
      for (const [key] of cacheMap) {
        if (key.includes(filePath)) {
          cacheMap.delete(key);
        }
      }
    },
    onBatch: (changes) => {
      const pathsToInvalidate = new Set();
      changes.forEach((c) => {
        pathsToInvalidate.add(c.oldPath);
        pathsToInvalidate.add(c.newPath);
      });

      for (const [key] of cacheMap) {
        for (const p of pathsToInvalidate) {
          if (key.includes(p)) {
            cacheMap.delete(key);
            break;
          }
        }
      }
    }
  });
}

/**
 * Create a cache subscriber helper that clears an object-based cache
 *
 * @param {string} name - Subscriber name
 * @param {Object} cacheObj - Object with cache and clear method
 * @param {Function} cacheObj.clear - Function to clear the cache
 * @returns {Function} Unsubscribe function
 */
function createCacheObjectSubscriber(name, cacheObj) {
  const bus = getInstance();

  return bus.subscribe(name, {
    onInvalidate: (event) => {
      // For full invalidation or any path change, clear the cache
      if (
        event.type === InvalidationType.FULL_INVALIDATE ||
        event.type === InvalidationType.PATH_CHANGED ||
        event.type === InvalidationType.FILE_DELETED ||
        event.type === InvalidationType.BATCH_CHANGE
      ) {
        if (typeof cacheObj.clear === 'function') {
          cacheObj.clear();
        } else if (typeof cacheObj.invalidate === 'function') {
          cacheObj.invalidate();
        }
      }
    }
  });
}

module.exports = {
  CacheInvalidationBus,
  InvalidationType,
  getInstance,
  resetInstance,
  createMapCacheSubscriber,
  createCacheObjectSubscriber
};
