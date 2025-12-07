/**
 * Analysis Hook
 *
 * Custom hook for file analysis logic and state management.
 * Extracted from DiscoverPhase for better maintainability.
 *
 * @module phases/discover/useAnalysis
 */

import { useCallback, useRef, useEffect, useState } from 'react';
import {
  PHASES,
  RENDERER_LIMITS,
  FILE_STATES,
} from '../../../shared/constants';
import { logger } from '../../../shared/logger';
import {
  validateProgressState,
  generatePreviewName as generatePreviewNameUtil,
} from './namingUtils';

logger.setContext('DiscoverPhase:Analysis');

/**
 * Custom hook for analysis operations
 * @param {Object} options - Hook options
 * @returns {Object} Analysis functions and state
 */
export function useAnalysis({
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
  actions,
}) {
  const hasResumedRef = useRef(false);
  const analysisLockRef = useRef(false);
  const [globalAnalysisActive, setGlobalAnalysisActive] = useState(false);
  const analyzeFilesRef = useRef(null);
  const heartbeatIntervalRef = useRef(null);
  const analysisTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);

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
    [setIsAnalyzing, setAnalysisProgress, setCurrentAnalysisFile],
  );

  /**
   * Generate preview name with current settings
   */
  const generatePreviewName = useCallback(
    (originalName) => {
      return generatePreviewNameUtil(originalName, namingSettings);
    },
    [namingSettings],
  );

  /**
   * Main analysis function
   */
  const analyzeFiles = useCallback(
    async (files) => {
      if (!files || files.length === 0) return;

      // Atomic lock acquisition (use refs to avoid stale closures)
      const lockAcquired = (() => {
        if (
          analysisLockRef.current ||
          globalAnalysisActiveRef.current ||
          isAnalyzingRef.current
        ) {
          return false;
        }
        analysisLockRef.current = true;
        return true;
      })();

      if (!lockAcquired) {
        logger.debug('Lock already held, skipping');
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
      const lockTimeout = setTimeout(
        () => {
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
        },
        5 * 60 * 1000,
      );

      setIsAnalyzing(true);
      const initialProgress = {
        current: 0,
        total: files.length,
        lastActivity: Date.now(),
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
            lastActivity: localProgressRef.current.lastActivity || Date.now(),
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
      }, 30000);

      // Global timeout
      analysisTimeoutRef.current = setTimeout(
        () => {
          logger.warn('Global analysis timeout (10 min)');
          if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
            heartbeatIntervalRef.current = null;
          }
          addNotification(
            'Analysis took too long and was stopped.',
            'warning',
            5000,
            'analysis-timeout',
          );
        },
        10 * 60 * 1000,
      );

      const results = [];
      let maxConcurrent = 3;

      try {
        const persistedSettings = await window.electronAPI.settings.get();
        if (persistedSettings?.maxConcurrentAnalysis !== undefined) {
          maxConcurrent = Number(persistedSettings.maxConcurrentAnalysis);
        }
      } catch {
        // Use default
      }

      const concurrency = Math.max(1, Math.min(Number(maxConcurrent) || 3, 8));

      try {
        addNotification(
          `Starting AI analysis of ${files.length} files...`,
          'info',
          3000,
          'analysis-start',
        );

        const processedFiles = new Set();
        const fileQueue = [...files];
        let completedCount = 0;

        const processFile = async (file) => {
          if (processedFiles.has(file.path)) return;

          const fileName = file.name || file.path.split(/[\\/]/).pop();
          processedFiles.add(file.path);
          updateFileState(file.path, 'analyzing', { fileName });

          try {
            completedCount++;
            const progress = {
              current: completedCount,
              total: files.length,
              lastActivity: Date.now(),
            };

            if (validateProgressState(progress)) {
              localProgressRef.current = progress;
              setAnalysisProgress(progress);
              setCurrentAnalysisFile(fileName);
              actions.setPhaseData('analysisProgress', progress);
              actions.setPhaseData('currentAnalysisFile', fileName);
            }

            const fileInfo = {
              ...file,
              size: file.size || 0,
              created: file.created,
              modified: file.modified,
            };

            // Retry logic
            const analyzeWithRetry = async (filePath, attempt = 1) => {
              let timeoutId;
              try {
                return await Promise.race([
                  window.electronAPI.files.analyze(filePath),
                  new Promise((_, reject) => {
                    timeoutId = setTimeout(
                      () =>
                        reject(new Error('Analysis timeout after 3 minutes')),
                      RENDERER_LIMITS.ANALYSIS_TIMEOUT_MS,
                    );
                  }),
                ]).finally(() => {
                  if (timeoutId) clearTimeout(timeoutId);
                });
              } catch (error) {
                const isTransient =
                  error.message?.includes('timeout') ||
                  error.message?.includes('network') ||
                  error.message?.includes('ECONNREFUSED');

                if (attempt < 3 && isTransient) {
                  const delay = 1000 * Math.pow(2, attempt - 1);
                  await new Promise((r) => setTimeout(r, delay));
                  return analyzeWithRetry(filePath, attempt + 1);
                }
                throw error;
              }
            };

            const analysis = await analyzeWithRetry(file.path);

            if (analysis && !analysis.error) {
              const enhancedAnalysis = {
                ...analysis,
                suggestedName: generatePreviewName(
                  analysis.suggestedName || fileName,
                ),
                namingConvention: namingSettings,
              };
              results.push({
                ...fileInfo,
                analysis: enhancedAnalysis,
                status: FILE_STATES.CATEGORIZED,
                analyzedAt: new Date().toISOString(),
              });
              updateFileState(file.path, 'ready', {
                analysis: enhancedAnalysis,
                analyzedAt: new Date().toISOString(),
                name: fileInfo.name,
                size: fileInfo.size,
              });
            } else {
              results.push({
                ...fileInfo,
                analysis: null,
                error: analysis?.error || 'Analysis failed',
                status: FILE_STATES.ERROR,
                analyzedAt: new Date().toISOString(),
              });
              updateFileState(file.path, 'error', {
                error: analysis?.error || 'Analysis failed',
                analyzedAt: new Date().toISOString(),
              });
            }
          } catch (error) {
            results.push({
              ...file,
              analysis: null,
              error: error.message,
              status: 'failed',
              analyzedAt: new Date().toISOString(),
            });
            updateFileState(file.path, 'error', { error: error.message });
          }
        };

        const processBatch = async (batch) => {
          if (abortSignal.aborted) {
            throw new Error('Analysis cancelled by user');
          }
          await Promise.all(batch.map(processFile));

          const currentProgress = {
            current: completedCount,
            total: files.length,
            lastActivity: Date.now(),
          };
          if (validateProgressState(currentProgress)) {
            setAnalysisProgress(currentProgress);
            actions.setPhaseData('analysisProgress', currentProgress);
          }
        };

        for (let i = 0; i < fileQueue.length; i += concurrency) {
          if (abortSignal.aborted) {
            addNotification('Analysis cancelled by user', 'info', 2000);
            break;
          }
          const batch = fileQueue.slice(i, i + concurrency);
          await processBatch(batch);
        }

        // Merge results
        const resultsByPath = new Map(
          (analysisResults || []).map((r) => [r.path, r]),
        );
        results.forEach((r) => resultsByPath.set(r.path, r));
        const mergedResults = Array.from(resultsByPath.values());
        setAnalysisResults(mergedResults);

        // Merge file states
        const mergedStates = { ...(fileStates || {}) };
        results.forEach((result) => {
          if (result.analysis && !result.error) {
            mergedStates[result.path] = {
              state: 'ready',
              timestamp: new Date().toISOString(),
              analysis: result.analysis,
            };
          } else if (result.error) {
            mergedStates[result.path] = {
              state: 'error',
              timestamp: new Date().toISOString(),
              error: result.error,
            };
          }
        });
        setFileStates(mergedStates);

        actions.setPhaseData('analysisResults', mergedResults);
        actions.setPhaseData('fileStates', mergedStates);

        const successCount = results.filter((r) => r.analysis).length;
        const failureCount = results.length - successCount;

        if (successCount > 0 && failureCount === 0) {
          addNotification(
            `Analysis complete! ${successCount} files ready`,
            'success',
            4000,
            'analysis-complete',
          );
          setTimeout(() => {
            actions.advancePhase(PHASES.ORGANIZE);
          }, 2000);
        } else if (successCount > 0) {
          addNotification(
            `Analysis complete: ${successCount} successful, ${failureCount} failed`,
            'warning',
            4000,
            'analysis-complete',
          );
          setTimeout(() => {
            actions.advancePhase(PHASES.ORGANIZE);
          }, 2000);
        } else if (failureCount > 0) {
          addNotification(
            `Analysis failed for all ${failureCount} files.`,
            'error',
            8000,
            'analysis-complete',
          );
          actions.setPhaseData('totalAnalysisFailure', true);
        }
      } catch (error) {
        if (error.message !== 'Analysis cancelled by user') {
          addNotification(
            `Analysis failed: ${error.message}`,
            'error',
            5000,
            'analysis-error',
          );
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
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      setIsAnalyzing,
      setCurrentAnalysisFile,
      setAnalysisProgress,
      setAnalysisResults,
      setFileStates,
      updateFileState,
      addNotification,
      actions,
      generatePreviewName,
      namingSettings,
      // Note: analysisResults, fileStates accessed via refs to prevent stale closures
      resetAnalysisState,
    ],
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
    setIsAnalyzing(false);
    setCurrentAnalysisFile('');
    setAnalysisProgress({ current: 0, total: 0 });
    actions.setPhaseData('isAnalyzing', false);
    actions.setPhaseData('currentAnalysisFile', '');
    actions.setPhaseData('analysisProgress', { current: 0, total: 0 });
    addNotification('Analysis stopped', 'info', 2000);
  }, [
    setIsAnalyzing,
    setCurrentAnalysisFile,
    setAnalysisProgress,
    actions,
    addNotification,
  ]);

  /**
   * Clear analysis queue
   */
  const clearAnalysisQueue = useCallback(() => {
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
    addNotification,
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
          'analysis-resume',
        );
        if (analyzeFilesRef.current) {
          analyzeFilesRef.current(remaining);
        }
      } else {
        resetAnalysisState('No remaining files');
      }
    }
  }, [
    isAnalyzing,
    selectedFiles,
    fileStates,
    addNotification,
    resetAnalysisState,
  ]);

  return {
    analyzeFiles,
    analyzeFilesRef,
    cancelAnalysis,
    clearAnalysisQueue,
    resetAnalysisState,
    generatePreviewName,
  };
}

export default useAnalysis;
