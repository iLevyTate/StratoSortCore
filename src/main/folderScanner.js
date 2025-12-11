const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../shared/logger');
logger.setContext('FolderScanner');

const DEFAULT_IGNORE_PATTERNS = [
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '.git',
  'node_modules',
  '__pycache__'
  // Add more common patterns if needed
];

// CRITICAL FIX: Limit concurrent file operations to prevent file handle exhaustion
const CONCURRENCY_LIMIT = 50;

async function scanDirectory(dirPath, ignorePatterns = DEFAULT_IGNORE_PATTERNS) {
  try {
    const dirents = await fs.readdir(dirPath, { withFileTypes: true });

    // Helper to process a single directory entry
    const processEntry = async (dirent) => {
      if (dirent.isSymbolicLink()) {
        return null;
      }
      const itemName = dirent.name;
      const itemPath = path.join(dirPath, itemName);

      // Check against ignore patterns
      if (
        ignorePatterns.some((pattern) => {
          if (pattern.startsWith('*.')) {
            // Basic wildcard for extensions
            return itemName.endsWith(pattern.substring(1));
          }
          return itemName === pattern;
        })
      ) {
        return null;
      }

      try {
        const stats = await fs.stat(itemPath);
        const itemInfo = {
          name: itemName,
          path: itemPath,
          type: dirent.isDirectory() ? 'folder' : 'file',
          size: stats.size,
          modified: stats.mtime ? stats.mtime.toISOString() : null
        };

        if (dirent.isDirectory()) {
          itemInfo.children = await scanDirectory(itemPath, ignorePatterns);
        }
        return itemInfo;
      } catch (statError) {
        logger.warn('Error stating file during scan', {
          path: itemPath,
          error: statError.message
        });
        return null;
      }
    };

    // CRITICAL FIX: Process in batches to prevent file handle exhaustion
    const results = [];
    for (let i = 0; i < dirents.length; i += CONCURRENCY_LIMIT) {
      const batch = dirents.slice(i, i + CONCURRENCY_LIMIT);
      const batchResults = await Promise.all(batch.map(processEntry));
      results.push(...batchResults);
    }

    return results.filter((item) => item !== null);
  } catch (error) {
    logger.error('Error scanning directory', {
      dirPath,
      error: error.message,
      code: error.code
    });
    // Optionally, rethrow or return a specific error structure
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      // Handle permission errors gracefully, e.g., by skipping the directory
      return [
        {
          name: path.basename(dirPath),
          path: dirPath,
          type: 'folder',
          error: 'Permission Denied',
          children: []
        }
      ];
    }
    // For other errors, you might want to propagate them
    throw error;
  }
}

module.exports = { scanDirectory, DEFAULT_IGNORE_PATTERNS };
