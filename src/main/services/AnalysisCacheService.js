const crypto = require('crypto');
const { logger } = require('../../shared/logger');
const { createSingletonHelpers } = require('../../shared/singletonFactory');
const { getInstance: getCacheInvalidationBus } = require('../../shared/cacheInvalidation');
const { LRUCache } = require('../../shared/LRUCache');

logger.setContext('AnalysisCacheService');

/**
 * Default configurations for different cache types
 * @type {Object}
 */
const CACHE_TYPE_DEFAULTS = {
  document: { maxEntries: 500, ttlMs: 30 * 60 * 1000, name: 'documentCache' },
  image: { maxEntries: 300, ttlMs: 30 * 60 * 1000, name: 'imageCache' },
  llm: { maxEntries: 200, ttlMs: 60 * 60 * 1000, name: 'llmCache' }
};

/**
 * Signature version for cache key generation
 * Increment when changing signature format to invalidate old caches
 */
const SIGNATURE_VERSION = 'v2';

/**
 * Analysis Cache Service
 *
 * Wraps LRUCache with analysis-specific key generation and
 * cache invalidation bus integration.
 *
 * Stage 3 Refactoring: Consolidated onto shared LRUCache to eliminate
 * duplicate LRU/TTL logic (previously ~100 lines of manual Map management).
 */
class AnalysisCacheService {
  /**
   * Create an analysis cache service
   * @param {Object} [options={}] - Configuration options
   * @param {number} [options.maxEntries=200] - Maximum number of entries to cache
   * @param {number} [options.ttlMs=3600000] - Time-to-live in milliseconds (default 1 hour)
   * @param {string} [options.name='AnalysisCache'] - Name for logging
   */
  constructor(options = {}) {
    this.maxEntries = options.maxEntries || 200;
    this.ttlMs = options.ttlMs || 3600000; // 1 hour default
    this.name = options.name || 'AnalysisCache';

    // Use shared LRUCache with access-based LRU (true LRU behavior)
    this._cache = new LRUCache({
      maxSize: this.maxEntries,
      ttlMs: this.ttlMs,
      lruStrategy: 'access',
      name: this.name
    });

    this._unsubscribe = null;

    // Subscribe to cache invalidation bus for coordinated invalidation
    this._subscribeToInvalidationBus();
  }

  /**
   * Internal cache access for compatibility with existing code
   * @returns {Map} The underlying cache Map
   */
  get cache() {
    return this._cache.cache;
  }

  /**
   * Subscribe to the cache invalidation bus
   * This ensures cache is cleared when files are moved, deleted, or renamed
   * @private
   */
  _subscribeToInvalidationBus() {
    // FIX #4: Track subscription attempt to ensure cleanup on failure
    let subscriptionAttempted = false;
    try {
      const bus = getCacheInvalidationBus();
      subscriptionAttempted = true;
      this._unsubscribe = bus.subscribe(this.name, {
        onInvalidate: (event) => {
          if (event.type === 'full-invalidate') {
            this.clear();
          }
        },
        onPathChange: (oldPath) => {
          // Invalidate any cache entries that reference the old path
          this._invalidateForPath(oldPath);
        },
        onDeletion: (filePath) => {
          this._invalidateForPath(filePath);
        },
        onBatch: (changes) => {
          // For batch operations, invalidate all affected paths
          for (const change of changes) {
            this._invalidateForPath(change.oldPath);
          }
        }
      });
      logger.debug(`[${this.name}] Subscribed to cache invalidation bus`);
    } catch (error) {
      logger.warn(`[${this.name}] Failed to subscribe to cache invalidation bus:`, error.message);
      // FIX #4: If subscription was attempted but failed, ensure _unsubscribe is a no-op
      // to prevent null reference errors in shutdown()
      if (subscriptionAttempted && !this._unsubscribe) {
        this._unsubscribe = () => {}; // Safe no-op to prevent memory leaks on retry
      }
    }
  }

  /**
   * Invalidate cache entries that reference a specific file path
   * Uses LRUCache's invalidateWhere() for efficient path-based invalidation
   * @param {string} filePath - Path to invalidate
   * @private
   */
  _invalidateForPath(filePath) {
    if (!filePath) return;

    const invalidated = this._cache.invalidateWhere((key) => key.includes(filePath));

    if (invalidated > 0) {
      logger.debug(`[${this.name}] Invalidated ${invalidated} entries for path change`);
    }
  }

  /**
   * Generate a cache key for text content and analysis options
   * @param {string} textContent - Text content to hash
   * @param {string} model - Model name
   * @param {Array} smartFolders - Smart folder configurations
   * @returns {string} Cache key hash
   */
  generateKey(textContent, model, smartFolders) {
    // Limit input size to prevent excessive hash computation
    const MAX_TEXT_LENGTH = 50000; // 50KB max for hash key
    const truncatedText =
      textContent?.length > MAX_TEXT_LENGTH ? textContent.slice(0, MAX_TEXT_LENGTH) : textContent;

    // FIX: Use SHA256 instead of deprecated SHA1
    const hasher = crypto.createHash('sha256');
    // Include original length to prevent hash collision
    hasher.update(`${textContent?.length || 0}:`);
    hasher.update(truncatedText || '');
    hasher.update('|');
    hasher.update(String(model || ''));
    hasher.update('|');
    try {
      const foldersKey = Array.isArray(smartFolders)
        ? smartFolders
            .map((f) => `${f?.name || ''}:${(f?.description || '').slice(0, 64)}`)
            .join(',')
        : '';
      hasher.update(foldersKey);
    } catch (error) {
      // Expected: Continue with partial key if folder data is malformed
    }
    return hasher.digest('hex');
  }

  /**
   * Generate a file signature for caching based on file metadata
   * This signature includes model and smart folder configuration to ensure
   * cache invalidation when analysis parameters change.
   *
   * @param {string} filePath - File path
   * @param {Object} stats - File stats object (must have size and mtimeMs)
   * @param {string} [modelName=''] - Model name for analysis
   * @param {string} [smartFolderSig=''] - Smart folder signature string
   * @returns {string|null} File signature or null if stats are invalid
   */
  generateFileSignature(filePath, stats, modelName = '', smartFolderSig = '') {
    if (!stats) return null;
    return `${SIGNATURE_VERSION}|${modelName}|${smartFolderSig}|${filePath}|${stats.size}|${stats.mtimeMs}`;
  }

  /**
   * Get a cached value by key
   * Implements LRU behavior by refreshing timestamp on access (via LRUCache)
   *
   * @param {string} key - Cache key
   * @returns {*} Cached value or null if not found or expired
   */
  get(key) {
    return this._cache.get(key);
  }

  /**
   * Set a cached value
   * Implements LRU eviction when at capacity (via LRUCache)
   *
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   */
  set(key, value) {
    this._cache.set(key, value);
  }

  /**
   * Check if a key exists and is not expired
   * @param {string} key - Cache key
   * @returns {boolean} True if key exists and is valid
   */
  has(key) {
    return this._cache.has(key);
  }

  /**
   * Delete a specific cache entry
   * @param {string} key - Cache key
   * @returns {boolean} True if entry was deleted, false if key didn't exist
   */
  delete(key) {
    // FIX #10: Return actual deletion result instead of always true
    return this._cache.delete(key);
  }

  /**
   * Clear all cached entries
   */
  clear() {
    const size = this._cache.size;
    this._cache.clear();
    logger.debug(`[${this.name}] Cache cleared`, { entriesCleared: size });
  }

  /**
   * Evict expired entries from the cache
   * Call periodically to clean up memory
   *
   * @returns {number} Number of entries evicted
   */
  evictExpired() {
    const sizeBefore = this._cache.size;
    this._cache.cleanup();
    const evicted = sizeBefore - this._cache.size;

    if (evicted > 0) {
      logger.debug(`[${this.name}] Evicted expired entries`, { count: evicted });
    }

    return evicted;
  }

  /**
   * Get cache statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      name: this.name,
      size: this._cache.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs
    };
  }

  /**
   * Shutdown and clear the cache
   */
  shutdown() {
    // Unsubscribe from cache invalidation bus
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    this.clear();
    logger.debug(`[${this.name}] Cache shutdown complete`);
  }
}

/**
 * Factory function to create type-specific analysis caches
 * with appropriate defaults for different analysis types.
 *
 * @param {'document' | 'image' | 'llm'} type - Cache type
 * @param {Object} [options={}] - Override options
 * @returns {AnalysisCacheService} Configured cache instance
 *
 * @example
 * const docCache = createAnalysisCache('document');
 * const imgCache = createAnalysisCache('image', { maxEntries: 500 });
 */
function createAnalysisCache(type, options = {}) {
  const defaults = CACHE_TYPE_DEFAULTS[type] || CACHE_TYPE_DEFAULTS.llm;
  return new AnalysisCacheService({ ...defaults, ...options });
}

// Use shared singleton factory for the default LLM cache instance
const { getInstance, createInstance, registerWithContainer, resetInstance } =
  createSingletonHelpers({
    ServiceClass: AnalysisCacheService,
    serviceId: 'ANALYSIS_CACHE',
    serviceName: 'AnalysisCacheService',
    containerPath: './ServiceContainer',
    shutdownMethod: 'shutdown'
  });

let _imageAnalysisCacheInstance = null;

function getImageAnalysisCache() {
  if (!_imageAnalysisCacheInstance) {
    _imageAnalysisCacheInstance = new AnalysisCacheService(CACHE_TYPE_DEFAULTS.image);
  }
  return _imageAnalysisCacheInstance;
}

module.exports = AnalysisCacheService;
module.exports.getInstance = getInstance;
module.exports.createInstance = createInstance;
module.exports.registerWithContainer = registerWithContainer;
module.exports.resetInstance = resetInstance;
module.exports.createAnalysisCache = createAnalysisCache;
module.exports.getImageAnalysisCache = getImageAnalysisCache;
module.exports.CACHE_TYPE_DEFAULTS = CACHE_TYPE_DEFAULTS;
module.exports.SIGNATURE_VERSION = SIGNATURE_VERSION;
