/**
 * Cache management utilities for performance optimization
 * Provides various caching strategies for expensive operations
 */

const { logger } = require('../../shared/logger');

/**
 * Creates an LRU (Least Recently Used) cache
 *
 * @param {Object} options - Cache configuration
 * @param {number} options.maxSize - Maximum number of entries
 * @param {number} options.ttl - Time to live in milliseconds
 * @param {Function} options.onEvict - Callback when item is evicted
 * @returns {Object} Cache instance with get, set, has, delete, clear methods
 */
function createLRUCache(options = {}) {
  const { maxSize = 100, ttl = 3600000, onEvict } = options;
  const cache = new Map();
  const accessOrder = new Map();

  /**
   * Update access time for LRU tracking
   */
  function updateAccess(key) {
    accessOrder.delete(key);
    accessOrder.set(key, Date.now());
  }

  /**
   * Check if entry is expired
   */
  function isExpired(entry) {
    return ttl > 0 && Date.now() - entry.timestamp > ttl;
  }

  /**
   * Evict oldest entry
   */
  function evictOldest() {
    const oldestKey = accessOrder.keys().next().value;
    if (oldestKey !== undefined) {
      const entry = cache.get(oldestKey);
      cache.delete(oldestKey);
      accessOrder.delete(oldestKey);

      if (onEvict) {
        onEvict(oldestKey, entry?.value);
      }
    }
  }

  return {
    /**
     * Get value from cache
     */
    get(key) {
      const entry = cache.get(key);
      if (!entry) return undefined;

      if (isExpired(entry)) {
        this.delete(key);
        return undefined;
      }

      updateAccess(key);
      return entry.value;
    },

    /**
     * Set value in cache
     */
    set(key, value) {
      // Remove existing entry to update position
      if (cache.has(key)) {
        accessOrder.delete(key);
      }

      // Evict if at capacity
      while (cache.size >= maxSize) {
        evictOldest();
      }

      cache.set(key, {
        value,
        timestamp: Date.now(),
      });
      updateAccess(key);
    },

    /**
     * Check if key exists and is not expired
     */
    has(key) {
      const entry = cache.get(key);
      if (!entry) return false;

      if (isExpired(entry)) {
        this.delete(key);
        return false;
      }

      return true;
    },

    /**
     * Delete entry from cache
     */
    delete(key) {
      const entry = cache.get(key);
      const deleted = cache.delete(key);
      accessOrder.delete(key);

      if (deleted && onEvict) {
        onEvict(key, entry?.value);
      }

      return deleted;
    },

    /**
     * Clear all entries
     */
    clear() {
      if (onEvict) {
        for (const [key, entry] of cache.entries()) {
          onEvict(key, entry.value);
        }
      }
      cache.clear();
      accessOrder.clear();
    },

    /**
     * Get cache statistics
     */
    stats() {
      let expired = 0;
      for (const entry of cache.values()) {
        if (isExpired(entry)) expired++;
      }

      return {
        size: cache.size,
        maxSize,
        ttl,
        expired,
        utilization: (cache.size / maxSize) * 100,
      };
    },

    /**
     * Clean up expired entries
     */
    prune() {
      const keys = Array.from(cache.keys());
      let pruned = 0;

      for (const key of keys) {
        const entry = cache.get(key);
        if (entry && isExpired(entry)) {
          this.delete(key);
          pruned++;
        }
      }

      return pruned;
    },
  };
}

/**
 * Creates a memoization wrapper for functions
 *
 * @param {Function} fn - Function to memoize
 * @param {Object} options - Memoization options
 * @returns {Function} Memoized function
 */
function memoize(fn, options = {}) {
  const {
    keyResolver = (...args) => JSON.stringify(args),
    maxSize = 50,
    ttl = 300000, // 5 minutes default
  } = options;

  const cache = createLRUCache({ maxSize, ttl });

  const memoized = async function (...args) {
    const key = keyResolver(...args);

    // Check cache
    if (cache.has(key)) {
      const cached = cache.get(key);
      if (cached !== undefined) {
        return cached;
      }
    }

    // Execute function
    const result = await fn.apply(this, args);
    cache.set(key, result);
    return result;
  };

  // Attach cache management methods
  memoized.cache = cache;
  memoized.clear = () => cache.clear();
  memoized.stats = () => cache.stats();

  return memoized;
}

/**
 * Creates a batch processor that groups multiple calls
 *
 * @param {Function} processor - Function to process batch
 * @param {Object} options - Batch options
 * @returns {Object} Batch processor
 */
function createBatchProcessor(processor, options = {}) {
  const {
    maxBatchSize = 100,
    maxWaitTime = 100,
    keyExtractor = (item) => item,
  } = options;

  let batch = new Map();
  let timeoutId = null;
  let processing = false;

  async function processBatch() {
    if (processing || batch.size === 0) return;

    processing = true;
    const currentBatch = new Map(batch);
    batch.clear();

    try {
      const items = Array.from(currentBatch.keys());
      const results = await processor(items);

      // Resolve promises for each item
      for (let i = 0; i < items.length; i++) {
        const callbacks = currentBatch.get(items[i]);
        const result = results[i];

        for (const { resolve, reject } of callbacks) {
          if (result instanceof Error) {
            reject(result);
          } else {
            resolve(result);
          }
        }
      }
    } catch (error) {
      // Reject all promises on batch error
      for (const callbacks of currentBatch.values()) {
        for (const { reject } of callbacks) {
          reject(error);
        }
      }
    } finally {
      processing = false;

      // Process any items added while processing
      if (batch.size > 0) {
        scheduleProcessing();
      }
    }
  }

  function scheduleProcessing() {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (batch.size >= maxBatchSize) {
      // Process immediately if batch is full
      setImmediate(processBatch);
    } else {
      // Wait for more items or timeout
      timeoutId = setTimeout(processBatch, maxWaitTime);
    }
  }

  return {
    /**
     * Add item to batch
     */
    add(item) {
      return new Promise((resolve, reject) => {
        const key = keyExtractor(item);

        if (!batch.has(key)) {
          batch.set(key, []);
        }

        batch.get(key).push({ resolve, reject });

        if (!processing) {
          scheduleProcessing();
        }
      });
    },

    /**
     * Flush pending batch
     */
    async flush() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      await processBatch();
    },

    /**
     * Get batch statistics
     */
    stats() {
      return {
        pendingItems: batch.size,
        processing,
        maxBatchSize,
        maxWaitTime,
      };
    },
  };
}

/**
 * Creates a result cache with automatic refresh
 *
 * @param {Function} fetcher - Function to fetch data
 * @param {Object} options - Cache options
 * @returns {Object} Auto-refreshing cache
 */
function createAutoRefreshCache(fetcher, options = {}) {
  const {
    refreshInterval = 60000, // 1 minute
    errorRetryInterval = 5000,
    maxRetries = 3,
  } = options;

  let cache = null;
  let lastFetch = 0;
  let refreshTimer = null;
  let retryCount = 0;
  let fetching = false;

  async function refresh() {
    if (fetching) return cache;

    fetching = true;

    try {
      const data = await fetcher();
      cache = data;
      lastFetch = Date.now();
      retryCount = 0;

      // Schedule next refresh
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      refreshTimer = setTimeout(() => refresh(), refreshInterval);

      return data;
    } catch (error) {
      logger.error('Cache refresh failed:', error.message);
      retryCount++;

      // Retry with backoff
      if (retryCount <= maxRetries) {
        const retryDelay = errorRetryInterval * Math.pow(2, retryCount - 1);
        refreshTimer = setTimeout(() => refresh(), retryDelay);
      }

      // Return stale cache if available
      if (cache !== null) {
        return cache;
      }

      throw error;
    } finally {
      fetching = false;
    }
  }

  return {
    /**
     * Get cached value or fetch
     */
    async get() {
      if (cache === null || Date.now() - lastFetch > refreshInterval * 2) {
        return refresh();
      }
      return cache;
    },

    /**
     * Force refresh
     */
    refresh,

    /**
     * Clear cache and stop refresh
     */
    clear() {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      cache = null;
      lastFetch = 0;
      retryCount = 0;
    },

    /**
     * Get cache status
     */
    status() {
      return {
        hasCache: cache !== null,
        lastFetch,
        age: cache !== null ? Date.now() - lastFetch : null,
        retryCount,
        fetching,
      };
    },
  };
}

/**
 * Creates a debounced cache that batches updates
 *
 * @param {Function} writer - Function to write cached data
 * @param {Object} options - Debounce options
 * @returns {Object} Debounced cache writer
 */
function createDebouncedWriter(writer, options = {}) {
  const { debounceTime = 1000, maxWaitTime = 5000 } = options;

  let pendingData = null;
  let debounceTimer = null;
  let maxWaitTimer = null;
  let writing = false;

  async function flush() {
    if (writing || pendingData === null) return;

    writing = true;
    const data = pendingData;
    pendingData = null;

    // Clear timers
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }

    try {
      await writer(data);
    } catch (error) {
      logger.error('Debounced write failed:', error.message);
      throw error;
    } finally {
      writing = false;

      // Process any pending writes
      if (pendingData !== null) {
        scheduleWrite();
      }
    }
  }

  function scheduleWrite() {
    // Clear existing debounce timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Set new debounce timer
    debounceTimer = setTimeout(flush, debounceTime);

    // Set max wait timer if not already set
    if (!maxWaitTimer) {
      maxWaitTimer = setTimeout(flush, maxWaitTime);
    }
  }

  return {
    /**
     * Write data (debounced)
     */
    write(data) {
      pendingData = data;

      if (!writing) {
        scheduleWrite();
      }
    },

    /**
     * Flush pending writes immediately
     */
    flush,

    /**
     * Check if there are pending writes
     */
    hasPending() {
      return pendingData !== null;
    },
  };
}

module.exports = {
  createLRUCache,
  memoize,
  createBatchProcessor,
  createAutoRefreshCache,
  createDebouncedWriter,
};
