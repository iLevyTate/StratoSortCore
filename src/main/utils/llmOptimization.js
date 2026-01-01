const crypto = require('crypto');
const { logger } = require('../../shared/logger');
logger.setContext('LLMOptimization');

/**
 * LLM Optimization Utilities
 * - Request deduplication: Prevent duplicate LLM calls for identical inputs
 * - Batching: Process multiple files in parallel with concurrency control
 * - Request coalescing: Merge multiple pending requests for the same input
 */

class LLMRequestDeduplicator {
  constructor(maxPendingRequests = 100) {
    // Track in-flight requests to avoid duplicate calls
    this.pendingRequests = new Map(); // key -> Promise
    this.maxPendingRequests = maxPendingRequests;
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
      // Sort keys for consistent hashing
      const sorted = JSON.stringify(inputs, Object.keys(inputs).sort());
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
  async deduplicate(key, fn, metadata = {}) {
    // If request is already in flight, return the existing promise
    if (this.pendingRequests.has(key)) {
      logger.warn('[LLM-DEDUP] Cache hit - returning in-flight request', {
        key: key.slice(0, 12),
        type: metadata.type || 'unknown',
        fileName: metadata.fileName || 'unknown',
        pendingCount: this.pendingRequests.size
      });
      return this.pendingRequests.get(key);
    }

    // Check size limit and clean oldest if needed
    if (this.pendingRequests.size >= this.maxPendingRequests) {
      const firstKey = this.pendingRequests.keys().next().value;
      this.pendingRequests.delete(firstKey);
      logger.debug('[LLM-DEDUP] Cleaned oldest pending request');
    }

    // FIX: Wrap fn() call to handle synchronous throws
    // If fn() throws synchronously, we should not add to pendingRequests
    let promise;
    try {
      const fnResult = fn();
      // Ensure we have a promise-like object
      promise = Promise.resolve(fnResult).finally(() => {
        // Clean up after completion
        this.pendingRequests.delete(key);
      });
    } catch (syncError) {
      // fn() threw synchronously, don't add to pending requests
      logger.debug('[LLM-DEDUP] Function threw synchronously', {
        key: key.slice(0, 8),
        error: syncError.message
      });
      throw syncError;
    }

    this.pendingRequests.set(key, promise);
    return promise;
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
    // Fixed: Use Promise.allSettled to handle individual failures gracefully
    for (const batchIndices of batches) {
      await Promise.allSettled(batchIndices.map((index) => processItem(index)));
    }

    logger.info('[BATCH-PROCESSOR] Batch processing complete', {
      total: items.length,
      successful: items.length - errors.length,
      failed: errors.length
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
