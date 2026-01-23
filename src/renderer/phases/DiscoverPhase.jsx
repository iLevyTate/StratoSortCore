/**
 * DiscoverPhase Component
 *
 * Main discover phase component for file selection and AI analysis.
 * Hooks and utilities extracted to phases/discover/ for maintainability.
 *
 * @module phases/DiscoverPhase
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { AlertTriangle, X, Sparkles, RefreshCw, Network } from 'lucide-react';
import { PHASES } from '../../shared/constants';
import { TIMEOUTS } from '../../shared/performanceConstants';
import { logger } from '../../shared/logger';
import { useNotification } from '../contexts/NotificationContext';
import { useFloatingSearch } from '../contexts/FloatingSearchContext';
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

// Helper to normalize paths for comparison (handles mixed / and \)
// FIX HIGH-6: Only lowercase on Windows - Linux/macOS filesystems are case-sensitive
const isWindowsPath = (p) => p && (p.includes('\\') || /^[A-Za-z]:/.test(p));
const normalizeForComparison = (path) => {
  if (!path) return '';
  const normalized = path.replace(/[\\/]+/g, '/');
  // Only lowercase on Windows paths (contains backslash or drive letter)
  return isWindowsPath(path) ? normalized.toLowerCase() : normalized;
};

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
    getCurrentPhase,
    organizedFiles // FIX H-3: Get organized files to filter from display
  } = useDiscoverState();

  const { addNotification } = useNotification();
  const { showConfirm, ConfirmDialog } = useConfirmDialog();
  const { openSearchModal } = useFloatingSearch();

  // Local UI state
  const [showNamingSettings, setShowNamingSettings] = useState(false);
  const [totalAnalysisFailure, setTotalAnalysisFailure] = useState(false);
  const [showEmbeddingPrompt, setShowEmbeddingPrompt] = useState(false);
  const [isRebuildingEmbeddings, setIsRebuildingEmbeddings] = useState(false);

  // Track previous analyzing state for detecting completion
  const prevAnalyzingRef = useRef(isAnalyzing);
  // FIX: Wrap localStorage access in try-catch for private browsing mode compatibility
  const hasShownEmbeddingPromptRef = useRef(
    (() => {
      try {
        return localStorage.getItem('stratosort_embedding_prompt_dismissed') === 'true';
      } catch {
        return false; // Private browsing mode or storage unavailable
      }
    })()
  );

  // Filter out results for files no longer selected (e.g., moved/cleared)
  // FIX: Normalize paths consistently to handle Windows/Unix separators and case
  const selectedPaths = useMemo(
    () =>
      new Set(
        (selectedFiles || [])
          .filter((f) => f && f.path) // FIX: Filter out null/undefined paths
          .map((f) => normalizeForComparison(f.path))
      ),
    [selectedFiles]
  );

  // FIX H-3: Create set of organized file paths for filtering
  const organizedPaths = useMemo(() => {
    const paths = new Set();
    (organizedFiles || []).forEach((f) => {
      // FIX: Ensure f exists and has path properties before processing
      if (!f) return;
      const path = f.originalPath || f.path;
      if (!path) return;

      // Normalize paths for comparison (handle Windows/Unix path separators and case)
      const normalizedPath = normalizeForComparison(path);
      paths.add(normalizedPath);
    });
    return paths;
  }, [organizedFiles]);

  const visibleAnalysisResults = useMemo(() => {
    return (analysisResults || []).filter((result) => {
      // FIX: Check if result and path exist
      if (!result || !result.path) return false;

      // FIX: Normalize path for consistent comparison across all path sets
      const normalizedResultPath = normalizeForComparison(result.path);
      // Must be in selected files
      if (!selectedPaths.has(normalizedResultPath)) return false;
      // FIX H-3: Must NOT be in organized files (already processed)
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

  // FIX H-3: Count of selected files that are NOT yet organized
  const unorganizedSelectedCount = useMemo(() => {
    return (selectedFiles || []).filter((f) => {
      if (!f || !f.path) return false;
      const normalizedPath = normalizeForComparison(f.path);
      return !organizedPaths.has(normalizedPath);
    }).length;
  }, [selectedFiles, organizedPaths]);

  // Files that have been selected but have no analysis result yet (still pending)
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

  // Check embeddings and prompt user after first successful analysis
  useEffect(() => {
    // Detect transition from analyzing -> not analyzing (analysis completed)
    const wasAnalyzing = prevAnalyzingRef.current;
    prevAnalyzingRef.current = isAnalyzing;

    // Early returns for non-completion scenarios
    if (!wasAnalyzing || isAnalyzing) return undefined; // Not a completion transition
    if (hasShownEmbeddingPromptRef.current) return undefined; // Already prompted this session
    if (visibleReadyCount === 0) return undefined; // No successful analyses

    // Check if embeddings exist
    const checkEmbeddings = async () => {
      try {
        const stats = await window.electronAPI?.embeddings?.getStats?.();
        // Only prompt when we have analysis history but the semantic search index is empty.
        // This avoids confusing prompts when a user hasn't analyzed anything yet.
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
          // No embeddings yet - show prompt
          setShowEmbeddingPrompt(true);
          hasShownEmbeddingPromptRef.current = true;
        }
      } catch (e) {
        logger.warn('Failed to check embedding stats', e);
      }
    };

    // FIX: Use centralized timeout constant
    const timeoutId = setTimeout(checkEmbeddings, TIMEOUTS.EMBEDDING_CHECK);
    return () => clearTimeout(timeoutId);
  }, [isAnalyzing, visibleReadyCount]);

  // Dismiss embedding prompt (with optional persistence)
  // FIX: Wrap localStorage setItem in try-catch for private browsing mode
  const dismissEmbeddingPrompt = useCallback((permanent = false) => {
    setShowEmbeddingPrompt(false);
    if (permanent) {
      try {
        localStorage.setItem('stratosort_embedding_prompt_dismissed', 'true');
      } catch {
        // Private browsing mode or storage unavailable - continue without persistence
      }
      hasShownEmbeddingPromptRef.current = true;
    }
  }, []);

  // Handle embedding rebuild from the prompt
  const handleRebuildEmbeddings = useCallback(async () => {
    setIsRebuildingEmbeddings(true);
    try {
      // Rebuild files (which is the main one users need)
      const res = await window.electronAPI?.embeddings?.rebuildFiles?.();
      if (res?.success) {
        addNotification(
          `Indexed ${res.files || 0} files for Knowledge OS`,
          'success',
          4000,
          'embedding-rebuild'
        );
        // Permanently dismiss since they built embeddings
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

  // Refs for analysis state
  // Note: hasResumedRef was previously used for resume logic that was moved to useAnalysis hook

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

  // FIX: Use refs to hold latest callbacks for stable event listener wrappers
  // This prevents listeners from being removed/re-added when callbacks change
  const handleFileSelectionRef = useRef(handleFileSelection);
  const handleFolderSelectionRef = useRef(handleFolderSelection);
  useEffect(() => {
    handleFileSelectionRef.current = handleFileSelection;
    handleFolderSelectionRef.current = handleFolderSelection;
  }, [handleFileSelection, handleFolderSelection]);

  // Listen for menu-triggered file/folder selection (Ctrl+O, Ctrl+Shift+O from menu)
  useEffect(() => {
    // FIX: Stable wrapper functions that read from refs
    // These never change identity, so listeners aren't constantly removed/added
    const onSelectFiles = () => handleFileSelectionRef.current?.();
    const onSelectFolder = () => handleFolderSelectionRef.current?.();

    window.addEventListener('app:select-files', onSelectFiles);
    window.addEventListener('app:select-folder', onSelectFolder);

    return () => {
      window.removeEventListener('app:select-files', onSelectFiles);
      window.removeEventListener('app:select-folder', onSelectFolder);
    };
  }, []); // Empty deps - listeners only registered once

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
    if (!isAnalyzing) return;

    const lastActivity = analysisProgress?.lastActivity || Date.now();
    const timeSinceActivity = Date.now() - lastActivity;
    const current = analysisProgress?.current || 0;
    const total = analysisProgress?.total || 0;

    // FIX: Use centralized timeout constant
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
      <div className="container-responsive flex flex-col flex-1 min-h-0 px-default pt-8 pb-default md:px-relaxed lg:px-spacious gap-6 lg:gap-8 max-w-6xl w-full mx-auto">
        {/* Header Section */}
        <div className="text-center flex flex-col flex-shrink-0 gap-compact">
          <h1 className="heading-primary text-xl md:text-2xl">
            Discover & <span className="text-gradient">Analyze</span>
          </h1>
          <p className="text-system-gray-600 leading-relaxed max-w-xl mx-auto text-sm md:text-base">
            Add your files and configure how StratoSort should name them.
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-cozy mb-2">
          <div className="flex items-center gap-compact">
            {/* Left side toolbar items if any */}
          </div>
          <div className="flex items-center gap-compact">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowNamingSettings(true)}
              className="text-sm gap-compact"
            >
              <SettingsIcon className="w-4 h-4" />
              <span>Naming Strategy</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openSearchModal('search')}
              className="text-sm gap-compact"
              title="Open Knowledge OS (semantic graph + RAG)"
            >
              <Network className="w-4 h-4" />
              <span>Knowledge OS</span>
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col gap-6">
          {/* Primary Content Selection Card */}
          <section className="surface-panel flex flex-col flex-shrink-0 gap-default">
            <div className="flex items-center justify-between flex-wrap gap-cozy">
              <div className="flex items-center gap-cozy">
                <h3 className="heading-tertiary m-0 flex items-center gap-cozy">
                  <FolderOpenIcon className="w-5 h-5 text-stratosort-blue" />
                  <span>Select Content</span>
                </h3>
                {/* FIX H-3: Use unorganizedSelectedCount to exclude already-organized files */}
                {unorganizedSelectedCount > 0 && (
                  <span className="status-chip info ml-2">
                    {unorganizedSelectedCount} file
                    {unorganizedSelectedCount !== 1 ? 's' : ''} ready
                  </span>
                )}
              </div>
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
          {/* FIX H-3: Use unorganizedSelectedCount to hide when all files organized */}
          {shouldShowQueueBar && (
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
                    <span className="status-dot success animate-pulse" />
                    {/* FIX H-3: Use pendingAnalysisCount to exclude already-analyzed files */}
                    {pendingAnalysisCount > 0 ? (
                      <>
                        Ready to analyze {pendingAnalysisCount} file
                        {pendingAnalysisCount !== 1 ? 's' : ''}
                      </>
                    ) : (
                      <>
                        Analysis complete
                        {visibleReadyCount > 0 && ` • ${visibleReadyCount} ready`}
                        {visibleFailedCount > 0 && ` • ${visibleFailedCount} failed`}
                      </>
                    )}
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
                      Date.now() - analysisProgress.lastActivity >
                        TIMEOUTS.STUCK_ANALYSIS_CHECK && (
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
                  <div className="flex items-center gap-cozy">
                    {pendingAnalysisCount > 0 && (
                      <Button
                        onClick={() => analyzeFiles?.(pendingAnalysisFiles)}
                        variant="primary"
                        size="sm"
                        className="shadow-md shadow-stratosort-blue/20"
                        title={analysisStartHint || undefined}
                      >
                        Analyze {pendingAnalysisCount} File
                        {pendingAnalysisCount !== 1 ? 's' : ''}
                      </Button>
                    )}
                    {/* FIX M-3: Retry Failed Files button */}
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
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Bottom Section - Results (or skeleton while analyzing) */}
          {/* FIX H-3: Use unorganizedSelectedCount to hide when all files organized */}
          {(visibleAnalysisResults.length > 0 || (isAnalyzing && unorganizedSelectedCount > 0)) && (
            <div className="flex-1 min-h-content-md surface-panel flex flex-col overflow-hidden animate-slide-up">
              <div className="border-b border-border-soft/70 bg-white/70 flex items-center justify-between p-default">
                <h3 className="heading-tertiary m-0 text-sm uppercase tracking-wider text-system-gray-500">
                  Analysis Results
                </h3>
                <div className="text-xs text-system-gray-500">
                  {/* FIX L-1: Remove duplicate "Analyzing files..." since progress bar already shows status */}
                  {`${visibleReadyCount} successful, ${visibleFailedCount} failed`}
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

        {/* Embedding Prompt Banner - shown after first successful analysis */}
        {showEmbeddingPrompt && !isAnalyzing && (
          <div className="flex-shrink-0 glass-panel border border-stratosort-blue/30 bg-gradient-to-r from-stratosort-blue/5 to-stratosort-indigo/5 backdrop-blur-md animate-fade-in p-default">
            <div className="flex items-start gap-cozy">
              <div className="p-2 bg-stratosort-blue/10 rounded-lg shrink-0">
                <Sparkles className="w-5 h-5 text-stratosort-blue" />
              </div>
              <div className="flex-1">
                <h4 className="heading-tertiary text-stratosort-blue mb-compact">
                  Enable Knowledge OS
                </h4>
                <p className="text-xs text-system-gray-700 mb-cozy">
                  Knowledge OS uses a semantic index (file embeddings) to power the search graph and
                  RAG responses. Your analysis history is present, but the index is currently empty
                  — this can happen after an update/reset. Building embeddings does{' '}
                  <strong>not</strong> re-analyze files; it indexes existing analysis so you can
                  search by meaning.
                </p>
                <div className="flex flex-wrap gap-compact">
                  <Button
                    onClick={handleRebuildEmbeddings}
                    variant="primary"
                    size="sm"
                    disabled={isRebuildingEmbeddings}
                  >
                    {isRebuildingEmbeddings ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Building...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Build Embeddings</span>
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => dismissEmbeddingPrompt(false)}
                    variant="ghost"
                    size="sm"
                    title="Dismiss for now (will ask again next session)"
                  >
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
                    <Network className="w-4 h-4" />
                    <span>Open Knowledge OS</span>
                  </Button>
                </div>
              </div>
              <Button
                onClick={() => dismissEmbeddingPrompt(true)}
                variant="ghost"
                size="sm"
                className="text-system-gray-400 hover:text-system-gray-600 p-compact"
                aria-label="Dismiss permanently"
                title="Don't show this again"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

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
                      actions.advancePhase(PHASES?.ORGANIZE ?? 'organize');
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
        <div className="page-action-bar">
          <Button
            onClick={() => actions.advancePhase(PHASES?.SETUP ?? 'setup')}
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
                  actions.advancePhase(PHASES?.ORGANIZE ?? 'organize');
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
