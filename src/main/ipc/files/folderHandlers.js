/**
 * Folder Operation Handlers
 *
 * Handlers for folder operations (open, delete).
 *
 * @module ipc/files/folderHandlers
 */

const path = require('path');
const fs = require('fs').promises;
const { withErrorLogging } = require('../ipcWrappers');
const { logger } = require('../../../shared/logger');

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
  ipcMain.handle(
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

        if (error.code === 'EACCES' || error.code === 'EPERM') {
          errorCode = 'PERMISSION_DENIED';
          userMessage = 'Permission denied - cannot create folder here';
        } else if (error.code === 'ENOSPC') {
          errorCode = 'NO_SPACE';
          userMessage = 'Insufficient disk space';
        } else if (error.code === 'ENAMETOOLONG') {
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
  ipcMain.handle(
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
  ipcMain.handle(
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
          if (statError.code === 'ENOENT') {
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
        if (error.code === 'EACCES' || error.code === 'EPERM') {
          userMessage = 'Permission denied - check folder permissions';
        } else if (error.code === 'ENOTEMPTY') {
          userMessage = 'Directory not empty - contains files or subfolders';
        } else if (error.code === 'EBUSY') {
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
