/**
 * OrganizePhase Component
 *
 * Review and organize analyzed files into smart folders.
 * Refactored to use decomposed hooks for better maintainability.
 *
 * @module phases/OrganizePhase
 */

import React, { useMemo, useCallback, useEffect, useRef } from 'react';
import { PHASES } from '../../shared/constants';
import { logger } from '../../shared/logger';
import { useNotification } from '../contexts/NotificationContext';
import { Collapsible, Button } from '../components/ui';
import {
  StatusOverview,
  TargetFolderList,
  BulkOperations,
  OrganizeProgress,
  VirtualizedFileGrid,
  VirtualizedProcessedFiles,
} from '../components/organize';
import { UndoRedoToolbar, useUndoRedo } from '../components/UndoRedoSystem';
import Modal from '../components/Modal';
import AnalysisDetails from '../components/AnalysisDetails';
// Import decomposed hooks
import {
  useOrganizeState,
  useLoadInitialData,
} from './organize/useOrganizeState';
import { useSmartFolderMatcher } from './organize/useSmartFolderMatcher';
import {
  useFileStateDisplay,
  useFileEditing,
  useFileSelection,
  useBulkOperations,
  useProcessedFiles,
} from './organize/useFileEditing';
import { useOrganization } from './organize/useOrganization';
import { setFileStates as setFileStatesAction } from '../store/slices/filesSlice';

logger.setContext('OrganizePhase');

function OrganizePhase() {
  const { addNotification } = useNotification();
  const { executeAction } = useUndoRedo();
  const [viewingFileDetails, setViewingFileDetails] = React.useState(null);

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
    setOrganizingState,
    phaseData,
    actions,
  } = useOrganizeState();

  // Load initial data
  const addNotificationRef = useRef(addNotification);
  useEffect(() => {
    addNotificationRef.current = addNotification;
  }, [addNotification]);

  useLoadInitialData(
    { smartFoldersRef, dispatchRef },
    addNotificationRef.current,
  );

  // File state display
  const { getFileStateDisplay } = useFileStateDisplay(fileStates);

  // File editing
  const { editingFiles, setEditingFiles, handleEditFile, getFileWithEdits } =
    useFileEditing();

  // Processed files tracking
  const {
    setProcessedFileIds,
    markFilesAsProcessed,
    unmarkFilesAsProcessed,
    getFilteredFiles,
  } = useProcessedFiles(organizedFiles);

  // Compute filtered files
  const { unprocessedFiles, processedFiles } = useMemo(
    () => getFilteredFiles(filesWithAnalysis),
    [getFilteredFiles, filesWithAnalysis],
  );

  // File selection
  const {
    selectedFiles,
    setSelectedFiles,
    toggleFileSelection,
    selectAllFiles,
  } = useFileSelection(unprocessedFiles.length);

  // Bulk operations
  const {
    bulkEditMode,
    setBulkEditMode,
    bulkCategory,
    setBulkCategory,
    applyBulkCategoryChange,
  } = useBulkOperations({
    selectedFiles,
    editingFiles,
    setEditingFiles,
    setSelectedFiles,
    addNotification,
  });

  // Smart folder matcher
  const findSmartFolderForCategory = useSmartFolderMatcher(smartFolders);

  // Organization logic
  const { isOrganizing, batchProgress, organizePreview, handleOrganizeFiles } =
    useOrganization({
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
    });

  // Load persisted data once on mount
  const hasLoadedPersistedDataRef = useRef(false);

  useEffect(() => {
    if (hasLoadedPersistedDataRef.current) {
      return;
    }
    hasLoadedPersistedDataRef.current = true;

    const loadPersistedData = () => {
      const persistedStates = fileStates || {};

      if (
        analysisResults.length === 0 &&
        Object.keys(persistedStates).length > 0
      ) {
        dispatch(setFileStatesAction({}));
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
        dispatch(setFileStatesAction(reconstructedStates));
      }
      const previouslyOrganized = organizedFiles || [];
      const processedIds = new Set(
        previouslyOrganized.map((file) => file.originalPath || file.path),
      );
      setProcessedFileIds(processedIds);
    };
    loadPersistedData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount - uses current Redux state snapshot intentionally

  const isAnalysisRunning = isAnalyzing || false;
  const analysisProgressFromDiscover = analysisProgress || {
    current: 0,
    total: 0,
  };

  const readyFilesCount = useMemo(
    () => unprocessedFiles.filter((f) => f.analysis).length,
    [unprocessedFiles],
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
  }, [
    selectedFiles,
    unprocessedFiles,
    addNotification,
    handleOrganizeFiles,
    setSelectedFiles,
  ]);

  return (
    <div className="organize-page min-h-[calc(100vh-var(--app-nav-height))] w-full overflow-auto modern-scrollbar pb-8 bg-white">
      <div className="container-responsive gap-4 py-4 flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between flex-shrink-0">
          <div className="space-y-2">
            <h1 className="heading-primary">📂 Review & Organize</h1>
            <p className="text-base text-system-gray-600 leading-relaxed max-w-2xl">
              Inspect suggestions, fine-tune smart folders, and execute the
              batch once you&apos;re ready.
            </p>
            {isAnalysisRunning && (
              <div className="flex items-center gap-3 rounded-2xl border border-stratosort-blue/30 bg-stratosort-blue/5 px-4 py-3 text-sm text-stratosort-blue">
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
        <div className="flex-1 min-h-0 flex flex-col gap-4">
          {smartFolders.length > 0 && (
            <Collapsible
              title="📁 Target Smart Folders"
              defaultOpen={false}
              persistKey="organize-target-folders"
              contentClassName="p-[var(--panel-padding)] panel-scroll max-h-[45vh] min-h-[180px]"
              className="surface-panel"
              collapsedPreview={
                <div className="text-sm text-system-gray-600 py-1">
                  {smartFolders.length} folder
                  {smartFolders.length !== 1 ? 's' : ''} configured
                </div>
              }
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
              className="surface-panel"
              collapsedPreview={
                <div className="text-sm text-system-gray-600 py-1">
                  {unprocessedFiles.length} ready • {processedFiles.length}{' '}
                  organized • {failedCount} failed
                </div>
              }
            >
              <StatusOverview
                unprocessedCount={unprocessedFiles.length}
                processedCount={processedFiles.length}
                failedCount={failedCount}
              />
            </Collapsible>
          )}
          {unprocessedFiles.length > 0 && (
            <Collapsible
              title="Bulk Operations"
              defaultOpen
              persistKey="organize-bulk"
              className="surface-panel"
              collapsedPreview={
                <div className="text-sm text-system-gray-600 py-1">
                  {selectedFiles.size > 0
                    ? `${selectedFiles.size} files selected`
                    : 'Select files to perform bulk actions'}
                </div>
              }
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
              title="Previously Organized Files"
              defaultOpen={false}
              persistKey="organize-history"
              contentClassName="p-[var(--panel-padding)]"
              className="surface-panel"
              collapsedPreview={
                <div className="text-sm text-system-gray-600 py-1">
                  {processedFiles.length} file
                  {processedFiles.length !== 1 ? 's' : ''} organized
                </div>
              }
            >
              <div className="panel-scroll max-h-[320px]">
                <VirtualizedProcessedFiles files={processedFiles} />
              </div>
            </Collapsible>
          )}

          {/* Files Ready */}
          <Collapsible
            title="Files Ready for Organization"
            defaultOpen
            persistKey="organize-ready-list"
            className="surface-panel flex-1"
            contentClassName="p-4 flex flex-col min-h-[300px] max-h-[55vh] panel-scroll"
            collapsedPreview={
              <div className="text-sm text-system-gray-600 py-1">
                {unprocessedFiles.length > 0
                  ? `${unprocessedFiles.length} file${unprocessedFiles.length !== 1 ? 's' : ''} ready for organization`
                  : processedFiles.length > 0
                    ? 'All files have been organized'
                    : 'No files ready yet'}
              </div>
            }
          >
            {unprocessedFiles.length === 0 ? (
              <div className="text-center py-12 space-y-4">
                <div className="text-4xl">
                  {processedFiles.length > 0 ? '✅' : '📭'}
                </div>
                <div className="space-y-2">
                  <p className="text-system-gray-800 font-medium">
                    {processedFiles.length > 0
                      ? 'Everything here is organized.'
                      : 'No files ready to organize yet.'}
                  </p>
                  <p className="text-system-gray-500 text-sm">
                    {processedFiles.length > 0
                      ? 'Review organized files below or return to Discover to add more.'
                      : 'Add files in Discover, run analysis, then return here to organize.'}
                  </p>
                </div>
                {processedFiles.length === 0 && (
                  <Button
                    onClick={() => actions.advancePhase(PHASES.DISCOVER)}
                    variant="primary"
                    className="mt-2"
                  >
                    ← Go Back to Select Files
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex-1 min-h-0">
                <VirtualizedFileGrid
                  files={unprocessedFiles}
                  selectedFiles={selectedFiles}
                  toggleFileSelection={toggleFileSelection}
                  getFileWithEdits={getFileWithEdits}
                  editingFiles={editingFiles}
                  findSmartFolderForCategory={findSmartFolderForCategory}
                  getFileStateDisplay={getFileStateDisplay}
                  handleEditFile={handleEditFile}
                  smartFolders={smartFolders}
                  defaultLocation={defaultLocation}
                />
              </div>
            )}
          </Collapsible>

          {/* Action Area */}
          {unprocessedFiles.length > 0 && (
            <div className="surface-panel p-[var(--panel-padding)] flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-system-gray-600 font-medium">
                    Ready to move {readyFilesCount} files
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
                    className="text-base px-6 py-3"
                    disabled={readyFilesCount === 0 || isOrganizing}
                    isLoading={isOrganizing}
                  >
                    {isOrganizing ? 'Organizing...' : '✨ Organize Files Now'}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between flex-shrink-0 mt-auto pt-4 border-t border-system-gray-200/50">
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
      >
        {viewingFileDetails && viewingFileDetails.analysis && (
          <div className="space-y-4">
            <div className="bg-system-gray-50 p-4 rounded-lg border border-border-soft">
              <h4 className="text-sm font-medium text-system-gray-900 mb-1">
                {viewingFileDetails.name}
              </h4>
              <p className="text-xs text-system-gray-500 truncate">
                {viewingFileDetails.path}
              </p>
            </div>
            <AnalysisDetails analysis={viewingFileDetails.analysis} />
            <div className="flex justify-end pt-4">
              <Button
                onClick={() => setViewingFileDetails(null)}
                variant="secondary"
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default OrganizePhase;
