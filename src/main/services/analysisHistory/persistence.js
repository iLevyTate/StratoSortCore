/**
 * Persistence
 *
 * File I/O operations for analysis history.
 * Handles atomic writes, loading, and saving of history, index, and config.
 *
 * @module analysisHistory/persistence
 */

const fs = require('fs').promises;
const path = require('path');
const { createLogger } = require('../../../shared/logger');
const { replaceFileWithRetry } = require('../../../shared/atomicFile');
const {
  createKeyValueStore,
  shouldUseSqliteBackend,
  isSqliteTransientError
} = require('../../utils/sqliteStore');
const { compressSync: compress, uncompressSync: uncompress } = require('../../../shared/lz4Codec');

const logger = createLogger('AnalysisHistory-Persistence');
const TRANSIENT_ERROR_CODES = new Set([
  'EACCES',
  'EPERM',
  'EBUSY',
  'EMFILE',
  'ENFILE',
  'ETIMEDOUT'
]);

const SQLITE_DB_NAME = 'analysis-history.db';
const SQLITE_TABLE = 'analysis_history_kv';
const SQLITE_KEYS = {
  config: 'config',
  history: 'history',
  index: 'index'
};
const SQLITE_COMPRESSION_ENABLED =
  String(process.env.STRATOSORT_SQLITE_COMPRESS || 'true').toLowerCase() !== 'false';

const sqliteStores = new Map();

function getSqliteDbPath(referencePath) {
  return path.join(path.dirname(referencePath), SQLITE_DB_NAME);
}

function isTransientError(error) {
  return Boolean(error?.code && TRANSIENT_ERROR_CODES.has(error.code));
}

function shouldUseSqlite() {
  return shouldUseSqliteBackend('analysisHistory');
}

function getSqliteStore(referencePath) {
  const dbPath = getSqliteDbPath(referencePath);
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

function closeSqliteStore(referencePath = null) {
  if (referencePath) {
    const dbPath = getSqliteDbPath(referencePath);
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

async function backupSqliteDb(referencePath, reason) {
  const dbPath = getSqliteDbPath(referencePath);

  // Close store to release file lock before moving
  closeSqliteStore(referencePath);

  const backupPath = `${dbPath}.corrupt.${Date.now()}`;
  try {
    await fs.copyFile(dbPath, backupPath);
    try {
      await fs.unlink(dbPath);
    } catch (unlinkError) {
      logger.warn('[AnalysisHistory] Failed to delete corrupt sqlite db after backup', {
        dbPath,
        error: unlinkError?.message || unlinkError
      });
    }
    logger.warn('[AnalysisHistory] Backed up corrupt sqlite db', {
      dbPath,
      backupPath,
      reason: reason?.message || reason
    });
  } catch (backupError) {
    logger.warn('[AnalysisHistory] Failed to back up corrupt sqlite db', {
      dbPath,
      error: backupError?.message || backupError
    });
  }
}

async function backupCorruptFile(filePath, reason) {
  const backupPath = `${filePath}.corrupt.${Date.now()}`;
  try {
    await fs.copyFile(filePath, backupPath);
    logger.warn('[AnalysisHistory] Backed up corrupt file', {
      filePath,
      backupPath,
      reason: reason?.message || reason
    });
  } catch (backupError) {
    logger.warn('[AnalysisHistory] Failed to back up corrupt file', {
      filePath,
      error: backupError?.message || backupError
    });
  }
}

async function migrateLegacyJson(filePath, key, description) {
  try {
    const json = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(json);
    const store = getSqliteStore(filePath);
    store.set(key, parsed);
    try {
      await fs.rename(filePath, `${filePath}.legacy.${Date.now()}`);
    } catch (renameError) {
      logger.debug('[AnalysisHistory] Failed to rename legacy JSON file', {
        filePath,
        error: renameError.message
      });
    }
    logger.info(`[AnalysisHistory] Migrated ${description} to SQLite`);
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    if (error instanceof SyntaxError) {
      await backupCorruptFile(filePath, error);
      return null;
    }
    if (isTransientError(error)) {
      error.transient = true;
      throw error;
    }
    logger.warn(`[AnalysisHistory] Failed to migrate legacy ${description}`, {
      error: error.message
    });
    return null;
  }
}

/**
 * Ensure parent directory exists
 * @param {string} filePath - File path
 */
async function ensureParentDirectory(filePath) {
  const parentDirectory = path.dirname(filePath);
  await fs.mkdir(parentDirectory, { recursive: true });
}

/**
 * Atomic write helper - writes to temp file then renames to prevent corruption
 * @param {string} filePath - Target file path
 * @param {string} data - Data to write
 */
async function atomicWriteFile(filePath, data) {
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  try {
    await fs.writeFile(tempPath, data);
    await replaceFileWithRetry(tempPath, filePath);
  } catch (error) {
    // Clean up temp file on failure
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

async function loadConfigFromJson(configPath, getDefaultConfig, saveConfig) {
  try {
    const configData = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const config = getDefaultConfig();
      await saveConfig(config);
      return config;
    }
    if (isTransientError(error)) {
      error.transient = true;
      throw error;
    }
    if (error instanceof SyntaxError) {
      await backupCorruptFile(configPath, error);
      const config = getDefaultConfig();
      await saveConfig(config);
      return config;
    }
    error.preserveOnError = true;
    throw error;
  }
}

async function saveConfigToJson(configPath, config) {
  config.updatedAt = new Date().toISOString();
  await ensureParentDirectory(configPath);
  await atomicWriteFile(configPath, JSON.stringify(config, null, 2));
}

/**
 * Load config from disk (SQLite-backed when available)
 * @param {string} configPath - Path to config file
 * @param {Function} getDefaultConfig - Function to get default config
 * @param {Function} saveConfig - Function to save config
 * @returns {Promise<Object>} Config object
 */
async function loadConfig(configPath, getDefaultConfig, saveConfig) {
  if (!shouldUseSqlite()) {
    return loadConfigFromJson(configPath, getDefaultConfig, saveConfig);
  }

  try {
    const store = getSqliteStore(configPath);
    let existing;
    try {
      existing = store.get(SQLITE_KEYS.config);
    } catch (error) {
      if (error?.code === 'SQLITE_CORRUPT') {
        await backupSqliteDb(configPath, error);
      }
      throw error;
    }
    if (existing !== undefined && existing !== null) {
      return existing;
    }
    const migrated = await migrateLegacyJson(configPath, SQLITE_KEYS.config, 'config');
    if (migrated) {
      return migrated;
    }
    const config = getDefaultConfig();
    store.set(SQLITE_KEYS.config, config);
    return config;
  } catch (error) {
    if (
      error?.code === 'SQLITE_CORRUPT' ||
      error?.code === 'SQLITE_NOTADB' ||
      (error?.message && error.message.includes('file is not a database'))
    ) {
      await backupSqliteDb(configPath, error);
      // Fall through to JSON fallback
    }
    if (isSqliteTransientError(error)) {
      error.transient = true;
      throw error;
    }
    logger.warn('[AnalysisHistory] SQLite loadConfig failed, falling back to JSON', {
      error: error.message
    });
    return loadConfigFromJson(configPath, getDefaultConfig, saveConfig);
  }
}

/**
 * Save config to disk
 * @param {string} configPath - Path to config file
 * @param {Object} config - Config object
 */
async function saveConfig(configPath, config) {
  if (!shouldUseSqlite()) {
    return saveConfigToJson(configPath, config);
  }
  const store = getSqliteStore(configPath);
  config.updatedAt = new Date().toISOString();
  store.set(SQLITE_KEYS.config, config, config.updatedAt);
}

async function loadHistoryFromJson(
  historyPath,
  schemaVersion,
  createEmptyHistory,
  saveHistory,
  migrateHistory
) {
  try {
    const historyData = await fs.readFile(historyPath, 'utf8');
    let history = JSON.parse(historyData);

    if (history.schemaVersion !== schemaVersion) {
      history = await migrateHistory(history);
      await saveHistory(history);
    }

    return history;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const history = createEmptyHistory();
      await saveHistory(history);
      return history;
    }
    if (isTransientError(error)) {
      error.transient = true;
      throw error;
    }
    if (error instanceof SyntaxError) {
      await backupCorruptFile(historyPath, error);
      const history = createEmptyHistory();
      await saveHistory(history);
      return history;
    }
    error.preserveOnError = true;
    throw error;
  }
}

async function saveHistoryToJson(historyPath, history) {
  history.updatedAt = new Date().toISOString();
  await ensureParentDirectory(historyPath);
  await atomicWriteFile(historyPath, JSON.stringify(history, null, 2));
}

/**
 * Load history from disk
 * @param {string} historyPath - Path to history file
 * @param {string} schemaVersion - Current schema version
 * @param {Function} createEmptyHistory - Function to create empty history
 * @param {Function} saveHistory - Function to save history
 * @param {Function} migrateHistory - Function to migrate history
 * @returns {Promise<Object>} History object
 */
async function loadHistory(
  historyPath,
  schemaVersion,
  createEmptyHistory,
  saveHistory,
  migrateHistory
) {
  if (!shouldUseSqlite()) {
    return loadHistoryFromJson(
      historyPath,
      schemaVersion,
      createEmptyHistory,
      saveHistory,
      migrateHistory
    );
  }

  try {
    const store = getSqliteStore(historyPath);
    let history;
    try {
      history = store.get(SQLITE_KEYS.history);
    } catch (error) {
      if (error?.code === 'SQLITE_CORRUPT') {
        await backupSqliteDb(historyPath, error);
      }
      throw error;
    }
    if (history === undefined || history === null) {
      history = await migrateLegacyJson(historyPath, SQLITE_KEYS.history, 'history');
    }
    if (history === undefined || history === null) {
      history = createEmptyHistory();
      store.set(SQLITE_KEYS.history, history);
      return history;
    }

    if (history.schemaVersion !== schemaVersion) {
      history = await migrateHistory(history);
      store.set(SQLITE_KEYS.history, history);
    }

    return history;
  } catch (error) {
    if (
      error?.code === 'SQLITE_CORRUPT' ||
      error?.code === 'SQLITE_NOTADB' ||
      (error?.message && error.message.includes('file is not a database'))
    ) {
      await backupSqliteDb(historyPath, error);
      // Fall through to JSON fallback
    }
    if (isSqliteTransientError(error)) {
      error.transient = true;
      throw error;
    }
    logger.warn('[AnalysisHistory] SQLite loadHistory failed, falling back to JSON', {
      error: error.message
    });
    return loadHistoryFromJson(
      historyPath,
      schemaVersion,
      createEmptyHistory,
      saveHistory,
      migrateHistory
    );
  }
}

/**
 * Save history to disk
 * @param {string} historyPath - Path to history file
 * @param {Object} history - History object
 */
async function saveHistory(historyPath, history) {
  if (!shouldUseSqlite()) {
    return saveHistoryToJson(historyPath, history);
  }
  const store = getSqliteStore(historyPath);
  history.updatedAt = new Date().toISOString();
  store.set(SQLITE_KEYS.history, history, history.updatedAt);
}

async function loadIndexFromJson(indexPath, createEmptyIndex, saveIndex) {
  try {
    const indexData = await fs.readFile(indexPath, 'utf8');
    return JSON.parse(indexData);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const index = createEmptyIndex();
      await saveIndex(index);
      return index;
    }
    if (isTransientError(error)) {
      error.transient = true;
      throw error;
    }
    if (error instanceof SyntaxError) {
      await backupCorruptFile(indexPath, error);
      const index = createEmptyIndex();
      await saveIndex(index);
      return index;
    }
    error.preserveOnError = true;
    throw error;
  }
}

async function saveIndexToJson(indexPath, index) {
  index.updatedAt = new Date().toISOString();
  await ensureParentDirectory(indexPath);
  await atomicWriteFile(indexPath, JSON.stringify(index, null, 2));
}

/**
 * Load index from disk
 * @param {string} indexPath - Path to index file
 * @param {Function} createEmptyIndex - Function to create empty index
 * @param {Function} saveIndex - Function to save index
 * @returns {Promise<Object>} Index object
 */
async function loadIndex(indexPath, createEmptyIndex, saveIndex) {
  if (!shouldUseSqlite()) {
    return loadIndexFromJson(indexPath, createEmptyIndex, saveIndex);
  }

  try {
    const store = getSqliteStore(indexPath);
    let index;
    try {
      index = store.get(SQLITE_KEYS.index);
    } catch (error) {
      if (error?.code === 'SQLITE_CORRUPT') {
        await backupSqliteDb(indexPath, error);
      }
      throw error;
    }
    if (index === undefined || index === null) {
      index = await migrateLegacyJson(indexPath, SQLITE_KEYS.index, 'index');
    }
    if (index === undefined || index === null) {
      index = createEmptyIndex();
      store.set(SQLITE_KEYS.index, index);
    }
    return index;
  } catch (error) {
    if (
      error?.code === 'SQLITE_CORRUPT' ||
      error?.code === 'SQLITE_NOTADB' ||
      (error?.message && error.message.includes('file is not a database'))
    ) {
      await backupSqliteDb(indexPath, error);
      // Fall through to JSON fallback
    }
    if (isSqliteTransientError(error)) {
      error.transient = true;
      throw error;
    }
    logger.warn('[AnalysisHistory] SQLite loadIndex failed, falling back to JSON', {
      error: error.message
    });
    return loadIndexFromJson(indexPath, createEmptyIndex, saveIndex);
  }
}

/**
 * Save index to disk
 * @param {string} indexPath - Path to index file
 * @param {Object} index - Index object
 */
async function saveIndex(indexPath, index) {
  if (!shouldUseSqlite()) {
    return saveIndexToJson(indexPath, index);
  }
  const store = getSqliteStore(indexPath);
  index.updatedAt = new Date().toISOString();
  store.set(SQLITE_KEYS.index, index, index.updatedAt);
}

/**
 * Create default structures and save to disk
 * @param {Object} paths - Object with configPath, historyPath, indexPath
 * @param {Function} getDefaultConfig - Function to get default config
 * @param {Function} createEmptyHistory - Function to create empty history
 * @param {Function} createEmptyIndex - Function to create empty index
 * @returns {Promise<{config: Object, history: Object, index: Object}>}
 */
async function createDefaultStructures(
  paths,
  getDefaultConfig,
  createEmptyHistory,
  createEmptyIndex
) {
  const config = getDefaultConfig();
  const history = createEmptyHistory();
  const index = createEmptyIndex();

  if (shouldUseSqlite()) {
    const store = getSqliteStore(paths.configPath);
    const now = new Date().toISOString();
    config.updatedAt = now;
    history.updatedAt = now;
    index.updatedAt = now;
    store.set(SQLITE_KEYS.config, config, now);
    store.set(SQLITE_KEYS.history, history, now);
    store.set(SQLITE_KEYS.index, index, now);
  } else {
    await Promise.all([
      saveConfigToJson(paths.configPath, config),
      saveHistoryToJson(paths.historyPath, history),
      saveIndexToJson(paths.indexPath, index)
    ]);
  }

  return { config, history, index };
}

module.exports = {
  ensureParentDirectory,
  atomicWriteFile,
  loadConfig,
  saveConfig,
  loadHistory,
  saveHistory,
  loadIndex,
  saveIndex,
  createDefaultStructures,
  closeSqliteStore
};
