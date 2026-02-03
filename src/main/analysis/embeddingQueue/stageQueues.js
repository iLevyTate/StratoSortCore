/**
 * Staged embedding queues
 *
 * Provides separate queue instances for different workflow stages so that
 * heavy analysis-time embedding flushes don't starve post-organize embedding work.
 */
const path = require('path');
const { app } = require('electron');
const { get: getConfig } = require('../../../shared/config/index');
const { CONCURRENCY, BATCH } = require('../../../shared/performanceConstants');

const analysisQueue = require('./index'); // Backward-compatible singleton
const EmbeddingQueue = require('./EmbeddingQueueCore');

const organizeQueue = new EmbeddingQueue({
  persistenceFileName: 'pending_embeddings_organize.json',
  failedItemsPath: path.join(app.getPath('userData'), 'failed_embeddings_organize.json'),
  deadLetterPath: path.join(app.getPath('userData'), 'dead_letter_embeddings_organize.json'),
  // Smaller batches so post-move indexing becomes visible sooner.
  batchSize: getConfig('ANALYSIS.organizeBatchSize', 10),
  flushDelayMs: getConfig('ANALYSIS.organizeFlushDelayMs', BATCH.EMBEDDING_FLUSH_DELAY_MS),
  parallelFlushConcurrency: getConfig(
    'ANALYSIS.organizeFlushConcurrency',
    CONCURRENCY.EMBEDDING_FLUSH
  )
});

module.exports = {
  analysisQueue,
  organizeQueue
};
