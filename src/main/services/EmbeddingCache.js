const crypto = require('crypto');
const { LRUCache } = require('../../shared/LRUCache');
const { logger } = require('../../shared/logger');
const { CACHE } = require('../../shared/performanceConstants');
const { get: getConfig } = require('../../shared/config/index');

logger.setContext('EmbeddingCache');

/**
 * High-performance LRU cache for embedding vectors with TTL support
 * Dramatically reduces AI API calls by caching previously computed embeddings
 *
 * Uses shared LRUCache with embedding-specific key generation and metrics.
 */
class EmbeddingCache {
  /**
   * Create a new EmbeddingCache instance
   * @param {Object} options - Configuration options
   * @param {number} options.maxSize - Maximum number of entries (default: 500)
   * @param {number} options.ttlMs - Time to live in milliseconds (default: 5 minutes)
   */
  constructor(options = {}) {
    this.maxSize = options.maxSize || 500;
    this.ttlMs = options.ttlMs || CACHE.TTL_SHORT;

    this._cache = new LRUCache({
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      lruStrategy: 'access',
      trackMetrics: true,
      name: 'EmbeddingCache'
    });

    // Track size separately for metrics (updated on set)
    this._currentSize = 0;

    logger.info('[EmbeddingCache] Created', {
      maxSize: this.maxSize,
      ttlMinutes: this.ttlMs / 60000
    });
  }

  /**
   * Initialize the cache and start cleanup interval
   * Should be called after successful service initialization
   */
  initialize() {
    this._cache.initialize(300000); // 5 minute cleanup interval

    logger.info('[EmbeddingCache] Initialized with cleanup interval', {
      maxSize: this.maxSize,
      ttlMinutes: this.ttlMs / 60000
    });
  }

  /**
   * Check if cache is initialized
   */
  get initialized() {
    return this._cache.initialized;
  }

  /**
   * Get cleanup interval (for testing)
   */
  get cleanupInterval() {
    return this._cache.cleanupInterval;
  }

  /**
   * Generate cache key from text and model
   * Uses SHA256 hash for collision resistance
   * @param {string} text - The text to embed
   * @param {string} model - The model name
   * @returns {string} - Cache key
   */
  generateKey(text, model) {
    // Normalize text to improve cache hit rate
    const normalized = text.trim().toLowerCase();
    return crypto.createHash('sha256').update(`${normalized}:${model}`).digest('hex');
  }

  /**
   * Get embedding from cache
   * @param {string} text - The text to look up
   * @param {string} model - The model name
   * @returns {Object|null} - Cached result or null if not found/expired
   */
  get(text, model) {
    const key = this.generateKey(text, model);
    const entry = this._cache.get(key);

    if (!entry) {
      return null;
    }

    logger.debug('[EmbeddingCache] Cache hit', {
      textLength: text.length,
      model
    });

    return { vector: entry.vector, model: entry.model };
  }

  /**
   * Store embedding in cache
   * @param {string} text - The original text
   * @param {string} model - The model name
   * @param {Array<number>} vector - The embedding vector
   */
  set(text, model, vector) {
    // Validate inputs
    if (!text || !model || !vector || !Array.isArray(vector)) {
      logger.warn('[EmbeddingCache] Invalid input to set()', {
        hasText: !!text,
        hasModel: !!model,
        hasVector: !!vector,
        isArray: Array.isArray(vector)
      });
      return;
    }

    const key = this.generateKey(text, model);

    this._cache.set(key, { vector, model });
    this._currentSize = this._cache.size;

    logger.debug('[EmbeddingCache] Cached embedding', {
      textLength: text.length,
      model,
      vectorDim: vector.length,
      cacheSize: this._cache.size
    });
  }

  /**
   * Remove expired entries
   * Called automatically via interval
   */
  cleanup() {
    this._cache.cleanup();
    this._currentSize = this._cache.size;
  }

  /**
   * Get cache statistics
   * @returns {Object} - Statistics object with metrics and hit rate
   */
  getStats() {
    const baseStats = this._cache.getStats();

    // Estimate memory usage dynamically based on configured embedding dimension
    // FIX: Use 4 bytes per float (float32) instead of 8 (embeddings use single precision)
    const embeddingDim = getConfig('ANALYSIS.embeddingDimension', 768);
    const bytesPerEntry = embeddingDim * 4 + 200; // vector float32s + metadata overhead
    const estimatedBytes = this._cache.size * bytesPerEntry;
    const estimatedMB = estimatedBytes / (1024 * 1024);

    return {
      hits: baseStats.hits,
      misses: baseStats.misses,
      evictions: baseStats.evictions,
      size: this._cache.size,
      hitRate: baseStats.hitRate,
      estimatedMB: `${estimatedMB.toFixed(2)} MB`,
      maxSize: this.maxSize,
      ttlMinutes: this.ttlMs / 60000
    };
  }

  /**
   * Get internal metrics (for compatibility)
   */
  get metrics() {
    const stats = this._cache.getStats();
    return {
      hits: stats.hits || 0,
      misses: stats.misses || 0,
      evictions: stats.evictions || 0,
      size: this._cache.size
    };
  }

  /**
   * Clear all cache entries and reset metrics
   */
  clear() {
    const previousSize = this._cache.size;
    this._cache.clear();
    this._currentSize = 0;

    logger.info('[EmbeddingCache] Cache cleared', {
      previousSize
    });
  }

  /**
   * Invalidate cache when embedding model changes
   * Different models produce different vector dimensions, making old cache entries invalid
   * @param {string} newModel - New model name
   * @param {string} previousModel - Previous model name
   * @returns {boolean} True if cache was invalidated
   */
  invalidateOnModelChange(newModel, previousModel) {
    if (!previousModel || newModel === previousModel) {
      return false;
    }

    logger.info('[EmbeddingCache] Model changed, invalidating cache', {
      from: previousModel,
      to: newModel,
      cachedEntries: this._cache.size
    });

    this.clear();
    return true;
  }

  /**
   * Shutdown the cache and cleanup resources
   * Should be called when the application is shutting down
   * @returns {Promise<void>}
   */
  async shutdown() {
    const stats = this.getStats();
    logger.info('[EmbeddingCache] Shutdown complete', stats);

    await this._cache.shutdown();
    this._currentSize = 0;
  }
}

module.exports = EmbeddingCache;
