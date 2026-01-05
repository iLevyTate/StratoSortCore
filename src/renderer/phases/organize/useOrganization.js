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

  // Ref for cleanup
  const progressUnsubscribeRef = useRef(null);

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

              setBatchProgress({
                current,
                total,
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
    };
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
    setOrganizeConflicts
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
const normalizeForComparison = (path) => (path || '').replace(/[\\/]+/g, '/').toLowerCase();

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
  unprocessedFiles,
  editingFiles,
  getFileWithEdits,
  findSmartFolderForCategory,
  defaultLocation,
  analysisResults,
  markFilesAsProcessed,
  unmarkFilesAsProcessed,
  actions,
  phaseData,
  addNotification,
  executeAction,
  setOrganizedFiles,
  setOrganizingState
}) {
  const {
    batchProgress,
    setBatchProgress,
    organizePreview,
    setOrganizePreview,
    isOrganizing,
    setIsOrganizing,
    // FIX M-4: Get conflict tracking from progress hook
    organizeConflicts,
    setOrganizeConflicts
  } = useProgressTracking();

  // FIX: Use ref to track latest organizedFiles to avoid stale closure in async callbacks
  const organizedFilesRef = useRef(phaseData?.organizedFiles || []);
  organizedFilesRef.current = phaseData?.organizedFiles || [];

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
              const resArray = Array.isArray(result?.results) ? result.results : [];
              const uiResults = resArray
                .filter((r) => r.success)
                .map((r) => {
                  const original = analysisResults.find((a) => a.path === r.source) || {};
                  return {
                    originalPath: r.source,
                    path: r.destination,
                    originalName:
                      original.name || (original.path ? original.path.split(/[\\/]/).pop() : ''),
                    newName: r.destination ? r.destination.split(/[\\/]/).pop() : '',
                    smartFolder: 'Organized',
                    organizedAt: new Date().toISOString()
                  };
                });
              if (uiResults.length > 0) {
                // FIX H-3: Use functional update and sync ref immediately
                setOrganizedFiles((prev) => {
                  const updated = [...prev, ...uiResults];
                  // Sync ref immediately for undo/redo consistency
                  organizedFilesRef.current = updated;
                  return updated;
                });
                markFilesAsProcessed(uiResults.map((r) => r.originalPath));
                // Update phaseData for persistence
                actions.setPhaseData('organizedFiles', organizedFilesRef.current);
                addNotification(`Organized ${uiResults.length} files`, 'success');
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

              // FIX H-3: Use functional update and sync ref immediately to prevent stale data in onRedo
              setOrganizedFiles((prev) => {
                const filtered = prev.filter(
                  (of) => !undoPathsSet.has(normalizeForComparison(of.originalPath))
                );
                // Sync ref immediately so onRedo sees correct data
                organizedFilesRef.current = filtered;
                logger.info('[ORGANIZE] onUndo: ref synced', {
                  prevCount: prev.length,
                  filteredCount: filtered.length,
                  refCount: organizedFilesRef.current.length
                });
                return filtered;
              });
              unmarkFilesAsProcessed(successfulUndos);

              // Also update phaseData for persistence
              actions.setPhaseData('organizedFiles', organizedFilesRef.current);

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
                  ? successfulResults.map((r) => ({
                      originalPath: r.source,
                      path: r.destination,
                      originalName: r.source?.split(/[\\/]/).pop() || '',
                      newName: r.destination?.split(/[\\/]/).pop() || '',
                      smartFolder: 'Organized',
                      organizedAt: new Date().toISOString()
                    }))
                  : operations.map((op) => ({
                      originalPath: op.source,
                      path: op.destination,
                      originalName: op.source.split(/[\\/]/).pop(),
                      newName: op.destination.split(/[\\/]/).pop(),
                      smartFolder: 'Organized',
                      organizedAt: new Date().toISOString()
                    }));

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

                  // FIX H-3: Use functional update and sync ref immediately
                  setOrganizedFiles((prev) => {
                    const updated = [...prev, ...uniqueResults];
                    // Sync ref immediately for consistency
                    organizedFilesRef.current = updated;
                    return updated;
                  });
                  markFilesAsProcessed(pathsToMark);
                  // Update phaseData for persistence
                  actions.setPhaseData('organizedFiles', organizedFilesRef.current);
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
          actions.advancePhase(PHASES.COMPLETE);
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
      setOrganizedFiles,
      setOrganizingState,
      setBatchProgress,
      setIsOrganizing,
      setOrganizePreview,
      setOrganizeConflicts
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
