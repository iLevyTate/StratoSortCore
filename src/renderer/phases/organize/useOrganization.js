/**
 * useOrganization Hook
 *
 * Main organization logic for batch file operations.
 *
 * @module organize/useOrganization
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { PHASES } from '../../../shared/constants';
import { logger } from '../../../shared/logger';
import { createOrganizeBatchAction } from '../../components/UndoRedoSystem';

logger.setContext('OrganizePhase-Organization');

/**
 * Hook for progress tracking
 * @returns {Object} Progress state and setter
 */
export function useProgressTracking() {
  const [batchProgress, setBatchProgress] = useState({
    current: 0,
    total: 0,
    currentFile: ''
  });
  const [organizePreview, setOrganizePreview] = useState([]);
  const [isOrganizing, setIsOrganizing] = useState(false);
  // FIX M-4: Track destination conflicts
  const [organizeConflicts, setOrganizeConflicts] = useState([]);

  // FIX CRIT-2: Track chunked results for large batches (>100 files)
  const [chunkedResults, setChunkedResults] = useState([]);
  const chunkedResultsRef = useRef([]);

  // Ref for cleanup
  const progressUnsubscribeRef = useRef(null);
  // FIX CRIT-2: Ref for chunk listener cleanup
  const chunkUnsubscribeRef = useRef(null);

  // Progress listener setup
  useEffect(() => {
    const abortController = new AbortController();

    const setupProgressListener = () => {
      if (abortController.signal.aborted) return;

      if (!window.electronAPI?.events?.onOperationProgress) {
        logger.warn('Progress event system not available - progress updates will not be shown');
        return;
      }

      try {
        progressUnsubscribeRef.current = window.electronAPI.events.onOperationProgress(
          (payload) => {
            if (abortController.signal.aborted) return;

            try {
              if (!payload || payload.type !== 'batch_organize') return;

              const current = Number(payload.current);
              const total = Number(payload.total);

              if (!Number.isFinite(current) || !Number.isFinite(total)) {
                logger.error('Invalid progress data', {
                  current: payload.current,
                  total: payload.total
                });
                return;
              }

              // FIX HIGH-5: Add bounds check to prevent malformed progress data from causing UI issues
              // Reasonable bounds: current >= 0, total >= 0, current <= total, total < 100000
              const MAX_REASONABLE_TOTAL = 100000;
              if (current < 0 || total < 0 || current > total || total > MAX_REASONABLE_TOTAL) {
                logger.warn('Progress data out of bounds, clamping values', {
                  original: { current, total },
                  maxReasonable: MAX_REASONABLE_TOTAL
                });
              }

              // Clamp values to reasonable bounds
              const safeCurrent = Math.max(0, Math.min(current, total, MAX_REASONABLE_TOTAL));
              const safeTotal = Math.max(0, Math.min(total, MAX_REASONABLE_TOTAL));

              setBatchProgress({
                current: safeCurrent,
                total: safeTotal,
                currentFile: payload.currentFile || ''
              });
            } catch (error) {
              logger.error('Error processing progress update', {
                error: error.message,
                stack: error.stack
              });
            }
          }
        );

        if (typeof progressUnsubscribeRef.current !== 'function') {
          logger.error('Progress subscription failed - unsubscribe is not a function');
          progressUnsubscribeRef.current = null;
        }
      } catch (error) {
        logger.error('Failed to subscribe to progress events', {
          error: error.message,
          stack: error.stack
        });
      }
    };

    setupProgressListener();

    // FIX CRIT-2: Setup chunk listener for large batch results (>100 files)
    const setupChunkListener = () => {
      if (abortController.signal.aborted) return;

      if (!window.electronAPI?.events?.onBatchResultsChunk) {
        logger.debug('Batch results chunk listener not available');
        return;
      }

      try {
        chunkUnsubscribeRef.current = window.electronAPI.events.onBatchResultsChunk((payload) => {
          if (abortController.signal.aborted) return;

          try {
            if (!payload || !payload.chunk) return;

            logger.debug('[ORGANIZE] Received batch results chunk', {
              batchId: payload.batchId,
              chunkIndex: payload.chunkIndex,
              totalChunks: payload.totalChunks,
              chunkSize: payload.chunk?.length
            });

            // Accumulate chunks
            chunkedResultsRef.current = [...chunkedResultsRef.current, ...payload.chunk];
            setChunkedResults([...chunkedResultsRef.current]);

            // Update progress based on chunks received
            if (payload.totalChunks > 0) {
              const progress = Math.round(((payload.chunkIndex + 1) / payload.totalChunks) * 100);
              logger.debug('[ORGANIZE] Chunk progress', {
                progress,
                chunkIndex: payload.chunkIndex
              });
            }
          } catch (error) {
            logger.error('Error processing batch results chunk', {
              error: error.message
            });
          }
        });
      } catch (error) {
        logger.error('Failed to subscribe to batch-results-chunk events', {
          error: error.message
        });
      }
    };

    setupChunkListener();

    return () => {
      abortController.abort();

      if (typeof progressUnsubscribeRef.current === 'function') {
        try {
          progressUnsubscribeRef.current();
          progressUnsubscribeRef.current = null;
        } catch (error) {
          logger.error('Error unsubscribing from progress events', {
            error: error.message,
            stack: error.stack
          });
        }
      }

      // FIX CRIT-2: Cleanup chunk listener
      if (typeof chunkUnsubscribeRef.current === 'function') {
        try {
          chunkUnsubscribeRef.current();
          chunkUnsubscribeRef.current = null;
        } catch (error) {
          logger.error('Error unsubscribing from chunk events', {
            error: error.message
          });
        }
      }
    };
  }, []);

  // FIX CRIT-2: Helper to reset chunked results for new batch
  const resetChunkedResults = useCallback(() => {
    chunkedResultsRef.current = [];
    setChunkedResults([]);
  }, []);

  return {
    batchProgress,
    setBatchProgress,
    organizePreview,
    setOrganizePreview,
    isOrganizing,
    setIsOrganizing,
    // FIX M-4: Expose conflict tracking
    organizeConflicts,
    setOrganizeConflicts,
    // FIX CRIT-2: Expose chunked results handling
    chunkedResults,
    chunkedResultsRef,
    resetChunkedResults
  };
}

/**
 * Process a single file for organization.
 * Shared logic for both operations and preview building.
 *
 * @param {Object} params - Processing parameters
 * @param {Object} params.file - File to process
 * @param {Map} params.fileIndexMap - Map of file paths to their indices
 * @param {Array} params.editingFiles - Array of file edits
 * @param {Function} params.getFileWithEdits - Function to get file with applied edits
 * @param {Function} params.findSmartFolderForCategory - Function to find smart folder
 * @param {string} params.defaultLocation - Default destination location
 * @returns {Object} Processed file info with newName, normalized destination, and categoryChanged flag
 */
// Helper to normalize paths for comparison (handles mixed / and \)
// FIX HIGH-6: Only lowercase on Windows - Linux/macOS filesystems are case-sensitive
const isWindowsPath = (p) => p && (p.includes('\\') || /^[A-Za-z]:/.test(p));
const normalizeForComparison = (path) => {
  if (!path) return '';
  const normalized = path.replace(/[\\/]+/g, '/');
  // Only lowercase on Windows paths (contains backslash or drive letter)
  return isWindowsPath(path) ? normalized.toLowerCase() : normalized;
};

/**
 * Helper to join paths using the correct separator based on the root
 */
const joinPath = (root, ...parts) => {
  const isWindows = root.includes('\\');
  const separator = isWindows ? '\\' : '/';
  const cleanRoot = root.endsWith(separator) ? root.slice(0, -1) : root;
  const cleanParts = parts.map((p) => (p.startsWith(separator) ? p.slice(1) : p));
  return [cleanRoot, ...cleanParts].join(separator);
};

function processFileForOrganization({
  file,
  fileIndexMap,
  editingFiles,
  getFileWithEdits,
  findSmartFolderForCategory,
  defaultLocation
}) {
  const fileIndex = fileIndexMap.get(file.path) ?? -1;
  const edits = fileIndex >= 0 ? editingFiles[fileIndex] || {} : {};
  const fileWithEdits = fileIndex >= 0 ? getFileWithEdits(file, fileIndex) : file;
  let currentCategory = edits.category || fileWithEdits.analysis?.category;
  const originalCategory = currentCategory;
  let categoryChanged = false;

  // Filter out "document" category if it's not a smart folder
  if (currentCategory === 'document' || currentCategory === 'image') {
    const matchingFolder = findSmartFolderForCategory(currentCategory);
    if (!matchingFolder) {
      currentCategory = 'Uncategorized';
      categoryChanged = true;
    }
  }

  const smartFolder = findSmartFolderForCategory(currentCategory);

  // FIX: Use platform-aware path joining instead of hardcoded slashes
  const destinationDir = smartFolder
    ? smartFolder.path || joinPath(defaultLocation, smartFolder.name)
    : joinPath(defaultLocation, currentCategory || 'Uncategorized');

  const suggestedName = edits.suggestedName || fileWithEdits.analysis?.suggestedName || file.name;

  // Ensure extension is present - use lastIndexOf for more robust extension detection
  // Check for extensions up to 5 characters (e.g., .html, .jpeg, .xlsx)
  const originalExtIdx = file.name.lastIndexOf('.');
  const originalExt = originalExtIdx > 0 ? file.name.slice(originalExtIdx) : '';
  const suggestedExtIdx = suggestedName.lastIndexOf('.');
  const hasExtension = suggestedExtIdx > 0 && suggestedExtIdx > suggestedName.length - 6;
  const newName = hasExtension || !originalExt ? suggestedName : suggestedName + originalExt;

  const dest = joinPath(destinationDir, newName);
  const normalized = window.electronAPI?.files?.normalizePath?.(dest) || dest;

  return { newName, normalized, categoryChanged, originalCategory, finalCategory: currentCategory };
}

/**
 * Build a file index map for efficient lookups
 * @param {Array} filesToProcess - Files to process
 * @param {Array} unprocessedFiles - All unprocessed files
 * @returns {Map} Map of file paths to indices
 */
function buildFileIndexMap(filesToProcess, unprocessedFiles) {
  const fileIndexMap = new Map();
  filesToProcess.forEach((file) => {
    const index = unprocessedFiles.findIndex((f) => f.path === file.path);
    if (index >= 0) fileIndexMap.set(file.path, index);
  });
  return fileIndexMap;
}

/**
 * Build file operations for organization
 * @param {Object} params - Parameters
 * @returns {Object} Object with operations array and categoryChanges array
 */
function buildOperations({
  filesToProcess,
  unprocessedFiles,
  editingFiles,
  getFileWithEdits,
  findSmartFolderForCategory,
  defaultLocation
}) {
  const fileIndexMap = buildFileIndexMap(filesToProcess, unprocessedFiles);
  const categoryChanges = [];

  const operations = filesToProcess.map((file) => {
    const { normalized, categoryChanged, originalCategory, finalCategory } =
      processFileForOrganization({
        file,
        fileIndexMap,
        editingFiles,
        getFileWithEdits,
        findSmartFolderForCategory,
        defaultLocation
      });

    if (categoryChanged) {
      categoryChanges.push({
        fileName: file.name,
        originalCategory,
        finalCategory
      });
    }

    return { type: 'move', source: file.path, destination: normalized };
  });

  return { operations, categoryChanges };
}

/**
 * Build preview list for progress UI
 * @param {Object} params - Parameters
 * @returns {Object} Object with preview array and conflicts array
 */
function buildPreview({
  filesToProcess,
  unprocessedFiles,
  editingFiles,
  getFileWithEdits,
  findSmartFolderForCategory,
  defaultLocation
}) {
  const fileIndexMap = buildFileIndexMap(filesToProcess, unprocessedFiles);

  const preview = filesToProcess.map((file) => {
    const { newName, normalized } = processFileForOrganization({
      file,
      fileIndexMap,
      editingFiles,
      getFileWithEdits,
      findSmartFolderForCategory,
      defaultLocation
    });
    return { fileName: newName, destination: normalized, sourcePath: file.path };
  });

  // FIX M-4: Detect destination conflicts (multiple files going to same destination)
  const destinationMap = new Map();
  preview.forEach((item) => {
    const normalizedDest = normalizeForComparison(item.destination);
    if (!destinationMap.has(normalizedDest)) {
      destinationMap.set(normalizedDest, []);
    }
    destinationMap.get(normalizedDest).push(item);
  });

  const conflicts = [];
  for (const items of destinationMap.values()) {
    if (items.length > 1) {
      conflicts.push({
        destination: items[0].destination, // Use original casing
        files: items.map((i) => ({
          fileName: i.fileName,
          sourcePath: i.sourcePath
        }))
      });
    }
  }

  return { preview, conflicts };
}

/**
 * Hook for main organization logic
 * @param {Object} params - Parameters
 * @returns {Object} Organization handlers
 */
export function useOrganization({
  unprocessedFiles = [],
  editingFiles = [],
  getFileWithEdits = () => {},
  findSmartFolderForCategory = () => {},
  defaultLocation = '',
  analysisResults = [],
  markFilesAsProcessed = () => {},
  unmarkFilesAsProcessed = () => {},
  actions = { setPhaseData: () => {}, advancePhase: () => {} },
  phaseData = {},
  addNotification = () => {},
  executeAction = () => {},
  addOrganizedFiles = () => {},
  removeOrganizedFiles = () => {},
  setOrganizingState = () => {}
} = {}) {
  const {
    batchProgress,
    setBatchProgress,
    organizePreview,
    setOrganizePreview,
    isOrganizing,
    setIsOrganizing,
    // FIX M-4: Get conflict tracking from progress hook
    organizeConflicts,
    setOrganizeConflicts,
    // FIX CRIT-2: Get chunked results handling from progress hook
    chunkedResultsRef,
    resetChunkedResults
  } = useProgressTracking();

  // FIX H-3: Use ref to track latest organizedFiles to avoid stale closure in async callbacks
  // Sync ref in useEffect instead of during render to prevent race conditions
  const organizedFilesRef = useRef(phaseData?.organizedFiles || []);
  useEffect(() => {
    organizedFilesRef.current = phaseData?.organizedFiles || [];
  }, [phaseData?.organizedFiles]);

  const handleOrganizeFiles = useCallback(
    async (filesToOrganize = null) => {
      // FIX: Ensure filesToOrganize is actually an array, not a React event
      const actualFilesToOrganize = Array.isArray(filesToOrganize) ? filesToOrganize : null;

      logger.info('[ORGANIZE] handleOrganizeFiles called', {
        providedFiles: actualFilesToOrganize?.length ?? 'null',
        unprocessedFilesCount: unprocessedFiles?.length ?? 0
      });

      try {
        setIsOrganizing(true);
        setOrganizingState(true);
        // FIX M-4: Clear previous conflicts at start of organize attempt
        setOrganizeConflicts([]);
        // FIX CRIT-2: Reset chunked results for new batch operation
        resetChunkedResults();

        const filesToProcess = actualFilesToOrganize || unprocessedFiles.filter((f) => f.analysis);

        logger.info('[ORGANIZE] Files to process', {
          count: filesToProcess.length
        });

        if (filesToProcess.length === 0) {
          addNotification(
            'No files ready to organize. Please ensure files have been analyzed.',
            'warning'
          );
          logger.warn('[ORGANIZE] No files to process - returning early');
          setIsOrganizing(false);
          setOrganizingState(false);
          return;
        }

        setBatchProgress({
          current: 0,
          total: filesToProcess.length,
          currentFile: ''
        });

        // Check if auto-organize with suggestions is available
        const autoOrganizeAvailable = !!window.electronAPI?.organize?.auto;
        logger.info('[ORGANIZE] Auto-organize API available:', autoOrganizeAvailable);

        // IMPORTANT: For the Organize phase, the user has already reviewed/edited
        // the category + name in the UI. Calling auto-organize here can re-run a
        // separate suggestion pipeline and produce a *different* folder than what
        // the UI displays (e.g., UI shows "How To" but auto-organize moves to "3D Print").
        // To prevent that "disconnect", we always build operations locally from:
        // - file.analysis.category/suggestedName
        // - any user edits in editingFiles
        const { operations, categoryChanges } = buildOperations({
          filesToProcess,
          unprocessedFiles,
          editingFiles,
          getFileWithEdits,
          findSmartFolderForCategory,
          defaultLocation
        });

        // FIX: Notify user when categories were changed due to missing smart folders
        if (categoryChanges && categoryChanges.length > 0) {
          const changedCount = categoryChanges.length;
          if (changedCount === 1) {
            addNotification(
              `"${categoryChanges[0].fileName}" category changed from "${categoryChanges[0].originalCategory}" to "${categoryChanges[0].finalCategory}" (no matching smart folder)`,
              'warning',
              5000,
              'category-changed'
            );
          } else {
            addNotification(
              `${changedCount} files had categories changed to "Uncategorized" (no matching smart folders)`,
              'warning',
              5000,
              'category-changed'
            );
          }
          logger.info('[ORGANIZE] Category changes applied:', categoryChanges);
        }

        if (!operations || operations.length === 0) {
          addNotification(
            'No confident file moves were generated. Review files manually before organizing.',
            'info',
            4000,
            'organize-no-operations'
          );
          setIsOrganizing(false);
          setOrganizingState(false);
          setBatchProgress({ current: 0, total: 0, currentFile: '' });
          return;
        }

        // Build preview and detect conflicts
        try {
          const { preview, conflicts } = buildPreview({
            filesToProcess,
            unprocessedFiles,
            editingFiles,
            getFileWithEdits,
            findSmartFolderForCategory,
            defaultLocation
          });
          setOrganizePreview(preview);
          setOrganizeConflicts(conflicts);

          // FIX M-4: Block organization if conflicts exist
          if (conflicts.length > 0) {
            const conflictCount = conflicts.reduce((sum, c) => sum + c.files.length, 0);
            addNotification(
              `Cannot organize: ${conflictCount} files have destination conflicts. Rename files to resolve.`,
              'error',
              6000,
              'organize-conflicts'
            );
            logger.warn('[ORGANIZE] Destination conflicts detected:', conflicts);
            setIsOrganizing(false);
            setOrganizingState(false);
            setBatchProgress({ current: 0, total: 0, currentFile: '' });
            return;
          }
        } catch (previewError) {
          logger.warn('[ORGANIZE] Preview generation failed (non-fatal):', previewError.message);
        }

        const sourcePathsSet = new Set(operations.map((op) => op.source));

        const stateCallbacks = {
          onExecute: (result) => {
            try {
              // FIX CRIT-2: Handle chunked results for large batches (>100 files)
              // When chunkedResults is true, the actual results were sent via IPC events
              // and accumulated in chunkedResultsRef, not in result.results
              let resArray;
              if (result?.chunkedResults && chunkedResultsRef.current.length > 0) {
                logger.info('[ORGANIZE] Using chunked results', {
                  chunkedCount: chunkedResultsRef.current.length,
                  totalChunks: result.totalChunks
                });
                resArray = chunkedResultsRef.current;
              } else {
                resArray = Array.isArray(result?.results) ? result.results : [];
              }

              const uiResults = resArray
                .filter((r) => r.success)
                .map((r) => {
                  const original = analysisResults.find((a) => a.path === r.source) || {};
                  // FIX: Extract actual destination folder name from path instead of hardcoding "Organized"
                  // This ensures notifications show the correct folder (e.g., "Uncategorized" not "3D Print")
                  let actualSmartFolder = 'Organized'; // fallback
                  if (r.destination) {
                    // Get the parent directory name from the destination path
                    const pathParts = r.destination.split(/[\\/]/);
                    // Get the folder name (second-to-last part before filename)
                    if (pathParts.length >= 2) {
                      actualSmartFolder = pathParts[pathParts.length - 2];
                    }
                  }
                  return {
                    originalPath: r.source,
                    path: r.destination,
                    originalName:
                      original.name || (original.path ? original.path.split(/[\\/]/).pop() : ''),
                    newName: r.destination ? r.destination.split(/[\\/]/).pop() : '',
                    smartFolder: actualSmartFolder,
                    organizedAt: new Date().toISOString()
                  };
                });
              if (uiResults.length > 0) {
                // FIX H-3: Use addOrganizedFiles to append to current state safely (avoids stale closures)
                addOrganizedFiles(uiResults);

                // Keep ref in sync for other local logic if needed (though Redux is source of truth)
                organizedFilesRef.current = [...organizedFilesRef.current, ...uiResults];

                markFilesAsProcessed(uiResults.map((r) => r.originalPath));

                // FIX HIGH-4: Surface partialFailure to user instead of silently showing success
                // When some files fail during batch operation, warn user about partial completion
                const failedCount = resArray.filter((r) => !r.success).length;
                if (result?.partialFailure || failedCount > 0) {
                  addNotification(
                    `Organized ${uiResults.length} files with ${failedCount} failures. Check logs for details.`,
                    'warning',
                    6000
                  );
                  logger.warn('[ORGANIZE] Partial failure in batch operation', {
                    successCount: uiResults.length,
                    failCount: failedCount,
                    error: result?.error
                  });
                } else {
                  addNotification(`Organized ${uiResults.length} files`, 'success');
                }

                setBatchProgress({
                  current: filesToProcess.length,
                  total: filesToProcess.length,
                  currentFile: ''
                });
              } else {
                logger.warn('[ORGANIZE] onExecute: No successful results to process');
              }
            } catch (callbackError) {
              logger.error('[ORGANIZE] onExecute callback failed:', callbackError.message);
            }
          },
          onUndo: (result) => {
            try {
              logger.info('[ORGANIZE] onUndo called', {
                hasResult: !!result,
                hasResults: !!result?.results,
                resultsCount: result?.results?.length,
                organizedFilesRefCountBefore: organizedFilesRef.current?.length
              });

              // Use actual results from main process if available
              const successfulUndos = result?.results
                ? result.results.filter((r) => r.success).map((r) => r.originalPath || r.newPath)
                : Array.from(sourcePathsSet);

              logger.info('[ORGANIZE] onUndo: unmarking files', {
                successfulUndos,
                successfulUndosCount: successfulUndos.length
              });

              const undoPathsSet = new Set(successfulUndos.map(normalizeForComparison));

              // FIX H-3: Use removeOrganizedFiles to update current state safely
              removeOrganizedFiles(successfulUndos);

              // Sync ref locally
              const filtered = organizedFilesRef.current.filter(
                (of) => !undoPathsSet.has(normalizeForComparison(of.originalPath))
              );
              organizedFilesRef.current = filtered;

              unmarkFilesAsProcessed(successfulUndos);

              const successCount = result?.successCount ?? successfulUndos.length;
              const failCount = result?.failCount ?? 0;

              if (failCount > 0) {
                addNotification(
                  `Undo partially complete: ${successCount} files restored, ${failCount} failed.`,
                  'warning'
                );
              } else {
                addNotification(
                  `Undo complete. ${successCount} files restored to original locations.`,
                  'info'
                );
              }
            } catch (undoError) {
              logger.error('[ORGANIZE] onUndo callback failed:', undoError.message);
            }
          },
          onRedo: (result) => {
            try {
              logger.info('[ORGANIZE] onRedo called', {
                hasResult: !!result,
                hasResults: !!result?.results,
                resultsCount: result?.results?.length,
                successCount: result?.successCount,
                organizedFilesRefCount: organizedFilesRef.current?.length
              });

              // Use actual results from main process to only update successfully redone files
              const successfulResults = result?.results
                ? result.results.filter((r) => r.success)
                : [];

              // If no results from main process, fall back to original operations
              const uiResults =
                successfulResults.length > 0
                  ? successfulResults.map((r) => {
                      // FIX: Extract actual destination folder name
                      let actualSmartFolder = 'Organized';
                      if (r.destination) {
                        const pathParts = r.destination.split(/[\\/]/);
                        if (pathParts.length >= 2) {
                          actualSmartFolder = pathParts[pathParts.length - 2];
                        }
                      }
                      return {
                        originalPath: r.source,
                        path: r.destination,
                        originalName: r.source?.split(/[\\/]/).pop() || '',
                        newName: r.destination?.split(/[\\/]/).pop() || '',
                        smartFolder: actualSmartFolder,
                        organizedAt: new Date().toISOString()
                      };
                    })
                  : operations.map((op) => {
                      // FIX: Extract actual destination folder name
                      let actualSmartFolder = 'Organized';
                      if (op.destination) {
                        const pathParts = op.destination.split(/[\\/]/);
                        if (pathParts.length >= 2) {
                          actualSmartFolder = pathParts[pathParts.length - 2];
                        }
                      }
                      return {
                        originalPath: op.source,
                        path: op.destination,
                        originalName: op.source.split(/[\\/]/).pop(),
                        newName: op.destination.split(/[\\/]/).pop(),
                        smartFolder: actualSmartFolder,
                        organizedAt: new Date().toISOString()
                      };
                    });

              if (uiResults.length > 0) {
                // FIX H-3: Filter out duplicates, but use latest ref data (synced in onUndo)
                const existingPaths = new Set(
                  organizedFilesRef.current.map((f) => normalizeForComparison(f.originalPath))
                );
                const uniqueResults = uiResults.filter(
                  (r) => !existingPaths.has(normalizeForComparison(r.originalPath))
                );

                logger.debug('[ORGANIZE] onRedo: processing results', {
                  uiResultsCount: uiResults.length,
                  uniqueResultsCount: uniqueResults.length,
                  existingPathsCount: existingPaths.size
                });

                if (uniqueResults.length > 0) {
                  const pathsToMark = uniqueResults.map((r) => r.originalPath);
                  logger.info('[ORGANIZE] onRedo: marking files as processed', {
                    pathsToMark,
                    uniqueResultsCount: uniqueResults.length
                  });

                  // FIX H-3: Use addOrganizedFiles to update current state safely
                  addOrganizedFiles(uniqueResults);

                  // Sync ref locally
                  organizedFilesRef.current = [...organizedFilesRef.current, ...uniqueResults];

                  markFilesAsProcessed(pathsToMark);
                } else {
                  logger.warn('[ORGANIZE] onRedo: No unique results to process', {
                    existingPathsCount: existingPaths.size,
                    existingPaths: Array.from(existingPaths).slice(0, 5),
                    uiResultPaths: uiResults
                      .map((r) => normalizeForComparison(r.originalPath))
                      .slice(0, 5)
                  });
                }
              }

              const successCount = result?.successCount ?? uiResults.length;
              const failCount = result?.failCount ?? 0;

              if (failCount > 0) {
                addNotification(
                  `Redo partially complete: ${successCount} files re-organized, ${failCount} failed.`,
                  'warning'
                );
              } else {
                addNotification(`Redo complete. ${successCount} files re-organized.`, 'info');
              }
            } catch (redoError) {
              logger.error('[ORGANIZE] onRedo callback failed:', redoError.message);
            }
          }
        };

        logger.info('[ORGANIZE] Executing batch action with', {
          operationsCount: operations.length
        });

        const result = await executeAction(
          createOrganizeBatchAction(
            `Organize ${operations.length} files`,
            operations,
            stateCallbacks
          )
        );

        logger.info('[ORGANIZE] Batch action result:', {
          success: result?.success,
          resultsCount: result?.results?.length ?? 0
        });

        const successCount = Array.isArray(result?.results)
          ? result.results.filter((r) => r.success).length
          : 0;

        logger.info('[ORGANIZE] Final result:', {
          successCount,
          totalResults: result?.results?.length ?? 0,
          willAdvancePhase: successCount > 0
        });

        if (successCount > 0) {
          // FIX: Add null check for PHASES to prevent crash if undefined
          actions.advancePhase(PHASES?.COMPLETE ?? 'complete');
        } else {
          logger.warn('[ORGANIZE] No successful operations - phase will not advance');
          addNotification(
            'No files were organized successfully. Check the logs for details.',
            'warning'
          );
        }
      } catch (error) {
        logger.error('[ORGANIZE] Organization error:', {
          message: error.message,
          stack: error.stack
        });
        addNotification(`Organization failed: ${error.message}`, 'error');
      } finally {
        setIsOrganizing(false);
        setOrganizingState(false);
        setBatchProgress({ current: 0, total: 0, currentFile: '' });
      }
    },
    [
      unprocessedFiles,
      editingFiles,
      getFileWithEdits,
      findSmartFolderForCategory,
      defaultLocation,
      analysisResults,
      markFilesAsProcessed,
      unmarkFilesAsProcessed,
      actions,
      // FIX: Removed phaseData from deps - using organizedFilesRef instead to avoid stale closure
      addNotification,
      executeAction,
      addOrganizedFiles,
      removeOrganizedFiles,
      setOrganizingState,
      setBatchProgress,
      setIsOrganizing,
      setOrganizePreview,
      setOrganizeConflicts,
      // FIX CRIT-2: Add chunked results reset to deps
      resetChunkedResults,
      chunkedResultsRef
    ]
  );

  return {
    isOrganizing,
    batchProgress,
    organizePreview,
    handleOrganizeFiles,
    setBatchProgress,
    // FIX M-4: Expose conflicts for UI warning
    organizeConflicts
  };
}

export default useOrganization;
