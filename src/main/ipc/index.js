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

function registerAllIpc({
  ipcMain,
  IPC_CHANNELS,
  logger,
  dialog,
  shell,
  systemAnalytics,
  getMainWindow,
  getServiceIntegration,
  getCustomFolders,
  setCustomFolders,
  saveCustomFolders,
  analyzeDocumentFile,
  analyzeImageFile,
  tesseract,
  getOllama,
  getOllamaModel,
  getOllamaVisionModel,
  getOllamaEmbeddingModel,
  getOllamaHost,
  buildOllamaOptions,
  scanDirectory,
  settingsService,
  setOllamaHost,
  setOllamaModel,
  setOllamaVisionModel,
  setOllamaEmbeddingModel,
  onSettingsChanged,
}) {
  registerFilesIpc({
    ipcMain,
    IPC_CHANNELS,
    logger,
    dialog,
    shell,
    getMainWindow,
    getServiceIntegration,
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
    scanDirectory,
  });
  registerUndoRedoIpc({ ipcMain, IPC_CHANNELS, logger, getServiceIntegration });
  registerAnalysisHistoryIpc({
    ipcMain,
    IPC_CHANNELS,
    logger,
    getServiceIntegration,
  });
  registerSystemIpc({
    ipcMain,
    IPC_CHANNELS,
    logger,
    systemAnalytics,
    getServiceIntegration,
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
    getOllamaHost,
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
    getCustomFolders,
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
    onSettingsChanged,
  });
  registerEmbeddingsIpc({
    ipcMain,
    IPC_CHANNELS,
    logger,
    getCustomFolders,
    getServiceIntegration,
  });
  registerWindowIpc({ ipcMain, IPC_CHANNELS, logger, getMainWindow });

  // Register suggestions IPC - ALWAYS register handlers even if services unavailable
  // Handlers will gracefully handle missing services and return appropriate errors
  if (getServiceIntegration) {
    const serviceIntegration = getServiceIntegration();

    // Get services (may be null if ChromaDB unavailable)
    const chromaDbService = serviceIntegration?.chromaDbService || null;
    const folderMatchingService =
      serviceIntegration?.folderMatchingService || null;

    if (!chromaDbService || !folderMatchingService) {
      logger.warn(
        '[IPC] Some services unavailable (ChromaDB or FolderMatching), suggestions will have limited functionality',
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
      getCustomFolders,
    });

    // Register organize IPC - ALWAYS register handlers
    registerOrganizeIpc({
      ipcMain,
      IPC_CHANNELS,
      getServiceIntegration,
      getCustomFolders,
    });

    logger.info('[IPC] Suggestions and organize handlers registered');
  } else {
    // FIX: Register fallback handlers even when services are unavailable
    // This prevents "No handler registered" errors in the renderer
    logger.error(
      '[IPC] getServiceIntegration not provided, registering fallback handlers',
    );

    // Register fallback suggestions handlers
    registerSuggestionsIpc({
      ipcMain,
      IPC_CHANNELS,
      chromaDbService: null,
      folderMatchingService: null,
      settingsService: null,
      getCustomFolders: () => [],
    });

    // Register fallback organize handlers
    registerOrganizeIpc({
      ipcMain,
      IPC_CHANNELS,
      getServiceIntegration: () => null,
      getCustomFolders: () => [],
    });

    logger.warn(
      '[IPC] Fallback handlers registered - functionality will be limited',
    );
  }
}

module.exports = { registerAllIpc };
