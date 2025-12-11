/**
 * Asynchronous file operations utilities
 * Provides async alternatives to synchronous Node.js fs operations
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { logger } = require('../../shared/logger');
const {
  FileSystemError,
  WatcherError,
  FILE_SYSTEM_ERROR_CODES
} = require('../errors/FileSystemError');
const { crossDeviceMove } = require('../../shared/atomicFileOperations');

logger.setContext('AsyncFileOps');

/**
 * Check if a file or directory exists asynchronously
 *
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>} True if exists, false otherwise
 */
async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely read a file with error handling
 *
 * @param {string} filePath - Path to file
 * @param {string|Object} options - Encoding or options object
 * @returns {Promise<{data: string|Buffer|null, error: FileSystemError|null}>} File contents and error info
 */
async function safeReadFile(filePath, options = 'utf8') {
  try {
    const data = await fs.readFile(filePath, options);
    return { data, error: null };
  } catch (error) {
    const fsError = FileSystemError.fromNodeError(error, {
      path: filePath,
      operation: 'read'
    });

    // Only log warning for non-ENOENT errors (missing files are often expected)
    if (error.code !== 'ENOENT') {
      logger.warn(`[ASYNC-OPS] Failed to read file:`, {
        path: filePath,
        error: fsError.getUserFriendlyMessage(),
        code: fsError.code
      });
    }

    return { data: null, error: fsError };
  }
}

/**
 * Read a file with legacy return signature (null on error)
 * For backwards compatibility
 *
 * @param {string} filePath - Path to file
 * @param {string|Object} options - Encoding or options object
 * @returns {Promise<string|Buffer|null>} File contents or null on error
 */
async function safeReadFileLegacy(filePath, options = 'utf8') {
  const result = await safeReadFile(filePath, options);
  return result.data;
}

/**
 * Safely write a file with directory creation
 *
 * @param {string} filePath - Path to file
 * @param {string|Buffer} data - Data to write
 * @param {string|Object} options - Encoding or options object
 * @returns {Promise<{success: boolean, error: FileSystemError|null}>} Result with error info
 */
async function safeWriteFile(filePath, data, options = 'utf8') {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    const dirResult = await ensureDirectory(dir);
    if (!dirResult.success) {
      return { success: false, error: dirResult.error };
    }

    // FIX: Use atomic write (temp + rename) to prevent corruption on crash
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    try {
      await fs.writeFile(tempPath, data, options);

      // Verify write succeeded before renaming
      const stats = await fs.stat(tempPath);
      const expectedSize = Buffer.isBuffer(data)
        ? data.length
        : Buffer.byteLength(
            data,
            typeof options === 'string' ? options : options.encoding || 'utf8'
          );

      if (stats.size !== expectedSize) {
        // Clean up temp file
        try {
          await fs.unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }
        const fsError = new FileSystemError(FILE_SYSTEM_ERROR_CODES.PARTIAL_WRITE, {
          path: filePath,
          operation: 'write',
          expectedSize,
          actualSize: stats.size
        });
        logger.error('[ASYNC-OPS] Partial write detected:', {
          path: filePath,
          expectedSize,
          actualSize: stats.size
        });
        return { success: false, error: fsError };
      }

      // Atomic rename with retry for Windows EPERM errors
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
      // Clean up temp file on failure
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw writeError;
    }

    return { success: true, error: null };
  } catch (error) {
    const fsError = FileSystemError.fromNodeError(error, {
      path: filePath,
      operation: 'write'
    });
    logger.error('[ASYNC-OPS] Failed to write file:', {
      path: filePath,
      error: fsError.getUserFriendlyMessage(),
      code: fsError.code
    });
    return { success: false, error: fsError };
  }
}

/**
 * Write a file with legacy return signature (boolean)
 * For backwards compatibility
 *
 * @param {string} filePath - Path to file
 * @param {string|Buffer} data - Data to write
 * @param {string|Object} options - Encoding or options object
 * @returns {Promise<boolean>} True on success, false on error
 */
async function safeWriteFileLegacy(filePath, data, options = 'utf8') {
  const result = await safeWriteFile(filePath, data, options);
  return result.success;
}

/**
 * Ensure a directory exists, creating it if necessary
 *
 * @param {string} dirPath - Directory path
 * @returns {Promise<{success: boolean, error: FileSystemError|null}>} Result with error info
 */
async function ensureDirectory(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    return { success: true, error: null };
  } catch (error) {
    // Check if it already exists
    if (error.code === 'EEXIST') {
      return { success: true, error: null };
    }

    const fsError = FileSystemError.fromNodeError(error, {
      path: dirPath,
      operation: 'mkdir'
    });

    logger.error('[ASYNC-OPS] Failed to create directory:', {
      path: dirPath,
      error: fsError.getUserFriendlyMessage(),
      code: fsError.code
    });

    return { success: false, error: fsError };
  }
}

/**
 * Ensure directory with legacy return signature (boolean)
 * For backwards compatibility
 *
 * @param {string} dirPath - Directory path
 * @returns {Promise<boolean>} True if directory exists or was created
 */
async function ensureDirectoryLegacy(dirPath) {
  const result = await ensureDirectory(dirPath);
  return result.success;
}

/**
 * Get file stats asynchronously
 *
 * @param {string} filePath - Path to file
 * @returns {Promise<fs.Stats|null>} File stats or null on error
 */
async function safeStat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    logger.warn(`Failed to get stats for ${filePath}:`, error.message);
    return null;
  }
}

/**
 * List files in a directory with optional filtering
 *
 * @param {string} dirPath - Directory path
 * @param {Object} options - Options for listing
 * @param {Function} options.filter - Filter function for files
 * @param {boolean} options.recursive - List recursively
 * @param {boolean} options.withStats - Include file stats
 * @returns {Promise<Array>} Array of file paths or objects with stats
 */
async function listFiles(dirPath, options = {}) {
  const { filter, recursive = false, withStats = false } = options;
  const results = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory() && recursive) {
        const subFiles = await listFiles(fullPath, options);
        results.push(...subFiles);
      } else if (entry.isFile()) {
        if (!filter || filter(fullPath, entry)) {
          if (withStats) {
            const stats = await safeStat(fullPath);
            results.push({ path: fullPath, stats });
          } else {
            results.push(fullPath);
          }
        }
      }
    }
  } catch (error) {
    logger.error(`Failed to list files in ${dirPath}:`, error.message);
  }

  return results;
}

/**
 * Copy a file asynchronously
 *
 * @param {string} src - Source file path
 * @param {string} dest - Destination file path
 * @param {boolean} overwrite - Whether to overwrite existing file
 * @returns {Promise<boolean>} True on success
 */
async function copyFile(src, dest, overwrite = false) {
  try {
    // Check if destination exists
    if (!overwrite && (await exists(dest))) {
      logger.warn(`Destination file already exists: ${dest}`);
      return false;
    }

    // Ensure destination directory exists
    await ensureDirectory(path.dirname(dest));

    await fs.copyFile(src, dest);
    return true;
  } catch (error) {
    logger.error(`Failed to copy ${src} to ${dest}:`, error.message);
    return false;
  }
}

/**
 * Move/rename a file asynchronously
 *
 * @param {string} src - Source file path
 * @param {string} dest - Destination file path
 * @param {boolean} overwrite - Whether to overwrite existing file
 * @returns {Promise<boolean>} True on success
 */
async function moveFile(src, dest, overwrite = false) {
  try {
    // Check if destination exists
    if (!overwrite && (await exists(dest))) {
      logger.warn(`Destination file already exists: ${dest}`);
      return false;
    }

    // Ensure destination directory exists
    await ensureDirectory(path.dirname(dest));

    await fs.rename(src, dest);
    return true;
  } catch (error) {
    // If rename fails (cross-device), use shared crossDeviceMove utility
    if (error.code === 'EXDEV') {
      try {
        await crossDeviceMove(src, dest, { verify: true });
        return true;
      } catch (crossDeviceError) {
        logger.error(`Failed cross-device move ${src} to ${dest}:`, crossDeviceError.message);
        return false;
      }
    }
    logger.error(`Failed to move ${src} to ${dest}:`, error.message);
    return false;
  }
}

/**
 * Delete a file or directory safely
 *
 * @param {string} targetPath - Path to delete
 * @param {boolean} recursive - Delete directories recursively
 * @returns {Promise<boolean>} True on success
 */
async function safeDelete(targetPath, recursive = false) {
  try {
    const stats = await safeStat(targetPath);
    if (!stats) {
      return true; // Already doesn't exist
    }

    if (stats.isDirectory()) {
      await fs.rmdir(targetPath, { recursive });
    } else {
      await fs.unlink(targetPath);
    }
    return true;
  } catch (error) {
    logger.error(`Failed to delete ${targetPath}:`, error.message);
    return false;
  }
}

/**
 * Read JSON file asynchronously with error handling
 *
 * @param {string} filePath - Path to JSON file
 * @param {*} defaultValue - Default value on error or missing file
 * @returns {Promise<*>} Parsed JSON or default value
 */
async function readJSON(filePath, defaultValue = null) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn(`Failed to read JSON file ${filePath}:`, error.message);
    }
    return defaultValue;
  }
}

/**
 * Write JSON file asynchronously with formatting
 *
 * @param {string} filePath - Path to JSON file
 * @param {*} data - Data to write
 * @param {number} spaces - Number of spaces for indentation
 * @returns {Promise<boolean>} True on success
 */
async function writeJSON(filePath, data, spaces = 2) {
  try {
    const json = JSON.stringify(data, null, spaces);
    return await safeWriteFile(filePath, json);
  } catch (error) {
    logger.error(`Failed to write JSON file ${filePath}:`, error.message);
    return false;
  }
}

/**
 * Process files in batches to avoid overwhelming the system
 *
 * @param {Array} files - Array of file paths
 * @param {Function} processor - Async function to process each file
 * @param {number} batchSize - Number of files to process concurrently
 * @returns {Promise<Array>} Results of processing
 */
async function processBatch(files, processor, batchSize = 5) {
  const results = [];

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((file) =>
        processor(file).catch((err) => {
          logger.error(`Error processing ${file}:`, err.message);
          return null;
        })
      )
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Watch a file or directory for changes with resilient error handling
 *
 * @param {string} targetPath - Path to watch
 * @param {Function} callback - Callback on change (eventType, filename)
 * @param {Object} options - Watch options
 * @param {boolean} options.persistent - Keep process running (default: true)
 * @param {boolean} options.recursive - Watch recursively (default: false)
 * @param {Function} options.onError - Error callback
 * @returns {Promise<{close: Function, isActive: Function, error: FileSystemError|null}>} Watcher control object
 */
async function watchPath(targetPath, callback, options = {}) {
  const { persistent = true, recursive = false, onError = null } = options;

  let watcher = null;
  let isActive = false;
  let lastError = null;

  try {
    // Verify path exists before watching
    try {
      await fs.access(targetPath);
    } catch (accessError) {
      const fsError = FileSystemError.fromNodeError(accessError, {
        path: targetPath,
        operation: 'watch'
      });
      logger.error('[ASYNC-OPS] Cannot watch path - does not exist:', {
        path: targetPath,
        error: fsError.getUserFriendlyMessage()
      });
      return {
        close: () => {},
        isActive: () => false,
        error: fsError
      };
    }

    // Use synchronous fs.watch (not promisified) for watching
    watcher = fsSync.watch(targetPath, { persistent, recursive }, (eventType, filename) => {
      try {
        callback(eventType, filename);
      } catch (callbackError) {
        logger.error('[ASYNC-OPS] Watcher callback error:', {
          path: targetPath,
          eventType,
          filename,
          error: callbackError.message
        });
      }
    });

    isActive = true;

    // Handle watcher errors
    watcher.on('error', (error) => {
      isActive = false;
      const fsError = new WatcherError(targetPath, error);
      lastError = fsError;

      logger.error('[ASYNC-OPS] Watcher error:', {
        path: targetPath,
        error: fsError.getUserFriendlyMessage(),
        code: fsError.code
      });

      if (onError) {
        try {
          onError(fsError);
        } catch (onErrorError) {
          logger.error('[ASYNC-OPS] onError callback failed:', onErrorError.message);
        }
      }
    });

    // Handle watcher close
    watcher.on('close', () => {
      isActive = false;
      logger.debug('[ASYNC-OPS] Watcher closed:', targetPath);
    });

    logger.debug('[ASYNC-OPS] Started watching:', targetPath);

    return {
      close: () => {
        if (watcher) {
          try {
            watcher.close();
          } catch (closeError) {
            logger.warn('[ASYNC-OPS] Error closing watcher:', closeError.message);
          }
          isActive = false;
        }
      },
      isActive: () => isActive,
      error: null,
      getLastError: () => lastError
    };
  } catch (error) {
    const fsError = new WatcherError(targetPath, error);
    logger.error('[ASYNC-OPS] Failed to start watcher:', {
      path: targetPath,
      error: fsError.getUserFriendlyMessage(),
      code: fsError.code
    });

    return {
      close: () => {},
      isActive: () => false,
      error: fsError
    };
  }
}

/**
 * Watch path with legacy return signature (just close function)
 * For backwards compatibility
 *
 * @param {string} targetPath - Path to watch
 * @param {Function} callback - Callback on change
 * @param {Object} options - Watch options
 * @returns {Promise<Function>} Function to stop watching
 */
async function watchPathLegacy(targetPath, callback, options = {}) {
  const result = await watchPath(targetPath, callback, options);
  return result.close;
}

module.exports = {
  // Core functions with error info
  exists,
  safeReadFile,
  safeWriteFile,
  ensureDirectory,
  safeStat,
  listFiles,
  copyFile,
  moveFile,
  safeDelete,
  readJSON,
  writeJSON,
  processBatch,
  watchPath,

  // Legacy functions for backwards compatibility
  safeReadFileLegacy,
  safeWriteFileLegacy,
  ensureDirectoryLegacy,
  watchPathLegacy,

  // Re-export error classes for convenience
  FileSystemError,
  WatcherError,
  FILE_SYSTEM_ERROR_CODES
};
