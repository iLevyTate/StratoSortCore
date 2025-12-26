/**
 * Performance and Timing Constants
 * Centralized location for all timing-related magic numbers
 *
 * This file contains all performance-related constants used throughout the application.
 * Constants are organized by category and can be overridden via environment variables
 * where appropriate.
 */

/**
 * Environment variable helper - safely parse numeric env vars with validation
 * @param {string} envVar - Environment variable name
 * @param {number} defaultValue - Default value if env var is not set or invalid
 * @param {Object} options - Validation options
 * @returns {number} Parsed value or default
 */
function getEnvNumber(envVar, defaultValue, options = {}) {
  const value = process.env[envVar];
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return defaultValue;
  }
  const { min = -Infinity, max = Infinity } = options;
  if (parsed < min || parsed > max) {
    return defaultValue;
  }
  return parsed;
}

/**
 * Timeout durations in milliseconds
 */
const TIMEOUTS = {
  DEBOUNCE_INPUT: 300,
  TOOLTIP_DELAY: 500,
  ANIMATION_SHORT: 200,
  ANIMATION_MEDIUM: 300,
  ANIMATION_LONG: 500,
  ANIMATION_FADE: 180, // Fade skeleton/overlay animations
  FILE_READ: 5000,
  FILE_WRITE: 10000,
  FILE_COPY: 30000,
  DIRECTORY_SCAN: 60000,
  AI_ANALYSIS_SHORT: 30000,
  AI_ANALYSIS_MEDIUM: 60000,
  AI_ANALYSIS_LONG: 120000,
  AI_ANALYSIS_BATCH: 300000,
  API_REQUEST: 10000,
  API_REQUEST_SLOW: 30000,
  HEALTH_CHECK: 5000,
  AXIOS_DEFAULT: 5000,
  SERVICE_STARTUP: 30000,
  SERVICE_INIT_WAIT: 2000, // Wait for service initialization
  DATABASE_INIT: 15000,
  MODEL_LOAD: 60000,
  MODEL_DISCOVERY: 5000, // Model discovery/list timeout
  DELAY_MICRO: 50, // Very short delays for race condition prevention
  DELAY_TINY: 5, // Minimal delay for inter-file processing
  DELAY_MINI: 10, // Small delay for inter-batch processing
  DELAY_SHORT: 250,
  DELAY_MEDIUM: 500,
  DELAY_BATCH: 100, // Short delay for batch operations
  DELAY_LOCK_RETRY: 400, // Delay before retrying lock acquisition
  DELAY_NOTIFICATION: 1500,
  SIGKILL_VERIFY: 100, // Delay to verify SIGKILL termination
  CLEANUP_DELAY: 60000, // Delay before cleanup operations (e.g., temp file removal)
  CLEANUP_MAX: 5000,
  SHUTDOWN_MAX: 10000,
  PROCESS_KILL_VERIFY: 500, // Delay to verify process termination
  IPC_HANDLER_RETRY_BASE: 100,
  IPC_HANDLER_MAX_WAIT: 2000,
  SEMANTIC_QUERY: 30000,
  FLUSH_MAX_WAIT: 30000,
  WINDOW_LOAD_DELAY: 100, // Delay before loading window content
  // Analysis lock and monitoring timeouts
  ANALYSIS_LOCK: 5 * 60 * 1000, // 5 minutes - forces lock release if analysis hangs
  GLOBAL_ANALYSIS: 10 * 60 * 1000, // 10 minutes - max total analysis time
  HEARTBEAT_INTERVAL: 30000, // 30 seconds - progress heartbeat during analysis
  STALE_ACTIVITY: 15 * 60 * 1000, // 15 minutes - activity considered stale
  METRICS_BROADCAST: 30000 // 30 seconds - system metrics broadcast to renderer
};

const RETRY = {
  MAX_ATTEMPTS_LOW: 2,
  MAX_ATTEMPTS_MEDIUM: 3,
  MAX_ATTEMPTS_HIGH: 5,
  MAX_ATTEMPTS_VERY_HIGH: 10,
  INITIAL_DELAY: 1000,
  MAX_DELAY: 10000,
  EXPONENTIAL_BASE: 2,
  FILE_OPERATION: { maxAttempts: 3, initialDelay: 500, maxDelay: 5000 },
  NETWORK_REQUEST: { maxAttempts: 5, initialDelay: 1000, maxDelay: 10000 },
  AI_ANALYSIS: { maxAttempts: 2, initialDelay: 2000, maxDelay: 10000 },
  IPC_HANDLER: { maxAttempts: 5, initialDelay: 100 },
  OLLAMA_API: { maxAttempts: 3, initialDelay: 1000, maxDelay: 4000 },
  CHROMADB: { maxAttempts: 3, initialDelay: 500, maxDelay: 5000 },
  DATABASE_OFFLINE_MAX: 10,
  ITEM_MAX_RETRIES: 3,
  BACKOFF_BASE_MS: 5000,
  BACKOFF_MAX_MS: 300000,
  // Atomic operation retry backoff (multiplied by attempt number)
  ATOMIC_BACKOFF_STEP_MS: 50, // e.g., 50ms, 100ms, 150ms for attempts 1, 2, 3
  CHROMADB_BACKOFF_STEP_MS: 100 // e.g., 100ms, 200ms, 300ms for attempts 1, 2, 3
};

const CACHE = {
  MAX_FILE_CACHE: 500,
  MAX_IMAGE_CACHE: getEnvNumber('MAX_IMAGE_CACHE', 300, { min: 50, max: 1000 }),
  MAX_EMBEDDING_CACHE: 1000,
  MAX_ANALYSIS_CACHE: 200,
  MAX_LRU_CACHE: 100,
  CHROMADB_QUERY_CACHE_SIZE: 200,
  CHROMADB_QUERY_TTL_MS: 120000,
  TTL_SHORT: 5 * 60 * 1000,
  TTL_MEDIUM: 30 * 60 * 1000,
  TTL_LONG: 2 * 60 * 60 * 1000,
  TTL_DAY: 24 * 60 * 60 * 1000,
  CLEANUP_INTERVAL: 15 * 60 * 1000,
  ANALYSIS_HISTORY_TTL_MS: 5000,
  STATS_CACHE_TTL_MS: 30000,
  SEARCH_CACHE_TTL_MS: 10000
};

const BATCH = {
  SIZE_SMALL: 10,
  SIZE_MEDIUM: 50,
  SIZE_LARGE: 100,
  SIZE_XLARGE: 1000,
  MAX_CONCURRENT_FILES: 5,
  MAX_CONCURRENT_ANALYSIS: 3,
  MAX_CONCURRENT_NETWORK: 10,
  PROGRESS_UPDATE_INTERVAL: 1000,
  EMBEDDING_BATCH_SIZE: 50,
  EMBEDDING_PARALLEL_SIZE: 10,
  EMBEDDING_FLUSH_DELAY_MS: 500,
  CHROMADB_INSERT_DELAY_MS: 100,
  SEMANTIC_BATCH_SIZE: 50,
  AUTO_ORGANIZE_BATCH_SIZE: getEnvNumber('AUTO_ORGANIZE_BATCH_SIZE', 10, {
    min: 1,
    max: 100
  })
};

const POLLING = {
  FAST: 100,
  NORMAL: 500,
  SLOW: 2000,
  VERY_SLOW: 5000,
  CHROMADB_HEALTH_CHECK: 30000,
  STARTUP_POLL_INITIAL: 50,
  STARTUP_POLL_SLOW: 200,
  STARTUP_POLL_SLOWER: 500,
  STARTUP_POLL_FINAL: 1000
};

const FILE_SIZE = {
  MAX_INLINE_TEXT: 1024 * 1024,
  MAX_DOCUMENT_SIZE: 50 * 1024 * 1024,
  MAX_IMAGE_SIZE: 20 * 1024 * 1024,
  MAX_UPLOAD_SIZE: 100 * 1024 * 1024,
  MAX_TEXT_FOR_HASH: 50000,
  LARGE_FILE_THRESHOLD: 10 * 1024 * 1024,
  STREAM_THRESHOLD: 5 * 1024 * 1024
};

const PAGINATION = {
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 1000,
  INFINITE_SCROLL_THRESHOLD: 100,
  DEFAULT_QUERY_LIMIT: 100
};

const THRESHOLDS = {
  CONFIDENCE_LOW: 0.3,
  CONFIDENCE_MEDIUM: 0.6,
  CONFIDENCE_HIGH: 0.8,
  CONFIDENCE_VERY_HIGH: 0.9,
  DEFAULT_CONFIDENCE_PERCENT: 70,
  DEFAULT_IMAGE_CONFIDENCE_PERCENT: 75,
  MEMORY_WARNING_PERCENT: 80,
  DISK_WARNING_PERCENT: 90,
  CPU_WARNING_PERCENT: 85,
  MIN_SIMILARITY_SCORE: 0.5,
  MIN_MATCH_CONFIDENCE: 0.6,
  FOLDER_MATCH_CONFIDENCE: 0.55, // Min score for folder categorization
  QUEUE_HIGH_WATERMARK: 0.75,
  QUEUE_CRITICAL_WATERMARK: 0.9
};

const LIMITS = {
  MAX_SEARCH_RESULTS: 100,
  MAX_SUGGESTIONS: 10,
  MAX_HISTORY_ITEMS: 1000,
  MAX_LOG_ENTRIES: 5000,
  MAX_UNDO_STACK: 50,
  MAX_QUEUE_SIZE: 10000,
  MAX_DEAD_LETTER_SIZE: 1000,
  MAX_HISTORY_ENTRIES: 10000,
  MAX_TOP_K: 100,
  MAX_XLSX_ROWS: 10000,
  MAX_IPC_REQUESTS_PER_SECOND: 200,
  RATE_LIMIT_CLEANUP_THRESHOLD: 100,
  RATE_LIMIT_STALE_MS: 60000,
  MAX_NUMERIC_RETRIES: 5000,
  MAX_FILENAME_LENGTH: 255, // Standard filesystem limit (NTFS, ext4, HFS+)
  MAX_SETTINGS_BACKUPS: 10,
  MAX_WATCHER_RESTARTS: 10,
  WATCHER_RESTART_WINDOW: 60000,
  FEEDBACK_RETENTION_DAYS: 90,
  PATTERN_STALE_DAYS: 180,
  MEMORY_CHECK_INTERVAL: 100,
  MAX_OVERLAP_ITERATIONS: 10000,
  MAX_OVERLAPS_REPORT: 100
};

const IMAGE = { MAX_DIMENSION: 1536 };

const NETWORK = {
  OLLAMA_PORT: 11434,
  CHROMADB_PORT: 8000,
  DEV_SERVER_PORT: 3000,
  HTTPS_PORT: 443,
  HTTP_PORT: 80,
  MAX_PORT: 65535,
  MIN_PORT: 1,
  SERVER_CHECK_INTERVAL: 100,
  SERVER_MAX_WAIT: 30000
};

const DEBOUNCE = {
  SETTINGS_SAVE: 1000,
  PATTERN_SAVE_THROTTLE: 5000,
  CACHE_BATCH_WAIT: 100,
  CACHE_BATCH_MAX_WAIT: 5000,
  REFRESH_INTERVAL: 60000,
  ERROR_RETRY_INTERVAL: 5000
};

const CONCURRENCY = {
  FOLDER_SCAN: 50,
  EMBEDDING_FLUSH: 5,
  // Analysis worker limits
  MIN_WORKERS: 1,
  DEFAULT_WORKERS: 3,
  MAX_WORKERS: 8
};

const GPU_TUNING = {
  NUM_BATCH_CPU_ONLY: 128,
  NUM_BATCH_LOW_MEMORY: 256,
  NUM_BATCH_MEDIUM_MEMORY: 384,
  NUM_BATCH_HIGH_MEMORY: 512,
  NUM_BATCH_VERY_HIGH_MEMORY: 1024, // 16GB+ VRAM
  HIGH_MEMORY_THRESHOLD: 12000,
  MEDIUM_MEMORY_THRESHOLD: 8000,
  VERY_HIGH_MEMORY_THRESHOLD: 16000
};

/**
 * Ollama-specific performance tuning constants
 * Based on 2025 best practices for local LLM inference
 */
const OLLAMA = {
  // Recommended max loaded models (reduces VRAM pressure)
  MAX_LOADED_MODELS: 1,
  // Parallel requests for embeddings (1 is more stable)
  NUM_PARALLEL_EMBEDDINGS: 1,
  // Keep model in memory duration
  KEEP_ALIVE_DEFAULT: '10m',
  // Context window sizes by task type
  CONTEXT_EMBEDDINGS: 512,
  CONTEXT_VISION: 2048,
  CONTEXT_TEXT: 8192,
  // Rate limiting
  MAX_REQUESTS_PER_SECOND: 5,
  RATE_LIMIT_WINDOW_MS: 1000
};

/**
 * Window management timing constants
 * Used for window restore, focus, and visibility operations
 */
const WINDOW = {
  /** Delay after restore() before checking visibility (ms) */
  RESTORE_SETTLE_MS: 50,
  /** Duration to keep window "always on top" when forcing foreground on Windows (ms) */
  ALWAYS_ON_TOP_DURATION_MS: 100
};

/**
 * Process management timing constants
 * Used for graceful shutdown and process termination
 */
const PROCESS = {
  /** Time to wait after SIGTERM before sending SIGKILL (ms) */
  GRACEFUL_SHUTDOWN_WAIT_MS: 2000,
  /** Timeout for individual kill commands (ms) */
  KILL_COMMAND_TIMEOUT_MS: 100
};

/**
 * Text truncation limits for display and processing
 * Used to prevent memory issues and improve performance
 */
const TRUNCATION = {
  // Display limits
  NAME_MAX: 50,
  DESCRIPTION_MAX: 140,
  PREVIEW_SHORT: 100,
  PREVIEW_MEDIUM: 200,
  PREVIEW_LONG: 300,
  PREVIEW_XLARGE: 500,

  // Processing limits
  TEXT_EXTRACT_MAX: 2000,
  CACHE_SIGNATURE: 1000,
  HASH_PREFIX: 8,
  FOLDER_ID_HASH: 32,

  // Collection limits
  FOLDERS_DISPLAY: 10,
  KEYWORDS_MAX: 7,
  KEYWORDS_EXTENDED: 15,
  TAGS_DISPLAY: 5,
  ZIP_ENTRIES_MAX: 50,
  XLSX_ENTRIES_MAX: 100,
  TOP_EXTENSIONS: 3
};

/**
 * Viewport breakpoints for responsive design
 * Matches common device widths
 */
const VIEWPORT = {
  MOBILE: 480,
  TABLET: 768,
  DESKTOP: 1280,
  WIDE_DESKTOP: 1600,
  ULTRA_WIDE: 1920,
  FOUR_K: 2560
};

module.exports = {
  TIMEOUTS,
  RETRY,
  CACHE,
  BATCH,
  POLLING,
  FILE_SIZE,
  PAGINATION,
  THRESHOLDS,
  LIMITS,
  IMAGE,
  NETWORK,
  DEBOUNCE,
  CONCURRENCY,
  GPU_TUNING,
  OLLAMA,
  WINDOW,
  PROCESS,
  TRUNCATION,
  VIEWPORT
};
