/**
 * useOrganizeState Hook
 *
 * Redux state management hook for OrganizePhase.
 * Handles selectors, action dispatchers, and computed values.
 *
 * @module organize/useOrganizeState
 */

import { useCallback, useMemo, useEffect, useRef } from 'react';
import { useAppSelector, useAppDispatch } from '../../store/hooks';
import {
  setSmartFolders as setSmartFoldersAction,
  setOrganizedFiles as setOrganizedFilesAction,
  setFileStates as setFileStatesAction
} from '../../store/slices/filesSlice';
import { selectFilesWithAnalysis, selectFileStats } from '../../store/selectors';
import { setPhase, setOrganizing } from '../../store/slices/uiSlice';
import { fetchDocumentsPath } from '../../store/slices/systemSlice';
import { logger } from '../../../shared/logger';

logger.setContext('OrganizePhase-State');

/**
 * Hook for managing OrganizePhase Redux state
 * @returns {Object} State and actions for organize phase
 */
export function useOrganizeState() {
  const dispatch = useAppDispatch();

  // Selectors
  const organizedFiles = useAppSelector((state) => state.files.organizedFiles);
  const filesWithAnalysis = useAppSelector(selectFilesWithAnalysis);
  const fileStats = useAppSelector(selectFileStats);
  const analysisResults = useAppSelector((state) => state.analysis.results);
  const isAnalyzing = useAppSelector((state) => state.analysis.isAnalyzing);
  const analysisProgress = useAppSelector((state) => state.analysis.analysisProgress);
  const smartFolders = useAppSelector((state) => state.files.smartFolders);
  const fileStates = useAppSelector((state) => state.files.fileStates);
  const documentsPath = useAppSelector((state) => state.system.documentsPath);

  const defaultLocation = documentsPath || 'Documents';

  // Refs for avoiding stale closures
  const smartFoldersRef = useRef(smartFolders);
  const dispatchRef = useRef(dispatch);

  useEffect(() => {
    smartFoldersRef.current = smartFolders;
  }, [smartFolders]);

  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  // Ref for avoiding stale closures in functional updates
  const organizedFilesRef = useRef(organizedFiles);
  useEffect(() => {
    organizedFilesRef.current = organizedFiles;
  }, [organizedFiles]);

  // Action dispatchers
  // FIX H-1: Use ref to avoid stale closure when functional update is called rapidly
  const setOrganizedFiles = useCallback(
    (value) => {
      const nextValue = typeof value === 'function' ? value(organizedFilesRef.current) : value;
      dispatch(setOrganizedFilesAction(nextValue));
    },
    [dispatch]
  );

  // Ref for avoiding stale closures in functional updates
  const fileStatesRef = useRef(fileStates);
  useEffect(() => {
    fileStatesRef.current = fileStates;
  }, [fileStates]);

  // FIX H-1: Use ref to avoid stale closure when functional update is called rapidly
  const setFileStates = useCallback(
    (states) => {
      if (typeof states === 'function') {
        dispatch(setFileStatesAction(states(fileStatesRef.current)));
      } else {
        dispatch(setFileStatesAction(states));
      }
    },
    [dispatch]
  );

  const setSmartFolders = useCallback(
    (folders) => dispatch(setSmartFoldersAction(folders)),
    [dispatch]
  );

  const setOrganizingState = useCallback(
    (isOrganizing) => dispatch(setOrganizing(isOrganizing)),
    [dispatch]
  );

  const advancePhase = useCallback((phase) => dispatch(setPhase(phase)), [dispatch]);

  // Compatibility object for legacy code
  const phaseData = useMemo(
    () => ({
      analysisResults,
      smartFolders,
      organizedFiles,
      fileStates,
      isAnalyzing,
      analysisProgress
    }),
    [analysisResults, smartFolders, organizedFiles, fileStates, isAnalyzing, analysisProgress]
  );

  // Memoized actions object for legacy compatibility
  const actions = useMemo(
    () => ({
      setPhaseData: (key, value) => {
        if (key === 'smartFolders') dispatch(setSmartFoldersAction(value));
        if (key === 'organizedFiles') setOrganizedFiles(value);
        if (key === 'fileStates') setFileStates(value);
      },
      advancePhase: (phase) => dispatch(setPhase(phase))
    }),
    [dispatch, setOrganizedFiles, setFileStates]
  );

  // Failed count from stats
  const failedCount = fileStats.failed;

  return {
    // Raw state
    organizedFiles,
    filesWithAnalysis,
    fileStats,
    analysisResults,
    isAnalyzing,
    analysisProgress,
    smartFolders,
    fileStates,
    documentsPath,
    defaultLocation,
    failedCount,

    // Refs
    smartFoldersRef,
    dispatchRef,

    // Action dispatchers
    dispatch,
    setOrganizedFiles,
    setFileStates,
    setSmartFolders,
    setOrganizingState,
    advancePhase,

    // Compatibility
    phaseData,
    actions
  };
}

/**
 * Hook for loading initial data
 * @param {Object} refs - Refs for smart folders, notification, dispatch
 * @param {Function} addNotification - Notification function
 */
export function useLoadInitialData(refs, addNotification) {
  const { smartFoldersRef, dispatchRef } = refs;
  const dispatch = dispatchRef?.current;
  const documentsPath = useAppSelector((state) => state.system.documentsPath);

  // Keep notification function stable via ref to avoid effect churn
  const addNotificationRef = useRef(addNotification);
  useEffect(() => {
    addNotificationRef.current = addNotification;
  }, [addNotification]);

  // Load smart folders if missing
  const loadSmartFoldersIfMissing = useCallback(async () => {
    try {
      const currentSmartFolders = smartFoldersRef.current;
      if (!Array.isArray(currentSmartFolders) || currentSmartFolders.length === 0) {
        const folders = await window.electronAPI.smartFolders.get();
        if (Array.isArray(folders) && folders.length > 0) {
          dispatchRef.current(setSmartFoldersAction(folders));
          addNotificationRef.current?.(
            `Loaded ${folders.length} smart folder${folders.length > 1 ? 's' : ''}`,
            'info'
          );
        }
      }
    } catch (error) {
      logger.error('Failed to load smart folders in Organize phase', {
        error: error.message,
        stack: error.stack
      });
    }
  }, [smartFoldersRef, dispatchRef]);

  useEffect(() => {
    loadSmartFoldersIfMissing();
  }, [loadSmartFoldersIfMissing]);

  // Fetch documents path
  useEffect(() => {
    if (!documentsPath && dispatch) {
      dispatch(fetchDocumentsPath());
    }
  }, [dispatch, documentsPath]);
}

export default useOrganizeState;
