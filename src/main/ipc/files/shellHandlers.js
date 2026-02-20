/**
 * Shell Operation Handlers
 *
 * Simple file/folder shell operations (open, reveal).
 *
 * @module ipc/files/shellHandlers
 */

const fs = require('fs').promises;
const { createHandler, safeHandle, z } = require('../ipcWrappers');
const { createLogger } = require('../../../shared/logger');
const { validateFileOperationPath } = require('../../../shared/pathSanitization');

const logger = createLogger('IPC:Files:Shell');
const schemaFilePath = z ? z.string().min(1) : null;
const { IpcServiceContext, createFromLegacyParams } = require('../IpcServiceContext');

/**
 * Register shell operation IPC handlers
 *
 * @param {IpcServiceContext|Object} servicesOrParams - Service context or legacy parameters
 */
function registerShellHandlers(servicesOrParams) {
  let container;
  if (servicesOrParams instanceof IpcServiceContext) {
    container = servicesOrParams;
  } else {
    container = createFromLegacyParams(servicesOrParams);
  }

  const { ipcMain, IPC_CHANNELS } = container.core;
  const { shell } = container.electron;

  // Open file with default application
  safeHandle(
    ipcMain,
    IPC_CHANNELS.FILES.OPEN_FILE,
    createHandler({
      logger,
      context: 'ShellOps',
      schema: schemaFilePath,
      handler: async (event, filePath) => {
        try {
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
      }
    })
  );

  // Reveal file in file explorer
  safeHandle(
    ipcMain,
    IPC_CHANNELS.FILES.REVEAL_FILE,
    createHandler({
      logger,
      context: 'ShellOps',
      schema: schemaFilePath,
      handler: async (event, filePath) => {
        try {
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
      }
    })
  );
}

module.exports = { registerShellHandlers };
