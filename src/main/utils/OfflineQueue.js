/**
 * Offline Queue for ChromaDB Operations
 *
 * Provides persistent queueing of ChromaDB operations when the service is unavailable.
 * Operations are persisted to disk for crash recovery and automatically flushed
 * when the service becomes available again.
 *
 * Features:
 * - Disk persistence for crash recovery
 * - Maximum queue size to prevent memory bloat
 * - Automatic queue flushing on service recovery
 * - Priority-based operation ordering
 * - Deduplication of operations by ID
 */

const { EventEmitter } = require('events');
const path = require('path');
const { app } = require('electron');
const { logger } = require('../../shared/logger');
const { atomicWriteFile, loadJsonFile, safeUnlink } = require('../../shared/atomicFile');
const { TIMEOUTS } = require('../../shared/performanceConstants');

logger.setContext('OfflineQueue');

// Operation types
const OperationType = {
  UPSERT_FILE: 'upsert_file',
  UPSERT_FOLDER: 'upsert_folder',
  DELETE_FILE: 'delete_file',
  DELETE_FOLDER: 'delete_folder',
  BATCH_UPSERT_FILES: 'batch_upsert_files',
  BATCH_UPSERT_FOLDERS: 'batch_upsert_folders',
  BATCH_DELETE_FILES: 'batch_delete_files',
  BATCH_DELETE_FOLDERS: 'batch_delete_folders',
  UPDATE_FILE_PATHS: 'update_file_paths'
};

// Operation priorities (lower = higher priority)
const OperationPriority = {
  [OperationType.DELETE_FILE]: 1,
  [OperationType.DELETE_FOLDER]: 1,
  [OperationType.BATCH_DELETE_FILES]: 1,
  [OperationType.BATCH_DELETE_FOLDERS]: 1,
  [OperationType.UPSERT_FILE]: 2,
  [OperationType.UPSERT_FOLDER]: 2,
  [OperationType.BATCH_UPSERT_FILES]: 3,
  [OperationType.BATCH_UPSERT_FOLDERS]: 3,
  [OperationType.UPDATE_FILE_PATHS]: 4
};

// Default configuration
const DEFAULT_CONFIG = {
  maxQueueSize: 1000, // Maximum operations to queue
  persistPath: null, // Will be set to userData/chromadb-queue.json
  flushBatchSize: 50, // Number of operations to process per flush batch
  flushDelayMs: 1000, // Delay between flush batches
  deduplicateByKey: true, // Deduplicate operations by their key
  maxRetries: 3 // Maximum retries for failed operations
};

/**
 * Offline Queue for managing operations when ChromaDB is unavailable
 */
class OfflineQueue extends EventEmitter {
  /**
   * Create a new OfflineQueue
   * @param {Object} config - Configuration options
   */
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Set default persist path if not provided
    if (!this.config.persistPath) {
      try {
        this.config.persistPath = path.join(app.getPath('userData'), 'chromadb-queue.json');
      } catch (error) {
        // FIX: Log warning instead of silently falling back
        // This aids diagnosis when app.getPath fails (e.g., app not ready)
        logger.warn('[OfflineQueue] app.getPath failed, using process.cwd() fallback', {
          error: error.message,
          fallbackPath: path.join(process.cwd(), 'chromadb-queue.json')
        });
        this.config.persistPath = path.join(process.cwd(), 'chromadb-queue.json');
      }
    }

    // Queue storage
    this.queue = [];
    this.operationMap = new Map(); // For deduplication

    // FIX: Add mutex for thread-safe queue operations
    this._mutex = Promise.resolve();

    // State tracking
    this.isFlushing = false;
    this.isLoaded = false;
    this.lastPersistTime = null;
    this.lastFlushTime = null;
    this._sortRequired = false; // Optimization: only sort when queue has been modified

    // Statistics
    this.stats = {
      totalEnqueued: 0,
      totalProcessed: 0,
      totalFailed: 0,
      totalDropped: 0,
      deduplicated: 0
    };

    logger.info('[OfflineQueue] Initialized', {
      persistPath: this.config.persistPath,
      maxQueueSize: this.config.maxQueueSize
    });
  }

  /**
   * Initialize the queue by loading persisted data
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isLoaded) {
      return;
    }

    try {
      await this._loadFromDisk();
      this.isLoaded = true;
      logger.info('[OfflineQueue] Loaded queue from disk', {
        queueSize: this.queue.length
      });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn('[OfflineQueue] Failed to load queue from disk', {
          error: error.message
        });
      }
      this.isLoaded = true;
    }
  }

  /**
   * Enqueue an operation
   * @param {string} type - Operation type
   * @param {Object} data - Operation data
   * @param {Object} options - Additional options
   * @returns {boolean} True if enqueued, false if dropped
   */
  enqueue(type, data, options = {}) {
    if (!Object.values(OperationType).includes(type)) {
      logger.warn('[OfflineQueue] Invalid operation type', { type });
      return false;
    }

    // Generate a unique key for deduplication
    const key = this._generateKey(type, data);

    // Check for deduplication
    if (this.config.deduplicateByKey && this.operationMap.has(key)) {
      // Update existing operation with new data
      const existingIndex = this.operationMap.get(key);
      if (existingIndex !== undefined && this.queue[existingIndex]) {
        this.queue[existingIndex].data = data;
        this.queue[existingIndex].updatedAt = Date.now();
        this.stats.deduplicated++;
        logger.debug('[OfflineQueue] Updated existing operation', { key });
        this._schedulePersist();
        return true;
      }
    }

    // Check queue size limit
    if (this.queue.length >= this.config.maxQueueSize) {
      // Drop oldest low-priority item
      const dropped = this._dropLowestPriority();
      if (!dropped) {
        logger.warn('[OfflineQueue] Queue full, dropping new operation', {
          type,
          key
        });
        this.stats.totalDropped++;
        this.emit('dropped', { type, data, reason: 'queue_full' });
        return false;
      }
    }

    // Create operation entry
    const operation = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      data,
      key,
      priority: OperationPriority[type] || 5,
      retries: 0,
      maxRetries: options.maxRetries || this.config.maxRetries,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // Add to queue
    this.queue.push(operation);
    this.operationMap.set(key, this.queue.length - 1);
    this.stats.totalEnqueued++;
    this._sortRequired = true; // Mark queue as needing sort before next dequeue/flush

    logger.debug('[OfflineQueue] Operation enqueued', {
      type,
      key,
      queueSize: this.queue.length
    });

    this._schedulePersist();
    this.emit('enqueued', operation);

    return true;
  }

  /**
   * Get the current queue size
   * @returns {number} Queue size
   */
  size() {
    return this.queue.length;
  }

  /**
   * Check if queue is empty
   * @returns {boolean} True if empty
   */
  isEmpty() {
    return this.queue.length === 0;
  }

  /**
   * Peek at the next operation without removing it
   * @returns {Object|null} Next operation or null
   */
  peek() {
    if (this.queue.length === 0) {
      return null;
    }

    // Sort by priority and return highest priority
    const sorted = [...this.queue].sort((a, b) => a.priority - b.priority);
    return sorted[0];
  }

  /**
   * Dequeue the next operation
   * @returns {Object|null} Next operation or null
   */
  dequeue() {
    if (this.queue.length === 0) {
      return null;
    }

    // Optimization: only sort when queue has been modified since last sort
    if (this._sortRequired) {
      this.queue.sort((a, b) => a.priority - b.priority);
      this._sortRequired = false;
    }

    // Remove and return first item
    const operation = this.queue.shift();
    this._rebuildOperationMap();
    this._schedulePersist();

    return operation;
  }

  /**
   * Flush all queued operations
   * @param {Function} processor - Async function to process each operation
   * @returns {Promise<Object>} Flush results
   */
  async flush(processor) {
    // FIX: Use mutex to prevent concurrent flush operations
    return this._withMutex(async () => {
      if (this.isFlushing) {
        logger.warn('[OfflineQueue] Flush already in progress');
        return { processed: 0, failed: 0, remaining: this.queue.length };
      }

      if (this.queue.length === 0) {
        return { processed: 0, failed: 0, remaining: 0 };
      }

      // FIX: Move isFlushing and all operations inside try block
      // to ensure isFlushing is always reset in finally
      let processed = 0;
      let failed = 0;

      try {
        this.isFlushing = true;
        this.emit('flushStart', { queueSize: this.queue.length });

        // Optimization: only sort when queue has been modified since last sort
        if (this._sortRequired) {
          this.queue.sort((a, b) => a.priority - b.priority);
          this._sortRequired = false;
        }

        // FIX: Process in batches with crash-safe removal
        // Previously, splice() removed items BEFORE processing, causing data loss on crash.
        // Now we use slice() to get items, then remove only AFTER successful processing.
        // Each flush processes all items once - failed items stay for the next flush.
        let retriesPending = 0;
        const initialQueueLength = this.queue.length;
        let itemsProcessedThisFlush = 0;

        while (itemsProcessedThisFlush < initialQueueLength && this.queue.length > 0) {
          // FIX: Use slice() instead of splice() - get items without removing
          const remainingToProcess = initialQueueLength - itemsProcessedThisFlush;
          const batchSize = Math.min(
            this.config.flushBatchSize,
            remainingToProcess,
            this.queue.length
          );
          const batch = this.queue.slice(0, batchSize);
          const indicesToRemove = [];

          for (let i = 0; i < batch.length; i++) {
            const operation = batch[i];
            itemsProcessedThisFlush++;

            try {
              await processor(operation);
              processed++;
              this.stats.totalProcessed++;
              // FIX: Track processed operations for removal AFTER processing
              indicesToRemove.push(i);

              this.emit('operationProcessed', {
                operation,
                remaining: this.queue.length - indicesToRemove.length
              });
            } catch (error) {
              operation.retries++;
              operation.lastError = error.message;

              if (operation.retries < operation.maxRetries) {
                // Keep in queue for retry (don't add to indicesToRemove)
                retriesPending++;
                logger.warn('[OfflineQueue] Operation failed, will retry', {
                  type: operation.type,
                  key: operation.key,
                  retries: operation.retries,
                  error: error.message
                });
              } else {
                // Max retries exceeded, mark for removal
                indicesToRemove.push(i);
                failed++;
                this.stats.totalFailed++;
                logger.error('[OfflineQueue] Operation failed permanently, dropping', {
                  type: operation.type,
                  key: operation.key,
                  error: error.message
                });
                this.emit('operationFailed', { operation, error });
              }
            }
          }

          // FIX: Remove items AFTER processing (in reverse order to preserve indices)
          // This ensures crash safety - items remain in queue until successfully processed
          for (let i = indicesToRemove.length - 1; i >= 0; i--) {
            this.queue.splice(indicesToRemove[i], 1);
          }
          this._rebuildOperationMap();

          // Persist after each batch for additional crash safety
          await this._persistToDisk();

          // Wait between batches to avoid overwhelming the service
          if (itemsProcessedThisFlush < initialQueueLength && this.queue.length > 0) {
            await this._delay(this.config.flushDelayMs);
          }
        }

        this.lastFlushTime = Date.now();
        await this._persistToDisk();

        const result = {
          processed,
          failed,
          remaining: this.queue.length,
          retriesPending
        };

        logger.info('[OfflineQueue] Flush completed', result);
        this.emit('flushComplete', result);

        return result;
      } finally {
        this.isFlushing = false;
      }
    }); // End of mutex wrapper
  }

  /**
   * Clear all queued operations
   */
  async clear() {
    const clearedCount = this.queue.length;
    this.queue = [];
    this.operationMap.clear();
    await this._persistToDisk();

    logger.info('[OfflineQueue] Queue cleared', { clearedCount });
    this.emit('cleared', { clearedCount });
  }

  /**
   * Get queue statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      queueSize: this.queue.length,
      isFlushing: this.isFlushing,
      lastPersistTime: this.lastPersistTime,
      lastFlushTime: this.lastFlushTime,
      ...this.stats
    };
  }

  /**
   * Generate a unique key for an operation (for deduplication)
   * @private
   * @param {string} type - Operation type
   * @param {Object} data - Operation data
   * @returns {string} Unique key
   */
  _generateKey(type, data) {
    switch (type) {
      case OperationType.UPSERT_FILE:
      case OperationType.DELETE_FILE:
        return `${type}:${data.id || data.fileId}`;

      case OperationType.UPSERT_FOLDER:
      case OperationType.DELETE_FOLDER:
        return `${type}:${data.id || data.folderId}`;

      case OperationType.BATCH_UPSERT_FILES: {
        // For batches, use a hash of all IDs
        const fileIds = (data.files || [])
          .map((f) => f.id)
          .sort()
          .join(',');
        return `${type}:${this._simpleHash(fileIds)}`;
      }

      case OperationType.BATCH_UPSERT_FOLDERS: {
        const folderIds = (data.folders || [])
          .map((f) => f.id)
          .sort()
          .join(',');
        return `${type}:${this._simpleHash(folderIds)}`;
      }

      case OperationType.BATCH_DELETE_FILES: {
        const fileIds = (data.fileIds || []).sort().join(',');
        return `${type}:${this._simpleHash(fileIds)}`;
      }

      case OperationType.BATCH_DELETE_FOLDERS: {
        const folderIds = (data.folderIds || []).sort().join(',');
        return `${type}:${this._simpleHash(folderIds)}`;
      }

      case OperationType.UPDATE_FILE_PATHS: {
        const pathUpdates = (data.pathUpdates || [])
          .map((u) => `${u.oldId}->${u.newId}`)
          .sort()
          .join(',');
        return `${type}:${this._simpleHash(pathUpdates)}`;
      }

      default:
        return `${type}:${Date.now()}`;
    }
  }

  /**
   * Simple hash function for string keys
   * @private
   * @param {string} str - String to hash
   * @returns {string} Hash
   */
  _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash &= hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Drop the lowest priority operation to make room
   * @private
   * @returns {boolean} True if an operation was dropped
   */
  _dropLowestPriority() {
    if (this.queue.length === 0) {
      return false;
    }

    // Find the lowest priority (highest priority number) operation
    let lowestIndex = 0;
    let lowestPriority = this.queue[0].priority;

    for (let i = 1; i < this.queue.length; i++) {
      if (this.queue[i].priority > lowestPriority) {
        lowestPriority = this.queue[i].priority;
        lowestIndex = i;
      }
    }

    const dropped = this.queue.splice(lowestIndex, 1)[0];
    this._rebuildOperationMap();
    this.stats.totalDropped++;

    logger.warn('[OfflineQueue] Dropped operation to make room', {
      type: dropped.type,
      key: dropped.key
    });

    this.emit('dropped', { ...dropped, reason: 'priority' });
    return true;
  }

  /**
   * Rebuild the operation map after queue modification
   * @private
   */
  _rebuildOperationMap() {
    this.operationMap.clear();
    for (let i = 0; i < this.queue.length; i++) {
      this.operationMap.set(this.queue[i].key, i);
    }
  }

  /**
   * Schedule persistence to disk (debounced)
   * @private
   */
  _schedulePersist() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
    }

    this._persistTimer = setTimeout(() => {
      this._persistToDisk().catch((error) => {
        logger.error('[OfflineQueue] Failed to persist queue', {
          error: error.message
        });
      });
    }, 1000);

    if (this._persistTimer.unref) {
      this._persistTimer.unref();
    }
  }

  /**
   * Persist queue to disk
   * @private
   * @returns {Promise<void>}
   */
  async _persistToDisk() {
    try {
      if (this.queue.length === 0) {
        await safeUnlink(this.config.persistPath);
        this.lastPersistTime = Date.now();
        return;
      }

      const data = {
        version: 1,
        timestamp: Date.now(),
        queue: this.queue,
        stats: this.stats
      };

      await atomicWriteFile(this.config.persistPath, data, { pretty: true });

      this.lastPersistTime = Date.now();
      logger.debug('[OfflineQueue] Queue persisted to disk', {
        queueSize: this.queue.length
      });
    } catch (error) {
      logger.error('[OfflineQueue] Failed to persist queue', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Load queue from disk
   * @private
   * @returns {Promise<void>}
   */
  async _loadFromDisk() {
    const data = await loadJsonFile(this.config.persistPath, {
      description: 'offline queue',
      backupCorrupt: true
    });

    if (!data) {
      return;
    }

    if (data.version !== 1) {
      logger.warn('[OfflineQueue] Unknown queue version, starting fresh', {
        version: data.version
      });
      return;
    }

    this.queue = data.queue || [];
    this._rebuildOperationMap();

    // Restore stats but reset session-specific counters
    if (data.stats) {
      this.stats.totalEnqueued = data.stats.totalEnqueued || 0;
      this.stats.totalProcessed = data.stats.totalProcessed || 0;
      this.stats.totalFailed = data.stats.totalFailed || 0;
      this.stats.totalDropped = data.stats.totalDropped || 0;
      this.stats.deduplicated = data.stats.deduplicated || 0;
    }
  }

  /**
   * Delay helper
   * @private
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   */
  _delay(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      // FIX: Prevent timer from keeping process alive during shutdown
      if (timer.unref) {
        timer.unref();
      }
    });
  }

  /**
   * FIX: Execute a function with mutex lock to prevent concurrent operations
   * FIX: Added timeout to prevent deadlock if previous operation hangs
   * @private
   * @param {Function} fn - Async function to execute
   * @param {number} timeoutMs - Maximum time to wait for mutex acquisition
   * @returns {Promise<*>} Result of the function
   * @throws {Error} If mutex acquisition times out
   */
  async _withMutex(fn, timeoutMs = TIMEOUTS.MUTEX_ACQUIRE) {
    const previousMutex = this._mutex;
    let release;
    this._mutex = new Promise((resolve) => {
      release = resolve;
    });

    let timeoutId;
    try {
      // FIX: Add timeout to mutex acquisition to prevent deadlock
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Mutex acquisition timeout after ${timeoutMs}ms - possible deadlock`));
        }, timeoutMs);
        // FIX: Prevent timer from keeping process alive during shutdown
        if (timeoutId.unref) {
          timeoutId.unref();
        }
      });

      await Promise.race([previousMutex, timeoutPromise]);
      clearTimeout(timeoutId); // FIX: Clear timeout on success
      return await fn();
    } catch (error) {
      clearTimeout(timeoutId); // FIX: Clear timeout on error
      // If we timed out waiting for the mutex, log the error
      if (error.message.includes('Mutex acquisition timeout')) {
        logger.error('[OfflineQueue] Mutex deadlock detected', {
          error: error.message,
          timeoutMs
        });
      }
      throw error;
    } finally {
      release();
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }

    // Final persist before cleanup
    try {
      await this._persistToDisk();
    } catch (error) {
      logger.warn('[OfflineQueue] Failed to persist on cleanup', {
        error: error.message
      });
    }

    this.removeAllListeners();
    logger.info('[OfflineQueue] Cleaned up');
  }
}

module.exports = {
  OfflineQueue,
  OperationType,
  OperationPriority,
  DEFAULT_CONFIG
};
