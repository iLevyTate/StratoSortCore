/**
 * File Operation Handlers
 *
 * Handlers for individual file operations (move, copy, delete).
 *
 * @module ipc/files/fileOperationHandlers
 */

const path = require('path');
const fs = require('fs').promises;
const { ACTION_TYPES } = require('../../../shared/constants');
const { withErrorLogging, withValidation } = require('../ipcWrappers');
const { logger } = require('../../../shared/logger');
const { handleBatchOrganize } = require('./batchOrganizeHandler');
const { z, operationSchema } = require('./schemas');
const { validateFileOperationPath } = require('../../../shared/pathSanitization');

logger.setContext('IPC:Files:Operations');

/**
 * Validate source and destination paths for file operations
 * @param {string} source - Source file path
 * @param {string} destination - Destination file path (optional for delete)
 * @param {Object} log - Logger instance
 * @returns {Promise<{valid: boolean, source?: string, destination?: string, error?: string}>}
 */
async function validateOperationPaths(source, destination, log) {
  // Validate source path
  const sourceResult = await validateFileOperationPath(source, {
    checkSymlinks: true
  });

  if (!sourceResult.valid) {
    log.warn('[FILE-OPS] Source path validation failed', {
      source,
      error: sourceResult.error
    });
    return {
      valid: false,
      error: `Invalid source path: ${sourceResult.error}`
    };
  }

  // If no destination, return validated source only
  if (!destination) {
    return { valid: true, source: sourceResult.normalizedPath };
  }

  // Validate destination path
  const destResult = await validateFileOperationPath(destination, {
    checkSymlinks: true
  });

  if (!destResult.valid) {
    log.warn('[FILE-OPS] Destination path validation failed', {
      destination,
      error: destResult.error
    });
    return {
      valid: false,
      error: `Invalid destination path: ${destResult.error}`
    };
  }

  return {
    valid: true,
    source: sourceResult.normalizedPath,
    destination: destResult.normalizedPath
  };
}

/**
 * Update database path after file move
 */
async function updateDatabasePath(source, destination, log) {
  let dbSyncWarning = null;
  try {
    const { getInstance: getChromaDB } = require('../../services/chromadb');
    const chromaDbService = getChromaDB();
    if (chromaDbService) {
      const oldId = `file:${source}`;
      const newId = `file:${destination}`;
      await chromaDbService.updateFilePaths([
        {
          oldId,
          newId,
          newMeta: {
            path: destination,
            name: path.basename(destination)
          }
        }
      ]);
    }
  } catch (dbError) {
    log.warn('[FILE-OPS] Database path update failed after move', {
      error: dbError.message
    });
    dbSyncWarning = `File moved but database sync failed: ${dbError.message}`;
  }
  return dbSyncWarning;
}

/**
 * Delete file from database and clean up pending embeddings
 */
async function deleteFromDatabase(filePath, log) {
  let dbDeleteWarning = null;

  // Clean up pending embeddings from the queue to prevent orphaned embeddings
  try {
    const embeddingQueue = require('../../analysis/embeddingQueue');
    const removedCount = embeddingQueue.removeByFilePath(filePath);
    if (removedCount > 0) {
      log.debug('[FILE-OPS] Removed pending embeddings for deleted file', {
        filePath,
        removedCount
      });
    }
  } catch (queueError) {
    log.warn('[FILE-OPS] Failed to clean embedding queue', {
      error: queueError.message
    });
  }

  // Delete from ChromaDB
  try {
    const { getInstance: getChromaDB } = require('../../services/chromadb');
    const chromaDbService = getChromaDB();
    if (chromaDbService) {
      await chromaDbService.deleteFileEmbedding(`file:${filePath}`);
    }
  } catch (dbError) {
    log.warn('[FILE-OPS] Database entry delete failed', {
      error: dbError.message
    });
    dbDeleteWarning = `File deleted but database sync failed: ${dbError.message}`;
  }
  return dbDeleteWarning;
}

/**
 * Create the perform operation handler
 */
function createPerformOperationHandler({ logger: log, getServiceIntegration, getMainWindow }) {
  return async (event, operation) => {
    // FIX: Validate operation object before processing
    if (!operation || typeof operation !== 'object') {
      return {
        success: false,
        error: 'Invalid operation: expected an object',
        errorCode: 'INVALID_OPERATION'
      };
    }

    if (!operation.type || typeof operation.type !== 'string') {
      return {
        success: false,
        error: 'Invalid operation: missing or invalid type',
        errorCode: 'INVALID_OPERATION_TYPE'
      };
    }

    try {
      log.info('[FILE-OPS] Performing operation:', {
        type: operation.type,
        source: operation.source ? path.basename(operation.source) : 'N/A',
        destination: operation.destination ? path.basename(operation.destination) : 'N/A'
      });

      switch (operation.type) {
        case 'move': {
          // SECURITY FIX: Validate paths before file operation
          const moveValidation = await validateOperationPaths(
            operation.source,
            operation.destination,
            log
          );
          if (!moveValidation.valid) {
            return {
              success: false,
              error: moveValidation.error,
              errorCode: 'INVALID_PATH'
            };
          }

          await fs.rename(moveValidation.source, moveValidation.destination);

          try {
            await getServiceIntegration()?.undoRedo?.recordAction?.(ACTION_TYPES.FILE_MOVE, {
              originalPath: moveValidation.source,
              newPath: moveValidation.destination
            });
          } catch {
            // Non-fatal
          }

          const dbSyncWarning = await updateDatabasePath(
            moveValidation.source,
            moveValidation.destination,
            log
          );

          return {
            success: true,
            message: `Moved ${moveValidation.source} to ${moveValidation.destination}`,
            ...(dbSyncWarning && { warning: dbSyncWarning })
          };
        }

        case 'copy': {
          // SECURITY FIX: Validate paths before file operation
          const copyValidation = await validateOperationPaths(
            operation.source,
            operation.destination,
            log
          );
          if (!copyValidation.valid) {
            return {
              success: false,
              error: copyValidation.error,
              errorCode: 'INVALID_PATH'
            };
          }

          await fs.copyFile(copyValidation.source, copyValidation.destination);
          return {
            success: true,
            message: `Copied ${copyValidation.source} to ${copyValidation.destination}`
          };
        }

        case 'delete': {
          // SECURITY FIX: Validate path before file operation
          const deleteValidation = await validateOperationPaths(operation.source, null, log);
          if (!deleteValidation.valid) {
            return {
              success: false,
              error: deleteValidation.error,
              errorCode: 'INVALID_PATH'
            };
          }

          await fs.unlink(deleteValidation.source);
          const dbDeleteWarning = await deleteFromDatabase(deleteValidation.source, log);

          return {
            success: true,
            message: `Deleted ${deleteValidation.source}`,
            ...(dbDeleteWarning && { warning: dbDeleteWarning })
          };
        }

        case 'batch_organize':
          return await handleBatchOrganize({
            operation,
            logger: log,
            getServiceIntegration,
            getMainWindow
          });

        default:
          log.error(`[FILE-OPS] Unknown operation type: ${operation.type}`);
          return {
            success: false,
            error: `Unknown operation type: ${operation.type}`
          };
      }
    } catch (error) {
      log.error('[FILE-OPS] Error performing operation:', error);
      return { success: false, error: error.message };
    }
  };
}

/**
 * Register file operation IPC handlers
 */
function registerFileOperationHandlers({
  ipcMain,
  IPC_CHANNELS,
  logger: handlerLogger,
  getServiceIntegration,
  getMainWindow
}) {
  const log = handlerLogger || logger;
  const baseHandler = createPerformOperationHandler({
    logger: log,
    getServiceIntegration,
    getMainWindow
  });

  // Create handler with or without Zod validation
  // withValidation signature: (logger, schema, handler, options)
  const performOperationHandler =
    z && operationSchema
      ? withValidation(log, operationSchema, baseHandler)
      : withErrorLogging(log, baseHandler);

  ipcMain.handle(IPC_CHANNELS.FILES.PERFORM_OPERATION, performOperationHandler);

  // Delete file handler
  ipcMain.handle(
    IPC_CHANNELS.FILES.DELETE_FILE,
    withErrorLogging(log, async (event, filePath) => {
      try {
        if (!filePath || typeof filePath !== 'string') {
          return {
            success: false,
            error: 'Invalid file path provided',
            errorCode: 'INVALID_PATH'
          };
        }

        // SECURITY FIX: Validate path before any operations
        const validation = await validateFileOperationPath(filePath, {
          checkSymlinks: true
        });

        if (!validation.valid) {
          log.warn('[FILE-OPS] Delete path validation failed', {
            filePath,
            error: validation.error
          });
          return {
            success: false,
            error: validation.error,
            errorCode: 'INVALID_PATH'
          };
        }

        const validatedPath = validation.normalizedPath;

        // TOCTOU FIX: Get stats in try-catch, handle errors gracefully
        // Combine stat + unlink - if stat fails, we'll get the error
        // If file is deleted between stat and unlink, unlink will also fail with ENOENT
        let fileSize = 0;
        try {
          const stats = await fs.stat(validatedPath);
          fileSize = stats.size;
        } catch (statError) {
          if (statError.code === 'ENOENT') {
            return {
              success: false,
              error: 'File not found or inaccessible',
              errorCode: 'FILE_NOT_FOUND',
              details: statError.message
            };
          }
          // For other errors, try to proceed with delete anyway
          log.warn('[FILE-OPS] Could not stat file before delete', {
            error: statError.message
          });
        }

        await fs.unlink(validatedPath);

        const dbDeleteWarning = await deleteFromDatabase(validatedPath, log);

        log.info('[FILE-OPS] Deleted file:', validatedPath, `(${fileSize} bytes)`);

        return {
          success: true,
          message: 'File deleted successfully',
          deletedFile: {
            path: validatedPath,
            size: fileSize,
            deletedAt: new Date().toISOString()
          },
          ...(dbDeleteWarning && { warning: dbDeleteWarning })
        };
      } catch (error) {
        log.error('[FILE-OPS] Error deleting file:', error);

        let errorCode = 'DELETE_FAILED';
        let userMessage = 'Failed to delete file';

        if (error.code === 'ENOENT') {
          errorCode = 'FILE_NOT_FOUND';
          userMessage = 'File not found';
        } else if (error.code === 'EACCES' || error.code === 'EPERM') {
          errorCode = 'PERMISSION_DENIED';
          userMessage = 'Permission denied - file may be in use';
        } else if (error.code === 'EBUSY') {
          errorCode = 'FILE_IN_USE';
          userMessage = 'File is currently in use';
        }

        return {
          success: false,
          error: userMessage,
          errorCode,
          details: error.message,
          systemError: error.code
        };
      }
    })
  );

  // Copy file handler
  ipcMain.handle(
    IPC_CHANNELS.FILES.COPY_FILE,
    withErrorLogging(log, async (event, sourcePath, destinationPath) => {
      try {
        if (!sourcePath || !destinationPath) {
          return {
            success: false,
            error: 'Source and destination paths are required',
            errorCode: 'INVALID_PATHS'
          };
        }

        // SECURITY FIX: Validate both paths before any operations
        const validation = await validateOperationPaths(sourcePath, destinationPath, log);

        if (!validation.valid) {
          return {
            success: false,
            error: validation.error,
            errorCode: 'INVALID_PATH'
          };
        }

        const normalizedSource = validation.source;
        const normalizedDestination = validation.destination;

        // TOCTOU FIX: Don't pre-check with access(), let copyFile handle errors
        // Get stats for return value, but don't gate on it
        let fileSize = 0;
        try {
          const sourceStats = await fs.stat(normalizedSource);
          fileSize = sourceStats.size;
        } catch (statError) {
          if (statError.code === 'ENOENT') {
            return {
              success: false,
              error: 'Source file not found',
              errorCode: 'SOURCE_NOT_FOUND',
              details: statError.message
            };
          }
          // For other errors, try to proceed anyway
          log.warn('[FILE-OPS] Could not stat source file before copy', {
            error: statError.message
          });
        }

        const destDir = path.dirname(normalizedDestination);
        await fs.mkdir(destDir, { recursive: true });

        await fs.copyFile(normalizedSource, normalizedDestination);

        log.info('[FILE-OPS] Copied file:', normalizedSource, 'to', normalizedDestination);

        return {
          success: true,
          message: 'File copied successfully',
          operation: {
            source: normalizedSource,
            destination: normalizedDestination,
            size: fileSize,
            copiedAt: new Date().toISOString()
          }
        };
      } catch (error) {
        log.error('[FILE-OPS] Error copying file:', error);

        let errorCode = 'COPY_FAILED';
        let userMessage = 'Failed to copy file';

        if (error.code === 'ENOSPC') {
          errorCode = 'INSUFFICIENT_SPACE';
          userMessage = 'Insufficient disk space';
        } else if (error.code === 'EACCES' || error.code === 'EPERM') {
          errorCode = 'PERMISSION_DENIED';
          userMessage = 'Permission denied';
        } else if (error.code === 'EEXIST') {
          errorCode = 'FILE_EXISTS';
          userMessage = 'Destination file already exists';
        } else if (error.code === 'ENOENT') {
          errorCode = 'SOURCE_NOT_FOUND';
          userMessage = 'Source file not found';
        }

        return {
          success: false,
          error: userMessage,
          errorCode,
          details: error.message
        };
      }
    })
  );
}

module.exports = { registerFileOperationHandlers };
