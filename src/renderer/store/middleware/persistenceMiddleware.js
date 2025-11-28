import { PHASES } from '../../../shared/constants';
import { logger } from '../../../shared/logger';

const SAVE_DEBOUNCE_MS = 1000;
let saveTimeout = null;
let lastSavedPhase = null;
let lastSavedFilesCount = -1;
let lastSavedResultsCount = -1;

const persistenceMiddleware = (store) => (next) => (action) => {
  const result = next(action);
  const state = store.getState();

  // Only save if not in welcome phase and not loading
  if (
    state.ui.currentPhase !== PHASES.WELCOME &&
    action.type.indexOf('setLoading') === -1
  ) {
    // Performance: Skip save if key state hasn't changed
    const currentPhase = state.ui.currentPhase;
    const currentFilesCount = state.files.selectedFiles.length;
    const currentResultsCount = state.analysis.results.length;

    const hasRelevantChange =
      currentPhase !== lastSavedPhase ||
      currentFilesCount !== lastSavedFilesCount ||
      currentResultsCount !== lastSavedResultsCount;

    if (!hasRelevantChange) {
      return result;
    }

    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    saveTimeout = setTimeout(() => {
      // Update tracking variables
      lastSavedPhase = currentPhase;
      lastSavedFilesCount = currentFilesCount;
      lastSavedResultsCount = currentResultsCount;
      try {
        const stateToSave = {
          ui: {
            currentPhase: state.ui.currentPhase,
            theme: state.ui.theme,
            sidebarOpen: state.ui.sidebarOpen,
            showSettings: state.ui.showSettings,
          },
          files: {
            selectedFiles: state.files.selectedFiles.slice(0, 200), // Limit size
            smartFolders: state.files.smartFolders,
            organizedFiles: state.files.organizedFiles.slice(0, 200),
            namingConvention: state.files.namingConvention,
            fileStates: {},
          },
          analysis: {
            // Analysis results
            results: state.analysis.results.slice(0, 200),
            isAnalyzing: state.analysis.isAnalyzing,
            analysisProgress: state.analysis.analysisProgress,
            currentAnalysisFile: state.analysis.currentAnalysisFile,
          },
          timestamp: Date.now(),
        };

        // Persist fileStates separately or limited
        // Deep copy or just careful selection
        const fileStatesEntries = Object.entries(state.files.fileStates);
        if (fileStatesEntries.length > 0) {
          // Keep last 100
          const recentStates = Object.fromEntries(
            fileStatesEntries.slice(-100),
          );
          stateToSave.files.fileStates = recentStates;
        }

        localStorage.setItem(
          'stratosort_redux_state',
          JSON.stringify(stateToSave),
        );
      } catch (error) {
        logger.error('Failed to save state:', { error: error.message });
        if (error.name === 'QuotaExceededError') {
          // Try to clear old state
          localStorage.removeItem('stratosort_redux_state');
        }
      }
    }, SAVE_DEBOUNCE_MS);
  }

  return result;
};

// Cleanup function for HMR and app shutdown
export const cleanupPersistence = () => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  lastSavedPhase = null;
  lastSavedFilesCount = -1;
  lastSavedResultsCount = -1;
};

export default persistenceMiddleware;
