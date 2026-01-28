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
const { logger } = require('../../../shared/logger');
const { replaceFileWithRetry } = require('../../../shared/atomicFile');

logger.setContext('AnalysisHistory-Persistence');

const TRANSIENT_ERROR_CODES = new Set([
  'EACCES',
  'EPERM',
  'EBUSY',
  'EMFILE',
  'ENFILE',
  'ETIMEDOUT'
]);

function isTransientError(error) {
  return Boolean(error?.code && TRANSIENT_ERROR_CODES.has(error.code));
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

/**
 * Load config from disk
 * @param {string} configPath - Path to config file
 * @param {Function} getDefaultConfig - Function to get default config
 * @param {Function} saveConfig - Function to save config
 * @returns {Promise<Object>} Config object
 */
async function loadConfig(configPath, getDefaultConfig, saveConfig) {
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

/**
 * Save config to disk
 * @param {string} configPath - Path to config file
 * @param {Object} config - Config object
 */
async function saveConfig(configPath, config) {
  config.updatedAt = new Date().toISOString();
  await ensureParentDirectory(configPath);
  await atomicWriteFile(configPath, JSON.stringify(config, null, 2));
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
  try {
    const historyData = await fs.readFile(historyPath, 'utf8');
    let history = JSON.parse(historyData);

    // Validate schema version
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

/**
 * Save history to disk
 * @param {string} historyPath - Path to history file
 * @param {Object} history - History object
 */
async function saveHistory(historyPath, history) {
  history.updatedAt = new Date().toISOString();
  await ensureParentDirectory(historyPath);
  await atomicWriteFile(historyPath, JSON.stringify(history, null, 2));
}

/**
 * Load index from disk
 * @param {string} indexPath - Path to index file
 * @param {Function} createEmptyIndex - Function to create empty index
 * @param {Function} saveIndex - Function to save index
 * @returns {Promise<Object>} Index object
 */
async function loadIndex(indexPath, createEmptyIndex, saveIndex) {
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

/**
 * Save index to disk
 * @param {string} indexPath - Path to index file
 * @param {Object} index - Index object
 */
async function saveIndex(indexPath, index) {
  index.updatedAt = new Date().toISOString();
  await ensureParentDirectory(indexPath);
  await atomicWriteFile(indexPath, JSON.stringify(index, null, 2));
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

  await Promise.all([
    saveConfig(paths.configPath, config),
    saveHistory(paths.historyPath, history),
    saveIndex(paths.indexPath, index)
  ]);

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
  createDefaultStructures
};
