import React, { useMemo, useCallback, useEffect, useRef } from 'react';
import { PHASES } from '../../shared/constants';
import { logger } from '../../shared/logger';
import { useNotification } from '../contexts/NotificationContext';
import { useAppSelector } from '../store/hooks';
import { Button, Card, StateMessage } from '../components/ui';
import { Heading, Text } from '../components/ui/Typography';
import { ErrorBoundaryCore } from '../components/ErrorBoundary';
import { FolderOpen, BarChart3, CheckCircle2, Inbox, Sparkles, AlertTriangle } from 'lucide-react';
import { ActionBar, Inline, Stack } from '../components/layout';
import {
  StatusOverview,
  TargetFolderList,
  BulkOperations,
  OrganizeProgress,
  VirtualizedFileGrid,
  VirtualizedProcessedFiles
} from '../components/organize';
import { UndoRedoToolbar, useUndoRedo } from '../components/UndoRedoSystem';
import Modal from '../components/ui/Modal';
import AnalysisDetails from '../components/AnalysisDetails';
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
  const redactPaths = useAppSelector((state) => Boolean(state?.system?.redactPaths));

  const [showFoldersModal, setShowFoldersModal] = React.useState(false);
  const [showStatusModal, setShowStatusModal] = React.useState(false);
  const [showHistoryModal, setShowHistoryModal] = React.useState(false);

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

  const addNotificationRef = useRef(addNotification);
  useEffect(() => {
    addNotificationRef.current = addNotification;
  }, [addNotification]);

  useLoadInitialData({ smartFoldersRef, dispatchRef }, addNotificationRef.current);

  const { getFileStateDisplay } = useFileStateDisplay(fileStates);

  const {
    setProcessedFileIds,
    markFilesAsProcessed,
    unmarkFilesAsProcessed,
    getFilteredFiles,
    normalizePath
  } = useProcessedFiles(organizedFiles);

  useEffect(() => {
    if (!organizedFiles || organizedFiles.length === 0) {
      setProcessedFileIds(new Set());
    } else {
      setProcessedFileIds(
        new Set(
          organizedFiles
            .filter((f) => f?.originalPath || f?.path)
            .map((f) => normalizePath(f?.originalPath || f?.path))
        )
      );
    }
  }, [organizedFiles, setProcessedFileIds, normalizePath]);

  const { unprocessedFiles: baseUnprocessedFiles, processedFiles } = useMemo(() => {
    return getFilteredFiles(filesWithAnalysis);
  }, [getFilteredFiles, filesWithAnalysis]);

  const { editingFiles, setEditingFiles, handleEditFile, getFileWithEdits } = useFileEditing({
    onEditChange: useCallback(
      (index, field, value) => {
        const file = baseUnprocessedFiles[index];
        if (file && file.path) {
          if (field === 'category') {
            dispatch(updateAnalysisResult({ path: file.path, changes: { category: value } }));
          }
          if (field === 'suggestedName') {
            dispatch(updateAnalysisResult({ path: file.path, changes: { suggestedName: value } }));
          }
        }
      },
      [baseUnprocessedFiles, dispatch]
    )
  });

  const { selectedFiles, setSelectedFiles, toggleFileSelection, selectAllFiles } = useFileSelection(
    baseUnprocessedFiles.length
  );

  const { bulkEditMode, setBulkEditMode, bulkCategory, setBulkCategory, applyBulkCategoryChange } =
    useBulkOperations({
      selectedFiles,
      editingFiles,
      setEditingFiles,
      setSelectedFiles,
      addNotification
    });

  const findSmartFolderForCategory = useSmartFolderMatcher(safeSmartFolders);

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
      dispatch,
      setOrganizedFiles,
      addOrganizedFiles,
      removeOrganizedFiles,
      setOrganizingState
    });

  const filesBeingOrganized = useMemo(() => {
    if (!isOrganizing || !organizePreview || organizePreview.length === 0) return new Set();
    return new Set(organizePreview.map((item) => normalizePath(item.sourcePath)));
  }, [isOrganizing, organizePreview, normalizePath]);

  const unprocessedFiles = useMemo(() => {
    if (isOrganizing && filesBeingOrganized.size > 0) {
      return baseUnprocessedFiles.filter((f) => !filesBeingOrganized.has(normalizePath(f.path)));
    }
    return baseUnprocessedFiles;
  }, [baseUnprocessedFiles, isOrganizing, filesBeingOrganized, normalizePath]);

  useEffect(() => {
    const handleBatchResultsChunk = (event) => {
      const { results, chunk, total } = event.detail || {};
      if (results && Array.isArray(results)) {
        logger.debug('[OrganizePhase] Received batch results chunk', {
          chunk,
          total,
          resultCount: results.length
        });
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

  const handleOrganizeClick = useCallback(() => {
    if (selectedFiles.size > 0) {
      approveSelectedFiles();
    } else {
      handleOrganizeFiles();
    }
  }, [selectedFiles.size, approveSelectedFiles, handleOrganizeFiles]);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-6 lg:gap-8 pb-6">
      {/* Header */}
      <Stack className="text-center flex-shrink-0" gap="compact">
        <Heading as="h1" variant="display">
          Review & <span className="text-gradient">Organize</span>
        </Heading>
        <Text variant="lead" className="max-w-xl mx-auto">
          Inspect suggestions, fine-tune smart folders, and execute the batch once you&apos;re
          ready.
        </Text>
        {isAnalysisRunning && (
          <div className="flex items-center justify-center gap-2 mt-2">
            <div className="flex items-center border border-stratosort-blue/30 bg-stratosort-blue/5 text-sm text-stratosort-blue gap-2 rounded-lg px-3 py-1.5">
              <span className="loading-spinner h-4 w-4 border-t-transparent" />
              Analysis continuing in background: {analysisProgressFromDiscover.current}/
              {analysisProgressFromDiscover.total} files
            </div>
          </div>
        )}
      </Stack>

      {/* Toolbar */}
      <Inline className="justify-between" gap="cozy">
        <Inline
          className="flex-shrink-0"
          role="toolbar"
          aria-label="Organization tools"
          gap="default"
        >
          {safeSmartFolders.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowFoldersModal(true)}
              className="gap-2"
              aria-label={`View ${safeSmartFolders.length} smart folders`}
            >
              <FolderOpen className="w-4 h-4" aria-hidden="true" />
              <span>{safeSmartFolders.length} Smart Folders</span>
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowStatusModal(true)}
            className="gap-2"
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
          </Button>
          {processedFiles.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowHistoryModal(true)}
              className="gap-2 text-stratosort-success border-stratosort-success/20 bg-stratosort-success/5 hover:bg-stratosort-success/10 hover:border-stratosort-success/40"
              aria-label={`View ${processedFiles.length} organized files history`}
            >
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              <span>{processedFiles.length} Organized</span>
            </Button>
          )}
        </Inline>
        <UndoRedoToolbar className="flex-shrink-0" />
      </Inline>

      {/* Main Content */}
      <Stack className="flex-1 min-h-0" gap="relaxed">
        {/* Inline Bulk Operations */}
        {unprocessedFiles.length > 0 && selectedFiles.size > 0 && (
          <Card className="flex-shrink-0 p-4">
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
              isProcessing={isOrganizing}
            />
          </Card>
        )}

        {/* Files Ready - Main Focus Area */}
        <Card className="flex-1 min-h-0 flex flex-col overflow-hidden p-0">
          <div className="flex items-center justify-between p-4 border-b border-border-soft/70 bg-white/50 flex-shrink-0">
            <div className="flex items-center gap-3">
              <Heading as="h2" variant="h5">
                Files Ready for Organization
              </Heading>
              {unprocessedFiles.length > 0 && (
                <Text
                  as="span"
                  variant="tiny"
                  className="px-2.5 py-1 font-medium bg-stratosort-blue/10 text-stratosort-blue rounded-full"
                >
                  {unprocessedFiles.length} file{unprocessedFiles.length !== 1 ? 's' : ''}
                </Text>
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

          <div className="flex-1 min-h-0 bg-system-gray-50/30 overflow-hidden">
            {unprocessedFiles.length === 0 ? (
              <div className="h-full flex items-center justify-center p-8">
                <StateMessage
                  icon={processedFiles.length > 0 ? CheckCircle2 : Inbox}
                  tone={processedFiles.length > 0 ? 'success' : 'neutral'}
                  title={processedFiles.length > 0 ? 'All files organized!' : 'No files ready yet'}
                  description={
                    processedFiles.length > 0
                      ? 'Click "Organized" above to review your organized files, or return to Discover to add more.'
                      : 'Add files in Discover, run analysis, then return here to organize.'
                  }
                  action={
                    processedFiles.length === 0 ? (
                      <Button
                        onClick={() => actions.advancePhase(PHASES?.DISCOVER ?? 'discover')}
                        variant="primary"
                      >
                        ← Go to Discover
                      </Button>
                    ) : null
                  }
                  size="lg"
                  contentClassName="max-w-md"
                />
              </div>
            ) : (
              <div className="flex-1 min-h-0 p-4">
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
              </div>
            )}
          </div>
        </Card>

        {/* Action Area - Sticky at bottom */}
        {unprocessedFiles.length > 0 && (
          <Card className="flex-shrink-0 p-4 border-t-4 border-t-stratosort-blue/10">
            {organizeConflicts && organizeConflicts.length > 0 && (
              <div className="mb-4 p-3 bg-stratosort-warning/10 border border-stratosort-warning/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-stratosort-warning flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <Text variant="small" className="font-medium text-stratosort-warning">
                      Destination Conflicts Detected
                    </Text>
                    <Text variant="tiny" className="text-system-gray-600 mt-1">
                      {organizeConflicts.reduce((sum, c) => sum + c.files.length, 0)} files would be
                      moved to the same destination. Rename the files below to resolve:
                    </Text>
                    <ul className="mt-2 space-y-1 text-system-gray-700">
                      {organizeConflicts.slice(0, 3).map((conflict, idx) => (
                        <li key={idx} className="flex items-start gap-1">
                          <span className="text-stratosort-warning">•</span>
                          <Text as="span" variant="tiny" className="truncate">
                            <strong>{conflict.files.map((f) => f.fileName).join(', ')}</strong>
                            {' → '}
                            <span className="text-system-gray-500">
                              {conflict.destination.split(/[\\/]/).pop()}
                            </span>
                          </Text>
                        </li>
                      ))}
                      {organizeConflicts.length > 3 && (
                        <li>
                          <Text variant="tiny" className="text-system-gray-500">
                            ...and {organizeConflicts.length - 3} more conflicts
                          </Text>
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <div>
                <Text variant="body" className="font-medium text-system-gray-700">
                  Ready to move {readyFilesCount} file{readyFilesCount !== 1 ? 's' : ''}
                </Text>
                <Text variant="tiny" className="text-system-gray-500">
                  You can undo this operation if needed
                </Text>
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
                  size="md"
                  className="px-6"
                  disabled={
                    (selectedFiles.size === 0 ? readyFilesCount === 0 : false) || isOrganizing
                  }
                  isLoading={isOrganizing}
                >
                  {isOrganizing ? (
                    'Organizing...'
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5 mr-2" />
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
          </Card>
        )}
      </Stack>

      {/* Footer Buttons */}
      <ActionBar>
        <Button
          onClick={() => actions.advancePhase(PHASES?.DISCOVER ?? 'discover')}
          variant="secondary"
          disabled={isOrganizing}
          size="md"
          className="w-full sm:w-auto min-w-[180px]"
        >
          ← Back to Discovery
        </Button>
        <Button
          onClick={() => actions.advancePhase(PHASES?.COMPLETE ?? 'complete')}
          disabled={processedFiles.length === 0 || isOrganizing}
          size="md"
          className="w-full sm:w-auto min-w-[180px]"
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
      </ActionBar>

      {/* Analysis Details Modal */}
      <Modal
        isOpen={!!viewingFileDetails}
        onClose={() => setViewingFileDetails(null)}
        title="File Analysis Details"
        size="md"
        footer={
          <Inline className="justify-end" gap="default" wrap={false}>
            <Button onClick={() => setViewingFileDetails(null)} variant="secondary" size="sm">
              Close
            </Button>
          </Inline>
        }
      >
        {viewingFileDetails && viewingFileDetails.analysis && (
          <Stack gap="default">
            <div className="bg-system-gray-50 p-3 rounded-lg border border-border-soft">
              <Text variant="small" className="font-medium text-system-gray-900 break-all">
                {viewingFileDetails.name}
              </Text>
            </div>
            <AnalysisDetails
              analysis={viewingFileDetails.analysis}
              filePath={viewingFileDetails.path}
              redactPaths={redactPaths}
            />
          </Stack>
        )}
      </Modal>

      {/* Smart Folders Modal */}
      <Modal
        isOpen={showFoldersModal}
        onClose={() => setShowFoldersModal(false)}
        title="Target Smart Folders"
        size="lg"
        footer={
          <Inline className="justify-end" gap="default" wrap={false}>
            <Button onClick={() => setShowFoldersModal(false)} variant="secondary" size="sm">
              Close
            </Button>
          </Inline>
        }
      >
        <Stack gap="default" className="h-full">
          <Text variant="small" className="text-system-gray-600">
            Files will be organized into these destination folders based on their content.
          </Text>
          <div className="flex-1 min-h-0 overflow-y-auto modern-scrollbar -mx-6 px-6">
            <TargetFolderList folders={safeSmartFolders} defaultLocation={defaultLocation} />
          </div>
        </Stack>
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
        size="md"
        footer={
          <Inline className="justify-end" gap="default" wrap={false}>
            <Button onClick={() => setShowStatusModal(false)} variant="secondary" size="sm">
              Close
            </Button>
          </Inline>
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
        size="lg"
        footer={
          <Inline className="justify-end" gap="default" wrap={false}>
            <Button onClick={() => setShowHistoryModal(false)} variant="secondary" size="sm">
              Close
            </Button>
          </Inline>
        }
      >
        <Stack gap="default" className="h-full">
          <Text variant="small" className="text-system-gray-600">
            {processedFiles.length} file
            {processedFiles.length !== 1 ? 's have' : ' has'} been successfully organized.
          </Text>
          <div className="flex-1 min-h-0 overflow-y-auto modern-scrollbar -mx-6 px-6">
            <ErrorBoundaryCore variant="simple" contextName="Processed Files">
              <VirtualizedProcessedFiles files={processedFiles} />
            </ErrorBoundaryCore>
          </div>
        </Stack>
      </Modal>
    </div>
  );
}

export default OrganizePhase;
