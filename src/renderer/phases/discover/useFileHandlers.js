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
import { logger } from '../../../shared/logger';
import { extractExtension, extractFileName } from './namingUtils';

logger.setContext('DiscoverPhase:FileHandlers');

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
  '.kmz',
];

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
  analyzeFiles,
}) {
  const [isScanning, setIsScanning] = useState(false);

  /**
   * Get batch file stats for multiple files
   */
  const getBatchFileStats = useCallback(
    async (filePaths, batchSize = RENDERER_LIMITS.FILE_STATS_BATCH_SIZE) => {
      const results = [];

      for (let i = 0; i < filePaths.length; i += batchSize) {
        const batch = filePaths.slice(i, i + batchSize);
        const batchResults = await Promise.allSettled(
          batch.map(async (filePath) => {
            try {
              if (i > 0) await new Promise((resolve) => setTimeout(resolve, 5));
              const stats = await window.electronAPI.files.getStats(filePath);
              const fileName = extractFileName(filePath);
              const extension = extractExtension(fileName);

              return {
                name: fileName,
                path: filePath,
                extension,
                size: stats?.size || 0,
                type: 'file',
                created: stats?.created,
                modified: stats?.modified,
                success: true,
              };
            } catch (error) {
              const fileName = extractFileName(filePath);
              return {
                name: fileName,
                path: filePath,
                extension: extractExtension(fileName),
                size: 0,
                type: 'file',
                success: false,
                error: error.message,
              };
            }
          }),
        );

        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            const filePath = batch[index];
            const fileName = extractFileName(filePath);
            results.push({
              name: fileName,
              path: filePath,
              extension: extractExtension(fileName),
              size: 0,
              type: 'file',
              success: false,
              error: result.reason?.message || 'Unknown error',
            });
          }
        });

        if (i + batchSize < filePaths.length) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      return results;
    },
    [],
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
          'duplicate-files',
        );
      } else if (newFiles.length === 0) {
        addNotification(
          'All files are already in the queue',
          'info',
          2000,
          'duplicate-files',
        );
      }

      return newFiles;
    },
    [addNotification],
  );

  /**
   * Handle file selection from dialog
   */
  const handleFileSelection = useCallback(async () => {
    try {
      setIsScanning(true);
      const result = await window.electronAPI.files.select();

      if (result?.success && result?.files?.length > 0) {
        const newFiles = filterNewFiles(result.files, selectedFiles);

        if (newFiles.length === 0) return;

        // Update file states for new files
        // newFiles contains {path, name} objects from API response
        newFiles.forEach((file) => {
          const filePath = typeof file === 'string' ? file : file.path;
          updateFileState(filePath, 'pending');
        });

        // Extract paths for getBatchFileStats which expects string array
        const filePaths = newFiles.map((f) =>
          typeof f === 'string' ? f : f.path,
        );
        const fileObjects = await getBatchFileStats(filePaths);
        const enhancedFiles = fileObjects.map((file) => ({
          ...file,
          source: 'file_selection',
        }));

        // Merge with existing files
        const allFiles = [...selectedFiles, ...enhancedFiles];
        const uniqueFiles = allFiles.filter(
          (file, index, self) =>
            index === self.findIndex((f) => f.path === file.path),
        );

        setSelectedFiles(uniqueFiles);

        const failedFiles = fileObjects.filter((f) => !f.success);
        if (failedFiles.length > 0) {
          addNotification(
            `Warning: ${failedFiles.length} files had issues loading metadata`,
            'warning',
            3000,
            'file-issues',
          );
        }

        addNotification(
          `Added ${enhancedFiles.length} new file${enhancedFiles.length !== 1 ? 's' : ''} for analysis`,
          'success',
          2500,
          'files-added',
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
        'file-selection-error',
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
    analyzeFiles,
  ]);

  /**
   * Handle folder selection
   */
  const handleFolderSelection = useCallback(async () => {
    try {
      setIsScanning(true);
      const result = await window.electronAPI.files.selectDirectory();

      // FIX: Handler returns 'path' not 'folder'
      if (result?.success && result?.path) {
        const SCAN_TIMEOUT = 30000;
        let scanTimeoutId;

        const scanResult = await Promise.race([
          window.electronAPI.smartFolders.scanStructure(result.path),
          new Promise((_, reject) => {
            scanTimeoutId = setTimeout(
              () =>
                reject(
                  new Error(
                    'Folder scan timeout - the folder may be on a slow network drive or contain too many files',
                  ),
                ),
              SCAN_TIMEOUT,
            );
          }),
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
              'folder-scan',
            );
            return;
          }

          const newFiles = filterNewFiles(supportedFiles, selectedFiles);
          if (newFiles.length === 0) return;

          // Update file states
          newFiles.forEach((file) => updateFileState(file.path, 'pending'));

          const fileObjects = await getBatchFileStats(
            newFiles.map((f) => f.path),
          );
          const enhancedFiles = fileObjects.map((file) => ({
            ...file,
            source: 'folder_scan',
          }));

          // Merge files
          const allFiles = [...selectedFiles, ...enhancedFiles];
          const uniqueFiles = allFiles.filter(
            (file, index, self) =>
              index === self.findIndex((f) => f.path === file.path),
          );

          setSelectedFiles(uniqueFiles);

          addNotification(
            `Added ${enhancedFiles.length} new file${enhancedFiles.length !== 1 ? 's' : ''} from folder for analysis`,
            'success',
            2500,
            'files-added',
          );

          if (analyzeFiles) {
            await analyzeFiles(enhancedFiles);
          }
        } else {
          addNotification(
            'No files found in the selected folder',
            'warning',
            3000,
            'folder-scan',
          );
        }
      } else if (result?.success === false && result?.path === null) {
        addNotification(
          'Folder selection cancelled',
          'info',
          2000,
          'folder-selection',
        );
      } else {
        addNotification('No folder selected', 'info', 2000, 'folder-selection');
      }
    } catch (error) {
      addNotification(
        `Error selecting folder: ${error.message}`,
        'error',
        4000,
        'folder-selection-error',
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
    analyzeFiles,
  ]);

  /**
   * Handle file drop
   */
  const handleFileDrop = useCallback(
    async (files) => {
      if (!files || files.length === 0) return;

      const newFiles = filterNewFiles(files, selectedFiles);
      if (newFiles.length === 0) return;

      // Enforce path presence for dropped items
      const withPath = newFiles.filter((file) => {
        const pathValue = typeof file === 'string' ? file : file.path;
        return typeof pathValue === 'string' && pathValue.trim().length > 0;
      });
      const droppedMissingPath = newFiles.length - withPath.length;
      if (droppedMissingPath > 0) {
        addNotification(
          `Skipped ${droppedMissingPath} item${droppedMissingPath > 1 ? 's' : ''} with no path`,
          'warning',
          2500,
          'drop-missing-path',
        );
      }
      if (withPath.length === 0) return;

      // Ensure extension property is set
      const enhancedFiles = withPath.map((file) => {
        let extension = file.extension;
        if (!extension) {
          const fileName = file.name || extractFileName(file.path || '');
          extension = extractExtension(fileName);
        }
        return {
          ...file,
          extension,
          source: 'drag_drop',
          droppedAt: new Date().toISOString(),
        };
      });

      // Update file states
      enhancedFiles.forEach((file) => updateFileState(file.path, 'pending'));

      // Merge files
      const allFiles = [...selectedFiles, ...enhancedFiles];
      const uniqueFiles = allFiles.filter(
        (file, index, self) =>
          index === self.findIndex((f) => f.path === file.path),
      );

      setSelectedFiles(uniqueFiles);

      addNotification(
        `Added ${enhancedFiles.length} new file${enhancedFiles.length !== 1 ? 's' : ''} for analysis`,
        'success',
        2500,
        'files-added',
      );

      if (analyzeFiles) {
        await analyzeFiles(enhancedFiles);
      }
    },
    [
      selectedFiles,
      setSelectedFiles,
      updateFileState,
      addNotification,
      filterNewFiles,
      analyzeFiles,
    ],
  );

  return {
    isScanning,
    handleFileSelection,
    handleFolderSelection,
    handleFileDrop,
    getBatchFileStats,
  };
}

export default useFileHandlers;
