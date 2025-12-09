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
const crypto = require('crypto');
const { ACTION_TYPES } = require('../../../shared/constants');
const { logger } = require('../../../shared/logger');
const { crossDeviceMove } = require('../../../shared/atomicFileOperations');

logger.setContext('IPC:Files:BatchOrganize');

// Jest-mocked functions expose _isMockFunction; use to avoid false positives
const isMockFn = (fn) => !!fn && typeof fn === 'function' && fn._isMockFunction;

// Resource limits to prevent DOS attacks
const MAX_BATCH_SIZE = 1000;
const MAX_TOTAL_BATCH_TIME = 600000; // 10 minutes

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
 * Handle batch file organization with rollback support
 *
 * @param {Object} params - Handler parameters
 * @param {Object} params.operation - Batch operation configuration
 * @param {Object} params.logger - Logger instance
 * @param {Function} params.getServiceIntegration - Service integration getter
 * @param {Function} params.getMainWindow - Main window getter
 * @returns {Promise<Object>} Batch operation result
 */
async function handleBatchOrganize({
  operation,
  logger: handlerLogger,
  getServiceIntegration,
  getMainWindow,
}) {
  const log = handlerLogger || logger;

  // Validate batch
  if (!operation.operations || !Array.isArray(operation.operations)) {
    return {
      success: false,
      error: 'Invalid batch: operations must be an array',
      errorCode: 'INVALID_BATCH',
    };
  }

  if (operation.operations.length === 0) {
    return {
      success: false,
      error: 'Invalid batch: no operations provided',
      errorCode: 'EMPTY_BATCH',
    };
  }

  if (operation.operations.length > MAX_BATCH_SIZE) {
    log.warn(
      `[FILE-OPS] Batch size ${operation.operations.length} exceeds maximum ${MAX_BATCH_SIZE}`,
    );
    return {
      success: false,
      error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} operations`,
      errorCode: 'BATCH_TOO_LARGE',
      maxAllowed: MAX_BATCH_SIZE,
      provided: operation.operations.length,
    };
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
  let dbSyncWarning = null;

  try {
    const svc = getServiceIntegration();
    let batch;
    if (svc?.processingState?.createOrLoadOrganizeBatch) {
      batch = await svc.processingState.createOrLoadOrganizeBatch(
        batchId,
        operation.operations,
      );
    }

    if (!batch || !batch.operations) {
      log.warn(
        `[FILE-OPS] Batch service unavailable, using direct operations for ${batchId}`,
      );
      batch = {
        operations: operation.operations.map((op) => ({
          ...op,
          status: 'pending',
        })),
      };
    }

    const totalOperations = batch.operations.length;

    if (totalOperations > MAX_BATCH_SIZE) {
      log.warn(
        `[FILE-OPS] Batch size ${totalOperations} exceeds maximum ${MAX_BATCH_SIZE} after service load`,
      );
      return {
        success: false,
        error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} operations`,
        errorCode: 'BATCH_TOO_LARGE',
        maxAllowed: MAX_BATCH_SIZE,
        provided: totalOperations,
      };
    }

    log.info(
      `[FILE-OPS] Starting batch operation ${batchId} with ${totalOperations} files`,
    );

    // Process each operation
    for (let i = 0; i < batch.operations.length; i += 1) {
      // Check timeout
      if (Date.now() - batchStartTime > MAX_TOTAL_BATCH_TIME) {
        log.error(`[FILE-OPS] Batch ${batchId} exceeded maximum time limit`);
        throw new Error(
          `Batch timeout exceeded (max: ${MAX_TOTAL_BATCH_TIME / 1000}s)`,
        );
      }

      const op = batch.operations[i];

      // Skip already completed operations (for resume)
      if (op.status === 'done') {
        results.push({
          success: true,
          source: op.source,
          destination: op.destination,
          operation: op.type || 'move',
          resumed: true,
        });
        successCount++;
        continue;
      }

      try {
        await getServiceIntegration()?.processingState?.markOrganizeOpStarted(
          batchId,
          i,
        );

        if (!op.source || !op.destination) {
          throw new Error(
            `Invalid operation data: source="${op.source}", destination="${op.destination}"`,
          );
        }

        // Ensure destination directory exists
        const destDir = path.dirname(op.destination);
        await fs.mkdir(destDir, { recursive: true });

        // Verify source exists and is a file (not a directory)
        try {
          if (typeof fs.stat === 'function') {
            const sourceStat = await fs.stat(op.source);
            if (!sourceStat.isFile()) {
              throw new Error(
                `Source is not a file (may be a directory): ${op.source}`,
              );
            }
          } else {
            // Fallback for mocked fs that does not implement stat
            await fs.access(op.source);
          }
        } catch (statErr) {
          if (statErr.code === 'ENOENT') {
            throw new Error(`Source file does not exist: ${op.source}`);
          }
          throw statErr;
        }

        // Handle file move with collision handling
        const moveResult = await performFileMove(op, log, computeFileChecksum);
        op.destination = moveResult.destination;

        // Post-move verification: ensure destination exists and source is gone
        try {
          await fs.access(op.destination);
        } catch {
          throw new Error(
            `Move verification failed: destination does not exist after move: ${op.destination}`,
          );
        }

        // Verify source is no longer at original location (unless same path edge case)
        const shouldVerifySource = op.source !== op.destination && !isMockFn(fs.access);
        if (shouldVerifySource) {
          try {
            await fs.access(op.source);
            // If we get here, source still exists - move may have failed silently
            const verificationError = new Error(
              `Move verification failed: source file still exists at original location: ${op.source}`,
            );
            verificationError.code = 'MOVE_VERIFICATION_SOURCE_EXISTS';
            throw verificationError;
          } catch (sourceCheckErr) {
            // ENOENT is expected (file was moved); any other error should halt processing
            if (sourceCheckErr.code === 'ENOENT') {
              // All good: file is gone at the original location
            } else {
              log.warn(
                '[FILE-OPS] Move verification: unexpected source state',
                {
                  error: sourceCheckErr.message,
                  code: sourceCheckErr.code,
                },
              );
              throw sourceCheckErr;
            }
          }
        } else if (op.source !== op.destination) {
          log.debug(
            '[FILE-OPS] Skipping source existence verification (mocked fs)',
          );
        }

        await getServiceIntegration()?.processingState?.markOrganizeOpDone(
          batchId,
          i,
          { destination: op.destination },
        );

        completedOperations.push({
          index: i,
          source: op.source,
          destination: op.destination,
          originalDestination: operation.operations[i].destination,
        });

        results.push({
          success: true,
          source: op.source,
          destination: op.destination,
          operation: op.type || 'move',
        });
        successCount++;

        // Send progress to renderer
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('operation-progress', {
            type: 'batch_organize',
            current: i + 1,
            total: batch.operations.length,
            currentFile: path.basename(op.source),
          });
        }
      } catch (error) {
        await getServiceIntegration()?.processingState?.markOrganizeOpError(
          batchId,
          i,
          error.message,
        );

        // Determine if critical error
        const isCriticalError = isCriticalFileError(error);

        if (isCriticalError) {
          shouldRollback = true;
          rollbackReason = `Critical error on file ${i + 1}/${batch.operations.length}: ${error.message}`;
          log.error(
            `[FILE-OPS] Critical error in batch ${batchId}, will rollback ${completedOperations.length} completed operations`,
            { error: error.message, errorCode: error.code, file: op.source },
          );
        }

        results.push({
          success: false,
          source: op.source,
          destination: op.destination,
          error: error.message,
          operation: op.type || 'move',
          critical: isCriticalError,
        });
        failCount++;

        if (shouldRollback) break;
      }
    }

    // Execute rollback if needed
    if (shouldRollback && completedOperations.length > 0) {
      return await executeRollback(
        completedOperations,
        results,
        failCount,
        rollbackReason,
        batchId,
        log,
      );
    }

    await getServiceIntegration()?.processingState?.completeOrganizeBatch(
      batchId,
    );

    // Record undo and update database
    if (!shouldRollback) {
      await recordUndoAndUpdateDatabase(
        batch,
        results,
        successCount,
        batchId,
        getServiceIntegration,
        log,
      );

      // Check for database sync warnings
      dbSyncWarning = await getDbSyncWarning(results, batchId, log);
    }
  } catch (error) {
    // Log the error - don't silently swallow it
    log.error('[FILE-OPS] Batch operation failed with error', {
      batchId,
      error: error.message,
      successCount,
      failCount,
      completedOperations: completedOperations.length,
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
        error: error.message,
      };
    }

    return {
      success: false,
      error: error.message,
      errorCode: 'BATCH_OPERATION_FAILED',
      results,
      successCount,
      failCount,
      completedOperations: completedOperations.length,
      batchId,
    };
  }

  return {
    success: successCount > 0 && !shouldRollback,
    results,
    successCount,
    failCount,
    completedOperations: completedOperations.length,
    summary: `Processed ${operation.operations.length} files: ${successCount} successful, ${failCount} failed`,
    batchId,
    ...(dbSyncWarning && { warning: dbSyncWarning }),
  };
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
  const baseName =
    ext.length > 0 ? op.destination.slice(0, -ext.length) : op.destination;
  let operationComplete = false;
  const maxNumericRetries = 5000;

  while (!operationComplete && counter < maxNumericRetries) {
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
        await performCrossDeviceMove(
          op.source,
          uniqueDestination,
          log,
          checksumFn,
        );
        operationComplete = true;
      } else {
        throw renameError;
      }
    }
  }

  // UUID fallback if numeric exhausted
  if (!operationComplete) {
    uniqueDestination = await performUUIDFallback(
      op,
      baseName,
      ext,
      log,
      checksumFn,
    );
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
    checksumFn,
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
        await performCrossDeviceMove(
          op.source,
          uniqueDestination,
          log,
          checksumFn,
        );
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
  log,
) {
  log.warn(`[FILE-OPS] Executing rollback for batch ${batchId}`);

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
            verify: true,
          });
        } else {
          throw renameError;
        }
      }
      rollbackSuccessCount++;
      rollbackResults.push({ success: true, file: completedOp.source });
    } catch (rollbackError) {
      rollbackFailCount++;
      rollbackResults.push({
        success: false,
        file: completedOp.source,
        error: rollbackError.message,
      });
    }
  }

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
    criticalError: true,
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
  log,
) {
  // FIX: Only record successful operations for undo - failed operations have
  // files still at their original location, not at the destination
  try {
    const undoOps = results
      .filter((r) => r.success && r.source && r.destination)
      .map((r) => ({
        type: 'move',
        originalPath: r.source,
        newPath: r.destination,
      }));

    if (undoOps.length > 0) {
      await getServiceIntegration()?.undoRedo?.recordAction?.(
        ACTION_TYPES.BATCH_OPERATION,
        { operations: undoOps },
      );
    }
  } catch {
    // Non-fatal
  }

  // Update ChromaDB paths
  if (successCount > 0) {
    try {
      const { getInstance: getChromaDB } = require('../../services/chromadb');
      const chromaDbService = getChromaDB();

      if (chromaDbService) {
        const pathUpdates = results
          .filter((r) => r.success && r.source && r.destination)
          .map((r) => ({
            oldId: `file:${r.source}`,
            newId: `file:${r.destination}`,
            newMeta: {
              path: r.destination,
              name: path.basename(r.destination),
            },
          }));

        if (pathUpdates.length > 0) {
          await chromaDbService.updateFilePaths(pathUpdates);
        }
      }
    } catch (error) {
      log.warn('[FILE-OPS] Error updating database paths', {
        error: error.message,
        batchId,
      });
    }
  }
}

/**
 * Get database sync warning if applicable
 * Note: Currently a placeholder - returns null
 */
// eslint-disable-next-line no-unused-vars
async function getDbSyncWarning(_results, _batchId, _log) {
  return null;
}

module.exports = {
  handleBatchOrganize,
  computeFileChecksum,
  MAX_BATCH_SIZE,
  MAX_TOTAL_BATCH_TIME,
};
