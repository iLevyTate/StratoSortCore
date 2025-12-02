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
const { withErrorLogging, withValidation } = require('../withErrorLogging');
const { logger } = require('../../../shared/logger');
const { handleBatchOrganize } = require('./batchOrganizeHandler');
const { z, operationSchema } = require('./schemas');

logger.setContext('IPC:Files:Operations');

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
            name: path.basename(destination),
          },
        },
      ]);
    }
  } catch (dbError) {
    log.warn('[FILE-OPS] Database path update failed after move', {
      error: dbError.message,
    });
    dbSyncWarning = `File moved but database sync failed: ${dbError.message}`;
  }
  return dbSyncWarning;
}

/**
 * Delete file from database
 */
async function deleteFromDatabase(filePath, log) {
  let dbDeleteWarning = null;
  try {
    const { getInstance: getChromaDB } = require('../../services/chromadb');
    const chromaDbService = getChromaDB();
    if (chromaDbService) {
      await chromaDbService.deleteFileEmbedding(`file:${filePath}`);
    }
  } catch (dbError) {
    log.warn('[FILE-OPS] Database entry delete failed', {
      error: dbError.message,
    });
    dbDeleteWarning = `File deleted but database sync failed: ${dbError.message}`;
  }
  return dbDeleteWarning;
}

/**
 * Create the perform operation handler
 */
function createPerformOperationHandler({
  logger: log,
  getServiceIntegration,
  getMainWindow,
}) {
  return async (event, operation) => {
    // FIX: Validate operation object before processing
    if (!operation || typeof operation !== 'object') {
      return {
        success: false,
        error: 'Invalid operation: expected an object',
        errorCode: 'INVALID_OPERATION',
      };
    }

    if (!operation.type || typeof operation.type !== 'string') {
      return {
        success: false,
        error: 'Invalid operation: missing or invalid type',
        errorCode: 'INVALID_OPERATION_TYPE',
      };
    }

    try {
      log.info('[FILE-OPS] Performing operation:', {
        type: operation.type,
        source: operation.source ? path.basename(operation.source) : 'N/A',
        destination: operation.destination
          ? path.basename(operation.destination)
          : 'N/A',
      });

      switch (operation.type) {
        case 'move': {
          await fs.rename(operation.source, operation.destination);

          try {
            await getServiceIntegration()?.undoRedo?.recordAction?.(
              ACTION_TYPES.FILE_MOVE,
              {
                originalPath: operation.source,
                newPath: operation.destination,
              },
            );
          } catch {
            // Non-fatal
          }

          const dbSyncWarning = await updateDatabasePath(
            operation.source,
            operation.destination,
            log,
          );

          return {
            success: true,
            message: `Moved ${operation.source} to ${operation.destination}`,
            ...(dbSyncWarning && { warning: dbSyncWarning }),
          };
        }

        case 'copy':
          await fs.copyFile(operation.source, operation.destination);
          return {
            success: true,
            message: `Copied ${operation.source} to ${operation.destination}`,
          };

        case 'delete': {
          await fs.unlink(operation.source);
          const dbDeleteWarning = await deleteFromDatabase(
            operation.source,
            log,
          );

          return {
            success: true,
            message: `Deleted ${operation.source}`,
            ...(dbDeleteWarning && { warning: dbDeleteWarning }),
          };
        }

        case 'batch_organize':
          return await handleBatchOrganize({
            operation,
            logger: log,
            getServiceIntegration,
            getMainWindow,
          });

        default:
          log.error(`[FILE-OPS] Unknown operation type: ${operation.type}`);
          return {
            success: false,
            error: `Unknown operation type: ${operation.type}`,
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
  getMainWindow,
}) {
  const log = handlerLogger || logger;
  const baseHandler = createPerformOperationHandler({
    logger: log,
    getServiceIntegration,
    getMainWindow,
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
            errorCode: 'INVALID_PATH',
          };
        }

        try {
          await fs.access(filePath);
        } catch (accessError) {
          return {
            success: false,
            error: 'File not found or inaccessible',
            errorCode: 'FILE_NOT_FOUND',
            details: accessError.message,
          };
        }

        const stats = await fs.stat(filePath);
        await fs.unlink(filePath);

        const dbDeleteWarning = await deleteFromDatabase(filePath, log);

        log.info('[FILE-OPS] Deleted file:', filePath, `(${stats.size} bytes)`);

        return {
          success: true,
          message: 'File deleted successfully',
          deletedFile: {
            path: filePath,
            size: stats.size,
            deletedAt: new Date().toISOString(),
          },
          ...(dbDeleteWarning && { warning: dbDeleteWarning }),
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
          systemError: error.code,
        };
      }
    }),
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
            errorCode: 'INVALID_PATHS',
          };
        }

        const normalizedSource = path.resolve(sourcePath);
        const normalizedDestination = path.resolve(destinationPath);

        try {
          await fs.access(normalizedSource);
        } catch (accessError) {
          return {
            success: false,
            error: 'Source file not found',
            errorCode: 'SOURCE_NOT_FOUND',
            details: accessError.message,
          };
        }

        const destDir = path.dirname(normalizedDestination);
        await fs.mkdir(destDir, { recursive: true });

        const sourceStats = await fs.stat(normalizedSource);
        await fs.copyFile(normalizedSource, normalizedDestination);

        log.info(
          '[FILE-OPS] Copied file:',
          normalizedSource,
          'to',
          normalizedDestination,
        );

        return {
          success: true,
          message: 'File copied successfully',
          operation: {
            source: normalizedSource,
            destination: normalizedDestination,
            size: sourceStats.size,
            copiedAt: new Date().toISOString(),
          },
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
        }

        return {
          success: false,
          error: userMessage,
          errorCode,
          details: error.message,
        };
      }
    }),
  );
}

module.exports = { registerFileOperationHandlers };
