const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../shared/logger');
const { isPermissionError } = require('../shared/errorClassifier');
const { TIMEOUTS } = require('../shared/performanceConstants');

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
const MAX_LOG_SAMPLES = 5;

function withTimeout(promise, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label || 'Operation'} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

/**
 * Scan a directory recursively.
 *
 * Notes:
 * - Designed to be resilient on slow/network drives: supports a time budget and max file/depth caps.
 * - By default, includes fs.stat metadata; callers that only need paths/names should disable it.
 *
 * @param {string} dirPath
 * @param {string[]} [ignorePatterns]
 * @param {object} [options]
 * @param {boolean} [options.includeStats=true] - Whether to stat each entry (expensive on network drives)
 * @param {number} [options.maxDepth=Infinity] - Max recursion depth (0 = only current directory)
 * @param {number} [options.maxFiles=Infinity] - Max number of files to include across full scan
 * @param {number} [options.timeoutMs=TIMEOUTS.DIRECTORY_SCAN] - Overall time budget for scan
 * @param {number} [options.perDirectoryTimeoutMs=TIMEOUTS.FILE_READ] - Timeout for a single fs op
 * @returns {Promise<Array>} Array of itemInfo nodes; top-level return has non-enumerable __scanMeta
 */
async function scanDirectory(
  dirPath,
  ignorePatterns = DEFAULT_IGNORE_PATTERNS,
  options = {},
  _ctx
) {
  const {
    includeStats = true,
    maxDepth = Infinity,
    maxFiles = Infinity,
    timeoutMs = TIMEOUTS.DIRECTORY_SCAN || 60000,
    perDirectoryTimeoutMs = TIMEOUTS.FILE_READ || 5000
  } = options || {};

  const ctx =
    _ctx ||
    (() => {
      const startedAt = Date.now();
      const deadlineAt = Number.isFinite(timeoutMs) ? Date.now() + timeoutMs : Infinity;
      return {
        startedAt,
        deadlineAt,
        remainingFiles: Number.isFinite(maxFiles) ? maxFiles : Infinity,
        partial: false,
        partialReasons: new Set(),
        // Progress diagnostics
        lastDirectory: null,
        lastEntry: null,
        directoriesVisited: 0,
        filesIncluded: 0,
        // Aggregated error diagnostics
        timeouts: 0,
        // Best-effort diagnostics (used by IPC caller for UX messaging)
        skippedDirectories: 0,
        skippedErrors: 0,
        errorSamples: []
      };
    })();

  ctx.lastDirectory = dirPath;
  ctx.directoriesVisited += 1;

  try {
    if (Date.now() > ctx.deadlineAt) {
      ctx.partial = true;
      ctx.partialReasons.add('deadline');
      return [];
    }

    const dirents = await withTimeout(
      fs.readdir(dirPath, { withFileTypes: true }),
      perDirectoryTimeoutMs,
      'readdir'
    );

    // Helper to process a single directory entry
    const processEntry = async (dirent) => {
      if (Date.now() > ctx.deadlineAt) {
        ctx.partial = true;
        ctx.partialReasons.add('deadline');
        return null;
      }
      if (ctx.remainingFiles <= 0) {
        ctx.partial = true;
        ctx.partialReasons.add('maxFiles');
        return null;
      }
      if (dirent.isSymbolicLink()) {
        return null;
      }
      const itemName = dirent.name;
      const itemPath = path.join(dirPath, itemName);
      ctx.lastEntry = itemPath;

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
        const itemInfo = {
          name: itemName,
          path: itemPath,
          type: dirent.isDirectory() ? 'folder' : 'file',
          size: null,
          modified: null
        };

        if (includeStats) {
          const stats = await withTimeout(fs.stat(itemPath), perDirectoryTimeoutMs, 'stat');
          itemInfo.size = stats.size;
          itemInfo.modified = stats.mtime ? stats.mtime.toISOString() : null;
        }

        if (dirent.isDirectory()) {
          const currentDepth = Number.isFinite(options.currentDepth) ? options.currentDepth : 0;
          const nextDepth = currentDepth + 1;
          if (nextDepth <= maxDepth) {
            itemInfo.children = await scanDirectory(
              itemPath,
              ignorePatterns,
              { ...options, currentDepth: nextDepth },
              ctx
            );
          } else {
            // Depth-capped: do not recurse further; still return the folder node
            ctx.partial = true;
            ctx.partialReasons.add('maxDepth');
            itemInfo.children = [];
          }
        } else {
          ctx.remainingFiles -= 1;
          ctx.filesIncluded += 1;
        }
        return itemInfo;
      } catch (statError) {
        const isTimeout = String(statError?.message || '').includes('timed out');
        if (isTimeout) {
          ctx.timeouts += 1;
          ctx.partial = true;
          ctx.partialReasons.add('timeouts');
          if (dirent.isDirectory()) ctx.skippedDirectories += 1;
        } else {
          ctx.skippedErrors += 1;
        }

        if (ctx.errorSamples.length < MAX_LOG_SAMPLES) {
          ctx.errorSamples.push({
            path: itemPath,
            error: statError.message,
            isTimeout
          });
        }

        // Avoid log spam on huge scans; keep first few samples + a suppression notice.
        const totalIssues = ctx.skippedErrors + ctx.timeouts;
        if (totalIssues <= MAX_LOG_SAMPLES) {
          logger.warn('Error reading entry during scan', {
            path: itemPath,
            error: statError.message
          });
        } else if (totalIssues === MAX_LOG_SAMPLES + 1) {
          logger.warn('Suppressing further per-entry scan warnings (too many issues)', {
            dirPath
          });
        }
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

    const filtered = results.filter((item) => item !== null);
    // Attach scan meta to the top-level return value (non-breaking for existing callers).
    if (!_ctx) {
      const durationMs = Date.now() - ctx.startedAt;
      Object.defineProperty(filtered, '__scanMeta', {
        value: {
          partial: ctx.partial || Date.now() > ctx.deadlineAt || ctx.remainingFiles <= 0,
          reasons: Array.from(ctx.partialReasons),
          durationMs,
          includeStats,
          maxDepth,
          maxFiles,
          timeoutMs,
          perDirectoryTimeoutMs,
          lastDirectory: ctx.lastDirectory,
          lastEntry: ctx.lastEntry,
          directoriesVisited: ctx.directoriesVisited,
          filesIncluded: ctx.filesIncluded,
          timeouts: ctx.timeouts,
          skippedDirectories: ctx.skippedDirectories,
          skippedErrors: ctx.skippedErrors,
          remainingFiles: ctx.remainingFiles,
          errorSamples: ctx.errorSamples
        },
        enumerable: false
      });
    }
    return filtered;
  } catch (error) {
    const isTimeout = String(error?.message || '').includes('timed out');
    if (isTimeout) {
      ctx.partial = true;
      ctx.partialReasons.add('timeouts');
      ctx.skippedDirectories += 1;
      ctx.timeouts += 1;
      logger.warn('Directory scan timed out; skipping directory', {
        dirPath,
        error: error.message
      });
      return [];
    }

    logger.error('Error scanning directory', {
      dirPath,
      error: error.message,
      code: error.code
    });
    // Optionally, rethrow or return a specific error structure
    if (isPermissionError(error)) {
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
