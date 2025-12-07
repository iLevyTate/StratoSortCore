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
  Suspense,
  lazy,
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
import { ModalLoadingOverlay } from '../components/LoadingSkeleton';
import {
  NamingSettings,
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

const AnalysisHistoryModal = lazy(
  () => import('../components/AnalysisHistoryModal'),
);

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
    successfulAnalysisCount,
    failedAnalysisCount,
    readyAnalysisCount,
    readySelectedFilesCount,
  } = useDiscoverState();

  const { addNotification } = useNotification();
  const { showConfirm, ConfirmDialog } = useConfirmDialog();

  // Local UI state
  const [showAnalysisHistory, setShowAnalysisHistory] = useState(false);
  const [analysisStats, setAnalysisStats] = useState(null);
  const [totalAnalysisFailure, setTotalAnalysisFailure] = useState(false);

  // Refs for analysis state
  const hasResumedRef = useRef(false);

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
  const extendedActions = {
    ...actions,
    setPhaseData: (key, value) => {
      if (key === 'totalAnalysisFailure') {
        setTotalAnalysisFailure(value);
      } else {
        actions.setPhaseData(key, value);
      }
    },
  };

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
    if (isAnalyzing) {
      const lastActivity = analysisProgress.lastActivity || Date.now();
      const timeSinceActivity = Date.now() - lastActivity;
      const isStuck = timeSinceActivity > 2 * 60 * 1000;

      if (isStuck) {
        logger.info('Detected stuck analysis state on mount, resetting');
        resetAnalysisState('Stuck analysis detected on mount');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally run once on mount - deps excluded to avoid repeated checks

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
    <div className="min-h-[calc(100vh-var(--app-nav-height))] w-full flex flex-col overflow-auto modern-scrollbar bg-system-gray-50/30 pb-8">
      <div className="container-responsive flex flex-col flex-1 min-h-0 gap-4 py-4">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 flex-shrink-0">
          <div className="space-y-1">
            <h1 className="heading-primary text-[clamp(22px,2.6vw,28px)]">
              Discover & Analyze
            </h1>
            <p className="text-base text-system-gray-600 max-w-2xl">
              Add your files and configure how StratoSort should name them.
            </p>
          </div>
          <Button
            variant="secondary"
            className="text-sm gap-2"
            onClick={() => setShowAnalysisHistory(true)}
          >
            <span>📜</span> History
          </Button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col gap-4">
          {/* Dashboard Grid - Top Section */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-shrink-0">
            {/* Input Source Card - Left Side */}
            <section className="lg:col-span-5 xl:col-span-4 surface-panel flex flex-col gap-4 min-h-[220px]">
              <div className="flex items-center justify-between">
                <h3 className="heading-tertiary m-0 flex items-center gap-2">
                  <span className="text-lg">📂</span> Select Content
                </h3>
                {selectedFiles.length > 0 && (
                  <span className="text-xs font-medium px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full">
                    {selectedFiles.length} file
                    {selectedFiles.length !== 1 ? 's' : ''} ready
                  </span>
                )}
              </div>

              <div className="flex-1 flex flex-col gap-4 min-h-0">
                <DragAndDropZone
                  isDragging={isDragging}
                  dragProps={dragProps}
                  className="flex-1 flex flex-col justify-center items-center min-h-[120px] bg-white/70 hover:bg-white transition-all border-system-gray-200 rounded-lg"
                />
                <SelectionControls
                  onSelectFiles={handleFileSelection}
                  onSelectFolder={handleFolderSelection}
                  isScanning={isScanning}
                  className="justify-center w-full pt-2"
                />
              </div>
            </section>

            {/* Settings Card - Right Side */}
            <section className="lg:col-span-7 xl:col-span-8 surface-panel flex flex-col gap-4 min-h-[220px]">
              <div className="flex items-center justify-between">
                <h3 className="heading-tertiary m-0 flex items-center gap-2">
                  <span className="text-lg">⚙️</span> Naming Strategy
                </h3>
                <div className="text-xs text-system-gray-400">
                  Configure how files will be renamed
                </div>
              </div>

              <div className="flex-1 min-h-0 flex flex-col justify-center overflow-y-auto modern-scrollbar">
                <NamingSettings
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
            </section>
          </div>

          {/* Middle Section - Queue & Status Actions */}
          {(selectedFiles.length > 0 || isAnalyzing) && (
            <div className="surface-panel p-4 flex items-center justify-between gap-4 bg-white/85 backdrop-blur-md animate-fade-in sticky top-[calc(var(--app-nav-height)+12px)] z-10">
              <div className="flex items-center gap-4 flex-1">
                {isAnalyzing ? (
                  <div className="flex-1 max-w-2xl">
                    <AnalysisProgress
                      progress={analysisProgress}
                      currentFile={currentAnalysisFile}
                    />
                  </div>
                ) : (
                  <div className="text-sm text-system-gray-600 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                    Ready to analyze {selectedFiles.length} files
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                {isAnalyzing ? (
                  <>
                    <button
                      onClick={cancelAnalysis}
                      className="px-4 py-2 text-xs font-medium bg-red-50 text-red-600 rounded-md hover:bg-red-100 transition-colors border border-red-200"
                    >
                      Stop Analysis
                    </button>
                    {analysisProgress.lastActivity &&
                      Date.now() - analysisProgress.lastActivity >
                        2 * 60 * 1000 && (
                        <button
                          onClick={() =>
                            resetAnalysisState('User forced reset')
                          }
                          className="px-4 py-2 text-xs font-medium bg-amber-50 text-amber-700 rounded-md hover:bg-amber-100 transition-colors border border-amber-200"
                        >
                          Force Reset
                        </button>
                      )}
                  </>
                ) : (
                  <button
                    onClick={clearAnalysisQueue}
                    className="px-4 py-2 text-xs font-medium text-system-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                  >
                    Clear Queue
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Bottom Section - Results */}
          {analysisResults.length > 0 && (
            <div className="flex-1 min-h-[280px] max-h-[60vh] surface-panel flex flex-col overflow-hidden animate-slide-up">
              <div className="p-4 border-b border-border-soft/70 bg-white/70 flex items-center justify-between">
                <h3 className="heading-tertiary m-0 text-sm uppercase tracking-wider text-system-gray-500">
                  Analysis Results
                </h3>
                <div className="text-xs text-system-gray-400">
                  {successfulAnalysisCount} successful, {failedAnalysisCount}{' '}
                  failed
                </div>
              </div>
              <div className="flex-1 min-h-0 p-0 pb-4 bg-white/10">
                <AnalysisResultsList
                  results={analysisResults}
                  onFileAction={handleFileAction}
                  getFileStateDisplay={getFileStateDisplay}
                />
              </div>
            </div>
          )}
        </div>

        {/* Analysis Failure Recovery Banner */}
        {totalAnalysisFailure && (
          <div className="flex-shrink-0 glass-panel p-4 border border-amber-200 bg-amber-50/80 backdrop-blur-md animate-fade-in">
            <div className="flex items-start gap-3">
              <span className="text-xl flex-shrink-0">⚠️</span>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-amber-800 mb-1">
                  All File Analyses Failed
                </h4>
                <p className="text-xs text-amber-700 mb-3">
                  AI analysis could not process your files. This may be due to
                  network issues, unsupported file types, or API limits. You can
                  still proceed to organize your files manually, or try adding
                  different files.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      setTotalAnalysisFailure(false);
                      clearAnalysisQueue();
                    }}
                    className="px-3 py-1.5 text-xs font-medium bg-white text-amber-700 rounded-md hover:bg-amber-100 transition-colors border border-amber-300"
                  >
                    Clear and Try Again
                  </button>
                  <button
                    onClick={() => {
                      setTotalAnalysisFailure(false);
                      actions.advancePhase(PHASES.ORGANIZE);
                    }}
                    className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors"
                  >
                    Skip to Organize Phase →
                  </button>
                </div>
              </div>
              <button
                onClick={() => setTotalAnalysisFailure(false)}
                className="text-amber-600 hover:text-amber-800 p-1 rounded transition-colors"
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
              </button>
            </div>
          </div>
        )}

        {/* Footer Navigation */}
        <div className="mt-auto pt-4 border-t border-system-gray-200/50 flex flex-col sm:flex-row items-center justify-between gap-3 flex-shrink-0">
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
              analysisResults.length === 0 &&
              readySelectedFilesCount === 0 &&
              !totalAnalysisFailure;
            const disabledBecauseEmpty =
              analysisResults.length === 0 &&
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
                  if (readyAnalysisCount === 0 && !totalAnalysisFailure) {
                    addNotification(
                      analysisResults.length > 0
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
                className={`w-full sm:w-auto ${totalAnalysisFailure ? 'border-amber-300 text-amber-700 hover:bg-amber-50' : 'shadow-lg shadow-blue-500/20'}`}
                disabled={
                  isAnalyzing ||
                  (analysisResults.length === 0 &&
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
        {showAnalysisHistory && (
          <Suspense
            fallback={<ModalLoadingOverlay message="Loading History..." />}
          >
            <AnalysisHistoryModal
              onClose={() => setShowAnalysisHistory(false)}
              analysisStats={analysisStats}
              setAnalysisStats={setAnalysisStats}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

export default DiscoverPhase;
