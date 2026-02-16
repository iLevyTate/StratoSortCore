import { configureStore } from '@reduxjs/toolkit';
import uiReducer from './slices/uiSlice';
import filesReducer from './slices/filesSlice';
import analysisReducer from './slices/analysisSlice';
import systemReducer from './slices/systemSlice';
import ipcMiddleware, { markStoreReady } from './middleware/ipcMiddleware';
import persistenceMiddleware from './middleware/persistenceMiddleware';
import { migrateState } from './migrations';
import { PHASES, PHASE_ORDER } from '../../shared/constants';
import { logger } from '../../shared/logger';

// Helper to serialize file objects loaded from localStorage
// Converts Date objects to ISO strings for Redux compatibility
const serializeLoadedFile = (file) => {
  if (!file || typeof file !== 'object') return file;
  const serialized = { ...file };
  ['created', 'modified', 'accessed', 'birthtime', 'mtime', 'atime', 'ctime'].forEach((key) => {
    if (serialized[key]) {
      // Handle both Date objects and date strings that might parse as Date
      if (serialized[key] instanceof Date) {
        serialized[key] = serialized[key].toISOString();
      } else if (typeof serialized[key] === 'string' && !serialized[key].endsWith('Z')) {
        // Already a string but might be invalid format - normalize it
        try {
          const date = new Date(serialized[key]);
          if (!isNaN(date.getTime())) {
            serialized[key] = date.toISOString();
          }
        } catch {
          // Keep original if parsing fails
        }
      }
    }
  });
  return serialized;
};

const serializeLoadedFiles = (files) => {
  // FIX: Handle null/undefined and non-array inputs safely
  if (files == null) return [];
  if (!Array.isArray(files)) {
    logger.warn('[Store] serializeLoadedFiles received non-array input, returning empty array');
    return [];
  }
  return files.map(serializeLoadedFile);
};

/**
 * Lightweight type validation for loaded state.
 * Fixes corrupted values to their defaults rather than rejecting the entire state.
 * This catches cases where persisted data was mangled (e.g., an array stored as a string).
 */
const validateLoadedState = (state) => {
  if (!state || typeof state !== 'object') return null;

  if (state.ui) {
    if (
      typeof state.ui.currentPhase !== 'string' ||
      !(PHASE_ORDER || []).includes(state.ui.currentPhase)
    ) {
      state.ui.currentPhase = PHASES?.WELCOME ?? 'welcome';
    }
  }

  if (state.files) {
    if (!Array.isArray(state.files.selectedFiles)) state.files.selectedFiles = [];
    if (!Array.isArray(state.files.smartFolders)) state.files.smartFolders = [];
    if (!Array.isArray(state.files.organizedFiles)) state.files.organizedFiles = [];
    if (
      state.files.fileStates == null ||
      typeof state.files.fileStates !== 'object' ||
      Array.isArray(state.files.fileStates)
    ) {
      state.files.fileStates = {};
    }
  }

  if (state.analysis) {
    if (!Array.isArray(state.analysis.results)) state.analysis.results = [];
  }

  if (state.system) {
    if (!Array.isArray(state.system.notifications)) state.system.notifications = [];
  }

  return state;
};

// Load persisted state
const loadState = () => {
  try {
    const serializedState = localStorage.getItem('stratosort_redux_state');
    if (serializedState === null) {
      // Try migration from legacy state
      const legacyState = localStorage.getItem('stratosort_workflow_state');
      if (legacyState) {
        try {
          const parsedLegacy = JSON.parse(legacyState);
          // FIX: Ensure all slice properties have explicit defaults for complete state
          return {
            ui: {
              // FIX: Add null check for PHASES to prevent crash during module initialization
              currentPhase: parsedLegacy.currentPhase || (PHASES?.WELCOME ?? 'welcome'),
              previousPhase: null,
              sidebarOpen: true,
              showSettings: false,
              isLoading: false,
              loadingMessage: '',
              activeModal: null,
              settings: null,
              settingsLoading: false,
              settingsError: null,
              isOrganizing: false,
              isDiscovering: false,
              isProcessing: false,
              navigationError: null,
              lastOperationError: null,
              resetCounter: 0
            },
            files: {
              // Serialize dates in legacy state
              selectedFiles: serializeLoadedFiles(parsedLegacy.phaseData?.selectedFiles || []),
              smartFolders: parsedLegacy.phaseData?.smartFolders || [],
              smartFoldersLoading: false,
              smartFoldersError: null,
              organizedFiles: serializeLoadedFiles(parsedLegacy.phaseData?.organizedFiles || []),
              fileStates: parsedLegacy.phaseData?.fileStates || {},
              namingConvention: parsedLegacy.phaseData?.namingConvention || {
                convention: 'subject-date',
                dateFormat: 'YYYY-MM-DD',
                caseConvention: 'kebab-case',
                separator: '-'
              }
            },
            analysis: {
              results: serializeLoadedFiles(parsedLegacy.phaseData?.analysisResults || []),
              isAnalyzing: false,
              analysisProgress: { current: 0, total: 0, lastActivity: 0 },
              currentAnalysisFile: '',
              stats: null
            }
          };
        } catch {
          return undefined;
        }
      }
      return undefined;
    }
    const parsedRaw = JSON.parse(serializedState);
    const migrated = migrateState(parsedRaw);
    const parsed = migrated ? validateLoadedState(migrated) : null;

    if (!parsed) {
      // Migration failed or returned null - start fresh
      logger.warn('[Store] State migration returned null, starting with fresh state');
      return undefined;
    }

    // State TTL: 24 hours
    // Rationale: Expire persisted state after 24 hours to prevent stale data issues
    // when the app hasn't been used for a while. This ensures users start fresh
    // rather than resuming a potentially outdated workflow state.
    const STATE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    const parsedTimestamp = Number(parsed.timestamp);
    const hasValidTimestamp = Number.isFinite(parsedTimestamp);
    const stateAgeMs = hasValidTimestamp ? Date.now() - parsedTimestamp : Number.POSITIVE_INFINITY;

    if (!hasValidTimestamp) {
      logger.warn(
        '[Store] Persisted state missing/invalid timestamp; expiring session state defensively'
      );
    }

    if (stateAgeMs > STATE_TTL_MS) {
      // FIX: Store flag so UI can notify user their state was expired
      // This prevents silent data loss confusion
      window.__STRATOSORT_STATE_EXPIRED__ = true;
      window.__STRATOSORT_STATE_EXPIRED_AGE_HOURS__ = hasValidTimestamp
        ? Math.round(stateAgeMs / (1000 * 60 * 60))
        : 24;

      // Preserve durable data (smart folders + organization history) while resetting session state.
      return {
        ui: {
          currentPhase: PHASES?.WELCOME ?? 'welcome',
          previousPhase: null,
          sidebarOpen: true,
          showSettings: false,
          isLoading: false,
          loadingMessage: '',
          activeModal: null,
          settings: null,
          settingsLoading: false,
          settingsError: null,
          isOrganizing: false,
          isDiscovering: false,
          isProcessing: false,
          navigationError: null,
          lastOperationError: null,
          resetCounter: 0
        },
        files: {
          selectedFiles: [],
          organizedFiles: serializeLoadedFiles(parsed.files?.organizedFiles || []),
          smartFolders: parsed.files?.smartFolders || [],
          smartFoldersLoading: false,
          smartFoldersError: null,
          fileStates: {},
          namingConvention: parsed.files?.namingConvention || {
            convention: 'subject-date',
            dateFormat: 'YYYY-MM-DD',
            caseConvention: 'kebab-case',
            separator: '-'
          }
        },
        analysis: {
          isAnalyzing: false,
          analysisProgress: { current: 0, total: 0, lastActivity: 0 },
          currentAnalysisFile: '',
          results: [],
          stats: null
        },
        system: {
          metrics: { cpu: 0, memory: 0, uptime: 0 },
          health: {
            // In-process services (Orama, node-llama-cpp) are always online after init.
            // No IPC event updates these, so they must match systemSlice initialState.
            vectorDb: 'online',
            llama: 'online'
          },
          notifications: [],
          unreadNotificationCount: 0,
          version: '1.0.0',
          documentsPath: parsed.system?.documentsPath || null,
          documentsPathLoading: false,
          documentsPathError: null,
          redactPaths: null,
          redactPathsLoading: false,
          redactPathsError: null
        }
      };
    }

    // FIX CRIT-4: Explicitly set defaults for ALL slice properties to prevent null/undefined
    // from persisted state overriding slice initial state defaults
    return {
      ui: {
        // FIX: Add null check for PHASES to prevent crash during module initialization
        currentPhase: parsed.ui?.currentPhase || (PHASES?.WELCOME ?? 'welcome'),
        previousPhase: parsed.ui?.previousPhase || null,
        sidebarOpen: parsed.ui?.sidebarOpen !== false, // default true
        // Do not rehydrate transient overlays on startup
        showSettings: false,
        isLoading: false, // Always reset loading state
        loadingMessage: '',
        activeModal: null,
        settings: parsed.ui?.settings || null,
        settingsLoading: false,
        settingsError: null,
        isOrganizing: false,
        isDiscovering: false,
        isProcessing: false,
        navigationError: null,
        lastOperationError: null,
        resetCounter: 0
      },
      files: {
        // Ensure arrays and serialize dates, with explicit defaults for all properties
        selectedFiles: serializeLoadedFiles(parsed.files?.selectedFiles || []),
        organizedFiles: serializeLoadedFiles(parsed.files?.organizedFiles || []),
        smartFolders: parsed.files?.smartFolders || [],
        smartFoldersLoading: false,
        smartFoldersError: null, // FIX: Missing error state
        fileStates: parsed.files?.fileStates || {},
        namingConvention: parsed.files?.namingConvention || {
          convention: 'subject-date',
          dateFormat: 'YYYY-MM-DD',
          caseConvention: 'kebab-case',
          separator: '-'
        }
      },
      analysis: {
        isAnalyzing: false, // Reset analysis state on reload
        analysisProgress: { current: 0, total: 0, lastActivity: 0 },
        currentAnalysisFile: '',
        // Serialize dates in analysis results too
        results: serializeLoadedFiles(parsed.analysis?.results || [])
      }
      // System slice is NOT restored from persistence. It uses its own initialState
      // defaults (systemSlice.js) and re-fetches documentsPath/redactPaths via IPC
      // thunks dispatched in index.js on every startup.
    };
  } catch {
    return undefined;
  }
};

const preloadedState = loadState();

const store = configureStore({
  reducer: {
    ui: uiReducer,
    files: filesReducer,
    analysis: analysisReducer,
    system: systemReducer
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      immutableCheck: {
        // Large analysis result sets can exceed the default 32ms dev warning budget.
        // Keep immutability checks enabled, but tune hot large collections.
        warnAfter: 128,
        ignoredPaths: [
          'analysis.results',
          'files.selectedFiles',
          'files.organizedFiles',
          'files.fileStates'
        ]
      },
      serializableCheck: {
        // Keep serializable safety checks on in development, but relax the threshold
        // and skip known large, frequently-updated analysis payloads.
        warnAfter: 128,
        // Ignore non-serializable values in actions if needed (e.g. Error objects)
        ignoredActions: [
          'analysis/analysisFailure',
          'analysis/startAnalysis',
          'analysis/updateProgress',
          'analysis/setAnalysisResults',
          'files/setSelectedFiles',
          'files/addSelectedFiles',
          'files/setFileStates',
          'files/setOrganizedFiles'
        ],
        // Ignore date fields that might have Date objects from IPC responses
        ignoredActionPaths: [
          'payload.created',
          'payload.modified',
          'payload.accessed',
          'payload.birthtime',
          'payload.mtime',
          'payload.atime',
          'payload.ctime',
          'payload.analysis',
          'payload.results',
          'payload.fileStates',
          'meta.arg'
        ],
        ignoredPaths: [
          'analysis.results.error',
          'analysis.results',
          'files.selectedFiles',
          'files.organizedFiles',
          'files.fileStates',
          // File date fields - these are serialized but might briefly contain Date objects during IPC
          /files\.selectedFiles\.\d+\.(created|modified|accessed|birthtime|mtime|atime|ctime)/,
          /files\.organizedFiles\.\d+\.(created|modified|accessed|birthtime|mtime|atime|ctime)/,
          /analysis\.results\.\d+\.(created|modified|accessed|birthtime|mtime|atime|ctime)/
        ]
      }
    }).concat(ipcMiddleware, persistenceMiddleware),
  preloadedState
});

// FIX Issue 3: Mark store as ready to flush any queued IPC events
markStoreReady();

// NOTE: State-expiration notification is handled by WelcomePhase.jsx (which
// shows a visible toast). The TTL-expired loadState path always resets to the
// WELCOME phase, so WelcomePhase is guaranteed to mount and display the notice.
// A previous duplicate handler here dispatched a silent Redux entry, causing
// two notification records for the same event.

export default store;
