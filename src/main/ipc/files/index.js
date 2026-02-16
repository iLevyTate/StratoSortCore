/**
 * Files IPC Handlers
 *
 * Composed module that registers all file-related IPC handlers.
 * Maintains backward compatibility with the original registerFilesIpc interface.
 *
 * @module ipc/files
 */

const { IpcServiceContext, createFromLegacyParams } = require('../IpcServiceContext');
const { registerFileSelectionHandlers } = require('./fileSelectionHandlers');
const { registerFileOperationHandlers } = require('./fileOperationHandlers');
const { registerFolderHandlers } = require('./folderHandlers');
const { registerShellHandlers } = require('./shellHandlers');
const { registerTaggingHandlers } = require('./taggingHandlers');

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
 * @param {IpcServiceContext|Object} servicesOrParams - Service context or legacy parameters
 */
function registerFilesIpc(servicesOrParams) {
  let container;
  if (servicesOrParams instanceof IpcServiceContext) {
    container = servicesOrParams;
  } else {
    container = createFromLegacyParams(servicesOrParams);
  }

  // Register file selection handlers (SELECT dialog)
  registerFileSelectionHandlers(container);

  // Register file operation handlers (PERFORM_OPERATION, DELETE_FILE, COPY_FILE)
  registerFileOperationHandlers(container);

  // Register folder handlers (OPEN_FOLDER, DELETE_FOLDER)
  registerFolderHandlers(container);

  // Register shell handlers (OPEN_FILE, REVEAL_FILE)
  registerShellHandlers(container);

  // Register tagging handlers (ADD_TAGS)
  registerTaggingHandlers(container);
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
