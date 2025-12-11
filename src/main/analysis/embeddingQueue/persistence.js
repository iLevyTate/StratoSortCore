/**
 * Embedding Queue Persistence Module
 *
 * Handles file I/O operations for queue persistence with atomic writes.
 *
 * @module embeddingQueue/persistence
 */

const fs = require('fs').promises;
const { logger } = require('../../../shared/logger');

/**
 * Load persisted data from a file
 * @param {string} filePath - Path to the file
 * @param {Function} onLoad - Callback with parsed data
 * @param {string} description - Description for logging
 */
async function loadPersistedData(filePath, onLoad, description) {
  try {
    const exists = await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false);

    if (exists) {
      const data = await fs.readFile(filePath, 'utf8');
      try {
        const parsed = JSON.parse(data);
        onLoad(parsed);
      } catch (parseError) {
        logger.error(`[EmbeddingQueue] Failed to parse ${description} file`, parseError);
        // Backup corrupt file
        await fs.rename(filePath, `${filePath}.corrupt.${Date.now()}`).catch(() => {});
      }
    }
  } catch (error) {
    logger.warn(`[EmbeddingQueue] Error loading ${description}:`, error.message);
  }
}

/**
 * Atomic write to file using temp + rename pattern
 * @param {string} filePath - Target file path
 * @param {*} data - Data to write (will be JSON stringified)
 * @param {Object} options - Options
 * @param {boolean} options.pretty - Pretty print JSON (default: false)
 */
async function atomicWriteFile(filePath, data, options = {}) {
  const { pretty = false } = options;
  const tempPath = `${filePath}.tmp.${Date.now()}`;

  try {
    const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    await fs.writeFile(tempPath, content, 'utf8');
    // Retry rename on Windows EPERM errors (file handle race condition)
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fs.rename(tempPath, filePath);
        lastError = null;
        break;
      } catch (renameError) {
        lastError = renameError;
        if (renameError.code === 'EPERM' && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
          continue;
        }
        throw renameError;
      }
    }
    if (lastError) throw lastError;
  } catch (writeError) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw writeError;
  }
}

/**
 * Safely delete a file if it exists
 * @param {string} filePath - File to delete
 */
async function safeUnlink(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

/**
 * Persist queue data to disk
 * @param {string} filePath - Path to persist to
 * @param {Array} queue - Queue data to persist
 */
async function persistQueueData(filePath, queue) {
  try {
    if (queue.length === 0) {
      await safeUnlink(filePath);
      return;
    }
    await atomicWriteFile(filePath, queue);
  } catch (error) {
    logger.debug('[EmbeddingQueue] Error persisting queue to disk:', error.message);
  }
}

/**
 * Persist failed items to disk
 * @param {string} filePath - Path to persist to
 * @param {Map} failedItems - Failed items map
 */
async function persistFailedItems(filePath, failedItems) {
  try {
    if (failedItems.size === 0) {
      await safeUnlink(filePath);
      return;
    }
    // Convert Map to array for JSON serialization
    const data = Array.from(failedItems.entries());
    await atomicWriteFile(filePath, data);
  } catch (error) {
    logger.debug('[EmbeddingQueue] Error persisting failed items:', error.message);
  }
}

/**
 * Persist dead letter queue to disk
 * @param {string} filePath - Path to persist to
 * @param {Array} deadLetterQueue - Dead letter queue
 */
async function persistDeadLetterQueue(filePath, deadLetterQueue) {
  try {
    if (deadLetterQueue.length === 0) {
      await safeUnlink(filePath);
      return;
    }
    await atomicWriteFile(filePath, deadLetterQueue, { pretty: true });
  } catch (error) {
    logger.debug('[EmbeddingQueue] Error persisting dead letter queue:', error.message);
  }
}

module.exports = {
  loadPersistedData,
  atomicWriteFile,
  safeUnlink,
  persistQueueData,
  persistFailedItems,
  persistDeadLetterQueue
};
