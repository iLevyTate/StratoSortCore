const crypto = require('crypto');
const { createLogger } = require('../../shared/logger');

const logger = createLogger('LLMOptimization');
/**
 * LLM Optimization Utilities
 * - Request deduplication: Prevent duplicate LLM calls for identical inputs
 * - Batching: Process multiple files in parallel with concurrency control
 * - Request coalescing: Merge multiple pending requests for the same input
 */

/**
 * CRITICAL FIX: Recursively sort object keys for consistent hashing
 * This ensures nested objects produce the same hash regardless of key order
 * @param {*} obj - Value to sort (handles objects, arrays, primitives)
 * @returns {*} Sorted value
 */
function sortObjectKeysDeep(obj, _seen) {
  if (Array.isArray(obj)) {
    const seen = _seen || new WeakSet();
    if (seen.has(obj)) return obj;
    seen.add(obj);
    return obj.map((item) => sortObjectKeysDeep(item, seen));
  }
  if (obj !== null && typeof obj === 'object') {
    const seen = _seen || new WeakSet();
    if (seen.has(obj)) return obj;
    seen.add(obj);
    const sorted = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortObjectKeysDeep(obj[key], seen);
    }
    return sorted;
  }
  return obj;
}

class LLMRequestDeduplicator {
  constructor(maxPendingRequests = 100) {
    // Track in-flight requests to avoid duplicate calls
    this.pendingRequests = new Map(); // key -> { promise, createdAt }
    this.maxPendingRequests = maxPendingRequests;
    // Maximum age for a pending request before it's considered stale (5 minutes)
    this.maxRequestAgeMs = 300000;
  }

  /**
   * Generate a unique key for a request based on its inputs
   */
  generateKey(inputs) {
    const hasher = crypto.createHash('sha1');

    // Handle different input types
    if (typeof inputs === 'string') {
      hasher.update(inputs);
    } else if (typeof inputs === 'object' && inputs !== null) {
      // CRITICAL FIX: Recursively sort keys for consistent hashing of nested objects
      const sorted = JSON.stringify(sortObjectKeysDeep(inputs));
      hasher.update(sorted);
    } else {
      hasher.update(String(inputs));
    }

    return hasher.digest('hex');
  }

  /**
   * Execute a function with deduplication
   * If the same request is already in flight, return the existing promise
   * @param {string} key - Unique cache key for this request
   * @param {Function} fn - Async function to execute
   * @param {Object} metadata - Optional metadata for logging (type, fileName, etc.)
   */
  /**
   * Evict stale entries that have been pending longer than maxRequestAgeMs.
   * Only evicts entries whose promises are likely stuck (e.g., hung model calls).
   */
  _evictStale() {
    const now = Date.now();
    let evicted = 0;
    for (const [k, entry] of this.pendingRequests) {
      if (now - entry.createdAt > this.maxRequestAgeMs) {
        this.pendingRequests.delete(k);
        evicted++;
      }
    }
    if (evicted > 0) {
      logger.warn('[LLM-DEDUP] Evicted stale entries', {
        evicted,
        remaining: this.pendingRequests.size
      });
    }
  }

  async deduplicate(key, fn, metadata = {}) {
    // If request is already in flight, return the existing promise
    if (this.pendingRequests.has(key)) {
      const entry = this.pendingRequests.get(key);
      // Check if the cached entry is stale
      if (Date.now() - entry.createdAt > this.maxRequestAgeMs) {
        this.pendingRequests.delete(key);
        logger.warn('[LLM-DEDUP] Evicted stale in-flight request', { key: key.slice(0, 12) });
      } else {
        logger.warn('[LLM-DEDUP] Cache hit - returning in-flight request', {
          key: key.slice(0, 12),
          type: metadata.type || 'unknown',
          fileName: metadata.fileName || 'unknown',
          pendingCount: this.pendingRequests.size
        });
        return entry.promise;
      }
    }

    // Evict stale entries when approaching capacity
    if (this.pendingRequests.size >= this.maxPendingRequests) {
      this._evictStale();
    }

    if (this.pendingRequests.size >= this.maxPendingRequests) {
      logger.warn('[LLM-DEDUP] At capacity after eviction - proceeding without caching', {
        pendingCount: this.pendingRequests.size,
        maxPending: this.maxPendingRequests,
        key: key.slice(0, 12)
      });
      // At true capacity with no stale entries - just execute without dedup tracking
      return await Promise.resolve(fn());
    }

    // Store placeholder promise before calling fn() to prevent race window
    // where two calls with the same key both pass the has() check
    let resolve, reject;
    const placeholder = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Suppress unhandled rejection if no second caller awaits the placeholder
    placeholder.catch(() => {});
    this.pendingRequests.set(key, { promise: placeholder, createdAt: Date.now() });

    try {
      const fnResult = fn();
      const result = await Promise.resolve(fnResult);
      resolve(result);
      return result;
    } catch (error) {
      reject(error);
      throw error;
    } finally {
      this.pendingRequests.delete(key);
    }
  }

  /**
   * Clear all pending requests (useful for testing or reset)
   */
  clear() {
    this.pendingRequests.clear();
  }

  /**
   * Get statistics about pending requests
   */
  getStats() {
    return {
      pendingCount: this.pendingRequests.size,
      maxPending: this.maxPendingRequests
    };
  }
}

class BatchProcessor {
  constructor(concurrencyLimit = 3) {
    this.concurrencyLimit = concurrencyLimit;
    this.activeCount = 0;
    this.queue = [];
  }

  /**
   * Process an array of items in parallel with concurrency control
   * @param {Array} items - Items to process
   * @param {Function} processFn - Async function to process each item
   * @param {Object} options - Processing options
   * @returns {Promise<Array>} Results array
   */
  async processBatch(items, processFn, options = {}) {
    const { concurrency = this.concurrencyLimit, onProgress = null, stopOnError = false } = options;

    if (!Array.isArray(items) || items.length === 0) {
      return {
        results: [],
        errors: [],
        successful: 0,
        total: 0
      };
    }

    logger.info('[BATCH-PROCESSOR] Starting batch processing', {
      itemCount: items.length,
      concurrency
    });

    const results = new Array(items.length);
    const errors = [];
    let completedCount = 0;

    // Process items with concurrency control
    const processItem = async (index) => {
      try {
        this.activeCount++;
        const item = items[index];
        const result = await processFn(item, index);
        results[index] = result;
        completedCount++;

        if (onProgress) {
          onProgress({
            completed: completedCount,
            total: items.length,
            current: item,
            result
          });
        }

        logger.debug('[BATCH-PROCESSOR] Item completed', {
          index,
          completed: completedCount,
          total: items.length
        });
      } catch (error) {
        errors.push({ index, error });
        results[index] = { error: error.message, index };
        completedCount++;

        logger.error('[BATCH-PROCESSOR] Item failed', {
          index,
          error: error.message
        });

        if (stopOnError) {
          throw error;
        }
      } finally {
        this.activeCount--;
      }
    };

    // Create batches based on concurrency
    const batches = [];
    for (let i = 0; i < items.length; i += concurrency) {
      const batchIndices = [];
      for (let j = i; j < Math.min(i + concurrency, items.length); j++) {
        batchIndices.push(j);
      }
      batches.push(batchIndices);
    }

    // Process batches sequentially, items within batch in parallel
    let stoppedEarly = false;
    for (const batchIndices of batches) {
      if (stopOnError) {
        // Use Promise.all so thrown errors propagate and stop processing
        try {
          await Promise.all(batchIndices.map((index) => processItem(index)));
        } catch {
          stoppedEarly = true;
          break;
        }
      } else {
        // Use Promise.allSettled to handle individual failures gracefully
        await Promise.allSettled(batchIndices.map((index) => processItem(index)));
      }
    }

    logger.info('[BATCH-PROCESSOR] Batch processing complete', {
      total: items.length,
      successful: items.length - errors.length,
      failed: errors.length,
      stoppedEarly
    });

    return {
      results,
      errors,
      successful: items.length - errors.length,
      total: items.length
    };
  }

  /**
   * Get current processing statistics
   */
  getStats() {
    return {
      activeCount: this.activeCount,
      concurrencyLimit: this.concurrencyLimit,
      queueSize: this.queue.length
    };
  }
}

// Singleton instances for global use
const globalDeduplicator = new LLMRequestDeduplicator();
const globalBatchProcessor = new BatchProcessor(3); // Default concurrency of 3

module.exports = {
  LLMRequestDeduplicator,
  BatchProcessor,
  globalDeduplicator,
  globalBatchProcessor
};
