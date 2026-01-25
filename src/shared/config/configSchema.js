/**
 * Configuration Schema Module
 *
 * Defines all configuration categories with their properties, types, defaults, and validation rules.
 * Kept together for discoverability - this is the single source of truth for config structure.
 *
 * @module config/configSchema
 */

const { PORTS, SERVICE_URLS, TIMEOUTS: CONFIG_DEFAULT_TIMEOUTS } = require('../configDefaults');
const { DEFAULT_SETTINGS } = require('../defaultSettings');
const {
  TIMEOUTS: PERF_TIMEOUTS,
  RETRY,
  CACHE,
  BATCH,
  THRESHOLDS
} = require('../performanceConstants');
const {
  PROCESSING_LIMITS,
  AI_DEFAULTS,
  DEFAULT_AI_MODELS,
  FILE_SIZE_LIMITS,
  LIMITS: FS_LIMITS
} = require('../constants');
// NOTE: Theme switching is no longer supported; no theme values are needed here.

/**
 * Configuration Schema Definition
 * Defines all configuration categories with their properties, types, defaults, and validation rules.
 */
const CONFIG_SCHEMA = {
  /**
   * Server Configuration
   * External service URLs and connection settings
   */
  SERVER: {
    /** ChromaDB vector database URL */
    chromaUrl: {
      type: 'url',
      default: SERVICE_URLS.CHROMA_SERVER_URL,
      envVar: 'CHROMA_SERVER_URL',
      description: 'ChromaDB vector database server URL',
      required: false
    },
    /** ChromaDB server host */
    chromaHost: {
      type: 'string',
      default: '127.0.0.1',
      envVar: 'CHROMA_SERVER_HOST',
      description: 'ChromaDB server hostname'
    },
    /** ChromaDB server port */
    chromaPort: {
      type: 'number',
      default: PORTS.CHROMA_DB,
      envVar: 'CHROMA_SERVER_PORT',
      min: 1,
      max: 65535,
      description: 'ChromaDB server port'
    },
    /** ChromaDB server protocol */
    chromaProtocol: {
      type: 'enum',
      default: 'http',
      envVar: 'CHROMA_SERVER_PROTOCOL',
      values: ['http', 'https'],
      description: 'ChromaDB server protocol'
    },
    /** Ollama LLM server URL */
    ollamaUrl: {
      type: 'url',
      default: SERVICE_URLS.OLLAMA_HOST,
      envVar: ['OLLAMA_BASE_URL', 'OLLAMA_HOST'],
      description: 'Ollama LLM server URL',
      required: false
    },
    /** Ollama server port */
    ollamaPort: {
      type: 'number',
      default: PORTS.OLLAMA,
      envVar: 'OLLAMA_PORT',
      min: 1,
      max: 65535,
      description: 'Ollama server port'
    },
    /** Development server port */
    devServerPort: {
      type: 'number',
      default: PORTS.DEV_SERVER,
      envVar: 'DEV_SERVER_PORT',
      min: 1,
      max: 65535,
      description: 'Development server port for webpack'
    }
  },

  /**
   * AI Model Configuration
   * Model names and AI-related settings
   */
  MODELS: {
    /** Text analysis model */
    textModel: {
      type: 'string',
      default: DEFAULT_AI_MODELS.TEXT_ANALYSIS,
      envVar: 'OLLAMA_TEXT_MODEL',
      description: 'Ollama model for text analysis',
      pattern: /^[a-zA-Z0-9][a-zA-Z0-9\-_.:/]*$/
    },
    /** Vision/image analysis model */
    visionModel: {
      type: 'string',
      default: DEFAULT_AI_MODELS.IMAGE_ANALYSIS,
      envVar: ['OLLAMA_VISION_MODEL', 'OLLAMA_MULTIMODAL_MODEL'],
      description: 'Ollama model for image/vision analysis',
      pattern: /^[a-zA-Z0-9][a-zA-Z0-9\-_.:/]*$/
    },
    /** Embedding model */
    embeddingModel: {
      type: 'string',
      default: DEFAULT_AI_MODELS.EMBEDDING,
      envVar: 'OLLAMA_EMBEDDING_MODEL',
      description: 'Ollama model for generating embeddings (768 dims)',
      pattern: /^[a-zA-Z0-9][a-zA-Z0-9\-_.:/]*$/
    },
    /** Fallback models list */
    fallbackModels: {
      type: 'array',
      default: DEFAULT_AI_MODELS.FALLBACK_MODELS,
      description: 'List of fallback models to try if primary fails'
    },
    /** AI temperature for text analysis */
    textTemperature: {
      type: 'number',
      default: AI_DEFAULTS.TEXT.TEMPERATURE,
      min: 0,
      max: 2,
      description: 'Temperature setting for text generation'
    },
    /** AI temperature for image analysis */
    imageTemperature: {
      type: 'number',
      default: AI_DEFAULTS.IMAGE.TEMPERATURE,
      min: 0,
      max: 2,
      description: 'Temperature setting for image analysis'
    },
    /** Max tokens for text analysis */
    textMaxTokens: {
      type: 'number',
      default: AI_DEFAULTS.TEXT.MAX_TOKENS,
      min: 1,
      max: 32000,
      description: 'Maximum tokens for text analysis response'
    },
    /** Max tokens for image analysis */
    imageMaxTokens: {
      type: 'number',
      default: AI_DEFAULTS.IMAGE.MAX_TOKENS,
      min: 1,
      max: 32000,
      description: 'Maximum tokens for image analysis response'
    },
    /** Max content length for text processing */
    maxContentLength: {
      type: 'number',
      default: AI_DEFAULTS.TEXT.MAX_CONTENT_LENGTH,
      min: 1000,
      max: 100000,
      description: 'Maximum content length for text processing'
    }
  },

  /**
   * Analysis Configuration
   * Settings for file analysis and processing
   */
  ANALYSIS: {
    /** Maximum concurrent analysis operations */
    maxConcurrency: {
      type: 'number',
      default: PROCESSING_LIMITS.MAX_CONCURRENT_ANALYSIS,
      min: 1,
      max: 20,
      description: 'Maximum concurrent analysis operations'
    },
    /** Batch size for processing */
    batchSize: {
      type: 'number',
      default: BATCH.SIZE_MEDIUM,
      min: 1,
      max: 500,
      description: 'Batch size for file processing'
    },
    /** Analysis timeout in milliseconds */
    timeout: {
      type: 'number',
      default: PERF_TIMEOUTS.AI_ANALYSIS_LONG,
      min: 5000,
      max: 600000,
      description: 'Analysis operation timeout (ms)'
    },
    /** Retry attempts for failed operations */
    retryAttempts: {
      type: 'number',
      default: RETRY.MAX_ATTEMPTS_MEDIUM,
      min: 0,
      max: 10,
      description: 'Number of retry attempts for failed operations'
    },
    /** Initial retry delay in milliseconds */
    retryDelay: {
      type: 'number',
      default: RETRY.INITIAL_DELAY,
      min: 100,
      max: 30000,
      description: 'Initial delay between retry attempts (ms)'
    },
    /** Image analysis timeout (longer for vision models) */
    imageAnalysisTimeout: {
      type: 'number',
      default: CONFIG_DEFAULT_TIMEOUTS.IMAGE_ANALYSIS,
      min: 10000,
      max: 600000,
      description: 'Image analysis timeout (ms)'
    },
    /** Embedding vector dimension (model-dependent: 768 for embeddinggemma, 1024 for mxbai-embed-large) */
    embeddingDimension: {
      type: 'number',
      default: AI_DEFAULTS?.EMBEDDING?.DIMENSIONS ?? 768,
      min: 128,
      max: 4096,
      description: 'Embedding vector dimension for current model'
    }
  },

  /**
   * Performance Configuration
   * Caching, throttling, and optimization settings
   */
  PERFORMANCE: {
    /** Maximum cache size for file analysis */
    fileCacheSize: {
      type: 'number',
      default: CACHE.MAX_FILE_CACHE,
      min: 0,
      max: 10000,
      description: 'Maximum cached file analysis results'
    },
    /** Maximum cache size for embeddings */
    embeddingCacheSize: {
      type: 'number',
      default: CACHE.MAX_EMBEDDING_CACHE,
      min: 0,
      max: 50000,
      description: 'Maximum cached embeddings'
    },
    /** Cache TTL for short-lived entries (ms) */
    cacheTtlShort: {
      type: 'number',
      default: CACHE.TTL_SHORT,
      min: 1000,
      max: 3600000,
      description: 'Short cache TTL (ms)'
    },
    /** Cache TTL for medium-lived entries (ms) */
    cacheTtlMedium: {
      type: 'number',
      default: CACHE.TTL_MEDIUM,
      min: 1000,
      max: 86400000,
      description: 'Medium cache TTL (ms)'
    },
    /** Cache TTL for long-lived entries (ms) */
    cacheTtlLong: {
      type: 'number',
      default: CACHE.TTL_LONG,
      min: 1000,
      max: 604800000,
      description: 'Long cache TTL (ms)'
    },
    /** Debounce delay for UI input (ms) */
    debounceMs: {
      type: 'number',
      default: PERF_TIMEOUTS.DEBOUNCE_INPUT,
      min: 50,
      max: 2000,
      description: 'UI input debounce delay (ms)'
    },
    /** Throttle delay for frequent operations (ms) */
    throttleMs: {
      type: 'number',
      default: 100,
      min: 10,
      max: 5000,
      description: 'Operation throttle delay (ms)'
    },
    /** Health check interval (ms) */
    healthCheckInterval: {
      type: 'number',
      default: CONFIG_DEFAULT_TIMEOUTS.HEALTH_CHECK_INTERVAL,
      min: 10000,
      max: 600000,
      description: 'Health check interval (ms)'
    },
    /** Maximum concurrent network operations */
    maxConcurrentNetwork: {
      type: 'number',
      default: BATCH.MAX_CONCURRENT_NETWORK,
      min: 1,
      max: 50,
      description: 'Maximum concurrent network operations'
    },
    /** Chroma query cache size */
    queryCacheSize: {
      type: 'number',
      default: 200,
      min: 0,
      max: 5000,
      description: 'Maximum cached ChromaDB query results'
    },
    /** Delay for batching insert operations (ms) */
    batchInsertDelay: {
      type: 'number',
      default: 100,
      min: 0,
      max: 5000,
      description: 'Delay before flushing batched ChromaDB inserts (ms)'
    }
  },

  /**
   * ChromaDB Service Configuration
   * Service-specific timeouts and limits
   */
  CHROMADB: {
    /** Timeout for ChromaDB operations (ms) */
    operationTimeout: {
      type: 'number',
      default: 30000,
      envVar: 'CHROMADB_OPERATION_TIMEOUT',
      min: 1000,
      max: 300000,
      description: 'Timeout for ChromaDB operations (ms)'
    },
    /** Timeout for ChromaDB initialization (ms) */
    initTimeout: {
      type: 'number',
      default: 60000,
      envVar: 'CHROMADB_INIT_TIMEOUT',
      min: 5000,
      max: 600000,
      description: 'Timeout for ChromaDB initialization (ms)'
    },
    /** Maximum in-flight ChromaDB queries */
    maxInflightQueries: {
      type: 'number',
      default: 100,
      envVar: 'CHROMADB_MAX_INFLIGHT_QUERIES',
      min: 10,
      max: 1000,
      description: 'Maximum in-flight ChromaDB queries'
    }
  },

  /**
   * Circuit Breaker Configuration
   * Settings for ChromaDB circuit breaker fault tolerance
   */
  CIRCUIT_BREAKER: {
    /** Number of consecutive failures before opening the circuit */
    failureThreshold: {
      type: 'number',
      default: 5,
      envVar: 'CHROMADB_CIRCUIT_FAILURE_THRESHOLD',
      min: 1,
      max: 20,
      description: 'Failures before opening circuit'
    },
    /** Number of successes in half-open state before closing circuit */
    successThreshold: {
      type: 'number',
      default: 2,
      envVar: 'CHROMADB_CIRCUIT_SUCCESS_THRESHOLD',
      min: 1,
      max: 10,
      description: 'Successes needed to close circuit'
    },
    /** Time in ms before attempting recovery when circuit is open */
    timeout: {
      type: 'number',
      default: 30000,
      envVar: 'CHROMADB_CIRCUIT_TIMEOUT',
      min: 5000,
      max: 300000,
      description: 'Recovery timeout (ms)'
    },
    /** Time in ms before resetting failure count in closed state */
    resetTimeout: {
      type: 'number',
      default: 60000,
      envVar: 'CHROMADB_CIRCUIT_RESET_TIMEOUT',
      min: 10000,
      max: 600000,
      description: 'Failure count reset timeout (ms)'
    },
    /** Maximum operations to queue when circuit is open */
    maxQueueSize: {
      type: 'number',
      default: 1000,
      envVar: 'CHROMADB_MAX_QUEUE_SIZE',
      min: 100,
      max: 10000,
      description: 'Maximum queued operations'
    }
  },

  /**
   * File Limits Configuration
   * Size limits and constraints for file operations
   */
  FILE_LIMITS: {
    /** Maximum text file size (bytes) */
    maxTextFileSize: {
      type: 'number',
      default: FILE_SIZE_LIMITS.MAX_TEXT_FILE_SIZE,
      min: 1024,
      max: 1073741824, // 1GB
      description: 'Maximum text file size (bytes)'
    },
    /** Maximum image file size (bytes) */
    maxImageFileSize: {
      type: 'number',
      default: FILE_SIZE_LIMITS.MAX_IMAGE_FILE_SIZE,
      min: 1024,
      max: 1073741824,
      description: 'Maximum image file size (bytes)'
    },
    /** Maximum document file size (bytes) */
    maxDocumentFileSize: {
      type: 'number',
      default: FILE_SIZE_LIMITS.MAX_DOCUMENT_FILE_SIZE,
      min: 1024,
      max: 1073741824,
      description: 'Maximum document file size (bytes)'
    },
    /** Maximum path length */
    maxPathLength: {
      type: 'number',
      default: FS_LIMITS.MAX_PATH_LENGTH,
      min: 100,
      max: 4096,
      description: 'Maximum file path length'
    }
  },

  /**
   * Thresholds Configuration
   * Confidence and scoring thresholds
   */
  THRESHOLDS: {
    /** Single confidence threshold for auto-organization */
    confidenceThreshold: {
      type: 'number',
      default: DEFAULT_SETTINGS.confidenceThreshold,
      min: 0,
      max: 1,
      description: 'Minimum confidence required to auto-organize files'
    },
    /** Minimum similarity score for matching */
    minSimilarityScore: {
      type: 'number',
      default: THRESHOLDS.MIN_SIMILARITY_SCORE,
      min: 0,
      max: 1,
      description: 'Minimum similarity score for folder matching'
    },
    /** High confidence threshold */
    confidenceHigh: {
      type: 'number',
      default: THRESHOLDS.CONFIDENCE_HIGH,
      min: 0,
      max: 1,
      description: 'High confidence threshold'
    },
    /** Medium confidence threshold */
    confidenceMedium: {
      type: 'number',
      default: THRESHOLDS.CONFIDENCE_MEDIUM,
      min: 0,
      max: 1,
      description: 'Medium confidence threshold'
    }
  },

  /**
   * Feature Flags Configuration
   * Enable/disable features
   */
  FEATURES: {
    /** Enable telemetry collection */
    enableTelemetry: {
      type: 'boolean',
      default: false,
      envVar: 'STRATOSORT_ENABLE_TELEMETRY',
      description: 'Enable anonymous telemetry collection'
    },
    /** Enable debug mode */
    debugMode: {
      type: 'boolean',
      default: false,
      envVar: 'STRATOSORT_DEBUG',
      description: 'Enable debug mode with verbose logging'
    },
    /** Disable ChromaDB entirely */
    disableChromaDB: {
      type: 'boolean',
      default: false,
      envVar: 'STRATOSORT_DISABLE_CHROMADB',
      description: 'Disable ChromaDB vector database'
    },
    /** Force DevTools open on start */
    forceDevTools: {
      type: 'boolean',
      default: false,
      envVar: 'FORCE_DEV_TOOLS',
      description: 'Force DevTools open on application start'
    },
    /** Enable auto-organize feature */
    autoOrganize: {
      type: 'boolean',
      default: DEFAULT_SETTINGS.autoOrganize,
      description: 'Enable automatic file organization'
    },
    /** Enable background mode */
    backgroundMode: {
      type: 'boolean',
      default: DEFAULT_SETTINGS.backgroundMode,
      description: 'Enable background processing mode'
    },
    /** Redact file/folder paths in the UI (for demos/recordings) */
    redactPaths: {
      type: 'boolean',
      default: false,
      envVar: 'STRATOSORT_REDACT_PATHS',
      description: 'Redact file/folder paths in the UI (for demos/recordings)'
    }
  },

  /**
   * UI Configuration
   * User interface settings
   */
  UI: {
    /** Enable notifications */
    notifications: {
      type: 'boolean',
      default: DEFAULT_SETTINGS.notifications,
      description: 'Enable desktop notifications'
    },
    /** Workflow restore max age (ms) */
    workflowRestoreMaxAge: {
      type: 'number',
      default: DEFAULT_SETTINGS.workflowRestoreMaxAge,
      min: 60000,
      max: 86400000,
      description: 'Maximum age for workflow state restoration (ms)'
    },
    /** Auto-save debounce delay (ms) */
    saveDebounceMs: {
      type: 'number',
      default: DEFAULT_SETTINGS.saveDebounceMs,
      min: 100,
      max: 10000,
      description: 'Debounce delay for auto-save operations (ms)'
    }
  },

  /**
   * Environment Configuration
   * Node.js and runtime environment settings
   */
  ENV: {
    /** Node environment */
    nodeEnv: {
      type: 'enum',
      default: 'production',
      envVar: 'NODE_ENV',
      values: ['development', 'production', 'test'],
      description: 'Node.js environment mode'
    },
    /** CI environment flag */
    isCI: {
      type: 'boolean',
      default: false,
      envVar: 'CI',
      description: 'Running in CI environment'
    }
  }
};

/**
 * Sensitive configuration keys that should be redacted in dumps
 */
const SENSITIVE_KEYS = ['password', 'secret', 'token', 'apiKey', 'api_key', 'credentials'];

/**
 * Deprecated configuration mappings
 * Maps old config keys to new keys for backward compatibility
 */
const DEPRECATED_MAPPINGS = {
  OLLAMA_HOST: 'SERVER.ollamaUrl',
  selectedModel: 'MODELS.textModel',
  selectedVisionModel: 'MODELS.visionModel',
  selectedEmbeddingModel: 'MODELS.embeddingModel'
};

module.exports = {
  CONFIG_SCHEMA,
  SENSITIVE_KEYS,
  DEPRECATED_MAPPINGS
};
