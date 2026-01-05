/**
 * Atomic File Operations (Lightweight)
 *
 * Provides safe file operations that prevent data corruption on crash.
 * Uses the temp-file + rename pattern for atomic writes.
 *
 * USE THIS MODULE FOR:
 * - Simple JSON persistence (settings, config files, state)
 * - Single-file write operations
 * - Cases where you don't need transaction rollback
 *
 * USE atomicFileOperations.js INSTEAD FOR:
 * - Multi-file operations that must succeed or fail together
 * - File moves/copies that need rollback on failure
 * - Complex transactions with state journaling
 *
 * @module shared/atomicFile
 */

const fs = require('fs').promises;
const { RETRY } = require('./performanceConstants');
const { logger } = require('./logger');

/**
 * Check if error is a Windows file lock error (AV/Indexer/Sync services)
 * @param {Error} error - The error to check
 * @returns {boolean} True if this is a transient Windows lock error
 */
function isWindowsFileLockError(error) {
  const code = error?.code;
  // Common Windows transient file lock errors during rename/replace
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
}

/**
 * Replace file with retry logic for Windows file lock issues
 *
 * Handles transient file lock errors from Windows services (antivirus, indexer, sync).
 * Falls back to copy+delete if rename consistently fails.
 *
 * @param {string} tempPath - Source temp file path
 * @param {string} filePath - Target file path
 * @param {Object} options - Options
 * @param {number} options.maxAttempts - Max rename attempts (default: 6)
 * @param {number} options.baseDelayMs - Base delay between retries (default: 40)
 * @throws {Error} If rename and fallback both fail
 */
async function replaceFileWithRetry(tempPath, filePath, options = {}) {
  const { maxAttempts = 6, baseDelayMs = RETRY?.ATOMIC_BACKOFF_STEP_MS || 40 } = options;

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fs.rename(tempPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      if (!isWindowsFileLockError(error) || attempt === maxAttempts) {
        break;
      }
      const delay = baseDelayMs * attempt;
      logger.debug('[atomicFile] Rename blocked (likely file lock), retrying', {
        attempt,
        maxAttempts,
        delayMs: delay,
        code: error.code
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Only apply copy fallback for Windows lock errors.
  // For non-lock failures (e.g., invalid path, permission issues), surface the real error.
  if (lastError && !isWindowsFileLockError(lastError)) {
    throw lastError;
  }

  // Fallback: copy into place (best effort) then remove temp.
  // This is less "atomic" but avoids losing data when Windows denies rename.
  try {
    await fs.copyFile(tempPath, filePath);
  } catch (copyError) {
    // Prefer the original error for debugging, but attach copy failure details.
    if (lastError) lastError.copyFailure = copyError;
    throw lastError || copyError;
  } finally {
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup
    }
  }
}

/**
 * Atomically write data to a file using temp + rename pattern
 *
 * This prevents data corruption if the process crashes during write:
 * 1. Write to a temp file
 * 2. Rename temp file to target (atomic on most filesystems)
 * 3. Clean up temp file on failure
 *
 * Handles Windows file lock errors with retry and copy fallback.
 *
 * @param {string} filePath - Target file path
 * @param {*} data - Data to write (will be JSON stringified)
 * @param {Object} options - Options
 * @param {boolean} options.pretty - Pretty print JSON (default: false)
 * @param {number} options.maxRetries - Max rename retries (default: 6)
 * @throws {Error} If write or rename fails after retries
 */
async function atomicWriteFile(filePath, data, options = {}) {
  const { pretty = false, maxRetries = 6 } = options;
  const tempPath = `${filePath}.tmp.${Date.now()}`;

  try {
    const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    await fs.writeFile(tempPath, content, 'utf8');

    await replaceFileWithRetry(tempPath, filePath, { maxAttempts: maxRetries });
  } catch (writeError) {
    // Clean up temp file on failure
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
 *
 * @param {string} filePath - File to delete
 * @throws {Error} Only if deletion fails for reasons other than file not existing
 */
async function safeUnlink(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

/**
 * Load and parse JSON data from a file
 *
 * @param {string} filePath - Path to the file
 * @param {Object} options - Options
 * @param {Function} options.onLoad - Callback with parsed data
 * @param {string} options.description - Description for logging
 * @param {boolean} options.backupCorrupt - Backup corrupt files (default: true)
 * @returns {Promise<*>} Parsed data or null if file doesn't exist
 */
async function loadJsonFile(filePath, options = {}) {
  const { onLoad, description = 'data', backupCorrupt = true } = options;

  try {
    const exists = await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      return null;
    }

    const data = await fs.readFile(filePath, 'utf8');

    try {
      const parsed = JSON.parse(data);
      if (onLoad) {
        onLoad(parsed);
      }
      return parsed;
    } catch (parseError) {
      logger.error(`[atomicFile] Failed to parse ${description} file`, parseError);

      if (backupCorrupt) {
        try {
          await fs.rename(filePath, `${filePath}.corrupt.${Date.now()}`);
        } catch {
          // Ignore backup errors
        }
      }

      return null;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn(`[atomicFile] Error loading ${description}:`, error.message);
    }
    return null;
  }
}

/**
 * Atomically persist data to disk, deleting file if data is empty
 *
 * @param {string} filePath - Target file path
 * @param {Array|Object} data - Data to persist
 * @param {Object} options - Options for atomicWriteFile
 */
async function persistData(filePath, data, options = {}) {
  try {
    const isEmpty = Array.isArray(data) ? data.length === 0 : Object.keys(data).length === 0;

    if (isEmpty) {
      await safeUnlink(filePath);
      return;
    }

    await atomicWriteFile(filePath, data, options);
  } catch (error) {
    logger.debug('[atomicFile] Error persisting data:', error.message);
    throw error;
  }
}

/**
 * Persist a Map to disk (converts to array for JSON serialization)
 *
 * @param {string} filePath - Target file path
 * @param {Map} map - Map to persist
 * @param {Object} options - Options for atomicWriteFile
 */
async function persistMap(filePath, map, options = {}) {
  if (map.size === 0) {
    await safeUnlink(filePath);
    return;
  }

  const data = Array.from(map.entries());
  await atomicWriteFile(filePath, data, options);
}

/**
 * Load a Map from disk
 *
 * @param {string} filePath - Source file path
 * @returns {Promise<Map|null>} Loaded Map or null if file doesn't exist
 */
async function loadMap(filePath) {
  const data = await loadJsonFile(filePath);
  if (!data || !Array.isArray(data)) {
    return null;
  }
  return new Map(data);
}

module.exports = {
  atomicWriteFile,
  safeUnlink,
  loadJsonFile,
  persistData,
  persistMap,
  loadMap,
  isWindowsFileLockError,
  replaceFileWithRetry
};
