/**
 * ChromaDB Query Cache
 *
 * LRU cache for ChromaDB query results with TTL support.
 * Uses shared LRUCache with domain-specific invalidation methods.
 *
 * @module services/chromadb/ChromaQueryCache
 */

const { LRUCache } = require('../../../shared/LRUCache');
const { logger } = require('../../../shared/logger');
const {
  getInstance: getCacheInvalidationBus,
  InvalidationType
} = require('../../../shared/cacheInvalidation');

logger.setContext('ChromaDB:QueryCache');

/**
 * ChromaDB Query Cache
 *
 * Wraps LRUCache with ChromaDB-specific invalidation methods.
 */
class ChromaQueryCache {
  /**
   * @param {Object} options - Cache configuration
   * @param {number} options.maxSize - Maximum cache entries (default: 200)
   * @param {number} options.ttlMs - Time-to-live in milliseconds (default: 120000)
   */
  constructor(options = {}) {
    // Support environment variable overrides
    const envMaxSize =
      process.env.CHROMA_QUERY_CACHE_SIZE || process.env.STRATOSORT_CHROMA_CACHE_SIZE;
    const parsedMaxSize = Number.parseInt(envMaxSize, 10);

    const envTtl =
      process.env.CHROMA_QUERY_CACHE_TTL_MS || process.env.STRATOSORT_CHROMA_CACHE_TTL_MS;
    const parsedTtl = Number.parseInt(envTtl, 10);

    const maxSize = Number.isFinite(options.maxSize)
      ? options.maxSize
      : Number.isFinite(parsedMaxSize) && parsedMaxSize > 0
        ? parsedMaxSize
        : 200;

    const ttlMs = Number.isFinite(options.ttlMs)
      ? options.ttlMs
      : Number.isFinite(parsedTtl) && parsedTtl > 0
        ? parsedTtl
        : 120000;

    this._cache = new LRUCache({
      maxSize,
      ttlMs,
      lruStrategy: 'insertion',
      name: 'ChromaQueryCache'
    });

    // Expose for compatibility
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;

    // Subscribe to cache invalidation bus for coordinated cache clearing
    this._unsubscribe = null;
    this._subscribeToInvalidationBus();
  }

  /**
   * Subscribe to the cache invalidation bus
   * @private
   */
  _subscribeToInvalidationBus() {
    try {
      const bus = getCacheInvalidationBus();
      this._unsubscribe = bus.subscribe('ChromaQueryCache', {
        onInvalidate: (event) => {
          // Full invalidation clears everything
          if (event.type === InvalidationType.FULL_INVALIDATE) {
            this.clear();
            return;
          }
        },
        onPathChange: (oldPath, newPath) => {
          // Invalidate cache entries that might contain the old path
          this._cache.invalidateWhere((key) => key.includes(oldPath));
          logger.debug('[QueryCache] Invalidated entries for path change', {
            oldPath: oldPath.split(/[/\\]/).pop(),
            newPath: newPath.split(/[/\\]/).pop()
          });
        },
        onDeletion: (filePath) => {
          // Invalidate cache entries for deleted file
          this._cache.invalidateWhere((key) => key.includes(filePath));
          logger.debug('[QueryCache] Invalidated entries for deletion', {
            file: filePath.split(/[/\\]/).pop()
          });
        },
        onBatch: (changes) => {
          // For batch operations, invalidate all affected paths
          const pathsToInvalidate = new Set();
          changes.forEach((c) => {
            pathsToInvalidate.add(c.oldPath);
          });

          this._cache.invalidateWhere((key) => {
            for (const p of pathsToInvalidate) {
              if (key.includes(p)) return true;
            }
            return false;
          });
          logger.debug('[QueryCache] Invalidated entries for batch change', {
            count: changes.length
          });
        }
      });
      logger.debug('[QueryCache] Subscribed to cache invalidation bus');
    } catch (err) {
      logger.warn('[QueryCache] Failed to subscribe to invalidation bus', {
        error: err.message
      });
    }
  }

  /**
   * Get cached query result
   * @param {string} key - Cache key
   * @returns {*} Cached data or null if not found/expired
   */
  get(key) {
    return this._cache.get(key);
  }

  /**
   * Set cached query result with LRU eviction
   * @param {string} key - Cache key
   * @param {*} data - Data to cache
   */
  set(key, data) {
    this._cache.set(key, data);
  }

  /**
   * Check if key exists and is not expired
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    return this._cache.has(key);
  }

  /**
   * Delete a specific cache entry
   * @param {string} key - Cache key
   */
  delete(key) {
    this._cache.delete(key);
  }

  /**
   * Invalidate cache entries for a specific file
   * @param {string} fileId - File ID to invalidate
   */
  invalidateForFile(fileId) {
    this._cache.invalidateWhere((key) => key.includes(fileId));
  }

  /**
   * Invalidate cache entries for folder queries
   */
  invalidateForFolder() {
    this._cache.invalidateWhere((key) => key.startsWith('query:folders:'));
  }

  /**
   * Clear all cache entries
   */
  clear() {
    const { size } = this._cache;
    this._cache.clear();
    logger.info('[QueryCache] Cache cleared', { entriesCleared: size });
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    return {
      size: this._cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs
    };
  }

  /**
   * Get current cache size
   * @returns {number}
   */
  get size() {
    return this._cache.size;
  }

  /**
   * Internal cache access for testing
   * @returns {Map}
   */
  get cache() {
    return this._cache.cache;
  }

  /**
   * Dispose the cache and unsubscribe from invalidation bus
   */
  dispose() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    this.clear();
  }
}

module.exports = { ChromaQueryCache };
