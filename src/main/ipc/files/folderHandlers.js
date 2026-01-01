/**
 * Folder Operation Handlers
 *
 * Handlers for folder operations (open, delete).
 *
 * @module ipc/files/folderHandlers
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { app } = require('electron');
const { withErrorLogging, safeHandle } = require('../ipcWrappers');
const { logger } = require('../../../shared/logger');
const { validateFileOperationPath } = require('../../../shared/pathSanitization');
const {
  isNotFoundError,
  isPermissionError,
  ErrorCategory,
  getErrorCategory
} = require('../../../shared/errorClassifier');

logger.setContext('IPC:Files:Folders');

/**
 * Register folder operation IPC handlers
 *
 * @param {Object} params - Registration parameters
 * @param {Object} params.ipcMain - Electron IPC main
 * @param {Object} params.IPC_CHANNELS - IPC channel constants
 * @param {Object} params.shell - Electron shell module
 */
function registerFolderHandlers({ ipcMain, IPC_CHANNELS, shell }) {
  // Create folder directly
  safeHandle(
    ipcMain,
    IPC_CHANNELS.FILES.CREATE_FOLDER_DIRECT,
    withErrorLogging(logger, async (event, fullPath) => {
      try {
        if (!fullPath || typeof fullPath !== 'string') {
          return {
            success: false,
            error: 'Invalid folder path provided',
            errorCode: 'INVALID_PATH'
          };
        }

        const normalizedPath = path.resolve(fullPath);

        // Validate path is within allowed directories to prevent path traversal
        const allowedPaths = [
          os.homedir(),
          app.getPath('documents'),
          app.getPath('downloads'),
          app.getPath('desktop')
        ];

        const validation = await validateFileOperationPath(normalizedPath, {
          allowedBasePaths: allowedPaths,
          checkSymlinks: true
        });

        if (!validation.valid) {
          logger.warn('[FILE-OPS] Folder creation blocked - path traversal attempt', {
            path: fullPath,
            normalized: normalizedPath,
            error: validation.error
          });
          return {
            success: false,
            error: validation.error || 'Path is outside allowed directories',
            errorCode: 'PATH_NOT_ALLOWED'
          };
        }

        // Check if folder already exists
        try {
          const stats = await fs.stat(normalizedPath);
          if (stats.isDirectory()) {
            return {
              success: true,
              message: 'Folder already exists',
              path: normalizedPath,
              alreadyExisted: true
            };
          } else {
            return {
              success: false,
              error: 'A file with this name already exists',
              errorCode: 'FILE_EXISTS'
            };
          }
        } catch (statError) {
          // ENOENT means folder doesn't exist, which is expected
          if (statError.code !== 'ENOENT') {
            throw statError;
          }
        }

        // Create the folder recursively
        await fs.mkdir(normalizedPath, { recursive: true });
        logger.info('[FILE-OPS] Created folder:', normalizedPath);

        return {
          success: true,
          message: 'Folder created successfully',
          path: normalizedPath,
          alreadyExisted: false
        };
      } catch (error) {
        logger.error('[FILE-OPS] Error creating folder:', error);

        let userMessage = 'Failed to create folder';
        let errorCode = 'CREATE_FAILED';

        if (isPermissionError(error)) {
          errorCode = 'PERMISSION_DENIED';
          userMessage = 'Permission denied - cannot create folder here';
        } else if (getErrorCategory(error) === ErrorCategory.DISK_FULL) {
          errorCode = 'NO_SPACE';
          userMessage = 'Insufficient disk space';
        } else if (getErrorCategory(error) === ErrorCategory.PATH_TOO_LONG) {
          errorCode = 'NAME_TOO_LONG';
          userMessage = 'Folder path is too long';
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

  // Open folder in file explorer
  safeHandle(
    ipcMain,
    IPC_CHANNELS.FILES.OPEN_FOLDER,
    withErrorLogging(logger, async (event, folderPath) => {
      try {
        if (!folderPath || typeof folderPath !== 'string') {
          return {
            success: false,
            error: 'Invalid folder path provided',
            errorCode: 'INVALID_PATH'
          };
        }

        const normalizedPath = path.resolve(folderPath);

        try {
          const stats = await fs.stat(normalizedPath);
          if (!stats.isDirectory()) {
            return {
              success: false,
              error: 'Path is not a directory',
              errorCode: 'NOT_A_DIRECTORY'
            };
          }
        } catch (accessError) {
          return {
            success: false,
            error: 'Folder not found or inaccessible',
            errorCode: 'FOLDER_NOT_FOUND',
            details: accessError.message
          };
        }

        await shell.openPath(normalizedPath);
        logger.info('[FILE-OPS] Opened folder:', normalizedPath);

        return {
          success: true,
          message: 'Folder opened successfully',
          openedPath: normalizedPath
        };
      } catch (error) {
        logger.error('[FILE-OPS] Error opening folder:', error);
        return {
          success: false,
          error: 'Failed to open folder',
          errorCode: 'OPEN_FAILED',
          details: error.message
        };
      }
    })
  );

  // Delete empty folder
  safeHandle(
    ipcMain,
    IPC_CHANNELS.FILES.DELETE_FOLDER,
    withErrorLogging(logger, async (event, fullPath) => {
      // FIX: Add null check for fullPath parameter
      if (!fullPath || typeof fullPath !== 'string') {
        return {
          success: false,
          error: 'Invalid folder path provided',
          errorCode: 'INVALID_PATH'
        };
      }

      try {
        const normalizedPath = path.resolve(fullPath);

        try {
          const stats = await fs.stat(normalizedPath);
          if (!stats.isDirectory()) {
            return {
              success: false,
              error: 'Path is not a directory',
              code: 'NOT_DIRECTORY'
            };
          }
        } catch (statError) {
          if (isNotFoundError(statError)) {
            return {
              success: true,
              message: 'Folder already deleted or does not exist',
              existed: false
            };
          }
          throw statError;
        }

        const contents = await fs.readdir(normalizedPath);
        if (contents.length > 0) {
          return {
            success: false,
            error: `Directory not empty - contains ${contents.length} items`,
            code: 'NOT_EMPTY',
            itemCount: contents.length
          };
        }

        await fs.rmdir(normalizedPath);
        logger.info('[FILE-OPS] Deleted folder:', normalizedPath);

        return {
          success: true,
          path: normalizedPath,
          message: 'Folder deleted successfully'
        };
      } catch (error) {
        logger.error('[FILE-OPS] Error deleting folder:', error);

        let userMessage = 'Failed to delete folder';
        if (isPermissionError(error)) {
          userMessage = 'Permission denied - check folder permissions';
        } else if (getErrorCategory(error) === ErrorCategory.DIRECTORY_NOT_EMPTY) {
          userMessage = 'Directory not empty - contains files or subfolders';
        } else if (getErrorCategory(error) === ErrorCategory.FILE_IN_USE) {
          userMessage = 'Directory is in use by another process';
        }

        return {
          success: false,
          error: userMessage,
          details: error.message,
          code: error.code
        };
      }
    })
  );
}

module.exports = { registerFolderHandlers };
