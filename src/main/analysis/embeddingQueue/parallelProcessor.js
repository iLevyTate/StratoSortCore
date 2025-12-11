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

  const acquireSlot = () => {
    if (activeCount < concurrency) {
      activeCount++;
      return Promise.resolve();
    }
    return new Promise((resolve) => waitQueue.push(resolve));
  };

  const releaseSlot = () => {
    // FIX: Add bounds checking to prevent activeCount from going negative
    if (activeCount > 0) {
      activeCount--;
    }
    if (waitQueue.length > 0 && activeCount < concurrency) {
      activeCount++;
      waitQueue.shift()();
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
