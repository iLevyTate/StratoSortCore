/**
 * Files IPC Handlers
 *
 * Composed module that registers all file-related IPC handlers.
 * Maintains backward compatibility with the original registerFilesIpc interface.
 *
 * @module ipc/files
 */

const { registerFileSelectionHandlers } = require('./fileSelectionHandlers');
const { registerFileOperationHandlers } = require('./fileOperationHandlers');
const { registerFolderHandlers } = require('./folderHandlers');
const { registerShellHandlers } = require('./shellHandlers');

// Re-export batch handler components for direct access if needed
const {
  handleBatchOrganize,
  computeFileChecksum,
  MAX_BATCH_SIZE,
  MAX_TOTAL_BATCH_TIME
} = require('./batchOrganizeHandler');

/**
 * Register all file-related IPC handlers
 *
 * @param {Object} params - Registration parameters
 * @param {Object} params.ipcMain - Electron IPC main
 * @param {Object} params.IPC_CHANNELS - IPC channel constants
 * @param {Object} params.logger - Logger instance
 * @param {Object} params.dialog - Electron dialog module
 * @param {Object} params.shell - Electron shell module
 * @param {Function} params.getMainWindow - Function to get main window
 * @param {Function} params.getServiceIntegration - Function to get service integration
 */
function registerFilesIpc({
  ipcMain,
  IPC_CHANNELS,
  logger,
  dialog,
  shell,
  getMainWindow,
  getServiceIntegration
}) {
  // Register file selection handlers (SELECT dialog)
  registerFileSelectionHandlers({
    ipcMain,
    IPC_CHANNELS,
    logger,
    dialog,
    getMainWindow
  });

  // Register file operation handlers (PERFORM_OPERATION, DELETE_FILE, COPY_FILE)
  registerFileOperationHandlers({
    ipcMain,
    IPC_CHANNELS,
    logger,
    getServiceIntegration,
    getMainWindow
  });

  // Register folder handlers (OPEN_FOLDER, DELETE_FOLDER)
  registerFolderHandlers({
    ipcMain,
    IPC_CHANNELS,
    shell
  });

  // Register shell handlers (OPEN_FILE, REVEAL_FILE)
  registerShellHandlers({
    ipcMain,
    IPC_CHANNELS,
    shell
  });
}

module.exports = registerFilesIpc;

// Also export individual components for flexibility
module.exports.registerFilesIpc = registerFilesIpc;
module.exports.registerFileSelectionHandlers = registerFileSelectionHandlers;
module.exports.registerFileOperationHandlers = registerFileOperationHandlers;
module.exports.registerFolderHandlers = registerFolderHandlers;
module.exports.registerShellHandlers = registerShellHandlers;
module.exports.handleBatchOrganize = handleBatchOrganize;
module.exports.computeFileChecksum = computeFileChecksum;
module.exports.MAX_BATCH_SIZE = MAX_BATCH_SIZE;
module.exports.MAX_TOTAL_BATCH_TIME = MAX_TOTAL_BATCH_TIME;
