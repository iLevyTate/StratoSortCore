/**
 * DiscoverPhase Component
 *
 * Main discover phase component for file selection and AI analysis.
 * Hooks and utilities extracted to phases/discover/ for maintainability.
 *
 * @module phases/DiscoverPhase
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { PHASES } from '../../shared/constants';
import { TIMEOUTS } from '../../shared/performanceConstants';
import { logger } from '../../shared/logger';
import { useNotification } from '../contexts/NotificationContext';
import { useConfirmDialog, useDragAndDrop, useSettingsSubscription } from '../hooks';
import { Button } from '../components/ui';
import { FolderOpenIcon, SettingsIcon } from '../components/icons';
import {
  NamingSettingsModal,
  SelectionControls,
  AnalysisResultsList,
  AnalysisProgress
} from '../components/discover';
import { FileListSkeleton } from '../components/LoadingSkeleton';

// Extracted hooks and utilities
import {
  useDiscoverState,
  useAnalysis,
  useFileHandlers,
  useFileActions,
  getFileStateDisplayInfo
} from './discover';

logger.setContext('DiscoverPhase');

function DiscoverPhase() {
  // Redux state management hook
  const {
    selectedFiles,
    analysisResults,
    isAnalyzing,
    analysisProgress,
    currentAnalysisFile,
    fileStates,
    namingConvention,
    dateFormat,
    caseConvention,
    separator,
    namingSettings,
    setSelectedFiles,
    setAnalysisResults,
    setIsAnalyzing,
    setAnalysisProgress,
    setCurrentAnalysisFile,
    setNamingConvention,
    setDateFormat,
    setCaseConvention,
    setSeparator,
    setFileStates,
    updateFileState,
    resetAnalysisState,
    actions,
    readySelectedFilesCount,
    getCurrentPhase
  } = useDiscoverState();

  const { addNotification } = useNotification();
  const { showConfirm, ConfirmDialog } = useConfirmDialog();

  // Local UI state
  const [showNamingSettings, setShowNamingSettings] = useState(false);
  const [totalAnalysisFailure, setTotalAnalysisFailure] = useState(false);

  // Refs for analysis state
  const hasResumedRef = useRef(false);

  // Filter out results for files no longer selected (e.g., moved/cleared)
  const selectedPaths = useMemo(
    () => new Set((selectedFiles || []).map((f) => f.path)),
    [selectedFiles]
  );

  const visibleAnalysisResults = useMemo(
    () => (analysisResults || []).filter((result) => selectedPaths.has(result.path)),
    [analysisResults, selectedPaths]
  );

  const visibleReadyCount = useMemo(
    () => visibleAnalysisResults.filter((r) => r.analysis && !r.error).length,
    [visibleAnalysisResults]
  );

  const visibleFailedCount = useMemo(
    () => visibleAnalysisResults.filter((r) => r.error).length,
    [visibleAnalysisResults]
  );

  // Build phaseData for compatibility
  const phaseData = {
    selectedFiles,
    analysisResults,
    isAnalyzing,
    analysisProgress,
    currentAnalysisFile,
    fileStates,
    namingConvention: {
      convention: namingConvention,
      dateFormat,
      caseConvention,
      separator
    },
    totalAnalysisFailure
  };

  // Extended actions with totalAnalysisFailure setter
  const extendedActions = useMemo(
    () => ({
      ...actions,
      setPhaseData: (key, value) => {
        if (key === 'totalAnalysisFailure') {
          setTotalAnalysisFailure(value);
        } else {
          actions.setPhaseData(key, value);
        }
      }
    }),
    [actions]
  );

  // Analysis hook
  const { analyzeFiles, cancelAnalysis, clearAnalysisQueue } = useAnalysis({
    selectedFiles,
    fileStates,
    analysisResults,
    isAnalyzing,
    analysisProgress,
    namingSettings,
    setters: {
      setIsAnalyzing,
      setAnalysisProgress,
      setCurrentAnalysisFile,
      setAnalysisResults,
      setFileStates
    },
    updateFileState,
    addNotification,
    actions: extendedActions,
    getCurrentPhase
  });

  // File handlers hook
  const {
    isScanning,
    handleFileSelection,
    handleFolderSelection,
    handleFileDrop: fileHandlersDrop
  } = useFileHandlers({
    selectedFiles,
    setSelectedFiles,
    updateFileState,
    addNotification,
    analyzeFiles
  });

  // File actions hook
  const { handleFileAction } = useFileActions({
    setAnalysisResults,
    setSelectedFiles,
    setFileStates,
    addNotification,
    showConfirm,
    phaseData
  });

  // Drag and drop with file handler
  const handleFileDrop = useCallback(
    async (files) => {
      if (files && files.length > 0) {
        await fileHandlersDrop(files);
      }
    },
    [fileHandlersDrop]
  );

  const { isDragging, dragProps } = useDragAndDrop(handleFileDrop);
  const initialStuckCheckRef = useRef(false);

  // Subscribe to external settings changes
  useSettingsSubscription(
    useCallback(
      (changedSettings) => {
        logger.info('Settings changed externally:', Object.keys(changedSettings));
        if (changedSettings.ollamaHost && !isAnalyzing) {
          addNotification(
            'Ollama settings updated. New analyses will use the updated configuration.',
            'info',
            3000,
            'settings-changed'
          );
        }
      },
      [isAnalyzing, addNotification]
    ),
    {
      enabled: true,
      watchKeys: ['ollamaHost', 'ollamaModels', 'analysisSettings']
    }
  );

  // Check for stuck analysis on mount
  useEffect(() => {
    if (initialStuckCheckRef.current) return;
    initialStuckCheckRef.current = true;

    if (isAnalyzing) {
      const lastActivity = analysisProgress?.lastActivity || Date.now();
      const timeSinceActivity = Date.now() - lastActivity;
      const isStuck = timeSinceActivity > 2 * 60 * 1000;

      if (isStuck) {
        logger.info('Detected stuck analysis state on mount, resetting');
        resetAnalysisState('Stuck analysis detected on mount');
      }
    }
  }, [isAnalyzing, analysisProgress, resetAnalysisState]);

  // Resume analysis on mount if needed
  // Note: Actual resume logic is handled in useAnalysis hook to prevent duplication
  /* useEffect(() => { ... } removed to fix duplicate notifications */

  // Auto-reset stuck/stalled analysis
  useEffect(() => {
    if (!isAnalyzing || !hasResumedRef.current) return;

    const lastActivity = analysisProgress?.lastActivity || Date.now();
    const timeSinceActivity = Date.now() - lastActivity;
    const current = analysisProgress?.current || 0;
    const total = analysisProgress?.total || 0;

    const twoMinutes = 2 * 60 * 1000;
    if (current === 0 && total > 0 && timeSinceActivity > twoMinutes) {
      addNotification(
        'Analysis stalled with no progress - auto-resetting',
        'warning',
        5000,
        'analysis-stalled'
      );
      resetAnalysisState('Analysis stalled with no progress after 2 minutes');
      return;
    }

    if (timeSinceActivity > TIMEOUTS.ANALYSIS_LOCK) {
      addNotification(
        'Detected stuck analysis state - auto-resetting',
        'warning',
        5000,
        'analysis-auto-reset'
      );
      resetAnalysisState('Stuck analysis state after 5 minutes of inactivity');
    }
  }, [isAnalyzing, analysisProgress, addNotification, resetAnalysisState]);

  // File state display helper
  const getFileStateDisplay = useCallback(
    (filePath, hasAnalysis) => {
      const state = fileStates[filePath]?.state || 'pending';
      return getFileStateDisplayInfo(state, hasAnalysis);
    },
    [fileStates]
  );

  return (
    <div className="phase-container bg-system-gray-50/30 pb-spacious">
      <div className="container-responsive flex flex-col flex-1 min-h-0 py-default gap-default">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between flex-shrink-0 gap-cozy">
          <div className="flex flex-col gap-compact">
            <h1 className="heading-primary">Discover & Analyze</h1>
            <p className="text-base text-system-gray-600 max-w-2xl">
              Add your files and configure how StratoSort should name them.
            </p>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col gap-default">
          {/* Primary Content Selection Card */}
          <section className="surface-panel flex flex-col flex-shrink-0 gap-default">
            <div className="flex items-center justify-between flex-wrap gap-cozy">
              <div className="flex items-center gap-cozy">
                <h3 className="heading-tertiary m-0 flex items-center gap-compact">
                  <FolderOpenIcon className="w-5 h-5 text-stratosort-blue" /> Select Content
                </h3>
                {selectedFiles.length > 0 && (
                  <span className="status-chip info">
                    {selectedFiles.length} file
                    {selectedFiles.length !== 1 ? 's' : ''} ready
                  </span>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowNamingSettings(true)}
                className="text-sm gap-compact"
              >
                <SettingsIcon className="w-4 h-4" /> Naming Strategy
              </Button>
            </div>

            <div
              className={`flex-1 flex flex-col items-center justify-center animate-fade-in text-center min-h-content-md p-spacious transition-colors duration-200 border-2 border-dashed rounded-xl ${
                isDragging ? 'border-stratosort-blue bg-stratosort-blue/5' : 'border-transparent'
              }`}
              {...dragProps}
            >
              <div className="w-16 h-16 bg-gradient-to-br from-stratosort-blue to-stratosort-indigo shadow-lg flex items-center justify-center transform transition-transform hover:scale-105 duration-300 rounded-xl mb-relaxed">
                <FolderOpenIcon className="w-8 h-8 text-white" />
              </div>

              <h2 className="heading-primary text-xl md:text-2xl tracking-tight mb-compact">
                {isDragging ? 'Drop Files Here' : 'Add Files to Organize'}
              </h2>
              <p className="text-system-gray-500 max-w-sm leading-relaxed text-sm md:text-base mb-spacious">
                {isDragging
                  ? 'Release to add these files to your analysis queue.'
                  : 'Select documents or scan folders to let AI analyze your content and suggest the perfect organization structure.'}
              </p>

              <SelectionControls
                onSelectFiles={handleFileSelection}
                onSelectFolder={handleFolderSelection}
                isScanning={isScanning}
                className="w-full max-w-sm justify-center"
              />
            </div>
          </section>

          {/* Middle Section - Queue & Status Actions */}
          {(selectedFiles.length > 0 || isAnalyzing) && (
            <div className="surface-panel flex items-center justify-between bg-white/85 backdrop-blur-md animate-fade-in p-default gap-default">
              <div className="flex items-center flex-1 gap-default">
                {isAnalyzing ? (
                  <div className="flex-1 max-w-2xl">
                    <AnalysisProgress
                      progress={analysisProgress}
                      currentFile={currentAnalysisFile}
                    />
                  </div>
                ) : (
                  <div className="text-sm text-system-gray-600 flex items-center gap-compact">
                    <span className="status-dot success animate-pulse"></span>
                    Ready to analyze {selectedFiles.length} files
                  </div>
                )}
              </div>

              <div className="flex items-center gap-cozy">
                {isAnalyzing ? (
                  <>
                    <Button onClick={cancelAnalysis} variant="danger" size="sm">
                      Stop Analysis
                    </Button>
                    {analysisProgress.lastActivity &&
                      Date.now() - analysisProgress.lastActivity > 2 * 60 * 1000 && (
                        <Button
                          onClick={() => resetAnalysisState('User forced reset')}
                          variant="secondary"
                          size="sm"
                          className="status-chip warning"
                        >
                          Force Reset
                        </Button>
                      )}
                  </>
                ) : (
                  <Button
                    onClick={clearAnalysisQueue}
                    variant="ghost"
                    size="sm"
                    className="text-system-gray-500 hover:text-stratosort-danger hover:bg-stratosort-danger/10"
                  >
                    Clear Queue
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Bottom Section - Results (or skeleton while analyzing) */}
          {(visibleAnalysisResults.length > 0 || (isAnalyzing && selectedFiles.length > 0)) && (
            <div className="flex-1 min-h-content-md surface-panel flex flex-col overflow-hidden animate-slide-up">
              <div className="border-b border-border-soft/70 bg-white/70 flex items-center justify-between p-default">
                <h3 className="heading-tertiary m-0 text-sm uppercase tracking-wider text-system-gray-500">
                  Analysis Results
                </h3>
                <div className="text-xs text-system-gray-500">
                  {isAnalyzing && visibleAnalysisResults.length === 0
                    ? 'Analyzing files...'
                    : `${visibleReadyCount} successful, ${visibleFailedCount} failed`}
                </div>
              </div>
              <div className="flex-1 min-h-0 p-0 bg-white/10 overflow-y-auto modern-scrollbar pb-default">
                {visibleAnalysisResults.length > 0 ? (
                  <AnalysisResultsList
                    results={visibleAnalysisResults}
                    onFileAction={handleFileAction}
                    getFileStateDisplay={getFileStateDisplay}
                  />
                ) : (
                  <div className="p-4">
                    <FileListSkeleton count={Math.min(selectedFiles.length, 5)} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Analysis Failure Recovery Banner */}
        {totalAnalysisFailure && (
          <div className="flex-shrink-0 glass-panel border border-stratosort-warning/30 bg-stratosort-warning/10 backdrop-blur-md animate-fade-in p-default">
            <div className="flex items-start gap-cozy">
              <AlertTriangle className="w-6 h-6 text-stratosort-warning flex-shrink-0" />
              <div className="flex-1">
                <h4 className="heading-tertiary text-stratosort-warning mb-compact">
                  All File Analyses Failed
                </h4>
                <p className="text-xs text-system-gray-700 mb-cozy">
                  AI analysis could not process your files. This may be due to network issues,
                  unsupported file types, or API limits. You can still proceed to organize your
                  files manually, or try adding different files.
                </p>
                <div className="flex flex-wrap gap-compact">
                  <Button
                    onClick={() => {
                      setTotalAnalysisFailure(false);
                      clearAnalysisQueue();
                    }}
                    variant="secondary"
                    size="sm"
                    className="text-stratosort-warning border-stratosort-warning/30 bg-white hover:bg-stratosort-warning/5"
                  >
                    Clear and Try Again
                  </Button>
                  <Button
                    onClick={() => {
                      setTotalAnalysisFailure(false);
                      actions.advancePhase(PHASES.ORGANIZE);
                    }}
                    variant="secondary"
                    size="sm"
                    className="bg-stratosort-warning text-white border-stratosort-warning hover:bg-stratosort-warning/90"
                  >
                    Skip to Organize Phase →
                  </Button>
                </div>
              </div>
              <Button
                onClick={() => setTotalAnalysisFailure(false)}
                variant="ghost"
                size="sm"
                className="text-stratosort-warning hover:text-stratosort-warning/80 p-compact"
                aria-label="Dismiss warning"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Footer Navigation */}
        <div className="mt-auto border-t border-system-gray-200/50 flex flex-col sm:flex-row items-center justify-between flex-shrink-0 pt-default gap-cozy">
          <Button
            onClick={() => actions.advancePhase(PHASES.SETUP)}
            variant="secondary"
            className="w-full sm:w-auto"
          >
            ← Back to Setup
          </Button>

          {(() => {
            const disabledBecauseAnalyzing = isAnalyzing;
            const disabledBecauseNoAnalysis =
              visibleAnalysisResults.length === 0 &&
              readySelectedFilesCount === 0 &&
              !totalAnalysisFailure;
            const disabledBecauseEmpty =
              visibleAnalysisResults.length === 0 &&
              readySelectedFilesCount === 0 &&
              totalAnalysisFailure;

            let disabledReason = '';
            if (disabledBecauseAnalyzing) {
              disabledReason = 'Analysis is in progress.';
            } else if (disabledBecauseNoAnalysis) {
              disabledReason = 'Analyze files or continue without analysis.';
            } else if (disabledBecauseEmpty) {
              disabledReason =
                'No analyzed or ready files. Add files or continue without analysis.';
            }

            return (
              <Button
                onClick={() => {
                  if (isAnalyzing) {
                    addNotification('Please wait for analysis to complete', 'warning', 3000);
                    return;
                  }
                  if (visibleReadyCount === 0 && !totalAnalysisFailure) {
                    addNotification(
                      visibleAnalysisResults.length > 0
                        ? 'All files failed analysis. Use the recovery options above or click "Continue Without Analysis".'
                        : 'Please analyze files first',
                      'warning',
                      4000
                    );
                    return;
                  }
                  if (totalAnalysisFailure) {
                    setTotalAnalysisFailure(false);
                  }
                  actions.advancePhase(PHASES.ORGANIZE);
                }}
                variant={totalAnalysisFailure ? 'secondary' : 'primary'}
                className={`w-full sm:w-auto ${totalAnalysisFailure ? 'border-stratosort-warning/30 text-stratosort-warning hover:bg-stratosort-warning/5' : 'shadow-lg shadow-stratosort-blue/20'}`}
                disabled={
                  isAnalyzing ||
                  (visibleAnalysisResults.length === 0 &&
                    readySelectedFilesCount === 0 &&
                    !totalAnalysisFailure)
                }
                title={disabledReason || undefined}
                aria-label={
                  disabledReason ? `Continue button disabled: ${disabledReason}` : undefined
                }
              >
                {totalAnalysisFailure ? 'Continue Without Analysis →' : 'Continue to Organize →'}
              </Button>
            );
          })()}
        </div>

        <ConfirmDialog />
        <NamingSettingsModal
          isOpen={showNamingSettings}
          onClose={() => setShowNamingSettings(false)}
          namingConvention={namingConvention}
          setNamingConvention={setNamingConvention}
          dateFormat={dateFormat}
          setDateFormat={setDateFormat}
          caseConvention={caseConvention}
          setCaseConvention={setCaseConvention}
          separator={separator}
          setSeparator={setSeparator}
        />
      </div>
    </div>
  );
}

export default DiscoverPhase;
