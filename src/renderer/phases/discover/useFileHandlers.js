/**
 * File Handlers Hook
 *
 * Custom hook for file selection and handling logic.
 * Extracted from DiscoverPhase for better maintainability.
 *
 * @module phases/discover/useFileHandlers
 */

import { useCallback, useState } from 'react';
import { RENDERER_LIMITS } from '../../../shared/constants';
import { TIMEOUTS } from '../../../shared/performanceConstants';
import { logger } from '../../../shared/logger';
import { extractExtension, extractFileName } from './namingUtils';
import { normalizeText } from '../../../shared/normalization';

logger.setContext('DiscoverPhase:FileHandlers');

const ensureFileApi = (addNotification, actionLabel) => {
  if (!window?.electronAPI?.files) {
    logger.warn('[DiscoverPhase] File API unavailable', { actionLabel });
    addNotification?.(
      'File system API not ready. Please wait for the app to finish loading.',
      'warning',
      3000,
      'file-api-unavailable'
    );
    return false;
  }
  return true;
};

const ensureSmartFolderApi = (addNotification, actionLabel) => {
  if (!window?.electronAPI?.smartFolders) {
    logger.warn('[DiscoverPhase] Smart folder API unavailable', { actionLabel });
    addNotification?.(
      'Smart folder API not ready. Please wait for the app to finish loading.',
      'warning',
      3000,
      'smart-folder-api-unavailable'
    );
    return false;
  }
  return true;
};

/**
 * Supported file extensions for analysis
 */
const SUPPORTED_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.csv',
  '.json',
  '.xml',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.txt',
  '.md',
  '.rtf',
  '.odt',
  '.ods',
  '.odp',
  '.epub',
  '.eml',
  '.msg',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
  '.tiff',
  '.svg',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.kml',
  '.kmz'
];

const SCAN_TIMEOUT = TIMEOUTS.DIRECTORY_SCAN || 30000;

const normalizePathValue = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = normalizeText(value, { maxLength: 2048 }).replace(/^['"](.*)['"]$/, '$1');

  if (trimmed.toLowerCase().startsWith('file://')) {
    try {
      const url = new URL(trimmed);
      // On Windows, URL pathname starts with /C:/... — strip leading slash
      const pathname = decodeURIComponent(url.pathname);
      if (/^\/[a-zA-Z]:[\\/]/.test(pathname)) {
        return pathname.slice(1);
      }
      return pathname;
    } catch {
      // fall back to trimmed
    }
  }

  return trimmed;
};

const isAbsolutePath = (value) => {
  const normalized = normalizePathValue(value);
  if (!normalized) return false;
  return (
    /^[a-zA-Z]:[\\/]/.test(normalized) ||
    normalized.startsWith('\\\\') ||
    normalized.startsWith('/')
  );
};

/**
 * Custom hook for file handling operations
 * @param {Object} options - Hook options
 * @param {Array} options.selectedFiles - Currently selected files
 * @param {Function} options.setSelectedFiles - Set selected files
 * @param {Function} options.updateFileState - Update file state
 * @param {Function} options.addNotification - Add notification
 * @param {Function} options.analyzeFiles - Analyze files function
 * @returns {Object} File handler functions and state
 */
export function useFileHandlers({
  selectedFiles,
  setSelectedFiles,
  updateFileState,
  addNotification,
  analyzeFiles
}) {
  const [isScanning, setIsScanning] = useState(false);

  /**
   * Get batch file stats for multiple files
   */
  const getBatchFileStats = useCallback(
    async (filePaths, batchSize = RENDERER_LIMITS.FILE_STATS_BATCH_SIZE) => {
      if (!ensureFileApi(addNotification, 'getBatchFileStats')) {
        return [];
      }
      const results = [];
      const totalFiles = Array.isArray(filePaths) ? filePaths.length : 0;
      const isLargeBatch = totalFiles > 500;
      const effectiveBatchSize = isLargeBatch
        ? Math.min(batchSize, 10)
        : Math.min(batchSize, RENDERER_LIMITS.FILE_STATS_BATCH_SIZE);
      const maxConcurrency = isLargeBatch ? 2 : Math.max(1, Math.min(5, effectiveBatchSize));

      const getStatsWithRetry = async (filePath) => {
        try {
          const stats = await window.electronAPI.files.getStats(filePath);
          return stats;
        } catch (error) {
          if (String(error?.message || '').includes('Rate limit exceeded')) {
            await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.DELAY_SHORT));
            return window.electronAPI.files.getStats(filePath);
          }
          throw error;
        }
      };

      const mapWithConcurrency = async (items, limit, worker) => {
        const pending = new Set();
        const output = new Array(items.length);
        let index = 0;

        const runNext = async () => {
          if (index >= items.length) return;
          const currentIndex = index++;
          const promise = (async () => {
            output[currentIndex] = await worker(items[currentIndex], currentIndex);
          })()
            .catch((error) => {
              output[currentIndex] = { error };
            })
            .finally(() => {
              pending.delete(promise);
            });
          pending.add(promise);
        };

        while (index < items.length || pending.size > 0) {
          while (pending.size < limit && index < items.length) {
            // Spread out IPC calls slightly to avoid rate limiter bursts.
            if (pending.size > 0) {
              await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.DELAY_TINY));
            }
            await runNext();
          }
          if (pending.size > 0) {
            await Promise.race(pending);
          }
        }

        return output;
      };

      for (let i = 0; i < filePaths.length; i += effectiveBatchSize) {
        const batch = filePaths.slice(i, i + effectiveBatchSize);
        const batchResults = await mapWithConcurrency(batch, maxConcurrency, async (filePath) => {
          try {
            const stats = await getStatsWithRetry(filePath);
            const fileName = extractFileName(filePath);
            const extension = extractExtension(fileName);

            return {
              name: fileName,
              path: filePath,
              extension,
              size: stats?.size || 0,
              isDirectory: stats?.isDirectory || false,
              type: 'file',
              created: stats?.created,
              modified: stats?.modified,
              success: true
            };
          } catch (error) {
            const fileName = extractFileName(filePath);
            return {
              name: fileName,
              path: filePath,
              extension: extractExtension(fileName),
              size: 0,
              isDirectory: false,
              type: 'file',
              success: false,
              error: error.message
            };
          }
        });

        batchResults.forEach((result, index) => {
          if (result?.error) {
            const filePath = batch[index];
            const fileName = extractFileName(filePath);
            // FIX: Handle both string errors (from worker catch) and Error objects (from mapWithConcurrency catch)
            const errorMessage =
              typeof result.error === 'string'
                ? result.error
                : result.error?.message || 'Unknown error';
            results.push({
              name: fileName,
              path: filePath,
              extension: extractExtension(fileName),
              size: 0,
              isDirectory: false,
              type: 'file',
              success: false,
              error: errorMessage
            });
            return;
          }

          results.push(result);
        });

        if (i + effectiveBatchSize < filePaths.length) {
          const batchDelay = isLargeBatch ? TIMEOUTS.DELAY_SHORT : TIMEOUTS.DELAY_BATCH;
          await new Promise((resolve) => setTimeout(resolve, batchDelay));
        }
      }

      return results;
    },
    [addNotification]
  );

  /**
   * Filter and deduplicate new files
   */
  const filterNewFiles = useCallback(
    (files, existingFiles) => {
      const existingPaths = new Set(existingFiles.map((f) => f.path));
      const newFiles = files.filter((file) => {
        const path = typeof file === 'string' ? file : file.path;
        return !existingPaths.has(path);
      });

      const duplicateCount = files.length - newFiles.length;

      if (duplicateCount > 0 && newFiles.length > 0) {
        addNotification(
          `Skipped ${duplicateCount} duplicate files already in queue`,
          'info',
          2000,
          'duplicate-files'
        );
      } else if (newFiles.length === 0) {
        addNotification('All files are already in the queue', 'info', 2000, 'duplicate-files');
      }

      return newFiles;
    },
    [addNotification]
  );

  const expandDroppedDirectories = useCallback(
    async (directories) => {
      if (!directories.length) return [];
      if (!ensureSmartFolderApi(addNotification, 'expandDroppedDirectories')) {
        return [];
      }

      const expanded = [];
      for (const dir of directories) {
        try {
          let scanTimeoutId;
          const scanResult = await Promise.race([
            window.electronAPI.smartFolders.scanStructure(dir.path),
            new Promise((_, reject) => {
              scanTimeoutId = setTimeout(
                () =>
                  reject(
                    new Error(
                      'Folder scan timeout - the folder may be on a slow network drive or contain too many files'
                    )
                  ),
                SCAN_TIMEOUT
              );
            })
          ]).finally(() => {
            if (scanTimeoutId) clearTimeout(scanTimeoutId);
          });

          if (scanResult?.files?.length > 0) {
            const supportedFiles = scanResult.files.filter((file) => {
              const ext = extractExtension(file.name);
              return SUPPORTED_EXTENSIONS.includes(ext);
            });

            if (supportedFiles.length === 0) {
              addNotification(
                `No supported files found in dropped folder: ${dir.name || dir.path}`,
                'warning',
                3000,
                'drop-folder-empty'
              );
              continue;
            }

            expanded.push(
              ...supportedFiles.map((file) => ({
                ...file,
                source: 'folder_scan',
                droppedFrom: dir.path
              }))
            );
          } else {
            addNotification(
              `No files found in dropped folder: ${dir.name || dir.path}`,
              'warning',
              3000,
              'drop-folder-empty'
            );
          }
        } catch (error) {
          addNotification(
            `Error scanning dropped folder: ${dir.name || dir.path}`,
            'error',
            4000,
            'drop-folder-error'
          );
        }
      }

      return expanded;
    },
    [addNotification]
  );

  /**
   * Handle file selection from dialog
   */
  const handleFileSelection = useCallback(async () => {
    try {
      setIsScanning(true);
      if (!ensureFileApi(addNotification, 'handleFileSelection')) {
        return;
      }
      const result = await window.electronAPI.files.select();

      if (result?.success && result?.files?.length > 0) {
        const absoluteFiles = (result.files || []).map((f) => {
          const rawPath = typeof f === 'string' ? f : f?.path;
          const normalizedPath = normalizePathValue(rawPath);
          return typeof f === 'string' ? normalizedPath : { ...f, path: normalizedPath };
        });
        const usableFiles = absoluteFiles.filter((f) =>
          isAbsolutePath(typeof f === 'string' ? f : f?.path)
        );
        const droppedNonAbsolute = (result.files || []).length - absoluteFiles.length;
        const unusableCount = absoluteFiles.length - usableFiles.length;

        if (droppedNonAbsolute > 0 || unusableCount > 0) {
          const skipped = droppedNonAbsolute + unusableCount;
          addNotification(
            `Skipped ${skipped} item${skipped > 1 ? 's' : ''} without a usable absolute path`,
            'warning',
            2500,
            'file-selection-path'
          );
        }

        const newFiles = filterNewFiles(usableFiles, selectedFiles);

        if (newFiles.length === 0) return;

        // Update file states for new files
        // newFiles contains {path, name} objects from API response
        newFiles.forEach((file) => {
          const filePath = typeof file === 'string' ? file : file.path;
          updateFileState(filePath, 'pending');
        });

        // Extract paths for getBatchFileStats which expects string array
        const filePaths = newFiles.map((f) => (typeof f === 'string' ? f : f.path));
        const fileObjects = await getBatchFileStats(filePaths);
        const enhancedFiles = fileObjects.map((file) => ({
          ...file,
          source: 'file_selection'
        }));

        // Merge with existing files
        const allFiles = [...selectedFiles, ...enhancedFiles];
        const uniqueFiles = allFiles.filter(
          (file, index, self) => index === self.findIndex((f) => f.path === file.path)
        );

        setSelectedFiles(uniqueFiles);

        const failedFiles = fileObjects.filter((f) => !f.success);
        if (failedFiles.length > 0) {
          addNotification(
            `Warning: ${failedFiles.length} files had issues loading metadata`,
            'warning',
            3000,
            'file-issues'
          );
        }

        addNotification(
          `Added ${enhancedFiles.length} new file${enhancedFiles.length !== 1 ? 's' : ''} for analysis`,
          'success',
          2500,
          'files-added'
        );

        // Analyze the new files
        if (analyzeFiles) {
          await analyzeFiles(enhancedFiles);
        }
      } else {
        addNotification('No files selected', 'info', 2000, 'file-selection');
      }
    } catch (error) {
      addNotification(
        `Error selecting files: ${error.message}`,
        'error',
        4000,
        'file-selection-error'
      );
    } finally {
      setIsScanning(false);
    }
  }, [
    selectedFiles,
    setSelectedFiles,
    updateFileState,
    addNotification,
    getBatchFileStats,
    filterNewFiles,
    analyzeFiles
  ]);

  /**
   * Handle folder selection
   */
  const handleFolderSelection = useCallback(async () => {
    try {
      setIsScanning(true);
      if (!ensureFileApi(addNotification, 'handleFolderSelection')) {
        return;
      }
      const result = await window.electronAPI.files.selectDirectory();

      // FIX: Handler returns 'path' not 'folder'
      if (result?.success && result?.path) {
        let scanTimeoutId;

        const scanResult = await Promise.race([
          ensureSmartFolderApi(addNotification, 'scanStructure')
            ? window.electronAPI.smartFolders.scanStructure(result.path)
            : Promise.resolve({ files: [] }),
          new Promise((_, reject) => {
            scanTimeoutId = setTimeout(
              () =>
                reject(
                  new Error(
                    'Folder scan timeout - the folder may be on a slow network drive or contain too many files'
                  )
                ),
              SCAN_TIMEOUT
            );
          })
        ]).finally(() => {
          if (scanTimeoutId) clearTimeout(scanTimeoutId);
        });

        if (scanResult?.files?.length > 0) {
          const supportedFiles = scanResult.files.filter((file) => {
            const ext = extractExtension(file.name);
            return SUPPORTED_EXTENSIONS.includes(ext);
          });

          if (supportedFiles.length === 0) {
            addNotification(
              'No supported files found in the selected folder',
              'warning',
              3000,
              'folder-scan'
            );
            return;
          }

          const newFiles = filterNewFiles(supportedFiles, selectedFiles);
          if (newFiles.length === 0) return;

          // Update file states
          newFiles.forEach((file) => updateFileState(file.path, 'pending'));

          const fileObjects = await getBatchFileStats(newFiles.map((f) => f.path));
          const enhancedFiles = fileObjects.map((file) => ({
            ...file,
            source: 'folder_scan'
          }));

          // Merge files
          const allFiles = [...selectedFiles, ...enhancedFiles];
          const uniqueFiles = allFiles.filter(
            (file, index, self) => index === self.findIndex((f) => f.path === file.path)
          );

          setSelectedFiles(uniqueFiles);

          addNotification(
            `Added ${enhancedFiles.length} new file${enhancedFiles.length !== 1 ? 's' : ''} from folder for analysis`,
            'success',
            2500,
            'files-added'
          );

          if (analyzeFiles) {
            await analyzeFiles(enhancedFiles);
          }
        } else {
          addNotification('No files found in the selected folder', 'warning', 3000, 'folder-scan');
        }
      } else if (result?.success === false && result?.path === null) {
        addNotification('Folder selection cancelled', 'info', 2000, 'folder-selection');
      } else {
        addNotification('No folder selected', 'info', 2000, 'folder-selection');
      }
    } catch (error) {
      addNotification(
        `Error selecting folder: ${error.message}`,
        'error',
        4000,
        'folder-selection-error'
      );
    } finally {
      setIsScanning(false);
    }
  }, [
    selectedFiles,
    setSelectedFiles,
    updateFileState,
    addNotification,
    getBatchFileStats,
    filterNewFiles,
    analyzeFiles
  ]);

  /**
   * Handle file drop
   * FIX H-2: Added try/catch for consistent error handling with other handlers
   */
  const handleFileDrop = useCallback(
    async (files) => {
      if (!files || files.length === 0) return;

      try {
        // Normalize paths and require absolute paths for dropped items
        const normalizedFiles = files.map((file) => {
          if (typeof file === 'string') return normalizePathValue(file);
          const normalizedPath = normalizePathValue(file.path || '');
          return { ...file, path: normalizedPath };
        });

        const usableFiles = normalizedFiles.filter((file) => {
          const pathValue = typeof file === 'string' ? file : file.path;
          return isAbsolutePath(pathValue);
        });

        const skippedCount = files.length - usableFiles.length;
        if (skippedCount > 0) {
          addNotification(
            `Skipped ${skippedCount} item${skippedCount > 1 ? 's' : ''} without a usable absolute path`,
            'warning',
            2500,
            'drop-missing-path'
          );
        }

        const newFiles = filterNewFiles(normalizedFiles, selectedFiles);
        if (newFiles.length === 0) return;

        const withPath = newFiles; // Already filtered for absolute paths

        // Fetch file stats for dropped items (aligns behavior with file picker)
        const paths = withPath.map((file) => (typeof file === 'string' ? file : file.path));
        const statsResults = await getBatchFileStats(paths);

        // Split directories and files
        const droppedDirectories = [];
        const droppedFiles = [];

        withPath.forEach((file, idx) => {
          const pathValue = typeof file === 'string' ? file : file.path;
          const stat = statsResults[idx] || {};
          const fileName = file.name || extractFileName(pathValue || '');

          if (stat?.isDirectory) {
            droppedDirectories.push({ path: pathValue, name: fileName });
            return;
          }

          let { extension } = file;
          if (!extension) {
            extension = extractExtension(fileName);
          }

          droppedFiles.push({
            ...file,
            path: pathValue,
            name: fileName,
            extension,
            size: stat?.size ?? file.size ?? 0,
            created: stat?.created,
            modified: stat?.modified,
            type: 'file',
            source: 'drag_drop',
            droppedAt: new Date().toISOString()
          });
        });

        const expandedFromFolders = await expandDroppedDirectories(droppedDirectories);
        const enhancedFiles = [...droppedFiles, ...expandedFromFolders];
        if (enhancedFiles.length === 0) {
          addNotification('No supported files found in drop', 'warning', 2000, 'drop-empty');
          return;
        }

        // Update file states
        enhancedFiles.forEach((file) => updateFileState(file.path, 'pending'));

        // Merge files
        const allFiles = [...selectedFiles, ...enhancedFiles];
        const uniqueFiles = allFiles.filter(
          (file, index, self) => index === self.findIndex((f) => f.path === file.path)
        );

        setSelectedFiles(uniqueFiles);

        addNotification(
          `Added ${enhancedFiles.length} new file${enhancedFiles.length !== 1 ? 's' : ''} for analysis`,
          'success',
          2500,
          'files-added'
        );

        if (analyzeFiles) {
          await analyzeFiles(enhancedFiles);
        }
      } catch (error) {
        // FIX H-2: Consistent error handling with handleFileSelection and handleFolderSelection
        logger.error('[DiscoverPhase] Error handling file drop', {
          error: error.message,
          stack: error.stack
        });
        addNotification(
          `Error processing dropped files: ${error.message}`,
          'error',
          4000,
          'drop-error'
        );
      }
    },
    [
      selectedFiles,
      setSelectedFiles,
      updateFileState,
      addNotification,
      filterNewFiles,
      analyzeFiles,
      expandDroppedDirectories,
      getBatchFileStats
    ]
  );

  return {
    isScanning,
    handleFileSelection,
    handleFolderSelection,
    handleFileDrop,
    getBatchFileStats
  };
}

export default useFileHandlers;
