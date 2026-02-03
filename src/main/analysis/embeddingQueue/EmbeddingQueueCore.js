/**
 * EmbeddingQueue Core Class
 *
 * Core embedding queue with persistence, retry logic, and parallel processing.
 *
 * @module embeddingQueue/EmbeddingQueueCore
 */

const path = require('path');
const { app } = require('electron');
const { createLogger } = require('../../../shared/logger');
const { container, ServiceIds } = require('../../services/ServiceContainer');
const { get: getConfig } = require('../../../shared/config/index');
const { normalizePathForIndex } = require('../../../shared/pathSanitization');
const { traceQueueUpdate } = require('../../../shared/pathTraceLogger');
const {
  BATCH,
  LIMITS,
  THRESHOLDS,
  RETRY,
  CONCURRENCY,
  TIMEOUTS
} = require('../../../shared/performanceConstants');

const { loadPersistedData, persistQueueData } = require('./persistence');
const { createFailedItemHandler } = require('./failedItemHandler');
const { processItemsInParallel } = require('./parallelProcessor');
const { createProgressTracker } = require('./progress');

const logger = createLogger('EmbeddingQueue');
class EmbeddingQueue {
  constructor(options = {}) {
    this.queue = [];
    const persistenceFileName =
      typeof options.persistenceFileName === 'string' && options.persistenceFileName.trim()
        ? options.persistenceFileName.trim()
        : 'pending_embeddings.json';
    this.persistencePath = path.join(app.getPath('userData'), persistenceFileName);

    // Configuration from unified config
    this.BATCH_SIZE =
      typeof options.batchSize === 'number' &&
      Number.isFinite(options.batchSize) &&
      options.batchSize > 0
        ? Math.floor(options.batchSize)
        : getConfig('ANALYSIS.batchSize', 50);
    this.FLUSH_DELAY_MS =
      typeof options.flushDelayMs === 'number' &&
      Number.isFinite(options.flushDelayMs) &&
      options.flushDelayMs >= 0
        ? options.flushDelayMs
        : BATCH.EMBEDDING_FLUSH_DELAY_MS;
    this.flushTimer = null;
    this.isFlushing = false;
    this.initialized = false;

    // Memory limits
    this.MAX_QUEUE_SIZE = LIMITS.MAX_QUEUE_SIZE;
    this.MAX_RETRY_COUNT = getConfig('ANALYSIS.retryAttempts', 3);
    this.retryCount = 0;

    // Memory monitoring thresholds
    this.HIGH_WATERMARK = THRESHOLDS.QUEUE_HIGH_WATERMARK;
    this.CRITICAL_WATERMARK = THRESHOLDS.QUEUE_CRITICAL_WATERMARK;
    this.MEMORY_WARNING_THRESHOLD = Math.floor(this.MAX_QUEUE_SIZE * this.HIGH_WATERMARK);
    this.CRITICAL_WARNING_THRESHOLD = Math.floor(this.MAX_QUEUE_SIZE * this.CRITICAL_WATERMARK);
    this.memoryWarningLogged = false;
    this.criticalWarningLogged = false;

    // Parallel processing config
    this.PARALLEL_FLUSH_CONCURRENCY =
      typeof options.parallelFlushConcurrency === 'number' &&
      Number.isFinite(options.parallelFlushConcurrency) &&
      options.parallelFlushConcurrency > 0
        ? Math.floor(options.parallelFlushConcurrency)
        : CONCURRENCY.EMBEDDING_FLUSH;

    // Progress tracking
    this._progressTracker = createProgressTracker();

    // Failed item handler
    const failedItemsPath =
      typeof options.failedItemsPath === 'string' && options.failedItemsPath.trim()
        ? options.failedItemsPath.trim()
        : path.join(app.getPath('userData'), 'failed_embeddings.json');
    const deadLetterPath =
      typeof options.deadLetterPath === 'string' && options.deadLetterPath.trim()
        ? options.deadLetterPath.trim()
        : path.join(app.getPath('userData'), 'dead_letter_embeddings.json');
    this.failedItemsPath = failedItemsPath;
    this.deadLetterPath = deadLetterPath;
    this._failedItemHandler = createFailedItemHandler({
      itemMaxRetries: getConfig('ANALYSIS.retryAttempts', 3),
      maxDeadLetterSize: LIMITS.MAX_DEAD_LETTER_SIZE,
      failedItemsPath,
      deadLetterPath
    });

    // Track pending operations for graceful shutdown
    this._pendingPersistence = null;
    this._pendingFlush = null;

    // Shutdown guard — reject new enqueues after shutdown begins
    this._isShuttingDown = false;

    // Track all outstanding persistence promises (including from remove/update ops)
    this._outstandingPersistence = new Set();

    // Mutex for flush operation to prevent double-flush race conditions
    this._flushMutex = Promise.resolve();
  }

  /**
   * Acquire flush mutex to prevent concurrent flush operations
   * @param {number} timeout - Timeout in ms (default: TIMEOUTS.MUTEX_ACQUIRE)
   * @returns {Promise<Function>} Release function to call when done
   * @private
   */
  async _acquireFlushMutex(timeout = TIMEOUTS.MUTEX_ACQUIRE) {
    // FIX: Add guard flag to prevent double-release race condition
    // Without this, timeout + normal completion could both call release()
    let released = false;
    let release;
    const next = new Promise((resolve) => {
      release = () => {
        if (!released) {
          released = true;
          resolve();
        }
      };
    });

    const current = this._flushMutex;
    this._flushMutex = next;

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        const error = new Error(`Flush mutex acquisition timed out after ${timeout}ms`);
        error.code = 'MUTEX_TIMEOUT';
        reject(error);
      }, timeout);
    });

    try {
      await Promise.race([current, timeoutPromise]);
      return release;
    } catch (error) {
      // FIX MED #18: Force release on any error to prevent deadlock
      // The release() function has a guard flag so it's safe to call multiple times
      if (error.code === 'MUTEX_TIMEOUT') {
        logger.error('[EmbeddingQueue] Mutex timeout - forcing release to prevent deadlock');
      }
      release();
      throw error;
    } finally {
      // FIX MED #18: Always clear timeout in finally block to prevent timer leak
      // Wrap in try-catch as defensive measure (clearTimeout shouldn't throw)
      try {
        if (timeoutId) clearTimeout(timeoutId);
      } catch (clearError) {
        logger.debug('[EmbeddingQueue] clearTimeout error (non-fatal):', clearError.message);
      }
    }
  }

  /**
   * Ensure all pending operations complete (call before app quit)
   */
  async ensurePendingComplete() {
    const operations = [];
    if (this._pendingPersistence) operations.push(this._pendingPersistence);
    if (this._pendingFlush) operations.push(this._pendingFlush);

    if (operations.length > 0) {
      logger.info('[EmbeddingQueue] Waiting for pending operations to complete');
      try {
        await Promise.all(operations);
      } catch (err) {
        logger.error('[EmbeddingQueue] Error completing pending operations:', err.message);
      }
    }
    await this.persistQueue();
  }

  /**
   * Register a progress callback
   */
  onProgress(callback) {
    return this._progressTracker.onProgress(callback);
  }

  /**
   * Notify progress callbacks
   */
  _notifyProgress(progress) {
    this._progressTracker.notify(progress);
  }

  /**
   * Initialize the queue by loading pending items from disk
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Load main queue
      await loadPersistedData(
        this.persistencePath,
        (data) => {
          if (Array.isArray(data) && data.length > 0) {
            this.queue = data;
            logger.info(
              `[EmbeddingQueue] Restored ${this.queue.length} pending embeddings from disk`
            );
          }
        },
        'pending embeddings'
      );

      // Load failed items
      await loadPersistedData(
        this.failedItemsPath,
        (data) => {
          if (data && typeof data === 'object') {
            // Handle both object format { id: itemData } and array format [{ id, item, ... }]
            const entries = Array.isArray(data)
              ? data.map((item) => [item?.id || item?.item?.id, item]).filter(([id]) => id)
              : Object.entries(data);
            for (const [id, itemData] of entries) {
              if (id && itemData && itemData.item) {
                this._failedItemHandler.failedItems.set(id, itemData);
              }
            }
            if (this._failedItemHandler.failedItems.size > 0) {
              logger.info(
                `[EmbeddingQueue] Restored ${this._failedItemHandler.failedItems.size} failed items awaiting retry`
              );
            }
          }
        },
        'failed items'
      );

      // Load dead letter queue
      await loadPersistedData(
        this.deadLetterPath,
        (data) => {
          if (Array.isArray(data) && data.length > 0) {
            this._failedItemHandler.setDeadLetterQueue(data);
            logger.info(`[EmbeddingQueue] Loaded ${data.length} items in dead letter queue`);
          }
        },
        'dead letter queue'
      );

      this.initialized = true;

      if (this.queue.length > 0 || this._failedItemHandler.failedItems.size > 0) {
        this.scheduleFlush();
      }
    } catch (error) {
      logger.error('[EmbeddingQueue] Initialization error:', error);
      this.initialized = true;
    }
  }

  /**
   * Add an item to the embedding queue
   */
  async enqueue(item) {
    if (this._isShuttingDown) {
      logger.warn('[EmbeddingQueue] Rejecting enqueue — shutdown in progress', { id: item?.id });
      return { success: false, reason: 'shutting_down' };
    }

    if (!item || !item.id || !item.vector) {
      logger.warn('[EmbeddingQueue] Invalid item ignored', { id: item?.id });
      return { success: false, reason: 'invalid_item' };
    }

    // HIGH FIX: Validate vector is a non-empty array with numeric values
    if (!Array.isArray(item.vector) || item.vector.length === 0) {
      logger.warn('[EmbeddingQueue] Invalid vector - must be non-empty array', {
        id: item.id,
        vectorType: typeof item.vector,
        isArray: Array.isArray(item.vector),
        length: item.vector?.length
      });
      return { success: false, reason: 'invalid_vector_format' };
    }

    // FIX HIGH #6: Validate ALL vector values, not just 3 samples
    // NaN/Infinity in any position will corrupt similarity calculations
    // Performance: Typical embedding vectors are 384-4096 dimensions, checking all is fast
    const vectorLength = item.vector.length;
    for (let idx = 0; idx < vectorLength; idx++) {
      const val = item.vector[idx];
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        logger.warn('[EmbeddingQueue] Invalid vector - contains non-numeric values', {
          id: item.id,
          invalidIndex: idx,
          invalidValue: val,
          valueType: typeof val,
          vectorLength
        });
        return { success: false, reason: 'invalid_vector_values' };
      }
    }

    if (!this.initialized) {
      await this.initialize();
    }

    const result = { success: true, warnings: [] };

    // Memory monitoring
    if (this.queue.length >= this.MEMORY_WARNING_THRESHOLD && !this.memoryWarningLogged) {
      const capacityPercent = Math.round((this.queue.length / this.MAX_QUEUE_SIZE) * 100);
      logger.warn(
        `[EmbeddingQueue] Queue at ${capacityPercent}% capacity - approaching high watermark`
      );
      this.memoryWarningLogged = true;
      result.warnings.push('high_watermark');
    }

    if (this.queue.length >= this.CRITICAL_WARNING_THRESHOLD && !this.criticalWarningLogged) {
      const capacityPercent = Math.round((this.queue.length / this.MAX_QUEUE_SIZE) * 100);
      logger.error(
        `[EmbeddingQueue] CRITICAL: Queue at ${capacityPercent}% capacity - flush may be failing`
      );
      this.criticalWarningLogged = true;
      result.warnings.push('critical_watermark');
    }

    // Reset warning flags below thresholds
    if (this.queue.length < this.MEMORY_WARNING_THRESHOLD * 0.5) {
      this.memoryWarningLogged = false;
    }
    if (this.queue.length < this.CRITICAL_WARNING_THRESHOLD * 0.5) {
      this.criticalWarningLogged = false;
    }

    // Enforce max queue size with backpressure instead of dropping data
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      const capacityPercent = Math.round((this.queue.length / this.MAX_QUEUE_SIZE) * 100);
      logger.error(
        `[EmbeddingQueue] Queue full (${capacityPercent}% capacity) - diverting item to failed queue (backpressure)`,
        { id: item.id }
      );
      this._failedItemHandler.trackFailedItem(item, 'queue_overflow');
      await this.persistQueue().catch((err) =>
        logger.warn('[EmbeddingQueue] Failed to persist after overflow backpressure:', err.message)
      );
      result.success = false;
      result.reason = 'queue_overflow';
      result.warnings.push('queue_overflow');
      return result;
    }

    this.queue.push(item);

    // Debounced persist: coalesce rapid enqueue() calls into a single disk write
    if (!this._persistDebounceTimer) {
      this._persistDebounceTimer = setTimeout(() => {
        this._persistDebounceTimer = null;
        this._pendingPersistence = this.persistQueue()
          .catch((err) => logger.warn('[EmbeddingQueue] Failed to persist queue:', err.message))
          .finally(() => {
            this._pendingPersistence = null;
          });
      }, 500);
    }

    if (this.queue.length >= this.BATCH_SIZE) {
      this._pendingFlush = this.flush()
        .catch((err) => logger.error('[EmbeddingQueue] Flush failed:', err.message))
        .finally(() => {
          this._pendingFlush = null;
        });
    } else {
      this.scheduleFlush();
    }

    return result;
  }

  /**
   * Schedule a delayed flush
   */
  scheduleFlush() {
    if (this.flushTimer) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch((err) => {
        logger.error('[EmbeddingQueue] Delayed flush failed:', err.message);
      });
    }, this.FLUSH_DELAY_MS);
  }

  /**
   * Persist queue to disk
   */
  async persistQueue() {
    await persistQueueData(this.persistencePath, this.queue);
  }

  /**
   * Flush pending embeddings to ChromaDB
   * Uses mutex to prevent race conditions from concurrent flush calls
   */
  async flush() {
    // Acquire mutex to prevent concurrent flush operations
    const release = await this._acquireFlushMutex();

    try {
      // Check conditions after acquiring mutex (double-check pattern)
      if (this.isFlushing || this.queue.length === 0) {
        return;
      }

      this.isFlushing = true;
      const flushStartTime = Date.now();

      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }

      const batchSize = Math.min(this.queue.length, this.BATCH_SIZE);
      const batch = this.queue.slice(0, batchSize);

      this._notifyProgress({
        phase: 'start',
        total: batch.length,
        completed: 0,
        percent: 0,
        queueRemaining: this.queue.length - batchSize
      });

      try {
        logger.debug('[EmbeddingQueue] Flushing batch', { count: batch.length });

        // HIGH FIX: Add error handling for container.resolve to prevent crash if ChromaDB is unavailable
        let chromaDbService;
        try {
          chromaDbService = container.resolve(ServiceIds.CHROMA_DB);
        } catch (resolveError) {
          logger.error(
            '[EmbeddingQueue] Failed to resolve ChromaDB service:',
            resolveError.message
          );
          await this._handleOfflineDatabase(batch, batchSize);
          return;
        }

        if (!chromaDbService) {
          logger.error('[EmbeddingQueue] ChromaDB service is null');
          await this._handleOfflineDatabase(batch, batchSize);
          return;
        }

        await chromaDbService.initialize();

        if (!chromaDbService.isOnline) {
          await this._handleOfflineDatabase(batch, batchSize);
          return;
        }

        this.retryCount = 0;

        const fileItems = [];
        const folderItems = [];

        // Single pass segregation (Fix: Avoid double filtering)
        for (const item of batch) {
          if (item.id.startsWith('folder:')) {
            folderItems.push(item);
          } else {
            fileItems.push(item);
          }
        }
        const failedItemIds = new Set();
        let processedCount = 0;

        // Process files
        if (fileItems.length > 0) {
          processedCount = await processItemsInParallel({
            items: fileItems,
            type: 'file',
            chromaDbService,
            failedItemIds,
            startProcessedCount: processedCount,
            totalBatchSize: batch.length,
            concurrency: this.PARALLEL_FLUSH_CONCURRENCY,
            onProgress: (p) => this._notifyProgress(p),
            onItemFailed: (item, err) => this._failedItemHandler.trackFailedItem(item, err)
          });
        }

        // Process folders
        // FIX CRITICAL #2: Remove void operator that discards processedCount assignment
        // The void operator was causing folder processing counts to be lost
        if (folderItems.length > 0) {
          // Note: processedCount is used as input via startProcessedCount
          processedCount = await processItemsInParallel({
            items: folderItems,
            type: 'folder',
            chromaDbService,
            failedItemIds,
            startProcessedCount: processedCount,
            totalBatchSize: batch.length,
            concurrency: this.PARALLEL_FLUSH_CONCURRENCY,
            onProgress: (p) => this._notifyProgress(p),
            onItemFailed: (item, err) => this._failedItemHandler.trackFailedItem(item, err)
          });
        }

        // Remove processed items from queue by ID to avoid data loss if
        // removeByFilePath() modified the queue during concurrent processing
        const processedIds = new Set(batch.map((item) => item.id));
        this.queue = this.queue.filter((item) => !processedIds.has(item.id));

        const flushDuration = Date.now() - flushStartTime;
        const successCount = batch.length - failedItemIds.size;

        logger.info('[EmbeddingQueue] Successfully flushed batch', {
          success: successCount,
          failed: failedItemIds.size,
          processed: processedCount,
          remaining: this.queue.length,
          duration: `${flushDuration}ms`
        });

        this._notifyProgress({
          phase: 'complete',
          total: batch.length,
          completed: successCount,
          failed: failedItemIds.size,
          processed: processedCount,
          percent: 100,
          queueRemaining: this.queue.length,
          duration: flushDuration
        });

        await this.persistQueue();
        await this._failedItemHandler.retryFailedItems(this.queue, () => this.persistQueue());

        if (this.queue.length > 0) {
          this.scheduleFlush();
        }
      } catch (error) {
        logger.error('[EmbeddingQueue] Flush error:', error.message);
        this._notifyProgress({
          phase: 'error',
          error: error.message,
          retryCount: this.retryCount
        });

        this.retryCount++;
        const backoffDelay = Math.min(
          RETRY.BACKOFF_BASE_MS * 2 ** (this.retryCount - 1),
          RETRY.BACKOFF_MAX_MS
        );
        logger.info(`[EmbeddingQueue] Will retry in ${backoffDelay / 1000}s`);
        const retryTimer = setTimeout(() => this.scheduleFlush(), backoffDelay);
        if (retryTimer.unref) retryTimer.unref();
      } finally {
        this.isFlushing = false;
      }
    } finally {
      // Always release the mutex
      release();
    }
  }

  /**
   * Handle offline database scenario
   */
  async _handleOfflineDatabase(batch, batchSize) {
    this.retryCount++;

    this._notifyProgress({
      phase: 'offline',
      total: batch.length,
      completed: 0,
      retryCount: this.retryCount,
      maxRetries: this.MAX_RETRY_COUNT
    });

    if (this.retryCount >= this.MAX_RETRY_COUNT) {
      logger.error(
        `[EmbeddingQueue] Database offline after ${this.MAX_RETRY_COUNT} retries, moving items to failed queue`
      );
      for (const item of batch) {
        this._failedItemHandler.trackFailedItem(item, 'Database offline');
      }
      this.queue.splice(0, batchSize);
      this.retryCount = 0;
      await this.persistQueue();

      // FIX LOW #19: Notify progress with fatal error phase
      // This allows UI listeners to know the batch failed permanently
      this._notifyProgress({
        phase: 'fatal_error',
        total: batch.length,
        completed: 0,
        failed: batch.length,
        error: `Database offline after ${this.MAX_RETRY_COUNT} retries`
      });

      // FIX HIGH-4: Removed redundant isFlushing = false - handled by flush() finally block
      return;
    }

    logger.warn(
      `[EmbeddingQueue] Database offline, will retry (${this.retryCount}/${this.MAX_RETRY_COUNT})`
    );

    const backoffDelay = Math.min(
      RETRY.BACKOFF_BASE_MS * 2 ** (this.retryCount - 1),
      RETRY.BACKOFF_MAX_MS
    );
    logger.info(`[EmbeddingQueue] Retry in ${backoffDelay / 1000}s`);
    const retryTimer = setTimeout(() => this.scheduleFlush(), backoffDelay);
    if (retryTimer.unref) retryTimer.unref();
    // FIX HIGH-4: Removed redundant isFlushing = false - handled by flush() finally block
  }

  /**
   * Remove pending items by file path
   * Call this when a file is deleted to prevent orphaned embeddings
   * @param {string} filePath - The file path to remove
   * @returns {number} Number of items removed
   */
  removeByFilePath(filePath) {
    if (!filePath) return 0;

    const normalizedPath = normalizePathForIndex(filePath);
    const fileIds = new Set([
      `file:${filePath}`,
      `image:${filePath}`,
      `file:${normalizedPath}`,
      `image:${normalizedPath}`
    ]);
    let removedCount = 0;

    // Remove from main queue using in-place splice to avoid replacing the array
    // reference while flush() holds a stale batchSize from the same array
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (fileIds.has(this.queue[i].id)) {
        this.queue.splice(i, 1);
        removedCount++;
      }
    }

    // Remove from failed items
    fileIds.forEach((id) => this._failedItemHandler.failedItems.delete(id));

    if (removedCount > 0) {
      logger.debug('[EmbeddingQueue] Removed pending items for deleted file', {
        filePath,
        removedCount
      });
      // Persist the updated queue — track the promise for shutdown coordination
      const p = this.persistQueue()
        .catch((err) =>
          logger.warn('[EmbeddingQueue] Failed to persist after removal:', err.message)
        )
        .finally(() => this._outstandingPersistence.delete(p));
      this._outstandingPersistence.add(p);
    }

    return removedCount;
  }

  /**
   * Remove pending items by multiple file paths (batch operation)
   * @param {string[]} filePaths - Array of file paths to remove
   * @returns {number} Total number of items removed
   */
  removeByFilePaths(filePaths) {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return 0;

    const fileIds = new Set(
      filePaths.flatMap((p) => {
        const normalized = normalizePathForIndex(p);
        return [`file:${p}`, `image:${p}`, `file:${normalized}`, `image:${normalized}`];
      })
    );
    let removedCount = 0;

    // Remove from main queue using in-place splice to avoid replacing the array
    // reference while flush() holds a stale batchSize from the same array
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (fileIds.has(this.queue[i].id)) {
        this.queue.splice(i, 1);
        removedCount++;
      }
    }

    // Remove from failed items
    for (const fileId of fileIds) {
      if (this._failedItemHandler.failedItems.has(fileId)) {
        this._failedItemHandler.failedItems.delete(fileId);
      }
    }

    if (removedCount > 0) {
      logger.debug('[EmbeddingQueue] Removed pending items for deleted files', {
        fileCount: filePaths.length,
        removedCount
      });
      // Persist the updated queue — track the promise for shutdown coordination
      const p = this.persistQueue()
        .catch((err) =>
          logger.warn('[EmbeddingQueue] Failed to persist after batch removal:', err.message)
        )
        .finally(() => this._outstandingPersistence.delete(p));
      this._outstandingPersistence.add(p);
    }

    return removedCount;
  }

  /**
   * Internal helper to update paths in queue and failed items
   * @param {string} oldPath
   * @param {string} newPath
   * @returns {{queueUpdated: number, failedUpdated: boolean}}
   * @private
   */
  _updatePath(oldPath, newPath) {
    if (!oldPath || !newPath) return { queueUpdated: 0, failedUpdated: false };

    const normalizedOld = normalizePathForIndex(oldPath);
    const normalizedNew = normalizePathForIndex(newPath);
    const idPairs = [];
    const addPair = (oldId, newId) => {
      if (oldId && newId) {
        idPairs.push({ oldId, newId });
      }
    };

    addPair(`file:${oldPath}`, `file:${newPath}`);
    addPair(`image:${oldPath}`, `image:${newPath}`);
    if (normalizedOld !== oldPath || normalizedNew !== newPath) {
      addPair(`file:${normalizedOld}`, `file:${normalizedNew}`);
      addPair(`image:${normalizedOld}`, `image:${normalizedNew}`);
    }

    let queueUpdated = 0;
    let failedUpdated = false;

    for (const { oldId, newId } of idPairs) {
      // Update main queue items in-place
      for (const item of this.queue) {
        if (item?.id === oldId) {
          item.id = newId;
          if (item.meta && typeof item.meta === 'object') {
            item.meta.path = newPath;
            if (typeof item.meta.name === 'string') {
              item.meta.name = path.basename(newPath);
            }
          }
          queueUpdated++;
        }
      }

      // Update failed items map keys
      const failed = this._failedItemHandler.failedItems.get(oldId);
      if (failed) {
        this._failedItemHandler.failedItems.delete(oldId);
        // Keep the stored item consistent
        if (failed.item && typeof failed.item === 'object') {
          failed.item.id = newId;
          if (failed.item.meta && typeof failed.item.meta === 'object') {
            failed.item.meta.path = newPath;
            if (typeof failed.item.meta.name === 'string') {
              failed.item.meta.name = path.basename(newPath);
            }
          }
        }
        this._failedItemHandler.failedItems.set(newId, failed);
        failedUpdated = true;
      }
    }

    return { queueUpdated, failedUpdated };
  }

  /**
   * Update pending items by file path after a move/rename.
   * This prevents queued embeddings from being flushed under stale IDs.
   *
   * Updates both file: and image: prefixed IDs and also updates failed items.
   *
   * @param {string} oldPath
   * @param {string} newPath
   * @returns {number} Number of queued items updated
   */
  updateByFilePath(oldPath, newPath) {
    const { queueUpdated, failedUpdated } = this._updatePath(oldPath, newPath);

    // PATH-TRACE: Log embedding queue path update
    if (queueUpdated > 0 || failedUpdated) {
      traceQueueUpdate(oldPath, newPath, queueUpdated + (failedUpdated ? 1 : 0));
    }

    if (queueUpdated > 0) {
      const p = this.persistQueue()
        .catch((err) =>
          logger.warn('[EmbeddingQueue] Failed to persist after path update:', err.message)
        )
        .finally(() => this._outstandingPersistence.delete(p));
      this._outstandingPersistence.add(p);
    }

    if (failedUpdated) {
      const p = this._failedItemHandler
        .persistAll()
        .catch((err) =>
          logger.warn(
            '[EmbeddingQueue] Failed to persist failed items after path update:',
            err.message
          )
        )
        .finally(() => this._outstandingPersistence.delete(p));
      this._outstandingPersistence.add(p);
    }

    return queueUpdated;
  }

  /**
   * Batch update pending items by multiple file path changes.
   * @param {Array<{oldPath: string, newPath: string}>} pathChanges
   * @returns {number} Total updated count
   */
  updateByFilePaths(pathChanges) {
    if (!Array.isArray(pathChanges) || pathChanges.length === 0) return 0;

    let totalQueueUpdated = 0;
    let anyFailedUpdated = false;

    for (const change of pathChanges) {
      if (!change?.oldPath || !change?.newPath) continue;
      const { queueUpdated, failedUpdated } = this._updatePath(change.oldPath, change.newPath);
      totalQueueUpdated += queueUpdated;
      if (failedUpdated) anyFailedUpdated = true;
    }

    if (totalQueueUpdated > 0) {
      const p = this.persistQueue()
        .catch((err) =>
          logger.warn('[EmbeddingQueue] Failed to persist after batch path update:', err.message)
        )
        .finally(() => this._outstandingPersistence.delete(p));
      this._outstandingPersistence.add(p);
    }

    if (anyFailedUpdated) {
      const p = this._failedItemHandler
        .persistAll()
        .catch((err) =>
          logger.warn(
            '[EmbeddingQueue] Failed to persist failed items after batch path update:',
            err.message
          )
        )
        .finally(() => this._outstandingPersistence.delete(p));
      this._outstandingPersistence.add(p);
    }

    return totalQueueUpdated;
  }

  /**
   * Get queue statistics
   */
  getStats() {
    const capacityPercent = Math.round((this.queue.length / this.MAX_QUEUE_SIZE) * 100);
    let healthStatus = 'healthy';
    if (capacityPercent >= this.CRITICAL_WATERMARK * 100) {
      healthStatus = 'critical';
    } else if (capacityPercent >= this.HIGH_WATERMARK * 100) {
      healthStatus = 'warning';
    }

    const failedStats = this._failedItemHandler.getStats();

    return {
      queueLength: this.queue.length,
      maxQueueSize: this.MAX_QUEUE_SIZE,
      capacityPercent,
      healthStatus,
      isFlushing: this.isFlushing,
      retryCount: this.retryCount,
      maxRetryCount: this.MAX_RETRY_COUNT,
      highWatermark: this.MEMORY_WARNING_THRESHOLD,
      criticalWatermark: this.CRITICAL_WARNING_THRESHOLD,
      isInitialized: this.initialized,
      hasHighWatermarkWarning: this.memoryWarningLogged,
      hasCriticalWarning: this.criticalWarningLogged,
      ...failedStats
    };
  }

  /**
   * Get dead letter items
   */
  getDeadLetterItems(limit = 100) {
    return this._failedItemHandler.getDeadLetterItems(limit);
  }

  /**
   * Clear dead letter queue
   */
  async clearDeadLetterQueue() {
    return this._failedItemHandler.clearDeadLetterQueue();
  }

  /**
   * Retry a dead letter item
   */
  async retryDeadLetterItem(itemId) {
    const result = await this._failedItemHandler.retryDeadLetterItem(itemId, this.queue, () =>
      this.persistQueue()
    );
    if (result) this.scheduleFlush();
    return result;
  }

  /**
   * Retry all dead letter items
   */
  async retryAllDeadLetterItems() {
    const count = await this._failedItemHandler.retryAllDeadLetterItems(this.queue, () =>
      this.persistQueue()
    );
    if (count > 0) this.scheduleFlush();
    return count;
  }

  /**
   * Force flush immediately
   */
  async forceFlush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Await the existing flush promise instead of busy-wait polling.
    // This is both more efficient and avoids hogging the event loop.
    if (this.isFlushing && this._pendingFlush) {
      logger.info('[EmbeddingQueue] Waiting for current flush to complete...');
      const maxWait = 30000;
      try {
        await Promise.race([
          this._pendingFlush,
          new Promise((_, reject) => {
            const t = setTimeout(() => {
              const err = new Error('Force flush timeout waiting for current flush');
              err.code = 'FORCE_FLUSH_TIMEOUT';
              reject(err);
            }, maxWait);
            if (t.unref) t.unref();
          })
        ]);
      } catch (err) {
        if (err.code === 'FORCE_FLUSH_TIMEOUT') {
          logger.warn(
            '[EmbeddingQueue] Force flush timeout - current flush still in progress after 30s. Proceeding with persistence only.',
            { queueLength: this.queue.length }
          );
          await this.persistQueue();
          await this._failedItemHandler.persistAll();
          logger.info('[EmbeddingQueue] Force flush completed (persistence only due to timeout)');
          return;
        }
        // Other errors from the flush itself are non-fatal here
        logger.warn(
          '[EmbeddingQueue] Pending flush resolved with error during forceFlush:',
          err.message
        );
      }
    }

    if (this.queue.length > 0) {
      logger.info(`[EmbeddingQueue] Force flushing ${this.queue.length} remaining items`);
      try {
        await this.flush();
      } catch (flushError) {
        logger.error('[EmbeddingQueue] Force flush failed:', flushError.message);
        // Continue with persistence even if flush fails
      }
    }

    await this.persistQueue();
    await this._failedItemHandler.persistAll();
    logger.info('[EmbeddingQueue] Force flush complete');
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    logger.info('[EmbeddingQueue] Shutting down...');

    // Set shutdown flag first — prevents new enqueues from being accepted
    this._isShuttingDown = true;

    // FIX: Clear debounce timer used by enqueue() persistence coalescing
    if (this._persistDebounceTimer) {
      clearTimeout(this._persistDebounceTimer);
      this._persistDebounceTimer = null;
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // FIX: Clear progress tracker callbacks to prevent memory leak
    if (this._progressTracker?.clear) {
      this._progressTracker.clear();
    }

    // FIX MED #17: Wait for any pending persistence operations before final persist
    // This prevents race conditions where async persistence from enqueue() is still running
    if (this._pendingPersistence) {
      try {
        await this._pendingPersistence;
      } catch (err) {
        logger.warn('[EmbeddingQueue] Pending persistence failed during shutdown:', err.message);
      }
    }

    // FIX MED #17: Wait for pending flush operations
    if (this._pendingFlush) {
      try {
        await this._pendingFlush;
      } catch (err) {
        logger.warn('[EmbeddingQueue] Pending flush failed during shutdown:', err.message);
      }
    }

    // Drain all outstanding persistence promises from remove/update operations
    if (this._outstandingPersistence.size > 0) {
      logger.info('[EmbeddingQueue] Waiting for outstanding persistence operations', {
        count: this._outstandingPersistence.size
      });
      try {
        await Promise.allSettled([...this._outstandingPersistence]);
      } catch (err) {
        logger.warn('[EmbeddingQueue] Error draining outstanding persistence:', err.message);
      }
    }

    await this.persistQueue();
    await this._failedItemHandler.persistAll();

    logger.info('[EmbeddingQueue] Shutdown complete', {
      pendingItems: this.queue.length,
      failedItems: this._failedItemHandler.failedItems.size,
      deadLetterItems: this._failedItemHandler.deadLetterQueue.length
    });
  }
}

module.exports = EmbeddingQueue;
