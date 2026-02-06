import { PHASES } from '../../../shared/constants';
import { logger } from '../../../shared/logger';
import { addNotification } from '../slices/systemSlice';

const SAVE_DEBOUNCE_MS = 1000;
// FIX #24: Add max wait time to prevent infinite debounce delay
const MAX_DEBOUNCE_WAIT_MS = 5000;
const MAX_LOCALSTORAGE_BYTES = 4 * 1024 * 1024;
let saveTimeout = null;
let firstPendingRequestTime = 0; // Track when the first unsaved debounce request was made
let lastSavedPhase = null;
let lastSavedFilesCount = -1;
let lastSavedResultsCount = -1;
let lastSavedOrganizedFilesCount = -1;
let lastSavedSmartFoldersCount = -1;
// FIX: Track fileStates changes to ensure file state updates trigger persistence
let lastSavedFileStatesCount = -1;
let lastSavedFileStatesRef = null;
// FIX: Track UI state changes
let lastSavedSidebarOpen = null;
// NOTE: showSettings is intentionally NOT persisted (transient overlay state).

// FIX: Re-entry guard to prevent infinite loops if save triggers actions
let isSaving = false;

/**
 * FIX #1: Graceful quota handling - try progressively smaller saves
 * FIX CRIT-5: Returns degradation info for user notification
 * @param {string} key - localStorage key
 * @param {Object} stateToSave - Full state object
 * @returns {{ success: boolean, degraded?: string }} - Result with optional degradation level
 */
function saveWithQuotaHandling(key, stateToSave) {
  // Pre-serialize once and reuse for both size estimation and storage
  let candidate = stateToSave;
  let json;
  try {
    json = JSON.stringify(candidate);
  } catch {
    logger.error('Failed to serialize state');
    return { success: false };
  }

  const estimatedBytes =
    typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json).length : json.length;

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
    // Re-serialize the reduced candidate
    try {
      json = JSON.stringify(candidate);
    } catch {
      logger.error('Failed to serialize reduced state');
      return { success: false };
    }
  }

  // Try full save first, reusing pre-serialized JSON
  try {
    localStorage.setItem(key, json);
    return { success: true };
  } catch (error) {
    if (error.name !== 'QuotaExceededError') {
      logger.error('Failed to save state (non-quota error):', { error: error.message });
      return { success: false };
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
    // FIX CRIT-5: Return degradation level for user notification
    return { success: true, degraded: 'reduced' };
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
    // FIX CRIT-5: Return degradation level for user notification
    return { success: true, degraded: 'minimal' };
  } catch {
    // Continue to next attempt
  }

  // Attempt 3: Clear old state and try minimal save again
  try {
    localStorage.removeItem(key);
    localStorage.removeItem('stratosort_workflow_state'); // Also clear old workflow state
    const emergencyState = {
      // FIX: Add null check for PHASES to prevent crash during module initialization
      ui: { currentPhase: stateToSave.ui?.currentPhase || (PHASES?.WELCOME ?? 'welcome') },
      timestamp: Date.now(),
      _emergency: true
    };
    localStorage.setItem(key, JSON.stringify(emergencyState));
    logger.error('Emergency save: cleared old data, saved only current phase');
    // FIX CRIT-5: Return degradation level for user notification
    return { success: true, degraded: 'emergency' };
  } catch (finalError) {
    logger.error('All save attempts failed:', { error: finalError.message });
    return { success: false, degraded: 'failed' };
  }
}

/**
 * FIX MEDIUM-3: Detect fileStates changes using a cheap reference + count check.
 * The previous implementation computed a full hash over every key and value on
 * every Redux action dispatch (O(n*m) where m = avg key length). This was the
 * single hottest path in the persistence middleware.
 *
 * New approach: track the object reference itself. Redux Toolkit produces a new
 * object reference whenever fileStates actually changes, so a strict equality
 * check is sufficient. The count check is kept as a secondary guard for edge
 * cases where the reference might be reused (e.g., direct mutations).
 *
 * @param {Object} fileStates - Map of file paths to state objects
 * @returns {Object} fileStates reference (used for identity comparison)
 */
function getFileStatesRef(fileStates) {
  return fileStates || null;
}

// Track beforeunload handler for cleanup
let persistenceUnloadHandler = null;

const persistenceMiddleware = (store) => {
  // Register a beforeunload handler to force a final save when the window closes.
  // Without this, up to 5s of debounced state changes could be lost on close.
  if (!persistenceUnloadHandler && typeof window !== 'undefined') {
    persistenceUnloadHandler = () => cleanupPersistence(store);
    window.addEventListener('beforeunload', persistenceUnloadHandler);
  }

  return (next) => (action) => {
    const result = next(action);
    const state = store.getState();

    // FIX: Skip if we're currently in a save operation to prevent infinite loops
    if (isSaving) {
      return result;
    }

    const isWelcomePhase = state.ui.currentPhase === (PHASES?.WELCOME ?? 'welcome');
    const currentOrganizedFilesCount = state.files.organizedFiles.length;
    const currentSmartFoldersCount = state.files.smartFolders.length;
    const hasDurableData = currentOrganizedFilesCount > 0 || currentSmartFoldersCount > 0;

    // FIX: Never save in WELCOME phase unless there's actual durable data to preserve.
    // This prevents persisting empty/default state when user hasn't done anything yet.
    if (isWelcomePhase && !hasDurableData) {
      return result;
    }

    // Only save if not loading action
    if (action.type.indexOf('setLoading') === -1) {
      // Performance: Skip save if key state hasn't changed
      const { currentPhase, sidebarOpen } = state.ui;
      const currentFilesCount = state.files.selectedFiles.length;
      const currentResultsCount = state.analysis.results.length;
      // FIX: Track fileStates changes
      const currentFileStatesCount = Object.keys(state.files.fileStates || {}).length;
      const currentFileStatesRef = getFileStatesRef(state.files.fileStates);

      const hasRelevantChange =
        currentPhase !== lastSavedPhase ||
        currentFilesCount !== lastSavedFilesCount ||
        currentResultsCount !== lastSavedResultsCount ||
        // FIX: Check organizedFiles count
        currentOrganizedFilesCount !== lastSavedOrganizedFilesCount ||
        currentSmartFoldersCount !== lastSavedSmartFoldersCount ||
        // FIX: Check fileStates changes by reference and count
        currentFileStatesCount !== lastSavedFileStatesCount ||
        currentFileStatesRef !== lastSavedFileStatesRef ||
        // FIX: Check UI state changes (sidebar only; settings overlay is transient)
        sidebarOpen !== lastSavedSidebarOpen;

      if (!hasRelevantChange) {
        return result;
      }

      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }

      // FIX #24: Force save if we've been debouncing too long
      const now = Date.now();
      // Track when the first pending request was made (reset after each save)
      if (firstPendingRequestTime === 0) {
        firstPendingRequestTime = now;
      }
      const shouldForceImmediate =
        firstPendingRequestTime > 0 && now - firstPendingRequestTime > MAX_DEBOUNCE_WAIT_MS;
      const delay = shouldForceImmediate ? 0 : SAVE_DEBOUNCE_MS;

      saveTimeout = setTimeout(() => {
        // FIX: Set re-entry guard before save
        isSaving = true;

        try {
          // FIX: Get fresh state at save time instead of using stale closure reference.
          // The debounce delay (up to 5s) means the state captured at dispatch time
          // may be significantly outdated by the time this callback fires.
          const freshState = store.getState();

          const stateToSave = {
            _version: 1, // Schema version for migration support
            ui: {
              currentPhase: freshState.ui.currentPhase,
              sidebarOpen: freshState.ui.sidebarOpen
            },
            files: {
              selectedFiles: freshState.files.selectedFiles.slice(0, 200), // Limit size
              smartFolders: freshState.files.smartFolders,
              organizedFiles: freshState.files.organizedFiles,
              namingConvention: freshState.files.namingConvention,
              fileStates: {}
            },
            analysis: {
              // Analysis results
              results: freshState.analysis.results.slice(0, 200),
              isAnalyzing: freshState.analysis.isAnalyzing,
              analysisProgress: freshState.analysis.analysisProgress,
              currentAnalysisFile: freshState.analysis.currentAnalysisFile
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
          const fileStatesEntries = Object.entries(freshState.files.fileStates);
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
          const saveResult = saveWithQuotaHandling('stratosort_redux_state', stateToSave);

          // FIX CRIT-5: Notify user if data was degraded due to storage limits
          if (saveResult.degraded) {
            const messages = {
              reduced:
                'Storage space limited - some file history may not be preserved between sessions.',
              minimal:
                'Storage space very limited - only settings and current phase will be preserved.',
              emergency: 'Storage space critically low - cleared old data to continue.',
              failed: 'Unable to save any data - changes will be lost when you close the app.'
            };
            const severity = saveResult.degraded === 'failed' ? 'error' : 'warning';
            store.dispatch(
              addNotification({
                message: messages[saveResult.degraded],
                severity,
                duration: saveResult.degraded === 'failed' ? 0 : 8000 // 0 = persistent
              })
            );
          }

          // FIX CRIT-18: Only update tracking variables if save succeeded
          // This prevents state staleness where we think we saved but actually failed
          // FIX: Recompute tracking values from freshState to match what was actually saved
          if (saveResult.success) {
            lastSavedPhase = freshState.ui.currentPhase;
            lastSavedFilesCount = freshState.files.selectedFiles.length;
            lastSavedResultsCount = freshState.analysis.results.length;
            lastSavedOrganizedFilesCount = freshState.files.organizedFiles.length;
            lastSavedSmartFoldersCount = freshState.files.smartFolders.length;
            lastSavedFileStatesCount = Object.keys(freshState.files.fileStates || {}).length;
            lastSavedFileStatesRef = getFileStatesRef(freshState.files.fileStates);
            lastSavedSidebarOpen = freshState.ui.sidebarOpen;
            firstPendingRequestTime = 0; // Reset so next debounce cycle tracks fresh
          }
        } finally {
          // FIX: Clear re-entry guard
          isSaving = false;
        }
      }, delay);
    }

    return result;
  };
};

/**
 * Cleanup function for HMR and app shutdown.
 * Forces a final synchronous save if a debounced save was pending,
 * then resets all tracking state.
 * @param {Object} [store] - Redux store instance for final save (optional)
 */
export const cleanupPersistence = (store) => {
  // Remove beforeunload handler to prevent accumulation during HMR
  if (persistenceUnloadHandler && typeof window !== 'undefined') {
    window.removeEventListener('beforeunload', persistenceUnloadHandler);
    persistenceUnloadHandler = null;
  }

  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;

    // Force a final save if store is provided and there's pending data
    if (store && firstPendingRequestTime > 0) {
      try {
        const freshState = store.getState();
        const stateToSave = {
          ui: {
            currentPhase: freshState.ui.currentPhase,
            sidebarOpen: freshState.ui.sidebarOpen
          },
          files: {
            selectedFiles: freshState.files.selectedFiles.slice(0, 200),
            smartFolders: freshState.files.smartFolders,
            organizedFiles: freshState.files.organizedFiles,
            namingConvention: freshState.files.namingConvention,
            fileStates: Object.fromEntries(
              Object.entries(freshState.files.fileStates || {}).slice(-100)
            )
          },
          analysis: {
            results: freshState.analysis.results.slice(0, 200),
            isAnalyzing: freshState.analysis.isAnalyzing,
            analysisProgress: freshState.analysis.analysisProgress,
            currentAnalysisFile: freshState.analysis.currentAnalysisFile
          },
          timestamp: Date.now()
        };
        saveWithQuotaHandling('stratosort_redux_state', stateToSave);
      } catch (err) {
        logger.error('Failed to save state during cleanup:', { error: err?.message });
      }
    }
  }
  lastSavedPhase = null;
  lastSavedFilesCount = -1;
  lastSavedResultsCount = -1;
  lastSavedOrganizedFilesCount = -1;
  lastSavedSmartFoldersCount = -1;
  lastSavedFileStatesCount = -1;
  lastSavedFileStatesRef = null;
  lastSavedSidebarOpen = null;
  firstPendingRequestTime = 0;
};

export default persistenceMiddleware;
