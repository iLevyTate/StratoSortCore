/**
 * Default Settings Configuration
 * Single source of truth for all default settings
 */

const { CONCURRENCY } = require('./performanceConstants');
const { AI_DEFAULTS, DEFAULT_AI_MODELS, SETTINGS_SCHEMA_VERSION } = require('./constants');
const { DEFAULT_CHAT_PERSONA_ID } = require('./chatPersonas');

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
  // Organization Confidence Threshold (files must meet this confidence to be auto-organized to suggested folder)
  // Files below this threshold are routed to "Uncategorized" for manual review
  confidenceThreshold: 0.75,
  // Smart folder routing mode: auto-select based on embedding health
  smartFolderRoutingMode: 'auto',
  // Naming convention defaults (used by auto-organize / download watcher)
  namingConvention: 'subject-date',
  dateFormat: 'YYYY-MM-DD',
  caseConvention: 'kebab-case',
  separator: '-',
  // AI - model defaults imported from constants.js for single source of truth
  textModel: DEFAULT_AI_MODELS.TEXT_ANALYSIS,
  visionModel: DEFAULT_AI_MODELS.IMAGE_ANALYSIS,
  embeddingModel: DEFAULT_AI_MODELS.EMBEDDING,
  // Llama-specific tuning (in-process)
  llamaGpuLayers: AI_DEFAULTS?.TEXT?.GPU_LAYERS ?? -1,
  llamaContextSize: AI_DEFAULTS?.TEXT?.CONTEXT_SIZE ?? 8192,
  // Vector DB persistence (relative to userData)
  vectorDbPersistPath: 'vector-db',
  // Settings schema version for migrations
  settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
  // Embedding workflow controls
  // - during_analysis: embed while analyzing (current/default)
  // - after_organize: defer file embeddings until after moves/renames
  // - manual: never auto-embed; user can rebuild manually
  embeddingTiming: 'during_analysis',
  // Default policy for newly analyzed files (per-file overrides can be set later)
  // - embed: normal local embeddings
  // - web_only: do not embed locally (intended for web-search-only workflows)
  // - skip: do not embed
  defaultEmbeddingPolicy: 'embed',
  // Embedding scope: which files should be embedded
  // - all_analyzed: embed every file that passes analysis (broadest search coverage)
  // - smart_folders_only: only embed files residing in a configured smart folder
  embeddingScope: 'all_analyzed',
  chatPersona: DEFAULT_CHAT_PERSONA_ID,
  chatResponseMode: 'fast',
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

  // Chunking: auto-generate chunk embeddings during file analysis.
  // Enabled by default to improve chat/document retrieval depth out of the box.
  autoChunkOnAnalysis: true,
  // Graph-aware retrieval (GraphRAG-lite)
  graphExpansionEnabled: true,
  graphExpansionWeight: 0.2,
  graphExpansionMaxNeighbors: 120,
  chunkContextEnabled: true,
  chunkContextMaxNeighbors: 1
};

/**
 * FIX Bug 23: Merge user settings with defaults, applying type validation.
 *
 * When a user override has the wrong type (e.g., a string where a number is expected),
 * that key is dropped and the default value is used instead. This prevents invalid
 * configurations from propagating through the application.
 *
 * @param {Object} overrides - User-provided settings overrides
 * @returns {Object} Merged settings with type-safe values
 */
function mergeWithDefaults(overrides) {
  if (!overrides || typeof overrides !== 'object') {
    return { ...DEFAULT_SETTINGS };
  }

  const merged = { ...DEFAULT_SETTINGS };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) {
      // Preserve explicit null (e.g., lastBrowsedPath: null)
      if (value === null && key in DEFAULT_SETTINGS) {
        merged[key] = value;
      }
      continue;
    }

    const defaultValue = DEFAULT_SETTINGS[key];

    // If no default exists, this is an unknown key -- pass it through
    if (defaultValue === undefined || defaultValue === null) {
      merged[key] = value;
      continue;
    }

    // Type-check: ensure the override matches the default's type
    if (typeof value !== typeof defaultValue) {
      // Type mismatch -- discard the override, keeping the default
      try {
        const { createLogger } = require('./logger');
        createLogger('DefaultSettings').warn(
          '[DefaultSettings] Type mismatch for setting, using default',
          {
            key,
            expected: typeof defaultValue,
            got: typeof value
          }
        );
      } catch {
        // Logger may not be available in all contexts
      }
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

module.exports = {
  DEFAULT_SETTINGS,
  mergeWithDefaults
};
