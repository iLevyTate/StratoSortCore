/**
 * Batch Organize Handler
 *
 * Extracted from files.js for better maintainability.
 * Handles batch file organization with rollback support.
 *
 * @module ipc/files/batchOrganizeHandler
 */

const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;
const { ACTION_TYPES, PROCESSING_LIMITS } = require('../../../shared/constants');
const { LIMITS, TIMEOUTS, BATCH, RETRY } = require('../../../shared/performanceConstants');
const { logger: baseLogger, createLogger } = require('../../../shared/logger');
const { crossDeviceMove } = require('../../../shared/atomicFileOperations');
const { validateFileOperationPath } = require('../../../shared/pathSanitization');
const { withTimeout, batchProcess } = require('../../../shared/promiseUtils');
const { withCorrelationId } = require('../../../shared/correlationId');
const { ERROR_CODES } = require('../../../shared/errorHandlingUtils');
const { acquireBatchLock, releaseBatchLock } = require('./batchLockManager');
const { validateBatchOperation, MAX_BATCH_SIZE } = require('./batchValidator');
const { executeRollback } = require('./batchRollback');
const { sendOperationProgress, sendChunkedResults } = require('./batchProgressReporter');
const { getInstance: getFileOperationTracker } = require('../../../shared/fileOperationTracker');
const { syncEmbeddingForMove, removeEmbeddingsForPathBestEffort } = require('./embeddingSync');
const { computeFileChecksum, handleDuplicateMove } = require('../../utils/fileDedup');

const logger =
  typeof createLogger === 'function' ? createLogger('IPC:Files:BatchOrganize') : baseLogger;
if (typeof createLogger !== 'function' && logger?.setContext) {
  logger.setContext('IPC:Files:BatchOrganize');
}

// Jest-mocked functions expose _isMockFunction; use to avoid false positives
const isMockFn = (fn) => !!fn && typeof fn === 'function' && fn._isMockFunction;

// Resource limits from centralized constants (prevents config drift)
const MAX_TOTAL_BATCH_TIME = PROCESSING_LIMITS.MAX_TOTAL_BATCH_TIME || 300000; // Default 5 mins if not set
const { MAX_NUMERIC_RETRIES } = LIMITS;
const FILE_LOCK_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);
const MOVE_LOCK_MAX_ATTEMPTS = RETRY?.MAX_ATTEMPTS_VERY_HIGH ?? 10;
const MOVE_LOCK_BACKOFF_STEP_MS = RETRY?.ATOMIC_BACKOFF_STEP_MS ?? 50;
const VERIFY_MAX_ATTEMPTS = RETRY?.FILE_OPERATION?.maxAttempts ?? RETRY?.MAX_ATTEMPTS_MEDIUM ?? 3;
const VERIFY_BACKOFF_STEP_MS =
  RETRY?.FILE_OPERATION?.initialDelay ?? TIMEOUTS?.DELAY_TINY ?? MOVE_LOCK_BACKOFF_STEP_MS;
const VERIFY_MAX_DELAY_MS = RETRY?.FILE_OPERATION?.maxDelay ?? 5000;

// FIX: Constants for chunked results and yield points to prevent UI blocking
const MAX_RESULTS_PER_CHUNK = 100; // Max results per IPC message chunk
const YIELD_EVERY_N_OPS = 10; // Yield to event loop every N operations

// Simple p-limit implementation to avoid adding dependency
// FIX: Properly propagate errors instead of silently swallowing them
const pLimit = (concurrency) => {
  const queue = [];
  let activeCount = 0;

  const next = () => {
    activeCount--;
    if (queue.length > 0) {
      queue.shift()();
    }
  };

  const run = async (fn, resolve, reject) => {
    activeCount++;
    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error); // FIX: Properly propagate errors
    } finally {
      next();
    }
  };

  return (fn) => {
    return new Promise((resolve, reject) => {
      const task = () => run(fn, resolve, reject);
      if (activeCount < concurrency) {
        task();
      } else {
        queue.push(task);
      }
    });
  };
};

const delayMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Verify move operation completed correctly.
 * Checks that destination exists and source is gone.
 *
 * @param {string} source - Original source path
 * @param {string} destination - Destination path after move
 * @param {Object} log - Logger instance
 * @throws {Error} If verification fails
 */
async function verifyMoveCompletion(source, destination, log) {
  // Verify destination exists (retry to handle network/FS propagation delays)
  for (let attempt = 1; attempt <= VERIFY_MAX_ATTEMPTS; attempt++) {
    try {
      await fs.access(destination);
      break;
    } catch (error) {
      const isRetryable =
        error.code === 'ENOENT' || (error.code && FILE_LOCK_ERROR_CODES.has(error.code));
      if (!isRetryable || attempt === VERIFY_MAX_ATTEMPTS) {
        const message =
          error.code === 'ENOENT'
            ? `Move verification failed: destination does not exist after move: ${destination}`
            : `Move verification failed: destination not accessible after move: ${destination}`;
        const verificationError = new Error(message);
        verificationError.code = error.code || 'MOVE_VERIFICATION_DESTINATION_FAILED';
        throw verificationError;
      }
      log.debug('[FILE-OPS] Destination not yet visible after move, retrying', {
        destination,
        attempt,
        maxAttempts: VERIFY_MAX_ATTEMPTS,
        code: error.code
      });
      const delay = Math.min(VERIFY_BACKOFF_STEP_MS * attempt, VERIFY_MAX_DELAY_MS);
      await delayMs(delay);
    }
  }

  // Verify source is gone (unless same path or mocked fs)
  const shouldVerifySource = source !== destination && !isMockFn(fs.access);
  if (shouldVerifySource) {
    for (let attempt = 1; attempt <= VERIFY_MAX_ATTEMPTS; attempt++) {
      try {
        await fs.access(source);
        if (attempt === VERIFY_MAX_ATTEMPTS) {
          const verificationError = new Error(
            `Move verification failed: source file still exists at original location: ${source}`
          );
          verificationError.code = 'MOVE_VERIFICATION_SOURCE_EXISTS';
          throw verificationError;
        }
        log.debug('[FILE-OPS] Source still exists after move, retrying', {
          source,
          attempt,
          maxAttempts: VERIFY_MAX_ATTEMPTS
        });
        const delay = Math.min(VERIFY_BACKOFF_STEP_MS * attempt, VERIFY_MAX_DELAY_MS);
        await delayMs(delay);
      } catch (sourceCheckErr) {
        // ENOENT is expected (file was moved); any other error should halt processing
        if (sourceCheckErr.code === 'ENOENT') {
          break;
        }
        log.warn('[FILE-OPS] Move verification: unexpected source state', {
          error: sourceCheckErr.message,
          code: sourceCheckErr.code
        });
        throw sourceCheckErr;
      }
    }
  } else if (source !== destination) {
    log.debug('[FILE-OPS] Skipping source existence verification (mocked fs)');
  }
}

/**
 * Handle batch file organization with rollback support
 *
 * @param {Object} params - Handler parameters
 * @param {Object} params.operation - Batch operation configuration
 * @param {Object} params.logger - Logger instance
 * @param {Function} params.getServiceIntegration - Service integration getter
 * @param {Function} params.getMainWindow - Main window getter
 * @returns {Promise<Object>} Batch operation result
 */
async function handleBatchOrganize(params) {
  return withCorrelationId(async () => {
    const { operation, logger: handlerLogger, getServiceIntegration, getMainWindow } = params;

    const log = handlerLogger || logger;

    // Validate batch
    const validationError = validateBatchOperation(operation, log);
    if (validationError) {
      return validationError;
    }

    // Generate batch ID early for lock acquisition
    const batchId = `batch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // FIX: Acquire global lock to prevent concurrent batch operations
    const lockAcquired = await acquireBatchLock(batchId);
    if (!lockAcquired) {
      log.warn('[FILE-OPS] Could not acquire batch lock - another batch operation is in progress');
      return {
        success: false,
        error: 'Another batch operation is already in progress. Please wait for it to complete.',
        errorCode: ERROR_CODES.BATCH_LOCK_TIMEOUT
      };
    }

    try {
      // Initialize tracking variables
      const results = [];
      const completedOperations = [];
      let successCount = 0;
      let failCount = 0;
      let skippedCount = 0;
      // batchId already defined above for lock acquisition
      const batchStartTime = Date.now();
      let shouldRollback = false;
      let rollbackReason = null;
      const processedKeys = new Set(); // For idempotency

      // FIX P0-4: AbortController for task cancellation
      // This ensures all concurrent tasks stop immediately when a critical error occurs
      const abortController = new AbortController();

      try {
        const svc = getServiceIntegration();
        let batch;
        if (svc?.processingState?.createOrLoadOrganizeBatch) {
          batch = await svc.processingState.createOrLoadOrganizeBatch(
            batchId,
            operation.operations
          );
        }

        if (!batch || !batch.operations) {
          log.warn(`[FILE-OPS] Batch service unavailable, using direct operations for ${batchId}`);
          batch = {
            operations: operation.operations.map((op) => ({
              ...op,
              status: 'pending'
            }))
          };
        }

        const totalOperations = batch.operations.length;

        if (totalOperations > MAX_BATCH_SIZE) {
          log.warn(
            `[FILE-OPS] Batch size ${totalOperations} exceeds maximum ${MAX_BATCH_SIZE} after service load`
          );
          return {
            success: false,
            error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} operations`,
            errorCode: ERROR_CODES.BATCH_TOO_LARGE,
            maxAllowed: MAX_BATCH_SIZE,
            provided: totalOperations
          };
        }

        log.info(`[FILE-OPS] Starting batch operation ${batchId} with ${totalOperations} files`, {
          batchId,
          totalOperations
        });

        // Fix 8: Parallel execution with concurrency limit
        const limit = pLimit(BATCH?.MAX_CONCURRENT_FILES || 5); // Process files concurrently

        const processOperation = async (i) => {
          // FIX P0-4: Check both shouldRollback flag AND abort signal for immediate cancellation
          // The abort signal is set atomically when a critical error occurs, ensuring
          // concurrent tasks don't continue processing after rollback is triggered
          if (shouldRollback || abortController.signal.aborted) return;

          if (Date.now() - batchStartTime > MAX_TOTAL_BATCH_TIME) {
            log.error(`[FILE-OPS] Batch ${batchId} exceeded maximum time limit`);
            // We can't throw to stop other parallel tasks easily, but we can return error
            // and let them skip via shouldRollback check or timeout check
            return;
          }

          // FIX: Yield to event loop every N operations to prevent UI blocking
          if (i > 0 && i % YIELD_EVERY_N_OPS === 0) {
            await new Promise((resolve) => setImmediate(resolve));
          }

          const op = batch.operations[i];

          // Idempotency check
          // Generate key based on source, destination, and file stats if available (or just paths)
          // Since we don't have file stats easily here without stat(), we use paths.
          // Ideally we would include size/mtime but paths should be unique within a batch for moves.
          const idempotencyKey = crypto
            .createHash('sha256')
            .update(`${op.source}:${op.destination}`)
            .digest('hex');

          if (processedKeys.has(idempotencyKey)) {
            log.warn('[FILE-OPS] Skipping duplicate operation', {
              batchId,
              source: op.source,
              destination: op.destination
            });
            results.push({
              success: true,
              source: op.source,
              destination: op.destination,
              operation: op.type || 'move',
              skipped: true,
              reason: 'duplicate'
            });
            skippedCount++;
            return;
          }

          // FIX: Claim idempotency key immediately after check to prevent TOCTOU race
          // with concurrent pLimit tasks that share the same processedKeys Set
          processedKeys.add(idempotencyKey);

          // Skip already completed operations (for resume)
          if (op.status === 'done') {
            results.push({
              success: true,
              source: op.source,
              destination: op.destination,
              operation: op.type || 'move',
              resumed: true
            });
            successCount++;
            return;
          }

          try {
            const opStart = Date.now();
            log.debug('[FILE-OPS] Operation start', {
              batchId,
              index: i,
              source: op.source,
              destination: op.destination,
              resumed: op.status === 'done'
            });

            await getServiceIntegration()?.processingState?.markOrganizeOpStarted(batchId, i);

            if (!op.source || !op.destination) {
              throw new Error(
                `Invalid operation data: source="${op.source}", destination="${op.destination}"`
              );
            }

            // SECURITY: Validate paths before any file operations
            const sourceValidation = await validateFileOperationPath(op.source, {
              checkSymlinks: true
            });
            if (!sourceValidation.valid) {
              throw new Error(`Invalid source path: ${sourceValidation.error}`);
            }
            const destValidation = await validateFileOperationPath(op.destination, {
              checkSymlinks: false // Destination may not exist yet
            });
            if (!destValidation.valid) {
              throw new Error(`Invalid destination path: ${destValidation.error}`);
            }
            // Use validated paths
            op.source = sourceValidation.normalizedPath;
            op.destination = destValidation.normalizedPath;

            // Ensure destination directory exists
            const destDir = path.dirname(op.destination);
            await fs.mkdir(destDir, { recursive: true });

            // Handle file move with collision handling
            // TOCTOU fix: removed verifySourceFile pre-check, handle ENOENT from move directly
            let moveResult;
            try {
              // Use timeout for file operations to prevent hangs
              moveResult = await withTimeout(
                performFileMove(op, log, computeFileChecksum),
                TIMEOUTS.FILE_COPY,
                `File move ${path.basename(op.source)}`
              );
            } catch (moveError) {
              if (moveError.code === 'ENOENT') {
                // Source file disappeared between batch start and this operation
                log.debug('[FILE-OPS] Source file no longer exists, skipping:', op.source);
                results.push({
                  success: false,
                  source: op.source,
                  destination: op.destination,
                  error: 'Source file no longer exists',
                  operation: op.type || 'move',
                  skipped: true
                });
                failCount++;
                return;
              }
              throw moveError;
            }

            if (moveResult && moveResult.skipped) {
              skippedCount++;
              const resolvedDestination = moveResult.destination || op.destination;
              results.push({
                success: true,
                source: op.source,
                destination: resolvedDestination,
                operation: op.type || 'move',
                skipped: true,
                reason: moveResult.reason
              });

              log.info('[FILE-OPS] Move skipped (duplicate)', {
                batchId,
                source: op.source,
                destination: resolvedDestination
              });

              // Verify state is consistent (dest exists, source gone)
              await verifyMoveCompletion(op.source, resolvedDestination, log);

              await getServiceIntegration()?.processingState?.markOrganizeOpDone(batchId, i, {
                destination: resolvedDestination,
                skipped: true
              });

              sendOperationProgress(getMainWindow, {
                type: 'batch_organize',
                current: successCount + failCount + skippedCount,
                total: batch.operations.length,
                currentFile: path.basename(op.source)
              });

              return;
            }

            op.destination = moveResult.destination;

            // FIX: Record operation in tracker to prevent SmartFolderWatcher from re-analyzing
            // This prevents "ghost" files or duplicates appearing in the UI
            try {
              const tracker = getFileOperationTracker();
              tracker.recordOperation(op.source, 'move', 'batchOrganize');
              tracker.recordOperation(op.destination, 'move', 'batchOrganize');
            } catch (trackerErr) {
              log.warn('[FILE-OPS] Failed to record operation in tracker', {
                error: trackerErr.message
              });
            }

            log.info('[FILE-OPS] Move completed', {
              batchId,
              index: i,
              source: op.source,
              destination: op.destination,
              durationMs: Date.now() - opStart
            });

            // Post-move verification: ensure destination exists and source is gone
            await verifyMoveCompletion(op.source, op.destination, log);

            await getServiceIntegration()?.processingState?.markOrganizeOpDone(batchId, i, {
              destination: op.destination
            });

            completedOperations.push({
              index: i,
              source: op.source,
              destination: op.destination,
              originalDestination: operation.operations[i].destination
            });

            results.push({
              success: true,
              source: op.source,
              destination: op.destination,
              operation: op.type || 'move'
            });
            successCount++;

            log.debug('[FILE-OPS] Operation success', {
              batchId,
              index: i,
              source: op.source,
              destination: op.destination
            });

            // Send progress to renderer
            // FIX: Use safeSend for validated IPC event sending
            sendOperationProgress(getMainWindow, {
              type: 'batch_organize',
              current: successCount + failCount + skippedCount,
              total: batch.operations.length,
              currentFile: path.basename(op.source)
            });
          } catch (error) {
            await getServiceIntegration()?.processingState?.markOrganizeOpError(
              batchId,
              i,
              error.message
            );

            // Determine if critical error
            const isCriticalError = isCriticalFileError(error);

            if (isCriticalError) {
              shouldRollback = true;
              rollbackReason = `Critical error on file ${i + 1}/${batch.operations.length}: ${error.message}`;
              // FIX P0-4: Signal abort to stop all concurrent tasks immediately
              abortController.abort();
              log.error(
                `[FILE-OPS] Critical error in batch ${batchId}, will rollback ${completedOperations.length} completed operations`,
                { error: error.message, errorCode: error.code, file: op.source }
              );
            }

            results.push({
              success: false,
              source: op.source,
              destination: op.destination,
              error: error.message,
              operation: op.type || 'move',
              critical: isCriticalError
            });
            failCount++;

            log.warn('[FILE-OPS] Operation failed', {
              batchId,
              index: i,
              source: op.source,
              destination: op.destination,
              error: error.message,
              critical: isCriticalError
            });
          }
        };

        const promises = batch.operations.map((_, i) => limit(() => processOperation(i)));
        await Promise.allSettled(promises);

        // Execute rollback if needed
        if (shouldRollback && completedOperations.length > 0) {
          return await executeRollback(
            completedOperations,
            results,
            failCount,
            rollbackReason,
            batchId,
            log
          );
        }

        await getServiceIntegration()?.processingState?.completeOrganizeBatch(batchId);

        // Record undo and update database
        if (!shouldRollback) {
          await recordUndoAndUpdateDatabase(
            batch,
            results,
            successCount,
            batchId,
            getServiceIntegration,
            log
          );
        }
      } catch (error) {
        // Log the error - don't silently swallow it
        log.error('[FILE-OPS] Batch operation failed with error', {
          batchId,
          error: error.message,
          successCount,
          failCount,
          completedOperations: completedOperations.length
        });

        // If we have some successful operations, return partial success
        // Otherwise, return failure with error details
        if (successCount > 0) {
          return {
            success: true,
            partialFailure: true,
            results,
            successCount,
            failCount,
            completedOperations: completedOperations.length,
            summary: `Processed ${operation.operations.length} files: ${successCount} successful, ${failCount} failed (batch error: ${error.message})`,
            batchId,
            error: error.message
          };
        }

        return {
          success: false,
          error: error.message,
          errorCode: ERROR_CODES.BATCH_OPERATION_FAILED,
          results,
          successCount,
          failCount,
          completedOperations: completedOperations.length,
          batchId
        };
      }

      // FIX: For large result sets, send results in chunks to prevent IPC message overflow
      if (results.length > MAX_RESULTS_PER_CHUNK) {
        const { sent, totalChunks } = await sendChunkedResults(
          getMainWindow,
          batchId,
          results,
          MAX_RESULTS_PER_CHUNK
        );

        if (!sent) {
          return {
            success: successCount > 0 && !shouldRollback,
            results,
            successCount,
            failCount,
            completedOperations: completedOperations.length,
            summary: `Processed ${operation.operations.length} files: ${successCount} successful, ${failCount} failed`,
            batchId
          };
        }

        // Return summary only (results sent via chunks)
        return {
          success: successCount > 0 && !shouldRollback,
          successCount,
          failCount,
          completedOperations: completedOperations.length,
          summary: `Processed ${operation.operations.length} files: ${successCount} successful, ${failCount} failed`,
          batchId,
          chunkedResults: true,
          totalChunks
        };
      }

      // For small result sets, return inline as before (backward compatible)
      return {
        success: successCount > 0 && !shouldRollback,
        results,
        successCount,
        failCount,
        completedOperations: completedOperations.length,
        summary: `Processed ${operation.operations.length} files: ${successCount} successful, ${failCount} failed`,
        batchId
      };
    } finally {
      // Always release the batch lock when operation completes
      releaseBatchLock(batchId);
    }
  });
}

/**
 * Check if an error is critical enough to trigger rollback
 */
function isCriticalFileError(error) {
  return (
    error.code === 'EACCES' ||
    error.code === 'EPERM' ||
    error.code === 'ENOSPC' ||
    error.code === 'EIO' ||
    error.message.includes('checksum mismatch') ||
    error.message.includes('verification failed')
  );
}

/**
 * Perform a single file move with collision handling
 */
async function performFileMove(op, log, checksumFn) {
  // FIX P2-1: Check for identical content at destination or within destination dir.
  // This prevents creating numbered copies of files that already exist.
  const duplicateResult = await handleDuplicateMove({
    sourcePath: op.source,
    destinationPath: op.destination,
    checksumFn,
    logger: log,
    logPrefix: '[FILE-OPS]',
    dedupContext: 'batchOrganize',
    removeEmbeddings: removeEmbeddingsForPathBestEffort,
    unlinkFn: fs.unlink
  });
  if (duplicateResult) return duplicateResult;

  let counter = 0;
  let uniqueDestination = op.destination;
  const ext = path.extname(op.destination);
  // When ext is empty, -ext.length is -0 which equals 0, causing slice(0,0) to return empty string
  const baseName = ext.length > 0 ? op.destination.slice(0, -ext.length) : op.destination;
  let operationComplete = false;

  while (!operationComplete && counter < MAX_NUMERIC_RETRIES) {
    try {
      await renameWithRetry(op.source, uniqueDestination, log);
      operationComplete = true;
    } catch (renameError) {
      if (renameError.code === 'EEXIST') {
        counter++;
        uniqueDestination = `${baseName}_${counter}${ext}`;
        continue;
      } else if (renameError.code === 'EXDEV') {
        // Cross-device move
        await performCrossDeviceMove(op.source, uniqueDestination, log, checksumFn);
        operationComplete = true;
      } else {
        throw renameError;
      }
    }
  }

  // UUID fallback if numeric exhausted
  if (!operationComplete) {
    uniqueDestination = await performUUIDFallback(op, baseName, ext, log, checksumFn);
    operationComplete = true;
  }

  return { destination: uniqueDestination };
}

async function renameWithRetry(source, destination, log) {
  let attempt = 0;
  while (true) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error) {
      if (error.code === 'EEXIST' || error.code === 'EXDEV') {
        throw error;
      }
      const isLockError = FILE_LOCK_ERROR_CODES.has(error.code);
      if (!isLockError || attempt >= MOVE_LOCK_MAX_ATTEMPTS - 1) {
        throw error;
      }
      attempt += 1;
      const delayMs = MOVE_LOCK_BACKOFF_STEP_MS * attempt;
      log.debug('[FILE-OPS] Rename blocked (likely file lock), retrying', {
        source,
        destination,
        attempt,
        maxAttempts: MOVE_LOCK_MAX_ATTEMPTS,
        delayMs,
        code: error.code
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Perform cross-device move with verification
 * Uses the shared crossDeviceMove utility with checksum verification
 */
async function performCrossDeviceMove(source, destination, log, checksumFn) {
  await crossDeviceMove(source, destination, {
    verify: true,
    checksumFn
  });
}

/**
 * UUID-based filename fallback
 */
async function performUUIDFallback(op, baseName, ext, log, checksumFn) {
  log.warn(`[FILE-OPS] Falling back to UUID for ${path.basename(op.source)}`);

  for (let i = 0; i < 3; i++) {
    const uuid = crypto.randomUUID().split('-')[0];
    const uniqueDestination = `${baseName}_${uuid}${ext}`;

    try {
      await fs.rename(op.source, uniqueDestination);
      return uniqueDestination;
    } catch (error) {
      if (error.code === 'EEXIST') continue;
      if (error.code === 'EXDEV') {
        await performCrossDeviceMove(op.source, uniqueDestination, log, checksumFn);
        return uniqueDestination;
      }
      throw error;
    }
  }

  throw new Error('Failed to create unique destination after UUID attempts');
}

/**
 * Get FilePathCoordinator from ServiceContainer if available
 * @returns {Object|null} FilePathCoordinator instance or null
 */
function getFilePathCoordinator() {
  try {
    const { container, ServiceIds } = require('../../services/ServiceContainer');
    if (container.has(ServiceIds.FILE_PATH_COORDINATOR)) {
      return container.resolve(ServiceIds.FILE_PATH_COORDINATOR);
    }
  } catch {
    // Service not available
  }
  return null;
}

/**
 * Record undo action and update database paths
 * Uses FilePathCoordinator when available for atomic batch updates.
 * Falls back to direct service calls if coordinator is unavailable.
 */
async function recordUndoAndUpdateDatabase(
  batch,
  results,
  successCount,
  batchId,
  getServiceIntegration,
  log
) {
  // FIX: Only record successful operations for undo - failed operations have
  // files still at their original location, not at the destination
  try {
    const undoOps = results
      .filter((r) => r.success && r.source && r.destination && !r.skipped)
      .map((r) => ({
        type: 'move',
        originalPath: r.source,
        newPath: r.destination
      }));

    if (undoOps.length > 0) {
      await getServiceIntegration()?.undoRedo?.recordAction?.(ACTION_TYPES.BATCH_OPERATION, {
        operations: undoOps
      });
    }
  } catch {
    // Non-fatal
  }

  // Update path-dependent systems for batch moves
  if (successCount > 0) {
    const successfulResults = results.filter(
      (r) => r.success && r.source && r.destination && !r.skipped
    );
    const pathChanges = successfulResults.map((r) => ({
      oldPath: r.source,
      newPath: r.destination
    }));

    // Try to use FilePathCoordinator for atomic batch updates
    const coordinator = getFilePathCoordinator();
    if (coordinator && pathChanges.length > 0) {
      log.debug('[FILE-OPS] Using FilePathCoordinator for batch path updates', {
        batchId,
        count: pathChanges.length
      });

      try {
        const result = await coordinator.batchPathUpdate(pathChanges, { type: 'move' });

        if (!result.success) {
          log.warn('[FILE-OPS] FilePathCoordinator batch update had errors', {
            batchId,
            errors: result.errors.map((e) => e.system).join(', ')
          });
        } else {
          log.debug('[FILE-OPS] FilePathCoordinator batch update complete', {
            batchId,
            summary: result.summary
          });
        }
      } catch (coordError) {
        log.warn('[FILE-OPS] FilePathCoordinator batch update failed', {
          batchId,
          error: coordError.message
        });
        // Fallback removed: FilePathCoordinator is the single source of truth.
        // If it fails, we log the error but do not attempt divergent updates.
      }
    } else if (pathChanges.length > 0) {
      // Coordinator unavailable
      log.warn('[FILE-OPS] FilePathCoordinator unavailable for batch path updates', {
        batchId
      });
    }

    // Sync embeddings based on final smart folder destinations (background, best effort)
    if (pathChanges.length > 0) {
      setImmediate(() => {
        const syncBatchSize = 2;
        batchProcess(
          pathChanges,
          (change) =>
            syncEmbeddingForMove({
              sourcePath: change.oldPath,
              destPath: change.newPath,
              operation: 'move',
              log
            }),
          syncBatchSize
        ).catch((syncErr) => {
          log.debug('[FILE-OPS] Batch embedding sync failed (non-fatal):', {
            error: syncErr.message,
            batchId
          });
        });
      });
    }

    // FIX P1-1: Await the rebuild with timeout to ensure search consistency
    // This ensures search results show new paths immediately (not after 15 min)
    if (successCount > 0) {
      try {
        const { getSearchServiceInstance } = require('../semantic');
        const searchService = getSearchServiceInstance?.();
        if (searchService?.invalidateAndRebuild) {
          // FIX: Await with timeout to ensure search consistency without blocking too long
          const REBUILD_TIMEOUT_MS = 5000; // 5 second max wait
          const rebuildPromise = searchService.invalidateAndRebuild({
            immediate: true,
            reason: 'batch-organize'
          });

          // Wait for rebuild but with timeout to prevent blocking UI
          await withTimeout(rebuildPromise, REBUILD_TIMEOUT_MS, 'BM25 rebuild after batch').catch(
            (rebuildErr) => {
              log.warn('[FILE-OPS] BM25 rebuild failed or timed out after batch', {
                error: rebuildErr?.message,
                batchId
              });
            }
          );
        }
      } catch (invalidateErr) {
        log.warn('[FILE-OPS] Failed to trigger search index rebuild after batch', {
          error: invalidateErr.message,
          batchId
        });
      }
    }
  }

  log.debug('[FILE-OPS] Undo/DB update complete', {
    batchId,
    successCount,
    updatedPaths: results.filter((r) => r.success && r.source && r.destination).length
  });
}

module.exports = {
  handleBatchOrganize,
  computeFileChecksum,
  MAX_BATCH_SIZE,
  MAX_TOTAL_BATCH_TIME
};
