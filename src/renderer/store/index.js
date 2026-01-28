import { configureStore } from '@reduxjs/toolkit';
import uiReducer from './slices/uiSlice';
import filesReducer from './slices/filesSlice';
import analysisReducer from './slices/analysisSlice';
import systemReducer from './slices/systemSlice';
import ipcMiddleware, { markStoreReady } from './middleware/ipcMiddleware';
import persistenceMiddleware from './middleware/persistenceMiddleware';
import { PHASES } from '../../shared/constants';
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
              isOrganizing: false,
              isAnalyzing: false,
              navigationError: null
            },
            files: {
              // Serialize dates in legacy state
              selectedFiles: serializeLoadedFiles(parsedLegacy.phaseData?.selectedFiles || []),
              smartFolders: parsedLegacy.phaseData?.smartFolders || [],
              smartFoldersLoading: false,
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
    const parsed = JSON.parse(serializedState);

    // State TTL: 24 hours
    // Rationale: Expire persisted state after 24 hours to prevent stale data issues
    // when the app hasn't been used for a while. This ensures users start fresh
    // rather than resuming a potentially outdated workflow state.
    const STATE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    if (Date.now() - parsed.timestamp > STATE_TTL_MS) {
      // FIX: Store flag so UI can notify user their state was expired
      // This prevents silent data loss confusion
      window.__STRATOSORT_STATE_EXPIRED__ = true;
      window.__STRATOSORT_STATE_EXPIRED_AGE_HOURS__ = Math.round(
        (Date.now() - parsed.timestamp) / (1000 * 60 * 60)
      );

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
          isOrganizing: false,
          isAnalyzing: false,
          navigationError: null
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
            chromadb: 'unknown',
            ollama: 'unknown'
          },
          notifications: [],
          unreadNotificationCount: 0,
          version: '1.0.0',
          documentsPath: parsed.system?.documentsPath || null,
          documentsPathLoading: false
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
        showSettings: parsed.ui?.showSettings || false,
        isLoading: false, // Always reset loading state
        loadingMessage: '',
        activeModal: parsed.ui?.activeModal || null,
        settings: parsed.ui?.settings || null,
        settingsLoading: false,
        isOrganizing: false,
        isAnalyzing: false,
        navigationError: null
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
        results: serializeLoadedFiles(parsed.analysis?.results || []),
        stats: parsed.analysis?.stats || null
      },
      // FIX CRIT-4: Add systemSlice defaults - this was completely missing from loadState
      system: {
        metrics: { cpu: 0, memory: 0, uptime: 0 },
        health: {
          chromadb: 'unknown',
          ollama: 'unknown'
        },
        notifications: [], // Don't restore notifications - they're transient
        unreadNotificationCount: 0,
        version: '1.0.0',
        documentsPath: parsed.system?.documentsPath || null,
        documentsPathLoading: false
      }
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
      serializableCheck: {
        // Ignore non-serializable values in actions if needed (e.g. Error objects)
        ignoredActions: [
          'analysis/analysisFailure',
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
          'meta.arg'
        ],
        ignoredPaths: [
          'analysis.results.error',
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

// FIX HIGH-8: Notify user if their state was expired
// This runs after store is ready so notification can be dispatched
if (window.__STRATOSORT_STATE_EXPIRED__) {
  // Import dynamically to avoid circular dependency
  const { addNotification } = require('./slices/systemSlice');
  const ageHours = window.__STRATOSORT_STATE_EXPIRED_AGE_HOURS__ || 24;
  // Delay notification to ensure UI is ready to display it
  setTimeout(() => {
    store.dispatch(
      addNotification({
        message: `Your previous session data expired after ${ageHours} hours of inactivity. Starting fresh.`,
        severity: 'info',
        duration: 8000
      })
    );
    // Clean up flags
    delete window.__STRATOSORT_STATE_EXPIRED__;
    delete window.__STRATOSORT_STATE_EXPIRED_AGE_HOURS__;
  }, 1000);
}

export default store;
