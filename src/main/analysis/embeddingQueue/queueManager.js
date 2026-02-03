/**
 * EmbeddingQueueManager
 *
 * Wrapper that applies path updates/removals across all staged embedding queues.
 * Used by FilePathCoordinator so pending embeddings remain consistent after moves/renames/deletes.
 */
const { analysisQueue, organizeQueue } = require('./stageQueues');

function safeCall(queue, method, ...args) {
  const fn = queue && typeof queue[method] === 'function' ? queue[method] : null;
  if (!fn) return 0;
  return fn.apply(queue, args);
}

const queues = [analysisQueue, organizeQueue];

module.exports = {
  analysisQueue,
  organizeQueue,

  updateByFilePath(oldPath, newPath) {
    let total = 0;
    for (const q of queues) total += safeCall(q, 'updateByFilePath', oldPath, newPath) || 0;
    return total;
  },

  updateByFilePaths(pathChanges) {
    let total = 0;
    for (const q of queues) total += safeCall(q, 'updateByFilePaths', pathChanges) || 0;
    return total;
  },

  removeByFilePath(filePath) {
    let total = 0;
    for (const q of queues) total += safeCall(q, 'removeByFilePath', filePath) || 0;
    return total;
  },

  removeByFilePaths(filePaths) {
    let total = 0;
    for (const q of queues) total += safeCall(q, 'removeByFilePaths', filePaths) || 0;
    return total;
  },

  getStats() {
    return {
      analysis: analysisQueue?.getStats ? analysisQueue.getStats() : null,
      organize: organizeQueue?.getStats ? organizeQueue.getStats() : null
    };
  }
};
