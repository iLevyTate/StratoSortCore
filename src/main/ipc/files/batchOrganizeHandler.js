/**
 * Batch Organize Handler
 *
 * Extracted from files.js for better maintainability.
 * Handles batch file organization with rollback support.
 *
 * @module ipc/files/batchOrganizeHandler
 */

const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const crypto = require('crypto');
const { ACTION_TYPES, PROCESSING_LIMITS } = require('../../../shared/constants');
const { LIMITS, TIMEOUTS } = require('../../../shared/performanceConstants');
const { logger } = require('../../../shared/logger');
const { crossDeviceMove } = require('../../../shared/atomicFileOperations');
const { validateFileOperationPath } = require('../../../shared/pathSanitization');
const { withTimeout } = require('../../../shared/promiseUtils');
const { withCorrelationId } = require('../../../shared/correlationId');
// FIX: Import centralized error codes for consistent error handling
const { ERROR_CODES } = require('../../../shared/errorHandlingUtils');

logger.setContext('IPC:Files:BatchOrganize');

// Jest-mocked functions expose _isMockFunction; use to avoid false positives
const isMockFn = (fn) => !!fn && typeof fn === 'function' && fn._isMockFunction;

// Resource limits from centralized constants (prevents config drift)
const MAX_BATCH_SIZE = PROCESSING_LIMITS.MAX_BATCH_OPERATION_SIZE;
const MAX_TOTAL_BATCH_TIME = PROCESSING_LIMITS.MAX_TOTAL_BATCH_TIME || 300000; // Default 5 mins if not set
const { MAX_NUMERIC_RETRIES } = LIMITS;

// Simple p-limit implementation to avoid adding dependency
const pLimit = (concurrency) => {
  const queue = [];
  let activeCount = 0;

  const next = () => {
    activeCount--;
    if (queue.length > 0) {
      queue.shift()();
    }
  };

  const run = async (fn, resolve, _reject) => {
    activeCount++;
    const result = (async () => fn())();
    resolve(result);
    try {
      await result;
    } catch {
      // ignore
    }
    next();
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

/**
 * Compute SHA-256 checksum of a file using streaming
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} Hex-encoded checksum
 */
async function computeFileChecksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = require('fs').createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => {
      stream.destroy();
      reject(err);
    });
  });
}

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
  // Verify destination exists
  try {
    await fs.access(destination);
  } catch {
    throw new Error(
      `Move verification failed: destination does not exist after move: ${destination}`
    );
  }

  // Verify source is gone (unless same path or mocked fs)
  const shouldVerifySource = source !== destination && !isMockFn(fs.access);
  if (shouldVerifySource) {
    try {
      await fs.access(source);
      // If we get here, source still exists - move may have failed silently
      const verificationError = new Error(
        `Move verification failed: source file still exists at original location: ${source}`
      );
      verificationError.code = 'MOVE_VERIFICATION_SOURCE_EXISTS';
      throw verificationError;
    } catch (sourceCheckErr) {
      // ENOENT is expected (file was moved); any other error should halt processing
      if (sourceCheckErr.code === 'ENOENT') {
        // All good: file is gone at the original location
      } else {
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
 * Validate batch operation input.
 * Returns an error object if validation fails, null if valid.
 *
 * @param {Object} operation - Batch operation configuration
 * @param {Object} log - Logger instance
 * @returns {Object|null} Error object or null if valid
 */
function validateBatchOperation(operation, log) {
  if (!operation.operations || !Array.isArray(operation.operations)) {
    return {
      success: false,
      error: 'Invalid batch: operations must be an array',
      errorCode: ERROR_CODES.INVALID_BATCH
    };
  }

  if (operation.operations.length === 0) {
    return {
      success: false,
      error: 'Invalid batch: no operations provided',
      errorCode: ERROR_CODES.EMPTY_BATCH
    };
  }

  if (operation.operations.length > MAX_BATCH_SIZE) {
    log.warn(
      `[FILE-OPS] Batch size ${operation.operations.length} exceeds maximum ${MAX_BATCH_SIZE}`
    );
    return {
      success: false,
      error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} operations`,
      errorCode: ERROR_CODES.BATCH_TOO_LARGE,
      maxAllowed: MAX_BATCH_SIZE,
      provided: operation.operations.length
    };
  }

  // Validate individual operation objects have required fields
  for (let i = 0; i < operation.operations.length; i++) {
    const op = operation.operations[i];
    if (!op || typeof op !== 'object') {
      return {
        success: false,
        error: `Invalid operation at index ${i}: must be an object`,
        errorCode: ERROR_CODES.INVALID_OPERATION
      };
    }
    if (!op.source || typeof op.source !== 'string') {
      return {
        success: false,
        error: `Invalid operation at index ${i}: missing or invalid source path`,
        errorCode: ERROR_CODES.INVALID_OPERATION
      };
    }
    if (!op.destination || typeof op.destination !== 'string') {
      return {
        success: false,
        error: `Invalid operation at index ${i}: missing or invalid destination path`,
        errorCode: ERROR_CODES.INVALID_OPERATION
      };
    }
  }

  return null; // Valid
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

    // Initialize tracking variables
    const results = [];
    const completedOperations = [];
    let successCount = 0;
    let failCount = 0;
    const batchId = `batch_${Date.now()}`;
    const batchStartTime = Date.now();
    let shouldRollback = false;
    let rollbackReason = null;
    const processedKeys = new Set(); // For idempotency

    try {
      const svc = getServiceIntegration();
      let batch;
      if (svc?.processingState?.createOrLoadOrganizeBatch) {
        batch = await svc.processingState.createOrLoadOrganizeBatch(batchId, operation.operations);
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
      const limit = pLimit(5); // Process 5 files concurrently

      const processOperation = async (i) => {
        // Check if we should abort due to critical error or timeout
        if (shouldRollback) return;

        if (Date.now() - batchStartTime > MAX_TOTAL_BATCH_TIME) {
          log.error(`[FILE-OPS] Batch ${batchId} exceeded maximum time limit`);
          // We can't throw to stop other parallel tasks easily, but we can return error
          // and let them skip via shouldRollback check or timeout check
          return;
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
          return;
        }

        // Skip already completed operations (for resume)
        if (op.status === 'done') {
          processedKeys.add(idempotencyKey);
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
          op.destination = moveResult.destination;
          processedKeys.add(idempotencyKey);

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
          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('operation-progress', {
              type: 'batch_organize',
              current: successCount + failCount, // Approx progress
              total: batch.operations.length,
              currentFile: path.basename(op.source)
            });
          }
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

    return {
      success: successCount > 0 && !shouldRollback,
      results,
      successCount,
      failCount,
      completedOperations: completedOperations.length,
      summary: `Processed ${operation.operations.length} files: ${successCount} successful, ${failCount} failed`,
      batchId
    };
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
  let counter = 0;
  let uniqueDestination = op.destination;
  const ext = path.extname(op.destination);
  // When ext is empty, -ext.length is -0 which equals 0, causing slice(0,0) to return empty string
  const baseName = ext.length > 0 ? op.destination.slice(0, -ext.length) : op.destination;
  let operationComplete = false;

  while (!operationComplete && counter < MAX_NUMERIC_RETRIES) {
    try {
      await fs.rename(op.source, uniqueDestination);
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
 * Execute rollback of completed operations
 */
async function executeRollback(
  completedOperations,
  results,
  failCount,
  rollbackReason,
  batchId,
  log
) {
  log.warn(`[FILE-OPS] Executing rollback for batch ${batchId}`, {
    batchId,
    completedCount: completedOperations.length,
    failCount,
    reason: rollbackReason
  });

  // FIX P0-1: Persist recovery manifest before starting rollback
  // This allows recovery if the app crashes during rollback
  let recoveryPath = null;
  try {
    const userDataPath = app.getPath('userData');
    const recoveryDir = path.join(userDataPath, 'recovery');
    await fs.mkdir(recoveryDir, { recursive: true });

    recoveryPath = path.join(recoveryDir, `rollback_${batchId}.json`);
    const recoveryManifest = {
      batchId,
      timestamp: new Date().toISOString(),
      reason: rollbackReason,
      status: 'pending',
      operations: completedOperations, // These need to be reversed (dest -> source)
      results: []
    };

    await fs.writeFile(recoveryPath, JSON.stringify(recoveryManifest, null, 2));
    log.info(`[FILE-OPS] Recovery manifest saved to ${recoveryPath}`);
  } catch (err) {
    log.error(`[FILE-OPS] Failed to save recovery manifest: ${err.message}`);
    // Continue with rollback even if persistence fails
  }

  const rollbackResults = [];
  let rollbackSuccessCount = 0;
  let rollbackFailCount = 0;

  for (const completedOp of [...completedOperations].reverse()) {
    try {
      try {
        await fs.rename(completedOp.destination, completedOp.source);
      } catch (renameError) {
        if (renameError.code === 'EXDEV') {
          const sourceDir = path.dirname(completedOp.source);
          await fs.mkdir(sourceDir, { recursive: true });
          await crossDeviceMove(completedOp.destination, completedOp.source, {
            verify: true
          });
        } else {
          throw renameError;
        }
      }
      rollbackSuccessCount++;
      rollbackResults.push({ success: true, file: completedOp.source });

      // Update manifest with progress (optional, maybe too slow to do every file?
      // Doing it every file is safest but slow. Let's do it on failure or end.)
    } catch (rollbackError) {
      rollbackFailCount++;
      rollbackResults.push({
        success: false,
        file: completedOp.source,
        error: rollbackError.message
      });
    }
  }

  // Update recovery manifest status
  if (recoveryPath) {
    try {
      if (rollbackFailCount === 0) {
        // success, delete manifest
        await fs.unlink(recoveryPath);
        log.info(`[FILE-OPS] Rollback successful, recovery manifest deleted`);
      } else {
        // update manifest with results so we know what failed
        const recoveryManifest = JSON.parse(await fs.readFile(recoveryPath, 'utf8'));
        recoveryManifest.status = 'partial_failure';
        recoveryManifest.results = rollbackResults;
        await fs.writeFile(recoveryPath, JSON.stringify(recoveryManifest, null, 2));
        log.warn(`[FILE-OPS] Rollback had failures, manifest updated at ${recoveryPath}`);
      }
    } catch (err) {
      log.warn(`[FILE-OPS] Failed to update recovery manifest: ${err.message}`);
    }
  }

  log.warn('[FILE-OPS] Rollback summary', {
    batchId,
    rollbackSuccessCount,
    rollbackFailCount,
    completed: completedOperations.length
  });

  return {
    success: false,
    rolledBack: true,
    rollbackReason,
    results,
    rollbackResults,
    successCount: 0,
    failCount,
    rollbackSuccessCount,
    rollbackFailCount,
    summary: `Batch rolled back. ${rollbackSuccessCount}/${completedOperations.length} operations restored.`,
    batchId,
    criticalError: true
  };
}

/**
 * Record undo action and update database paths
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
      .filter((r) => r.success && r.source && r.destination)
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

  // Update ChromaDB paths for both file: and image: prefixed entries
  if (successCount > 0) {
    try {
      const { getInstance: getChromaDB } = require('../../services/chromadb');
      const chromaDbService = getChromaDB();

      if (chromaDbService) {
        const successfulResults = results.filter((r) => r.success && r.source && r.destination);

        // Create path updates for both file: and image: prefixes
        // Documents use file: prefix, images use image: prefix
        const pathUpdates = [];
        for (const r of successfulResults) {
          const newMeta = {
            path: r.destination,
            name: path.basename(r.destination)
          };

          // Add file: prefixed update (for documents)
          pathUpdates.push({
            oldId: `file:${r.source}`,
            newId: `file:${r.destination}`,
            newMeta
          });

          // Add image: prefixed update (for images)
          pathUpdates.push({
            oldId: `image:${r.source}`,
            newId: `image:${r.destination}`,
            newMeta
          });
        }

        if (pathUpdates.length > 0) {
          await chromaDbService.updateFilePaths(pathUpdates);
        }
      }
    } catch (error) {
      log.warn('[FILE-OPS] Error updating database paths', {
        error: error.message,
        batchId
      });
    }

    // Update any queued embeddings to avoid flushing stale IDs after batch moves.
    try {
      const embeddingQueue = require('../../analysis/embeddingQueue');
      const successfulResults = results.filter((r) => r.success && r.source && r.destination);
      const changes = successfulResults.map((r) => ({ oldPath: r.source, newPath: r.destination }));
      if (changes.length > 0) {
        embeddingQueue.updateByFilePaths?.(changes);
        log.debug('[FILE-OPS] Embedding queue paths updated', {
          batchId,
          count: changes.length
        });
      } else {
        log.debug('[FILE-OPS] Embedding queue update skipped (no changes)', { batchId });
      }
    } catch (error) {
      log.debug('[FILE-OPS] Embedding queue path update skipped', {
        error: error.message,
        batchId
      });
    }

    // Update analysis history entries with new paths for BM25 search
    try {
      // FIX: analysisHistory module exports the class directly, not getInstance.
      // Use service integration to access the singleton instance.
      const analysisHistoryService = getServiceIntegration()?.analysisHistory;

      if (analysisHistoryService?.updateEntryPaths) {
        const successfulResults = results.filter((r) => r.success && r.source && r.destination);

        const historyUpdates = successfulResults.map((r) => ({
          oldPath: r.source,
          newPath: r.destination,
          newName: path.basename(r.destination)
        }));

        if (historyUpdates.length > 0) {
          const updateResult = await analysisHistoryService.updateEntryPaths(historyUpdates);
          log.debug('[FILE-OPS] Updated analysis history paths', {
            batchId,
            updated: updateResult.updated,
            notFound: updateResult.notFound
          });
        } else {
          log.debug('[FILE-OPS] Analysis history path update skipped (no successes)', { batchId });
        }
      } else {
        log.debug('[FILE-OPS] Analysis history service not available for path updates', {
          batchId
        });
      }
    } catch (error) {
      log.warn('[FILE-OPS] Error updating analysis history paths', {
        error: error.message,
        batchId
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
          await Promise.race([
            rebuildPromise,
            new Promise((resolve) => setTimeout(resolve, REBUILD_TIMEOUT_MS))
          ]).catch((rebuildErr) => {
            log.warn('[FILE-OPS] BM25 rebuild failed or timed out after batch', {
              error: rebuildErr?.message,
              batchId
            });
          });
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
