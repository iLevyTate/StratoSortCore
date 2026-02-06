/**
 * Parallel Processor Module
 *
 * Semaphore-based parallel processing for embedding operations.
 *
 * @module embeddingQueue/parallelProcessor
 */

const { logger } = require('../../../shared/logger');
const { withTimeout } = require('../../../shared/promiseUtils');
const { TIMEOUTS } = require('../../../shared/performanceConstants');
const PQueue = require('p-queue').default;

/**
 * Process items in parallel with semaphore-based concurrency control
 * @param {Object} params - Processing parameters
 * @param {Array} params.items - Items to process
 * @param {string} params.type - 'file' or 'folder'
 * @param {Object} params.vectorDbService - Vector DB service instance
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
  vectorDbService,
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

  if (typeof vectorDbService[batchMethod] === 'function') {
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
        const result = await withTimeout(
          vectorDbService[batchMethod](formattedItems),
          TIMEOUTS.BATCH_EMBEDDING_MAX || 5 * 60 * 1000,
          `Batch ${type} upsert`
        );
        // FIX CRITICAL: Check batch operation result for data loss prevention
        // If the service returns success: false (e.g. dimension mismatch), we must treat it as a failure
        // so items go to the failed queue instead of being silently dropped.
        if (result && result.success === false) {
          throw new Error(result.error || 'Batch folder upsert failed');
        }
      } else {
        const result = await withTimeout(
          vectorDbService[batchMethod](items),
          TIMEOUTS.BATCH_EMBEDDING_MAX || 5 * 60 * 1000,
          `Batch ${type} upsert`
        );
        // FIX CRITICAL: Check batch operation result for data loss prevention
        if (result && result.success === false) {
          throw new Error(result.error || 'Batch file upsert failed');
        }
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

  // Queue-based parallel processing
  logger.debug(
    `[EmbeddingQueue] Processing ${items.length} ${type}s with concurrency ${concurrency}`
  );

  const queue = new PQueue({ concurrency });

  const processItem = async (item) => {
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

      const result = await withTimeout(
        vectorDbService[singleMethod](payload),
        TIMEOUTS.EMBEDDING_REQUEST || 30000,
        `Upsert ${type}`
      );

      // FIX CRITICAL: Check operation result for data loss prevention
      if (result && result.success === false) {
        throw new Error(result.error || `Upsert ${type} failed`);
      }

      const completed = ++processedCount;
      onProgress({
        phase: 'processing',
        total: totalBatchSize,
        completed,
        percent: totalBatchSize > 0 ? Math.round((completed / totalBatchSize) * 100) : 0,
        itemType: type,
        currentItem: item.id
      });
    } catch (itemError) {
      logger.warn(`[EmbeddingQueue] Failed to upsert ${type} ${item.id}:`, itemError.message);
      failedItemIds.add(item.id);
      onItemFailed(item, itemError.message);
    }
  };

  await Promise.all(items.map((item) => queue.add(() => processItem(item))));

  return processedCount;
}

module.exports = { processItemsInParallel };
