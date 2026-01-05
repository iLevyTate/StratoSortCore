/**
 * Discover State Hook
 *
 * Custom hook for Redux state bindings and action wrappers.
 * Extracted from DiscoverPhase for better maintainability.
 *
 * @module phases/discover/useDiscoverState
 */

import { useCallback, useMemo, useRef } from 'react';
import { useAppSelector, useAppDispatch } from '../../store/hooks';
import {
  setSelectedFiles as setSelectedFilesAction,
  updateFileState as updateFileStateAction,
  setFileStates as setFileStatesAction,
  setNamingConvention as setNamingConventionAction
} from '../../store/slices/filesSlice';
import {
  startAnalysis as startAnalysisAction,
  updateProgress as updateProgressAction,
  stopAnalysis as stopAnalysisAction,
  setAnalysisResults as setAnalysisResultsAction,
  resetAnalysisState as resetAnalysisStateAction
} from '../../store/slices/analysisSlice';
import { setPhase, setAnalyzing } from '../../store/slices/uiSlice';
import { logger } from '../../../shared/logger';

logger.setContext('DiscoverPhase:State');

/**
 * Custom hook for discover phase Redux state management
 * @returns {Object} State values, setters, and actions
 */
export function useDiscoverState() {
  const dispatch = useAppDispatch();

  // Selectors
  const selectedFiles = useAppSelector((state) => state.files.selectedFiles);
  const analysisResults = useAppSelector((state) => state.analysis.results);
  const isAnalyzing = useAppSelector((state) => state.analysis.isAnalyzing);
  const analysisProgress = useAppSelector((state) => state.analysis.analysisProgress);
  const currentAnalysisFile = useAppSelector((state) => state.analysis.currentAnalysisFile);
  const fileStates = useAppSelector((state) => state.files.fileStates);
  const namingConventionState = useAppSelector((state) => state.files.namingConvention);
  const currentPhase = useAppSelector((state) => state.ui.currentPhase);
  // FIX H-3: Get organizedFiles to filter out already-organized files from Discover phase
  const organizedFiles = useAppSelector((state) => state.files.organizedFiles);

  // Destructure naming convention
  const namingConvention = namingConventionState.convention;
  const { dateFormat } = namingConventionState;
  const { caseConvention } = namingConventionState;
  const { separator } = namingConventionState;

  // Refs to keep track of latest state for stable callbacks
  // PERF FIX: Update refs synchronously during render instead of using 5 separate useEffect hooks.
  // This is safe because ref assignments are idempotent and don't cause side effects.
  // This eliminates 5 effect scheduling/cleanup cycles per state change.
  const selectedFilesRef = useRef(selectedFiles);
  const analysisResultsRef = useRef(analysisResults);
  const fileStatesRef = useRef(fileStates);
  const analysisProgressRef = useRef(analysisProgress);
  const currentPhaseRef = useRef(currentPhase);

  // Sync refs during render (safe for refs, avoids useEffect overhead)
  selectedFilesRef.current = selectedFiles;
  analysisResultsRef.current = analysisResults;
  fileStatesRef.current = fileStates;
  analysisProgressRef.current = analysisProgress;
  currentPhaseRef.current = currentPhase;

  // Stable callback to get current phase (for async operations that need to check phase)
  const getCurrentPhase = useCallback(() => currentPhaseRef.current, []);

  // Redux action wrappers
  const setSelectedFiles = useCallback(
    (files) => {
      if (typeof files === 'function') {
        dispatch(setSelectedFilesAction(files(selectedFilesRef.current)));
      } else {
        dispatch(setSelectedFilesAction(files));
      }
    },
    [dispatch]
  );

  const setAnalysisResults = useCallback(
    (results) => {
      if (typeof results === 'function') {
        dispatch(setAnalysisResultsAction(results(analysisResultsRef.current)));
      } else {
        dispatch(setAnalysisResultsAction(results));
      }
    },
    [dispatch]
  );

  const setIsAnalyzing = useCallback(
    (val) => {
      if (val) {
        dispatch(startAnalysisAction({ total: analysisProgressRef.current.total }));
        dispatch(setAnalyzing(true));
      } else {
        dispatch(stopAnalysisAction());
        dispatch(setAnalyzing(false));
      }
    },
    [dispatch]
  );

  const setAnalysisProgress = useCallback((val) => dispatch(updateProgressAction(val)), [dispatch]);

  const setCurrentAnalysisFile = useCallback(
    (val) => dispatch(updateProgressAction({ currentFile: val })),
    [dispatch]
  );

  const setNamingConvention = useCallback(
    (val) => dispatch(setNamingConventionAction({ convention: val })),
    [dispatch]
  );

  const setDateFormat = useCallback(
    (val) => dispatch(setNamingConventionAction({ dateFormat: val })),
    [dispatch]
  );

  const setCaseConvention = useCallback(
    (val) => dispatch(setNamingConventionAction({ caseConvention: val })),
    [dispatch]
  );

  const setSeparator = useCallback(
    (val) => dispatch(setNamingConventionAction({ separator: val })),
    [dispatch]
  );

  const setFileStates = useCallback(
    (val) => {
      if (typeof val === 'function') {
        dispatch(setFileStatesAction(val(fileStatesRef.current)));
      } else {
        dispatch(setFileStatesAction(val));
      }
    },
    [dispatch]
  );

  const updateFileState = useCallback(
    (filePath, state, metadata = {}) => {
      dispatch(
        updateFileStateAction({
          path: filePath,
          state,
          metadata
        })
      );
    },
    [dispatch]
  );

  const resetAnalysisState = useCallback(
    (reason) => {
      logger.info('Resetting analysis state', { reason });
      dispatch(stopAnalysisAction());
      dispatch(updateProgressAction({ current: 0, total: 0, currentFile: '' }));
      dispatch(resetAnalysisStateAction());

      try {
        localStorage.removeItem('stratosort_workflow_state');
      } catch {
        // Non-fatal
      }
    },
    [dispatch]
  );

  // Memoized actions object
  const actions = useMemo(
    () => ({
      setPhaseData: (key, value) => {
        if (key === 'isAnalyzing') setIsAnalyzing(value);
        if (key === 'analysisProgress') setAnalysisProgress(value);
        if (key === 'currentAnalysisFile') setCurrentAnalysisFile(value);
        if (key === 'selectedFiles') setSelectedFiles(value);
        if (key === 'analysisResults') setAnalysisResults(value);
        if (key === 'namingConvention') dispatch(setNamingConventionAction(value));
        if (key === 'fileStates') setFileStates(value);
        if (key === 'failedFileCount') {
          logger.debug('Failed file count updated', { count: value });
        }
      },
      advancePhase: (phase) => dispatch(setPhase(phase))
    }),
    [
      dispatch,
      setIsAnalyzing,
      setAnalysisProgress,
      setCurrentAnalysisFile,
      setSelectedFiles,
      setAnalysisResults,
      setFileStates
    ]
  );

  // Memoized computed values
  const successfulAnalysisCount = useMemo(
    () => analysisResults.filter((r) => r.analysis).length,
    [analysisResults]
  );

  const failedAnalysisCount = useMemo(
    () => analysisResults.filter((r) => r.error).length,
    [analysisResults]
  );

  const readyAnalysisCount = useMemo(
    () => analysisResults.filter((r) => r.analysis && !r.error).length,
    [analysisResults]
  );

  const readySelectedFilesCount = useMemo(
    () => selectedFiles.filter((f) => fileStates[f.path]?.state === 'ready').length,
    [selectedFiles, fileStates]
  );

  // Naming settings object for hooks
  const namingSettings = useMemo(
    () => ({
      convention: namingConvention,
      separator,
      dateFormat,
      caseConvention
    }),
    [namingConvention, separator, dateFormat, caseConvention]
  );

  return {
    // State values
    selectedFiles,
    analysisResults,
    isAnalyzing,
    analysisProgress,
    currentAnalysisFile,
    fileStates,
    namingConventionState,
    namingConvention,
    dateFormat,
    caseConvention,
    separator,
    namingSettings,
    currentPhase,
    organizedFiles, // FIX H-3: Expose for filtering in Discover phase

    // Setters
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

    // Actions
    actions,
    dispatch,

    // Callbacks
    getCurrentPhase,

    // Computed values
    successfulAnalysisCount,
    failedAnalysisCount,
    readyAnalysisCount,
    readySelectedFilesCount
  };
}

export default useDiscoverState;
