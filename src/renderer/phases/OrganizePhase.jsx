import React, { useMemo, useCallback, useEffect, useRef } from 'react';
import { PHASES } from '../../shared/constants';
import { logger } from '../../shared/logger';
import { useNotification } from '../contexts/NotificationContext';
import { Button, Card } from '../components/ui';
// FIX M-3: Import ErrorBoundaryCore for virtualized component protection
import { ErrorBoundaryCore } from '../components/ErrorBoundary';
import { FolderOpen, BarChart3, CheckCircle2, Inbox, Sparkles, AlertTriangle } from 'lucide-react';
import {
  StatusOverview,
  TargetFolderList,
  BulkOperations,
  OrganizeProgress,
  VirtualizedFileGrid,
  VirtualizedProcessedFiles
} from '../components/organize';
import { UndoRedoToolbar, useUndoRedo } from '../components/UndoRedoSystem';
import Modal from '../components/Modal';
import AnalysisDetails from '../components/AnalysisDetails';
// Import decomposed hooks
import { useOrganizeState, useLoadInitialData } from './organize/useOrganizeState';
import { useSmartFolderMatcher } from './organize/useSmartFolderMatcher';
import {
  useFileStateDisplay,
  useFileEditing,
  useFileSelection,
  useBulkOperations,
  useProcessedFiles
} from './organize/useFileEditing';
import { useOrganization } from './organize/useOrganization';
import { setFileStates as setFileStatesAction } from '../store/slices/filesSlice';
import { updateAnalysisResult } from '../store/slices/analysisSlice';

logger.setContext('OrganizePhase');

function OrganizePhase() {
  const { addNotification } = useNotification();
  const { executeAction } = useUndoRedo();
  const [viewingFileDetails, setViewingFileDetails] = React.useState(null);

  // Modal states for secondary panels
  const [showFoldersModal, setShowFoldersModal] = React.useState(false);
  const [showStatusModal, setShowStatusModal] = React.useState(false);
  const [showHistoryModal, setShowHistoryModal] = React.useState(false);

  // Redux state management
  const {
    organizedFiles,
    filesWithAnalysis,
    analysisResults,
    isAnalyzing,
    analysisProgress,
    smartFolders,
    fileStates,
    defaultLocation,
    failedCount,
    smartFoldersRef,
    dispatchRef,
    dispatch,
    setOrganizedFiles,
    addOrganizedFiles,
    removeOrganizedFiles,
    setOrganizingState,
    phaseData,
    actions
  } = useOrganizeState();
  const safeSmartFolders = useMemo(
    () => (Array.isArray(smartFolders) ? smartFolders : []),
    [smartFolders]
  );

  // Load initial data
  const addNotificationRef = useRef(addNotification);
  useEffect(() => {
    addNotificationRef.current = addNotification;
  }, [addNotification]);

  useLoadInitialData({ smartFoldersRef, dispatchRef }, addNotificationRef.current);

  // File state display
  const { getFileStateDisplay } = useFileStateDisplay(fileStates);

  // Processed files tracking needed before filtering
  const {
    setProcessedFileIds,
    markFilesAsProcessed,
    unmarkFilesAsProcessed,
    getFilteredFiles,
    normalizePath
  } = useProcessedFiles(organizedFiles);

  // FIX: Sync processedFileIds when organizedFiles changes (handles undo/redo)
  useEffect(() => {
    if (!organizedFiles || organizedFiles.length === 0) {
      setProcessedFileIds(new Set());
    } else {
      // FIX HIGH-3: Filter out entries without valid paths to prevent normalizePath(undefined)
      // which would produce empty string "" and cause incorrect filtering behavior
      setProcessedFileIds(
        new Set(
          organizedFiles
            .filter((f) => f?.originalPath || f?.path)
            .map((f) => normalizePath(f?.originalPath || f?.path))
        )
      );
    }
  }, [organizedFiles, setProcessedFileIds, normalizePath]);

  // Compute base filtered files (without isOrganizing filtering)
  // This is used by useOrganization hook below
  const { unprocessedFiles: baseUnprocessedFiles, processedFiles } = useMemo(() => {
    return getFilteredFiles(filesWithAnalysis);
  }, [getFilteredFiles, filesWithAnalysis]);

  // File editing (uses a ref callback to avoid circular dependency)
  const { editingFiles, setEditingFiles, handleEditFile, getFileWithEdits } = useFileEditing({
    onEditChange: useCallback(
      (index, field, value) => {
        const file = baseUnprocessedFiles[index];
        if (file && file.path) {
          // Sync category changes immediately so they reflect in other views
          if (field === 'category') {
            dispatch(updateAnalysisResult({ path: file.path, changes: { category: value } }));
          }
          // Sync name changes (could be debounced if performance becomes an issue)
          if (field === 'suggestedName') {
            dispatch(updateAnalysisResult({ path: file.path, changes: { suggestedName: value } }));
          }
        }
      },
      [baseUnprocessedFiles, dispatch]
    )
  });

  // File selection (will be updated after we compute final unprocessedFiles)
  const { selectedFiles, setSelectedFiles, toggleFileSelection, selectAllFiles } = useFileSelection(
    baseUnprocessedFiles.length
  );

  // Bulk operations
  const { bulkEditMode, setBulkEditMode, bulkCategory, setBulkCategory, applyBulkCategoryChange } =
    useBulkOperations({
      selectedFiles,
      editingFiles,
      setEditingFiles,
      setSelectedFiles,
      addNotification
    });

  // Smart folder matcher
  const findSmartFolderForCategory = useSmartFolderMatcher(safeSmartFolders);

  // Organization logic
  // FIX M-4: Destructure organizeConflicts for conflict warning UI
  const { isOrganizing, batchProgress, organizePreview, handleOrganizeFiles, organizeConflicts } =
    useOrganization({
      unprocessedFiles: baseUnprocessedFiles,
      editingFiles,
      getFileWithEdits,
      findSmartFolderForCategory,
      defaultLocation,
      smartFolders: safeSmartFolders,
      analysisResults,
      markFilesAsProcessed,
      unmarkFilesAsProcessed,
      actions,
      phaseData,
      addNotification,
      executeAction,
      setOrganizedFiles,
      addOrganizedFiles,
      removeOrganizedFiles,
      setOrganizingState
    });

  // FIX P1: Filter out files that are currently being organized to prevent "flicker"
  // when files move but organizedFiles/processedFiles hasn't updated yet.
  // This must come AFTER useOrganization since it depends on isOrganizing and organizePreview
  const filesBeingOrganized = useMemo(() => {
    if (!isOrganizing || !organizePreview || organizePreview.length === 0) return new Set();
    return new Set(organizePreview.map((item) => normalizePath(item.sourcePath)));
  }, [isOrganizing, organizePreview, normalizePath]);

  // Compute final filtered unprocessedFiles for display
  const unprocessedFiles = useMemo(() => {
    // If organizing, filter out the files currently being processed from the "Ready" list
    if (isOrganizing && filesBeingOrganized.size > 0) {
      return baseUnprocessedFiles.filter((f) => !filesBeingOrganized.has(normalizePath(f.path)));
    }
    return baseUnprocessedFiles;
  }, [baseUnprocessedFiles, isOrganizing, filesBeingOrganized, normalizePath]);

  // FIX CRIT-7: Listen for batch results chunks from IPC
  useEffect(() => {
    const handleBatchResultsChunk = (event) => {
      const { results, chunk, total } = event.detail || {};
      if (results && Array.isArray(results)) {
        logger.debug('[OrganizePhase] Received batch results chunk', {
          chunk,
          total,
          resultCount: results.length
        });
        // Process the batch results - mark files as processed
        results.forEach((result) => {
          if (result.success && result.path) {
            markFilesAsProcessed([{ path: result.path, originalPath: result.originalPath }]);
          }
        });
      }
    };

    window.addEventListener('batch-results-chunk', handleBatchResultsChunk);
    return () => {
      window.removeEventListener('batch-results-chunk', handleBatchResultsChunk);
    };
  }, [markFilesAsProcessed]);

  // Load persisted data once on mount
  const hasLoadedPersistedDataRef = useRef(false);

  useEffect(() => {
    if (hasLoadedPersistedDataRef.current) {
      return;
    }
    hasLoadedPersistedDataRef.current = true;

    const loadPersistedData = () => {
      const persistedStates = fileStates || {};

      if (analysisResults.length === 0 && Object.keys(persistedStates).length > 0) {
        dispatch(setFileStatesAction({}));
      }
      if (Object.keys(persistedStates).length === 0 && analysisResults.length > 0) {
        const reconstructedStates = {};
        analysisResults.forEach((file) => {
          if (file.analysis && !file.error)
            reconstructedStates[file.path] = {
              state: 'ready',
              timestamp: file.analyzedAt || new Date().toISOString(),
              analysis: file.analysis,
              analyzedAt: file.analyzedAt
            };
          else if (file.error)
            reconstructedStates[file.path] = {
              state: 'error',
              timestamp: file.analyzedAt || new Date().toISOString(),
              error: file.error,
              analyzedAt: file.analyzedAt
            };
          else
            reconstructedStates[file.path] = {
              state: 'pending',
              timestamp: new Date().toISOString()
            };
        });
        dispatch(setFileStatesAction(reconstructedStates));
      }
      const previouslyOrganized = organizedFiles || [];
      const processedIds = new Set(
        previouslyOrganized.map((file) => file.originalPath || file.path)
      );
      setProcessedFileIds(processedIds);
    };
    loadPersistedData();
  }, [analysisResults, dispatch, fileStates, organizedFiles, setProcessedFileIds]);

  const isAnalysisRunning = isAnalyzing || false;
  const analysisProgressFromDiscover = analysisProgress || {
    current: 0,
    total: 0
  };

  const readyFilesCount = useMemo(
    () => unprocessedFiles.filter((f) => f.analysis).length,
    [unprocessedFiles]
  );

  const approveSelectedFiles = useCallback(() => {
    if (selectedFiles.size === 0) return;
    const selectedIndices = Array.from(selectedFiles);
    const filesToProcess = selectedIndices
      .filter((index) => index >= 0 && index < unprocessedFiles.length)
      .map((index) => unprocessedFiles[index])
      .filter((f) => f && f.analysis);

    if (filesToProcess.length === 0) {
      addNotification('No valid files selected for organization', 'warning');
      return;
    }

    handleOrganizeFiles(filesToProcess);
    setSelectedFiles(new Set());
  }, [selectedFiles, unprocessedFiles, addNotification, handleOrganizeFiles, setSelectedFiles]);

  // FIX: Wrapper that respects file selection - organize selected files if any, otherwise all
  const handleOrganizeClick = useCallback(() => {
    if (selectedFiles.size > 0) {
      // Organize only selected files
      approveSelectedFiles();
    } else {
      // No selection - organize all ready files
      handleOrganizeFiles();
    }
  }, [selectedFiles.size, approveSelectedFiles, handleOrganizeFiles]);

  return (
    <div className="organize-page phase-container bg-white pb-spacious">
      <div className="container-responsive flex flex-col flex-1 min-h-0 px-default pt-8 pb-default md:px-relaxed lg:px-spacious gap-6 lg:gap-8 max-w-6xl w-full mx-auto">
        {/* Header */}
        <div className="text-center flex flex-col flex-shrink-0 gap-compact">
          <h1 className="heading-primary text-xl md:text-2xl">
            Review & <span className="text-gradient">Organize</span>
          </h1>
          <p className="text-system-gray-600 leading-relaxed max-w-xl mx-auto text-sm md:text-base">
            Inspect suggestions, fine-tune smart folders, and execute the batch once you&apos;re
            ready.
          </p>
          {isAnalysisRunning && (
            <div className="flex items-center justify-center gap-cozy mt-2">
              <div className="flex items-center border border-stratosort-blue/30 bg-stratosort-blue/5 text-sm text-stratosort-blue gap-cozy rounded-lg px-default py-cozy">
                <span className="loading-spinner h-5 w-5 border-t-transparent" />
                Analysis continuing in background: {analysisProgressFromDiscover.current}/
                {analysisProgressFromDiscover.total} files
              </div>
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-cozy mb-2">
          {/* Quick Access Toolbar - Open modals for secondary info */}
          {/* FIX M-5: Added aria-labels to toolbar buttons for accessibility */}
          <div
            className="flex items-center flex-wrap gap-cozy flex-shrink-0"
            role="toolbar"
            aria-label="Organization tools"
          >
            {safeSmartFolders.length > 0 && (
              <button
                onClick={() => setShowFoldersModal(true)}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-system-gray-700 bg-white/80 border border-border-soft rounded-xl hover:bg-white hover:border-stratosort-blue/30 hover:text-stratosort-blue transition-colors"
                aria-label={`View ${safeSmartFolders.length} smart folders`}
              >
                <FolderOpen className="w-4 h-4" aria-hidden="true" />
                <span>{safeSmartFolders.length} Smart Folders</span>
              </button>
            )}
            <button
              onClick={() => setShowStatusModal(true)}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-system-gray-700 bg-white/80 border border-border-soft rounded-xl hover:bg-white hover:border-stratosort-blue/30 hover:text-stratosort-blue transition-colors"
              aria-label={`View file status: ${unprocessedFiles.length} ready, ${processedFiles.length} done, ${failedCount} failed`}
            >
              <BarChart3 className="w-4 h-4" aria-hidden="true" />
              <span>{unprocessedFiles.length} Ready</span>
              {processedFiles.length > 0 && (
                <span className="text-stratosort-success">• {processedFiles.length} Done</span>
              )}
              {failedCount > 0 && (
                <span className="text-stratosort-danger">• {failedCount} Failed</span>
              )}
            </button>
            {processedFiles.length > 0 && (
              <button
                onClick={() => setShowHistoryModal(true)}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-stratosort-success bg-stratosort-success/5 border border-stratosort-success/20 rounded-xl hover:bg-stratosort-success/10 hover:border-stratosort-success/40 transition-colors"
                aria-label={`View ${processedFiles.length} organized files history`}
              >
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                <span>{processedFiles.length} Organized</span>
              </button>
            )}
          </div>
          <UndoRedoToolbar className="flex-shrink-0" />
        </div>

        {/* Main Content - Files Ready for Organization takes primary focus */}
        <div className="flex-1 min-h-0 flex flex-col gap-6">
          {/* Inline Bulk Operations when files selected */}
          {unprocessedFiles.length > 0 && selectedFiles.size > 0 && (
            <div className="surface-panel p-default flex-shrink-0">
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
                smartFolders={safeSmartFolders}
              />
            </div>
          )}

          {/* Files Ready - Main Focus Area */}
          <div className="surface-panel flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-default pb-0 flex-shrink-0">
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-system-gray-900">Files Ready for Organization</h2>
                {unprocessedFiles.length > 0 && (
                  <span className="px-2.5 py-1 text-xs font-medium bg-stratosort-blue/10 text-stratosort-blue rounded-full">
                    {unprocessedFiles.length} file
                    {unprocessedFiles.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {unprocessedFiles.length > 0 && (
                <button
                  onClick={selectAllFiles}
                  className="text-sm text-stratosort-blue hover:text-stratosort-blue/80 font-medium transition-colors"
                >
                  {selectedFiles.size === unprocessedFiles.length ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>

            <div className="flex-1 min-h-0 p-default overflow-hidden">
              {unprocessedFiles.length === 0 ? (
                <div className="h-full flex items-start justify-start p-default overflow-y-auto modern-scrollbar">
                  <div className="text-left flex flex-col items-start gap-6">
                    <div className="w-16 h-16 rounded-2xl bg-system-gray-100 flex items-center justify-center">
                      {processedFiles.length > 0 ? (
                        <CheckCircle2 className="w-8 h-8 text-stratosort-success" />
                      ) : (
                        <Inbox className="w-8 h-8 text-system-gray-400" />
                      )}
                    </div>
                    <div className="flex flex-col items-start gap-cozy">
                      <p className="text-system-gray-800 font-medium text-lg">
                        {processedFiles.length > 0 ? 'All files organized!' : 'No files ready yet'}
                      </p>
                      <p className="text-system-gray-500 text-sm max-w-md">
                        {processedFiles.length > 0
                          ? 'Click "Organized" above to review your organized files, or return to Discover to add more.'
                          : 'Add files in Discover, run analysis, then return here to organize.'}
                      </p>
                    </div>
                    {processedFiles.length === 0 && (
                      <Button
                        onClick={() => actions.advancePhase(PHASES?.DISCOVER ?? 'discover')}
                        variant="primary"
                        className="mt-0"
                      >
                        ← Go to Discover
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                // FIX M-3: Wrap virtualized grid in error boundary to prevent crashes
                <ErrorBoundaryCore variant="simple" contextName="File Grid">
                  <VirtualizedFileGrid
                    files={unprocessedFiles}
                    selectedFiles={selectedFiles}
                    toggleFileSelection={toggleFileSelection}
                    getFileWithEdits={getFileWithEdits}
                    editingFiles={editingFiles}
                    findSmartFolderForCategory={findSmartFolderForCategory}
                    getFileStateDisplay={getFileStateDisplay}
                    handleEditFile={handleEditFile}
                    smartFolders={safeSmartFolders}
                    defaultLocation={defaultLocation}
                    onViewDetails={setViewingFileDetails}
                  />
                </ErrorBoundaryCore>
              )}
            </div>
          </div>

          {/* Action Area - Sticky at bottom */}
          {unprocessedFiles.length > 0 && (
            <div className="surface-panel p-default flex-shrink-0">
              {/* FIX M-4: Conflict Warning Banner */}
              {organizeConflicts && organizeConflicts.length > 0 && (
                <div className="mb-3 p-3 bg-stratosort-warning/10 border border-stratosort-warning/30 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-stratosort-warning flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-stratosort-warning">
                        Destination Conflicts Detected
                      </p>
                      <p className="text-xs text-system-gray-600 mt-1">
                        {organizeConflicts.reduce((sum, c) => sum + c.files.length, 0)} files would
                        be moved to the same destination. Rename the files below to resolve:
                      </p>
                      <ul className="mt-2 space-y-1 text-xs text-system-gray-700">
                        {organizeConflicts.slice(0, 3).map((conflict, idx) => (
                          <li key={idx} className="flex items-start gap-1">
                            <span className="text-stratosort-warning">•</span>
                            <span className="truncate">
                              <strong>{conflict.files.map((f) => f.fileName).join(', ')}</strong>
                              {' → '}
                              <span className="text-system-gray-500">
                                {conflict.destination.split(/[\\/]/).pop()}
                              </span>
                            </span>
                          </li>
                        ))}
                        {organizeConflicts.length > 3 && (
                          <li className="text-system-gray-500">
                            ...and {organizeConflicts.length - 3} more conflicts
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-system-gray-700 font-medium">
                    Ready to move {readyFilesCount} file
                    {readyFilesCount !== 1 ? 's' : ''}
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
                    onClick={handleOrganizeClick}
                    variant="success"
                    className="text-base px-relaxed py-cozy"
                    disabled={
                      (selectedFiles.size === 0 ? readyFilesCount === 0 : false) || isOrganizing
                    }
                    isLoading={isOrganizing}
                  >
                    {isOrganizing ? (
                      'Organizing...'
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>
                          {selectedFiles.size > 0
                            ? `Organize ${selectedFiles.size} Selected`
                            : 'Organize All Files'}
                        </span>
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="page-action-bar">
          <Button
            onClick={() => actions.advancePhase(PHASES?.DISCOVER ?? 'discover')}
            variant="secondary"
            disabled={isOrganizing}
            className="w-full sm:w-auto"
          >
            ← Back to Discovery
          </Button>
          <Button
            onClick={() => actions.advancePhase(PHASES?.COMPLETE ?? 'complete')}
            disabled={processedFiles.length === 0 || isOrganizing}
            className={`w-full sm:w-auto ${
              processedFiles.length === 0 || isOrganizing ? 'opacity-50 cursor-not-allowed' : ''
            }`}
            title={
              processedFiles.length === 0
                ? 'Process at least one file to view results.'
                : isOrganizing
                  ? 'Finishing current organize operation.'
                  : undefined
            }
          >
            View Results →
          </Button>
        </div>
      </div>

      {/* Analysis Details Modal */}
      <Modal
        isOpen={!!viewingFileDetails}
        onClose={() => setViewingFileDetails(null)}
        title="File Analysis Details"
        size="medium"
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setViewingFileDetails(null)} variant="secondary">
              Close
            </Button>
          </div>
        }
      >
        {viewingFileDetails && viewingFileDetails.analysis && (
          <div className="flex flex-col gap-default">
            <Card variant="compact" className="shadow-sm">
              <div className="space-y-compact">
                <h4 className="text-sm font-medium text-system-gray-900">
                  {viewingFileDetails.name}
                </h4>
                <p className="text-xs text-system-gray-500 break-words">
                  {viewingFileDetails.path}
                </p>
                <AnalysisDetails analysis={viewingFileDetails.analysis} />
              </div>
            </Card>
          </div>
        )}
      </Modal>

      {/* Smart Folders Modal */}
      <Modal
        isOpen={showFoldersModal}
        onClose={() => setShowFoldersModal(false)}
        title="Target Smart Folders"
        size="large"
      >
        <div className="flex flex-col gap-default">
          <p className="text-sm text-system-gray-600">
            Files will be organized into these destination folders based on their content.
          </p>
          <div className="max-h-[60vh] overflow-y-auto modern-scrollbar">
            <TargetFolderList folders={safeSmartFolders} defaultLocation={defaultLocation} />
          </div>
          <div className="flex justify-end pt-default border-t border-border-soft">
            <Button onClick={() => setShowFoldersModal(false)} variant="secondary">
              Close
            </Button>
          </div>
        </div>
      </Modal>

      {/* Status Overview Modal */}
      <Modal
        isOpen={showStatusModal}
        onClose={() => setShowStatusModal(false)}
        title={
          <span className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-stratosort-blue" />
            File Status Overview
          </span>
        }
        size="medium"
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setShowStatusModal(false)} variant="secondary">
              Close
            </Button>
          </div>
        }
      >
        <StatusOverview
          unprocessedCount={unprocessedFiles.length}
          processedCount={processedFiles.length}
          failedCount={failedCount}
        />
      </Modal>

      {/* Previously Organized Files Modal */}
      <Modal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        title="Previously Organized Files"
        size="large"
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setShowHistoryModal(false)} variant="secondary">
              Close
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-default">
          <p className="text-sm text-system-gray-600">
            {processedFiles.length} file
            {processedFiles.length !== 1 ? 's have' : ' has'} been successfully organized.
          </p>
          <div className="max-h-[60vh] overflow-y-auto modern-scrollbar">
            {/* FIX M-3: Wrap virtualized list in error boundary */}
            <ErrorBoundaryCore variant="simple" contextName="Processed Files">
              <VirtualizedProcessedFiles files={processedFiles} />
            </ErrorBoundaryCore>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default OrganizePhase;
