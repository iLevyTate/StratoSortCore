const registerFilesIpc = require('./files');
const registerSmartFoldersIpc = require('./smartFolders');
const registerUndoRedoIpc = require('./undoRedo');
const registerAnalysisHistoryIpc = require('./analysisHistory');
const registerSystemIpc = require('./system');
const registerOllamaIpc = require('./ollama');
const registerAnalysisIpc = require('./analysis');
const registerSettingsIpc = require('./settings');
const registerEmbeddingsIpc = require('./semantic');
const registerWindowIpc = require('./window');
const { registerSuggestionsIpc } = require('./suggestions');
const { registerOrganizeIpc } = require('./organize');
const { registerChromaDBIpc } = require('./chromadb');
const { registerDependenciesIpc } = require('./dependencies');
const registerChatIpc = require('./chat');
const registerKnowledgeIpc = require('./knowledge');
const { IpcServiceContext, createFromLegacyParams } = require('./IpcServiceContext');

// Export IPC utilities for handler creation
const {
  createHandler,
  registerHandlers,
  withErrorLogging,
  withValidation,
  withServiceCheck,
  createErrorResponse,
  createSuccessResponse,
  ERROR_CODES
} = require('./ipcWrappers');
const { schemas, z } = require('./validationSchemas');

/**
 * Register all IPC handlers using either an IpcServiceContext or legacy parameters
 *
 * @param {IpcServiceContext|Object} servicesOrParams - Either an IpcServiceContext instance
 *   or a legacy parameters object with individual service properties
 *
 * Legacy parameters (for backward compatibility):
 * @param {Object} servicesOrParams.ipcMain - Electron IPC main
 * @param {Object} servicesOrParams.IPC_CHANNELS - IPC channel constants
 * @param {Object} servicesOrParams.logger - Logger instance
 * @param {Object} servicesOrParams.dialog - Electron dialog
 * @param {Object} servicesOrParams.shell - Electron shell
 * @param {Object} servicesOrParams.systemAnalytics - System analytics
 * @param {Function} servicesOrParams.getMainWindow - Get main window
 * @param {Function} servicesOrParams.getServiceIntegration - Get service integration
 * @param {Function} servicesOrParams.getCustomFolders - Get custom folders
 * @param {Function} servicesOrParams.setCustomFolders - Set custom folders
 * @param {Function} servicesOrParams.saveCustomFolders - Save custom folders
 * @param {Function} servicesOrParams.analyzeDocumentFile - Analyze document
 * @param {Function} servicesOrParams.analyzeImageFile - Analyze image
 * @param {Object} servicesOrParams.tesseract - Tesseract OCR
 * @param {Function} servicesOrParams.getOllama - Get Ollama client
 * @param {Function} servicesOrParams.getOllamaModel - Get text model
 * @param {Function} servicesOrParams.getOllamaVisionModel - Get vision model
 * @param {Function} servicesOrParams.getOllamaEmbeddingModel - Get embedding model
 * @param {Function} servicesOrParams.getOllamaHost - Get Ollama host
 * @param {Function} servicesOrParams.buildOllamaOptions - Build Ollama options
 * @param {Function} servicesOrParams.scanDirectory - Scan directory
 * @param {Object} servicesOrParams.settingsService - Settings service
 * @param {Function} servicesOrParams.setOllamaHost - Set Ollama host
 * @param {Function} servicesOrParams.setOllamaModel - Set text model
 * @param {Function} servicesOrParams.setOllamaVisionModel - Set vision model
 * @param {Function} servicesOrParams.setOllamaEmbeddingModel - Set embedding model
 * @param {Function} servicesOrParams.onSettingsChanged - Settings change callback
 */
function registerAllIpc(servicesOrParams) {
  // Support both IpcServiceContext and legacy parameters
  let container;
  if (servicesOrParams instanceof IpcServiceContext) {
    container = servicesOrParams;
  } else {
    container = createFromLegacyParams(servicesOrParams);
  }

  // Validate container
  const validation = container.validate();
  if (!validation.valid) {
    throw new Error(
      `IpcServiceContext missing required services: ${validation.missing.join(', ')}`
    );
  }

  const { logger } = container.core;

  // Register individual IPC handlers
  registerFilesIpc(container);
  registerSmartFoldersIpc(container);
  registerUndoRedoIpc(container);
  registerAnalysisHistoryIpc(container);
  registerSystemIpc(container);
  registerOllamaIpc(container);
  registerAnalysisIpc(container);
  registerSettingsIpc(container);
  registerEmbeddingsIpc(container);
  registerWindowIpc(container);
  registerChromaDBIpc(container);
  registerDependenciesIpc(container);
  registerChatIpc(container);
  registerKnowledgeIpc(container);

  // Register suggestions and organize handlers
  // These handlers manage their own service availability checks
  registerSuggestionsIpc(container);
  registerOrganizeIpc(container);

  logger.info('[IPC] All handlers registered via IpcServiceContext');
}

module.exports = {
  // Main registration function
  registerAllIpc,

  // IPC service context utilities
  IpcServiceContext,
  createFromLegacyParams,

  // IPC handler utilities
  createHandler,
  registerHandlers,
  withErrorLogging,
  withValidation,
  withServiceCheck,
  createErrorResponse,
  createSuccessResponse,
  ERROR_CODES,

  // Validation schemas
  schemas,
  z
};
