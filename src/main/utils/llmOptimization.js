const crypto = require('crypto');
const { logger } = require('../../shared/logger');

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
   */
  async deduplicate(key, fn) {
    // If request is already in flight, return the existing promise
    if (this.pendingRequests.has(key)) {
      logger.debug('[LLM-DEDUP] Request already in flight, reusing', {
        key: key.slice(0, 8),
      });
      return this.pendingRequests.get(key);
    }

    // Check size limit and clean oldest if needed
    if (this.pendingRequests.size >= this.maxPendingRequests) {
      const firstKey = this.pendingRequests.keys().next().value;
      this.pendingRequests.delete(firstKey);
      logger.debug('[LLM-DEDUP] Cleaned oldest pending request');
    }

    // Execute the function and track the promise
    const promise = fn().finally(() => {
      // Clean up after completion
      this.pendingRequests.delete(key);
    });

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
      maxPending: this.maxPendingRequests,
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
    const {
      concurrency = this.concurrencyLimit,
      onProgress = null,
      stopOnError = false,
    } = options;

    if (!Array.isArray(items) || items.length === 0) {
      return {
        results: [],
        errors: [],
        successful: 0,
        total: 0,
      };
    }

    logger.info('[BATCH-PROCESSOR] Starting batch processing', {
      itemCount: items.length,
      concurrency,
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
            result,
          });
        }

        logger.debug('[BATCH-PROCESSOR] Item completed', {
          index,
          completed: completedCount,
          total: items.length,
        });
      } catch (error) {
        errors.push({ index, error });
        results[index] = { error: error.message, index };
        completedCount++;

        logger.error('[BATCH-PROCESSOR] Item failed', {
          index,
          error: error.message,
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
      failed: errors.length,
    });

    return {
      results,
      errors,
      successful: items.length - errors.length,
      total: items.length,
    };
  }

  /**
   * Get current processing statistics
   */
  getStats() {
    return {
      activeCount: this.activeCount,
      concurrencyLimit: this.concurrencyLimit,
      queueSize: this.queue.length,
    };
  }
}

class PromptCombiner {
  /**
   * Combine multiple analysis prompts into a single LLM call
   * Useful for reducing sequential API calls
   */
  static combineAnalysisPrompts(prompts, options = {}) {
    const { maxCombined = 3, separator = '\n---\n' } = options;

    if (!Array.isArray(prompts) || prompts.length === 0) {
      return [];
    }

    // Don't combine if only one prompt
    if (prompts.length === 1) {
      return prompts;
    }

    // Group prompts by type if available
    const grouped = {};
    prompts.forEach((prompt, index) => {
      const type = prompt.type || 'default';
      if (!grouped[type]) {
        grouped[type] = [];
      }
      grouped[type].push({ ...prompt, originalIndex: index });
    });

    const combined = [];

    // Combine prompts of the same type
    Object.entries(grouped).forEach(([type, typePrompts]) => {
      for (let i = 0; i < typePrompts.length; i += maxCombined) {
        const batch = typePrompts.slice(i, i + maxCombined);

        if (batch.length === 1) {
          combined.push(batch[0]);
        } else {
          // Combine multiple prompts
          const combinedPrompt = {
            type,
            text: batch
              .map((p, idx) => `[Query ${idx + 1}]\n${p.text}`)
              .join(separator),
            components: batch,
            isCombined: true,
          };
          combined.push(combinedPrompt);
        }
      }
    });

    return combined;
  }

  /**
   * Split a combined response back into individual responses
   */
  static splitCombinedResponse(response, components) {
    if (!components || components.length === 1) {
      return [response];
    }

    // Attempt to split by common delimiters
    const parts = response
      .split(/\[(?:Query|Response) \d+\]/)
      .filter((p) => p.trim());

    if (parts.length === components.length) {
      return parts.map((p) => p.trim());
    }

    // Fallback: return same response for all
    logger.warn(
      '[PROMPT-COMBINER] Could not split combined response, using same response for all',
    );
    return components.map(() => response);
  }
}

// Singleton instances for global use
const globalDeduplicator = new LLMRequestDeduplicator();
const globalBatchProcessor = new BatchProcessor(3); // Default concurrency of 3

module.exports = {
  LLMRequestDeduplicator,
  BatchProcessor,
  PromptCombiner,
  globalDeduplicator,
  globalBatchProcessor,
};
