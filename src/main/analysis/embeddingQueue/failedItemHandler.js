/**
 * Failed Item Handler Module
 *
 * Handles failed item tracking, dead letter queue, and retry logic.
 *
 * @module embeddingQueue/failedItemHandler
 */

const { logger } = require('../../../shared/logger');
const { RETRY } = require('../../../shared/performanceConstants');
const { persistFailedItems, persistDeadLetterQueue } = require('./persistence');

/**
 * Create a failed item handler instance
 * @param {Object} config - Configuration
 * @param {number} config.itemMaxRetries - Max retries per item
 * @param {number} config.maxDeadLetterSize - Max dead letter queue size
 * @param {number} [config.maxFailedItemsSize=1000] - Max failed items Map size (prevents memory exhaustion)
 * @param {string} config.failedItemsPath - Path to persist failed items
 * @param {string} config.deadLetterPath - Path to persist dead letter queue
 * @returns {Object} Failed item handler
 */
function createFailedItemHandler(config) {
  const {
    itemMaxRetries,
    maxDeadLetterSize,
    maxFailedItemsSize = 1000,
    failedItemsPath,
    deadLetterPath
  } = config;

  // State
  const failedItems = new Map();
  let deadLetterQueue = [];

  /**
   * Track a failed item for retry
   * @param {Object} item - The failed embedding item
   * @param {string} errorMessage - The error message
   */
  function trackFailedItem(item, errorMessage) {
    const existing = failedItems.get(item.id);
    const retryCount = existing ? existing.retryCount + 1 : 1;

    if (retryCount > itemMaxRetries) {
      addToDeadLetterQueue(item, errorMessage, retryCount);
      failedItems.delete(item.id);
      return;
    }

    // Enforce maximum size with LRU eviction to prevent memory exhaustion
    if (!existing && failedItems.size >= maxFailedItemsSize) {
      // Evict oldest entry (first key in Map iteration order)
      const oldestKey = failedItems.keys().next().value;
      if (oldestKey) {
        const oldEntry = failedItems.get(oldestKey);
        failedItems.delete(oldestKey);
        // Move evicted item to dead letter queue so it's not lost
        addToDeadLetterQueue(
          oldEntry.item,
          `Evicted from failed items due to capacity (was: ${oldEntry.error})`,
          oldEntry.retryCount
        );
        logger.warn(
          `[EmbeddingQueue] Failed items at capacity (${maxFailedItemsSize}), evicted oldest to dead letter`,
          { evictedId: oldestKey }
        );
      }
    }

    // FIX Bug 5: Delete and re-insert to maintain true LRU ordering
    // Map maintains insertion order, so updating an existing key doesn't move it
    // By deleting first then re-inserting, the item moves to the end (most recently used)
    if (existing) {
      failedItems.delete(item.id);
    }

    failedItems.set(item.id, {
      item,
      retryCount,
      lastAttempt: Date.now(),
      error: errorMessage
    });

    // Persist failed items to disk for recovery
    persistFailedItems(failedItemsPath, failedItems).catch((err) => {
      logger.warn('[EmbeddingQueue] Failed to persist failed items:', err.message);
    });

    logger.debug(
      `[EmbeddingQueue] Tracked failed item ${item.id} (retry ${retryCount}/${itemMaxRetries})`
    );
  }

  /**
   * Add an item to the dead letter queue
   * @param {Object} item - The failed embedding item
   * @param {string} errorMessage - The error message
   * @param {number} retryCount - Number of retries attempted
   */
  function addToDeadLetterQueue(item, errorMessage, retryCount) {
    const deadLetterEntry = {
      item,
      error: errorMessage,
      retryCount,
      failedAt: new Date().toISOString(),
      itemId: item.id,
      itemType: item.id.startsWith('folder:') ? 'folder' : 'file'
    };

    // FIX P1-3: Ensure room exists BEFORE adding to prevent exceeding bounds
    // Use while loop to handle case where multiple concurrent calls could fill queue
    // The previous if-based pruning could leave queue at exactly maxDeadLetterSize
    while (deadLetterQueue.length >= maxDeadLetterSize) {
      const pruneCount = Math.max(1, Math.floor(maxDeadLetterSize * 0.1));
      deadLetterQueue.splice(0, pruneCount);
      logger.warn(
        `[EmbeddingQueue] Dead letter queue at capacity, pruned ${pruneCount} oldest entries`
      );
    }

    deadLetterQueue.push(deadLetterEntry);

    logger.error(
      `[EmbeddingQueue] Item ${item.id} moved to dead letter queue after ${retryCount} failed attempts`,
      { error: errorMessage }
    );

    // Persist dead letter queue to disk
    persistDeadLetterQueue(deadLetterPath, deadLetterQueue).catch((err) => {
      logger.warn('[EmbeddingQueue] Failed to persist dead letter queue:', err.message);
    });
  }

  /**
   * Get items ready for retry based on exponential backoff
   * @returns {Array} Items ready to retry
   */
  function getItemsToRetry() {
    const now = Date.now();
    const itemsToRetry = [];

    for (const [id, data] of failedItems) {
      // FIX LOW-2: Remove extra * 2 multiplier - exponential backoff per item: 10s, 20s, 40s
      // Formula: BASE_MS * 2^(retryCount-1) gives 10s, 20s, 40s for retryCount 1, 2, 3
      const backoffMs = RETRY.BACKOFF_BASE_MS * 2 ** (data.retryCount - 1);

      if (now - data.lastAttempt >= backoffMs) {
        itemsToRetry.push(data.item);
        failedItems.delete(id);
      }
    }

    return itemsToRetry;
  }

  /**
   * Retry failed items
   * @param {Array} queue - Main queue to add retries to
   * @param {Function} persistQueue - Function to persist queue
   */
  async function retryFailedItems(queue, persistQueue) {
    const itemsToRetry = getItemsToRetry();

    if (itemsToRetry.length > 0) {
      logger.info(`[EmbeddingQueue] Re-queuing ${itemsToRetry.length} failed items for retry`);
      // Add to front of queue for priority processing
      queue.unshift(...itemsToRetry);
      await persistQueue();
      await persistFailedItems(failedItemsPath, failedItems);
    }
  }

  /**
   * Get dead letter queue items
   * @param {number} limit - Max items to return
   * @returns {Array} Dead letter items
   */
  function getDeadLetterItems(limit = 100) {
    return deadLetterQueue.slice(-limit);
  }

  /**
   * Clear the dead letter queue
   * @returns {number} Number of items cleared
   */
  async function clearDeadLetterQueue() {
    const count = deadLetterQueue.length;
    deadLetterQueue = [];
    await persistDeadLetterQueue(deadLetterPath, deadLetterQueue);
    logger.info(`[EmbeddingQueue] Cleared ${count} items from dead letter queue`);
    return count;
  }

  /**
   * Retry a specific dead letter item
   * @param {string} itemId - Item ID to retry
   * @param {Array} queue - Main queue to add to
   * @param {Function} persistQueue - Function to persist queue
   * @returns {boolean} Success
   */
  async function retryDeadLetterItem(itemId, queue, persistQueue) {
    const index = deadLetterQueue.findIndex((entry) => entry.itemId === itemId);
    if (index === -1) {
      logger.warn(`[EmbeddingQueue] Dead letter item ${itemId} not found`);
      return false;
    }

    const entry = deadLetterQueue.splice(index, 1)[0];
    queue.push(entry.item);
    await persistQueue();
    await persistDeadLetterQueue(deadLetterPath, deadLetterQueue);
    logger.info(`[EmbeddingQueue] Manually re-queued dead letter item ${itemId}`);
    return true;
  }

  /**
   * Retry all dead letter items
   * @param {Array} queue - Main queue to add to
   * @param {Function} persistQueue - Function to persist queue
   * @returns {number} Number of items re-queued
   */
  async function retryAllDeadLetterItems(queue, persistQueue) {
    if (deadLetterQueue.length === 0) {
      return 0;
    }

    const count = deadLetterQueue.length;
    const items = deadLetterQueue.map((entry) => entry.item);
    deadLetterQueue = [];
    queue.push(...items);
    await persistQueue();
    await persistDeadLetterQueue(deadLetterPath, deadLetterQueue);
    logger.info(`[EmbeddingQueue] Manually re-queued ${count} dead letter items`);
    return count;
  }

  /**
   * Set the dead letter queue (for initialization)
   * @param {Array} items - Items to set
   */
  function setDeadLetterQueue(items) {
    deadLetterQueue = items;
  }

  /**
   * Persist all state
   */
  async function persistAll() {
    await persistFailedItems(failedItemsPath, failedItems);
    await persistDeadLetterQueue(deadLetterPath, deadLetterQueue);
  }

  /**
   * Get stats
   */
  function getStats() {
    return {
      failedItemsCount: failedItems.size,
      maxFailedItemsSize,
      deadLetterCount: deadLetterQueue.length,
      maxDeadLetterSize,
      itemMaxRetries
    };
  }

  return {
    failedItems,
    get deadLetterQueue() {
      return deadLetterQueue;
    },
    trackFailedItem,
    addToDeadLetterQueue,
    getItemsToRetry,
    retryFailedItems,
    getDeadLetterItems,
    clearDeadLetterQueue,
    retryDeadLetterItem,
    retryAllDeadLetterItems,
    setDeadLetterQueue,
    persistAll,
    getStats
  };
}

module.exports = { createFailedItemHandler };
