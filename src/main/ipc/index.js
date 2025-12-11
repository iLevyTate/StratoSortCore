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
const { ServiceContainer, createFromLegacyParams } = require('./ServiceContainer');

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
 * Register all IPC handlers using either a ServiceContainer or legacy parameters
 *
 * @param {ServiceContainer|Object} servicesOrParams - Either a ServiceContainer instance
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
  // Support both ServiceContainer and legacy parameters
  let container;
  if (servicesOrParams instanceof ServiceContainer) {
    container = servicesOrParams;
  } else {
    container = createFromLegacyParams(servicesOrParams);
  }

  // Validate container
  const validation = container.validate();
  if (!validation.valid) {
    throw new Error(`ServiceContainer missing required services: ${validation.missing.join(', ')}`);
  }

  // Extract commonly used services for local use
  const { ipcMain, IPC_CHANNELS, logger } = container.core;
  const { dialog, shell, getMainWindow } = container.electron || {};
  const { getCustomFolders, setCustomFolders, saveCustomFolders, scanDirectory } =
    container.folders || {};
  const { analyzeDocumentFile, analyzeImageFile, tesseract } = container.analysis || {};
  const {
    getOllama,
    getOllamaModel,
    getOllamaVisionModel,
    getOllamaEmbeddingModel,
    getOllamaHost,
    setOllamaHost,
    setOllamaModel,
    setOllamaVisionModel,
    setOllamaEmbeddingModel,
    buildOllamaOptions
  } = container.ollama || {};
  const { settingsService, onSettingsChanged } = container.settings || {};
  const systemAnalytics = container.systemAnalytics;
  const getServiceIntegration = container.getServiceIntegration;

  // Register individual IPC handlers
  registerFilesIpc({
    ipcMain,
    IPC_CHANNELS,
    logger,
    dialog,
    shell,
    getMainWindow,
    getServiceIntegration
  });
  registerSmartFoldersIpc({
    ipcMain,
    IPC_CHANNELS,
    logger,
    getCustomFolders,
    setCustomFolders,
    saveCustomFolders,
    buildOllamaOptions,
    getOllamaModel,
    getOllamaEmbeddingModel,
    scanDirectory
  });
  registerUndoRedoIpc({ ipcMain, IPC_CHANNELS, logger, getServiceIntegration });
  registerAnalysisHistoryIpc({
    ipcMain,
    IPC_CHANNELS,
    logger,
    getServiceIntegration
  });
  registerSystemIpc({
    ipcMain,
    IPC_CHANNELS,
    logger,
    systemAnalytics,
    getServiceIntegration
  });
  registerOllamaIpc({
    ipcMain,
    IPC_CHANNELS,
    logger,
    systemAnalytics,
    getMainWindow,
    getOllama,
    getOllamaModel,
    getOllamaVisionModel,
    getOllamaEmbeddingModel,
    getOllamaHost
  });
  registerAnalysisIpc({
    ipcMain,
    IPC_CHANNELS,
    logger,
    tesseract,
    systemAnalytics,
    analyzeDocumentFile,
    analyzeImageFile,
    getServiceIntegration,
    getCustomFolders
  });
  registerSettingsIpc({
    ipcMain,
    IPC_CHANNELS,
    logger,
    settingsService,
    setOllamaHost,
    setOllamaModel,
    setOllamaVisionModel,
    setOllamaEmbeddingModel,
    onSettingsChanged
  });
  registerEmbeddingsIpc({
    ipcMain,
    IPC_CHANNELS,
    logger,
    getCustomFolders,
    getServiceIntegration
  });
  registerWindowIpc({ ipcMain, IPC_CHANNELS, logger, getMainWindow });
  registerChromaDBIpc({
    ipcMain,
    IPC_CHANNELS,
    logger,
    getMainWindow
  });

  // Register suggestions IPC - ALWAYS register handlers even if services unavailable
  // Handlers will gracefully handle missing services and return appropriate errors
  if (getServiceIntegration) {
    const serviceIntegration = getServiceIntegration();

    // Get services (may be null if ChromaDB unavailable)
    const chromaDbService = serviceIntegration?.chromaDbService || null;
    const folderMatchingService = serviceIntegration?.folderMatchingService || null;

    if (!chromaDbService || !folderMatchingService) {
      logger.warn(
        '[IPC] Some services unavailable (ChromaDB or FolderMatching), suggestions will have limited functionality'
      );
    }

    // CRITICAL FIX: Always register handlers to prevent "No handler registered" errors
    // Handlers will check for null services and return graceful errors
    registerSuggestionsIpc({
      ipcMain,
      IPC_CHANNELS,
      chromaDbService,
      folderMatchingService,
      settingsService,
      getCustomFolders
    });

    // Register organize IPC - ALWAYS register handlers
    registerOrganizeIpc({
      ipcMain,
      IPC_CHANNELS,
      getServiceIntegration,
      getCustomFolders
    });

    logger.info('[IPC] Suggestions and organize handlers registered');
  } else {
    // FIX: Register fallback handlers even when services are unavailable
    // This prevents "No handler registered" errors in the renderer
    logger.error('[IPC] getServiceIntegration not provided, registering fallback handlers');

    // Register fallback suggestions handlers
    registerSuggestionsIpc({
      ipcMain,
      IPC_CHANNELS,
      chromaDbService: null,
      folderMatchingService: null,
      settingsService: null,
      getCustomFolders: () => []
    });

    // Register fallback organize handlers
    registerOrganizeIpc({
      ipcMain,
      IPC_CHANNELS,
      getServiceIntegration: () => null,
      getCustomFolders: () => []
    });

    logger.warn('[IPC] Fallback handlers registered - functionality will be limited');
  }
}

module.exports = {
  // Main registration function
  registerAllIpc,

  // Service container utilities
  ServiceContainer,
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
