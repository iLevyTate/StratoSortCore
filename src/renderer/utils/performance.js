/**
 * Performance optimization utilities for React components.
 * Provides debouncing, throttling, caching, and React-specific helpers.
 *
 * Core debounce/throttle are imported from the consolidated promiseUtils module.
 *
 * @module renderer/utils/performance
 */

import { debounce, throttle } from '../../shared/promiseUtils';

/**
 * RAF (requestAnimationFrame) throttle for smooth UI updates
 * Only allows one execution per animation frame
 *
 * @param {Function} fn - Function to throttle
 * @returns {Function} Throttled function with cancel method
 */
function rafThrottle(fn) {
  let rafId = null;
  let lastArgs = null;

  const throttled = (...args) => {
    lastArgs = args;
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        fn(...lastArgs);
      });
    }
  };

  throttled.cancel = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  return throttled;
}

/**
 * Batch processor for collecting items and processing them together
 *
 * @param {Function} processFn - Function to process batch of items
 * @param {number} wait - Delay in ms before processing (default: 0)
 * @param {number} maxBatchSize - Maximum batch size before immediate processing (optional)
 * @returns {Object} Processor with add, flush, and clear methods
 */
function batchProcessor(processFn, wait = 0, maxBatchSize = Infinity) {
  let batch = [];
  let timeoutId = null;

  const process = () => {
    if (batch.length === 0) return;
    const items = batch;
    batch = [];
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    processFn(items);
  };

  const scheduleProcess = () => {
    if (timeoutId !== null) return;
    timeoutId = setTimeout(() => {
      timeoutId = null;
      process();
    }, wait);
  };

  return {
    add(item) {
      batch.push(item);
      if (batch.length >= maxBatchSize) {
        process();
      } else {
        scheduleProcess();
      }
    },

    async flush() {
      process();
    },

    clear() {
      batch = [];
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    }
  };
}

/**
 * LRU (Least Recently Used) cache implementation
 *
 * @param {number} maxSize - Maximum number of items in cache
 * @returns {Object} Cache object with get, set, has, delete, and clear methods
 */
function createLRUCache(maxSize = 100) {
  const cache = new Map();

  return {
    get(key) {
      if (!cache.has(key)) {
        return undefined;
      }
      // Move to end (most recently used)
      const value = cache.get(key);
      cache.delete(key);
      cache.set(key, value);
      return value;
    },

    set(key, value) {
      // Remove key if it exists (to update position)
      if (cache.has(key)) {
        cache.delete(key);
      }
      // Add to end
      cache.set(key, value);

      // Remove oldest if over capacity
      if (cache.size > maxSize) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
    },

    has(key) {
      return cache.has(key);
    },

    delete(key) {
      return cache.delete(key);
    },

    clear() {
      cache.clear();
    },

    get size() {
      return cache.size;
    }
  };
}

export { debounce, throttle, createLRUCache, rafThrottle, batchProcessor };
export default {
  debounce,
  throttle,
  createLRUCache,
  rafThrottle,
  batchProcessor
};
