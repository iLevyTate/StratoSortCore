/**
 * EmbeddingQueueManager
 *
 * Wrapper that applies path updates/removals across all staged embedding queues.
 * Used by FilePathCoordinator so pending embeddings remain consistent after moves/renames/deletes.
 */
const { analysisQueue, organizeQueue } = require('./stageQueues');

function safeCallOptional(queue, method, ...args) {
  const fn = queue && typeof queue[method] === 'function' ? queue[method] : null;
  if (!fn) return 0;
  return fn.apply(queue, args);
}

function safeCallRequired(queue, method, ...args) {
  const fn = queue && typeof queue[method] === 'function' ? queue[method] : null;
  if (!fn) {
    const queueName = queue?.constructor?.name || 'UnknownQueue';
    throw new Error(`[EmbeddingQueueManager] Missing ${method} on ${queueName}`);
  }
  return fn.apply(queue, args);
}

const queues = [analysisQueue, organizeQueue];

module.exports = {
  analysisQueue,
  organizeQueue,

  updateByFilePath(oldPath, newPath) {
    let total = 0;
    for (const q of queues) total += safeCallOptional(q, 'updateByFilePath', oldPath, newPath) || 0;
    return total;
  },

  updateByFilePaths(pathChanges) {
    let total = 0;
    for (const q of queues) total += safeCallOptional(q, 'updateByFilePaths', pathChanges) || 0;
    return total;
  },

  removeByFilePath(filePath) {
    let total = 0;
    for (const q of queues) total += safeCallOptional(q, 'removeByFilePath', filePath) || 0;
    return total;
  },

  removeByFilePaths(filePaths) {
    let total = 0;
    for (const q of queues) total += safeCallOptional(q, 'removeByFilePaths', filePaths) || 0;
    return total;
  },

  getStats() {
    return {
      analysis: analysisQueue?.getStats ? analysisQueue.getStats() : null,
      organize: organizeQueue?.getStats ? organizeQueue.getStats() : null
    };
  },

  async forceFlush() {
    const results = await Promise.allSettled(queues.map((q) => safeCallRequired(q, 'forceFlush')));
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((result) => result.reason),
        'Embedding queue forceFlush failed'
      );
    }
    return results;
  },

  async shutdown() {
    const results = await Promise.allSettled(queues.map((q) => safeCallRequired(q, 'shutdown')));
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((result) => result.reason),
        'Embedding queue shutdown failed'
      );
    }
    return results;
  }
};
