/**
 * ChromaDB Query Cache
 *
 * LRU cache implementation for ChromaDB query results with TTL support.
 * Extracted from ChromaDBService for better maintainability.
 *
 * @module services/chromadb/ChromaQueryCache
 */

const { logger } = require('../../../shared/logger');
logger.setContext('ChromaDB:QueryCache');

/**
 * LRU Query Cache with TTL support
 *
 * Uses Map for ordered iteration (maintains insertion order)
 * which enables efficient LRU eviction.
 */
class ChromaQueryCache {
  /**
   * @param {Object} options - Cache configuration
   * @param {number} options.maxSize - Maximum cache entries (default: 200)
   * @param {number} options.ttlMs - Time-to-live in milliseconds (default: 120000)
   */
  constructor(options = {}) {
    this.cache = new Map();

    const envMaxSize =
      process.env.CHROMA_QUERY_CACHE_SIZE || process.env.STRATOSORT_CHROMA_CACHE_SIZE;
    const parsedMaxSize = Number.parseInt(envMaxSize, 10);

    const envTtl =
      process.env.CHROMA_QUERY_CACHE_TTL_MS || process.env.STRATOSORT_CHROMA_CACHE_TTL_MS;
    const parsedTtl = Number.parseInt(envTtl, 10);

    this.maxSize = Number.isFinite(options.maxSize)
      ? options.maxSize
      : Number.isFinite(parsedMaxSize) && parsedMaxSize > 0
        ? parsedMaxSize
        : 200;

    this.ttlMs = Number.isFinite(options.ttlMs)
      ? options.ttlMs
      : Number.isFinite(parsedTtl) && parsedTtl > 0
        ? parsedTtl
        : 120000; // 2 minutes default
  }

  /**
   * Get cached query result
   * @param {string} key - Cache key
   * @returns {*} Cached data or null if not found/expired
   */
  get(key) {
    const cached = this.cache.get(key);
    if (!cached) {
      return null;
    }

    // Check if cache entry has expired
    if (Date.now() - cached.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * Set cached query result with LRU eviction
   * @param {string} key - Cache key
   * @param {*} data - Data to cache
   */
  set(key, data) {
    // If key already exists, delete it first to update its position (LRU behavior)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest entry if cache is at capacity (Map maintains insertion order)
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    // Add new entry (will be at the end of iteration order)
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Check if key exists and is not expired
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Delete a specific cache entry
   * @param {string} key - Cache key
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Invalidate cache entries for a specific file
   * Collect keys first to avoid mutation during iteration
   * @param {string} fileId - File ID to invalidate
   */
  invalidateForFile(fileId) {
    const keysToDelete = [];
    for (const key of this.cache.keys()) {
      if (key.includes(fileId)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => this.cache.delete(key));
  }

  /**
   * Invalidate cache entries for folder queries
   * Collect keys first to avoid mutation during iteration
   */
  invalidateForFolder() {
    const keysToDelete = [];
    for (const key of this.cache.keys()) {
      if (key.startsWith('query:folders:')) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => this.cache.delete(key));
  }

  /**
   * Clear all cache entries
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    logger.info('[QueryCache] Cache cleared', { entriesCleared: size });
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs
    };
  }

  /**
   * Get current cache size
   * @returns {number}
   */
  get size() {
    return this.cache.size;
  }
}

module.exports = { ChromaQueryCache };
