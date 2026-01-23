/**
 * FilePathCoordinator - Central coordinator for atomic path updates
 *
 * This service ensures all path-dependent systems are updated atomically
 * when files are moved, renamed, copied, or deleted. It prevents split-brain
 * scenarios where some systems have the new path while others have the old.
 *
 * Systems coordinated:
 * - ChromaDB metadata (embeddings)
 * - AnalysisHistoryService (search indexes)
 * - EmbeddingQueue (pending embeddings)
 * - ProcessingStateService (in-progress jobs)
 * - Cache invalidation bus (all caches)
 *
 * @module services/FilePathCoordinator
 */

const path = require('path');
const { logger: baseLogger, createLogger } = require('../../shared/logger');
const { normalizePathForIndex } = require('../../shared/pathSanitization');
const { getPathVariants } = require('../utils/fileIdUtils');
const { EventEmitter } = require('events');
const {
  traceCoordinatorStart,
  traceCoordinatorComplete,
  traceDbUpdate
} = require('../../shared/pathTraceLogger');

const logger =
  typeof createLogger === 'function' ? createLogger('FilePathCoordinator') : baseLogger;
if (typeof createLogger !== 'function' && logger?.setContext) {
  logger.setContext('FilePathCoordinator');
}

/**
 * Path change event types
 * @readonly
 * @enum {string}
 */
const PathChangeType = {
  MOVE: 'move',
  COPY: 'copy',
  DELETE: 'delete',
  RENAME: 'rename'
};

/**
 * FilePathCoordinator class
 *
 * Centralizes all path update operations to ensure atomicity across
 * all path-dependent systems in the application.
 */
class FilePathCoordinator extends EventEmitter {
  constructor(options = {}) {
    super();

    // Service references - set via setServices() after construction
    this._chromaDbService = options.chromaDbService || null;
    this._analysisHistoryService = options.analysisHistoryService || null;
    this._embeddingQueue = options.embeddingQueue || null;
    this._processingStateService = options.processingStateService || null;
    this._cacheInvalidationBus = options.cacheInvalidationBus || null;

    // Track pending operations for debugging
    this._pendingOperations = new Map();
    this._operationIdCounter = 0;

    // Configuration
    this._batchSize = options.batchSize || 50;

    logger.info('[FilePathCoordinator] Initialized');
  }

  /**
   * Set service references after construction
   * This allows for lazy resolution of dependencies
   *
   * @param {Object} services - Service instances
   */
  setServices(services) {
    if (services.chromaDbService) this._chromaDbService = services.chromaDbService;
    if (services.analysisHistoryService)
      this._analysisHistoryService = services.analysisHistoryService;
    if (services.embeddingQueue) this._embeddingQueue = services.embeddingQueue;
    if (services.processingStateService)
      this._processingStateService = services.processingStateService;
    if (services.cacheInvalidationBus) this._cacheInvalidationBus = services.cacheInvalidationBus;

    logger.debug('[FilePathCoordinator] Services updated', {
      hasChromaDb: !!this._chromaDbService,
      hasAnalysisHistory: !!this._analysisHistoryService,
      hasEmbeddingQueue: !!this._embeddingQueue,
      hasProcessingState: !!this._processingStateService,
      hasCacheInvalidation: !!this._cacheInvalidationBus
    });
  }

  /**
   * Atomically update a file path across all systems
   *
   * @param {string} oldPath - Original file path
   * @param {string} newPath - New file path
   * @param {Object} options - Options
   * @param {string} options.type - Change type (move, rename, copy)
   * @param {boolean} options.skipChromaDb - Skip ChromaDB update
   * @param {boolean} options.skipAnalysisHistory - Skip analysis history update
   * @param {boolean} options.skipEmbeddingQueue - Skip embedding queue update
   * @param {boolean} options.skipProcessingState - Skip processing state update
   * @returns {Promise<{success: boolean, errors: Array, updated: Object}>}
   */
  async atomicPathUpdate(oldPath, newPath, options = {}) {
    const operationId = ++this._operationIdCounter;
    const startTime = Date.now();

    logger.info('[FilePathCoordinator] Starting atomic path update', {
      operationId,
      oldPath: path.basename(oldPath),
      newPath: path.basename(newPath),
      type: options.type || PathChangeType.MOVE
    });

    // PATH-TRACE: Log coordinator start
    traceCoordinatorStart(oldPath, newPath, options.type || PathChangeType.MOVE);

    this._pendingOperations.set(operationId, {
      oldPath,
      newPath,
      startTime,
      type: options.type || PathChangeType.MOVE
    });

    const errors = [];
    const updated = {
      chromaDb: false,
      analysisHistory: false,
      embeddingQueue: false,
      processingState: false,
      cacheInvalidated: false
    };

    try {
      // 1. Update ChromaDB metadata (embeddings)
      if (!options.skipChromaDb && this._chromaDbService) {
        try {
          await this._updateChromaDbPath(oldPath, newPath);
          updated.chromaDb = true;
          // PATH-TRACE: Log ChromaDB update success
          traceDbUpdate('chromadb', oldPath, newPath, true);
        } catch (err) {
          errors.push({ system: 'chromaDb', error: err.message });
          logger.warn('[FilePathCoordinator] ChromaDB update failed', { error: err.message });
          // PATH-TRACE: Log ChromaDB update failure
          traceDbUpdate('chromadb', oldPath, newPath, false, err.message);
        }
      } else if (!options.skipChromaDb) {
        errors.push({ system: 'chromaDb', error: 'ChromaDB service unavailable' });
        logger.warn('[FilePathCoordinator] ChromaDB service unavailable for path update');
      }

      // 2. Update AnalysisHistoryService (search indexes)
      if (!options.skipAnalysisHistory && this._analysisHistoryService) {
        try {
          await this._updateAnalysisHistoryPath(oldPath, newPath);
          updated.analysisHistory = true;
          // PATH-TRACE: Log analysis history update success
          traceDbUpdate('history', oldPath, newPath, true);
        } catch (err) {
          errors.push({ system: 'analysisHistory', error: err.message });
          logger.warn('[FilePathCoordinator] Analysis history update failed', {
            error: err.message
          });
          // PATH-TRACE: Log analysis history update failure
          traceDbUpdate('history', oldPath, newPath, false, err.message);
        }
      } else if (!options.skipAnalysisHistory) {
        errors.push({ system: 'analysisHistory', error: 'Analysis history service unavailable' });
        logger.warn('[FilePathCoordinator] Analysis history service unavailable for path update');
      }

      // 3. Update EmbeddingQueue pending items
      if (!options.skipEmbeddingQueue && this._embeddingQueue) {
        try {
          this._updateEmbeddingQueuePath(oldPath, newPath);
          updated.embeddingQueue = true;
          // PATH-TRACE: Log embedding queue update success
          traceDbUpdate('queue', oldPath, newPath, true);
        } catch (err) {
          errors.push({ system: 'embeddingQueue', error: err.message });
          logger.warn('[FilePathCoordinator] Embedding queue update failed', {
            error: err.message
          });
          // PATH-TRACE: Log embedding queue update failure
          traceDbUpdate('queue', oldPath, newPath, false, err.message);
        }
      } else if (!options.skipEmbeddingQueue) {
        errors.push({ system: 'embeddingQueue', error: 'Embedding queue unavailable' });
        logger.warn('[FilePathCoordinator] Embedding queue unavailable for path update');
      }

      // 4. Update ProcessingStateService
      if (!options.skipProcessingState && this._processingStateService) {
        try {
          await this._updateProcessingStatePath(oldPath, newPath);
          updated.processingState = true;
          // PATH-TRACE: Log processing state update success
          traceDbUpdate('processingState', oldPath, newPath, true);
        } catch (err) {
          errors.push({ system: 'processingState', error: err.message });
          logger.warn('[FilePathCoordinator] Processing state update failed', {
            error: err.message
          });
          // PATH-TRACE: Log processing state update failure
          traceDbUpdate('processingState', oldPath, newPath, false, err.message);
        }
      } else if (!options.skipProcessingState) {
        errors.push({ system: 'processingState', error: 'Processing state service unavailable' });
        logger.warn('[FilePathCoordinator] Processing state service unavailable for path update');
      }

      // 5. Broadcast cache invalidation
      if (this._cacheInvalidationBus) {
        try {
          this._cacheInvalidationBus.invalidateForPathChange(oldPath, newPath, options.type);
          updated.cacheInvalidated = true;
        } catch (err) {
          errors.push({ system: 'cacheInvalidation', error: err.message });
          logger.warn('[FilePathCoordinator] Cache invalidation failed', { error: err.message });
        }
      } else {
        errors.push({ system: 'cacheInvalidation', error: 'Cache invalidation bus unavailable' });
        logger.warn('[FilePathCoordinator] Cache invalidation bus unavailable for path update');
      }

      // Emit path-changed event for any listeners (e.g., IPC to renderer)
      this.emit('path-changed', {
        type: options.type || PathChangeType.MOVE,
        oldPath,
        newPath,
        updated,
        errors
      });

      const duration = Date.now() - startTime;
      logger.info('[FilePathCoordinator] Atomic path update complete', {
        operationId,
        duration,
        updated,
        errorCount: errors.length
      });

      // PATH-TRACE: Log coordinator completion with full summary
      traceCoordinatorComplete(oldPath, newPath, updated, errors.length);

      return {
        success: errors.length === 0,
        errors,
        updated
      };
    } finally {
      this._pendingOperations.delete(operationId);
    }
  }

  /**
   * Batch update multiple file paths atomically
   *
   * @param {Array<{oldPath: string, newPath: string}>} pathChanges - Path change pairs
   * @param {Object} options - Options (same as atomicPathUpdate)
   * @returns {Promise<{success: boolean, results: Array, summary: Object}>}
   */
  async batchPathUpdate(pathChanges, options = {}) {
    if (!Array.isArray(pathChanges) || pathChanges.length === 0) {
      return { success: true, results: [], summary: { total: 0, successful: 0, failed: 0 } };
    }

    const startTime = Date.now();
    logger.info('[FilePathCoordinator] Starting batch path update', {
      count: pathChanges.length,
      type: options.type || PathChangeType.MOVE
    });

    const results = [];
    const errors = [];
    const missingSystems = new Set();

    // Process in batches for large updates
    for (let i = 0; i < pathChanges.length; i += this._batchSize) {
      const batch = pathChanges.slice(i, i + this._batchSize);

      const errorCountBeforeBatch = errors.length;

      // 1. Batch update ChromaDB
      if (!options.skipChromaDb && this._chromaDbService) {
        try {
          await this._batchUpdateChromaDbPaths(batch);
        } catch (err) {
          errors.push({ system: 'chromaDb', error: err.message, batch: i / this._batchSize });
          logger.warn('[FilePathCoordinator] ChromaDB batch update failed', { error: err.message });
        }
      } else if (!options.skipChromaDb && !missingSystems.has('chromaDb')) {
        errors.push({ system: 'chromaDb', error: 'ChromaDB service unavailable' });
        missingSystems.add('chromaDb');
        logger.warn('[FilePathCoordinator] ChromaDB service unavailable for batch update');
      }

      // 2. Batch update Analysis History
      if (!options.skipAnalysisHistory && this._analysisHistoryService) {
        try {
          await this._batchUpdateAnalysisHistoryPaths(batch);
        } catch (err) {
          errors.push({
            system: 'analysisHistory',
            error: err.message,
            batch: i / this._batchSize
          });
          logger.warn('[FilePathCoordinator] Analysis history batch update failed', {
            error: err.message
          });
        }
      } else if (!options.skipAnalysisHistory && !missingSystems.has('analysisHistory')) {
        errors.push({ system: 'analysisHistory', error: 'Analysis history service unavailable' });
        missingSystems.add('analysisHistory');
        logger.warn('[FilePathCoordinator] Analysis history service unavailable for batch update');
      }

      // 3. Batch update Embedding Queue
      if (!options.skipEmbeddingQueue && this._embeddingQueue) {
        try {
          this._batchUpdateEmbeddingQueuePaths(batch);
        } catch (err) {
          errors.push({ system: 'embeddingQueue', error: err.message, batch: i / this._batchSize });
          logger.warn('[FilePathCoordinator] Embedding queue batch update failed', {
            error: err.message
          });
        }
      } else if (!options.skipEmbeddingQueue && !missingSystems.has('embeddingQueue')) {
        errors.push({ system: 'embeddingQueue', error: 'Embedding queue unavailable' });
        missingSystems.add('embeddingQueue');
        logger.warn('[FilePathCoordinator] Embedding queue unavailable for batch update');
      }

      const batchHadErrors = errors.length > errorCountBeforeBatch;

      // Track results for each path change
      batch.forEach((change) => {
        results.push({
          oldPath: change.oldPath,
          newPath: change.newPath,
          success: !batchHadErrors
        });
      });
    }

    // 4. Single cache invalidation for all paths
    if (this._cacheInvalidationBus) {
      try {
        this._cacheInvalidationBus.invalidateBatch(pathChanges, options.type);
      } catch (err) {
        errors.push({ system: 'cacheInvalidation', error: err.message });
        logger.warn('[FilePathCoordinator] Cache invalidation failed', { error: err.message });
      }
    } else if (!missingSystems.has('cacheInvalidation')) {
      errors.push({ system: 'cacheInvalidation', error: 'Cache invalidation bus unavailable' });
      missingSystems.add('cacheInvalidation');
      logger.warn('[FilePathCoordinator] Cache invalidation bus unavailable for batch update');
    }

    // Emit batch event
    this.emit('paths-changed', {
      type: options.type || PathChangeType.MOVE,
      changes: pathChanges,
      errors
    });

    const duration = Date.now() - startTime;
    const successful = results.filter((result) => result.success).length;
    const summary = {
      total: pathChanges.length,
      successful,
      failed: pathChanges.length - successful,
      duration
    };

    logger.info('[FilePathCoordinator] Batch path update complete', summary);

    return {
      success: errors.length === 0,
      results,
      errors,
      summary
    };
  }

  /**
   * Handle file deletion across all systems
   *
   * @param {string} filePath - Path of deleted file
   * @param {Object} options - Options
   * @returns {Promise<{success: boolean, errors: Array, cleaned: Object}>}
   */
  async handleFileDeletion(filePath, options = {}) {
    const startTime = Date.now();

    logger.info('[FilePathCoordinator] Handling file deletion', {
      path: path.basename(filePath)
    });

    const errors = [];
    const cleaned = {
      chromaDb: false,
      analysisHistory: false,
      embeddingQueue: false,
      processingState: false,
      cacheInvalidated: false
    };

    // 1. Remove from ChromaDB
    if (!options.skipChromaDb && this._chromaDbService) {
      try {
        await this._deleteFromChromaDb(filePath);
        cleaned.chromaDb = true;
      } catch (err) {
        errors.push({ system: 'chromaDb', error: err.message });
        logger.warn('[FilePathCoordinator] ChromaDB deletion failed', { error: err.message });
      }
    } else if (!options.skipChromaDb) {
      errors.push({ system: 'chromaDb', error: 'ChromaDB service unavailable' });
      logger.warn('[FilePathCoordinator] ChromaDB service unavailable for deletion');
    }

    // 2. Remove from Analysis History
    if (!options.skipAnalysisHistory && this._analysisHistoryService) {
      try {
        await this._deleteFromAnalysisHistory(filePath);
        cleaned.analysisHistory = true;
      } catch (err) {
        errors.push({ system: 'analysisHistory', error: err.message });
        logger.warn('[FilePathCoordinator] Analysis history deletion failed', {
          error: err.message
        });
      }
    } else if (!options.skipAnalysisHistory) {
      errors.push({ system: 'analysisHistory', error: 'Analysis history service unavailable' });
      logger.warn('[FilePathCoordinator] Analysis history service unavailable for deletion');
    }

    // 3. Remove from Embedding Queue
    if (!options.skipEmbeddingQueue && this._embeddingQueue) {
      try {
        this._removeFromEmbeddingQueue(filePath);
        cleaned.embeddingQueue = true;
      } catch (err) {
        errors.push({ system: 'embeddingQueue', error: err.message });
        logger.warn('[FilePathCoordinator] Embedding queue removal failed', { error: err.message });
      }
    } else if (!options.skipEmbeddingQueue) {
      errors.push({ system: 'embeddingQueue', error: 'Embedding queue unavailable' });
      logger.warn('[FilePathCoordinator] Embedding queue unavailable for deletion');
    }

    // 4. Clear from Processing State
    if (!options.skipProcessingState && this._processingStateService) {
      try {
        await this._clearFromProcessingState(filePath);
        cleaned.processingState = true;
      } catch (err) {
        errors.push({ system: 'processingState', error: err.message });
        logger.warn('[FilePathCoordinator] Processing state clear failed', { error: err.message });
      }
    } else if (!options.skipProcessingState) {
      errors.push({ system: 'processingState', error: 'Processing state service unavailable' });
      logger.warn('[FilePathCoordinator] Processing state service unavailable for deletion');
    }

    // 5. Broadcast cache invalidation
    if (this._cacheInvalidationBus) {
      try {
        this._cacheInvalidationBus.invalidateForDeletion(filePath);
        cleaned.cacheInvalidated = true;
      } catch (err) {
        errors.push({ system: 'cacheInvalidation', error: err.message });
        logger.warn('[FilePathCoordinator] Cache invalidation failed', { error: err.message });
      }
    } else {
      errors.push({ system: 'cacheInvalidation', error: 'Cache invalidation bus unavailable' });
      logger.warn('[FilePathCoordinator] Cache invalidation bus unavailable for deletion');
    }

    // Emit deletion event
    this.emit('file-deleted', {
      path: filePath,
      cleaned,
      errors
    });

    const duration = Date.now() - startTime;
    logger.info('[FilePathCoordinator] File deletion handling complete', {
      duration,
      cleaned,
      errorCount: errors.length
    });

    return {
      success: errors.length === 0,
      errors,
      cleaned
    };
  }

  /**
   * Handle file copy (clone entries to new path)
   *
   * @param {string} sourcePath - Source file path
   * @param {string} destPath - Destination file path
   * @param {Object} options - Options
   * @returns {Promise<{success: boolean, errors: Array, cloned: Object}>}
   */
  async handleFileCopy(sourcePath, destPath, options = {}) {
    const startTime = Date.now();

    logger.info('[FilePathCoordinator] Handling file copy', {
      source: path.basename(sourcePath),
      dest: path.basename(destPath)
    });

    const errors = [];
    const cloned = {
      chromaDb: false,
      analysisHistory: false,
      cacheInvalidated: false
    };

    // 1. Clone ChromaDB embedding
    if (!options.skipChromaDb && this._chromaDbService) {
      try {
        await this._cloneChromaDbEntry(sourcePath, destPath);
        cloned.chromaDb = true;
      } catch (err) {
        errors.push({ system: 'chromaDb', error: err.message });
        logger.warn('[FilePathCoordinator] ChromaDB clone failed', { error: err.message });
      }
    } else if (!options.skipChromaDb) {
      errors.push({ system: 'chromaDb', error: 'ChromaDB service unavailable' });
      logger.warn('[FilePathCoordinator] ChromaDB service unavailable for copy');
    }

    // 2. Clone Analysis History entry
    if (!options.skipAnalysisHistory && this._analysisHistoryService) {
      try {
        await this._cloneAnalysisHistoryEntry(sourcePath, destPath);
        cloned.analysisHistory = true;
      } catch (err) {
        errors.push({ system: 'analysisHistory', error: err.message });
        logger.warn('[FilePathCoordinator] Analysis history clone failed', { error: err.message });
      }
    } else if (!options.skipAnalysisHistory) {
      errors.push({ system: 'analysisHistory', error: 'Analysis history service unavailable' });
      logger.warn('[FilePathCoordinator] Analysis history service unavailable for copy');
    }

    // 3. Broadcast cache invalidation
    if (this._cacheInvalidationBus) {
      try {
        this._cacheInvalidationBus.invalidateForPathChange(
          sourcePath,
          destPath,
          PathChangeType.COPY
        );
        cloned.cacheInvalidated = true;
      } catch (err) {
        errors.push({ system: 'cacheInvalidation', error: err.message });
        logger.warn('[FilePathCoordinator] Cache invalidation failed', { error: err.message });
      }
    } else {
      errors.push({ system: 'cacheInvalidation', error: 'Cache invalidation bus unavailable' });
      logger.warn('[FilePathCoordinator] Cache invalidation bus unavailable for copy');
    }

    // Emit copy event
    this.emit('file-copied', {
      sourcePath,
      destPath,
      cloned,
      errors
    });

    const duration = Date.now() - startTime;
    logger.info('[FilePathCoordinator] File copy handling complete', {
      duration,
      cloned,
      errorCount: errors.length
    });

    return {
      success: errors.length === 0,
      errors,
      cloned
    };
  }

  // ==================== Private Helper Methods ====================

  /**
   * Update ChromaDB path for a single file
   * @private
   */
  async _updateChromaDbPath(oldPath, newPath) {
    // const normalizedOld = normalizePathForIndex(oldPath);
    const normalizedNew = normalizePathForIndex(newPath);
    const newMeta = {
      path: newPath,
      name: path.basename(newPath)
    };

    // Build all possible ID variants for Windows case-insensitivity
    const buildIdVariants = (filePath) => {
      const normalized = normalizePathForIndex(filePath);
      const normalizedCase = path.normalize(filePath).replace(/\\/g, '/');
      const platformNormalized = path.normalize(filePath);
      const variants = new Set([normalized, normalizedCase, platformNormalized, filePath]);
      return Array.from(variants).filter(Boolean);
    };

    const sourceVariants = buildIdVariants(oldPath);
    const pathUpdates = [];

    sourceVariants.forEach((variant) => {
      const fileOldId = `file:${variant}`;
      const imageOldId = `image:${variant}`;
      const fileNewId = `file:${normalizedNew}`;
      const imageNewId = `image:${normalizedNew}`;

      if (fileOldId !== fileNewId) {
        pathUpdates.push({ oldId: fileOldId, newId: fileNewId, newMeta });
      }
      if (imageOldId !== imageNewId) {
        pathUpdates.push({ oldId: imageOldId, newId: imageNewId, newMeta });
      }
    });

    if (pathUpdates.length > 0 && this._chromaDbService.updateFilePaths) {
      await this._chromaDbService.updateFilePaths(pathUpdates);
    }
  }

  /**
   * Batch update ChromaDB paths
   * @private
   */
  async _batchUpdateChromaDbPaths(changes) {
    const pathUpdates = [];
    const seenUpdates = new Set();

    for (const change of changes) {
      const normalizedNew = normalizePathForIndex(change.newPath);
      const newMeta = {
        path: change.newPath,
        name: path.basename(change.newPath)
      };

      const buildIdVariants = (filePath) => {
        const normalized = normalizePathForIndex(filePath);
        const normalizedCase = path.normalize(filePath).replace(/\\/g, '/');
        const platformNormalized = path.normalize(filePath);
        const variants = new Set([normalized, normalizedCase, platformNormalized, filePath]);
        return Array.from(variants).filter(Boolean);
      };

      const sourceVariants = buildIdVariants(change.oldPath);
      sourceVariants.forEach((variant) => {
        const fileOldId = `file:${variant}`;
        const imageOldId = `image:${variant}`;
        const fileNewId = `file:${normalizedNew}`;
        const imageNewId = `image:${normalizedNew}`;

        const fileKey = `${fileOldId}->${fileNewId}`;
        if (fileOldId !== fileNewId && !seenUpdates.has(fileKey)) {
          pathUpdates.push({ oldId: fileOldId, newId: fileNewId, newMeta });
          seenUpdates.add(fileKey);
        }

        const imageKey = `${imageOldId}->${imageNewId}`;
        if (imageOldId !== imageNewId && !seenUpdates.has(imageKey)) {
          pathUpdates.push({ oldId: imageOldId, newId: imageNewId, newMeta });
          seenUpdates.add(imageKey);
        }
      });
    }

    if (pathUpdates.length > 0 && this._chromaDbService.updateFilePaths) {
      await this._chromaDbService.updateFilePaths(pathUpdates);
    }
  }

  /**
   * Delete from ChromaDB
   * @private
   */
  async _deleteFromChromaDb(filePath) {
    const pathVariants = getPathVariants(filePath);
    const idsToDelete = new Set();

    for (const variant of pathVariants) {
      idsToDelete.add(`file:${variant}`);
      idsToDelete.add(`image:${variant}`);
    }

    const ids = Array.from(idsToDelete);
    if (typeof this._chromaDbService.batchDeleteFileEmbeddings === 'function') {
      await this._chromaDbService.batchDeleteFileEmbeddings(ids);
    } else {
      for (const id of ids) {
        if (this._chromaDbService.deleteFileEmbedding) {
          await this._chromaDbService.deleteFileEmbedding(id);
        }
      }
    }

    // Also delete associated chunks
    if (typeof this._chromaDbService.deleteFileChunks === 'function') {
      for (const variant of pathVariants) {
        await this._chromaDbService.deleteFileChunks(`file:${variant}`);
        await this._chromaDbService.deleteFileChunks(`image:${variant}`);
      }
    }
  }

  /**
   * Clone ChromaDB entry for file copy
   * @private
   */
  async _cloneChromaDbEntry(sourcePath, destPath) {
    const normalizedSource = normalizePathForIndex(sourcePath);
    const normalizedDest = normalizePathForIndex(destPath);

    if (this._chromaDbService.cloneFileEmbedding) {
      await this._chromaDbService.cloneFileEmbedding(
        `file:${normalizedSource}`,
        `file:${normalizedDest}`,
        {
          path: destPath,
          name: path.basename(destPath)
        }
      );
    } else {
      throw new Error('ChromaDB cloneFileEmbedding not available');
    }

    if (typeof this._chromaDbService.cloneFileChunks === 'function') {
      await this._chromaDbService.cloneFileChunks(
        `file:${normalizedSource}`,
        `file:${normalizedDest}`,
        {
          path: destPath,
          name: path.basename(destPath)
        }
      );
    } else {
      throw new Error('ChromaDB cloneFileChunks not available');
    }
  }

  /**
   * Update Analysis History path for a single file
   * @private
   */
  async _updateAnalysisHistoryPath(oldPath, newPath) {
    if (!this._analysisHistoryService.updateEntryPaths) {
      throw new Error('AnalysisHistory updateEntryPaths not available');
    }
    await this._analysisHistoryService.updateEntryPaths([
      {
        oldPath,
        newPath,
        newName: path.basename(newPath)
      }
    ]);
  }

  /**
   * Batch update Analysis History paths
   * @private
   */
  async _batchUpdateAnalysisHistoryPaths(changes) {
    if (!this._analysisHistoryService.updateEntryPaths) {
      throw new Error('AnalysisHistory updateEntryPaths not available');
    }
    const historyUpdates = changes.map((c) => ({
      oldPath: c.oldPath,
      newPath: c.newPath,
      newName: path.basename(c.newPath)
    }));
    await this._analysisHistoryService.updateEntryPaths(historyUpdates);
  }

  /**
   * Delete from Analysis History
   * @private
   */
  async _deleteFromAnalysisHistory(filePath) {
    if (!this._analysisHistoryService.removeEntriesByPath) {
      throw new Error('AnalysisHistory removeEntriesByPath not available');
    }
    await this._analysisHistoryService.removeEntriesByPath(filePath);
  }

  /**
   * Clone Analysis History entry for file copy
   * @private
   */
  async _cloneAnalysisHistoryEntry(sourcePath, destPath) {
    if (!this._analysisHistoryService.cloneEntryForCopy) {
      throw new Error('AnalysisHistory cloneEntryForCopy not available');
    }
    await this._analysisHistoryService.cloneEntryForCopy(sourcePath, destPath);
  }

  /**
   * Update Embedding Queue path for a single file
   * @private
   */
  _updateEmbeddingQueuePath(oldPath, newPath) {
    if (!this._embeddingQueue.updateByFilePath) {
      throw new Error('EmbeddingQueue updateByFilePath not available');
    }
    this._embeddingQueue.updateByFilePath(oldPath, newPath);
  }

  /**
   * Batch update Embedding Queue paths
   * @private
   */
  _batchUpdateEmbeddingQueuePaths(changes) {
    if (!this._embeddingQueue.updateByFilePaths) {
      throw new Error('EmbeddingQueue updateByFilePaths not available');
    }
    this._embeddingQueue.updateByFilePaths(changes);
  }

  /**
   * Remove from Embedding Queue
   * @private
   */
  _removeFromEmbeddingQueue(filePath) {
    if (!this._embeddingQueue.removeByFilePath) {
      throw new Error('EmbeddingQueue removeByFilePath not available');
    }
    this._embeddingQueue.removeByFilePath(filePath);
  }

  /**
   * Update Processing State path
   * @private
   */
  async _updateProcessingStatePath(oldPath, newPath) {
    // ProcessingStateService tracks jobs by file path
    // If a job exists for oldPath, update it to newPath
    const jobs = this._processingStateService.state?.analysis?.jobs;
    if (!jobs || typeof jobs !== 'object') {
      throw new Error('ProcessingState jobs map unavailable');
    }
    const job = jobs[oldPath];
    if (job) {
      // Move the job to the new path key
      jobs[newPath] = {
        ...job,
        movedFrom: oldPath
      };
      delete jobs[oldPath];
      await this._processingStateService.saveState();
    }
  }

  /**
   * Clear from Processing State
   * @private
   */
  async _clearFromProcessingState(filePath) {
    if (!this._processingStateService.clearState) {
      throw new Error('ProcessingState clearState not available');
    }
    await this._processingStateService.clearState(filePath);
  }

  /**
   * Get statistics about coordinator usage
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      pendingOperations: this._pendingOperations.size,
      hasChromaDb: !!this._chromaDbService,
      hasAnalysisHistory: !!this._analysisHistoryService,
      hasEmbeddingQueue: !!this._embeddingQueue,
      hasProcessingState: !!this._processingStateService,
      hasCacheInvalidation: !!this._cacheInvalidationBus
    };
  }

  /**
   * Shutdown the coordinator
   */
  shutdown() {
    this.removeAllListeners();
    this._pendingOperations.clear();
    logger.info('[FilePathCoordinator] Shutdown complete');
  }
}

// Singleton management
const { createSingletonHelpers } = require('../../shared/singletonFactory');

const { getInstance, resetInstance, registerWithContainer } = createSingletonHelpers({
  ServiceClass: FilePathCoordinator,
  serviceId: 'FILE_PATH_COORDINATOR',
  serviceName: 'FilePathCoordinator',
  containerPath: './ServiceContainer',
  shutdownMethod: 'shutdown'
});

module.exports = {
  FilePathCoordinator,
  PathChangeType,
  getInstance,
  resetInstance,
  registerWithContainer
};
