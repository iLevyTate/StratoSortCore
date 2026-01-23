/**
 * Parallel Processor Module
 *
 * Semaphore-based parallel processing for embedding operations.
 *
 * @module embeddingQueue/parallelProcessor
 */

const { logger } = require('../../../shared/logger');

/**
 * Process items in parallel with semaphore-based concurrency control
 * @param {Object} params - Processing parameters
 * @param {Array} params.items - Items to process
 * @param {string} params.type - 'file' or 'folder'
 * @param {Object} params.chromaDbService - ChromaDB service instance
 * @param {Set} params.failedItemIds - Set to track failed item IDs
 * @param {number} params.startProcessedCount - Starting count for progress
 * @param {number} params.totalBatchSize - Total batch size for progress
 * @param {number} params.concurrency - Max concurrent operations
 * @param {Function} params.onProgress - Progress callback
 * @param {Function} params.onItemFailed - Callback when item fails
 * @returns {Promise<number>} Updated processed count
 */
async function processItemsInParallel({
  items,
  type,
  chromaDbService,
  failedItemIds,
  startProcessedCount,
  totalBatchSize,
  concurrency,
  onProgress,
  onItemFailed
}) {
  let processedCount = startProcessedCount;

  // Try batch upsert first if available
  const batchMethod = type === 'file' ? 'batchUpsertFiles' : 'batchUpsertFolders';
  const singleMethod = type === 'file' ? 'upsertFile' : 'upsertFolder';

  if (typeof chromaDbService[batchMethod] === 'function') {
    try {
      if (type === 'folder') {
        // Format folders for batch upsert
        const formattedItems = items.map((item) => ({
          id: item.id,
          vector: item.vector,
          name: item.meta?.name || item.id,
          path: item.meta?.path,
          model: item.model,
          updatedAt: item.updatedAt
        }));
        await chromaDbService[batchMethod](formattedItems);
      } else {
        await chromaDbService[batchMethod](items);
      }

      // All items processed successfully
      processedCount += items.length;
      onProgress({
        phase: 'processing',
        total: totalBatchSize,
        completed: processedCount,
        percent: totalBatchSize > 0 ? Math.round((processedCount / totalBatchSize) * 100) : 0,
        itemType: type
      });

      return processedCount;
    } catch (batchError) {
      logger.warn(
        `[EmbeddingQueue] Batch ${type} upsert failed, falling back to parallel individual:`,
        batchError.message
      );
      // Fall through to parallel individual processing
    }
  }

  // Semaphore-based parallel processing
  logger.debug(
    `[EmbeddingQueue] Processing ${items.length} ${type}s with concurrency ${concurrency}`
  );

  let activeCount = 0;
  const waitQueue = [];

  // FIX P0-3: Use increment-first pattern for atomic semaphore acquisition
  // The previous check-then-increment pattern had a race condition where multiple
  // async operations could check activeCount simultaneously, all see it as < concurrency,
  // and all increment - exceeding the concurrency limit.
  const acquireSlot = () => {
    // Atomic: increment first, then check
    activeCount++;
    if (activeCount <= concurrency) {
      return Promise.resolve();
    }
    // Exceeded limit - decrement and queue
    activeCount--;
    return new Promise((resolve) => waitQueue.push(resolve));
  };

  // FIX HIGH #9: Improved semaphore release with defensive bounds checking
  // JavaScript's single-threaded model makes this atomic, but we add extra safety
  const releaseSlot = () => {
    // Decrement first, ensuring we don't go below 0
    if (activeCount > 0) {
      activeCount--;
    }
    // Only process waitQueue if we have room AND there are waiters
    // This double-check prevents any edge case where activeCount could exceed limit
    if (waitQueue.length > 0 && activeCount < concurrency) {
      activeCount++;
      const next = waitQueue.shift();
      // Use setImmediate to ensure the next task starts in a new microtask
      // This prevents deep call stacks when many items complete rapidly
      setImmediate(next);
    }
  };

  const processItem = async (item) => {
    await acquireSlot();
    try {
      const payload =
        type === 'folder'
          ? {
              id: item.id,
              vector: item.vector,
              name: item.meta?.name || item.id,
              path: item.meta?.path,
              model: item.model,
              updatedAt: item.updatedAt
            }
          : {
              id: item.id,
              vector: item.vector,
              meta: item.meta,
              model: item.model,
              updatedAt: item.updatedAt
            };

      await chromaDbService[singleMethod](payload);

      onProgress({
        phase: 'processing',
        total: totalBatchSize,
        completed: ++processedCount,
        percent: totalBatchSize > 0 ? Math.round((processedCount / totalBatchSize) * 100) : 0,
        itemType: type,
        currentItem: item.id
      });
    } catch (itemError) {
      logger.warn(`[EmbeddingQueue] Failed to upsert ${type} ${item.id}:`, itemError.message);
      failedItemIds.add(item.id);
      onItemFailed(item, itemError.message);
    } finally {
      releaseSlot();
    }
  };

  // Launch all tasks - semaphore controls actual concurrency
  await Promise.all(items.map(processItem));

  return processedCount;
}

module.exports = { processItemsInParallel };
