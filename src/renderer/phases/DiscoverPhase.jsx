/**
 * DiscoverPhase Component
 *
 * Main discover phase component for file selection and AI analysis.
 * Hooks and utilities extracted to phases/discover/ for maintainability.
 *
 * @module phases/DiscoverPhase
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { PHASES } from '../../shared/constants';
import { logger } from '../../shared/logger';
import { useNotification } from '../contexts/NotificationContext';
import {
  useConfirmDialog,
  useDragAndDrop,
  useSettingsSubscription,
} from '../hooks';
import { Button } from '../components/ui';

// Inline SVG Icons
const FolderOpenIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
  </svg>
);

const SettingsIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const AlertTriangleIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);
import {
  NamingSettingsModal,
  SelectionControls,
  DragAndDropZone,
  AnalysisResultsList,
  AnalysisProgress,
} from '../components/discover';

// Extracted hooks and utilities
import {
  useDiscoverState,
  useAnalysis,
  useFileHandlers,
  useFileActions,
  getFileStateDisplayInfo,
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
    [selectedFiles],
  );

  const visibleAnalysisResults = useMemo(
    () =>
      (analysisResults || []).filter((result) =>
        selectedPaths.has(result.path),
      ),
    [analysisResults, selectedPaths],
  );

  const visibleReadyCount = useMemo(
    () =>
      visibleAnalysisResults.filter(
        (r) => r.analysis && !r.error,
      ).length,
    [visibleAnalysisResults],
  );

  const visibleFailedCount = useMemo(
    () => visibleAnalysisResults.filter((r) => r.error).length,
    [visibleAnalysisResults],
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
      separator,
    },
    totalAnalysisFailure,
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
      },
    }),
    [actions],
  );

  // Analysis hook
  const { analyzeFiles, analyzeFilesRef, cancelAnalysis, clearAnalysisQueue } =
    useAnalysis({
      selectedFiles,
      fileStates,
      analysisResults,
      isAnalyzing,
      analysisProgress,
      namingSettings,
      setIsAnalyzing,
      setAnalysisProgress,
      setCurrentAnalysisFile,
      setAnalysisResults,
      setFileStates,
      updateFileState,
      addNotification,
      actions: extendedActions,
    });

  // File handlers hook
  const {
    isScanning,
    handleFileSelection,
    handleFolderSelection,
    handleFileDrop: fileHandlersDrop,
  } = useFileHandlers({
    selectedFiles,
    setSelectedFiles,
    updateFileState,
    addNotification,
    analyzeFiles,
  });

  // File actions hook
  const { handleFileAction } = useFileActions({
    setAnalysisResults,
    setSelectedFiles,
    setFileStates,
    addNotification,
    showConfirm,
    phaseData,
  });

  // Drag and drop with file handler
  const handleFileDrop = useCallback(
    async (files) => {
      if (files && files.length > 0) {
        await fileHandlersDrop(files);
      }
    },
    [fileHandlersDrop],
  );

  const { isDragging, dragProps } = useDragAndDrop(handleFileDrop);
  const initialStuckCheckRef = useRef(false);

  // Subscribe to external settings changes
  useSettingsSubscription(
    useCallback(
      (changedSettings) => {
        logger.info(
          'Settings changed externally:',
          Object.keys(changedSettings),
        );
        if (changedSettings.ollamaHost && !isAnalyzing) {
          addNotification(
            'Ollama settings updated. New analyses will use the updated configuration.',
            'info',
            3000,
            'settings-changed',
          );
        }
      },
      [isAnalyzing, addNotification],
    ),
    {
      enabled: true,
      watchKeys: ['ollamaHost', 'ollamaModels', 'analysisSettings'],
    },
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
  useEffect(() => {
    if (
      !hasResumedRef.current &&
      isAnalyzing &&
      Array.isArray(selectedFiles) &&
      selectedFiles.length > 0
    ) {
      const remaining = selectedFiles.filter((f) => {
        const state = fileStates[f.path]?.state;
        return state !== 'ready' && state !== 'error';
      });

      hasResumedRef.current = true;

      if (remaining.length > 0) {
        addNotification(
          `Resuming analysis of ${remaining.length} files...`,
          'info',
          3000,
          'analysis-resume',
        );
        const runAnalysis = analyzeFilesRef.current;
        if (runAnalysis) {
          runAnalysis(remaining);
        } else {
          logger.warn('analyzeFiles not ready during resume');
        }
      } else {
        resetAnalysisState('No remaining files to analyze');
      }
    }
  }, [
    isAnalyzing,
    selectedFiles,
    fileStates,
    addNotification,
    resetAnalysisState,
    analyzeFilesRef,
  ]);

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
        'analysis-stalled',
      );
      resetAnalysisState('Analysis stalled with no progress after 2 minutes');
      return;
    }

    const fiveMinutes = 5 * 60 * 1000;
    if (timeSinceActivity > fiveMinutes) {
      addNotification(
        'Detected stuck analysis state - auto-resetting',
        'warning',
        5000,
        'analysis-auto-reset',
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
    [fileStates],
  );

  return (
    <div className="phase-container bg-system-gray-50/30" style={{ paddingBottom: 'var(--spacing-spacious)' }}>
      <div className="container-responsive flex flex-col flex-1 min-h-0" style={{ gap: 'var(--spacing-default)', paddingTop: 'var(--spacing-default)', paddingBottom: 'var(--spacing-default)' }}>
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between flex-shrink-0" style={{ gap: 'var(--spacing-cozy)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-compact)' }}>
            <h1 className="heading-primary">
              Discover & Analyze
            </h1>
            <p className="text-base text-system-gray-600 max-w-2xl">
              Add your files and configure how StratoSort should name them.
            </p>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col" style={{ gap: 'var(--spacing-default)' }}>
          {/* Primary Content Selection Card */}
          <section className="surface-panel flex flex-col flex-shrink-0" style={{ gap: 'var(--spacing-default)' }}>
            <div className="flex items-center justify-between flex-wrap" style={{ gap: 'var(--spacing-cozy)' }}>
              <div className="flex items-center" style={{ gap: 'var(--spacing-cozy)' }}>
                <h3 className="heading-tertiary m-0 flex items-center" style={{ gap: 'var(--spacing-compact)' }}>
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
                className="text-sm"
                style={{ gap: 'var(--spacing-compact)' }}
              >
                <SettingsIcon className="w-4 h-4" /> Naming Strategy
              </Button>
            </div>

            <div className="flex flex-col items-center justify-center" style={{ gap: 'var(--spacing-default)', padding: 'var(--spacing-default) 0' }}>
              <DragAndDropZone
                isDragging={isDragging}
                dragProps={dragProps}
                className="w-full max-w-2xl flex flex-col justify-center items-center min-h-[180px] bg-white/70 hover:bg-white transition-all border-system-gray-200"
                style={{ borderRadius: 'var(--radius-md)' }}
              />
              <SelectionControls
                onSelectFiles={handleFileSelection}
                onSelectFolder={handleFolderSelection}
                isScanning={isScanning}
                className="justify-center"
              />
            </div>
          </section>

          {/* Middle Section - Queue & Status Actions */}
          {(selectedFiles.length > 0 || isAnalyzing) && (
            <div className="surface-panel flex items-center justify-between bg-white/85 backdrop-blur-md animate-fade-in sticky top-[var(--app-nav-height)] z-10 flex-shrink-0" style={{ padding: 'var(--spacing-default)', gap: 'var(--spacing-default)' }}>
              <div className="flex items-center flex-1" style={{ gap: 'var(--spacing-default)' }}>
                {isAnalyzing ? (
                  <div className="flex-1 max-w-2xl">
                    <AnalysisProgress
                      progress={analysisProgress}
                      currentFile={currentAnalysisFile}
                    />
                  </div>
                ) : (
                  <div className="text-sm text-system-gray-600 flex items-center" style={{ gap: 'var(--spacing-compact)' }}>
                    <span className="status-dot success animate-pulse"></span>
                    Ready to analyze {selectedFiles.length} files
                  </div>
                )}
              </div>

              <div className="flex items-center" style={{ gap: 'var(--spacing-cozy)' }}>
                {isAnalyzing ? (
                  <>
                    <Button
                      onClick={cancelAnalysis}
                      variant="danger"
                      size="sm"
                    >
                      Stop Analysis
                    </Button>
                    {analysisProgress.lastActivity &&
                      Date.now() - analysisProgress.lastActivity >
                        2 * 60 * 1000 && (
                        <Button
                          onClick={() =>
                            resetAnalysisState('User forced reset')
                          }
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

          {/* Bottom Section - Results */}
          {visibleAnalysisResults.length > 0 && (
            <div className="flex-1 min-h-content-md max-h-viewport-lg surface-panel flex flex-col overflow-hidden animate-slide-up">
              <div className="border-b border-border-soft/70 bg-white/70 flex items-center justify-between" style={{ padding: 'var(--spacing-default)' }}>
                <h3 className="heading-tertiary m-0 text-sm uppercase tracking-wider text-system-gray-500">
                  Analysis Results
                </h3>
                <div className="text-xs text-system-gray-500">
                  {visibleReadyCount} successful, {visibleFailedCount} failed
                </div>
              </div>
              <div className="flex-1 min-h-0 p-0 bg-white/10 overflow-y-auto modern-scrollbar" style={{ paddingBottom: 'var(--spacing-default)' }}>
                <AnalysisResultsList
                  results={visibleAnalysisResults}
                  onFileAction={handleFileAction}
                  getFileStateDisplay={getFileStateDisplay}
                />
              </div>
            </div>
          )}
        </div>

        {/* Analysis Failure Recovery Banner */}
        {totalAnalysisFailure && (
          <div className="flex-shrink-0 glass-panel border border-stratosort-warning/30 bg-stratosort-warning/10 backdrop-blur-md animate-fade-in" style={{ padding: 'var(--spacing-default)' }}>
            <div className="flex items-start" style={{ gap: 'var(--spacing-cozy)' }}>
              <AlertTriangleIcon className="w-6 h-6 text-stratosort-warning flex-shrink-0" />
              <div className="flex-1">
                <h4 className="heading-tertiary text-stratosort-warning" style={{ marginBottom: 'var(--spacing-compact)' }}>
                  All File Analyses Failed
                </h4>
                <p className="text-xs text-system-gray-700" style={{ marginBottom: 'var(--spacing-cozy)' }}>
                  AI analysis could not process your files. This may be due to
                  network issues, unsupported file types, or API limits. You can
                  still proceed to organize your files manually, or try adding
                  different files.
                </p>
                <div className="flex flex-wrap" style={{ gap: 'var(--spacing-compact)' }}>
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
                className="text-stratosort-warning hover:text-stratosort-warning/80"
                style={{ padding: 'var(--spacing-compact)' }}
                aria-label="Dismiss warning"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </Button>
            </div>
          </div>
        )}

        {/* Footer Navigation */}
        <div className="mt-auto border-t border-system-gray-200/50 flex flex-col sm:flex-row items-center justify-between flex-shrink-0" style={{ paddingTop: 'var(--spacing-default)', gap: 'var(--spacing-cozy)' }}>
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
                    addNotification(
                      'Please wait for analysis to complete',
                      'warning',
                      3000,
                    );
                    return;
                  }
                  if (visibleReadyCount === 0 && !totalAnalysisFailure) {
                    addNotification(
                      visibleAnalysisResults.length > 0
                        ? 'All files failed analysis. Use the recovery options above or click "Continue Without Analysis".'
                        : 'Please analyze files first',
                      'warning',
                      4000,
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
                  disabledReason
                    ? `Continue button disabled: ${disabledReason}`
                    : undefined
                }
              >
                {totalAnalysisFailure
                  ? 'Continue Without Analysis →'
                  : 'Continue to Organize →'}
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
