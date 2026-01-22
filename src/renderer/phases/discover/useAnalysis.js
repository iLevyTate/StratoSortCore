/**
 * Analysis Hook
 *
 * Custom hook for file analysis logic and state management.
 * Extracted from DiscoverPhase for better maintainability.
 *
 * @module phases/discover/useAnalysis
 */

import { useCallback, useRef, useEffect, useState } from 'react';
import { PHASES, RENDERER_LIMITS, FILE_STATES } from '../../../shared/constants';
import { TIMEOUTS, CONCURRENCY, RETRY } from '../../../shared/performanceConstants';
import { logger } from '../../../shared/logger';
import {
  validateProgressState,
  generatePreviewName as generatePreviewNameUtil,
  generateSuggestedNameFromAnalysis,
  makeUniqueFileName,
  extractFileName
} from './namingUtils';

logger.setContext('DiscoverPhase:Analysis');

// FIX Issue 4: Removed module-level pendingAutoAdvanceTimeoutId
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

// Legacy export for backward compatibility - now a no-op
export function clearAutoAdvanceTimeout() {
  // No-op: Auto-advance timeout is now managed per-hook instance via ref
}

/**
 * Analyze a file with retry logic for transient failures.
 * Extracted from analyzeFiles for better testability.
 *
 * @param {string} filePath - Path to the file to analyze
 * @param {number} attempt - Current attempt number (1-based)
 * @returns {Promise<Object>} Analysis result
 */
async function analyzeWithRetry(filePath, attempt = 1) {
  // Ensure electronAPI is available before attempting analysis
  if (!window.electronAPI?.files?.analyze) {
    throw new Error(
      'File analysis API not available. The application may not have loaded correctly.'
    );
  }

  let timeoutId;
  try {
    return await Promise.race([
      window.electronAPI.files.analyze(filePath),
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Analysis timeout after 3 minutes')),
          RENDERER_LIMITS.ANALYSIS_TIMEOUT_MS
        );
      })
    ]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  } catch (error) {
    const isTransient =
      error.message?.includes('timeout') ||
      error.message?.includes('network') ||
      error.message?.includes('ECONNREFUSED');

    if (attempt < RETRY.MAX_ATTEMPTS_MEDIUM && isTransient) {
      const delay = RETRY.INITIAL_DELAY * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
      return analyzeWithRetry(filePath, attempt + 1);
    }
    throw error;
  }
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
    // FIX Issue 4: Store timeout ID in ref for proper per-hook cleanup
    clearAutoAdvanceTimeoutRef(autoAdvanceTimeoutRef); // Clear any previous pending timeout
    autoAdvanceTimeoutRef.current = setTimeout(() => {
      autoAdvanceTimeoutRef.current = null;
      // Check if still in DISCOVER phase before auto-advancing
      // This prevents unexpected navigation if user moved away during the delay
      const currentPhase = getCurrentPhase?.();
      // FIX: Add null check for PHASES to prevent crash if undefined
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
    // FIX Issue 4: Store timeout ID in ref for proper per-hook cleanup
    clearAutoAdvanceTimeoutRef(autoAdvanceTimeoutRef); // Clear any previous pending timeout
    autoAdvanceTimeoutRef.current = setTimeout(() => {
      autoAdvanceTimeoutRef.current = null;
      // Check if still in DISCOVER phase before auto-advancing
      const currentPhase = getCurrentPhase?.();
      // FIX: Add null check for PHASES to prevent crash if undefined
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
  const {
    selectedFiles = [],
    fileStates = {},
    analysisResults = [],
    isAnalyzing = false,
    analysisProgress = { current: 0, total: 0 },
    namingSettings = {},
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
  const hasResumedRef = useRef(false);
  const analysisLockRef = useRef(false);
  const [globalAnalysisActive, setGlobalAnalysisActive] = useState(false);
  const analyzeFilesRef = useRef(null);
  const heartbeatIntervalRef = useRef(null);
  const analysisTimeoutRef = useRef(null);
  const lockTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);
  const pendingFilesRef = useRef([]);
  const batchResultsRef = useRef([]);
  const pendingResultsRef = useRef([]);
  const lastResultsFlushRef = useRef(0);
  const RESULTS_FLUSH_MS = 200;
  // FIX Issue 4: Auto-advance timeout stored per-hook instance
  const autoAdvanceTimeoutRef = useRef(null);
  // FIX CRIT-2: Atomic progress tracking to prevent race conditions with concurrent workers
  // Using a counter ref that workers increment atomically when they complete
  const completedCountRef = useRef(0);
  const lastProgressDispatchRef = useRef(0);
  const PROGRESS_THROTTLE_MS = 50;
  // FIX: Track mount state to prevent state resets on navigation
  const isMountedRef = useRef(true);

  // Refs to track current state values (prevents stale closures in callbacks)
  // PERF FIX: Update refs synchronously during render instead of using separate useEffect hooks.
  // This is safe because ref assignments are idempotent and don't cause side effects.
  const isAnalyzingRef = useRef(isAnalyzing);
  const globalAnalysisActiveRef = useRef(globalAnalysisActive);
  const analysisResultsRef = useRef(analysisResults);
  const fileStatesRef = useRef(fileStates);
  const analysisProgressRef = useRef(analysisProgress);

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
      const mergedStates = mergeFileStates(fileStatesRef.current, mergedResults);

      // Keep refs in sync to avoid stale merges between flushes
      analysisResultsRef.current = mergedResults;
      fileStatesRef.current = mergedStates;

      setAnalysisResults(mergedResults);
      setFileStates(mergedStates);
      actions.setPhaseData('analysisResults', mergedResults);
      actions.setPhaseData('fileStates', mergedStates);
    },
    [setAnalysisResults, setFileStates, actions]
  );

  const recordAnalysisResult = useCallback(
    (result) => {
      batchResultsRef.current.push(result);
      pendingResultsRef.current.push(result);
      flushPendingResults();
    },
    [flushPendingResults]
  );

  /**
   * Reset analysis state
   */
  const resetAnalysisState = useCallback(
    (reason) => {
      logger.info('Resetting analysis state', { reason });
      setIsAnalyzing(false);
      setAnalysisProgress({ current: 0, total: 0, currentFile: '' });
      setCurrentAnalysisFile('');

      try {
        localStorage.removeItem('stratosort_workflow_state');
      } catch {
        // Non-fatal
      }
    },
    [setIsAnalyzing, setAnalysisProgress, setCurrentAnalysisFile]
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

  /**
   * Re-apply naming convention to existing analyses when settings change.
   * Keeps Discover and Organize screens in sync with the user-selected naming.
   */
  // Track the last applied naming settings to prevent unnecessary re-renders
  const lastAppliedNamingRef = useRef(null);

  useEffect(() => {
    // FIX: Prevent render loop by checking if settings actually changed
    // Compare by value (JSON stringify) to detect actual changes
    const currentSettingsKey = JSON.stringify(namingSettings);
    if (lastAppliedNamingRef.current === currentSettingsKey) {
      return; // Settings haven't changed, skip update
    }
    lastAppliedNamingRef.current = currentSettingsKey;

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
      if (!files || files.length === 0) return;

      // Atomic lock acquisition (use refs to avoid stale closures)
      const lockAcquired = (() => {
        if (analysisLockRef.current || globalAnalysisActiveRef.current || isAnalyzingRef.current) {
          return false;
        }
        analysisLockRef.current = true;
        return true;
      })();

      if (!lockAcquired) {
        // Queue files for analysis when current batch completes
        logger.debug('Lock already held, queueing files for later', {
          fileCount: files.length
        });
        pendingFilesRef.current = [
          ...pendingFilesRef.current,
          ...files.filter((f) => !pendingFilesRef.current.some((p) => p.path === f.path))
        ];
        return;
      }

      // FIX Issue-4: Mark as "resumed" ONLY after lock is acquired
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
      lockTimeoutRef.current = setTimeout(() => {
        if (analysisLockRef.current) {
          logger.warn('Analysis lock timeout, forcing release');
          analysisLockRef.current = false;
          if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
            heartbeatIntervalRef.current = null;
          }
          if (analysisTimeoutRef.current) {
            clearTimeout(analysisTimeoutRef.current);
            analysisTimeoutRef.current = null;
          }
        }
        lockTimeoutRef.current = null;
      }, TIMEOUTS.ANALYSIS_LOCK);

      // FIX: Filter duplicates upfront to ensure progress tracking matches total
      // This prevents "stuck" progress bars where processed count < total due to internal skipping
      const uniqueFiles = files.filter(
        (file, index, self) => index === self.findIndex((f) => f.path === file.path)
      );

      setIsAnalyzing(true);
      const initialProgress = {
        current: 0,
        total: uniqueFiles.length,
        lastActivity: Date.now()
      };
      setAnalysisProgress(initialProgress);
      setCurrentAnalysisFile('');
      // Redux is the single source of truth for isAnalyzing.
      // Avoid redundant dispatch via actions.setPhaseData which can reset totals.
      // FIX: Removed redundant setPhaseData('analysisProgress') - Redux is single source of truth

      // FIX: Use analysisProgressRef (synced from Redux) instead of local ref
      // This ensures heartbeat and progress updates are consistent with Redux state
      const localAnalyzingRef = { current: true };

      // Heartbeat interval - just updates lastActivity to keep analysis alive
      // FIX: Read from analysisProgressRef (Redux state) instead of local ref
      heartbeatIntervalRef.current = setInterval(() => {
        if (localAnalyzingRef.current) {
          const prev = analysisProgressRef.current;
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

      // Global timeout
      analysisTimeoutRef.current = setTimeout(() => {
        logger.warn('Global analysis timeout (10 min)');
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        addNotification(
          'Analysis took too long and was stopped.',
          'warning',
          5000,
          'analysis-timeout'
        );
      }, TIMEOUTS.GLOBAL_ANALYSIS);

      batchResultsRef.current = [];
      pendingResultsRef.current = [];
      lastResultsFlushRef.current = 0;
      let maxConcurrent = CONCURRENCY.DEFAULT_WORKERS;

      try {
        const persistedSettings = await window.electronAPI.settings.get();
        if (persistedSettings?.maxConcurrentAnalysis !== undefined) {
          maxConcurrent = Number(persistedSettings.maxConcurrentAnalysis);
        }
      } catch {
        // Use default
      }

      const concurrency = Math.max(
        CONCURRENCY.MIN_WORKERS,
        Math.min(Number(maxConcurrent) || CONCURRENCY.DEFAULT_WORKERS, CONCURRENCY.MAX_WORKERS)
      );

      try {
        addNotification(
          `Starting AI analysis of ${uniqueFiles.length} files...`,
          'info',
          3000,
          'analysis-start'
        );

        const processedFiles = new Set();
        const fileQueue = [...uniqueFiles];
        // FIX CRIT-2: Reset atomic counter at start of new batch
        completedCountRef.current = 0;

        const processFile = async (file) => {
          if (processedFiles.has(file.path)) return;

          const fileName = file.name || file.path.split(/[\\/]/).pop();
          processedFiles.add(file.path);
          updateFileState(file.path, 'analyzing', { fileName });

          // FIX: Use flushSync-like approach to ensure file name displays immediately
          // React batches state updates, so we force an immediate update cycle
          // by updating state and flushing phase data synchronously
          setCurrentAnalysisFile(fileName);
          actions.setPhaseData('currentAnalysisFile', fileName);

          // FIX: Update progress BEFORE analysis to show "Processing: filename" immediately
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
            const analysis = await analyzeWithRetry(file.path);

            // Fix: Check for abort signal immediately after async operation
            // This prevents state updates if the user cancelled while analysis was in flight
            if (abortSignal.aborted) return;

            // FIX CRIT-2: Atomically increment and capture counter in single expression
            // This prevents race conditions where multiple workers read same value
            const newCompletedCount = ++completedCountRef.current;
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

            if (analysis && !analysis.error) {
              const baseSuggestedName = analysis.suggestedName || fileName;
              const enhancedAnalysis = {
                ...analysis,
                // Preserve the raw suggestion so we can re-apply naming changes later
                originalSuggestedName: baseSuggestedName,
                suggestedName: generateSuggestedName(fileName, analysis, {
                  created: fileInfo.created,
                  modified: fileInfo.modified
                }),
                namingConvention: namingSettings
              };
              recordAnalysisResult({
                ...fileInfo,
                analysis: enhancedAnalysis,
                status: FILE_STATES.CATEGORIZED,
                analyzedAt: new Date().toISOString()
              });
              updateFileState(file.path, 'ready', {
                analysis: enhancedAnalysis,
                analyzedAt: new Date().toISOString(),
                name: fileInfo.name,
                size: fileInfo.size,
                created: fileInfo.created,
                modified: fileInfo.modified
              });
            } else {
              recordAnalysisResult({
                ...fileInfo,
                analysis: null,
                error: analysis?.error || 'Analysis failed',
                status: FILE_STATES.ERROR,
                analyzedAt: new Date().toISOString()
              });
              updateFileState(file.path, 'error', {
                error: analysis?.error || 'Analysis failed',
                analyzedAt: new Date().toISOString()
              });
            }
          } catch (error) {
            if (abortSignal.aborted) return;
            // FIX CRIT-2: Atomically increment and capture counter on error path too
            const newCompletedCount = ++completedCountRef.current;
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

            recordAnalysisResult({
              ...file,
              analysis: null,
              error: error.message,
              status: 'failed',
              analyzedAt: new Date().toISOString()
            });
            updateFileState(file.path, 'error', { error: error.message });
          }
        };

        // Use a worker pool pattern for true parallel processing
        // This keeps all workers busy instead of waiting for batches to complete
        const runWorkerPool = async () => {
          let fileIndex = 0;

          const worker = async () => {
            while (fileIndex < fileQueue.length) {
              if (abortSignal.aborted) {
                return;
              }
              const currentIndex = fileIndex++;
              if (currentIndex >= fileQueue.length) break;

              const file = fileQueue[currentIndex];
              await processFile(file);
            }
          };

          // Start all workers in parallel
          const workers = Array(Math.min(concurrency, fileQueue.length))
            .fill(null)
            .map(() => worker());

          // FIX: Use Promise.allSettled instead of Promise.all to handle partial failures
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

          if (abortSignal.aborted) {
            addNotification('Analysis cancelled by user', 'info', 2000);
          }
        };

        await runWorkerPool();

        // FIX: Ensure final progress is dispatched (may have been throttled)
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

        actions.setPhaseData('analysisResults', mergedResults);
        actions.setPhaseData('fileStates', mergedStates);

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
          autoAdvanceTimeoutRef // FIX Issue 4: Pass ref for per-hook timeout management
        });
      } catch (error) {
        if (error.message !== 'Analysis cancelled by user') {
          addNotification(`Analysis failed: ${error.message}`, 'error', 5000, 'analysis-error');
        }
      } finally {
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

        const didComplete = files.length > 0 && completedCountRef.current >= files.length;

        // CRITICAL FIX: Only preserve Redux state if analysis is still in-flight.
        // If we already completed, clear state even if component unmounted to avoid
        // "analysis continuing in background" banners with 100% progress.
        if (isMountedRef.current || didComplete) {
          isAnalyzingRef.current = false;
          setIsAnalyzing(false);

          // FIX: Delay clearing the current file name to allow UI to show final state
          setTimeout(() => {
            if (isMountedRef.current) {
              setCurrentAnalysisFile('');
              actions.setPhaseData('currentAnalysisFile', '');
            }
          }, 500);

          // FIX: Include lastActivity in reset to fully clear progress state
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
          setTimeout(() => {
            if (analyzeFilesRef.current) {
              analyzeFilesRef.current(filesToProcess);
            }
          }, 100);
        }
      }
    },
    [
      setIsAnalyzing,
      setCurrentAnalysisFile,
      setAnalysisProgress,
      setAnalysisResults,
      setFileStates,
      updateFileState,
      addNotification,
      actions,
      generateSuggestedName,
      namingSettings,
      resetAnalysisState,
      getCurrentPhase,
      recordAnalysisResult
    ]
  );

  // Store analyzeFiles in ref for external access
  analyzeFilesRef.current = analyzeFiles;

  /**
   * Cancel current analysis
   */
  const cancelAnalysis = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      logger.info('Analysis aborted by user');
    }
    if (window.electronAPI?.analysis?.cancel) {
      window.electronAPI.analysis.cancel().catch((error) => {
        logger.debug('Failed to cancel main analysis', { error: error?.message });
      });
    }
    flushPendingResults(true);
    // Clear any pending files when cancelling
    pendingFilesRef.current = [];
    setIsAnalyzing(false);
    setAnalysisProgress({ current: 0, total: 0 });
    // Redux is the single source of truth for isAnalyzing.
    // FIX: Removed redundant setPhaseData('analysisProgress') - already updated via setAnalysisProgress

    // FIX: Delay clearing the file name to allow UI to settle
    setTimeout(() => {
      setCurrentAnalysisFile('');
      actions.setPhaseData('currentAnalysisFile', '');
    }, 300);

    addNotification('Analysis stopped', 'info', 2000);
  }, [
    setIsAnalyzing,
    setCurrentAnalysisFile,
    setAnalysisProgress,
    actions,
    addNotification,
    flushPendingResults
  ]);

  /**
   * Clear analysis queue
   */
  const clearAnalysisQueue = useCallback(() => {
    // Clear any pending files
    pendingFilesRef.current = [];
    setAnalysisResults([]);
    setFileStates({});
    setAnalysisProgress({ current: 0, total: 0 });
    setCurrentAnalysisFile('');
    setIsAnalyzing(false);
    actions.setPhaseData('selectedFiles', []);
    actions.setPhaseData('analysisResults', []);
    actions.setPhaseData('fileStates', {});
    addNotification('Analysis queue cleared', 'info', 2000, 'queue-management');
  }, [
    setAnalysisResults,
    setFileStates,
    setAnalysisProgress,
    setCurrentAnalysisFile,
    setIsAnalyzing,
    actions,
    addNotification
  ]);

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

  // FIX M-1: Consolidated cleanup on unmount (removed duplicate effect below)
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

  // FIX M-1: Duplicate cleanup effect removed - consolidated above in single cleanup useEffect

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
