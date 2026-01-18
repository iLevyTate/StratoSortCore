import { PHASES } from '../../../shared/constants';
import { logger } from '../../../shared/logger';

const SAVE_DEBOUNCE_MS = 1000;
// FIX #24: Add max wait time to prevent infinite debounce delay
const MAX_DEBOUNCE_WAIT_MS = 5000;
const MAX_LOCALSTORAGE_BYTES = 4 * 1024 * 1024;
let saveTimeout = null;
let lastSaveAttempt = 0; // Track when we last tried to save
let lastSavedPhase = null;
let lastSavedFilesCount = -1;
let lastSavedResultsCount = -1;
// FIX: Track fileStates changes to ensure file state updates trigger persistence
let lastSavedFileStatesCount = -1;
let lastSavedFileStatesHash = '';
// FIX: Re-entry guard to prevent infinite loops if save triggers actions
let isSaving = false;

/**
 * FIX #1: Graceful quota handling - try progressively smaller saves
 * @param {string} key - localStorage key
 * @param {Object} stateToSave - Full state object
 * @returns {boolean} - Whether save succeeded
 */
function saveWithQuotaHandling(key, stateToSave) {
  const estimateSize = (value) => {
    try {
      const json = JSON.stringify(value);
      if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(json).length;
      }
      return json.length;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  };

  let candidate = stateToSave;
  const estimatedBytes = estimateSize(candidate);
  if (estimatedBytes > MAX_LOCALSTORAGE_BYTES) {
    candidate = {
      ...stateToSave,
      files: {
        ...stateToSave.files,
        selectedFiles: stateToSave.files.selectedFiles?.slice(0, 100) || [],
        organizedFiles: stateToSave.files.organizedFiles?.slice(0, 100) || [],
        fileStates: Object.fromEntries(
          Object.entries(stateToSave.files.fileStates || {}).slice(-50)
        )
      },
      analysis: {
        ...stateToSave.analysis,
        results: stateToSave.analysis.results?.slice(0, 100) || []
      },
      _partial: true
    };
  }

  // Try full save first
  try {
    localStorage.setItem(key, JSON.stringify(candidate));
    return true;
  } catch (error) {
    if (error.name !== 'QuotaExceededError') {
      logger.error('Failed to save state (non-quota error):', { error: error.message });
      return false;
    }
  }

  // Quota exceeded - try progressively smaller saves
  logger.warn('localStorage quota exceeded, attempting graceful degradation');

  // Attempt 1: Reduce arrays to 50 items each
  try {
    const reducedState = {
      ...stateToSave,
      files: {
        ...stateToSave.files,
        selectedFiles: stateToSave.files.selectedFiles?.slice(0, 50) || [],
        organizedFiles: stateToSave.files.organizedFiles?.slice(0, 50) || [],
        fileStates: Object.fromEntries(
          Object.entries(stateToSave.files.fileStates || {}).slice(-25)
        )
      },
      analysis: {
        ...stateToSave.analysis,
        results: stateToSave.analysis.results?.slice(0, 50) || []
      }
    };
    localStorage.setItem(key, JSON.stringify(reducedState));
    logger.info('Saved reduced state (50 items per array)');
    return true;
  } catch {
    // Continue to next attempt
  }

  // Attempt 2: Save only critical UI state
  try {
    const minimalState = {
      ui: stateToSave.ui,
      files: {
        smartFolders: stateToSave.files.smartFolders,
        namingConvention: stateToSave.files.namingConvention,
        selectedFiles: [],
        organizedFiles: [],
        fileStates: {}
      },
      analysis: {
        results: [],
        isAnalyzing: false,
        analysisProgress: { current: 0, total: 0 },
        currentAnalysisFile: ''
      },
      timestamp: Date.now(),
      _partial: true // Flag to indicate partial save
    };
    localStorage.setItem(key, JSON.stringify(minimalState));
    logger.warn('Saved minimal state (UI + settings only) due to quota limits');
    return true;
  } catch {
    // Continue to next attempt
  }

  // Attempt 3: Clear old state and try minimal save again
  try {
    localStorage.removeItem(key);
    localStorage.removeItem('stratosort_workflow_state'); // Also clear old workflow state
    const emergencyState = {
      ui: { currentPhase: stateToSave.ui?.currentPhase || PHASES.WELCOME },
      timestamp: Date.now(),
      _emergency: true
    };
    localStorage.setItem(key, JSON.stringify(emergencyState));
    logger.error('Emergency save: cleared old data, saved only current phase');
    return true;
  } catch (finalError) {
    logger.error('All save attempts failed:', { error: finalError.message });
    return false;
  }
}

/**
 * Generate a simple hash of fileStates to detect changes efficiently
 * @param {Object} fileStates - Map of file paths to state objects
 * @returns {string} A hash string representing the current state
 */
function computeFileStatesHash(fileStates) {
  if (!fileStates || typeof fileStates !== 'object') return '';
  const entries = Object.entries(fileStates);
  if (entries.length === 0) return '';
  // Hash based on keys and state values (not full metadata to save computation)
  const stateValues = entries.map(([key, val]) => `${key}:${val?.state || 'unknown'}`).join('|');
  return stateValues;
}

const persistenceMiddleware = (store) => (next) => (action) => {
  const result = next(action);
  const state = store.getState();

  // FIX: Skip if we're currently in a save operation to prevent infinite loops
  if (isSaving) {
    return result;
  }

  // Only save if not in welcome phase and not loading
  if (state.ui.currentPhase !== PHASES.WELCOME && action.type.indexOf('setLoading') === -1) {
    // Performance: Skip save if key state hasn't changed
    const { currentPhase } = state.ui;
    const currentFilesCount = state.files.selectedFiles.length;
    const currentResultsCount = state.analysis.results.length;
    // FIX: Track fileStates changes
    const currentFileStatesCount = Object.keys(state.files.fileStates || {}).length;
    const currentFileStatesHash = computeFileStatesHash(state.files.fileStates);

    const hasRelevantChange =
      currentPhase !== lastSavedPhase ||
      currentFilesCount !== lastSavedFilesCount ||
      currentResultsCount !== lastSavedResultsCount ||
      // FIX: Check fileStates changes by count and hash
      currentFileStatesCount !== lastSavedFileStatesCount ||
      currentFileStatesHash !== lastSavedFileStatesHash;

    if (!hasRelevantChange) {
      return result;
    }

    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    // FIX #24: Force save if we've been debouncing too long
    const now = Date.now();
    const shouldForceImmediate =
      lastSaveAttempt > 0 && now - lastSaveAttempt > MAX_DEBOUNCE_WAIT_MS;
    const delay = shouldForceImmediate ? 0 : SAVE_DEBOUNCE_MS;

    saveTimeout = setTimeout(() => {
      // FIX: Set re-entry guard before save
      isSaving = true;

      try {
        const stateToSave = {
          ui: {
            currentPhase: state.ui.currentPhase,
            sidebarOpen: state.ui.sidebarOpen,
            showSettings: state.ui.showSettings
          },
          files: {
            selectedFiles: state.files.selectedFiles.slice(0, 200), // Limit size
            smartFolders: state.files.smartFolders,
            organizedFiles: state.files.organizedFiles.slice(0, 200),
            namingConvention: state.files.namingConvention,
            fileStates: {}
          },
          analysis: {
            // Analysis results
            results: state.analysis.results.slice(0, 200),
            isAnalyzing: state.analysis.isAnalyzing,
            analysisProgress: state.analysis.analysisProgress,
            currentAnalysisFile: state.analysis.currentAnalysisFile
          },
          timestamp: Date.now()
        };

        // IMPORTANT: Naming conventions are now separated into two independent systems:
        // 1. Discover phase (Redux state.files.namingConvention) - Session-based, UI-only
        // 2. Settings (persisted settings.namingConvention) - Persistent, used by watchers/reanalysis
        //
        // We do NOT sync Discover phase naming to Settings anymore. This ensures:
        // - Settings naming conventions control: DownloadWatcher, SmartFolderWatcher, Reanalyze
        // - Discover naming conventions control: Manual file analysis in Discover phase only
        //
        // Previous behavior synced Redux → Settings, which caused Discover choices to
        // overwrite the user's Settings, breaking the intended separation.

        // Persist fileStates separately or limited
        // FIX: Prioritize in-progress and error states over completed ones
        // This prevents losing important state information on restart
        const fileStatesEntries = Object.entries(state.files.fileStates);
        if (fileStatesEntries.length > 0) {
          const MAX_STATES = 100;
          if (fileStatesEntries.length <= MAX_STATES) {
            stateToSave.files.fileStates = Object.fromEntries(fileStatesEntries);
          } else {
            // Separate by priority: in-progress/error states are more important
            const priorityStates = [];
            const completedStates = [];

            for (const [path, stateInfo] of fileStatesEntries) {
              const stateType = stateInfo?.state || '';
              if (stateType === 'analyzing' || stateType === 'error' || stateType === 'pending') {
                priorityStates.push([path, stateInfo]);
              } else {
                completedStates.push([path, stateInfo]);
              }
            }

            // Take all priority states, then fill remaining slots with recent completed
            const remainingSlots = MAX_STATES - priorityStates.length;
            const recentCompleted = completedStates.slice(-Math.max(0, remainingSlots));
            const combinedStates = [...priorityStates, ...recentCompleted].slice(-MAX_STATES);

            stateToSave.files.fileStates = Object.fromEntries(combinedStates);
          }
        }

        // FIX #1: Use graceful quota handling instead of silent data loss
        const saveSuccess = saveWithQuotaHandling('stratosort_redux_state', stateToSave);

        // FIX CRIT-18: Only update tracking variables if save succeeded
        // This prevents state staleness where we think we saved but actually failed
        if (saveSuccess) {
          lastSavedPhase = currentPhase;
          lastSavedFilesCount = currentFilesCount;
          lastSavedResultsCount = currentResultsCount;
          lastSavedFileStatesCount = currentFileStatesCount;
          lastSavedFileStatesHash = currentFileStatesHash;
          lastSaveAttempt = Date.now();
        }
      } finally {
        // FIX: Clear re-entry guard
        isSaving = false;
      }
    }, delay);
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
  // FIX: Reset fileStates tracking variables
  lastSavedFileStatesCount = -1;
  lastSavedFileStatesHash = '';
};

export default persistenceMiddleware;
