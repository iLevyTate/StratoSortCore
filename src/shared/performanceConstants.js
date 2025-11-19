/**
 * Performance and Timing Constants
 * Centralized location for all timing-related magic numbers
 */

/**
 * Timeout durations in milliseconds
 */
const TIMEOUTS = {
  // Short operations (UI feedback)
  DEBOUNCE_INPUT: 300,
  TOOLTIP_DELAY: 500,
  ANIMATION_SHORT: 200,
  ANIMATION_MEDIUM: 300,
  ANIMATION_LONG: 500,

  // Medium operations (file operations)
  FILE_READ: 5000,
  FILE_WRITE: 10000,
  FILE_COPY: 30000,
  DIRECTORY_SCAN: 60000,

  // Long operations (AI/analysis)
  AI_ANALYSIS_SHORT: 30000, // 30 seconds for simple analysis
  AI_ANALYSIS_MEDIUM: 60000, // 1 minute for document analysis
  AI_ANALYSIS_LONG: 120000, // 2 minutes for image analysis
  AI_ANALYSIS_BATCH: 300000, // 5 minutes for batch operations

  // Network operations
  API_REQUEST: 10000,
  API_REQUEST_SLOW: 30000,
  HEALTH_CHECK: 5000,

  // Service initialization
  SERVICE_STARTUP: 30000,
  DATABASE_INIT: 15000,
  MODEL_LOAD: 60000,

  // Short delays for rate limiting/throttling
  DELAY_SHORT: 250, // 250ms - for rate limiting operations
  DELAY_MEDIUM: 500, // 500ms - for medium delays
  DELAY_BATCH: 100, // 100ms - for batch processing delays
  DELAY_NOTIFICATION: 1500, // 1.5 seconds - for notification display
};

/**
 * Retry configuration
 */
const RETRY = {
  // Maximum retry attempts
  MAX_ATTEMPTS_LOW: 2,
  MAX_ATTEMPTS_MEDIUM: 3,
  MAX_ATTEMPTS_HIGH: 5,

  // Delay between retries (milliseconds)
  INITIAL_DELAY: 1000,
  MAX_DELAY: 10000,
  EXPONENTIAL_BASE: 2,

  // Specific retry configurations
  FILE_OPERATION: {
    maxAttempts: 3,
    initialDelay: 500,
    maxDelay: 5000,
  },
  NETWORK_REQUEST: {
    maxAttempts: 5,
    initialDelay: 1000,
    maxDelay: 10000,
  },
  AI_ANALYSIS: {
    maxAttempts: 2,
    initialDelay: 2000,
    maxDelay: 10000,
  },
};

/**
 * Cache sizes and limits
 */
const CACHE = {
  // File analysis caches
  MAX_FILE_CACHE: 500,
  MAX_IMAGE_CACHE: 200,
  MAX_EMBEDDING_CACHE: 1000,

  // Time-based cache expiry (milliseconds)
  TTL_SHORT: 5 * 60 * 1000, // 5 minutes
  TTL_MEDIUM: 30 * 60 * 1000, // 30 minutes
  TTL_LONG: 2 * 60 * 60 * 1000, // 2 hours
  TTL_DAY: 24 * 60 * 60 * 1000, // 24 hours

  // Cache cleanup intervals
  CLEANUP_INTERVAL: 15 * 60 * 1000, // 15 minutes
};

/**
 * Batch processing limits
 */
const BATCH = {
  // Number of items per batch
  SIZE_SMALL: 10,
  SIZE_MEDIUM: 50,
  SIZE_LARGE: 100,

  // Concurrent operations
  MAX_CONCURRENT_FILES: 5,
  MAX_CONCURRENT_ANALYSIS: 3,
  MAX_CONCURRENT_NETWORK: 10,

  // Progress reporting intervals
  PROGRESS_UPDATE_INTERVAL: 1000, // 1 second
};

/**
 * UI polling and update intervals
 */
const POLLING = {
  FAST: 100, // 100ms - for active operations
  NORMAL: 500, // 500ms - for standard updates
  SLOW: 2000, // 2 seconds - for background checks
  VERY_SLOW: 5000, // 5 seconds - for infrequent checks
};

/**
 * File size limits (bytes)
 */
const FILE_SIZE = {
  // Maximum sizes for different operations
  MAX_INLINE_TEXT: 1024 * 1024, // 1 MB
  MAX_DOCUMENT_SIZE: 50 * 1024 * 1024, // 50 MB
  MAX_IMAGE_SIZE: 20 * 1024 * 1024, // 20 MB
  MAX_UPLOAD_SIZE: 100 * 1024 * 1024, // 100 MB

  // Thresholds for performance optimization
  LARGE_FILE_THRESHOLD: 10 * 1024 * 1024, // 10 MB
  STREAM_THRESHOLD: 5 * 1024 * 1024, // 5 MB - use streaming above this
};

/**
 * Pagination and list limits
 */
const PAGINATION = {
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 1000,
  INFINITE_SCROLL_THRESHOLD: 100, // Load more when this many pixels from bottom
};

/**
 * Thresholds and percentages
 */
const THRESHOLDS = {
  // Confidence thresholds (0-1 range)
  CONFIDENCE_LOW: 0.3,
  CONFIDENCE_MEDIUM: 0.6,
  CONFIDENCE_HIGH: 0.8,
  CONFIDENCE_VERY_HIGH: 0.9,

  // Resource usage warnings
  MEMORY_WARNING_PERCENT: 80,
  DISK_WARNING_PERCENT: 90,
  CPU_WARNING_PERCENT: 85,

  // Quality thresholds
  MIN_SIMILARITY_SCORE: 0.5,
  MIN_MATCH_CONFIDENCE: 0.6,
};

/**
 * Indexing and array limits
 */
const LIMITS = {
  MAX_SEARCH_RESULTS: 100,
  MAX_SUGGESTIONS: 10,
  MAX_HISTORY_ITEMS: 1000,
  MAX_LOG_ENTRIES: 5000,
  MAX_UNDO_STACK: 50,
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
};
