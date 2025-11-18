/**
 * Asynchronous file operations utilities
 * Provides async alternatives to synchronous Node.js fs operations
 */

const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../../shared/logger');

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
 * @returns {Promise<string|Buffer|null>} File contents or null on error
 */
async function safeReadFile(filePath, options = 'utf8') {
  try {
    return await fs.readFile(filePath, options);
  } catch (error) {
    logger.warn(`Failed to read file ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Safely write a file with directory creation
 *
 * @param {string} filePath - Path to file
 * @param {string|Buffer} data - Data to write
 * @param {string|Object} options - Encoding or options object
 * @returns {Promise<boolean>} True on success, false on error
 */
async function safeWriteFile(filePath, data, options = 'utf8') {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    await ensureDirectory(dir);

    await fs.writeFile(filePath, data, options);
    return true;
  } catch (error) {
    logger.error(`Failed to write file ${filePath}:`, error.message);
    return false;
  }
}

/**
 * Ensure a directory exists, creating it if necessary
 *
 * @param {string} dirPath - Directory path
 * @returns {Promise<boolean>} True if directory exists or was created
 */
async function ensureDirectory(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    return true;
  } catch (error) {
    // Check if it already exists
    if (error.code === 'EEXIST') {
      return true;
    }
    logger.error(`Failed to create directory ${dirPath}:`, error.message);
    return false;
  }
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
    // If rename fails (cross-device), try copy and delete
    if (error.code === 'EXDEV') {
      const copied = await copyFile(src, dest, overwrite);
      if (copied) {
        await safeDelete(src);
        return true;
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
        }),
      ),
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Watch a file or directory for changes
 *
 * @param {string} targetPath - Path to watch
 * @param {Function} callback - Callback on change
 * @param {Object} options - Watch options
 * @returns {Promise<Function>} Function to stop watching
 */
async function watchPath(targetPath, callback, options = {}) {
  const { persistent = true, recursive = false } = options;

  try {
    const watcher = fs.watch(
      targetPath,
      { persistent, recursive },
      (eventType, filename) => {
        callback(eventType, filename);
      },
    );

    return () => watcher.close();
  } catch (error) {
    logger.error(`Failed to watch ${targetPath}:`, error.message);
    return () => {};
  }
}

module.exports = {
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
};
