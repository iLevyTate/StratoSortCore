import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from 'react';
import { PHASES } from '../../shared/constants';
import { logger } from '../../shared/logger';
import { usePhase } from '../contexts/PhaseContext';
import { useNotification } from '../contexts/NotificationContext';
import { Collapsible, Button } from '../components/ui';
import {
  StatusOverview,
  TargetFolderList,
  ReadyFileItem,
  BulkOperations,
  OrganizeProgress,
} from '../components/organize';
import { UndoRedoToolbar, useUndoRedo } from '../components/UndoRedoSystem';
import { createOrganizeBatchAction } from '../components/UndoRedoSystem';
const { debounce } = require('../utils/performance');

// Set logger context for this component
logger.setContext('OrganizePhase');

function OrganizePhase() {
  const { actions, phaseData } = usePhase();
  const { addNotification } = useNotification();
  const { executeAction } = useUndoRedo();
  const [organizedFiles, setOrganizedFiles] = useState([]);
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({
    current: 0,
    total: 0,
    currentFile: '',
  });
  const [organizePreview, setOrganizePreview] = useState([]);
  const [editingFiles, setEditingFiles] = useState({});
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [bulkCategory, setBulkCategory] = useState('');
  const [defaultLocation, setDefaultLocation] = useState('Documents');

  const [fileStates, setFileStates] = useState({});
  const [processedFileIds, setProcessedFileIds] = useState(new Set());

  const analysisResults =
    phaseData.analysisResults && Array.isArray(phaseData.analysisResults)
      ? phaseData.analysisResults
      : [];
  const smartFolders = phaseData.smartFolders || [];

  // Ensure smart folders are available even if user skipped Setup
  useEffect(() => {
    const loadSmartFoldersIfMissing = async () => {
      try {
        if (!Array.isArray(smartFolders) || smartFolders.length === 0) {
          const folders = await window.electronAPI.smartFolders.get();
          if (Array.isArray(folders) && folders.length > 0) {
            actions.setPhaseData('smartFolders', folders);
            addNotification(
              `Loaded ${folders.length} smart folder${folders.length > 1 ? 's' : ''}`,
              'info',
            );
          }
        }
      } catch (error) {
        logger.error('Failed to load smart folders in Organize phase', {
          error: error.message,
          stack: error.stack,
        });
      }
    };
    loadSmartFoldersIfMissing();
  }, []);

  useEffect(() => {
    // Resolve a real default destination base (Documents folder) from main process
    (async () => {
      try {
        const docsPath = await window.electronAPI?.files?.getDocumentsPath?.();
        if (docsPath && typeof docsPath === 'string') {
          setDefaultLocation(docsPath);
        }
      } catch {
        // Non-fatal if docs path fails to load
      }
    })();

    const loadPersistedData = () => {
      const persistedStates = phaseData.fileStates || {};
      setFileStates(persistedStates);
      if (
        (phaseData.analysisResults || []).length === 0 &&
        Object.keys(persistedStates).length > 0
      ) {
        // Bug #34: Use spread operator to preserve all fields during state reconstruction
        const reconstructedResults = Object.entries(persistedStates).map(
          ([filePath, stateObj]) => {
            // Fixed: Validate and sanitize analysis object to prevent crashes
            const analysis = stateObj.analysis
              ? {
                  // Bug #34: Use spread operator to preserve all original analysis fields
                  ...stateObj.analysis,
                  // Then apply safe defaults for critical fields
                  category: stateObj.analysis.category || 'Uncategorized',
                  suggestedName:
                    stateObj.analysis.suggestedName ||
                    filePath.split(/[\\/]/).pop(),
                  confidence:
                    // HIGH PRIORITY FIX #3: Use Number.isFinite() instead of isNaN()
                    Number.isFinite(stateObj.analysis.confidence)
                      ? Math.max(0, Math.min(1, stateObj.analysis.confidence)) // Clamp to 0-1
                      : 0.5,
                  summary: stateObj.analysis.summary || '',
                  keywords: Array.isArray(stateObj.analysis.keywords)
                    ? stateObj.analysis.keywords
                    : [],
                }
              : null;

            // Bug #34: Use spread operator to preserve all original state fields
            return {
              // Preserve all original fields from stateObj
              ...stateObj,
              // Override/ensure critical fields have safe values
              name: stateObj.name || filePath.split(/[\\/]/).pop(),
              path: filePath,
              size: typeof stateObj.size === 'number' ? stateObj.size : 0,
              type: stateObj.type || 'file',
              source: stateObj.source || 'reconstructed',
              analysis,
              error: stateObj.error || null,
              analyzedAt: stateObj.analyzedAt || new Date().toISOString(),
              confidence:
                // HIGH PRIORITY FIX #3: Use Number.isFinite() for proper type checking
                Number.isFinite(stateObj.confidence)
                  ? stateObj.confidence
                  : 0.5,
              status:
                stateObj.state === 'ready'
                  ? 'analyzed'
                  : stateObj.state === 'error'
                    ? 'failed'
                    : 'unknown',
            };
          },
        );
        actions.setPhaseData('analysisResults', reconstructedResults);
      }
      if (
        Object.keys(persistedStates).length === 0 &&
        analysisResults.length > 0
      ) {
        const reconstructedStates = {};
        analysisResults.forEach((file) => {
          if (file.analysis && !file.error)
            reconstructedStates[file.path] = {
              state: 'ready',
              timestamp: file.analyzedAt || new Date().toISOString(),
              analysis: file.analysis,
              analyzedAt: file.analyzedAt,
            };
          else if (file.error)
            reconstructedStates[file.path] = {
              state: 'error',
              timestamp: file.analyzedAt || new Date().toISOString(),
              error: file.error,
              analyzedAt: file.analyzedAt,
            };
          else
            reconstructedStates[file.path] = {
              state: 'pending',
              timestamp: new Date().toISOString(),
            };
        });
        setFileStates(reconstructedStates);
        actions.setPhaseData('fileStates', reconstructedStates);
      }
      const previouslyOrganized = phaseData.organizedFiles || [];
      const processedIds = new Set(
        previouslyOrganized.map((file) => file.originalPath || file.path),
      );
      setProcessedFileIds(processedIds);
      if (previouslyOrganized.length > 0)
        setOrganizedFiles(previouslyOrganized);
    };
    loadPersistedData();
  }, [phaseData, analysisResults, actions]);

  // HIGH PRIORITY FIX #1: Use AbortController pattern for reliable cleanup
  // This ensures proper cleanup even if component unmounts during async setup
  useEffect(() => {
    const abortController = new AbortController();
    let unsubscribe = null;

    const setupProgressListener = async () => {
      // Check abort signal early
      if (abortController.signal.aborted) return;

      // Verify the event system is available
      if (!window.electronAPI?.events?.onOperationProgress) {
        logger.warn(
          'Progress event system not available - progress updates will not be shown',
        );
        return;
      }

      try {
        unsubscribe = window.electronAPI.events.onOperationProgress(
          (payload) => {
            // Check if cleanup has been initiated
            if (abortController.signal.aborted) return;

            try {
              if (!payload || payload.type !== 'batch_organize') return;

              // Validate payload data
              // HIGH PRIORITY FIX #3: Use Number.isFinite() instead of isNaN()
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
          },
        );

        // Verify subscription succeeded
        if (typeof unsubscribe !== 'function') {
          logger.error(
            'Progress subscription failed - unsubscribe is not a function',
          );
          unsubscribe = null;
        }
      } catch (error) {
        logger.error('Failed to subscribe to progress events', {
          error: error.message,
          stack: error.stack,
        });
      }
    };

    // Execute setup
    setupProgressListener();

    // Return cleanup function that will ALWAYS execute
    return () => {
      // Signal abort to all async operations
      abortController.abort();

      // Clean up event listener if it exists
      if (typeof unsubscribe === 'function') {
        try {
          unsubscribe();
        } catch (error) {
          logger.error('Error unsubscribing from progress events', {
            error: error.message,
            stack: error.stack,
          });
        }
      }
    };
  }, []);

  const isAnalysisRunning = phaseData.isAnalyzing || false;
  const analysisProgressFromDiscover = phaseData.analysisProgress || {
    current: 0,
    total: 0,
  };

  const getFileState = useCallback(
    (filePath) => fileStates[filePath]?.state || 'pending',
    [fileStates],
  );

  const getFileStateDisplay = useCallback(
    (filePath, hasAnalysis, isProcessed = false) => {
      if (isProcessed)
        return {
          icon: '✅',
          label: 'Organized',
          color: 'text-green-600',
          spinning: false,
        };
      const state = getFileState(filePath);
      if (state === 'analyzing')
        return {
          icon: '🔄',
          label: 'Analyzing...',
          color: 'text-blue-600',
          spinning: true,
        };
      if (state === 'error')
        return {
          icon: '❌',
          label: 'Error',
          color: 'text-red-600',
          spinning: false,
        };
      if (hasAnalysis && state === 'ready')
        return {
          icon: '📂',
          label: 'Ready',
          color: 'text-stratosort-blue',
          spinning: false,
        };
      if (state === 'pending')
        return {
          icon: '⏳',
          label: 'Pending',
          color: 'text-yellow-600',
          spinning: false,
        };
      return {
        icon: '❌',
        label: 'Failed',
        color: 'text-red-600',
        spinning: false,
      };
    },
    [getFileState],
  );

  const unprocessedFiles = useMemo(
    () =>
      Array.isArray(analysisResults)
        ? analysisResults.filter(
            (file) => !processedFileIds.has(file.path) && file && file.analysis,
          )
        : [],
    [analysisResults, processedFileIds],
  );
  const processedFiles = useMemo(
    () =>
      Array.isArray(organizedFiles)
        ? organizedFiles.filter((file) =>
            processedFileIds.has(file?.originalPath || file?.path),
          )
        : [],
    [organizedFiles, processedFileIds],
  );

  // Fixed: Enhanced cache invalidation and optimized matching
  const findSmartFolderForCategory = useMemo(() => {
    const folderCache = new Map();

    // Pre-normalize smart folders once for efficient matching
    const normalizedFolders = smartFolders.map((folder) => {
      const baseName = folder?.name?.toLowerCase()?.trim() || '';
      return {
        original: folder,
        normalized: baseName,
        variants: [
          baseName,
          baseName.replace(/s$/, ''),
          baseName + 's',
          baseName.replace(/\s+/g, ''),
          baseName.replace(/\s+/g, '-'),
          baseName.replace(/\s+/g, '_'),
        ],
      };
    });

    return (category) => {
      if (!category) return null;

      // Check cache first
      if (folderCache.has(category)) {
        return folderCache.get(category);
      }

      const normalizedCategory = category.toLowerCase().trim();

      // Generate category variants
      const categoryVariants = [
        normalizedCategory,
        normalizedCategory.replace(/s$/, ''),
        normalizedCategory + 's',
        normalizedCategory.replace(/\s+/g, ''),
        normalizedCategory.replace(/\s+/g, '-'),
        normalizedCategory.replace(/\s+/g, '_'),
      ];

      // Try to find a match
      let matchedFolder = null;

      for (const normalizedFolder of normalizedFolders) {
        // Direct match on normalized name
        if (normalizedFolder.normalized === normalizedCategory) {
          matchedFolder = normalizedFolder.original;
          break;
        }

        // Try all variant combinations
        for (const categoryVariant of categoryVariants) {
          if (normalizedFolder.variants.includes(categoryVariant)) {
            matchedFolder = normalizedFolder.original;
            break;
          }
        }

        if (matchedFolder) break;
      }

      // Cache the result (even if null to avoid repeated lookups)
      folderCache.set(category, matchedFolder);
      return matchedFolder;
    };
  }, [
    smartFolders,
    // Fixed: Use deep comparison of folder properties to invalidate cache when folders change
    // This prevents stale cache when folder names/paths are edited
    JSON.stringify(
      smartFolders.map((f) => ({ id: f?.id, name: f?.name, path: f?.path })),
    ),
  ]);

  const handleEditFile = useCallback((fileIndex, field, value) => {
    setEditingFiles((prev) => ({
      ...prev,
      [fileIndex]: { ...prev[fileIndex], [field]: value },
    }));
  }, []);

  const getFileWithEdits = useCallback(
    (file, index) => {
      const edits = editingFiles[index];
      if (!edits) return file;
      const updatedCategory = edits.category || file.analysis?.category;
      return {
        ...file,
        analysis: {
          ...file.analysis,
          suggestedName: edits.suggestedName || file.analysis?.suggestedName,
          category: updatedCategory,
        },
      };
    },
    [editingFiles],
  );

  const markFilesAsProcessed = useCallback(
    (filePaths) =>
      setProcessedFileIds((prev) => {
        const next = new Set(prev);
        filePaths.forEach((path) => next.add(path));
        return next;
      }),
    [],
  );

  const unmarkFilesAsProcessed = useCallback(
    (filePaths) =>
      setProcessedFileIds((prev) => {
        const next = new Set(prev);
        filePaths.forEach((path) => next.delete(path));
        return next;
      }),
    [],
  );

  const toggleFileSelection = useCallback(
    (index) => {
      const next = new Set(selectedFiles);
      next.has(index) ? next.delete(index) : next.add(index);
      setSelectedFiles(next);
    },
    [selectedFiles],
  );

  const selectAllFiles = useCallback(() => {
    selectedFiles.size === unprocessedFiles.length
      ? setSelectedFiles(new Set())
      : setSelectedFiles(
          new Set(Array.from({ length: unprocessedFiles.length }, (_, i) => i)),
        );
  }, [selectedFiles, unprocessedFiles.length]);

  // PERFORMANCE FIX #10: Create debounced version of bulk operations
  // Prevents excessive re-renders and state updates when user makes rapid changes
  // Use ref to store debounced function to maintain identity across renders
  const debouncedBulkCategoryChangeRef = useRef(null);

  // Initialize debounced function only once
  if (!debouncedBulkCategoryChangeRef.current) {
    debouncedBulkCategoryChangeRef.current = debounce(
      (category, selected, edits, notify) => {
        if (!category) return;
        const newEdits = {};
        selected.forEach((i) => (newEdits[i] = { ...edits[i], category }));
        setEditingFiles((prev) => ({ ...prev, ...newEdits }));
        setBulkEditMode(false);
        setBulkCategory('');
        setSelectedFiles(new Set());
        notify(
          `Applied category "${category}" to ${selected.size} files`,
          'success',
        );
      },
      300,
    ); // 300ms debounce delay
  }

  const applyBulkCategoryChange = useCallback(() => {
    if (!bulkCategory) return;
    // Call debounced version with current values
    debouncedBulkCategoryChangeRef.current(
      bulkCategory,
      selectedFiles,
      editingFiles,
      addNotification,
    );
  }, [bulkCategory, selectedFiles, editingFiles, addNotification]);

  const handleOrganizeFiles = useCallback(
    async (filesToOrganize = null) => {
      try {
        setIsOrganizing(true);
        // Use provided files or fall back to all unprocessed files
        const filesToProcess =
          filesToOrganize || unprocessedFiles.filter((f) => f.analysis);
        if (filesToProcess.length === 0) return;
        setBatchProgress({
          current: 0,
          total: filesToProcess.length,
          currentFile: '',
        });

        // Check if auto-organize with suggestions is available
        const useAutoOrganize = window.electronAPI?.organize?.auto;

        let operations;
        if (useAutoOrganize) {
          // Use the new auto-organize service with suggestions
          const result = await window.electronAPI.organize.auto({
            files: filesToProcess,
            smartFolders,
            options: {
              defaultLocation,
              confidenceThreshold: 0.7, // Use medium confidence for manual trigger
              preserveNames: false,
            },
          });

          operations = result.operations || [];

          // Handle files that need review
          if (result.needsReview && result.needsReview.length > 0) {
            addNotification(
              `${result.needsReview.length} files need manual review due to low confidence`,
              'info',
              4000,
              'organize-needs-review',
            );
          }
        } else {
          // Fallback to original logic
          // Map files to their indices in unprocessedFiles for editing lookup
          const fileIndexMap = new Map();
          filesToProcess.forEach((file) => {
            const index = unprocessedFiles.findIndex(
              (f) => f.path === file.path,
            );
            if (index >= 0) fileIndexMap.set(file.path, index);
          });

          operations = filesToProcess.map((file) => {
            const fileIndex = fileIndexMap.get(file.path) ?? -1;
            const edits = fileIndex >= 0 ? editingFiles[fileIndex] || {} : {};
            const fileWithEdits =
              fileIndex >= 0 ? getFileWithEdits(file, fileIndex) : file;
            let currentCategory =
              edits.category || fileWithEdits.analysis?.category;
            // Fix: Filter out "document" category if it's not a smart folder
            if (currentCategory === 'document') {
              const documentFolder = findSmartFolderForCategory('document');
              if (!documentFolder) {
                // Replace with "Uncategorized" if "document" is not a smart folder
                currentCategory = 'Uncategorized';
              }
            }
            const smartFolder = findSmartFolderForCategory(currentCategory);
            const destinationDir = smartFolder
              ? smartFolder.path || `${defaultLocation}/${smartFolder.name}`
              : `${defaultLocation}/${currentCategory || 'Uncategorized'}`;
            const suggestedName =
              edits.suggestedName ||
              fileWithEdits.analysis?.suggestedName ||
              file.name;

            // Defensive check: Ensure extension is present to prevent unopenable files
            const originalExt = file.name.includes('.')
              ? '.' + file.name.split('.').pop()
              : '';
            const newName =
              suggestedName.includes('.') || !originalExt
                ? suggestedName // Already has extension or no extension to preserve
                : suggestedName + originalExt; // Add extension back

            const dest = `${destinationDir}/${newName}`;
            const normalized =
              window.electronAPI?.files?.normalizePath?.(dest) || dest;
            return { type: 'move', source: file.path, destination: normalized };
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
          setBatchProgress({ current: 0, total: 0, currentFile: '' });
          return;
        }

        // Prepare a lightweight preview list for the progress UI
        try {
          // Map files to their indices in unprocessedFiles for editing lookup
          const fileIndexMap = new Map();
          filesToProcess.forEach((file) => {
            const index = unprocessedFiles.findIndex(
              (f) => f.path === file.path,
            );
            if (index >= 0) fileIndexMap.set(file.path, index);
          });

          const preview = filesToProcess.map((file) => {
            const fileIndex = fileIndexMap.get(file.path) ?? -1;
            const edits = fileIndex >= 0 ? editingFiles[fileIndex] || {} : {};
            const fileWithEdits =
              fileIndex >= 0 ? getFileWithEdits(file, fileIndex) : file;
            let currentCategory =
              edits.category || fileWithEdits.analysis?.category;
            // Fix: Filter out "document" category if it's not a smart folder
            if (currentCategory === 'document') {
              const documentFolder = findSmartFolderForCategory('document');
              if (!documentFolder) {
                // Replace with "Uncategorized" if "document" is not a smart folder
                currentCategory = 'Uncategorized';
              }
            }
            const smartFolder = findSmartFolderForCategory(currentCategory);
            const destinationDir = smartFolder
              ? smartFolder.path || `${defaultLocation}/${smartFolder.name}`
              : `${defaultLocation}/${currentCategory || 'Uncategorized'}`;
            const suggestedName =
              edits.suggestedName ||
              fileWithEdits.analysis?.suggestedName ||
              file.name;

            // Defensive check: Ensure extension is present to prevent unopenable files
            const originalExt = file.name.includes('.')
              ? '.' + file.name.split('.').pop()
              : '';
            const newName =
              suggestedName.includes('.') || !originalExt
                ? suggestedName // Already has extension or no extension to preserve
                : suggestedName + originalExt; // Add extension back

            const dest = `${destinationDir}/${newName}`;
            const normalized =
              window.electronAPI?.files?.normalizePath?.(dest) || dest;
            return { fileName: newName, destination: normalized };
          });
          setOrganizePreview(preview);
        } catch {
          // Non-fatal if preview generation fails
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
                // Mark visual progress complete
                setBatchProgress({
                  current: filesToProcess.length,
                  total: filesToProcess.length,
                  currentFile: '',
                });
              }
            } catch {
              // Non-fatal if state callback fails
            }
          },
          onUndo: () => {
            try {
              // Remove any organized entries that belong to this batch
              setOrganizedFiles((prev) =>
                prev.filter((of) => !sourcePathsSet.has(of.originalPath)),
              );
              unmarkFilesAsProcessed(Array.from(sourcePathsSet));
              actions.setPhaseData(
                'organizedFiles',
                (phaseData.organizedFiles || []).filter(
                  (of) => !sourcePathsSet.has(of.originalPath),
                ),
              );
              addNotification(
                'Undo complete. Restored files to original locations.',
                'info',
              );
            } catch {
              // Non-fatal if state callback fails
            }
          },
          onRedo: () => {
            try {
              // Best-effort: re-add based on operations
              const uiResults = operations.map((op) => ({
                originalPath: op.source,
                path: op.destination,
                originalName: op.source.split(/[\\/]/).pop(),
                newName: op.destination.split(/[\\/]/).pop(),
                smartFolder: 'Organized',
                organizedAt: new Date().toISOString(),
              }));
              setOrganizedFiles((prev) => [...prev, ...uiResults]);
              markFilesAsProcessed(uiResults.map((r) => r.originalPath));
              actions.setPhaseData('organizedFiles', [
                ...(phaseData.organizedFiles || []),
                ...uiResults,
              ]);
              addNotification('Redo complete. Files re-organized.', 'info');
            } catch {
              // Non-fatal if state callback fails
            }
          },
        };

        // Execute as a single undoable action
        const result = await executeAction(
          createOrganizeBatchAction(
            `Organize ${operations.length} files`,
            operations,
            stateCallbacks,
          ),
        );
        // Only advance if at least one file organized successfully
        const successCount = Array.isArray(result?.results)
          ? result.results.filter((r) => r.success).length
          : 0;
        if (successCount > 0) actions.advancePhase(PHASES.COMPLETE);
      } catch (error) {
        addNotification(`Organization failed: ${error.message}`, 'error');
      } finally {
        setIsOrganizing(false);
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
    ],
  );

  const approveSelectedFiles = useCallback(() => {
    if (selectedFiles.size === 0) return;
    // Organize only the selected files
    const selectedIndices = Array.from(selectedFiles);
    const filesToProcess = selectedIndices
      .map((index) => unprocessedFiles[index])
      .filter((f) => f && f.analysis);

    if (filesToProcess.length === 0) {
      addNotification('No valid files selected for organization', 'warning');
      return;
    }

    // Call handleOrganizeFiles with the selected files
    handleOrganizeFiles(filesToProcess);
    setSelectedFiles(new Set());
  }, [selectedFiles, unprocessedFiles, addNotification, handleOrganizeFiles]);

  return (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden modern-scrollbar">
      <div className="container-responsive gap-6 py-6 flex flex-col min-h-min">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between flex-shrink-0">
          <div className="space-y-3">
            <h1 className="heading-primary">📂 Review & Organize</h1>
            <p className="text-lg text-system-gray-600 leading-relaxed max-w-2xl">
              Inspect suggestions, fine-tune smart folders, and execute the
              batch once you&apos;re ready.
            </p>
            {isAnalysisRunning && (
              <div className="flex items-center gap-4 rounded-2xl border border-stratosort-blue/30 bg-stratosort-blue/5 px-5 py-4 text-sm text-stratosort-blue">
                <span className="loading-spinner h-5 w-5 border-t-transparent" />
                Analysis continuing in background:{' '}
                {analysisProgressFromDiscover.current}/
                {analysisProgressFromDiscover.total} files
              </div>
            )}
          </div>
          <UndoRedoToolbar className="flex-shrink-0" />
        </div>

        {/* Main Content */}
        <div className="flex flex-col gap-6">
          {smartFolders.length > 0 && (
            <Collapsible
              title="📁 Target Smart Folders"
              defaultOpen={false}
              persistKey="organize-target-folders"
              contentClassName="p-8"
              className="glass-panel"
            >
              <TargetFolderList
                folders={smartFolders}
                defaultLocation={defaultLocation}
              />
            </Collapsible>
          )}
          {(unprocessedFiles.length > 0 || processedFiles.length > 0) && (
            <Collapsible
              title="📊 File Status Overview"
              defaultOpen
              persistKey="organize-status"
              className="glass-panel"
            >
              <StatusOverview
                unprocessedCount={unprocessedFiles.length}
                processedCount={processedFiles.length}
                failedCount={analysisResults.filter((f) => !f.analysis).length}
              />
            </Collapsible>
          )}
          {unprocessedFiles.length > 0 && (
            <Collapsible
              title="Bulk Operations"
              defaultOpen
              persistKey="organize-bulk"
              className="glass-panel"
            >
              <BulkOperations
                total={unprocessedFiles.length}
                selectedCount={selectedFiles.size}
                onSelectAll={selectAllFiles}
                onApproveSelected={approveSelectedFiles}
                bulkEditMode={bulkEditMode}
                setBulkEditMode={setBulkEditMode}
                bulkCategory={bulkCategory}
                setBulkCategory={setBulkCategory}
                onApplyBulkCategory={applyBulkCategoryChange}
                smartFolders={smartFolders}
              />
            </Collapsible>
          )}
          {processedFiles.length > 0 && (
            <Collapsible
              title="✅ Previously Organized Files"
              defaultOpen={false}
              persistKey="organize-history"
              contentClassName="p-8"
              className="glass-panel"
            >
              <div className="space-y-5">
                {processedFiles.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-8 bg-green-50 rounded-lg border border-green-200"
                  >
                    <div className="flex items-center gap-8">
                      <span className="text-green-600">✅</span>
                      <div>
                        <div className="text-sm font-medium text-system-gray-900">
                          {file.originalName} → {file.newName}
                        </div>
                        <div className="text-xs text-system-gray-500">
                          Moved to {file.smartFolder} •{' '}
                          {new Date(file.organizedAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-green-600 font-medium">
                      Organized
                    </div>
                  </div>
                ))}
              </div>
            </Collapsible>
          )}

          {/* Files Ready */}
          <Collapsible
            title="Files Ready for Organization"
            defaultOpen
            persistKey="organize-ready-list"
            className="glass-panel"
            contentClassName="p-6"
          >
            {unprocessedFiles.length === 0 ? (
              <div className="text-center py-21">
                <div className="text-4xl mb-13">
                  {processedFiles.length > 0 ? '✅' : '📭'}
                </div>
                <p className="text-system-gray-500 italic">
                  {processedFiles.length > 0
                    ? 'All files have been organized! Check the results below.'
                    : 'No files ready for organization yet.'}
                </p>
                {processedFiles.length === 0 && (
                  <Button
                    onClick={() => actions.advancePhase(PHASES.DISCOVER)}
                    variant="primary"
                    className="mt-13"
                  >
                    ← Go Back to Select Files
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
                {unprocessedFiles.map((file, index) => {
                  const fileWithEdits = getFileWithEdits(file, index);
                  const currentCategory =
                    editingFiles[index]?.category ||
                    fileWithEdits.analysis?.category;
                  const smartFolder =
                    findSmartFolderForCategory(currentCategory);
                  const isSelected = selectedFiles.has(index);
                  const stateDisplay = getFileStateDisplay(
                    file.path,
                    !!file.analysis,
                  );
                  const destination = smartFolder
                    ? smartFolder.path ||
                      `${defaultLocation}/${smartFolder.name}`
                    : `${defaultLocation}/${currentCategory || 'Uncategorized'}`;
                  return (
                    <ReadyFileItem
                      key={index}
                      file={fileWithEdits}
                      index={index}
                      isSelected={isSelected}
                      onToggleSelected={toggleFileSelection}
                      stateDisplay={stateDisplay}
                      smartFolders={smartFolders}
                      editing={editingFiles[index]}
                      onEdit={handleEditFile}
                      destination={destination}
                      category={currentCategory}
                    />
                  );
                })}
              </div>
            )}
          </Collapsible>

          {/* Action Area */}
          {unprocessedFiles.length > 0 && (
            <div className="glass-panel p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-system-gray-600 font-medium">
                    Ready to move{' '}
                    {unprocessedFiles.filter((f) => f.analysis).length} files
                  </p>
                  <p className="text-xs text-system-gray-500">
                    You can undo this operation if needed
                  </p>
                </div>
                {isOrganizing ? (
                  <div className="w-1/2">
                    <OrganizeProgress
                      isOrganizing={isOrganizing}
                      batchProgress={batchProgress}
                      preview={organizePreview}
                    />
                  </div>
                ) : (
                  <Button
                    onClick={handleOrganizeFiles}
                    variant="success"
                    className="text-lg px-8 py-4"
                    disabled={
                      unprocessedFiles.filter((f) => f.analysis).length === 0
                    }
                  >
                    ✨ Organize Files Now
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between flex-shrink-0 mt-2">
          <Button
            onClick={() => actions.advancePhase(PHASES.DISCOVER)}
            variant="secondary"
            disabled={isOrganizing}
            className="w-full sm:w-auto"
          >
            ← Back to Discovery
          </Button>
          <Button
            onClick={() => actions.advancePhase(PHASES.COMPLETE)}
            disabled={processedFiles.length === 0 || isOrganizing}
            className={`w-full sm:w-auto ${
              processedFiles.length === 0 || isOrganizing
                ? 'opacity-50 cursor-not-allowed'
                : ''
            }`}
          >
            View Results →
          </Button>
        </div>
      </div>
    </div>
  );
}

export default OrganizePhase;
