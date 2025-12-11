const crypto = require('crypto');
const { logger } = require('../../shared/logger');
const { CACHE } = require('../../shared/performanceConstants');
logger.setContext('EmbeddingCache');

/**
 * High-performance LRU cache for embedding vectors with TTL support
 * Dramatically reduces AI API calls by caching previously computed embeddings
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

    // Cache storage: Map<key, {vector, model, timestamp, accessTime}>
    this.cache = new Map();

    // Metrics tracking
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0
    };

    // Fixed: Don't start interval in constructor - wait for initialize()
    // This prevents orphaned intervals if service initialization fails
    this.cleanupInterval = null;
    this.initialized = false;

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
    if (this.initialized) {
      logger.warn('[EmbeddingCache] Already initialized, skipping');
      return;
    }

    // PERFORMANCE FIX: Increased cleanup interval from 60s to 300s (5 minutes)
    // Cache cleanup doesn't need to run so frequently when app is idle
    this.cleanupInterval = setInterval(() => this.cleanup(), 300000); // 5 minutes

    // Use unref() to allow process to exit even with active interval
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }

    this.initialized = true;

    logger.info('[EmbeddingCache] Initialized with cleanup interval', {
      maxSize: this.maxSize,
      ttlMinutes: this.ttlMs / 60000
    });
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
    const entry = this.cache.get(key);

    if (!entry) {
      this.metrics.misses++;
      return null;
    }

    // Check TTL expiry
    const age = Date.now() - entry.timestamp;
    if (age > this.ttlMs) {
      this.cache.delete(key);
      this.metrics.misses++;
      logger.debug('[EmbeddingCache] Entry expired', {
        age,
        ttlMs: this.ttlMs
      });
      return null;
    }

    // Update access time for LRU tracking
    entry.accessTime = Date.now();
    this.metrics.hits++;

    logger.debug('[EmbeddingCache] Cache hit', {
      textLength: text.length,
      model,
      age
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

    // Evict LRU entry if at capacity (and not updating existing entry)
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, {
      vector,
      model,
      timestamp: Date.now(),
      accessTime: Date.now()
    });

    this.metrics.size = this.cache.size;

    logger.debug('[EmbeddingCache] Cached embedding', {
      textLength: text.length,
      model,
      vectorDim: vector.length,
      cacheSize: this.cache.size
    });
  }

  /**
   * Evict least recently used entry
   * Called automatically when cache is full
   */
  evictLRU() {
    let oldestKey = null;
    let oldestTime = Infinity;

    // Find the entry with the oldest access time
    for (const [key, entry] of this.cache.entries()) {
      if (entry.accessTime < oldestTime) {
        oldestTime = entry.accessTime;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.metrics.evictions++;
      logger.debug('[EmbeddingCache] Evicted LRU entry', {
        age: Date.now() - oldestTime
      });
    }
  }

  /**
   * Remove expired entries
   * Called automatically every minute via interval
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;
      if (age > this.ttlMs) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.metrics.size = this.cache.size;
      logger.debug('[EmbeddingCache] Cleaned expired entries', {
        cleaned,
        remaining: this.cache.size
      });
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} - Statistics object with metrics and hit rate
   */
  getStats() {
    const total = this.metrics.hits + this.metrics.misses;
    const hitRate = total > 0 ? (this.metrics.hits / total) * 100 : 0;

    // Estimate memory usage
    // Rough estimate: 1024 floats * 8 bytes per float + metadata overhead
    const bytesPerEntry = 1024 * 8 + 200; // vector + metadata
    const estimatedBytes = this.cache.size * bytesPerEntry;
    const estimatedMB = estimatedBytes / (1024 * 1024);

    return {
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      evictions: this.metrics.evictions,
      size: this.metrics.size,
      hitRate: `${hitRate.toFixed(2)}%`,
      estimatedMB: `${estimatedMB.toFixed(2)} MB`,
      maxSize: this.maxSize,
      ttlMinutes: this.ttlMs / 60000
    };
  }

  /**
   * Clear all cache entries and reset metrics
   */
  clear() {
    const previousSize = this.cache.size;
    this.cache.clear();
    this.metrics = { hits: 0, misses: 0, evictions: 0, size: 0 };

    logger.info('[EmbeddingCache] Cache cleared', {
      previousSize
    });
  }

  /**
   * Shutdown the cache and cleanup resources
   * Should be called when the application is shutting down
   * @returns {Promise<void>}
   */
  async shutdown() {
    // Clear cleanup interval if it exists
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.debug('[EmbeddingCache] Cleanup interval cleared');
    }

    // Verify interval is cleared (defensive check)
    if (this.cleanupInterval !== null) {
      logger.warn('[EmbeddingCache] Warning: cleanupInterval was not properly cleared');
      // Force clear again
      this.cleanupInterval = null;
    }

    const stats = this.getStats();
    logger.info('[EmbeddingCache] Shutdown complete', stats);

    // Always clear all cache entries, even if not initialized
    this.clear();

    this.initialized = false;
  }
}

module.exports = EmbeddingCache;
