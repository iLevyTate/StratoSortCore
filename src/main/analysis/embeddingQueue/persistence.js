/**
 * Embedding Queue Persistence Module
 *
 * Handles file I/O operations for queue persistence with atomic writes.
 * Uses shared atomicFile utilities for consistent atomic file operations.
 *
 * @module embeddingQueue/persistence
 */

const path = require('path');
const fs = require('fs').promises;
const { logger } = require('../../../shared/logger');
const { createKeyValueStore, shouldUseSqliteBackend } = require('../../utils/sqliteStore');
const { compressSync: compress, uncompressSync: uncompress } = require('../../../shared/lz4Codec');
const {
  atomicWriteFile,
  safeUnlink,
  loadJsonFile,
  persistData,
  persistMap
} = require('../../../shared/atomicFile');

const SQLITE_DB_NAME = 'embedding-queue.db';
const SQLITE_TABLE = 'embedding_queue_kv';
const SQLITE_KEYS = {
  queue: 'queue',
  failedItems: 'failedItems',
  deadLetter: 'deadLetter'
};

const sqliteStores = new Map();
const SQLITE_COMPRESSION_ENABLED =
  String(process.env.STRATOSORT_SQLITE_COMPRESS || 'true').toLowerCase() !== 'false';

function shouldUseSqlite() {
  return shouldUseSqliteBackend('embeddingQueue');
}

function getSqliteDbPath(filePath) {
  return path.join(path.dirname(filePath), SQLITE_DB_NAME);
}

function getSqliteStore(filePath) {
  const dbPath = getSqliteDbPath(filePath);
  if (sqliteStores.has(dbPath)) {
    return sqliteStores.get(dbPath);
  }
  const store = createKeyValueStore({
    dbPath,
    tableName: SQLITE_TABLE,
    serialize: (value) => {
      const json = JSON.stringify(value);
      if (!SQLITE_COMPRESSION_ENABLED) {
        return Buffer.from(json, 'utf8');
      }
      return compress(Buffer.from(json, 'utf8'));
    },
    deserialize: (raw) => {
      const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      const text = buffer.toString('utf8');
      try {
        return JSON.parse(text);
      } catch (jsonError) {
        try {
          const decompressed = uncompress(buffer);
          return JSON.parse(decompressed.toString('utf8'));
        } catch (decompressError) {
          const err = new Error('SQLite blob decode failed');
          err.code = 'SQLITE_CORRUPT';
          err.originalError = jsonError;
          err.decompressError = decompressError;
          throw err;
        }
      }
    }
  });
  sqliteStores.set(dbPath, store);
  return store;
}

function closeSqliteStore(filePath = null) {
  if (filePath) {
    const dbPath = getSqliteDbPath(filePath);
    const store = sqliteStores.get(dbPath);
    if (store && typeof store.close === 'function') {
      store.close();
    }
    sqliteStores.delete(dbPath);
    return;
  }

  for (const [dbPath, store] of sqliteStores.entries()) {
    if (store && typeof store.close === 'function') {
      store.close();
    }
    sqliteStores.delete(dbPath);
  }
}

async function backupSqliteDb(filePath, reason) {
  const dbPath = getSqliteDbPath(filePath);

  closeSqliteStore(filePath);

  const backupPath = `${dbPath}.corrupt.${Date.now()}`;
  try {
    await fs.copyFile(dbPath, backupPath);
    try {
      await fs.unlink(dbPath);
    } catch (unlinkError) {
      logger.warn('[EmbeddingQueue] Failed to delete corrupt sqlite db after backup', {
        dbPath,
        error: unlinkError?.message || unlinkError
      });
    }
    logger.warn('[EmbeddingQueue] Backed up corrupt sqlite db', {
      dbPath,
      backupPath,
      reason: reason?.message || reason
    });
  } catch (backupError) {
    logger.warn('[EmbeddingQueue] Failed to back up corrupt sqlite db', {
      dbPath,
      error: backupError?.message || backupError
    });
  }
}

async function maybeMigrateLegacyFile(filePath, key, description) {
  const parsed = await loadJsonFile(filePath, {
    description,
    backupCorrupt: true
  });
  if (parsed === null || parsed === undefined) {
    return null;
  }
  const store = getSqliteStore(filePath);
  store.set(key, parsed);
  try {
    await fs.rename(filePath, `${filePath}.legacy.${Date.now()}`);
  } catch (error) {
    logger.debug('[EmbeddingQueue] Failed to rename legacy persistence file', {
      filePath,
      error: error.message
    });
  }
  return parsed;
}

/**
 * Load persisted data from a file
 * @param {string} filePath - Path to the file
 * @param {Function} onLoad - Callback with parsed data
 * @param {string} description - Description for logging
 */
async function loadPersistedData(filePath, onLoad, description, options = {}) {
  const key = options.key;
  if (shouldUseSqlite()) {
    try {
      const store = getSqliteStore(filePath);
      const existing = store.get(key);
      if (existing !== undefined) {
        if (onLoad) onLoad(existing);
        return;
      }
      const migrated = await maybeMigrateLegacyFile(filePath, key, description);
      if (migrated !== null && migrated !== undefined) {
        if (onLoad) onLoad(migrated);
      }
      return;
    } catch (error) {
      if (
        error?.code === 'SQLITE_CORRUPT' ||
        error?.code === 'SQLITE_NOTADB' ||
        (error?.message && error.message.includes('file is not a database'))
      ) {
        await backupSqliteDb(filePath, error);
        // closeSqliteStore() is handled inside backupSqliteDb
      }
      logger.warn('[EmbeddingQueue] SQLite load failed, falling back to JSON', {
        error: error.message
      });
    }
  }

  await loadJsonFile(filePath, {
    onLoad,
    description,
    backupCorrupt: true
  });
}

/**
 * Persist queue data to disk
 * @param {string} filePath - Path to persist to
 * @param {Array} queue - Queue data to persist
 */
async function persistQueueData(filePath, queue, options = {}) {
  const key = options.key || SQLITE_KEYS.queue;
  try {
    if (shouldUseSqlite()) {
      const store = getSqliteStore(filePath);
      store.set(key, queue);
      return;
    }
    await persistData(filePath, queue);
  } catch (error) {
    // Log but don't re-throw: persistence errors should not break callers
    // (shutdown, periodic save) who expect fire-and-forget semantics
    logger.error('[EmbeddingQueue] Error persisting queue to disk:', error.message);
  }
}

/**
 * Persist failed items to disk
 * @param {string} filePath - Path to persist to
 * @param {Map} failedItems - Failed items map
 */
async function persistFailedItems(filePath, failedItems, options = {}) {
  const key = options.key || SQLITE_KEYS.failedItems;
  try {
    if (shouldUseSqlite()) {
      const store = getSqliteStore(filePath);
      const data = Array.from(failedItems.entries());
      store.set(key, data);
      return;
    }
    await persistMap(filePath, failedItems);
  } catch (error) {
    logger.error('[EmbeddingQueue] Error persisting failed items:', error.message);
  }
}

/**
 * Persist dead letter queue to disk
 * @param {string} filePath - Path to persist to
 * @param {Array} deadLetterQueue - Dead letter queue
 */
async function persistDeadLetterQueue(filePath, deadLetterQueue, options = {}) {
  const key = options.key || SQLITE_KEYS.deadLetter;
  try {
    if (shouldUseSqlite()) {
      const store = getSqliteStore(filePath);
      store.set(key, deadLetterQueue);
      return;
    }
    await persistData(filePath, deadLetterQueue, { pretty: true });
  } catch (error) {
    logger.error('[EmbeddingQueue] Error persisting dead letter queue:', error.message);
  }
}

module.exports = {
  loadPersistedData,
  atomicWriteFile,
  safeUnlink,
  persistQueueData,
  persistFailedItems,
  persistDeadLetterQueue,
  SQLITE_KEYS
};
