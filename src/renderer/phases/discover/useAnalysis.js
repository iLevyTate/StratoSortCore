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
  extractFileName
} from './namingUtils';

logger.setContext('DiscoverPhase:Analysis');

/**
 * Analyze a file with retry logic for transient failures.
 * Extracted from analyzeFiles for better testability.
 *
 * @param {string} filePath - Path to the file to analyze
 * @param {number} attempt - Current attempt number (1-based)
 * @returns {Promise<Object>} Analysis result
 */
async function analyzeWithRetry(filePath, attempt = 1) {
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
      const delay = RETRY.INITIAL_DELAY * Math.pow(2, attempt - 1);
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
        analysis: result.analysis
      };
    } else if (result.error) {
      mergedStates[result.path] = {
        state: 'error',
        timestamp: new Date().toISOString(),
        error: result.error
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
 */
function showAnalysisCompletionNotification({
  successCount,
  failureCount,
  addNotification,
  actions
}) {
  if (successCount > 0 && failureCount === 0) {
    addNotification(
      `Analysis complete! ${successCount} files ready`,
      'success',
      4000,
      'analysis-complete'
    );
    setTimeout(() => {
      actions.advancePhase(PHASES.ORGANIZE);
    }, 2000);
  } else if (successCount > 0) {
    addNotification(
      `Analysis complete: ${successCount} successful, ${failureCount} failed`,
      'warning',
      4000,
      'analysis-complete'
    );
    setTimeout(() => {
      actions.advancePhase(PHASES.ORGANIZE);
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
 * @returns {Object} Analysis functions and state
 */
export function useAnalysis(options) {
  const {
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
    } = {},
    updateFileState,
    addNotification,
    actions
  } = options;
  const hasResumedRef = useRef(false);
  const analysisLockRef = useRef(false);
  const [globalAnalysisActive, setGlobalAnalysisActive] = useState(false);
  const analyzeFilesRef = useRef(null);
  const heartbeatIntervalRef = useRef(null);
  const analysisTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);
  const pendingFilesRef = useRef([]);

  // Refs to track current state values (prevents stale closures in callbacks)
  const isAnalyzingRef = useRef(isAnalyzing);
  const globalAnalysisActiveRef = useRef(globalAnalysisActive);
  const analysisResultsRef = useRef(analysisResults);
  const fileStatesRef = useRef(fileStates);
  const analysisProgressRef = useRef(analysisProgress);

  // Keep refs in sync with state
  useEffect(() => {
    isAnalyzingRef.current = isAnalyzing;
  }, [isAnalyzing]);
  useEffect(() => {
    globalAnalysisActiveRef.current = globalAnalysisActive;
  }, [globalAnalysisActive]);
  useEffect(() => {
    analysisResultsRef.current = analysisResults;
  }, [analysisResults]);
  useEffect(() => {
    fileStatesRef.current = fileStates;
  }, [fileStates]);
  useEffect(() => {
    analysisProgressRef.current = analysisProgress;
  }, [analysisProgress]);

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

  /**
   * Re-apply naming convention to existing analyses when settings change.
   * Keeps Discover and Organize screens in sync with the user-selected naming.
   */
  useEffect(() => {
    if ((!analysisResults || analysisResults.length === 0) && !fileStates) {
      return;
    }

    setAnalysisResults((prev) => {
      if (!prev || prev.length === 0) return prev;
      return prev.map((result) => {
        if (!result?.analysis) return result;
        const baseName =
          result.analysis.originalSuggestedName ||
          result.analysis.suggestedName ||
          result.name ||
          extractFileName(result.path || '') ||
          '';
        return {
          ...result,
          analysis: {
            ...result.analysis,
            suggestedName: generatePreviewName(baseName),
            namingConvention: namingSettings
          }
        };
      });
    });

    setFileStates((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      Object.entries(next).forEach(([filePath, state]) => {
        if (!state?.analysis) return;
        const baseName =
          state.analysis.originalSuggestedName ||
          state.analysis.suggestedName ||
          state.name ||
          extractFileName(filePath) ||
          '';
        next[filePath] = {
          ...state,
          analysis: {
            ...state.analysis,
            suggestedName: generatePreviewName(baseName),
            namingConvention: namingSettings
          }
        };
      });
      return next;
    });
    // Only re-run when naming settings change; analysis state handled via functional updates
  }, [namingSettings, generatePreviewName, setAnalysisResults, setFileStates]);

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

      setGlobalAnalysisActive(true);
      abortControllerRef.current = new AbortController();
      const abortSignal = abortControllerRef.current.signal;

      if (abortSignal.aborted) {
        analysisLockRef.current = false;
        setGlobalAnalysisActive(false);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Safety timeout
      const lockTimeout = setTimeout(() => {
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
      }, TIMEOUTS.ANALYSIS_LOCK);

      setIsAnalyzing(true);
      const initialProgress = {
        current: 0,
        total: files.length,
        lastActivity: Date.now()
      };
      setAnalysisProgress(initialProgress);
      setCurrentAnalysisFile('');
      actions.setPhaseData('isAnalyzing', true);
      actions.setPhaseData('analysisProgress', initialProgress);

      // Progress tracking refs (use different names to avoid shadowing outer refs)
      const localProgressRef = { current: initialProgress };
      const localAnalyzingRef = { current: true };

      // Heartbeat interval
      heartbeatIntervalRef.current = setInterval(() => {
        if (localAnalyzingRef.current) {
          const currentProgress = {
            current: localProgressRef.current.current,
            total: localProgressRef.current.total,
            lastActivity: localProgressRef.current.lastActivity || Date.now()
          };

          if (validateProgressState(currentProgress)) {
            setAnalysisProgress(currentProgress);
            actions.setPhaseData('analysisProgress', currentProgress);
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

      const results = [];
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
          `Starting AI analysis of ${files.length} files...`,
          'info',
          3000,
          'analysis-start'
        );

        const processedFiles = new Set();
        const fileQueue = [...files];
        let completedCount = 0;

        const processFile = async (file) => {
          if (processedFiles.has(file.path)) return;

          const fileName = file.name || file.path.split(/[\\/]/).pop();
          processedFiles.add(file.path);
          updateFileState(file.path, 'analyzing', { fileName });

          // Show current file being processed (progress updates after completion)
          setCurrentAnalysisFile(fileName);
          actions.setPhaseData('currentAnalysisFile', fileName);
          localProgressRef.current = {
            ...localProgressRef.current,
            lastActivity: Date.now()
          };

          const fileInfo = {
            ...file,
            size: file.size || 0,
            created: file.created,
            modified: file.modified
          };

          try {
            const analysis = await analyzeWithRetry(file.path);

            // Increment progress AFTER analysis completes
            completedCount++;
            const progress = {
              current: completedCount,
              total: files.length,
              lastActivity: Date.now()
            };

            if (validateProgressState(progress)) {
              localProgressRef.current = progress;
              setAnalysisProgress(progress);
              actions.setPhaseData('analysisProgress', progress);
            }

            if (analysis && !analysis.error) {
              const baseSuggestedName = analysis.suggestedName || fileName;
              const enhancedAnalysis = {
                ...analysis,
                // Preserve the raw suggestion so we can re-apply naming changes later
                originalSuggestedName: baseSuggestedName,
                suggestedName: generatePreviewName(baseSuggestedName),
                namingConvention: namingSettings
              };
              results.push({
                ...fileInfo,
                analysis: enhancedAnalysis,
                status: FILE_STATES.CATEGORIZED,
                analyzedAt: new Date().toISOString()
              });
              updateFileState(file.path, 'ready', {
                analysis: enhancedAnalysis,
                analyzedAt: new Date().toISOString(),
                name: fileInfo.name,
                size: fileInfo.size
              });
            } else {
              results.push({
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
            // Still increment count on error so progress continues
            completedCount++;
            const progress = {
              current: completedCount,
              total: files.length,
              lastActivity: Date.now()
            };
            if (validateProgressState(progress)) {
              localProgressRef.current = progress;
              setAnalysisProgress(progress);
              actions.setPhaseData('analysisProgress', progress);
            }

            results.push({
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

          await Promise.all(workers);

          if (abortSignal.aborted) {
            addNotification('Analysis cancelled by user', 'info', 2000);
          }
        };

        await runWorkerPool();

        // Merge results using extracted helper functions
        const mergedResults = mergeAnalysisResults(analysisResults, results);
        setAnalysisResults(mergedResults);

        const mergedStates = mergeFileStates(fileStates, results);
        setFileStates(mergedStates);

        actions.setPhaseData('analysisResults', mergedResults);
        actions.setPhaseData('fileStates', mergedStates);

        // Show completion notification
        const successCount = results.filter((r) => r.analysis).length;
        const failureCount = results.length - successCount;
        showAnalysisCompletionNotification({
          successCount,
          failureCount,
          addNotification,
          actions
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
        // Update both local and outer refs to ensure proper lock synchronization
        localAnalyzingRef.current = false;
        isAnalyzingRef.current = false;
        setIsAnalyzing(false);
        setCurrentAnalysisFile('');
        setAnalysisProgress({ current: 0, total: 0 });
        actions.setPhaseData('isAnalyzing', false);
        actions.setPhaseData('currentAnalysisFile', '');
        actions.setPhaseData('analysisProgress', { current: 0, total: 0 });

        analysisLockRef.current = false;
        setGlobalAnalysisActive(false);
        clearTimeout(lockTimeout);

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
      analysisResults,
      fileStates,
      updateFileState,
      addNotification,
      actions,
      generatePreviewName,
      namingSettings,
      resetAnalysisState
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
    // Clear any pending files when cancelling
    pendingFilesRef.current = [];
    setIsAnalyzing(false);
    setCurrentAnalysisFile('');
    setAnalysisProgress({ current: 0, total: 0 });
    actions.setPhaseData('isAnalyzing', false);
    actions.setPhaseData('currentAnalysisFile', '');
    actions.setPhaseData('analysisProgress', { current: 0, total: 0 });
    addNotification('Analysis stopped', 'info', 2000);
  }, [setIsAnalyzing, setCurrentAnalysisFile, setAnalysisProgress, actions, addNotification]);

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
    actions.setPhaseData('selectedFiles', []);
    actions.setPhaseData('analysisResults', []);
    actions.setPhaseData('fileStates', {});
    actions.setPhaseData('isAnalyzing', false);
    addNotification('Analysis queue cleared', 'info', 2000, 'queue-management');
  }, [
    setAnalysisResults,
    setFileStates,
    setAnalysisProgress,
    setCurrentAnalysisFile,
    actions,
    addNotification
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      if (analysisTimeoutRef.current) {
        clearTimeout(analysisTimeoutRef.current);
        analysisTimeoutRef.current = null;
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
    resetAnalysisState,
    generatePreviewName
  };
}

export default useAnalysis;
