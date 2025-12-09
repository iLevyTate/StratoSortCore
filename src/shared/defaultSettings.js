/**
 * Default Settings Configuration
 * Single source of truth for all default settings
 */

const { SERVICE_URLS } = require('./configDefaults');

const DEFAULT_SETTINGS = {
  // UI
  theme: 'system',
  notifications: true,
  // Behavior
  defaultSmartFolderLocation: 'Documents',
  maxConcurrentAnalysis: 3,
  autoOrganize: false,
  backgroundMode: false,
  // Organization Confidence Thresholds
  autoApproveThreshold: 0.8,
  downloadConfidenceThreshold: 0.9,
  reviewThreshold: 0.5,
  // AI
  ollamaHost: SERVICE_URLS.OLLAMA_HOST,
  textModel: 'llama3.2:latest',
  visionModel: 'llava:latest',
  embeddingModel: 'mxbai-embed-large',
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
  saveDebounceMs: 1000, // Debounce delay for auto-save
};

module.exports = {
  DEFAULT_SETTINGS,
};
