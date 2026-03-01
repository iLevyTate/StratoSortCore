/**
 * Analysis Hook
 *
 * Custom hook for file analysis logic and state management.
 * Extracted from DiscoverPhase for better maintainability.
 *
 * @module phases/discover/useAnalysis
 */

import { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import { useStore } from 'react-redux';
import { PHASES, FILE_STATES } from '../../../shared/constants';
import { TIMEOUTS, CONCURRENCY, RETRY } from '../../../shared/performanceConstants';
import { createLogger } from '../../../shared/logger';
import { embeddingsIpc } from '../../services/ipc';
import {
  validateProgressState,
  generatePreviewName as generatePreviewNameUtil,
  generateSuggestedNameFromAnalysis,
  makeUniqueFileName,
  extractFileName
} from './namingUtils';

const logger = createLogger('DiscoverPhase:Analysis');
const BATCH_ANALYSIS_MIN_FILES = 40;
const BATCH_ANALYSIS_PROGRESS_EVENT = 'operation-progress';
// Auto-advance timeout is now stored in a ref within the hook to prevent
// cross-component interference when hook unmounts and remounts

/**
 * Clear auto-advance timeout from ref
 * @param {React.MutableRefObject} autoAdvanceTimeoutRef - Ref containing timeout ID
 */
function clearAutoAdvanceTimeoutRef(autoAdvanceTimeoutRef) {
  if (autoAdvanceTimeoutRef?.current) {
    clearTimeout(autoAdvanceTimeoutRef.current);
    autoAdvanceTimeoutRef.current = null;
  }
}

/**
 * Analyze a file with retry logic for transient failures.
 * Extracted from analyzeFiles for better testability.
 *
 * @param {string} filePath - Path to the file to analyze
 * @param {number} attempt - Current attempt number (1-based)
 * @returns {Promise<Object>} Analysis result
 */
async function analyzeWithRetry(filePath, attempt = 1, abortSignal = null) {
  // Ensure electronAPI is available before attempting analysis
  if (!window.electronAPI?.files?.analyze) {
    throw new Error(
      'File analysis API not available. The application may not have loaded correctly.'
    );
  }

  try {
    return await window.electronAPI.files.analyze(filePath);
  } catch (error) {
    const isTransient =
      error.message?.includes('timeout') ||
      error.message?.includes('network') ||
      error.message?.includes('ECONNREFUSED');

    if (attempt < RETRY.MAX_ATTEMPTS_MEDIUM && isTransient) {
      // Check abort signal before waiting for retry delay
      if (abortSignal?.aborted) {
        throw new Error('Analysis cancelled by user', { cause: error });
      }
      const delay = RETRY.INITIAL_DELAY * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
      // Check again after delay in case cancellation happened during wait
      if (abortSignal?.aborted) {
        throw new Error('Analysis cancelled by user', { cause: error });
      }
      return analyzeWithRetry(filePath, attempt + 1, abortSignal);
    }
    throw error;
  }
}

function shouldUseBatchAnalysis(fileCount, concurrency) {
  if (!Number.isFinite(fileCount) || fileCount <= 0) return false;
  if (fileCount < BATCH_ANALYSIS_MIN_FILES) return false;
  return Number(concurrency) <= 2;
}

function withTimeout(promise, timeoutMs, label) {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(`${label} timed out after ${timeoutMs}ms`);
      err.code = 'ANALYSIS_TIMEOUT';
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function hasFallbackSuggestion(analysis) {
  return Boolean(analysis?.suggestedName || analysis?.category);
}

function normalizeAnalysisForUi(analysis) {
  if (!analysis || !analysis.error) return analysis;
  const { error, ...rest } = analysis;
  return {
    ...rest,
    warning: error,
    hadError: true
  };
}

/**
 * Merge new analysis results with existing results.
 *
 * @param {Array} existingResults - Previous analysis results
 * @param {Array} newResults - New results to merge
 * @returns {Array} Merged results array
 */
function mergeAnalysisResults(existingResults, newResults) {
  const resultsByPath = new Map((existingResults || []).map((r) => [r.path, r]));
  newResults.forEach((r) => resultsByPath.set(r.path, r));
  return Array.from(resultsByPath.values());
}

/**
 * De-duplicate suggested names across the current result set.
 * This prevents multiple similar files from ending up with identical suggested names in the UI.
 *
 * NOTE: Actual filesystem collision handling is also performed during organize operations.
 */
function dedupeSuggestedNames(results) {
  const used = new Map();
  let changed = false;

  const next = (results || []).map((r) => {
    if (!r?.analysis?.suggestedName) return r;
    const unique = makeUniqueFileName(r.analysis.suggestedName, used);
    if (unique === r.analysis.suggestedName) return r;
    changed = true;
    return {
      ...r,
      analysis: {
        ...r.analysis,
        suggestedName: unique
      }
    };
  });

  return changed ? next : results;
}

/**
 * Merge file states with new analysis results.
 *
 * @param {Object} existingStates - Previous file states
 * @param {Array} results - Analysis results to merge
 * @returns {Object} Merged file states
 */
function mergeFileStates(existingStates, results) {
  const mergedStates = { ...(existingStates || {}) };
  results.forEach((result) => {
    if (result.analysis && !result.error) {
      mergedStates[result.path] = {
        state: 'ready',
        timestamp: new Date().toISOString(),
        analysis: result.analysis,
        name: result.name,
        size: result.size,
        created: result.created,
        modified: result.modified
      };
    } else if (result.error) {
      mergedStates[result.path] = {
        state: 'error',
        timestamp: new Date().toISOString(),
        error: result.error,
        name: result.name,
        size: result.size,
        created: result.created,
        modified: result.modified
      };
    }
  });
  return mergedStates;
}

/**
 * Show appropriate notification based on analysis results.
 *
 * @param {Object} params - Parameters
 * @param {number} params.successCount - Number of successful analyses
 * @param {number} params.failureCount - Number of failed analyses
 * @param {Function} params.addNotification - Notification function
 * @param {Object} params.actions - Phase actions
 * @param {Function} params.getCurrentPhase - Function to get current phase (prevents race condition)
 * @param {React.MutableRefObject} params.autoAdvanceTimeoutRef - Ref for auto-advance timeout (FIX Issue 4)
 */
function showAnalysisCompletionNotification({
  successCount,
  failureCount,
  addNotification,
  actions,
  getCurrentPhase,
  autoAdvanceTimeoutRef
}) {
  if (successCount > 0 && failureCount === 0) {
    addNotification(
      `Analysis complete! ${successCount} files ready`,
      'success',
      4000,
      'analysis-complete'
    );
    clearAutoAdvanceTimeoutRef(autoAdvanceTimeoutRef); // Clear any previous pending timeout
    autoAdvanceTimeoutRef.current = setTimeout(() => {
      autoAdvanceTimeoutRef.current = null;
      // Check if still in DISCOVER phase before auto-advancing
      // This prevents unexpected navigation if user moved away during the delay
      const currentPhase = getCurrentPhase?.();
      if (currentPhase === (PHASES?.DISCOVER ?? 'discover')) {
        actions.advancePhase(PHASES?.ORGANIZE ?? 'organize');
      } else {
        logger.debug('Skipping auto-advance: phase changed during delay', {
          currentPhase,
          expectedPhase: PHASES?.DISCOVER ?? 'discover'
        });
      }
    }, 2000);
  } else if (successCount > 0) {
    addNotification(
      `Analysis complete: ${successCount} successful, ${failureCount} failed`,
      'warning',
      4000,
      'analysis-complete'
    );
    clearAutoAdvanceTimeoutRef(autoAdvanceTimeoutRef); // Clear any previous pending timeout
    autoAdvanceTimeoutRef.current = setTimeout(() => {
      autoAdvanceTimeoutRef.current = null;
      // Check if still in DISCOVER phase before auto-advancing
      const currentPhase = getCurrentPhase?.();
      if (currentPhase === (PHASES?.DISCOVER ?? 'discover')) {
        actions.advancePhase(PHASES?.ORGANIZE ?? 'organize');
      } else {
        logger.debug('Skipping auto-advance: phase changed during delay', {
          currentPhase,
          expectedPhase: PHASES?.DISCOVER ?? 'discover'
        });
      }
    }, 2000);
  } else if (failureCount > 0) {
    addNotification(
      `Analysis failed for all ${failureCount} files.`,
      'error',
      8000,
      'analysis-complete'
    );
    actions.setPhaseData('totalAnalysisFailure', true);
  }
}

/**
 * Custom hook for analysis operations
 * @param {Object} options - Hook options
 * @param {Array} options.selectedFiles - Currently selected files
 * @param {Object} options.fileStates - Current file states map
 * @param {Array} options.analysisResults - Existing analysis results
 * @param {boolean} options.isAnalyzing - Whether analysis is in progress
 * @param {Object} options.analysisProgress - Progress tracking object
 * @param {Object} options.namingSettings - Naming convention settings
 * @param {Object} options.setters - State setter functions
 * @param {Function} options.updateFileState - File state update function
 * @param {Function} options.addNotification - Notification function
 * @param {Object} options.actions - Phase actions
 * @param {Function} options.getCurrentPhase - Function to get current phase (for race condition prevention)
 * @returns {Object} Analysis functions and state
 */
export function useAnalysis(options = {}) {
  const store = useStore();
  const {
    selectedFiles = [],
    fileStates = {},
    analysisResults = [],
    isAnalyzing = false,
    analysisProgress = { current: 0, total: 0 },
    namingSettings: rawNamingSettings = {},
    setters: {
      setIsAnalyzing = () => {},
      setAnalysisProgress = () => {},
      setCurrentAnalysisFile = () => {},
      setAnalysisResults = () => {},
      setFileStates = () => {}
    } = {},
    updateFileState = () => {},
    addNotification = () => {},
    actions = { setPhaseData: () => {}, advancePhase: () => {} },
    getCurrentPhase = () => {}
  } = options;

  // Stabilize namingSettings reference: only produce a new object when contents change.
  const namingSettings = useMemo(() => rawNamingSettings, [rawNamingSettings]);

  const hasResumedRef = useRef(false);
  const analysisLockRef = useRef(false);
  const [globalAnalysisActive, setGlobalAnalysisActive] = useState(false);
  const analyzeFilesRef = useRef(null);
  const heartbeatIntervalRef = useRef(null);
  const analysisTimeoutRef = useRef(null);
  const lockTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);
  const pendingFilesRef = useRef([]);
  const batchCompletedPathsRef = useRef(new Set());
  const cancelledBatchSnapshotRef = useRef(null);
  const batchResultsRef = useRef([]);
  const pendingResultsRef = useRef([]);
  const lastResultsFlushRef = useRef(0);
  const RESULTS_FLUSH_MS = 200;
  const autoAdvanceTimeoutRef = useRef(null);
  const clearCurrentFileTimeoutRef = useRef(null);
  const pendingFilesTimeoutRef = useRef(null);
  // Using a counter ref that workers increment atomically when they complete
  const completedCountRef = useRef(0);
  const lastProgressDispatchRef = useRef(0);
  const PROGRESS_THROTTLE_MS = 50;
  const isMountedRef = useRef(true);

  // Refs to track current state values (prevents stale closures in callbacks)
  // This is safe because ref assignments are idempotent and don't cause side effects.
  const isAnalyzingRef = useRef(isAnalyzing);
  const globalAnalysisActiveRef = useRef(globalAnalysisActive);
  const analysisResultsRef = useRef(analysisResults);
  const fileStatesRef = useRef(fileStates);
  const analysisProgressRef = useRef(analysisProgress);
  const analysisRunIdRef = useRef(0);
  const lastProgressAtRef = useRef(0);
  const activeBatchIdRef = useRef(null);
  const cancelInFlightBatchIdRef = useRef(null);

  const invalidateEmbeddingStatsCache = useCallback(() => {
    try {
      embeddingsIpc.invalidateStatsCache();
    } catch {
      // Non-fatal: stale stats are preferable to interrupting analysis flow.
    }
  }, []);

  // Sync refs during render (avoids useEffect overhead)
  isAnalyzingRef.current = isAnalyzing;
  globalAnalysisActiveRef.current = globalAnalysisActive;
  analysisResultsRef.current = analysisResults;
  fileStatesRef.current = fileStates;
  analysisProgressRef.current = analysisProgress;

  const flushPendingResults = useCallback(
    (force = false) => {
      if (!pendingResultsRef.current.length) return;

      const now = Date.now();
      if (!force && now - lastResultsFlushRef.current < RESULTS_FLUSH_MS) {
        return;
      }

      lastResultsFlushRef.current = now;
      const pending = pendingResultsRef.current;
      pendingResultsRef.current = [];

      const mergedResults = dedupeSuggestedNames(
        mergeAnalysisResults(analysisResultsRef.current, pending)
      );
      const mergedStates = mergeFileStates(fileStatesRef.current, pending);

      // Keep refs in sync to avoid stale merges between flushes
      analysisResultsRef.current = mergedResults;
      fileStatesRef.current = mergedStates;

      setAnalysisResults(mergedResults);
      setFileStates(mergedStates);
    },
    [setAnalysisResults, setFileStates]
  );

  const recordAnalysisResult = useCallback(
    (result) => {
      batchResultsRef.current.push(result);
      pendingResultsRef.current.push(result);
      flushPendingResults();
    },
    [flushPendingResults]
  );

  const requeueInFlightFileStates = useCallback(() => {
    setFileStates((prev) => {
      if (!prev || typeof prev !== 'object') return prev;
      let hasChanges = false;
      const next = { ...prev };
      Object.entries(next).forEach(([filePath, stateInfo]) => {
        if (!stateInfo || stateInfo.state !== 'analyzing') return;
        hasChanges = true;
        next[filePath] = {
          ...stateInfo,
          state: FILE_STATES.PENDING
        };
      });
      return hasChanges ? next : prev;
    });
  }, [setFileStates]);

  const captureCancelledBatchSnapshot = useCallback((runId = analysisRunIdRef.current) => {
    cancelledBatchSnapshotRef.current = {
      runId,
      completedAtCancel: Math.max(0, Number(completedCountRef.current) || 0),
      completedPaths: Array.from(batchCompletedPathsRef.current)
    };
  }, []);

  const requestMainBatchCancel = useCallback((reason = 'cancelled') => {
    const batchId = activeBatchIdRef.current;
    const cancelBatchApi = window?.electronAPI?.analysis?.cancelBatch;
    if (!batchId || typeof cancelBatchApi !== 'function') {
      return;
    }
    if (cancelInFlightBatchIdRef.current === batchId) {
      return;
    }

    cancelInFlightBatchIdRef.current = batchId;
    Promise.resolve(cancelBatchApi({ batchId, reason }))
      .then((response) => {
        logger.info('Main-process batch cancel acknowledged', {
          batchId,
          cancelled: Boolean(response?.cancelled),
          notFound: Boolean(response?.notFound)
        });
      })
      .catch((error) => {
        logger.warn('Main-process batch cancel request failed', {
          batchId,
          reason,
          error: error?.message
        });
      })
      .finally(() => {
        if (cancelInFlightBatchIdRef.current === batchId) {
          cancelInFlightBatchIdRef.current = null;
        }
      });
  }, []);

  /**
   * Reset analysis state
   */
  const resetAnalysisState = useCallback(
    (reason) => {
      logger.info('Resetting analysis state', { reason });
      invalidateEmbeddingStatsCache();
      const activeRunId = analysisRunIdRef.current;
      captureCancelledBatchSnapshot(activeRunId);
      requestMainBatchCancel('reset-analysis-state');
      analysisRunIdRef.current = activeRunId + 1;
      // Ensure any in-flight analysis is stopped and locks are released.
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      analysisLockRef.current = false;
      isAnalyzingRef.current = false;
      setGlobalAnalysisActive(false);
      globalAnalysisActiveRef.current = false;
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      if (analysisTimeoutRef.current) {
        clearTimeout(analysisTimeoutRef.current);
        analysisTimeoutRef.current = null;
      }
      if (lockTimeoutRef.current) {
        clearTimeout(lockTimeoutRef.current);
        lockTimeoutRef.current = null;
      }
      if (clearCurrentFileTimeoutRef.current) {
        clearTimeout(clearCurrentFileTimeoutRef.current);
        clearCurrentFileTimeoutRef.current = null;
      }
      if (pendingFilesTimeoutRef.current) {
        clearTimeout(pendingFilesTimeoutRef.current);
        pendingFilesTimeoutRef.current = null;
      }
      pendingFilesRef.current = [];
      batchCompletedPathsRef.current.clear();
      activeBatchIdRef.current = null;
      cancelInFlightBatchIdRef.current = null;
      flushPendingResults(true);
      requeueInFlightFileStates();

      setIsAnalyzing(false);
      const clearedProgress = { current: 0, total: 0, currentFile: '', lastActivity: 0 };
      analysisProgressRef.current = clearedProgress;
      setAnalysisProgress(clearedProgress);
      setCurrentAnalysisFile('');
      actions.setPhaseData('currentAnalysisFile', '');

      try {
        localStorage.removeItem('stratosort_workflow_state');
      } catch {
        // Non-fatal
      }
    },
    [
      invalidateEmbeddingStatsCache,
      setIsAnalyzing,
      setAnalysisProgress,
      setCurrentAnalysisFile,
      setGlobalAnalysisActive,
      captureCancelledBatchSnapshot,
      requestMainBatchCancel,
      flushPendingResults,
      requeueInFlightFileStates,
      actions
    ]
  );

  /**
   * Generate preview name with current settings
   */
  const generatePreviewName = useCallback(
    (originalName) => {
      return generatePreviewNameUtil(originalName, namingSettings);
    },
    [namingSettings]
  );

  const generateSuggestedName = useCallback(
    (originalFileName, analysis, fileTimestamps) => {
      return generateSuggestedNameFromAnalysis({
        originalFileName,
        analysis,
        settings: namingSettings,
        fileTimestamps
      });
    },
    [namingSettings]
  );

  const applyAnalysisOutcome = useCallback(
    (fileInfo, rawAnalysis, explicitError = null) => {
      const fileName = fileInfo?.name || extractFileName(fileInfo?.path || '');
      const analyzedAt = new Date().toISOString();

      if (explicitError) {
        recordAnalysisResult({
          ...fileInfo,
          analysis: null,
          error: explicitError,
          status: FILE_STATES.ERROR,
          analyzedAt
        });
        updateFileState(fileInfo.path, 'error', {
          error: explicitError,
          analyzedAt
        });
        return;
      }

      const analysisForUi = normalizeAnalysisForUi(rawAnalysis);
      const shouldTreatAsReady =
        analysisForUi && (!analysisForUi.hadError || hasFallbackSuggestion(analysisForUi));

      if (shouldTreatAsReady) {
        const baseSuggestedName = analysisForUi.suggestedName || fileName;
        const enhancedAnalysis = {
          ...analysisForUi,
          originalSuggestedName: baseSuggestedName,
          suggestedName: generateSuggestedName(fileName, analysisForUi, {
            created: fileInfo.created,
            modified: fileInfo.modified
          }),
          namingConvention: namingSettings
        };

        recordAnalysisResult({
          ...fileInfo,
          analysis: enhancedAnalysis,
          status: FILE_STATES.CATEGORIZED,
          analyzedAt
        });
        updateFileState(fileInfo.path, 'ready', {
          analysis: enhancedAnalysis,
          analyzedAt,
          name: fileInfo.name,
          size: fileInfo.size,
          created: fileInfo.created,
          modified: fileInfo.modified
        });
        return;
      }

      const errorMessage = analysisForUi?.warning || rawAnalysis?.error || 'Analysis failed';
      recordAnalysisResult({
        ...fileInfo,
        analysis: null,
        error: errorMessage,
        status: FILE_STATES.ERROR,
        analyzedAt
      });
      updateFileState(fileInfo.path, 'error', {
        error: errorMessage,
        analyzedAt
      });
    },
    [generateSuggestedName, namingSettings, recordAnalysisResult, updateFileState]
  );

  /**
   * Re-apply naming convention to existing analyses when settings change.
   * Keeps Discover and Organize screens in sync with the user-selected naming.
   */
  // Track the last applied naming settings to prevent unnecessary re-renders
  const lastAppliedNamingRef = useRef(null);

  useEffect(() => {
    // Compare by primitive values to detect actual changes (avoids JSON.stringify on every run)
    const key = `${namingSettings?.convention ?? ''}|${namingSettings?.separator ?? ''}|${namingSettings?.dateFormat ?? ''}|${namingSettings?.caseConvention ?? ''}`;
    if (lastAppliedNamingRef.current === key) {
      return; // Settings haven't changed, skip update
    }
    lastAppliedNamingRef.current = key;

    setAnalysisResults((prev) => {
      if (!prev || prev.length === 0) return prev;

      // Check if any result actually needs updating
      let hasChanges = false;
      const updated = prev.map((result) => {
        if (!result?.analysis) return result;

        const newName = generateSuggestedName(
          result.name || extractFileName(result.path || ''),
          result.analysis,
          { created: result.created, modified: result.modified }
        );

        // Only create new object if name actually changed
        if (result.analysis.suggestedName === newName) {
          return result;
        }

        hasChanges = true;
        return {
          ...result,
          analysis: {
            ...result.analysis,
            suggestedName: newName,
            namingConvention: namingSettings,
            originalSuggestedName:
              result.analysis.originalSuggestedName ||
              result.analysis.suggestedName ||
              result.name ||
              extractFileName(result.path || '')
          }
        };
      });

      // Only return new array if there were actual changes
      const withNamingApplied = hasChanges ? updated : prev;
      return dedupeSuggestedNames(withNamingApplied);
    });

    setFileStates((prev) => {
      if (!prev || Object.keys(prev).length === 0) return prev;

      let hasChanges = false;
      const next = { ...prev };

      Object.entries(next).forEach(([filePath, state]) => {
        if (!state?.analysis) return;

        const newName = generateSuggestedName(
          state.name || extractFileName(filePath),
          state.analysis,
          {
            created: state.created,
            modified: state.modified
          }
        );

        // Only update if name actually changed
        if (state.analysis.suggestedName === newName) {
          return;
        }

        hasChanges = true;
        next[filePath] = {
          ...state,
          analysis: {
            ...state.analysis,
            suggestedName: newName,
            namingConvention: namingSettings,
            originalSuggestedName:
              state.analysis.originalSuggestedName ||
              state.analysis.suggestedName ||
              state.name ||
              extractFileName(filePath)
          }
        };
      });

      // Only return new object if there were actual changes
      return hasChanges ? next : prev;
    });
  }, [namingSettings, generateSuggestedName, setAnalysisResults, setFileStates]);

  /**
   * Main analysis function
   */
  const analyzeFiles = useCallback(
    async (files) => {
      if (!files || files.length === 0) {
        addNotification('No files queued for analysis.', 'info', 2000, 'analysis-empty');
        return;
      }

      // Atomic lock acquisition (use refs to avoid stale closures)
      const tryAcquireLock = () => {
        const state = store.getState();
        const isReduxAnalyzing = state.analysis.isAnalyzing;
        if (
          analysisLockRef.current ||
          globalAnalysisActiveRef.current ||
          isAnalyzingRef.current ||
          isReduxAnalyzing
        ) {
          logger.debug('Analysis lock not acquired', {
            locked: analysisLockRef.current,
            global: globalAnalysisActiveRef.current,
            isAnalyzing: isAnalyzingRef.current,
            isReduxAnalyzing
          });
          return false;
        }
        analysisLockRef.current = true;
        return true;
      };

      let lockAcquired = tryAcquireLock();

      if (!lockAcquired) {
        const state = store.getState();
        const progress = state.analysis.progress || analysisProgressRef.current;
        const lastActivity = Number.isFinite(progress?.lastActivity) ? progress.lastActivity : 0;
        const inactivityMs = lastActivity ? Date.now() - lastActivity : Infinity;
        const staleThreshold = TIMEOUTS.ANALYSIS_LOCK || 5 * 60 * 1000;

        if (inactivityMs > staleThreshold) {
          logger.warn('Stale analysis lock detected, resetting', {
            inactivityMs,
            lastActivity,
            thresholdMs: staleThreshold
          });
          resetAnalysisState('Stale analysis lock detected');
          lockAcquired = tryAcquireLock();
        }
      }

      if (!lockAcquired) {
        // Queue files for analysis when current batch completes
        logger.debug('Lock already held, queueing files for later', {
          fileCount: files.length
        });
        pendingFilesRef.current = [
          ...pendingFilesRef.current,
          ...files.filter((f) => !pendingFilesRef.current.some((p) => p.path === f.path))
        ];
        addNotification(
          'Analysis already running. Files queued to run next.',
          'info',
          2500,
          'analysis-queued'
        );
        return;
      }

      const runId = ++analysisRunIdRef.current;
      const isActiveRun = () => analysisRunIdRef.current === runId;
      cancelledBatchSnapshotRef.current = null;
      batchCompletedPathsRef.current.clear();

      // This prevents the resume useEffect from showing "Resuming..." notification
      // for a brand new analysis. The resume logic should only trigger when isAnalyzing
      // was already true on component mount (e.g., from persisted state after page refresh).
      // Setting this after lock acquisition ensures we don't permanently disable resume
      // logic when the lock wasn't acquired and we returned early.
      hasResumedRef.current = true;

      setGlobalAnalysisActive(true);
      abortControllerRef.current = new AbortController();
      const abortSignal = abortControllerRef.current.signal;

      if (abortSignal.aborted) {
        analysisLockRef.current = false;
        setGlobalAnalysisActive(false);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Safety timeout - store in ref for proper cleanup
      const scheduleLockTimeoutCheck = () => {
        lockTimeoutRef.current = setTimeout(() => {
          if (!isActiveRun()) {
            lockTimeoutRef.current = null;
            return;
          }

          const lastProgressAt = Number.isFinite(lastProgressAtRef.current)
            ? lastProgressAtRef.current
            : 0;
          const inactivityMs = lastProgressAt ? Date.now() - lastProgressAt : Infinity;
          const thresholdMs = TIMEOUTS.ANALYSIS_LOCK;

          if (inactivityMs < thresholdMs) {
            scheduleLockTimeoutCheck();
            return;
          }

          logger.warn('Analysis lock timeout, forcing release', {
            inactivityMs,
            lastProgressAt,
            thresholdMs
          });
          resetAnalysisState('Analysis lock timeout');
          lockTimeoutRef.current = null;
        }, TIMEOUTS.ANALYSIS_LOCK);
      };
      scheduleLockTimeoutCheck();

      // This prevents "stuck" progress bars where processed count < total due to internal skipping
      const uniqueFiles = files.filter(
        (file, index, self) => index === self.findIndex((f) => f.path === file.path)
      );

      setIsAnalyzing(true);
      lastProgressAtRef.current = Date.now();
      const initialProgress = {
        current: 0,
        total: uniqueFiles.length,
        lastActivity: Date.now()
      };
      setAnalysisProgress(initialProgress);
      setCurrentAnalysisFile('');
      // Redux is the single source of truth for isAnalyzing.
      // Avoid redundant dispatch via actions.setPhaseData which can reset totals.

      // This ensures heartbeat and progress updates are consistent with Redux state
      const localAnalyzingRef = { current: true };

      // Heartbeat interval - just updates lastActivity to keep analysis alive
      heartbeatIntervalRef.current = setInterval(() => {
        if (!isActiveRun()) {
          if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
            heartbeatIntervalRef.current = null;
          }
          return;
        }
        if (localAnalyzingRef.current) {
          const state = store.getState();
          const prev = state.analysis.progress || analysisProgressRef.current;
          const currentProgress = {
            current: prev?.current || 0,
            total: prev?.total || uniqueFiles.length,
            lastActivity: Date.now()
          };

          if (validateProgressState(currentProgress)) {
            // Only update lastActivity - progress counts are updated by processFile
            setAnalysisProgress(currentProgress);
          } else {
            logger.warn('Invalid heartbeat progress, resetting');
            if (heartbeatIntervalRef.current) {
              clearInterval(heartbeatIntervalRef.current);
              heartbeatIntervalRef.current = null;
            }
            resetAnalysisState('Invalid heartbeat progress');
          }
        }
      }, TIMEOUTS.HEARTBEAT_INTERVAL);

      // Global analysis watchdog:
      // - inactivity timeout: reset only when there is no progress for GLOBAL_ANALYSIS window
      // - hard cap timeout: absolute upper bound to avoid runaway background loops
      const analysisStartedAt = Date.now();
      const fallbackPerFileMs = 45000;
      const maxHardCapMs = 6 * 60 * 60 * 1000;
      const baselineHardCapMs = Math.max(TIMEOUTS.GLOBAL_ANALYSIS * 6, 60 * 60 * 1000);
      let hardCapMs = baselineHardCapMs;
      let hardCapLabel = `${Math.round(hardCapMs / 60000)} min`;
      const windowLabel = `${Math.round(TIMEOUTS.GLOBAL_ANALYSIS / 60000)} min`;
      const stopAnalysisForTimeout = (reason) => {
        logger.warn('Global analysis timeout', {
          reason,
          windowLabel,
          hardCapLabel
        });
        captureCancelledBatchSnapshot(runId);
        if (analysisRunIdRef.current === runId) {
          analysisRunIdRef.current += 1;
        }
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        analysisLockRef.current = false;
        localAnalyzingRef.current = false;
        setGlobalAnalysisActive(false);
        if (lockTimeoutRef.current) {
          clearTimeout(lockTimeoutRef.current);
          lockTimeoutRef.current = null;
        }
        flushPendingResults(true);
        pendingFilesRef.current = [];
        requeueInFlightFileStates();
        setIsAnalyzing(false);
        setAnalysisProgress({ current: 0, total: 0, lastActivity: 0 });
        setCurrentAnalysisFile('');
        actions.setPhaseData('currentAnalysisFile', '');
        const timeoutMessage =
          reason === 'hard_cap'
            ? `Analysis exceeded the safety window (${hardCapLabel}). Consider reducing file count per run.`
            : `Analysis was stopped after no progress for ${windowLabel}.`;
        addNotification(timeoutMessage, 'warning', 5000, 'analysis-timeout');
      };
      const scheduleGlobalTimeoutCheck = () => {
        analysisTimeoutRef.current = setTimeout(() => {
          if (!isActiveRun()) {
            analysisTimeoutRef.current = null;
            return;
          }
          const elapsedMs = Date.now() - analysisStartedAt;
          const lastProgressAt = Number.isFinite(lastProgressAtRef.current)
            ? lastProgressAtRef.current
            : 0;
          const inactivityMs = lastProgressAt ? Date.now() - lastProgressAt : Infinity;
          const state = store.getState();
          const progressState = state.analysis.progress || analysisProgressRef.current || {};
          const hasCompleted =
            Number(progressState.total) > 0 &&
            Number(progressState.current) >= Number(progressState.total);

          if (hasCompleted) {
            analysisTimeoutRef.current = null;
            return;
          }
          if (elapsedMs >= hardCapMs) {
            stopAnalysisForTimeout('hard_cap');
            analysisTimeoutRef.current = null;
            return;
          }
          if (inactivityMs >= TIMEOUTS.GLOBAL_ANALYSIS) {
            stopAnalysisForTimeout('inactivity');
            analysisTimeoutRef.current = null;
            return;
          }
          scheduleGlobalTimeoutCheck();
        }, TIMEOUTS.GLOBAL_ANALYSIS);
      };
      scheduleGlobalTimeoutCheck();

      batchResultsRef.current = [];
      pendingResultsRef.current = [];
      lastResultsFlushRef.current = 0;
      let maxConcurrent = CONCURRENCY.DEFAULT_WORKERS;

      try {
        // Get system-recommended value based on VRAM (primary source)
        let systemRecommended = CONCURRENCY.DEFAULT_WORKERS;
        try {
          const getConcurrency = window?.electronAPI?.system?.getRecommendedConcurrency;
          if (typeof getConcurrency === 'function') {
            const recommendation = await getConcurrency();
            if (recommendation?.success && recommendation.maxConcurrent) {
              systemRecommended = recommendation.maxConcurrent;
              logger.info('System-recommended concurrency:', {
                maxConcurrent: recommendation.maxConcurrent,
                reason: recommendation.reason,
                vramMB: recommendation.vramMB
              });
            }
          }
        } catch {
          // Fall back to default if recommendation fails
        }

        // Use system recommendation as the baseline
        maxConcurrent = systemRecommended;

        // Only allow user override if they explicitly set it AND it doesn't exceed system recommendation
        // This prevents users with old settings (e.g., 3) from exhausting VRAM on low-memory GPUs
        const getSettings = window?.electronAPI?.settings?.get;
        if (typeof getSettings === 'function') {
          const persistedSettings = await getSettings();
          if (persistedSettings?.maxConcurrentAnalysis !== undefined) {
            const userSetting = Number(persistedSettings.maxConcurrentAnalysis);
            // User can only go LOWER than system recommendation, not higher
            // This protects against VRAM exhaustion
            maxConcurrent = Math.min(userSetting, systemRecommended);
            if (userSetting > systemRecommended) {
              logger.warn('User concurrency setting exceeds system recommendation, capping:', {
                userSetting,
                systemRecommended,
                using: maxConcurrent
              });
            }
          }
        }
      } catch {
        // Use default
      }

      const concurrency = Math.max(
        CONCURRENCY.MIN_WORKERS,
        Math.min(Number(maxConcurrent) || CONCURRENCY.DEFAULT_WORKERS, CONCURRENCY.MAX_WORKERS)
      );
      const projectedMs =
        Math.ceil(uniqueFiles.length / Math.max(1, concurrency)) * fallbackPerFileMs +
        15 * 60 * 1000;
      hardCapMs = Math.min(Math.max(baselineHardCapMs, projectedMs), maxHardCapMs);
      hardCapLabel = `${Math.round(hardCapMs / 60000)} min`;

      try {
        logger.info('Configured global analysis watchdog', {
          fileCount: uniqueFiles.length,
          concurrency,
          inactivityWindowMin: Math.round(TIMEOUTS.GLOBAL_ANALYSIS / 60000),
          hardCapMin: Math.round(hardCapMs / 60000)
        });
        logger.info(`Starting analysis of ${uniqueFiles.length} files`);
        addNotification(
          `Starting AI analysis of ${uniqueFiles.length} files...`,
          'info',
          3000,
          'analysis-start'
        );

        const processedFiles = new Set();
        const fileQueue = [...uniqueFiles];
        completedCountRef.current = 0;
        const fileByPath = new Map(uniqueFiles.map((file) => [file.path, file]));

        const runBatchPath = async () => {
          const batchApi = window?.electronAPI?.analysis?.batch;
          if (typeof batchApi !== 'function') {
            throw new Error('Batch analysis API not available');
          }

          for (const file of uniqueFiles) {
            const fileName = file.name || file.path.split(/[\\/]/).pop();
            updateFileState(file.path, 'analyzing', { fileName });
          }

          const clientBatchId =
            globalThis.crypto?.randomUUID?.() ||
            `analysis_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
          activeBatchIdRef.current = clientBatchId;
          cancelInFlightBatchIdRef.current = null;
          let resolvedBatchId = clientBatchId;
          const onBatchProgress = (event) => {
            if (!isActiveRun() || abortSignal.aborted) return;
            const payload = event?.detail;
            if (!payload || payload.type !== 'batch_analyze') return;
            if (payload.batchId && payload.batchId !== resolvedBatchId) {
              // Accept one-time server-side batch id remap for compatibility.
              if (resolvedBatchId === clientBatchId) {
                resolvedBatchId = payload.batchId;
                activeBatchIdRef.current = payload.batchId;
                cancelInFlightBatchIdRef.current = null;
              } else {
                return;
              }
            }

            const previousCompleted = Number(completedCountRef.current) || 0;
            const current = Math.min(Number(payload.completed) || 0, uniqueFiles.length);
            if (current > previousCompleted && typeof payload.currentFile === 'string') {
              batchCompletedPathsRef.current.add(payload.currentFile);
            }
            const total = Math.max(1, Number(payload.total) || uniqueFiles.length);
            completedCountRef.current = current;
            lastProgressAtRef.current = Date.now();

            const currentFileName = payload.currentFile ? extractFileName(payload.currentFile) : '';
            if (currentFileName) {
              setCurrentAnalysisFile(currentFileName);
              actions.setPhaseData('currentAnalysisFile', currentFileName);
            }

            const progress = {
              current,
              total,
              currentFile: currentFileName || undefined,
              lastActivity: Date.now()
            };
            if (validateProgressState(progress)) {
              setAnalysisProgress(progress);
            }
          };

          const abortListener = () => {
            window.removeEventListener(BATCH_ANALYSIS_PROGRESS_EVENT, onBatchProgress);
            requestMainBatchCancel('abort-signal');
          };
          abortSignal.addEventListener('abort', abortListener);

          window.addEventListener(BATCH_ANALYSIS_PROGRESS_EVENT, onBatchProgress);
          try {
            const batchResult = await withTimeout(
              batchApi({
                batchId: clientBatchId,
                filePaths: uniqueFiles.map((file) => file.path),
                options: {
                  concurrency,
                  sectionOrder: 'documents-first',
                  enableVisionBatchMode: true
                }
              }),
              TIMEOUTS.AI_ANALYSIS_BATCH,
              `Batch analysis for ${uniqueFiles.length} files`
            );

            if (!batchResult || !Array.isArray(batchResult.results)) {
              throw new Error('Batch analysis returned an invalid result payload');
            }

            const cancelledSnapshot = cancelledBatchSnapshotRef.current;
            const shouldRecoverCancelledBatch =
              (abortSignal.aborted || !isActiveRun()) &&
              cancelledSnapshot &&
              cancelledSnapshot.runId === runId;
            if (shouldRecoverCancelledBatch) {
              const targetCount = Math.max(
                0,
                Math.min(Number(cancelledSnapshot.completedAtCancel) || 0, uniqueFiles.length)
              );
              if (targetCount > 0) {
                const resultByPath = new Map(
                  batchResult.results
                    .filter((item) => item && typeof item.filePath === 'string')
                    .map((item) => [item.filePath, item])
                );
                const selectedPaths = [];
                const seenPaths = new Set();
                const eventPaths = Array.isArray(cancelledSnapshot.completedPaths)
                  ? cancelledSnapshot.completedPaths
                  : [];
                for (const filePath of eventPaths) {
                  if (!filePath || seenPaths.has(filePath)) continue;
                  if (!resultByPath.has(filePath)) continue;
                  selectedPaths.push(filePath);
                  seenPaths.add(filePath);
                  if (selectedPaths.length >= targetCount) break;
                }
                if (selectedPaths.length < targetCount) {
                  for (const file of uniqueFiles) {
                    const filePath = file?.path;
                    if (!filePath || seenPaths.has(filePath)) continue;
                    if (!resultByPath.has(filePath)) continue;
                    selectedPaths.push(filePath);
                    seenPaths.add(filePath);
                    if (selectedPaths.length >= targetCount) break;
                  }
                }

                for (const filePath of selectedPaths) {
                  const item = resultByPath.get(filePath);
                  if (!item) continue;
                  const fileInfoRaw = fileByPath.get(filePath) || { path: filePath };
                  const fileInfo = {
                    ...fileInfoRaw,
                    size: fileInfoRaw.size || 0,
                    created: fileInfoRaw.created,
                    modified: fileInfoRaw.modified
                  };
                  const resultPayload = item?.result ?? null;
                  const explicitError =
                    item?.success === false
                      ? item?.error || resultPayload?.error || 'Analysis failed'
                      : null;
                  applyAnalysisOutcome(fileInfo, resultPayload, explicitError);
                }
                flushPendingResults(true);
              }
              return;
            }

            const totalResults = batchResult.results.length;
            for (let i = 0; i < totalResults; i += 1) {
              if (!isActiveRun() || abortSignal.aborted) return;
              const item = batchResult.results[i];
              const filePath = item?.filePath;
              const fileInfoRaw = fileByPath.get(filePath) || { path: filePath || '' };
              const fileInfo = {
                ...fileInfoRaw,
                size: fileInfoRaw.size || 0,
                created: fileInfoRaw.created,
                modified: fileInfoRaw.modified
              };
              if (!fileInfo.path) {
                continue;
              }
              const resultPayload = item?.result ?? null;
              const explicitError =
                item?.success === false
                  ? item?.error || resultPayload?.error || 'Analysis failed'
                  : null;

              applyAnalysisOutcome(fileInfo, resultPayload, explicitError);

              const newCompletedCount = Math.min(i + 1, uniqueFiles.length);
              completedCountRef.current = newCompletedCount;
              lastProgressAtRef.current = Date.now();
              const progress = {
                current: newCompletedCount,
                total: uniqueFiles.length,
                lastActivity: Date.now()
              };
              if (validateProgressState(progress)) {
                setAnalysisProgress(progress);
              }
            }
          } finally {
            window.removeEventListener(BATCH_ANALYSIS_PROGRESS_EVENT, onBatchProgress);
            abortSignal.removeEventListener('abort', abortListener);
            if (
              activeBatchIdRef.current === clientBatchId ||
              activeBatchIdRef.current === resolvedBatchId
            ) {
              activeBatchIdRef.current = null;
            }
          }
        };

        const processFile = async (file) => {
          if (!isActiveRun() || abortSignal.aborted) return;
          if (processedFiles.has(file.path)) return;

          const fileName = file.name || file.path.split(/[\\/]/).pop();
          processedFiles.add(file.path);
          updateFileState(file.path, 'analyzing', { fileName });

          // React batches state updates, so we force an immediate update cycle
          // by updating state and flushing phase data synchronously
          setCurrentAnalysisFile(fileName);
          actions.setPhaseData('currentAnalysisFile', fileName);

          // This provides visual feedback during long-running analysis (18-40s per image)
          const progressBeforeAnalysis = {
            current: completedCountRef.current,
            total: uniqueFiles.length,
            currentFile: fileName,
            lastActivity: Date.now()
          };
          setAnalysisProgress(progressBeforeAnalysis);

          // Force a microtask yield to allow React to process the state update
          await Promise.resolve();

          const fileInfo = {
            ...file,
            size: file.size || 0,
            created: file.created,
            modified: file.modified
          };

          try {
            const analysis = await withTimeout(
              analyzeWithRetry(file.path, 1, abortSignal),
              TIMEOUTS.AI_ANALYSIS_LONG,
              `Analysis for ${fileName}`
            );

            // This prevents state updates if the user cancelled while analysis was in flight
            if (!isActiveRun() || abortSignal.aborted) return;

            // This prevents race conditions where multiple workers read same value
            const newCompletedCount = ++completedCountRef.current;
            lastProgressAtRef.current = Date.now();
            const progress = {
              current: Math.min(newCompletedCount, uniqueFiles.length),
              total: uniqueFiles.length,
              lastActivity: Date.now()
            };

            // Throttle progress updates to prevent excessive re-renders
            const now = Date.now();
            if (
              validateProgressState(progress) &&
              now - lastProgressDispatchRef.current >= PROGRESS_THROTTLE_MS
            ) {
              lastProgressDispatchRef.current = now;
              setAnalysisProgress(progress);
            }

            if (isActiveRun()) {
              applyAnalysisOutcome(fileInfo, analysis);
            }
          } catch (error) {
            if (!isActiveRun() || abortSignal.aborted) return;
            const newCompletedCount = ++completedCountRef.current;
            lastProgressAtRef.current = Date.now();
            const progress = {
              current: Math.min(newCompletedCount, uniqueFiles.length),
              total: uniqueFiles.length,
              lastActivity: Date.now()
            };
            // Throttle progress updates to prevent excessive re-renders
            const now = Date.now();
            if (
              validateProgressState(progress) &&
              now - lastProgressDispatchRef.current >= PROGRESS_THROTTLE_MS
            ) {
              lastProgressDispatchRef.current = now;
              setAnalysisProgress(progress);
            }

            if (!isActiveRun()) return;
            applyAnalysisOutcome(fileInfo, null, error.message);
          }
        };

        // Use a worker pool pattern for true parallel processing
        // This keeps all workers busy instead of waiting for batches to complete
        const runWorkerPool = async () => {
          const queue = fileQueue.slice().reverse();

          const worker = async () => {
            while (queue.length > 0) {
              if (abortSignal.aborted || !isActiveRun()) {
                return;
              }
              const file = queue.pop();
              if (!file) break;
              await processFile(file);
            }
          };

          // Start all workers in parallel
          const workers = Array(Math.min(concurrency, fileQueue.length))
            .fill(null)
            .map(() => worker());

          // This ensures all workers complete even if some throw unexpectedly
          const workerResults = await Promise.allSettled(workers);

          // Log any worker failures for debugging
          const failedWorkers = workerResults.filter((r) => r.status === 'rejected');
          if (failedWorkers.length > 0) {
            logger.warn('Some analysis workers failed unexpectedly', {
              failed: failedWorkers.length,
              total: workers.length,
              errors: failedWorkers.map((r) => r.reason?.message || 'Unknown error')
            });
          }

          if (!isActiveRun() || abortSignal.aborted) {
            addNotification('Analysis cancelled by user', 'info', 2000);
          }
        };

        const useBatchPath = shouldUseBatchAnalysis(uniqueFiles.length, concurrency);
        if (useBatchPath) {
          try {
            logger.info('Using batch analysis path for large run', {
              fileCount: uniqueFiles.length,
              concurrency
            });
            await runBatchPath();
          } catch (batchError) {
            const isLegacyBatchTimeout =
              String(batchError?.message || '').includes('30000ms') &&
              String(batchError?.message || '').includes('analysis:analyze-batch');
            logger.warn('Batch analysis path failed, falling back to per-file worker pool', {
              error: batchError?.message,
              legacyTimeoutDetected: isLegacyBatchTimeout
            });
            addNotification(
              isLegacyBatchTimeout
                ? 'Batch analysis timed out at legacy 30s timeout. Falling back to per-file mode; restart app to load updated preload timeouts.'
                : 'Batch analysis encountered an issue. Falling back to per-file processing.',
              'warning',
              isLegacyBatchTimeout ? 7000 : 3500,
              'analysis-batch-fallback'
            );
            await runWorkerPool();
          }
        } else {
          await runWorkerPool();
        }

        if (!isActiveRun()) return;

        const finalProgress = {
          current: Math.min(completedCountRef.current, uniqueFiles.length),
          total: uniqueFiles.length,
          lastActivity: Date.now()
        };
        setAnalysisProgress(finalProgress);

        const batchResults = batchResultsRef.current;
        // Merge results using extracted helper functions
        const mergedResults = dedupeSuggestedNames(
          mergeAnalysisResults(analysisResultsRef.current, batchResults)
        );
        setAnalysisResults(mergedResults);

        const mergedStates = mergeFileStates(fileStatesRef.current, mergedResults);
        setFileStates(mergedStates);

        analysisResultsRef.current = mergedResults;
        fileStatesRef.current = mergedStates;

        // Show completion notification
        const successCount = batchResults.filter((r) => r.analysis).length;
        const failureCount = batchResults.length - successCount;
        showAnalysisCompletionNotification({
          successCount,
          failureCount,
          addNotification,
          actions,
          getCurrentPhase,
          autoAdvanceTimeoutRef
        });
      } catch (error) {
        if (error.message !== 'Analysis cancelled by user') {
          addNotification(`Analysis failed: ${error.message}`, 'error', 5000, 'analysis-error');
        }
      } finally {
        const shouldCleanup = isActiveRun();
        if (shouldCleanup) {
          invalidateEmbeddingStatsCache();
          flushPendingResults(true);
          if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
            heartbeatIntervalRef.current = null;
          }
          if (analysisTimeoutRef.current) {
            clearTimeout(analysisTimeoutRef.current);
            analysisTimeoutRef.current = null;
          }

          // Update local refs to ensure proper lock synchronization
          localAnalyzingRef.current = false;

          const state = store.getState();
          const progress = state.analysis.progress || analysisProgressRef.current;
          const trackedTotal =
            Number.isInteger(progress?.total) && progress.total > 0 ? progress.total : files.length;
          const didComplete = trackedTotal > 0 && completedCountRef.current >= trackedTotal;
          if (!didComplete) {
            requeueInFlightFileStates();
          }

          // If we already completed, clear state even if component unmounted to avoid
          // "analysis continuing in background" banners with 100% progress.
          if (isMountedRef.current || didComplete) {
            isAnalyzingRef.current = false;
            setIsAnalyzing(false);

            if (clearCurrentFileTimeoutRef.current) {
              clearTimeout(clearCurrentFileTimeoutRef.current);
            }
            clearCurrentFileTimeoutRef.current = setTimeout(() => {
              if (isMountedRef.current) {
                setCurrentAnalysisFile('');
                actions.setPhaseData('currentAnalysisFile', '');
              }
            }, 500);

            setAnalysisProgress({ current: 0, total: 0, lastActivity: 0 });
            // Redux is the single source of truth for isAnalyzing.
          } else {
            logger.info('Analysis interrupted by navigation - preserving state for resume');
          }

          analysisLockRef.current = false;
          setGlobalAnalysisActive(false);
          if (lockTimeoutRef.current) {
            clearTimeout(lockTimeoutRef.current);
            lockTimeoutRef.current = null;
          }

          try {
            localStorage.removeItem('stratosort_workflow_state');
          } catch {
            // Non-fatal
          }

          // Process any files that were queued during this analysis batch
          if (pendingFilesRef.current.length > 0) {
            const filesToProcess = [...pendingFilesRef.current];
            pendingFilesRef.current = [];
            logger.info('Processing queued files', {
              fileCount: filesToProcess.length
            });
            // Use setTimeout to allow state to settle before starting next batch
            if (pendingFilesTimeoutRef.current) {
              clearTimeout(pendingFilesTimeoutRef.current);
            }
            pendingFilesTimeoutRef.current = setTimeout(() => {
              if (
                isMountedRef.current &&
                analyzeFilesRef.current &&
                analysisRunIdRef.current === runId
              ) {
                analyzeFilesRef.current(filesToProcess);
              }
            }, 100);
          }
        }
      }
    },
    [
      invalidateEmbeddingStatsCache,
      setIsAnalyzing,
      setCurrentAnalysisFile,
      setAnalysisProgress,
      setAnalysisResults,
      setFileStates,
      updateFileState,
      addNotification,
      actions,
      setGlobalAnalysisActive,
      captureCancelledBatchSnapshot,
      requestMainBatchCancel,
      flushPendingResults,
      applyAnalysisOutcome,
      requeueInFlightFileStates,
      resetAnalysisState,
      getCurrentPhase,
      store
    ]
  );

  // Store analyzeFiles in ref for external access
  analyzeFilesRef.current = analyzeFiles;

  /**
   * Cancel current analysis
   */
  const cancelAnalysis = useCallback(() => {
    invalidateEmbeddingStatsCache();
    requestMainBatchCancel('user-stop');
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      logger.info('Analysis aborted by user');
    }
    captureCancelledBatchSnapshot(analysisRunIdRef.current);
    clearAutoAdvanceTimeoutRef(autoAdvanceTimeoutRef);
    analysisRunIdRef.current += 1;
    // Ensure locks/timeouts are cleared so a new run can start immediately.
    analysisLockRef.current = false;
    isAnalyzingRef.current = false;
    setGlobalAnalysisActive(false);
    globalAnalysisActiveRef.current = false;
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (analysisTimeoutRef.current) {
      clearTimeout(analysisTimeoutRef.current);
      analysisTimeoutRef.current = null;
    }
    if (lockTimeoutRef.current) {
      clearTimeout(lockTimeoutRef.current);
      lockTimeoutRef.current = null;
    }
    if (pendingFilesTimeoutRef.current) {
      clearTimeout(pendingFilesTimeoutRef.current);
      pendingFilesTimeoutRef.current = null;
    }
    activeBatchIdRef.current = null;
    cancelInFlightBatchIdRef.current = null;
    flushPendingResults(true);
    // Clear any pending files when cancelling
    pendingFilesRef.current = [];
    requeueInFlightFileStates();
    setIsAnalyzing(false);
    const clearedProgress = { current: 0, total: 0, lastActivity: 0 };
    analysisProgressRef.current = clearedProgress;
    setAnalysisProgress(clearedProgress);
    // Redux is the single source of truth for isAnalyzing.

    // Store timeout in ref so it can be cleared on unmount (Bug 17)
    if (clearCurrentFileTimeoutRef.current) {
      clearTimeout(clearCurrentFileTimeoutRef.current);
    }
    clearCurrentFileTimeoutRef.current = setTimeout(() => {
      clearCurrentFileTimeoutRef.current = null;
      setCurrentAnalysisFile('');
      actions.setPhaseData('currentAnalysisFile', '');
    }, 300);

    addNotification('Analysis stopped', 'info', 2000);
  }, [
    invalidateEmbeddingStatsCache,
    setIsAnalyzing,
    setCurrentAnalysisFile,
    setAnalysisProgress,
    actions,
    addNotification,
    captureCancelledBatchSnapshot,
    requestMainBatchCancel,
    flushPendingResults,
    requeueInFlightFileStates
  ]);

  /**
   * Clear analysis queue
   */
  const clearAnalysisQueue = useCallback(() => {
    // Clear auto-advance timeout to prevent unexpected navigation
    clearAutoAdvanceTimeoutRef(autoAdvanceTimeoutRef);
    // Clear any pending files
    pendingFilesRef.current = [];
    // Release any in-flight work and reset lock/liveness state.
    resetAnalysisState('Queue cleared');
    // Queue clear is stronger than reset: wipe in-memory results/state too.
    setAnalysisResults([]);
    setFileStates({});
    actions.setPhaseData('selectedFiles', []);
    actions.setPhaseData('analysisResults', []);
    actions.setPhaseData('fileStates', {});
    addNotification('Analysis queue cleared', 'info', 2000, 'queue-management');
  }, [resetAnalysisState, setAnalysisResults, setFileStates, actions, addNotification]);

  /**
   * FIX M-3: Retry failed files - re-analyze files that previously failed
   */
  const retryFailedFiles = useCallback(() => {
    // Find files with error or failed state
    const failedFiles = analysisResults.filter((f) => {
      const state = fileStates[f.path]?.state;
      return state === 'error' || state === 'failed';
    });

    if (failedFiles.length === 0) {
      addNotification('No failed files to retry', 'info', 2000);
      return;
    }

    // Reset states for failed files to pending
    setFileStates((prev) => {
      const updated = { ...prev };
      failedFiles.forEach((file) => {
        if (updated[file.path]) {
          updated[file.path] = { ...updated[file.path], state: 'pending', error: null };
        }
      });
      return updated;
    });

    // Re-analyze the failed files
    addNotification(`Retrying ${failedFiles.length} failed file(s)...`, 'info', 2000);
    if (analyzeFilesRef.current) {
      analyzeFilesRef.current(failedFiles);
    }
  }, [analysisResults, fileStates, setFileStates, addNotification]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      // Clear auto-advance timeout
      clearAutoAdvanceTimeoutRef(autoAdvanceTimeoutRef);
      // Clear abort controller
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      // Clear all intervals and timeouts
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      if (analysisTimeoutRef.current) {
        clearTimeout(analysisTimeoutRef.current);
        analysisTimeoutRef.current = null;
      }
      if (lockTimeoutRef.current) {
        clearTimeout(lockTimeoutRef.current);
        lockTimeoutRef.current = null;
      }
      if (clearCurrentFileTimeoutRef.current) {
        clearTimeout(clearCurrentFileTimeoutRef.current);
        clearCurrentFileTimeoutRef.current = null;
      }
      if (pendingFilesTimeoutRef.current) {
        clearTimeout(pendingFilesTimeoutRef.current);
        pendingFilesTimeoutRef.current = null;
      }
    };
  }, []);

  // Resume analysis on mount
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
          'analysis-resume'
        );
        if (analyzeFilesRef.current) {
          analyzeFilesRef.current(remaining);
        }
      } else {
        resetAnalysisState('No remaining files');
      }
    }
  }, [isAnalyzing, selectedFiles, fileStates, addNotification, resetAnalysisState]);

  return {
    analyzeFiles,
    analyzeFilesRef,
    cancelAnalysis,
    clearAnalysisQueue,
    retryFailedFiles,
    resetAnalysisState,
    generatePreviewName
  };
}

export default useAnalysis;
