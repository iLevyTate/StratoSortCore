/**
 * Service Container for IPC Handlers
 *
 * Groups related dependencies into logical service containers to reduce
 * coupling and make dependency management more maintainable.
 *
 * This pattern replaces the 28-parameter function signature with
 * organized service groups that are easier to test and modify.
 */

/**
 * @typedef {Object} CoreServices
 * @property {Object} ipcMain - Electron IPC main module
 * @property {Object} IPC_CHANNELS - IPC channel constants
 * @property {Object} logger - Logger instance
 */

/**
 * @typedef {Object} ElectronServices
 * @property {Object} dialog - Electron dialog API
 * @property {Object} shell - Electron shell API
 * @property {Function} getMainWindow - Function to get main BrowserWindow
 */

/**
 * @typedef {Object} FolderServices
 * @property {Function} getCustomFolders - Get custom folders
 * @property {Function} setCustomFolders - Set custom folders
 * @property {Function} saveCustomFolders - Persist custom folders
 * @property {Function} scanDirectory - Scan directory for files
 */

/**
 * @typedef {Object} AnalysisServices
 * @property {Function} analyzeDocumentFile - Document analysis function
 * @property {Function} analyzeImageFile - Image analysis function
 * @property {Object} tesseract - Tesseract OCR library
 */

/**
 * @typedef {Object} OllamaConfig
 * @property {Function} getOllama - Get Ollama client
 * @property {Function} getOllamaHost - Get Ollama host
 * @property {Function} setOllamaHost - Set Ollama host
 * @property {Function} getOllamaModel - Get text model
 * @property {Function} setOllamaModel - Set text model
 * @property {Function} getOllamaVisionModel - Get vision model
 * @property {Function} setOllamaVisionModel - Set vision model
 * @property {Function} getOllamaEmbeddingModel - Get embedding model
 * @property {Function} setOllamaEmbeddingModel - Set embedding model
 * @property {Function} buildOllamaOptions - Build performance options
 */

/**
 * @typedef {Object} SettingsServices
 * @property {Object} settingsService - Settings service instance
 * @property {Function} onSettingsChanged - Settings change callback
 */

/**
 * Service Container class that organizes dependencies into logical groups
 */
class ServiceContainer {
  constructor() {
    this._core = null;
    this._electron = null;
    this._folders = null;
    this._analysis = null;
    this._ollama = null;
    this._settings = null;
    this._systemAnalytics = null;
    this._serviceIntegration = null;
  }

  /**
   * Set core services (ipcMain, IPC_CHANNELS, logger)
   * @param {CoreServices} services
   */
  setCore(services) {
    this._core = services;
    return this;
  }

  /**
   * Set Electron-specific services (dialog, shell, window management)
   * @param {ElectronServices} services
   */
  setElectron(services) {
    this._electron = services;
    return this;
  }

  /**
   * Set folder management services
   * @param {FolderServices} services
   */
  setFolders(services) {
    this._folders = services;
    return this;
  }

  /**
   * Set analysis services (document, image, OCR)
   * @param {AnalysisServices} services
   */
  setAnalysis(services) {
    this._analysis = services;
    return this;
  }

  /**
   * Set Ollama configuration services
   * @param {OllamaConfig} config
   */
  setOllama(config) {
    this._ollama = config;
    return this;
  }

  /**
   * Set settings services
   * @param {SettingsServices} services
   */
  setSettings(services) {
    this._settings = services;
    return this;
  }

  /**
   * Set system analytics instance
   * @param {Object} analytics
   */
  setSystemAnalytics(analytics) {
    this._systemAnalytics = analytics;
    return this;
  }

  /**
   * Set service integration getter
   * @param {Function} getter
   */
  setServiceIntegration(getter) {
    this._serviceIntegration = getter;
    return this;
  }

  // Getters for each service group
  get core() {
    return this._core;
  }
  get electron() {
    return this._electron;
  }
  get folders() {
    return this._folders;
  }
  get analysis() {
    return this._analysis;
  }
  get ollama() {
    return this._ollama;
  }
  get settings() {
    return this._settings;
  }
  get systemAnalytics() {
    return this._systemAnalytics;
  }
  get getServiceIntegration() {
    return this._serviceIntegration;
  }

  /**
   * Get a service by name (for backward compatibility)
   * @param {string} name - Service name
   * @returns {*} The requested service or null
   */
  get(name) {
    switch (name) {
      case 'ipcMain':
        return this._core?.ipcMain;
      case 'IPC_CHANNELS':
        return this._core?.IPC_CHANNELS;
      case 'logger':
        return this._core?.logger;
      case 'dialog':
        return this._electron?.dialog;
      case 'shell':
        return this._electron?.shell;
      case 'getMainWindow':
        return this._electron?.getMainWindow;
      case 'systemAnalytics':
        return this._systemAnalytics;
      case 'getServiceIntegration':
        return this._serviceIntegration;
      case 'getCustomFolders':
        return this._folders?.getCustomFolders;
      case 'setCustomFolders':
        return this._folders?.setCustomFolders;
      case 'saveCustomFolders':
        return this._folders?.saveCustomFolders;
      case 'scanDirectory':
        return this._folders?.scanDirectory;
      case 'analyzeDocumentFile':
        return this._analysis?.analyzeDocumentFile;
      case 'analyzeImageFile':
        return this._analysis?.analyzeImageFile;
      case 'tesseract':
        return this._analysis?.tesseract;
      case 'settingsService':
        return this._settings?.settingsService;
      case 'onSettingsChanged':
        return this._settings?.onSettingsChanged;
      default:
        // Check Ollama config
        if (this._ollama && name in this._ollama) {
          return this._ollama[name];
        }
        return null;
    }
  }

  /**
   * Check if the container has all required services
   * @returns {Object} Validation result with missing services
   */
  validate() {
    const missing = [];
    const warnings = [];

    if (!this._core?.ipcMain) missing.push('ipcMain');
    if (!this._core?.IPC_CHANNELS) missing.push('IPC_CHANNELS');
    if (!this._core?.logger) missing.push('logger');

    if (!this._electron?.getMainWindow) warnings.push('getMainWindow');
    if (!this._serviceIntegration) warnings.push('getServiceIntegration');

    return {
      valid: missing.length === 0,
      missing,
      warnings
    };
  }

  /**
   * Create parameters object for legacy IPC handler functions
   * This provides backward compatibility during migration
   * @returns {Object} Legacy parameters object
   */
  toLegacyParams() {
    return {
      // Core
      ipcMain: this._core?.ipcMain,
      IPC_CHANNELS: this._core?.IPC_CHANNELS,
      logger: this._core?.logger,
      // Electron
      dialog: this._electron?.dialog,
      shell: this._electron?.shell,
      getMainWindow: this._electron?.getMainWindow,
      // Analytics
      systemAnalytics: this._systemAnalytics,
      // Service integration
      getServiceIntegration: this._serviceIntegration,
      // Folders
      getCustomFolders: this._folders?.getCustomFolders,
      setCustomFolders: this._folders?.setCustomFolders,
      saveCustomFolders: this._folders?.saveCustomFolders,
      scanDirectory: this._folders?.scanDirectory,
      // Analysis
      analyzeDocumentFile: this._analysis?.analyzeDocumentFile,
      analyzeImageFile: this._analysis?.analyzeImageFile,
      tesseract: this._analysis?.tesseract,
      // Ollama
      getOllama: this._ollama?.getOllama,
      getOllamaHost: this._ollama?.getOllamaHost,
      setOllamaHost: this._ollama?.setOllamaHost,
      getOllamaModel: this._ollama?.getOllamaModel,
      setOllamaModel: this._ollama?.setOllamaModel,
      getOllamaVisionModel: this._ollama?.getOllamaVisionModel,
      setOllamaVisionModel: this._ollama?.setOllamaVisionModel,
      getOllamaEmbeddingModel: this._ollama?.getOllamaEmbeddingModel,
      setOllamaEmbeddingModel: this._ollama?.setOllamaEmbeddingModel,
      buildOllamaOptions: this._ollama?.buildOllamaOptions,
      // Settings
      settingsService: this._settings?.settingsService,
      onSettingsChanged: this._settings?.onSettingsChanged
    };
  }
}

/**
 * Factory function to create a ServiceContainer from legacy parameters
 * @param {Object} params - Legacy 28-parameter object
 * @returns {ServiceContainer} Configured service container
 */
function createFromLegacyParams(params) {
  return new ServiceContainer()
    .setCore({
      ipcMain: params.ipcMain,
      IPC_CHANNELS: params.IPC_CHANNELS,
      logger: params.logger
    })
    .setElectron({
      dialog: params.dialog,
      shell: params.shell,
      getMainWindow: params.getMainWindow
    })
    .setFolders({
      getCustomFolders: params.getCustomFolders,
      setCustomFolders: params.setCustomFolders,
      saveCustomFolders: params.saveCustomFolders,
      scanDirectory: params.scanDirectory
    })
    .setAnalysis({
      analyzeDocumentFile: params.analyzeDocumentFile,
      analyzeImageFile: params.analyzeImageFile,
      tesseract: params.tesseract
    })
    .setOllama({
      getOllama: params.getOllama,
      getOllamaHost: params.getOllamaHost,
      setOllamaHost: params.setOllamaHost,
      getOllamaModel: params.getOllamaModel,
      setOllamaModel: params.setOllamaModel,
      getOllamaVisionModel: params.getOllamaVisionModel,
      setOllamaVisionModel: params.setOllamaVisionModel,
      getOllamaEmbeddingModel: params.getOllamaEmbeddingModel,
      setOllamaEmbeddingModel: params.setOllamaEmbeddingModel,
      buildOllamaOptions: params.buildOllamaOptions
    })
    .setSettings({
      settingsService: params.settingsService,
      onSettingsChanged: params.onSettingsChanged
    })
    .setSystemAnalytics(params.systemAnalytics)
    .setServiceIntegration(params.getServiceIntegration);
}

module.exports = {
  ServiceContainer,
  createFromLegacyParams
};
