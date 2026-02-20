// Shared Constants
// Central source of truth for constants used across main and renderer processes

const { LIMITS: PERFORMANCE_LIMITS = {} } = require('./performanceConstants');

/**
 * IPC Channel Definitions
 */
const IPC_CHANNELS = {
  FILES: {
    SELECT: 'files:select',
    SELECT_DIRECTORY: 'files:select-directory',
    GET_DOCUMENTS_PATH: 'files:get-documents-path',
    CREATE_FOLDER_DIRECT: 'files:create-folder-direct',
    GET_FILE_STATS: 'files:get-stats',
    GET_FILES_IN_DIRECTORY: 'files:get-in-directory',
    PERFORM_OPERATION: 'files:perform-operation',
    DELETE_FILE: 'files:delete',
    OPEN_FILE: 'files:open',
    REVEAL_FILE: 'files:reveal',
    COPY_FILE: 'files:copy',
    OPEN_FOLDER: 'files:open-folder',
    DELETE_FOLDER: 'files:delete-folder',
    CLEANUP_ANALYSIS: 'files:cleanup-analysis',
    ADD_TAGS: 'files:add-tags'
  },
  SMART_FOLDERS: {
    GET: 'smart-folders:get',
    SAVE: 'smart-folders:save',
    UPDATE_CUSTOM: 'smart-folders:update-custom',
    GET_CUSTOM: 'smart-folders:get-custom',
    SCAN_STRUCTURE: 'smart-folders:scan-structure',
    ADD: 'smart-folders:add',
    EDIT: 'smart-folders:edit',
    DELETE: 'smart-folders:delete',
    MATCH: 'smart-folders:match',
    RESET_TO_DEFAULTS: 'smart-folders:reset-defaults',
    GENERATE_DESCRIPTION: 'smart-folders:generate-description',
    WATCHER_START: 'smart-folders:watcher-start',
    WATCHER_STOP: 'smart-folders:watcher-stop',
    WATCHER_STATUS: 'smart-folders:watcher-status',
    WATCHER_SCAN: 'smart-folders:watcher-scan'
  },
  ANALYSIS: {
    ANALYZE_DOCUMENT: 'analysis:analyze-document',
    ANALYZE_IMAGE: 'analysis:analyze-image',
    ANALYZE_BATCH: 'analysis:analyze-batch',
    EXTRACT_IMAGE_TEXT: 'analysis:extract-image-text'
  },
  SETTINGS: {
    GET: 'settings:get',
    SAVE: 'settings:save',
    GET_CONFIGURABLE_LIMITS: 'settings:get-limits',
    GET_LOGS_INFO: 'settings:get-logs-info',
    OPEN_LOGS_FOLDER: 'settings:open-logs-folder',
    EXPORT: 'settings:export',
    IMPORT: 'settings:import',
    CREATE_BACKUP: 'settings:create-backup',
    LIST_BACKUPS: 'settings:list-backups',
    RESTORE_BACKUP: 'settings:restore-backup',
    DELETE_BACKUP: 'settings:delete-backup'
  },
  // LLM service (node-llama-cpp - in-process)
  LLAMA: {
    GET_MODELS: 'llama:get-models',
    GET_CONFIG: 'llama:get-config',
    UPDATE_CONFIG: 'llama:update-config',
    TEST_CONNECTION: 'llama:test-connection',
    DOWNLOAD_MODEL: 'llama:download-model',
    DELETE_MODEL: 'llama:delete-model',
    GET_DOWNLOAD_STATUS: 'llama:get-download-status'
  },
  UNDO_REDO: {
    UNDO: 'undo-redo:undo',
    REDO: 'undo-redo:redo',
    GET_HISTORY: 'undo-redo:get-history',
    GET_STATE: 'undo-redo:get-state',
    CLEAR_HISTORY: 'undo-redo:clear',
    CAN_UNDO: 'undo-redo:can-undo',
    CAN_REDO: 'undo-redo:can-redo',
    STATE_CHANGED: 'undo-redo:state-changed'
  },
  ANALYSIS_HISTORY: {
    GET: 'analysis-history:get',
    SEARCH: 'analysis-history:search',
    GET_STATISTICS: 'analysis-history:get-statistics',
    GET_FILE_HISTORY: 'analysis-history:get-file-history',
    SET_EMBEDDING_POLICY: 'analysis-history:set-embedding-policy',
    CLEAR: 'analysis-history:clear',
    EXPORT: 'analysis-history:export'
  },
  EMBEDDINGS: {
    REBUILD_FOLDERS: 'embeddings:rebuild-folders',
    REBUILD_FILES: 'embeddings:rebuild-files',
    FULL_REBUILD: 'embeddings:full-rebuild',
    REANALYZE_ALL: 'embeddings:reanalyze-all',
    REANALYZE_FILE: 'embeddings:reanalyze-file',
    CLEAR_STORE: 'embeddings:clear-store',
    GET_STATS: 'embeddings:get-stats',
    SEARCH: 'embeddings:search',
    SCORE_FILES: 'embeddings:score-files',
    FIND_SIMILAR: 'embeddings:find-similar',
    REBUILD_BM25_INDEX: 'embeddings:rebuild-bm25',
    GET_SEARCH_STATUS: 'embeddings:get-search-status',
    DIAGNOSE_SEARCH: 'embeddings:diagnose-search',
    FIND_MULTI_HOP: 'embeddings:find-multi-hop',
    COMPUTE_CLUSTERS: 'embeddings:compute-clusters',
    GET_CLUSTERS: 'embeddings:get-clusters',
    GET_CLUSTER_MEMBERS: 'embeddings:get-cluster-members',
    GET_SIMILARITY_EDGES: 'embeddings:get-similarity-edges',
    GET_FILE_METADATA: 'embeddings:get-file-metadata',
    FIND_FILES_BY_PATHS: 'embeddings:find-files-by-paths',
    FIND_DUPLICATES: 'embeddings:find-duplicates',
    CLEAR_CLUSTERS: 'embeddings:clear-clusters'
  },
  SYSTEM: {
    GET_METRICS: 'system:get-metrics',
    GET_APPLICATION_STATISTICS: 'system:get-app-stats',
    APPLY_UPDATE: 'system:apply-update',
    CHECK_FOR_UPDATES: 'system:check-for-updates',
    GET_CONFIG: 'system:get-config',
    GET_CONFIG_VALUE: 'system:get-config-value',
    RENDERER_ERROR_REPORT: 'renderer-error-report',
    GET_RECOMMENDED_CONCURRENCY: 'system:get-recommended-concurrency',
    LOG: 'system:log',
    EXPORT_LOGS: 'system:export-logs'
  },
  WINDOW: {
    MINIMIZE: 'window:minimize',
    MAXIMIZE: 'window:maximize',
    UNMAXIMIZE: 'window:unmaximize',
    TOGGLE_MAXIMIZE: 'window:toggle-maximize',
    IS_MAXIMIZED: 'window:is-maximized',
    CLOSE: 'window:close'
  },
  SUGGESTIONS: {
    GET_FILE_SUGGESTIONS: 'suggestions:get-file',
    GET_BATCH_SUGGESTIONS: 'suggestions:get-batch',
    RECORD_FEEDBACK: 'suggestions:record-feedback',
    GET_STRATEGIES: 'suggestions:get-strategies',
    APPLY_STRATEGY: 'suggestions:apply-strategy',
    GET_USER_PATTERNS: 'suggestions:get-user-patterns',
    CLEAR_PATTERNS: 'suggestions:clear-patterns',
    ANALYZE_FOLDER_STRUCTURE: 'suggestions:analyze-folder-structure',
    SUGGEST_NEW_FOLDER: 'suggestions:suggest-new-folder',
    ADD_FEEDBACK_MEMORY: 'suggestions:add-feedback-memory',
    GET_FEEDBACK_MEMORY: 'suggestions:get-feedback-memory',
    UPDATE_FEEDBACK_MEMORY: 'suggestions:update-feedback-memory',
    DELETE_FEEDBACK_MEMORY: 'suggestions:delete-feedback-memory'
  },
  ORGANIZE: {
    AUTO: 'organize:auto',
    BATCH: 'organize:batch',
    PROCESS_NEW: 'organize:process-new',
    GET_STATS: 'organize:get-stats',
    UPDATE_THRESHOLDS: 'organize:update-thresholds',
    CLUSTER_BATCH: 'organize:cluster-batch',
    IDENTIFY_OUTLIERS: 'organize:identify-outliers',
    GET_CLUSTER_SUGGESTIONS: 'organize:get-cluster-suggestions'
  },
  // Vector DB (Orama - in-process)
  VECTOR_DB: {
    GET_STATUS: 'vectordb:get-status',
    GET_STATS: 'vectordb:get-stats',
    HEALTH_CHECK: 'vectordb:health-check',
    STATUS_CHANGED: 'vectordb:status-changed'
  },
  // Dependencies removed - in-process AI stack only
  CHAT: {
    QUERY_STREAM: 'chat:query-stream',
    CANCEL_STREAM: 'chat:cancel-stream',
    STREAM_CHUNK: 'chat:stream-chunk',
    STREAM_END: 'chat:stream-end',
    RESET_SESSION: 'chat:reset-session',
    LIST_CONVERSATIONS: 'chat:list-conversations',
    GET_CONVERSATION: 'chat:get-conversation',
    DELETE_CONVERSATION: 'chat:delete-conversation',
    SEARCH_CONVERSATIONS: 'chat:search-conversations',
    EXPORT_CONVERSATION: 'chat:export-conversation'
  },
  KNOWLEDGE: {
    GET_RELATIONSHIP_EDGES: 'knowledge:get-relationship-edges',
    GET_RELATIONSHIP_STATS: 'knowledge:get-relationship-stats'
  }
};

/**
 * IPC Event Channels (main -> renderer, receive-only)
 *
 * These are push events sent via webContents.send() from the main process.
 * Renderer listens via ipcRenderer.on() (exposed through preload's safeOn).
 * They do NOT use invoke/handle and are NOT part of IPC_CHANNELS above.
 */
const IPC_EVENTS = {
  SYSTEM_METRICS: 'system-metrics',
  OPERATION_PROGRESS: 'operation-progress',
  APP_ERROR: 'app:error',
  APP_UPDATE: 'app:update',
  MENU_ACTION: 'menu-action',
  OPEN_SEMANTIC_SEARCH: 'open-semantic-search',
  SETTINGS_CHANGED_EXTERNAL: 'settings-changed-external',
  FILE_OPERATION_COMPLETE: 'file-operation-complete',
  NOTIFICATION: 'notification',
  UNDO_REDO_STATE_CHANGED: 'undo-redo:state-changed',
  BATCH_RESULTS_CHUNK: 'batch-results-chunk'
};

/**
 * Action Types for Undo/Redo
 */
const ACTION_TYPES = {
  FILE_MOVE: 'FILE_MOVE',
  FILE_DELETE: 'FILE_DELETE',
  FILE_RENAME: 'FILE_RENAME',
  FOLDER_CREATE: 'FOLDER_CREATE',
  FOLDER_DELETE: 'FOLDER_DELETE',
  FOLDER_RENAME: 'FOLDER_RENAME',
  SETTINGS_CHANGE: 'SETTINGS_CHANGE',
  ANALYSIS_RESULT: 'ANALYSIS_RESULT',
  BATCH_OPERATION: 'BATCH_OPERATION',
  BATCH_ORGANIZE: 'BATCH_ORGANIZE'
};

/**
 * AI model defaults — imported from aiModelConfig.js (single source of truth)
 * Change models in src/shared/aiModelConfig.js
 */
const { INSTALL_MODEL_PROFILES, DEFAULT_AI_MODELS, AI_DEFAULTS } = require('./aiModelConfig');

/**
 * Settings schema version (shared across main/renderer)
 */
const SETTINGS_SCHEMA_VERSION = 2;

/**
 * Processing Limits
 */
const PROCESSING_LIMITS = {
  MAX_CONCURRENT_ANALYSIS: 3,
  MAX_BATCH_SIZE: 100,
  RETRY_ATTEMPTS: 3,
  MAX_BATCH_OPERATION_SIZE: 1000,
  MAX_TOTAL_BATCH_TIME: 300000
};

/**
 * File Size Limits (bytes)
 */
const FILE_SIZE_LIMITS = {
  MAX_TEXT_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  MAX_IMAGE_FILE_SIZE: 100 * 1024 * 1024, // 100MB
  MAX_DOCUMENT_FILE_SIZE: 200 * 1024 * 1024 // 200MB
};

/**
 * System Limits
 */
const LIMITS = {
  ...PERFORMANCE_LIMITS,
  MAX_PATH_LENGTH:
    { win32: 260, linux: 4096, darwin: 1024 }[
      typeof process !== 'undefined' && process.platform ? process.platform : 'win32'
    ] || 260,
  MAX_FILE_SIZE: 100 * 1024 * 1024,
  MAX_FILENAME_LENGTH: PERFORMANCE_LIMITS.MAX_FILENAME_LENGTH ?? 255
};

/**
 * UI Virtualization Constants
 */
const UI_VIRTUALIZATION = {
  THRESHOLD: 30, // Number of items before enabling virtualization
  ANALYSIS_RESULTS_ITEM_HEIGHT: 116, // px
  ANALYSIS_RESULTS_ITEM_GAP: 16, // px
  FILE_GRID_ITEM_HEIGHT: 200, // px
  FILE_GRID_ITEM_WIDTH: 180, // px
  FILE_GRID_ROW_HEIGHT: 240, // px
  MEASUREMENT_PADDING: 16, // px
  PROCESSED_FILES_ITEM_HEIGHT: 64, // px
  TARGET_FOLDER_ITEM_HEIGHT: 56, // px
  SEARCH_RESULTS_ITEM_HEIGHT: 140, // px - height for search result row in UnifiedSearchModal
  SEARCH_RESULTS_ITEM_GAP: 8, // px
  OVERSCAN_COUNT: 5 // Number of items to render outside visible area
};

/**
 * File Extension Constants
 */
const SUPPORTED_IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
  '.svg',
  '.tiff',
  '.ico',
  '.heic'
];

const SUPPORTED_DOCUMENT_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.txt',
  '.md',
  '.rtf',
  '.csv',
  '.json',
  '.xml',
  '.yml',
  '.yaml',
  '.html',
  '.css',
  '.js',
  '.ts',
  '.sql',
  '.py',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.rb',
  '.go',
  '.rs',
  '.php',
  '.odt',
  '.ods',
  '.odp',
  '.epub',
  '.eml',
  '.msg',
  '.kml',
  '.kmz',
  '.sh',
  '.bat',
  '.ps1'
];

// Text-like file extensions for plain-text extraction
const SUPPORTED_TEXT_EXTENSIONS = [
  '.txt',
  '.md',
  '.rtf',
  '.json',
  '.csv',
  '.xml',
  '.yml',
  '.yaml',
  '.html',
  '.css',
  '.js',
  '.ts',
  '.sql',
  '.py',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.rb',
  '.go',
  '.rs',
  '.php',
  '.sh',
  '.bat',
  '.ps1',
  '.ini',
  '.log'
];

const SUPPORTED_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];

const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm'];

const SUPPORTED_ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'];

const SUPPORTED_3D_EXTENSIONS = ['.stl', '.obj', '.3mf', '.scad', '.gcode'];

const SUPPORTED_DESIGN_EXTENSIONS = ['.ai', '.eps', '.psd'];

// File types that are currently supported by the analysis pipeline
const ANALYSIS_SUPPORTED_EXTENSIONS = Array.from(
  new Set([
    ...SUPPORTED_TEXT_EXTENSIONS,
    ...SUPPORTED_DOCUMENT_EXTENSIONS,
    ...SUPPORTED_IMAGE_EXTENSIONS,
    ...SUPPORTED_ARCHIVE_EXTENSIONS
  ])
);

const ALL_SUPPORTED_EXTENSIONS = Array.from(
  new Set([
    ...SUPPORTED_TEXT_EXTENSIONS,
    ...SUPPORTED_DOCUMENT_EXTENSIONS,
    ...SUPPORTED_IMAGE_EXTENSIONS,
    ...SUPPORTED_AUDIO_EXTENSIONS,
    ...SUPPORTED_VIDEO_EXTENSIONS,
    ...SUPPORTED_ARCHIVE_EXTENSIONS,
    ...SUPPORTED_3D_EXTENSIONS,
    ...SUPPORTED_DESIGN_EXTENSIONS
  ])
);

/**
 * Application Phases
 */
const PHASES = {
  WELCOME: 'welcome',
  SETUP: 'setup',
  DISCOVER: 'discover',
  ORGANIZE: 'organize',
  COMPLETE: 'complete'
};

const PHASE_TRANSITIONS = {
  [PHASES.WELCOME]: [PHASES.SETUP, PHASES.DISCOVER],
  [PHASES.SETUP]: [PHASES.WELCOME, PHASES.DISCOVER],
  [PHASES.DISCOVER]: [PHASES.WELCOME, PHASES.SETUP, PHASES.ORGANIZE],
  [PHASES.ORGANIZE]: [PHASES.WELCOME, PHASES.DISCOVER, PHASES.COMPLETE],
  [PHASES.COMPLETE]: [PHASES.WELCOME, PHASES.DISCOVER, PHASES.ORGANIZE]
};

const PHASE_ORDER = [
  PHASES.WELCOME,
  PHASES.SETUP,
  PHASES.DISCOVER,
  PHASES.ORGANIZE,
  PHASES.COMPLETE
];

const PHASE_METADATA = {
  [PHASES.WELCOME]: {
    id: PHASES.WELCOME,
    title: 'Welcome',
    navLabel: 'Welcome',
    icon: 'W',
    progress: 0,
    description: 'Introduction to Stratosort',
    step: 0,
    label: 'Welcome'
  },
  [PHASES.SETUP]: {
    id: PHASES.SETUP,
    title: 'Setup',
    navLabel: 'Setup',
    icon: 'S',
    progress: 25,
    description: 'Configure your environment',
    step: 1,
    label: 'Setup'
  },
  [PHASES.DISCOVER]: {
    id: PHASES.DISCOVER,
    title: 'Discover',
    navLabel: 'Discover',
    icon: 'D',
    progress: 50,
    description: 'Analyze and select files',
    step: 2,
    label: 'Discover'
  },
  [PHASES.ORGANIZE]: {
    id: PHASES.ORGANIZE,
    title: 'Organize',
    navLabel: 'Organize',
    icon: 'O',
    progress: 75,
    description: 'Review and apply changes',
    step: 3,
    label: 'Organize'
  },
  [PHASES.COMPLETE]: {
    id: PHASES.COMPLETE,
    title: 'Complete',
    navLabel: 'Complete',
    icon: 'C',
    progress: 100,
    description: 'Summary and cleanup',
    step: 4,
    label: 'Complete'
  }
};

/**
 * Error Types
 */
const SYSTEM_STATUS = {
  CHECKING: 'checking',
  HEALTHY: 'healthy',
  UNHEALTHY: 'unhealthy',
  OFFLINE: 'offline'
};

const NOTIFICATION_TYPES = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error'
};

const FILE_STATES = {
  PENDING: 'pending',
  ANALYZING: 'analyzing',
  CATEGORIZED: 'categorized',
  APPROVED: 'approved',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  ERROR: 'error',
  CANCELLED: 'cancelled'
};

const ERROR_TYPES = {
  UNKNOWN: 'UNKNOWN',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  INVALID_FORMAT: 'INVALID_FORMAT',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE'
};

const FILE_SYSTEM_ERROR_CODES = {
  FILE_ACCESS_DENIED: 'FILE_ACCESS_DENIED',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  DIRECTORY_NOT_FOUND: 'DIRECTORY_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  WRITE_FAILED: 'WRITE_FAILED',
  READ_FAILED: 'READ_FAILED',
  DELETE_FAILED: 'DELETE_FAILED',
  RENAME_FAILED: 'RENAME_FAILED',
  COPY_FAILED: 'COPY_FAILED',
  MOVE_FAILED: 'MOVE_FAILED',
  MKDIR_FAILED: 'MKDIR_FAILED',
  RMDIR_FAILED: 'RMDIR_FAILED',
  DIRECTORY_NOT_EMPTY: 'DIRECTORY_NOT_EMPTY',
  NOT_A_DIRECTORY: 'NOT_A_DIRECTORY',
  NOT_A_FILE: 'NOT_A_FILE',
  DISK_FULL: 'DISK_FULL',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  TOO_MANY_OPEN_FILES: 'TOO_MANY_OPEN_FILES',
  FILE_IN_USE: 'FILE_IN_USE',
  FILE_LOCKED: 'FILE_LOCKED',
  FILE_EXISTS: 'FILE_EXISTS',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  PATH_TOO_LONG: 'PATH_TOO_LONG',
  INVALID_PATH: 'INVALID_PATH',
  CROSS_DEVICE_LINK: 'CROSS_DEVICE_LINK',
  CHECKSUM_MISMATCH: 'CHECKSUM_MISMATCH',
  SIZE_MISMATCH: 'SIZE_MISMATCH',
  PARTIAL_WRITE: 'PARTIAL_WRITE',
  CORRUPTED_FILE: 'CORRUPTED_FILE',
  WATCHER_FAILED: 'WATCHER_FAILED',
  WATCHER_CLOSED: 'WATCHER_CLOSED',
  ATOMIC_OPERATION_FAILED: 'ATOMIC_OPERATION_FAILED',
  ROLLBACK_FAILED: 'ROLLBACK_FAILED',
  TRANSACTION_TIMEOUT: 'TRANSACTION_TIMEOUT',
  IO_ERROR: 'IO_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

const SHORTCUTS = {
  UNDO: 'Ctrl+Z',
  REDO: 'Ctrl+Y',
  SELECT_ALL: 'Ctrl+A'
};

const UI_WORKFLOW = {
  RESTORE_MAX_AGE_MS: 60 * 60 * 1000,
  SAVE_DEBOUNCE_MS: 1000
};

const RENDERER_LIMITS = {
  FILE_STATS_BATCH_SIZE: 25,
  ANALYSIS_TIMEOUT_MS: 3 * 60 * 1000
};

module.exports = {
  IPC_CHANNELS,
  IPC_EVENTS,
  ACTION_TYPES,
  INSTALL_MODEL_PROFILES,
  DEFAULT_AI_MODELS,
  SETTINGS_SCHEMA_VERSION,
  AI_DEFAULTS,
  PROCESSING_LIMITS,
  FILE_SIZE_LIMITS,
  LIMITS,
  UI_VIRTUALIZATION,
  SUPPORTED_IMAGE_EXTENSIONS,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  SUPPORTED_TEXT_EXTENSIONS,
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
  SUPPORTED_ARCHIVE_EXTENSIONS,
  SUPPORTED_3D_EXTENSIONS,
  SUPPORTED_DESIGN_EXTENSIONS,
  ANALYSIS_SUPPORTED_EXTENSIONS,
  ALL_SUPPORTED_EXTENSIONS,
  PHASES,
  PHASE_ORDER,
  PHASE_TRANSITIONS,
  PHASE_METADATA,
  SYSTEM_STATUS,
  NOTIFICATION_TYPES,
  FILE_STATES,
  ERROR_TYPES,
  FILE_SYSTEM_ERROR_CODES,
  SHORTCUTS,
  UI_WORKFLOW,
  RENDERER_LIMITS
};
