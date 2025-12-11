/**
 * Shell Operation Handlers
 *
 * Simple file/folder shell operations (open, reveal).
 *
 * @module ipc/files/shellHandlers
 */

const fs = require('fs').promises;
const { withErrorLogging } = require('../ipcWrappers');
const { logger } = require('../../../shared/logger');
const { validateFileOperationPath } = require('../../../shared/pathSanitization');

logger.setContext('IPC:Files:Shell');

/**
 * Register shell operation IPC handlers
 *
 * @param {Object} params - Registration parameters
 * @param {Object} params.ipcMain - Electron IPC main
 * @param {Object} params.IPC_CHANNELS - IPC channel constants
 * @param {Object} params.shell - Electron shell module
 */
function registerShellHandlers({ ipcMain, IPC_CHANNELS, shell }) {
  // Open file with default application
  ipcMain.handle(
    IPC_CHANNELS.FILES.OPEN_FILE,
    withErrorLogging(logger, async (event, filePath) => {
      try {
        // SECURITY FIX: Validate path before opening
        if (!filePath || typeof filePath !== 'string') {
          return {
            success: false,
            error: 'Invalid file path provided',
            errorCode: 'INVALID_PATH'
          };
        }

        const validation = await validateFileOperationPath(filePath, {
          checkSymlinks: true
        });

        if (!validation.valid) {
          logger.warn('[FILE-OPS] Open file path validation failed', {
            filePath,
            error: validation.error
          });
          return {
            success: false,
            error: validation.error,
            errorCode: 'INVALID_PATH'
          };
        }

        // Verify file exists before trying to open
        try {
          await fs.access(validation.normalizedPath);
        } catch {
          return {
            success: false,
            error: 'File not found or inaccessible',
            errorCode: 'FILE_NOT_FOUND'
          };
        }

        const result = await shell.openPath(validation.normalizedPath);
        // shell.openPath returns empty string on success, error message otherwise
        if (result) {
          logger.warn('[FILE-OPS] Shell openPath returned error:', result);
          return { success: false, error: result };
        }

        logger.info('[FILE-OPS] Opened file:', validation.normalizedPath);
        return { success: true };
      } catch (error) {
        logger.error('[FILE-OPS] Error opening file:', error);
        return { success: false, error: error.message };
      }
    })
  );

  // Reveal file in file explorer
  ipcMain.handle(
    IPC_CHANNELS.FILES.REVEAL_FILE,
    withErrorLogging(logger, async (event, filePath) => {
      try {
        // SECURITY FIX: Validate path before revealing
        if (!filePath || typeof filePath !== 'string') {
          return {
            success: false,
            error: 'Invalid file path provided',
            errorCode: 'INVALID_PATH'
          };
        }

        const validation = await validateFileOperationPath(filePath, {
          checkSymlinks: true
        });

        if (!validation.valid) {
          logger.warn('[FILE-OPS] Reveal file path validation failed', {
            filePath,
            error: validation.error
          });
          return {
            success: false,
            error: validation.error,
            errorCode: 'INVALID_PATH'
          };
        }

        // Verify file exists before trying to reveal
        try {
          await fs.access(validation.normalizedPath);
        } catch {
          return {
            success: false,
            error: 'File not found or inaccessible',
            errorCode: 'FILE_NOT_FOUND'
          };
        }

        shell.showItemInFolder(validation.normalizedPath);
        logger.info('[FILE-OPS] Revealed file in folder:', validation.normalizedPath);
        return { success: true };
      } catch (error) {
        logger.error('[FILE-OPS] Error revealing file:', error);
        return { success: false, error: error.message };
      }
    })
  );
}

module.exports = { registerShellHandlers };
