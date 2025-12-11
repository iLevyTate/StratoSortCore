/**
 * EmbeddingQueue Core Class
 *
 * Core embedding queue with persistence, retry logic, and parallel processing.
 *
 * @module embeddingQueue/EmbeddingQueueCore
 */

const path = require('path');
const { app } = require('electron');
const { logger } = require('../../../shared/logger');
const { container, ServiceIds } = require('../../services/ServiceContainer');
const { get: getConfig } = require('../../../shared/config/index');
const {
  BATCH,
  LIMITS,
  THRESHOLDS,
  RETRY,
  CONCURRENCY
} = require('../../../shared/performanceConstants');

const { loadPersistedData, persistQueueData } = require('./persistence');
const { createFailedItemHandler } = require('./failedItemHandler');
const { processItemsInParallel } = require('./parallelProcessor');
const { createProgressTracker } = require('./progress');

logger.setContext('EmbeddingQueue');

class EmbeddingQueue {
  constructor() {
    this.queue = [];
    this.persistencePath = path.join(app.getPath('userData'), 'pending_embeddings.json');

    // Configuration from unified config
    this.BATCH_SIZE = getConfig('ANALYSIS.batchSize', 50);
    this.FLUSH_DELAY_MS = BATCH.EMBEDDING_FLUSH_DELAY_MS;
    this.flushTimer = null;
    this.isFlushing = false;
    this.initialized = false;

    // Memory limits
    this.MAX_QUEUE_SIZE = LIMITS.MAX_QUEUE_SIZE;
    this.MAX_RETRY_COUNT = getConfig('ANALYSIS.retryAttempts', 10);
    this.retryCount = 0;

    // Memory monitoring thresholds
    this.HIGH_WATERMARK = THRESHOLDS.QUEUE_HIGH_WATERMARK;
    this.CRITICAL_WATERMARK = THRESHOLDS.QUEUE_CRITICAL_WATERMARK;
    this.MEMORY_WARNING_THRESHOLD = Math.floor(this.MAX_QUEUE_SIZE * this.HIGH_WATERMARK);
    this.CRITICAL_WARNING_THRESHOLD = Math.floor(this.MAX_QUEUE_SIZE * this.CRITICAL_WATERMARK);
    this.memoryWarningLogged = false;
    this.criticalWarningLogged = false;

    // Parallel processing config
    this.PARALLEL_FLUSH_CONCURRENCY = CONCURRENCY.EMBEDDING_FLUSH;

    // Progress tracking
    this._progressTracker = createProgressTracker();

    // Failed item handler
    this._failedItemHandler = createFailedItemHandler({
      itemMaxRetries: getConfig('ANALYSIS.retryAttempts', 3),
      maxDeadLetterSize: LIMITS.MAX_DEAD_LETTER_SIZE,
      failedItemsPath: path.join(app.getPath('userData'), 'failed_embeddings.json'),
      deadLetterPath: path.join(app.getPath('userData'), 'dead_letter_embeddings.json')
    });

    // Track pending operations for graceful shutdown
    this._pendingPersistence = null;
    this._pendingFlush = null;
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
      const failedItemsPath = path.join(app.getPath('userData'), 'failed_embeddings.json');
      await loadPersistedData(
        failedItemsPath,
        (data) => {
          if (data && typeof data === 'object') {
            const entries = Array.isArray(data) ? data : Object.entries(data);
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
      const deadLetterPath = path.join(app.getPath('userData'), 'dead_letter_embeddings.json');
      await loadPersistedData(
        deadLetterPath,
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
    if (!item || !item.id || !item.vector) {
      logger.warn('[EmbeddingQueue] Invalid item ignored', { id: item?.id });
      return { success: false, reason: 'invalid_item' };
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

    // Persist asynchronously
    this._pendingPersistence = this.persistQueue()
      .catch((err) => logger.warn('[EmbeddingQueue] Failed to persist queue:', err.message))
      .finally(() => {
        this._pendingPersistence = null;
      });

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
   */
  async flush() {
    if (this.isFlushing || this.queue.length === 0) return;

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

      const chromaDbService = container.resolve(ServiceIds.CHROMA_DB);
      await chromaDbService.initialize();

      if (!chromaDbService.isOnline) {
        await this._handleOfflineDatabase(batch, batchSize);
        return;
      }

      this.retryCount = 0;

      const fileItems = batch.filter((i) => !i.id.startsWith('folder:'));
      const folderItems = batch.filter((i) => i.id.startsWith('folder:'));
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
      if (folderItems.length > 0) {
        await processItemsInParallel({
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

      // Remove processed items from queue
      this.queue.splice(0, batchSize);

      const flushDuration = Date.now() - flushStartTime;
      const successCount = batch.length - failedItemIds.size;

      logger.info('[EmbeddingQueue] Successfully flushed batch', {
        success: successCount,
        failed: failedItemIds.size,
        remaining: this.queue.length,
        duration: `${flushDuration}ms`
      });

      this._notifyProgress({
        phase: 'complete',
        total: batch.length,
        completed: successCount,
        failed: failedItemIds.size,
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
        RETRY.BACKOFF_BASE_MS * Math.pow(2, this.retryCount - 1),
        RETRY.BACKOFF_MAX_MS
      );
      logger.info(`[EmbeddingQueue] Will retry in ${backoffDelay / 1000}s`);
      const retryTimer = setTimeout(() => this.scheduleFlush(), backoffDelay);
      if (retryTimer.unref) retryTimer.unref();
    } finally {
      this.isFlushing = false;
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
      this.isFlushing = false;
      return;
    }

    logger.warn(
      `[EmbeddingQueue] Database offline, will retry (${this.retryCount}/${this.MAX_RETRY_COUNT})`
    );

    const backoffDelay = Math.min(
      RETRY.BACKOFF_BASE_MS * Math.pow(2, this.retryCount - 1),
      RETRY.BACKOFF_MAX_MS
    );
    logger.info(`[EmbeddingQueue] Retry in ${backoffDelay / 1000}s`);
    const retryTimer = setTimeout(() => this.scheduleFlush(), backoffDelay);
    if (retryTimer.unref) retryTimer.unref();
    this.isFlushing = false;
  }

  /**
   * Remove pending items by file path
   * Call this when a file is deleted to prevent orphaned embeddings
   * @param {string} filePath - The file path to remove
   * @returns {number} Number of items removed
   */
  removeByFilePath(filePath) {
    if (!filePath) return 0;

    const fileId = `file:${filePath}`;
    const initialLength = this.queue.length;

    // Remove from main queue
    this.queue = this.queue.filter((item) => item.id !== fileId);

    // Remove from failed items
    if (this._failedItemHandler.failedItems.has(fileId)) {
      this._failedItemHandler.failedItems.delete(fileId);
    }

    const removedCount = initialLength - this.queue.length;

    if (removedCount > 0) {
      logger.debug('[EmbeddingQueue] Removed pending items for deleted file', {
        filePath,
        removedCount
      });
      // Persist the updated queue
      this.persistQueue().catch((err) =>
        logger.warn('[EmbeddingQueue] Failed to persist after removal:', err.message)
      );
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

    const fileIds = new Set(filePaths.map((p) => `file:${p}`));
    const initialLength = this.queue.length;

    // Remove from main queue
    this.queue = this.queue.filter((item) => !fileIds.has(item.id));

    // Remove from failed items
    for (const fileId of fileIds) {
      if (this._failedItemHandler.failedItems.has(fileId)) {
        this._failedItemHandler.failedItems.delete(fileId);
      }
    }

    const removedCount = initialLength - this.queue.length;

    if (removedCount > 0) {
      logger.debug('[EmbeddingQueue] Removed pending items for deleted files', {
        fileCount: filePaths.length,
        removedCount
      });
      // Persist the updated queue
      this.persistQueue().catch((err) =>
        logger.warn('[EmbeddingQueue] Failed to persist after batch removal:', err.message)
      );
    }

    return removedCount;
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

    if (this.isFlushing) {
      logger.info('[EmbeddingQueue] Waiting for current flush to complete...');
      const maxWait = 30000;
      const startTime = Date.now();
      while (this.isFlushing && Date.now() - startTime < maxWait) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    if (this.queue.length > 0) {
      logger.info(`[EmbeddingQueue] Force flushing ${this.queue.length} remaining items`);
      await this.flush();
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

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // FIX: Clear progress tracker callbacks to prevent memory leak
    if (this._progressTracker?.clear) {
      this._progressTracker.clear();
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
