/**
 * Progress Tracking Module
 *
 * Manages progress callbacks for embedding queue operations.
 *
 * @module embeddingQueue/progress
 */

const { logger } = require('../../../shared/logger');

/**
 * Create a progress tracker instance
 * @returns {Object} Progress tracker with methods
 */
function createProgressTracker() {
  const callbacks = new Set();

  /**
   * Register a progress callback
   * @param {Function} callback - Progress callback (progress) => void
   * @returns {Function} Unsubscribe function
   */
  function onProgress(callback) {
    callbacks.add(callback);
    return () => callbacks.delete(callback);
  }

  /**
   * Notify all progress callbacks
   * @param {Object} progress - Progress information
   */
  function notify(progress) {
    for (const callback of callbacks) {
      try {
        callback(progress);
      } catch (e) {
        logger.warn('[EmbeddingQueue] Progress callback error:', e.message);
      }
    }
  }

  /**
   * Clear all callbacks
   */
  function clear() {
    callbacks.clear();
  }

  return {
    onProgress,
    notify,
    clear
  };
}

module.exports = { createProgressTracker };
