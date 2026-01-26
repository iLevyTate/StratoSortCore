import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { AlertTriangle, X, Sparkles, RefreshCw, Network, FolderOpen, Settings } from 'lucide-react';
import { PHASES } from '../../shared/constants';
import { TIMEOUTS } from '../../shared/performanceConstants';
import { logger } from '../../shared/logger';
import { useNotification } from '../contexts/NotificationContext';
import { useFloatingSearch } from '../contexts/FloatingSearchContext';
import { useConfirmDialog, useDragAndDrop, useSettingsSubscription } from '../hooks';
import { Button, IconButton } from '../components/ui';
import { Heading, Text } from '../components/ui/Typography';
import Card from '../components/ui/Card';
import StatusBadge from '../components/ui/StatusBadge';
import { ActionBar, Inline, Stack } from '../components/layout';
import {
  NamingSettingsModal,
  SelectionControls,
  AnalysisResultsList,
  AnalysisProgress
} from '../components/discover';
import { FileListSkeleton } from '../components/ui/LoadingSkeleton';

import {
  useDiscoverState,
  useAnalysis,
  useFileHandlers,
  useFileActions,
  getFileStateDisplayInfo
} from './discover';

const isWindowsPath = (p) => p && (p.includes('\\') || /^[A-Za-z]:/.test(p));
const normalizeForComparison = (path) => {
  if (!path) return '';
  const normalized = path.replace(/[\\/]+/g, '/');
  return isWindowsPath(path) ? normalized.toLowerCase() : normalized;
};

logger.setContext('DiscoverPhase');

function DiscoverPhase() {
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
    getCurrentPhase,
    organizedFiles
  } = useDiscoverState();

  const { addNotification } = useNotification();
  const { showConfirm, ConfirmDialog } = useConfirmDialog();
  const { openSearchModal } = useFloatingSearch();

  const [showNamingSettings, setShowNamingSettings] = useState(false);
  const [totalAnalysisFailure, setTotalAnalysisFailure] = useState(false);
  const [showEmbeddingPrompt, setShowEmbeddingPrompt] = useState(false);
  const [isRebuildingEmbeddings, setIsRebuildingEmbeddings] = useState(false);

  const prevAnalyzingRef = useRef(isAnalyzing);
  const hasShownEmbeddingPromptRef = useRef(
    (() => {
      try {
        return localStorage.getItem('stratosort_embedding_prompt_dismissed') === 'true';
      } catch {
        return false;
      }
    })()
  );

  const selectedPaths = useMemo(
    () =>
      new Set(
        (selectedFiles || []).filter((f) => f && f.path).map((f) => normalizeForComparison(f.path))
      ),
    [selectedFiles]
  );

  const organizedPaths = useMemo(() => {
    const paths = new Set();
    (organizedFiles || []).forEach((f) => {
      if (!f) return;
      const path = f.originalPath || f.path;
      if (!path) return;
      const normalizedPath = normalizeForComparison(path);
      paths.add(normalizedPath);
    });
    return paths;
  }, [organizedFiles]);

  const visibleAnalysisResults = useMemo(() => {
    return (analysisResults || []).filter((result) => {
      if (!result || !result.path) return false;
      const normalizedResultPath = normalizeForComparison(result.path);
      if (!selectedPaths.has(normalizedResultPath)) return false;
      if (organizedPaths.has(normalizedResultPath)) return false;
      return true;
    });
  }, [analysisResults, selectedPaths, organizedPaths]);

  const visibleReadyCount = useMemo(
    () => visibleAnalysisResults.filter((r) => r.analysis && !r.error).length,
    [visibleAnalysisResults]
  );

  const visibleFailedCount = useMemo(
    () => visibleAnalysisResults.filter((r) => r.error).length,
    [visibleAnalysisResults]
  );

  const analyzedPaths = useMemo(() => {
    const paths = new Set();
    (analysisResults || []).forEach((result) => {
      const normalizedPath = normalizeForComparison(result.path || '');
      if (normalizedPath) paths.add(normalizedPath);
    });
    return paths;
  }, [analysisResults]);

  const unorganizedSelectedCount = useMemo(() => {
    return (selectedFiles || []).filter((f) => {
      if (!f || !f.path) return false;
      const normalizedPath = normalizeForComparison(f.path);
      return !organizedPaths.has(normalizedPath);
    }).length;
  }, [selectedFiles, organizedPaths]);

  const pendingAnalysisFiles = useMemo(() => {
    return (selectedFiles || []).filter((f) => {
      if (!f || !f.path) return false;
      const normalizedPath = normalizeForComparison(f.path);
      return !organizedPaths.has(normalizedPath) && !analyzedPaths.has(normalizedPath);
    });
  }, [selectedFiles, organizedPaths, analyzedPaths]);

  const pendingAnalysisCount = pendingAnalysisFiles.length;
  const analysisStartHint = useMemo(() => {
    if (pendingAnalysisCount === 0) return '';
    const fileApiReady = Boolean(window?.electronAPI?.files?.analyze);
    if (!fileApiReady) {
      return 'Analysis service not ready yet. Wait a moment or click to retry.';
    }
    if (analysisProgress?.current > 0 && analysisProgress?.total > 0) {
      const lastActivity = analysisProgress?.lastActivity;
      if (lastActivity && Date.now() - lastActivity > TIMEOUTS.STUCK_ANALYSIS_CHECK) {
        return 'Analysis paused after inactivity. Click to resume.';
      }
      return 'Analysis paused. Click to resume.';
    }
    return 'Ready to analyze. Click to begin.';
  }, [pendingAnalysisCount, analysisProgress]);

  const shouldShowQueueBar =
    isAnalyzing || pendingAnalysisCount > 0 || visibleAnalysisResults.length > 0;

  useEffect(() => {
    const wasAnalyzing = prevAnalyzingRef.current;
    prevAnalyzingRef.current = isAnalyzing;

    if (!wasAnalyzing || isAnalyzing) return undefined;
    if (hasShownEmbeddingPromptRef.current) return undefined;
    if (visibleReadyCount === 0) return undefined;

    const checkEmbeddings = async () => {
      try {
        const stats = await window.electronAPI?.embeddings?.getStats?.();
        const historyTotal =
          typeof stats?.analysisHistory?.totalFiles === 'number'
            ? stats.analysisHistory.totalFiles
            : 0;
        const needsRebuild =
          stats?.success &&
          typeof stats?.files === 'number' &&
          stats.files === 0 &&
          historyTotal > 0;

        if (needsRebuild) {
          setShowEmbeddingPrompt(true);
          hasShownEmbeddingPromptRef.current = true;
        }
      } catch (e) {
        logger.warn('Failed to check embedding stats', e);
      }
    };

    const timeoutId = setTimeout(checkEmbeddings, TIMEOUTS.EMBEDDING_CHECK);
    return () => clearTimeout(timeoutId);
  }, [isAnalyzing, visibleReadyCount]);

  const dismissEmbeddingPrompt = useCallback((permanent = false) => {
    setShowEmbeddingPrompt(false);
    if (permanent) {
      try {
        localStorage.setItem('stratosort_embedding_prompt_dismissed', 'true');
      } catch {
        // Private browsing mode or storage unavailable
      }
      hasShownEmbeddingPromptRef.current = true;
    }
  }, []);

  const handleRebuildEmbeddings = useCallback(async () => {
    setIsRebuildingEmbeddings(true);
    try {
      const res = await window.electronAPI?.embeddings?.rebuildFiles?.();
      if (res?.success) {
        addNotification(
          `Indexed ${res.files || 0} files for Knowledge OS`,
          'success',
          4000,
          'embedding-rebuild'
        );
        dismissEmbeddingPrompt(true);
      } else {
        throw new Error(res?.error || 'Failed to build embeddings');
      }
    } catch (e) {
      addNotification(e?.message || 'Failed to build embeddings', 'error', 5000, 'embedding-error');
    } finally {
      setIsRebuildingEmbeddings(false);
    }
  }, [addNotification, dismissEmbeddingPrompt]);

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

  const { analyzeFiles, cancelAnalysis, clearAnalysisQueue, retryFailedFiles } = useAnalysis({
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

  const { handleFileAction } = useFileActions({
    setAnalysisResults,
    setSelectedFiles,
    setFileStates,
    addNotification,
    showConfirm,
    phaseData
  });

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

  useSettingsSubscription(
    useCallback(
      (changedSettings) => {
        logger.info('Settings changed externally:', Object.keys(changedSettings));
        if (changedSettings.ollamaHost && !isAnalyzing) {
          addNotification('Ollama settings saved', 'info', 2000, 'settings-changed');
        }
      },
      [isAnalyzing, addNotification]
    ),
    {
      enabled: true,
      watchKeys: ['ollamaHost', 'ollamaModels', 'analysisSettings']
    }
  );

  const handleFileSelectionRef = useRef(handleFileSelection);
  const handleFolderSelectionRef = useRef(handleFolderSelection);
  useEffect(() => {
    handleFileSelectionRef.current = handleFileSelection;
    handleFolderSelectionRef.current = handleFolderSelection;
  }, [handleFileSelection, handleFolderSelection]);

  useEffect(() => {
    const onSelectFiles = () => handleFileSelectionRef.current?.();
    const onSelectFolder = () => handleFolderSelectionRef.current?.();

    window.addEventListener('app:select-files', onSelectFiles);
    window.addEventListener('app:select-folder', onSelectFolder);

    return () => {
      window.removeEventListener('app:select-files', onSelectFiles);
      window.removeEventListener('app:select-folder', onSelectFolder);
    };
  }, []);

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

  useEffect(() => {
    if (!isAnalyzing) return;

    const lastActivity = analysisProgress?.lastActivity || Date.now();
    const timeSinceActivity = Date.now() - lastActivity;
    const current = analysisProgress?.current || 0;
    const total = analysisProgress?.total || 0;

    if (current === 0 && total > 0 && timeSinceActivity > TIMEOUTS.STUCK_ANALYSIS_CHECK) {
      addNotification('Analysis paused. Restarting...', 'info', 3000, 'analysis-stalled');
      resetAnalysisState('Analysis stalled with no progress after 2 minutes');
      return;
    }

    if (timeSinceActivity > TIMEOUTS.ANALYSIS_LOCK) {
      addNotification('Analysis timed out. Ready to retry.', 'info', 3000, 'analysis-auto-reset');
      resetAnalysisState('Stuck analysis state after 5 minutes of inactivity');
    }
  }, [isAnalyzing, analysisProgress, addNotification, resetAnalysisState]);

  const getFileStateDisplay = useCallback(
    (filePath, hasAnalysis) => {
      const state = fileStates[filePath]?.state || 'pending';
      return getFileStateDisplayInfo(state, hasAnalysis);
    },
    [fileStates]
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-6 lg:gap-8 pb-6">
      {/* Header Section */}
      <Stack className="text-center flex-shrink-0" gap="compact">
        <Heading as="h1" variant="display">
          Discover & <span className="text-gradient">Analyze</span>
        </Heading>
        <Text variant="lead" className="max-w-xl mx-auto">
          Add your files and configure how StratoSort should name them.
        </Text>
      </Stack>

      {/* Toolbar */}
      <Inline className="justify-between" gap="cozy" wrap={false}>
        <Inline gap="compact">{/* Left side toolbar items if any */}</Inline>
        <Inline gap="relaxed" wrap>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowNamingSettings(true)}
            className="text-sm"
          >
            <Settings className="w-4 h-4 mr-2" />
            Naming Strategy
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openSearchModal('search')}
            className="text-sm"
            title="Open Knowledge OS (semantic graph + RAG)"
          >
            <Network className="w-4 h-4 mr-2" />
            Knowledge OS
          </Button>
        </Inline>
      </Inline>

      <Stack className="flex-1 min-h-0" gap="relaxed">
        {/* Primary Content Selection Card */}
        <Card className="flex-shrink-0">
          <Inline className="justify-between mb-6" gap="cozy" wrap>
            <Inline gap="cozy">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-stratosort-blue" />
                <Heading as="h3" variant="h5">
                  Select Content
                </Heading>
              </div>
              {unorganizedSelectedCount > 0 && (
                <StatusBadge variant="info">
                  {unorganizedSelectedCount} file{unorganizedSelectedCount !== 1 ? 's' : ''} ready
                </StatusBadge>
              )}
            </Inline>
          </Inline>

          <div
            className={`flex-1 flex flex-col items-center justify-center animate-fade-in text-center min-h-[200px] p-8 transition-colors duration-200 border-2 border-dashed rounded-xl ${
              isDragging ? 'border-stratosort-blue bg-stratosort-blue/5' : 'border-system-gray-200'
            }`}
            {...dragProps}
          >
            <div className="w-16 h-16 bg-gradient-to-br from-stratosort-blue to-stratosort-indigo shadow-lg flex items-center justify-center transform transition-transform hover:scale-105 duration-300 rounded-xl mb-4">
              <FolderOpen className="w-8 h-8 text-white" />
            </div>

            <Heading as="h2" variant="h4" className="mb-2">
              {isDragging ? 'Drop Files Here' : 'Add Files to Organize'}
            </Heading>
            <Text variant="small" className="max-w-sm mb-6">
              {isDragging
                ? 'Release to add these files to your analysis queue.'
                : 'Select documents or scan folders to let AI analyze your content and suggest the perfect organization structure.'}
            </Text>

            <SelectionControls
              onSelectFiles={handleFileSelection}
              onSelectFolder={handleFolderSelection}
              isScanning={isScanning}
              className="w-full max-w-sm justify-center"
            />
          </div>
        </Card>

        {/* Middle Section - Queue & Status Actions */}
        {shouldShowQueueBar && (
          <div className="sticky top-4 z-20">
            <Card className="bg-white/95 backdrop-blur-md p-4 shadow-lg border-stratosort-blue/20">
              <Inline className="justify-between" gap="default" wrap>
                <div className="flex items-center flex-1 min-w-0">
                  {isAnalyzing ? (
                    <div className="flex-1 max-w-2xl min-w-0">
                      <AnalysisProgress
                        progress={analysisProgress}
                        currentFile={currentAnalysisFile}
                        surface="none"
                      />
                    </div>
                  ) : (
                    <Inline className="text-sm text-system-gray-600" gap="cozy" wrap>
                      <span className="status-dot success animate-pulse" />
                      {pendingAnalysisCount > 0 ? (
                        <Text variant="small">
                          Ready to analyze {pendingAnalysisCount} file
                          {pendingAnalysisCount !== 1 ? 's' : ''}
                        </Text>
                      ) : (
                        <Text variant="small">
                          Analysis complete
                          {visibleReadyCount > 0 && ` • ${visibleReadyCount} ready`}
                          {visibleFailedCount > 0 && ` • ${visibleFailedCount} failed`}
                        </Text>
                      )}
                    </Inline>
                  )}
                </div>

                <Inline gap="default" wrap>
                  {isAnalyzing ? (
                    <>
                      <Button onClick={cancelAnalysis} variant="danger" size="sm">
                        Stop Analysis
                      </Button>
                      {analysisProgress.lastActivity &&
                        Date.now() - analysisProgress.lastActivity >
                          TIMEOUTS.STUCK_ANALYSIS_CHECK && (
                          <Button
                            onClick={() => resetAnalysisState('User forced reset')}
                            variant="warning"
                            size="sm"
                          >
                            Force Reset
                          </Button>
                        )}
                    </>
                  ) : (
                    <>
                      {pendingAnalysisCount > 0 && (
                        <Button
                          onClick={() => analyzeFiles?.(pendingAnalysisFiles)}
                          variant="primary"
                          size="sm"
                          className="shadow-md shadow-stratosort-blue/20"
                          title={analysisStartHint || undefined}
                        >
                          Analyze {pendingAnalysisCount} File{pendingAnalysisCount !== 1 ? 's' : ''}
                        </Button>
                      )}
                      {visibleFailedCount > 0 && (
                        <Button
                          onClick={retryFailedFiles}
                          variant="ghost"
                          size="sm"
                          className="text-stratosort-warning hover:text-stratosort-warning hover:bg-stratosort-warning/10"
                        >
                          Retry {visibleFailedCount} Failed
                        </Button>
                      )}
                      <Button
                        onClick={clearAnalysisQueue}
                        variant="ghost"
                        size="sm"
                        className="text-system-gray-500 hover:text-stratosort-danger hover:bg-stratosort-danger/10"
                      >
                        Clear Queue
                      </Button>
                    </>
                  )}
                </Inline>
              </Inline>
            </Card>
          </div>
        )}

        {/* Bottom Section - Results (or skeleton while analyzing) */}
        {(visibleAnalysisResults.length > 0 || (isAnalyzing && unorganizedSelectedCount > 0)) && (
          <Card className="flex-1 min-h-[400px] flex flex-col overflow-hidden p-0">
            <div className="border-b border-border-soft/70 bg-white/50 p-4 flex justify-between items-center">
              <Heading as="h3" variant="h5">
                Analysis Results
              </Heading>
              <Text variant="tiny" className="text-system-gray-500">
                {`${visibleReadyCount} successful, ${visibleFailedCount} failed`}
              </Text>
            </div>
            <div className="flex-1 min-h-0 bg-system-gray-50/30 overflow-hidden relative">
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
          </Card>
        )}
      </Stack>

      {/* Embedding Prompt Banner */}
      {showEmbeddingPrompt && !isAnalyzing && (
        <Card
          variant="hero"
          className="flex-shrink-0 border-stratosort-blue/30 bg-gradient-to-r from-stratosort-blue/5 to-stratosort-indigo/5"
        >
          <div className="flex items-start gap-4">
            <div className="p-2 bg-stratosort-blue/10 rounded-lg shrink-0">
              <Sparkles className="w-5 h-5 text-stratosort-blue" />
            </div>
            <div className="flex-1">
              <Heading as="h4" variant="h6" className="text-stratosort-blue mb-2">
                Enable Knowledge OS
              </Heading>
              <Text variant="small" className="mb-4">
                Knowledge OS uses a semantic index (file embeddings) to power the search graph and
                RAG responses. Your analysis history is present, but the index is currently empty.
              </Text>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleRebuildEmbeddings}
                  variant="primary"
                  size="sm"
                  disabled={isRebuildingEmbeddings}
                >
                  {isRebuildingEmbeddings ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                      Building...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Build Embeddings
                    </>
                  )}
                </Button>
                <Button onClick={() => dismissEmbeddingPrompt(false)} variant="ghost" size="sm">
                  Maybe Later
                </Button>
                <Button
                  onClick={() => {
                    dismissEmbeddingPrompt(true);
                    openSearchModal('search');
                  }}
                  variant="secondary"
                  size="sm"
                >
                  <Network className="w-4 h-4 mr-2" />
                  Open Knowledge OS
                </Button>
              </div>
            </div>
            <IconButton
              onClick={() => dismissEmbeddingPrompt(true)}
              variant="ghost"
              size="sm"
              icon={<X className="w-4 h-4" />}
            />
          </div>
        </Card>
      )}

      {/* Analysis Failure Recovery Banner */}
      {totalAnalysisFailure && (
        <Card variant="warning" className="flex-shrink-0">
          <div className="flex items-start gap-4">
            <AlertTriangle className="w-6 h-6 text-stratosort-warning flex-shrink-0" />
            <div className="flex-1">
              <Heading as="h4" variant="h6" className="text-stratosort-warning mb-2">
                All File Analyses Failed
              </Heading>
              <Text variant="small" className="mb-4">
                AI analysis could not process your files. This may be due to network issues,
                unsupported file types, or API limits.
              </Text>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    setTotalAnalysisFailure(false);
                    clearAnalysisQueue();
                  }}
                  variant="secondary"
                  size="sm"
                >
                  Clear and Try Again
                </Button>
                <Button
                  onClick={() => {
                    setTotalAnalysisFailure(false);
                    actions.advancePhase(PHASES?.ORGANIZE ?? 'organize');
                  }}
                  variant="secondary"
                  size="sm"
                >
                  Skip to Organize Phase →
                </Button>
              </div>
            </div>
            <IconButton
              onClick={() => setTotalAnalysisFailure(false)}
              variant="ghost"
              size="sm"
              icon={<X className="w-4 h-4" />}
            />
          </div>
        </Card>
      )}

      {/* Footer Navigation */}
      <ActionBar>
        <Button
          onClick={() => actions.advancePhase(PHASES?.SETUP ?? 'setup')}
          variant="secondary"
          size="md"
          className="w-full sm:w-auto min-w-[180px]"
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
            disabledReason = 'No analyzed or ready files. Add files or continue without analysis.';
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
                actions.advancePhase(PHASES?.ORGANIZE ?? 'organize');
              }}
              variant={totalAnalysisFailure ? 'secondary' : 'primary'}
              size="md"
              className="w-full sm:w-auto min-w-[180px]"
              disabled={
                isAnalyzing ||
                (visibleAnalysisResults.length === 0 &&
                  readySelectedFilesCount === 0 &&
                  !totalAnalysisFailure)
              }
              title={disabledReason || undefined}
            >
              {totalAnalysisFailure ? 'Continue Without Analysis →' : 'Continue to Organize →'}
            </Button>
          );
        })()}
      </ActionBar>

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
  );
}

export default DiscoverPhase;
