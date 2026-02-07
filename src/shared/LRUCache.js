/**
 * Unified LRU Cache with TTL Support
 *
 * High-performance cache implementation consolidating patterns from:
 * - EmbeddingCache: access-time based LRU, metrics, lifecycle
 * - Vector query cache: simple Map-based LRU, domain invalidation
 *
 * @module shared/LRUCache
 */

// FIX: Robust logger import with fallback for cross-process safety
let logger;
try {
  const loggerModule = require('./logger');
  logger = loggerModule.createLogger ? loggerModule.createLogger('LRUCache') : loggerModule.logger;
} catch {
  logger = {
    debug: () => {},
    info: () => {},
    // eslint-disable-next-line no-console
    warn: console.warn.bind(console, '[LRUCache]'),
    // eslint-disable-next-line no-console
    error: console.error.bind(console, '[LRUCache]')
  };
}

/**
 * LRU Cache with optional TTL, metrics, and lifecycle management
 *
 * Uses Map for ordered iteration and efficient O(1) operations.
 * Supports two LRU strategies:
 * - 'access': True LRU based on access time (more accurate, slightly more overhead)
 * - 'insertion': LRU based on insertion order (simpler, uses Map natural order)
 */
class LRUCache {
  /**
   * @param {Object} options - Cache configuration
   * @param {number} options.maxSize - Maximum cache entries (default: 200)
   * @param {number} options.ttlMs - Time-to-live in milliseconds (default: 120000 = 2 min)
   * @param {string} options.lruStrategy - 'access' or 'insertion' (default: 'insertion')
   * @param {boolean} options.trackMetrics - Enable hit/miss/eviction tracking (default: false)
   * @param {string} options.name - Cache name for logging (default: 'LRUCache')
   */
  constructor(options = {}) {
    this.cache = new Map();

    this.maxSize = this._parseOption(options.maxSize, 200);
    this.ttlMs = this._parseOption(options.ttlMs, 120000);
    this.lruStrategy = options.lruStrategy || 'insertion';
    this.trackMetrics = options.trackMetrics ?? false;
    this.name = options.name || 'LRUCache';

    // Metrics (only allocated if tracking enabled)
    if (this.trackMetrics) {
      this.metrics = {
        hits: 0,
        misses: 0,
        evictions: 0
      };
    }

    // Monotonic counter for access-based LRU (more reliable than Date.now())
    this._accessCounter = 0;

    // Lifecycle state
    this.cleanupInterval = null;
    this.initialized = false;
  }

  /**
   * Parse option value with environment variable fallback
   * @private
   */
  _parseOption(value, defaultValue) {
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
    return defaultValue;
  }

  /**
   * Initialize cache with optional cleanup interval
   * @param {number} cleanupIntervalMs - Cleanup interval in ms (default: 300000 = 5 min)
   */
  initialize(cleanupIntervalMs = 300000) {
    if (this.initialized) {
      return;
    }

    if (cleanupIntervalMs > 0) {
      this.cleanupInterval = setInterval(() => this.cleanup(), cleanupIntervalMs);

      // Allow process to exit with active interval
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }
    }

    this.initialized = true;
    logger.debug(`[${this.name}] Initialized`, {
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      lruStrategy: this.lruStrategy
    });
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {*} Cached value or null if not found/expired
   */
  get(key) {
    const entry = this.cache.get(key);

    if (!entry) {
      if (this.trackMetrics) this.metrics.misses++;
      return null;
    }

    // Check TTL expiry
    if (this._isExpired(entry)) {
      this.cache.delete(key);
      if (this.trackMetrics) this.metrics.misses++;
      return null;
    }

    // Update access order: delete and re-insert so Map iteration order reflects recency
    if (this.lruStrategy === 'access') {
      entry.accessSeq = ++this._accessCounter;
      this.cache.delete(key);
      this.cache.set(key, entry);
    }

    if (this.trackMetrics) this.metrics.hits++;
    return entry.data;
  }

  /**
   * Store value in cache
   * @param {string} key - Cache key
   * @param {*} data - Data to cache
   */
  set(key, data) {
    // Delete existing entry to update Map insertion order for both strategies.
    // Map.set() on an existing key preserves position, so we must delete first
    // to ensure the re-inserted entry moves to the end (most-recent position).
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict if at capacity
    if (this.cache.size >= this.maxSize) {
      this._evictOne();
    }

    const now = Date.now();
    this.cache.set(key, {
      data,
      timestamp: now,
      accessSeq: ++this._accessCounter
    });
  }

  /**
   * Peek at a cache entry without side effects.
   * Does not update LRU ordering or metrics.
   * @param {string} key - Cache key
   * @returns {*} Cached value or undefined if not found/expired
   * @private
   */
  _peek(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (this._isExpired(entry)) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data;
  }

  /**
   * Check if key exists and is not expired
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    return this._peek(key) !== undefined;
  }

  /**
   * Delete a specific cache entry
   * @param {string} key - Cache key
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Invalidate entries matching a predicate
   * @param {Function} predicate - Function(key) => boolean
   */
  invalidateWhere(predicate) {
    const keysToDelete = [];
    for (const key of this.cache.keys()) {
      if (predicate(key)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => this.cache.delete(key));
    return keysToDelete.length;
  }

  /**
   * Clear all cache entries
   */
  clear() {
    const previousSize = this.cache.size;
    this.cache.clear();

    if (this.trackMetrics) {
      this.metrics.hits = 0;
      this.metrics.misses = 0;
      this.metrics.evictions = 0;
    }

    logger.debug(`[${this.name}] Cleared`, { entriesCleared: previousSize });
  }

  /**
   * Remove expired entries
   */
  cleanup() {
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (this._isExpired(entry)) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`[${this.name}] Cleaned expired entries`, {
        cleaned,
        remaining: this.cache.size
      });
    }
  }

  /**
   * Shutdown cache and cleanup resources
   */
  async shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    const stats = this.getStats();
    logger.debug(`[${this.name}] Shutdown`, stats);

    this.cache.clear();
    this.initialized = false;
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    const stats = {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs
    };

    if (this.trackMetrics) {
      const total = this.metrics.hits + this.metrics.misses;
      const hitRate = total > 0 ? (this.metrics.hits / total) * 100 : 0;

      stats.hits = this.metrics.hits;
      stats.misses = this.metrics.misses;
      stats.evictions = this.metrics.evictions;
      stats.hitRate = `${hitRate.toFixed(2)}%`;
    }

    return stats;
  }

  /**
   * Get current cache size
   * @returns {number}
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Check if entry is expired
   * @private
   */
  _isExpired(entry) {
    return Date.now() - entry.timestamp > this.ttlMs;
  }

  /**
   * Evict one entry based on LRU strategy
   * @private
   */
  _evictOne() {
    // Both strategies now use Map insertion order (O(1)):
    // - 'insertion': first entry is oldest by insertion
    // - 'access': get() re-inserts on access, so first entry is least-recently-used
    const keyToEvict = this.cache.keys().next().value;

    if (keyToEvict) {
      this.cache.delete(keyToEvict);
      if (this.trackMetrics) this.metrics.evictions++;
    }
  }
}

module.exports = { LRUCache };
