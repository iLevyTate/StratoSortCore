/**
 * Shared Constants
 * Constants used across main and renderer processes
 */

const { SERVICE_URLS } = require('./configDefaults');

// ===== STRATOSORT SHARED CONSTANTS =====

// Application phases - centralized for consistency
const PHASES = {
  WELCOME: 'welcome',
  SETUP: 'setup',
  DISCOVER: 'discover',
  ORGANIZE: 'organize',
  COMPLETE: 'complete'
};

// Phase transition rules - defines valid navigation paths
// Fixed: Allow direct navigation to WELCOME from all phases for error recovery
const PHASE_TRANSITIONS = {
  [PHASES.WELCOME]: [PHASES.SETUP, PHASES.DISCOVER],
  [PHASES.SETUP]: [PHASES.DISCOVER, PHASES.WELCOME],
  [PHASES.DISCOVER]: [PHASES.ORGANIZE, PHASES.SETUP, PHASES.WELCOME],
  [PHASES.ORGANIZE]: [PHASES.COMPLETE, PHASES.DISCOVER, PHASES.WELCOME],
  [PHASES.COMPLETE]: [PHASES.WELCOME, PHASES.ORGANIZE, PHASES.DISCOVER] // Allow going back without losing data
};

// Phase metadata for UI display
const PHASE_METADATA = {
  [PHASES.WELCOME]: {
    title: 'Welcome to StratoSort',
    navLabel: 'Welcome',
    icon: '🚀',
    progress: 0
  },
  [PHASES.SETUP]: {
    title: 'Configure Smart Folders',
    navLabel: 'Smart Folders',
    icon: '⚙️',
    progress: 20
  },
  [PHASES.DISCOVER]: {
    title: 'Discover & Analyze Files',
    navLabel: 'Discover Files',
    icon: '🔎',
    progress: 50
  },
  [PHASES.ORGANIZE]: {
    title: 'Review & Organize',
    navLabel: 'Review Organize',
    icon: '📂',
    progress: 80
  },
  [PHASES.COMPLETE]: {
    title: 'Organization Complete',
    navLabel: 'Complete',
    icon: '✅',
    progress: 100
  }
};

// IPC Channel constants - centralized to avoid magic strings
const IPC_CHANNELS = {
  // File Operations
  FILES: {
    SELECT: 'handle-file-selection',
    SELECT_DIRECTORY: 'select-directory',
    GET_DOCUMENTS_PATH: 'get-documents-path',
    CREATE_FOLDER_DIRECT: 'create-folder-direct',
    GET_FILE_STATS: 'get-file-stats',
    GET_FILES_IN_DIRECTORY: 'get-files-in-directory',
    DELETE_FOLDER: 'delete-folder',
    DELETE_FILE: 'delete-file',
    OPEN_FILE: 'open-file',
    REVEAL_FILE: 'reveal-file',
    COPY_FILE: 'copy-file',
    OPEN_FOLDER: 'open-folder',
    PERFORM_OPERATION: 'perform-file-operation'
  },

  // Smart Folders
  SMART_FOLDERS: {
    GET: 'get-smart-folders',
    GET_CUSTOM: 'get-custom-folders',
    SAVE: 'save-smart-folders',
    UPDATE_CUSTOM: 'update-custom-folders',
    SCAN_STRUCTURE: 'scan-folder-structure',
    ADD: 'add-smart-folder',
    EDIT: 'edit-smart-folder',
    DELETE: 'delete-smart-folder',
    MATCH: 'match-smart-folder',
    RESET_TO_DEFAULTS: 'reset-smart-folders-to-defaults'
  },

  // Analysis
  ANALYSIS: {
    ANALYZE_DOCUMENT: 'analyze-document',
    ANALYZE_IMAGE: 'analyze-image',
    EXTRACT_IMAGE_TEXT: 'extract-text-from-image'
  },

  // Organization Suggestions
  SUGGESTIONS: {
    GET_FILE_SUGGESTIONS: 'get-file-suggestions',
    GET_BATCH_SUGGESTIONS: 'get-batch-suggestions',
    RECORD_FEEDBACK: 'record-suggestion-feedback',
    GET_STRATEGIES: 'get-organization-strategies',
    APPLY_STRATEGY: 'apply-organization-strategy',
    GET_USER_PATTERNS: 'get-user-patterns',
    CLEAR_PATTERNS: 'clear-user-patterns',
    ANALYZE_FOLDER_STRUCTURE: 'analyze-folder-structure',
    SUGGEST_NEW_FOLDER: 'suggest-new-folder'
  },

  // Auto-Organize
  ORGANIZE: {
    AUTO: 'auto-organize-files',
    BATCH: 'batch-organize-files',
    PROCESS_NEW: 'process-new-file',
    GET_STATS: 'get-organize-stats',
    UPDATE_THRESHOLDS: 'update-organize-thresholds',
    // Cluster-based organization
    CLUSTER_BATCH: 'cluster-batch-organize',
    IDENTIFY_OUTLIERS: 'identify-organization-outliers',
    GET_CLUSTER_SUGGESTIONS: 'get-cluster-suggestions'
  },

  // Settings
  SETTINGS: {
    GET: 'get-settings',
    SAVE: 'save-settings',
    // Extended settings operations (backup, export, import)
    GET_CONFIGURABLE_LIMITS: 'get-configurable-limits',
    EXPORT: 'export-settings',
    IMPORT: 'import-settings',
    CREATE_BACKUP: 'settings-create-backup',
    LIST_BACKUPS: 'settings-list-backups',
    RESTORE_BACKUP: 'settings-restore-backup',
    DELETE_BACKUP: 'settings-delete-backup'
  },

  // Embeddings / Semantic Matching
  EMBEDDINGS: {
    REBUILD_FOLDERS: 'embeddings-rebuild-folders',
    REBUILD_FILES: 'embeddings-rebuild-files',
    CLEAR_STORE: 'embeddings-clear-store',
    GET_STATS: 'embeddings-get-stats',
    FIND_SIMILAR: 'embeddings-find-similar',
    SEARCH: 'embeddings-search',
    SCORE_FILES: 'embeddings-score-files',
    // Hybrid search (SEARCH handler now supports mode: 'hybrid' | 'vector' | 'bm25')
    REBUILD_BM25_INDEX: 'embeddings-rebuild-bm25-index',
    GET_SEARCH_STATUS: 'embeddings-get-search-status',
    // Multi-hop expansion
    FIND_MULTI_HOP: 'embeddings-find-multi-hop',
    // Clustering
    COMPUTE_CLUSTERS: 'embeddings-compute-clusters',
    GET_CLUSTERS: 'embeddings-get-clusters',
    GET_CLUSTER_MEMBERS: 'embeddings-get-cluster-members',
    GET_SIMILARITY_EDGES: 'embeddings-get-similarity-edges',
    GET_FILE_METADATA: 'embeddings-get-file-metadata',
    FIND_DUPLICATES: 'embeddings-find-duplicates'
  },

  // Ollama
  OLLAMA: {
    GET_MODELS: 'get-ollama-models',
    TEST_CONNECTION: 'test-ollama-connection',
    PULL_MODELS: 'ollama-pull-models',
    DELETE_MODEL: 'ollama-delete-model'
  },

  // Undo/Redo
  UNDO_REDO: {
    CAN_UNDO: 'can-undo',
    CAN_REDO: 'can-redo',
    UNDO: 'undo-action',
    REDO: 'redo-action',
    GET_HISTORY: 'get-action-history',
    CLEAR_HISTORY: 'clear-action-history'
  },

  // Analysis History
  ANALYSIS_HISTORY: {
    GET: 'get-analysis-history',
    SEARCH: 'search-analysis-history',
    GET_STATISTICS: 'get-analysis-statistics',
    GET_FILE_HISTORY: 'get-file-analysis-history',
    CLEAR: 'clear-analysis-history',
    EXPORT: 'export-analysis-history'
  },

  // System Monitoring
  SYSTEM: {
    GET_APPLICATION_STATISTICS: 'get-application-statistics',
    GET_METRICS: 'get-system-metrics',
    APPLY_UPDATE: 'apply-update',
    GET_CONFIG: 'get-app-config',
    GET_CONFIG_VALUE: 'get-config-value'
  },

  // Window Controls
  WINDOW: {
    MINIMIZE: 'window-minimize',
    MAXIMIZE: 'window-maximize',
    UNMAXIMIZE: 'window-unmaximize',
    TOGGLE_MAXIMIZE: 'window-toggle-maximize',
    IS_MAXIMIZED: 'window-is-maximized',
    CLOSE: 'window-close'
  },

  // Menu Actions
  MENU: {
    NEW_ANALYSIS: 'menu-new-analysis',
    UNDO: 'menu-undo',
    REDO: 'menu-redo'
  },

  // ChromaDB Service Status
  CHROMADB: {
    GET_STATUS: 'chromadb-get-status',
    GET_CIRCUIT_STATS: 'chromadb-get-circuit-stats',
    GET_QUEUE_STATS: 'chromadb-get-queue-stats',
    FORCE_RECOVERY: 'chromadb-force-recovery',
    HEALTH_CHECK: 'chromadb-health-check',
    // Events (sent from main to renderer)
    STATUS_CHANGED: 'chromadb-status-changed'
  },

  // Dependency Management (Ollama + ChromaDB)
  DEPENDENCIES: {
    GET_STATUS: 'dependencies-get-status',
    INSTALL_OLLAMA: 'dependencies-install-ollama',
    INSTALL_CHROMADB: 'dependencies-install-chromadb',
    UPDATE_OLLAMA: 'dependencies-update-ollama',
    UPDATE_CHROMADB: 'dependencies-update-chromadb',
    // Events (sent from main to renderer)
    SERVICE_STATUS_CHANGED: 'dependencies-service-status-changed'
  }
};

// System status constants
const SYSTEM_STATUS = {
  CHECKING: 'checking',
  HEALTHY: 'healthy',
  UNHEALTHY: 'unhealthy',
  OFFLINE: 'offline'
};

// Notification types
const NOTIFICATION_TYPES = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error'
};

// File processing states
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

// Error types
const ERROR_TYPES = {
  UNKNOWN: 'UNKNOWN',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  INVALID_FORMAT: 'INVALID_FORMAT',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  PROCESSING_FAILED: 'PROCESSING_FAILED'
};

// File system error codes - comprehensive codes for file operations
const FILE_SYSTEM_ERROR_CODES = {
  // Access and permission errors
  FILE_ACCESS_DENIED: 'FILE_ACCESS_DENIED',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  DIRECTORY_NOT_FOUND: 'DIRECTORY_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',

  // Write and modification errors
  WRITE_FAILED: 'WRITE_FAILED',
  READ_FAILED: 'READ_FAILED',
  DELETE_FAILED: 'DELETE_FAILED',
  RENAME_FAILED: 'RENAME_FAILED',
  COPY_FAILED: 'COPY_FAILED',
  MOVE_FAILED: 'MOVE_FAILED',

  // Directory errors
  MKDIR_FAILED: 'MKDIR_FAILED',
  RMDIR_FAILED: 'RMDIR_FAILED',
  DIRECTORY_NOT_EMPTY: 'DIRECTORY_NOT_EMPTY',
  NOT_A_DIRECTORY: 'NOT_A_DIRECTORY',
  NOT_A_FILE: 'NOT_A_FILE',

  // Space and resource errors
  DISK_FULL: 'DISK_FULL',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  TOO_MANY_OPEN_FILES: 'TOO_MANY_OPEN_FILES',

  // File state errors
  FILE_IN_USE: 'FILE_IN_USE',
  FILE_LOCKED: 'FILE_LOCKED',
  FILE_EXISTS: 'FILE_EXISTS',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',

  // Path errors
  PATH_TOO_LONG: 'PATH_TOO_LONG',
  INVALID_PATH: 'INVALID_PATH',
  CROSS_DEVICE_LINK: 'CROSS_DEVICE_LINK',

  // Integrity errors
  CHECKSUM_MISMATCH: 'CHECKSUM_MISMATCH',
  SIZE_MISMATCH: 'SIZE_MISMATCH',
  PARTIAL_WRITE: 'PARTIAL_WRITE',
  CORRUPTED_FILE: 'CORRUPTED_FILE',

  // Watcher errors
  WATCHER_FAILED: 'WATCHER_FAILED',
  WATCHER_CLOSED: 'WATCHER_CLOSED',

  // Atomic operation errors
  ATOMIC_OPERATION_FAILED: 'ATOMIC_OPERATION_FAILED',
  ROLLBACK_FAILED: 'ROLLBACK_FAILED',
  TRANSACTION_TIMEOUT: 'TRANSACTION_TIMEOUT',

  // I/O errors
  IO_ERROR: 'IO_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',

  // Generic
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

// Action types for undo/redo
const ACTION_TYPES = {
  FILE_MOVE: 'FILE_MOVE',
  FILE_RENAME: 'FILE_RENAME',
  FILE_DELETE: 'FILE_DELETE',
  FOLDER_CREATE: 'FOLDER_CREATE',
  FOLDER_DELETE: 'FOLDER_DELETE',
  FOLDER_RENAME: 'FOLDER_RENAME',
  BATCH_OPERATION: 'BATCH_OPERATION',
  SETTINGS_CHANGE: 'SETTINGS_CHANGE',
  ANALYSIS_RESULT: 'ANALYSIS_RESULT'
};

// Theme constants
const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
  AUTO: 'auto' // Alias for 'system' - follow system theme
};

// Keyboard shortcuts (only define shortcuts that are actually used in the app)
const SHORTCUTS = {
  UNDO: 'Ctrl+Z',
  REDO: 'Ctrl+Y',
  SELECT_ALL: 'Ctrl+A'
};

// File size limits
const LIMITS = {
  MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
  MAX_PATH_LENGTH: 260,
  MAX_FILENAME_LENGTH: 255
};

// Note: TIMEOUTS moved to performanceConstants.js - use that as single source of truth

// File type mappings
const SUPPORTED_TEXT_EXTENSIONS = [
  '.txt',
  '.md',
  '.rtf',
  '.json',
  '.csv',
  '.xml',
  '.html',
  '.htm',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.py',
  '.java',
  '.cpp',
  '.c',
  '.h',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.sql',
  '.sh',
  '.bat',
  '.ps1',
  '.yaml',
  '.yml',
  '.ini',
  '.conf',
  '.log'
];

const SUPPORTED_DOCUMENT_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.xlsx',
  '.pptx',
  // Legacy Office
  '.xls',
  '.ppt',
  // OpenDocument formats
  '.odt',
  '.ods',
  '.odp',
  // E-books and email
  '.epub',
  '.eml',
  '.msg',
  // Geospatial packages (treat as documents for analysis)
  '.kml',
  '.kmz'
];

const SUPPORTED_IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.tiff',
  '.svg'
];

const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv'];

const SUPPORTED_ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z', '.tar', '.gz'];

// All supported extensions combined
const ALL_SUPPORTED_EXTENSIONS = [
  ...SUPPORTED_TEXT_EXTENSIONS,
  ...SUPPORTED_DOCUMENT_EXTENSIONS,
  ...SUPPORTED_IMAGE_EXTENSIONS,
  ...SUPPORTED_VIDEO_EXTENSIONS,
  ...SUPPORTED_ARCHIVE_EXTENSIONS
];

// AI Model configurations - Ultra-lightweight models for accessibility
// Total download: ~2.3GB (vs previous ~8GB = 71% reduction)
const DEFAULT_AI_MODELS = {
  TEXT_ANALYSIS: 'qwen3:0.6b', // 523MB - Ultra-fast, 40K context, 119 languages
  IMAGE_ANALYSIS: 'gemma3:latest', // Gemma 3 - Google's multimodal vision-language model
  EMBEDDING: 'embeddinggemma', // 308MB - Google's best-in-class, 768 dims, <15ms
  FALLBACK_MODELS: ['qwen3:0.6b', 'llama3.2:latest', 'gemma2:2b', 'phi3', 'mistral']
};

// AI defaults centralized for analyzers
const AI_DEFAULTS = {
  TEXT: {
    MODEL: 'qwen3:0.6b',
    HOST: SERVICE_URLS.OLLAMA_HOST,
    MAX_CONTENT_LENGTH: 12000,
    TEMPERATURE: 0.1,
    MAX_TOKENS: 800
  },
  IMAGE: {
    MODEL: 'gemma3:latest', // Gemma 3 is multimodal (4B+ variants support vision)
    HOST: SERVICE_URLS.OLLAMA_HOST,
    TEMPERATURE: 0.2,
    MAX_TOKENS: 1000
  },
  EMBEDDING: {
    MODEL: 'embeddinggemma',
    DIMENSIONS: 768, // Different from previous mxbai-embed-large (1024)
    // FIX: Fallback chain for embedding models (in order of preference)
    // Used when primary model is not available on the Ollama server
    FALLBACK_MODELS: [
      'embeddinggemma', // 768 dims - Google's default
      'mxbai-embed-large', // 1024 dims - High quality
      'nomic-embed-text', // 768 dims - Good general purpose
      'all-minilm', // 384 dims - Fast, smaller
      'bge-large', // 1024 dims - Chinese & English
      'snowflake-arctic-embed' // 1024 dims - High quality
    ]
  }
};

// File size limits
const FILE_SIZE_LIMITS = {
  MAX_TEXT_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  MAX_IMAGE_FILE_SIZE: 100 * 1024 * 1024, // 100MB
  MAX_AUDIO_FILE_SIZE: 500 * 1024 * 1024, // 500MB
  MAX_DOCUMENT_FILE_SIZE: 200 * 1024 * 1024 // 200MB
};

// Processing limits - Optimized for faster models
const PROCESSING_LIMITS = {
  MAX_CONCURRENT_ANALYSIS: 3,
  MAX_BATCH_SIZE: 100, // Items per processing batch
  MAX_BATCH_OPERATION_SIZE: 1000, // Security limit for batch file operations
  MAX_BATCH_OPERATION_TIME: 600000, // 10 minutes timeout for batch operations
  ANALYSIS_TIMEOUT: 60000, // 1 minute for faster models
  RETRY_ATTEMPTS: 3
};

// Renderer/UI specific constants
const UI_WORKFLOW = {
  RESTORE_MAX_AGE_MS: 60 * 60 * 1000, // 1 hour
  SAVE_DEBOUNCE_MS: 1000 // 1s
};

const RENDERER_LIMITS = {
  FILE_STATS_BATCH_SIZE: 25,
  ANALYSIS_TIMEOUT_MS: 3 * 60 * 1000 // 3 minutes
};

// Export both CommonJS (for main process) and ES6 (for renderer with webpack)
const exports_object = {
  PHASES,
  PHASE_TRANSITIONS,
  PHASE_METADATA,
  IPC_CHANNELS,
  SYSTEM_STATUS,
  NOTIFICATION_TYPES,
  FILE_STATES,
  ERROR_TYPES,
  FILE_SYSTEM_ERROR_CODES,
  ACTION_TYPES,
  THEMES,
  SHORTCUTS,
  LIMITS,
  SUPPORTED_TEXT_EXTENSIONS,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  SUPPORTED_IMAGE_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
  SUPPORTED_ARCHIVE_EXTENSIONS,
  ALL_SUPPORTED_EXTENSIONS,
  DEFAULT_AI_MODELS,
  AI_DEFAULTS,
  FILE_SIZE_LIMITS,
  PROCESSING_LIMITS,
  UI_WORKFLOW,
  RENDERER_LIMITS
};

// CommonJS export for both Node.js (main process) and webpack (renderer)
// Webpack handles CommonJS imports perfectly, so we don't need dual exports
module.exports = exports_object;
