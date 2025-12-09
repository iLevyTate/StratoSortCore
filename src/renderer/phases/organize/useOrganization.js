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
    currentFile: '',
  });
  const [organizePreview, setOrganizePreview] = useState([]);
  const [isOrganizing, setIsOrganizing] = useState(false);

  // Ref for cleanup
  const progressUnsubscribeRef = useRef(null);

  // Progress listener setup
  useEffect(() => {
    const abortController = new AbortController();

    const setupProgressListener = () => {
      if (abortController.signal.aborted) return;

      if (!window.electronAPI?.events?.onOperationProgress) {
        logger.warn(
          'Progress event system not available - progress updates will not be shown',
        );
        return;
      }

      try {
        progressUnsubscribeRef.current =
          window.electronAPI.events.onOperationProgress((payload) => {
            if (abortController.signal.aborted) return;

            try {
              if (!payload || payload.type !== 'batch_organize') return;

              const current = Number(payload.current);
              const total = Number(payload.total);

              if (!Number.isFinite(current) || !Number.isFinite(total)) {
                logger.error('Invalid progress data', {
                  current: payload.current,
                  total: payload.total,
                });
                return;
              }

              setBatchProgress({
                current,
                total,
                currentFile: payload.currentFile || '',
              });
            } catch (error) {
              logger.error('Error processing progress update', {
                error: error.message,
                stack: error.stack,
              });
            }
          });

        if (typeof progressUnsubscribeRef.current !== 'function') {
          logger.error(
            'Progress subscription failed - unsubscribe is not a function',
          );
          progressUnsubscribeRef.current = null;
        }
      } catch (error) {
        logger.error('Failed to subscribe to progress events', {
          error: error.message,
          stack: error.stack,
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
            stack: error.stack,
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
  };
}

/**
 * Build file operations for organization
 * @param {Object} params - Parameters
 * @returns {Array} Operations array
 */
function buildOperations({
  filesToProcess,
  unprocessedFiles,
  editingFiles,
  getFileWithEdits,
  findSmartFolderForCategory,
  defaultLocation,
}) {
  const fileIndexMap = new Map();
  filesToProcess.forEach((file) => {
    const index = unprocessedFiles.findIndex((f) => f.path === file.path);
    if (index >= 0) fileIndexMap.set(file.path, index);
  });

  return filesToProcess.map((file) => {
    const fileIndex = fileIndexMap.get(file.path) ?? -1;
    const edits = fileIndex >= 0 ? editingFiles[fileIndex] || {} : {};
    const fileWithEdits =
      fileIndex >= 0 ? getFileWithEdits(file, fileIndex) : file;
    let currentCategory = edits.category || fileWithEdits.analysis?.category;

    // Filter out "document" category if it's not a smart folder
    if (currentCategory === 'document') {
      const documentFolder = findSmartFolderForCategory('document');
      if (!documentFolder) {
        currentCategory = 'Uncategorized';
      }
    }

    const smartFolder = findSmartFolderForCategory(currentCategory);
    const destinationDir = smartFolder
      ? smartFolder.path || `${defaultLocation}/${smartFolder.name}`
      : `${defaultLocation}/${currentCategory || 'Uncategorized'}`;
    const suggestedName =
      edits.suggestedName || fileWithEdits.analysis?.suggestedName || file.name;

    // Ensure extension is present - use lastIndexOf for more robust extension detection
    const originalExtIdx = file.name.lastIndexOf('.');
    const originalExt =
      originalExtIdx > 0 ? file.name.slice(originalExtIdx) : '';
    const suggestedExtIdx = suggestedName.lastIndexOf('.');
    const hasExtension =
      suggestedExtIdx > 0 && suggestedExtIdx > suggestedName.length - 6;
    const newName =
      hasExtension || !originalExt
        ? suggestedName
        : suggestedName + originalExt;

    const dest = `${destinationDir}/${newName}`;
    const normalized = window.electronAPI?.files?.normalizePath?.(dest) || dest;
    return { type: 'move', source: file.path, destination: normalized };
  });
}

/**
 * Build preview list for progress UI
 * @param {Object} params - Parameters
 * @returns {Array} Preview array
 */
function buildPreview({
  filesToProcess,
  unprocessedFiles,
  editingFiles,
  getFileWithEdits,
  findSmartFolderForCategory,
  defaultLocation,
}) {
  const fileIndexMap = new Map();
  filesToProcess.forEach((file) => {
    const index = unprocessedFiles.findIndex((f) => f.path === file.path);
    if (index >= 0) fileIndexMap.set(file.path, index);
  });

  return filesToProcess.map((file) => {
    const fileIndex = fileIndexMap.get(file.path) ?? -1;
    const edits = fileIndex >= 0 ? editingFiles[fileIndex] || {} : {};
    const fileWithEdits =
      fileIndex >= 0 ? getFileWithEdits(file, fileIndex) : file;
    let currentCategory = edits.category || fileWithEdits.analysis?.category;

    if (currentCategory === 'document') {
      const documentFolder = findSmartFolderForCategory('document');
      if (!documentFolder) {
        currentCategory = 'Uncategorized';
      }
    }

    const smartFolder = findSmartFolderForCategory(currentCategory);
    const destinationDir = smartFolder
      ? smartFolder.path || `${defaultLocation}/${smartFolder.name}`
      : `${defaultLocation}/${currentCategory || 'Uncategorized'}`;
    const suggestedName =
      edits.suggestedName || fileWithEdits.analysis?.suggestedName || file.name;

    // Ensure extension is present - use lastIndexOf for more robust extension detection
    const originalExtIdx = file.name.lastIndexOf('.');
    const originalExt =
      originalExtIdx > 0 ? file.name.slice(originalExtIdx) : '';
    const suggestedExtIdx = suggestedName.lastIndexOf('.');
    const hasExtension =
      suggestedExtIdx > 0 && suggestedExtIdx > suggestedName.length - 6;
    const newName =
      hasExtension || !originalExt
        ? suggestedName
        : suggestedName + originalExt;

    const dest = `${destinationDir}/${newName}`;
    const normalized = window.electronAPI?.files?.normalizePath?.(dest) || dest;
    return { fileName: newName, destination: normalized };
  });
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
  smartFolders,
  analysisResults,
  markFilesAsProcessed,
  unmarkFilesAsProcessed,
  actions,
  phaseData,
  addNotification,
  executeAction,
  setOrganizedFiles,
  setOrganizingState,
}) {
  const {
    batchProgress,
    setBatchProgress,
    organizePreview,
    setOrganizePreview,
    isOrganizing,
    setIsOrganizing,
  } = useProgressTracking();

  const handleOrganizeFiles = useCallback(
    async (filesToOrganize = null) => {
      // FIX: Ensure filesToOrganize is actually an array, not a React event
      const actualFilesToOrganize = Array.isArray(filesToOrganize)
        ? filesToOrganize
        : null;

      logger.info('[ORGANIZE] handleOrganizeFiles called', {
        providedFiles: actualFilesToOrganize?.length ?? 'null',
        unprocessedFilesCount: unprocessedFiles?.length ?? 0,
      });

      try {
        setIsOrganizing(true);
        setOrganizingState(true);

        const filesToProcess =
          actualFilesToOrganize || unprocessedFiles.filter((f) => f.analysis);

        logger.info('[ORGANIZE] Files to process', {
          count: filesToProcess.length,
        });

        if (filesToProcess.length === 0) {
          addNotification(
            'No files ready to organize. Please ensure files have been analyzed.',
            'warning',
          );
          logger.warn('[ORGANIZE] No files to process - returning early');
          setIsOrganizing(false);
          setOrganizingState(false);
          return;
        }

        setBatchProgress({
          current: 0,
          total: filesToProcess.length,
          currentFile: '',
        });

        // Check if auto-organize with suggestions is available
        const useAutoOrganize = window.electronAPI?.organize?.auto;
        logger.info(
          '[ORGANIZE] Auto-organize API available:',
          !!useAutoOrganize,
        );

        let operations;
        if (useAutoOrganize) {
          logger.info('[ORGANIZE] Calling auto-organize API...');
          const result = await window.electronAPI.organize.auto({
            files: filesToProcess,
            smartFolders,
            options: {
              defaultLocation,
              confidenceThreshold: 0.7,
              preserveNames: false,
            },
          });
          logger.info('[ORGANIZE] Auto-organize result:', {
            success: result?.success,
            operationsCount:
              result?.operations?.length ?? result?.organized?.length ?? 0,
            error: result?.error,
          });

          if (result && result.success === false) {
            addNotification(
              result.error || 'Auto-organize service is not available',
              'error',
              5000,
              'organize-service-error',
            );
            logger.error('[ORGANIZE] Auto-organize failed:', result.error);
            setIsOrganizing(false);
            setOrganizingState(false);
            setBatchProgress({ current: 0, total: 0, currentFile: '' });
            return;
          }

          // Prefer operations array (correct format), fall back to organized but convert format
          if (result?.operations && result.operations.length > 0) {
            operations = result.operations;
          } else if (result?.organized && result.organized.length > 0) {
            logger.warn(
              '[ORGANIZE] Using organized array as fallback - converting format',
            );
            // Convert organized format {file, destination, confidence} to operations format {type, source, destination}
            operations = result.organized
              .map((item) => ({
                type: 'move',
                source: item.file?.path || item.source || item.path,
                destination: item.destination,
              }))
              .filter((op) => op.source && op.destination);
          } else {
            operations = [];
          }

          if (result?.needsReview && result.needsReview.length > 0) {
            addNotification(
              `${result.needsReview.length} files need manual review due to low confidence`,
              'info',
              4000,
              'organize-needs-review',
            );
          }

          if (result?.failed && result.failed.length > 0) {
            addNotification(
              `${result.failed.length} files could not be organized`,
              'warning',
              4000,
              'organize-failed-files',
            );
          }
        } else {
          // Fallback to original logic
          operations = buildOperations({
            filesToProcess,
            unprocessedFiles,
            editingFiles,
            getFileWithEdits,
            findSmartFolderForCategory,
            defaultLocation,
          });
        }

        if (!operations || operations.length === 0) {
          addNotification(
            'No confident file moves were generated. Review files manually before organizing.',
            'info',
            4000,
            'organize-no-operations',
          );
          setIsOrganizing(false);
          setOrganizingState(false);
          setBatchProgress({ current: 0, total: 0, currentFile: '' });
          return;
        }

        // Build preview
        try {
          const preview = buildPreview({
            filesToProcess,
            unprocessedFiles,
            editingFiles,
            getFileWithEdits,
            findSmartFolderForCategory,
            defaultLocation,
          });
          setOrganizePreview(preview);
        } catch (previewError) {
          logger.warn(
            '[ORGANIZE] Preview generation failed (non-fatal):',
            previewError.message,
          );
        }

        const sourcePathsSet = new Set(operations.map((op) => op.source));

        const stateCallbacks = {
          onExecute: (result) => {
            try {
              const resArray = Array.isArray(result?.results)
                ? result.results
                : [];
              const uiResults = resArray
                .filter((r) => r.success)
                .map((r) => {
                  const original =
                    analysisResults.find((a) => a.path === r.source) || {};
                  return {
                    originalPath: r.source,
                    path: r.destination,
                    originalName:
                      original.name ||
                      (original.path ? original.path.split(/[\\/]/).pop() : ''),
                    newName: r.destination
                      ? r.destination.split(/[\\/]/).pop()
                      : '',
                    smartFolder: 'Organized',
                    organizedAt: new Date().toISOString(),
                  };
                });
              if (uiResults.length > 0) {
                setOrganizedFiles((prev) => [...prev, ...uiResults]);
                markFilesAsProcessed(uiResults.map((r) => r.originalPath));
                actions.setPhaseData('organizedFiles', [
                  ...(phaseData.organizedFiles || []),
                  ...uiResults,
                ]);
                addNotification(
                  `Organized ${uiResults.length} files`,
                  'success',
                );
                setBatchProgress({
                  current: filesToProcess.length,
                  total: filesToProcess.length,
                  currentFile: '',
                });
              } else {
                logger.warn(
                  '[ORGANIZE] onExecute: No successful results to process',
                );
              }
            } catch (callbackError) {
              logger.error(
                '[ORGANIZE] onExecute callback failed:',
                callbackError.message,
              );
            }
          },
          onUndo: (result) => {
            try {
              // Use actual results from main process if available
              const successfulUndos = result?.results
                ? result.results
                    .filter((r) => r.success)
                    .map((r) => r.originalPath || r.newPath)
                : Array.from(sourcePathsSet);

              const undoPathsSet = new Set(successfulUndos);

              setOrganizedFiles((prev) =>
                prev.filter((of) => !undoPathsSet.has(of.originalPath)),
              );
              unmarkFilesAsProcessed(Array.from(undoPathsSet));
              actions.setPhaseData(
                'organizedFiles',
                (phaseData.organizedFiles || []).filter(
                  (of) => !undoPathsSet.has(of.originalPath),
                ),
              );

              const successCount =
                result?.successCount ?? successfulUndos.length;
              const failCount = result?.failCount ?? 0;

              if (failCount > 0) {
                addNotification(
                  `Undo partially complete: ${successCount} files restored, ${failCount} failed.`,
                  'warning',
                );
              } else {
                addNotification(
                  `Undo complete. ${successCount} files restored to original locations.`,
                  'info',
                );
              }
            } catch (undoError) {
              logger.error(
                '[ORGANIZE] onUndo callback failed:',
                undoError.message,
              );
            }
          },
          onRedo: (result) => {
            try {
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
                      organizedAt: new Date().toISOString(),
                    }))
                  : operations.map((op) => ({
                      originalPath: op.source,
                      path: op.destination,
                      originalName: op.source.split(/[\\/]/).pop(),
                      newName: op.destination.split(/[\\/]/).pop(),
                      smartFolder: 'Organized',
                      organizedAt: new Date().toISOString(),
                    }));

              if (uiResults.length > 0) {
                setOrganizedFiles((prev) => [...prev, ...uiResults]);
                markFilesAsProcessed(uiResults.map((r) => r.originalPath));
                actions.setPhaseData('organizedFiles', [
                  ...(phaseData.organizedFiles || []),
                  ...uiResults,
                ]);
              }

              const successCount = result?.successCount ?? uiResults.length;
              const failCount = result?.failCount ?? 0;

              if (failCount > 0) {
                addNotification(
                  `Redo partially complete: ${successCount} files re-organized, ${failCount} failed.`,
                  'warning',
                );
              } else {
                addNotification(
                  `Redo complete. ${successCount} files re-organized.`,
                  'info',
                );
              }
            } catch (redoError) {
              logger.error(
                '[ORGANIZE] onRedo callback failed:',
                redoError.message,
              );
            }
          },
        };

        logger.info('[ORGANIZE] Executing batch action with', {
          operationsCount: operations.length,
        });

        const result = await executeAction(
          createOrganizeBatchAction(
            `Organize ${operations.length} files`,
            operations,
            stateCallbacks,
          ),
        );

        logger.info('[ORGANIZE] Batch action result:', {
          success: result?.success,
          resultsCount: result?.results?.length ?? 0,
        });

        const successCount = Array.isArray(result?.results)
          ? result.results.filter((r) => r.success).length
          : 0;

        logger.info('[ORGANIZE] Final result:', {
          successCount,
          totalResults: result?.results?.length ?? 0,
          willAdvancePhase: successCount > 0,
        });

        if (successCount > 0) {
          actions.advancePhase(PHASES.COMPLETE);
        } else {
          logger.warn(
            '[ORGANIZE] No successful operations - phase will not advance',
          );
          addNotification(
            'No files were organized successfully. Check the logs for details.',
            'warning',
          );
        }
      } catch (error) {
        logger.error('[ORGANIZE] Organization error:', {
          message: error.message,
          stack: error.stack,
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
      smartFolders,
      analysisResults,
      markFilesAsProcessed,
      unmarkFilesAsProcessed,
      actions,
      phaseData,
      addNotification,
      executeAction,
      setOrganizedFiles,
      setOrganizingState,
      setBatchProgress,
      setIsOrganizing,
      setOrganizePreview,
    ],
  );

  return {
    isOrganizing,
    batchProgress,
    organizePreview,
    handleOrganizeFiles,
    setBatchProgress,
  };
}

export default useOrganization;
