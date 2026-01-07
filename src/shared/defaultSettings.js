/**
 * Default Settings Configuration
 * Single source of truth for all default settings
 */

const { SERVICE_URLS } = require('./configDefaults');
const { CONCURRENCY } = require('./performanceConstants');
const { DEFAULT_AI_MODELS } = require('./constants');

const DEFAULT_SETTINGS = {
  // UI
  notifications: true,
  // Notification display options - where to show notifications
  // 'both' = UI toast + system tray, 'ui' = UI only, 'tray' = tray only, 'none' = disabled
  notificationMode: 'both',
  // Notify when files are analyzed by watchers (smart folder/download)
  notifyOnAutoAnalysis: true,
  // Notify when files don't meet confidence threshold for auto-organization
  notifyOnLowConfidence: true,
  // Behavior
  defaultSmartFolderLocation: 'Documents',
  // Last browsed path - remembers the last folder opened in file dialogs
  lastBrowsedPath: null,
  maxConcurrentAnalysis: CONCURRENCY.DEFAULT_WORKERS,
  autoOrganize: false,
  backgroundMode: false,
  launchOnStartup: false,
  // Organization Confidence Threshold (files must meet this confidence to be auto-organized)
  confidenceThreshold: 0.75,
  // Naming convention defaults (used by auto-organize / download watcher)
  namingConvention: 'subject-date',
  dateFormat: 'YYYY-MM-DD',
  caseConvention: 'kebab-case',
  separator: '-',
  // AI - model defaults imported from constants.js for single source of truth
  ollamaHost: SERVICE_URLS.OLLAMA_HOST,
  textModel: DEFAULT_AI_MODELS.TEXT_ANALYSIS,
  visionModel: DEFAULT_AI_MODELS.IMAGE_ANALYSIS,
  embeddingModel: DEFAULT_AI_MODELS.EMBEDDING,
  // Dependency lifecycle management (user consent required)
  autoUpdateOllama: false,
  autoUpdateChromaDb: false,
  // First-run UX
  dependencyWizardShown: false,
  // Re-prompt cadence (only used when dependencies are still missing)
  dependencyWizardLastPromptAt: null, // ISO string
  dependencyWizardPromptIntervalDays: 7,
  // File Size Limits (in bytes)
  maxFileSize: 100 * 1024 * 1024, // 100MB default
  maxImageFileSize: 100 * 1024 * 1024, // 100MB
  maxDocumentFileSize: 200 * 1024 * 1024, // 200MB
  maxTextFileSize: 50 * 1024 * 1024, // 50MB
  // Processing Limits
  analysisTimeout: 60000, // 60 seconds
  fileOperationTimeout: 10000, // 10 seconds
  maxBatchSize: 100, // Max files per batch
  retryAttempts: 3, // Number of retry attempts for failed operations
  // UI Limits
  workflowRestoreMaxAge: 60 * 60 * 1000, // 1 hour - how long to keep workflow state
  saveDebounceMs: 1000 // Debounce delay for auto-save
};

module.exports = {
  DEFAULT_SETTINGS
};
