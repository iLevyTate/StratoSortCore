const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
const { logger } = require('../../shared/logger');
const { getInstance: getChromaDB } = require('../services/ChromaDBService');

logger.setContext('EmbeddingQueue');

class EmbeddingQueue {
  constructor() {
    this.queue = [];
    this.persistencePath = path.join(
      app.getPath('userData'),
      'pending_embeddings.json',
    );
    this.BATCH_SIZE = 50;
    this.FLUSH_DELAY_MS = 500;
    this.flushTimer = null;
    this.isFlushing = false;
    this.initialized = false;
  }

  /**
   * Initialize the queue by loading pending items from disk
   */
  async initialize() {
    if (this.initialized) return;

    try {
      const exists = await fs
        .access(this.persistencePath)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        const data = await fs.readFile(this.persistencePath, 'utf8');
        try {
          const savedQueue = JSON.parse(data);
          if (Array.isArray(savedQueue) && savedQueue.length > 0) {
            this.queue = savedQueue;
            logger.info(
              `[EmbeddingQueue] Restored ${this.queue.length} pending embeddings from disk`,
            );
            // Schedule immediate flush for restored items
            this.scheduleFlush();
          }
        } catch (parseError) {
          logger.error(
            '[EmbeddingQueue] Failed to parse pending embeddings file',
            parseError,
          );
          // Backup corrupt file
          await fs
            .rename(
              this.persistencePath,
              `${this.persistencePath}.corrupt.${Date.now()}`,
            )
            .catch(() => {});
        }
      }
      this.initialized = true;
    } catch (error) {
      logger.error('[EmbeddingQueue] Initialization error:', error);
      // Continue despite error, just won't have persistence initially
      this.initialized = true;
    }
  }

  /**
   * Add an item to the embedding queue
   * @param {Object} item - Embedding item { id, vector, model, meta, updatedAt }
   */
  async enqueue(item) {
    if (!item || !item.id || !item.vector) {
      logger.warn('[EmbeddingQueue] Invalid item ignored', {
        id: item?.id,
      });
      return;
    }

    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }

    this.queue.push(item);

    // Persist to disk asynchronously to prevent data loss on crash
    // We don't await this to avoid blocking the UI/Main thread too much
    this.persistQueue().catch((err) => {
      logger.warn('[EmbeddingQueue] Failed to persist queue:', err.message);
    });

    if (this.queue.length >= this.BATCH_SIZE) {
      this.flush().catch((err) => {
        logger.error('[EmbeddingQueue] Flush failed:', err.message);
      });
    } else {
      this.scheduleFlush();
    }
  }

  /**
   * Schedule a delayed flush
   */
  scheduleFlush() {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch((err) => {
        logger.error('[EmbeddingQueue] Delayed flush failed:', err.message);
      });
    }, this.FLUSH_DELAY_MS);
  }

  /**
   * Persist current queue state to disk
   */
  async persistQueue() {
    try {
      if (this.queue.length === 0) {
        // If empty, remove the file to keep things clean
        await fs.unlink(this.persistencePath).catch((e) => {
          if (e.code !== 'ENOENT') throw e;
        });
        return;
      }
      await fs.writeFile(
        this.persistencePath,
        JSON.stringify(this.queue),
        'utf8',
      );
    } catch (error) {
      // Log but don't throw, as this is a background safety mechanism
      logger.debug(
        '[EmbeddingQueue] Error persisting queue to disk:',
        error.message,
      );
    }
  }

  /**
   * Flush pending embeddings to ChromaDB
   */
  async flush() {
    if (this.isFlushing || this.queue.length === 0) {
      return;
    }

    this.isFlushing = true;

    // Clear timer if running
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Take a snapshot of the queue
    const batch = [...this.queue];
    // Clear queue in memory (will be re-added if failure occurs)
    this.queue = []; // Optimistic clear

    try {
      logger.debug('[EmbeddingQueue] Flushing batch', { count: batch.length });

      const chromaDbService = getChromaDB();
      await chromaDbService.initialize();

      if (!chromaDbService.isOnline) {
        logger.warn('[EmbeddingQueue] Database offline, requeuing items');
        // Put items back at the front
        this.queue.unshift(...batch);
        // Don't persist yet, keep old file (which contains the batch)

        // Retry later
        setTimeout(() => this.scheduleFlush(), 5000);
        return;
      }

      const fileItems = batch.filter((i) => !i.id.startsWith('folder:'));
      const folderItems = batch.filter((i) => i.id.startsWith('folder:'));

      if (fileItems.length > 0) {
        await chromaDbService.batchUpsertFiles(fileItems);
      }

      if (folderItems.length > 0) {
        // Adapt to batchUpsertFolders structure
        const formattedFolders = folderItems.map((item) => ({
          id: item.id,
          vector: item.vector,
          name: item.meta?.name || item.id,
          path: item.meta?.path,
          model: item.model,
          updatedAt: item.updatedAt,
        }));
        await chromaDbService.batchUpsertFolders(formattedFolders);
      }

      logger.info('[EmbeddingQueue] Successfully flushed batch', {
        files: fileItems.length,
        folders: folderItems.length,
      });

      // Now we can safely update persistence with the *remaining* queue (new items added during flush)
      await this.persistQueue();
    } catch (error) {
      logger.error('[EmbeddingQueue] Flush error:', error.message);

      // Restore items
      this.queue.unshift(...batch);

      // We don't persist here because disk likely still has them (we didn't persist "empty").
      // If we did persist intermediate state (empty), we'd need to re-persist here.
      // Since we didn't call persistQueue() after clearing this.queue, disk is stale (contains batch).
      // Which is what we want if we failed.
    } finally {
      this.isFlushing = false;
    }
  }
}

module.exports = new EmbeddingQueue();
