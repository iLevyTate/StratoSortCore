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
import { Button, Card } from '../components/ui';

// Inline SVG Icons
const FolderOpenIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
  </svg>
);

const BarChart3Icon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

const CheckCircle2Icon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const InboxIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
  </svg>
);

const FileStackIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
  </svg>
);

const SparklesIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
  </svg>
);
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
  }, [analysisResults, dispatch, fileStates, organizedFiles]);

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
    <div className="organize-page phase-container bg-white" style={{ paddingBottom: 'var(--spacing-spacious)' }}>
      <div className="container-responsive flex flex-col flex-1 min-h-0" style={{ gap: 'var(--spacing-default)', paddingTop: 'var(--spacing-default)', paddingBottom: 'var(--spacing-default)' }}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between flex-shrink-0" style={{ gap: 'var(--spacing-cozy)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-compact)' }}>
            <h1 className="heading-primary flex items-center gap-3">
              <FileStackIcon className="w-7 h-7 text-stratosort-blue" />
              Review & Organize
            </h1>
            <p className="text-base text-system-gray-600 leading-relaxed max-w-2xl">
              Inspect suggestions, fine-tune smart folders, and execute the
              batch once you&apos;re ready.
            </p>
            {isAnalysisRunning && (
              <div className="flex items-center border border-stratosort-blue/30 bg-stratosort-blue/5 text-sm text-stratosort-blue" style={{ gap: 'var(--spacing-cozy)', borderRadius: 'var(--radius-lg)', padding: 'var(--spacing-cozy) var(--spacing-default)' }}>
                <span className="loading-spinner h-5 w-5 border-t-transparent" />
                Analysis continuing in background:{' '}
                {analysisProgressFromDiscover.current}/
                {analysisProgressFromDiscover.total} files
              </div>
            )}
          </div>
          <UndoRedoToolbar className="flex-shrink-0" />
        </div>

        {/* Quick Access Toolbar - Open modals for secondary info */}
        <div className="flex items-center flex-wrap gap-2 flex-shrink-0">
          {smartFolders.length > 0 && (
            <button
              onClick={() => setShowFoldersModal(true)}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-system-gray-700 bg-white/80 border border-border-soft rounded-xl hover:bg-white hover:border-stratosort-blue/30 hover:text-stratosort-blue transition-colors"
            >
              <FolderOpenIcon className="w-4 h-4" />
              <span>{smartFolders.length} Smart Folders</span>
            </button>
          )}
          <button
            onClick={() => setShowStatusModal(true)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-system-gray-700 bg-white/80 border border-border-soft rounded-xl hover:bg-white hover:border-stratosort-blue/30 hover:text-stratosort-blue transition-colors"
          >
            <BarChart3Icon className="w-4 h-4" />
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
            >
              <CheckCircle2Icon className="w-4 h-4" />
              <span>{processedFiles.length} Organized</span>
            </button>
          )}
        </div>

        {/* Main Content - Files Ready for Organization takes primary focus */}
        <div className="flex-1 min-h-0 flex flex-col" style={{ gap: 'var(--spacing-default)' }}>
          {/* Inline Bulk Operations when files selected */}
          {unprocessedFiles.length > 0 && selectedFiles.size > 0 && (
            <div className="surface-panel p-[var(--panel-padding)] flex-shrink-0">
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
            </div>
          )}

          {/* Files Ready - Main Focus Area */}
          <div className="surface-panel flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-[var(--panel-padding)] pb-0 flex-shrink-0">
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-system-gray-900">
                  Files Ready for Organization
                </h2>
                {unprocessedFiles.length > 0 && (
                  <span className="px-2.5 py-1 text-xs font-medium bg-stratosort-blue/10 text-stratosort-blue rounded-full">
                    {unprocessedFiles.length} file{unprocessedFiles.length !== 1 ? 's' : ''}
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

            <div className="flex-1 min-h-0 p-[var(--panel-padding)] overflow-y-auto modern-scrollbar">
              {unprocessedFiles.length === 0 ? (
                <div className="h-full flex items-start justify-start p-[var(--panel-padding)]">
                  <div className="text-left flex flex-col items-start gap-[var(--spacing-default)]">
                    <div className="w-16 h-16 rounded-2xl bg-system-gray-100 flex items-center justify-center">
                      {processedFiles.length > 0 ? (
                        <CheckCircle2Icon className="w-8 h-8 text-stratosort-success" />
                      ) : (
                        <InboxIcon className="w-8 h-8 text-system-gray-400" />
                      )}
                    </div>
                    <div className="flex flex-col items-start gap-[var(--spacing-compact)]">
                      <p className="text-system-gray-800 font-medium text-lg">
                        {processedFiles.length > 0
                          ? 'All files organized!'
                          : 'No files ready yet'}
                      </p>
                      <p className="text-system-gray-500 text-sm max-w-md">
                        {processedFiles.length > 0
                          ? 'Click "Organized" above to review your organized files, or return to Discover to add more.'
                          : 'Add files in Discover, run analysis, then return here to organize.'}
                      </p>
                    </div>
                    {processedFiles.length === 0 && (
                      <Button
                        onClick={() => actions.advancePhase(PHASES.DISCOVER)}
                        variant="primary"
                        style={{ marginTop: 'var(--spacing-cozy)' }}
                      >
                        ← Go to Discover
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
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
                  onViewDetails={setViewingFileDetails}
                />
              )}
            </div>
          </div>

          {/* Action Area - Sticky at bottom */}
          {unprocessedFiles.length > 0 && (
            <div className="surface-panel p-[var(--panel-padding)] flex-shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-system-gray-700 font-medium">
                    Ready to move {readyFilesCount} file{readyFilesCount !== 1 ? 's' : ''}
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
                    className="text-base"
                    style={{ padding: 'var(--spacing-cozy) var(--spacing-relaxed)' }}
                    disabled={readyFilesCount === 0 || isOrganizing}
                    isLoading={isOrganizing}
                  >
                    {isOrganizing ? 'Organizing...' : <><SparklesIcon className="w-4 h-4 mr-1.5 inline" /> Organize Files Now</>}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between flex-shrink-0 mt-auto border-t border-system-gray-200/50" style={{ gap: 'var(--spacing-cozy)', paddingTop: 'var(--spacing-default)' }}>
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
          <div className="flex flex-col gap-[var(--spacing-default)]">
            <Card variant="compact" className="shadow-sm">
              <div className="space-y-[var(--spacing-compact)]">
                <h4 className="text-sm font-medium text-system-gray-900">
                  {viewingFileDetails.name}
                </h4>
                <p className="text-xs text-system-gray-500 break-words">
                  {viewingFileDetails.path}
                </p>
                <AnalysisDetails analysis={viewingFileDetails.analysis} />
              </div>
            </Card>
            <div className="flex justify-end" style={{ paddingTop: 'var(--spacing-default)' }}>
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

      {/* Smart Folders Modal */}
      <Modal
        isOpen={showFoldersModal}
        onClose={() => setShowFoldersModal(false)}
        title="📁 Target Smart Folders"
        size="large"
      >
        <div className="flex flex-col gap-[var(--spacing-default)]">
          <p className="text-sm text-system-gray-600">
            Files will be organized into these destination folders based on their content.
          </p>
          <div className="max-h-[60vh] overflow-y-auto modern-scrollbar">
            <TargetFolderList
              folders={smartFolders}
              defaultLocation={defaultLocation}
            />
          </div>
          <div className="flex justify-end pt-[var(--spacing-default)] border-t border-border-soft">
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
        title="📊 File Status Overview"
        size="medium"
      >
        <div className="flex flex-col gap-[var(--spacing-default)]">
          <StatusOverview
            unprocessedCount={unprocessedFiles.length}
            processedCount={processedFiles.length}
            failedCount={failedCount}
          />
          <div className="flex justify-end pt-[var(--spacing-default)] border-t border-border-soft">
            <Button onClick={() => setShowStatusModal(false)} variant="secondary">
              Close
            </Button>
          </div>
        </div>
      </Modal>

      {/* Previously Organized Files Modal */}
      <Modal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        title="Previously Organized Files"
        size="large"
      >
        <div className="flex flex-col gap-[var(--spacing-default)]">
          <p className="text-sm text-system-gray-600">
            {processedFiles.length} file{processedFiles.length !== 1 ? 's have' : ' has'} been successfully organized.
          </p>
          <div className="max-h-[60vh] overflow-y-auto modern-scrollbar">
            <VirtualizedProcessedFiles files={processedFiles} />
          </div>
          <div className="flex justify-end pt-[var(--spacing-default)] border-t border-border-soft">
            <Button onClick={() => setShowHistoryModal(false)} variant="secondary">
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default OrganizePhase;
