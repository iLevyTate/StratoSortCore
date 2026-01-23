/**
 * Path Trace Logger
 *
 * Centralized path event logging for file path lifecycle auditing.
 * Provides consistent logging format for tracking file paths through
 * all stages: ingest, analysis, embedding, organization, move, and cache invalidation.
 *
 * @module shared/pathTraceLogger
 */

const { logger: baseLogger, createLogger } = require('./logger');

const PATH_TRACE_PREFIX = '[PATH-TRACE]';

// Use createLogger if available, otherwise fall back to base logger
const logger = typeof createLogger === 'function' ? createLogger('PathTrace') : baseLogger;
if (typeof createLogger !== 'function' && logger?.setContext) {
  logger.setContext('PathTrace');
}

/**
 * Path trace event stages
 * @readonly
 * @enum {string}
 */
const PathStage = {
  // File operation stages
  MOVE_START: 'move-start',
  MOVE_COMPLETE: 'move-complete',
  COPY_START: 'copy-start',
  COPY_COMPLETE: 'copy-complete',
  DELETE_START: 'delete-start',
  DELETE_COMPLETE: 'delete-complete',

  // Database update stages
  DB_UPDATE_START: 'db-update-start',
  DB_UPDATE_COMPLETE: 'db-update-complete',

  // Coordinator stages
  COORDINATOR_START: 'coordinator-start',
  COORDINATOR_COMPLETE: 'coordinator-complete',
  CHROMADB_UPDATE: 'chromadb-update',
  HISTORY_UPDATE: 'history-update',
  QUEUE_UPDATE: 'queue-update',
  PROCESSING_STATE_UPDATE: 'processing-state-update',

  // Cache stages
  CACHE_INVALIDATE: 'cache-invalidate',
  CACHE_INVALIDATE_BATCH: 'cache-invalidate-batch',

  // Batch organize stages
  BATCH_ORGANIZE_START: 'batch-organize-start',
  BATCH_ORGANIZE_ITEM: 'batch-organize-item',
  BATCH_ORGANIZE_COMPLETE: 'batch-organize-complete'
};

/**
 * Reasons for path changes
 * @readonly
 * @enum {string}
 */
const PathChangeReason = {
  USER_MOVE: 'user-move',
  USER_COPY: 'user-copy',
  USER_DELETE: 'user-delete',
  BATCH_ORGANIZE: 'batch-organize',
  RENAME: 'rename',
  WATCHER_DETECTED: 'watcher-detected',
  EXTERNAL_CHANGE: 'external-change'
};

/**
 * Generate a unique event ID
 * @returns {string} UUID-like event ID
 */
function generateEventId() {
  // Use crypto.randomUUID if available, otherwise fallback
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'evt-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
}

/**
 * Build a file ID from path and type
 * @param {string} filePath - File path
 * @param {string} [type='file'] - Type prefix (file, image, folder)
 * @returns {string} Normalized file ID
 */
function buildFileId(filePath, type = 'file') {
  if (!filePath) return `${type}:unknown`;
  // Normalize for consistent ID format
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return `${type}:${normalized}`;
}

/**
 * Trace a path lifecycle event
 *
 * @param {Object} event - Event details
 * @param {string} event.stage_name - Stage from PathStage enum
 * @param {string} [event.file_id] - File ID (auto-generated from old_path if not provided)
 * @param {string} [event.old_path] - Original file path
 * @param {string} [event.new_path] - New file path (null if unchanged)
 * @param {string} [event.reason] - Reason from PathChangeReason enum
 * @param {string} event.source - Source module/function (e.g., 'fileOperationHandlers')
 * @param {boolean} event.success - Whether the operation succeeded
 * @param {string} [event.error] - Error message if failed
 * @param {Object} [event.extra] - Additional context data
 * @returns {Object} Complete event object with generated fields
 */
function tracePathEvent(event) {
  const {
    stage_name,
    file_id,
    old_path,
    new_path,
    reason,
    source,
    success,
    error,
    extra = {}
  } = event;

  // Auto-generate file_id from old_path if not provided
  const effectiveFileId = file_id || (old_path ? buildFileId(old_path) : 'unknown');

  // Build structured event
  const traceEvent = {
    event_id: generateEventId(),
    timestamp: Date.now(),
    stage_name,
    file_id: effectiveFileId,
    old_path: old_path || null,
    new_path: new_path || null,
    reason: reason || 'unknown',
    source,
    success: Boolean(success),
    error: error || null,
    ...extra
  };

  // Build log message
  const parts = [
    PATH_TRACE_PREFIX,
    `stage=${stage_name}`,
    `file_id=${effectiveFileId}`,
    `old=${old_path || 'null'}`,
    `new=${new_path || 'null'}`,
    `reason=${reason || 'unknown'}`,
    `source=${source}`,
    `success=${success}`
  ];

  if (error) {
    parts.push(`error=${error}`);
  }

  // Add any extra fields
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null) {
      parts.push(`${key}=${value}`);
    }
  }

  const msg = parts.join(' ');

  // Log based on success
  if (success) {
    logger.info(msg);
  } else {
    logger.error(msg);
  }

  return traceEvent;
}

/**
 * Trace the start of a file move operation
 *
 * @param {string} oldPath - Original file path
 * @param {string} newPath - Destination file path
 * @param {string} source - Source module
 * @param {string} [reason='user-move'] - Reason for move
 * @returns {Object} Event object
 */
function traceMoveStart(oldPath, newPath, source, reason = PathChangeReason.USER_MOVE) {
  return tracePathEvent({
    stage_name: PathStage.MOVE_START,
    old_path: oldPath,
    new_path: newPath,
    reason,
    source,
    success: true
  });
}

/**
 * Trace completion of a file move operation
 *
 * @param {string} oldPath - Original file path
 * @param {string} newPath - New file path
 * @param {string} source - Source module
 * @param {boolean} success - Whether move succeeded
 * @param {string} [error] - Error message if failed
 * @returns {Object} Event object
 */
function traceMoveComplete(oldPath, newPath, source, success, error = null) {
  return tracePathEvent({
    stage_name: PathStage.MOVE_COMPLETE,
    old_path: oldPath,
    new_path: newPath,
    source,
    success,
    error
  });
}

/**
 * Trace the start of a file copy operation
 *
 * @param {string} sourcePath - Source file path
 * @param {string} destPath - Destination file path
 * @param {string} source - Source module
 * @returns {Object} Event object
 */
function traceCopyStart(sourcePath, destPath, source) {
  return tracePathEvent({
    stage_name: PathStage.COPY_START,
    old_path: sourcePath,
    new_path: destPath,
    reason: PathChangeReason.USER_COPY,
    source,
    success: true
  });
}

/**
 * Trace completion of a file copy operation
 *
 * @param {string} sourcePath - Source file path
 * @param {string} destPath - Destination file path
 * @param {string} source - Source module
 * @param {boolean} success - Whether copy succeeded
 * @param {string} [error] - Error message if failed
 * @returns {Object} Event object
 */
function traceCopyComplete(sourcePath, destPath, source, success, error = null) {
  return tracePathEvent({
    stage_name: PathStage.COPY_COMPLETE,
    old_path: sourcePath,
    new_path: destPath,
    source,
    success,
    error
  });
}

/**
 * Trace the start of a file delete operation
 *
 * @param {string} filePath - File path being deleted
 * @param {string} source - Source module
 * @returns {Object} Event object
 */
function traceDeleteStart(filePath, source) {
  return tracePathEvent({
    stage_name: PathStage.DELETE_START,
    old_path: filePath,
    reason: PathChangeReason.USER_DELETE,
    source,
    success: true
  });
}

/**
 * Trace completion of a file delete operation
 *
 * @param {string} filePath - File path that was deleted
 * @param {string} source - Source module
 * @param {boolean} success - Whether delete succeeded
 * @param {string} [error] - Error message if failed
 * @returns {Object} Event object
 */
function traceDeleteComplete(filePath, source, success, error = null) {
  return tracePathEvent({
    stage_name: PathStage.DELETE_COMPLETE,
    old_path: filePath,
    source,
    success,
    error
  });
}

/**
 * Trace a database path update (coordinator)
 *
 * @param {string} system - System being updated (chromadb, history, queue, etc.)
 * @param {string} oldPath - Original path
 * @param {string} newPath - New path
 * @param {boolean} success - Whether update succeeded
 * @param {string} [error] - Error message if failed
 * @returns {Object} Event object
 */
function traceDbUpdate(system, oldPath, newPath, success, error = null) {
  const stageMap = {
    chromadb: PathStage.CHROMADB_UPDATE,
    history: PathStage.HISTORY_UPDATE,
    queue: PathStage.QUEUE_UPDATE,
    processingState: PathStage.PROCESSING_STATE_UPDATE
  };

  return tracePathEvent({
    stage_name: stageMap[system] || PathStage.DB_UPDATE_COMPLETE,
    old_path: oldPath,
    new_path: newPath,
    source: `FilePathCoordinator:${system}`,
    success,
    error,
    extra: { system }
  });
}

/**
 * Trace a cache invalidation event
 *
 * @param {string} oldPath - Original path
 * @param {string} newPath - New path (if applicable)
 * @param {number} subscriberCount - Number of cache subscribers notified
 * @param {string} [invalidationType='path-changed'] - Type of invalidation
 * @returns {Object} Event object
 */
function traceCacheInvalidate(
  oldPath,
  newPath,
  subscriberCount,
  invalidationType = 'path-changed'
) {
  return tracePathEvent({
    stage_name: PathStage.CACHE_INVALIDATE,
    old_path: oldPath,
    new_path: newPath,
    source: 'CacheInvalidationBus',
    success: true,
    extra: {
      subscribers: subscriberCount,
      invalidation_type: invalidationType
    }
  });
}

/**
 * Trace a batch cache invalidation event
 *
 * @param {number} changeCount - Number of path changes in batch
 * @param {number} subscriberCount - Number of cache subscribers notified
 * @returns {Object} Event object
 */
function traceCacheInvalidateBatch(changeCount, subscriberCount) {
  return tracePathEvent({
    stage_name: PathStage.CACHE_INVALIDATE_BATCH,
    source: 'CacheInvalidationBus',
    success: true,
    extra: {
      change_count: changeCount,
      subscribers: subscriberCount
    }
  });
}

/**
 * Trace embedding queue update
 *
 * @param {string} oldPath - Original path
 * @param {string} newPath - New path
 * @param {number} itemsUpdated - Number of queue items updated
 * @returns {Object} Event object
 */
function traceQueueUpdate(oldPath, newPath, itemsUpdated) {
  return tracePathEvent({
    stage_name: PathStage.QUEUE_UPDATE,
    old_path: oldPath,
    new_path: newPath,
    source: 'EmbeddingQueueCore',
    success: true,
    extra: { items_updated: itemsUpdated }
  });
}

/**
 * Trace analysis history path update
 *
 * @param {string} oldPath - Original path
 * @param {string} newPath - New path
 * @param {string} entryId - Entry ID that was updated
 * @param {boolean} success - Whether update succeeded
 * @returns {Object} Event object
 */
function traceHistoryUpdate(oldPath, newPath, entryId, success) {
  return tracePathEvent({
    stage_name: PathStage.HISTORY_UPDATE,
    old_path: oldPath,
    new_path: newPath,
    source: 'AnalysisHistoryServiceCore',
    success,
    extra: { entry_id: entryId }
  });
}

/**
 * Trace ChromaDB metadata update
 *
 * @param {string} oldPath - Original path
 * @param {string} newPath - New path
 * @param {number} variantsUpdated - Number of ID variants updated
 * @param {boolean} success - Whether update succeeded
 * @param {string} [error] - Error message if failed
 * @returns {Object} Event object
 */
function traceChromaDbUpdate(oldPath, newPath, variantsUpdated, success, error = null) {
  return tracePathEvent({
    stage_name: PathStage.CHROMADB_UPDATE,
    old_path: oldPath,
    new_path: newPath,
    source: 'chromadb/fileOperations',
    success,
    error,
    extra: { variants_updated: variantsUpdated }
  });
}

/**
 * Trace FilePathCoordinator atomic update start
 *
 * @param {string} oldPath - Original path
 * @param {string} newPath - New path
 * @param {string} type - Operation type (move, copy, delete)
 * @returns {Object} Event object
 */
function traceCoordinatorStart(oldPath, newPath, type) {
  return tracePathEvent({
    stage_name: PathStage.COORDINATOR_START,
    old_path: oldPath,
    new_path: newPath,
    reason: type,
    source: 'FilePathCoordinator',
    success: true,
    extra: { operation_type: type }
  });
}

/**
 * Trace FilePathCoordinator atomic update complete
 *
 * @param {string} oldPath - Original path
 * @param {string} newPath - New path
 * @param {Object} updated - Object showing which systems were updated
 * @param {number} errorCount - Number of errors encountered
 * @returns {Object} Event object
 */
function traceCoordinatorComplete(oldPath, newPath, updated, errorCount) {
  return tracePathEvent({
    stage_name: PathStage.COORDINATOR_COMPLETE,
    old_path: oldPath,
    new_path: newPath,
    source: 'FilePathCoordinator',
    success: errorCount === 0,
    extra: {
      updated_chromadb: updated.chromaDb,
      updated_history: updated.analysisHistory,
      updated_queue: updated.embeddingQueue,
      updated_processing: updated.processingState,
      cache_invalidated: updated.cacheInvalidated,
      error_count: errorCount
    }
  });
}

module.exports = {
  PATH_TRACE_PREFIX,
  PathStage,
  PathChangeReason,
  tracePathEvent,
  traceMoveStart,
  traceMoveComplete,
  traceCopyStart,
  traceCopyComplete,
  traceDeleteStart,
  traceDeleteComplete,
  traceDbUpdate,
  traceCacheInvalidate,
  traceCacheInvalidateBatch,
  traceQueueUpdate,
  traceHistoryUpdate,
  traceChromaDbUpdate,
  traceCoordinatorStart,
  traceCoordinatorComplete,
  buildFileId,
  generateEventId
};
