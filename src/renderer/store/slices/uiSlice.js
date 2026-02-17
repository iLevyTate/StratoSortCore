import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { PHASES, PHASE_TRANSITIONS, PHASE_ORDER } from '../../../shared/constants';
import { logger } from '../../../shared/logger';
import { serializeData } from '../../utils/serialization';
import { settingsIpc } from '../../services/ipc';

const VALID_PHASES = PHASE_ORDER;

function isValidPhase(phase) {
  return phase != null && typeof phase === 'string' && VALID_PHASES.includes(phase);
}

function canTransitionTo(fromPhase, toPhase) {
  if (!isValidPhase(fromPhase) || !isValidPhase(toPhase)) {
    return false;
  }

  if (fromPhase === toPhase) return true;

  const allowedTransitions = PHASE_TRANSITIONS[fromPhase];
  if (Array.isArray(allowedTransitions)) {
    return allowedTransitions.includes(toPhase);
  }
  return allowedTransitions === toPhase;
}

// Navigation state rules - determines when navigation buttons should be disabled.
const NAVIGATION_RULES = {
  canGoBack: (state, context = {}) => {
    if (state.currentPhase === PHASES.WELCOME) return false;
    if (state.isLoading) return false;
    if (state.isOrganizing || context.isAnalyzing) return false;
    return true;
  },
  canGoNext: (state, context = {}) => {
    if (state.isLoading) return false;
    if (state.isOrganizing || context.isAnalyzing) return false;

    switch (state.currentPhase) {
      case PHASES.SETUP:
        return context.hasSmartFolders === true;
      case PHASES.DISCOVER:
        return context.hasAnalyzedFiles || context.totalAnalysisFailure;
      case PHASES.ORGANIZE:
        return context.hasProcessedFiles;
      case PHASES.COMPLETE:
        return true;
      default:
        return true;
    }
  },
  getAllowedTransitions: (fromPhase) => {
    if (!isValidPhase(fromPhase)) return [];
    return PHASE_TRANSITIONS[fromPhase] || [];
  }
};

// Thunk to fetch settings (only once, then cached).
export const fetchSettings = createAsyncThunk(
  'ui/fetchSettings',
  async (arg, { getState, rejectWithValue }) => {
    const forceRefresh = arg === true;
    const { ui } = getState();
    // Return cached value if already fetched and not forcing refresh
    if (!forceRefresh && ui.settings) {
      return ui.settings;
    }
    try {
      const settings = await settingsIpc.get();
      return settings || {};
    } catch (error) {
      logger.error('[uiSlice] Failed to fetch settings', { error: error?.message });
      return rejectWithValue(error?.message || 'Failed to load settings');
    }
  }
);

const initialState = {
  currentPhase: PHASES.WELCOME,
  previousPhase: null, // Track previous phase for back navigation
  sidebarOpen: true,
  showSettings: false,
  isLoading: false,
  loadingMessage: '',
  activeModal: null, // 'history', 'confirm', etc.
  settings: null, // Cached settings from main process
  settingsLoading: false,
  settingsError: null,
  isOrganizing: false,
  isDiscovering: false,
  isProcessing: false,
  navigationError: null,
  lastOperationError: null, // { operation: string, message: string, timestamp: number }
  resetCounter: 0 // Incremented on reset to invalidate selector caches
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setPhase: (state, action) => {
      const newPhase = action.payload;

      // Clear any previous navigation error
      state.navigationError = null;

      // Validate that the new phase is a valid phase value
      if (!isValidPhase(newPhase)) {
        const error = `Invalid phase attempted: ${String(newPhase)}`;
        logger.error(`[uiSlice] ${error}`, {
          phase: newPhase,
          validPhases: VALID_PHASES
        });
        state.navigationError = error;
        state.currentPhase = PHASES.WELCOME;
        state.previousPhase = null;
        return;
      }

      const currentPhaseValid = isValidPhase(state.currentPhase);
      if (!currentPhaseValid) {
        logger.warn('[uiSlice] Recovering from invalid current phase during setPhase', {
          currentPhase: state.currentPhase,
          nextPhase: newPhase
        });
      }

      // Validate that the transition is allowed by the central transition graph.
      if (
        currentPhaseValid &&
        state.currentPhase !== newPhase &&
        !canTransitionTo(state.currentPhase, newPhase)
      ) {
        const warning = `Invalid phase transition: ${state.currentPhase} -> ${newPhase}`;
        logger.warn(`[uiSlice] ${warning}`, {
          from: state.currentPhase,
          to: newPhase,
          allowedTransitions: PHASE_TRANSITIONS[state.currentPhase] || []
        });
        state.navigationError = warning;
        return;
      }

      // Track previous phase for back navigation
      if (state.currentPhase !== newPhase) {
        state.previousPhase = currentPhaseValid ? state.currentPhase : null;
        state.isLoading = false;
        state.loadingMessage = '';
        state.isOrganizing = false;
      }

      state.currentPhase = newPhase;
    },

    setOrganizing: (state, action) => {
      state.isOrganizing = Boolean(action.payload);
    },
    toggleSidebar: (state) => {
      state.sidebarOpen = !state.sidebarOpen;
    },
    toggleSettings: (state) => {
      state.showSettings = !state.showSettings;
    },
    setLoading: (state, action) => {
      if (typeof action.payload === 'boolean') {
        state.isLoading = action.payload;
        state.loadingMessage = '';
      } else {
        state.isLoading = action.payload.isLoading;
        state.loadingMessage = action.payload.message || '';
      }
    },
    setActiveModal: (state, action) => {
      state.activeModal = action.payload;
    },
    resetUi: (state) => {
      const nextResetCounter = (state?.resetCounter || 0) + 1;
      return {
        ...initialState,
        resetCounter: nextResetCounter
      };
    },
    clearNavigationError: (state) => {
      state.navigationError = null;
    },
    goBack: (state) => {
      if (
        state.previousPhase &&
        isValidPhase(state.previousPhase) &&
        canTransitionTo(state.currentPhase, state.previousPhase)
      ) {
        state.currentPhase = state.previousPhase;
        state.previousPhase = null;
        state.navigationError = null;
      } else {
        state.previousPhase = null;
        state.currentPhase = PHASES.WELCOME;
      }
      state.isLoading = false;
      state.loadingMessage = '';
      state.isOrganizing = false;
    },
    updateSettings: (state, action) => {
      state.settings = { ...(state.settings || {}), ...serializeData(action.payload) };
    },
    setDiscovering: (state, action) => {
      state.isDiscovering = Boolean(action.payload);
    },
    setProcessing: (state, action) => {
      state.isProcessing = Boolean(action.payload);
    },
    setOperationError: (state, action) => {
      if (action.payload) {
        state.lastOperationError = {
          operation: action.payload.operation || 'unknown',
          message: action.payload.message || 'An error occurred',
          timestamp: Date.now()
        };
      } else {
        state.lastOperationError = null;
      }
    },
    clearOperationError: (state) => {
      state.lastOperationError = null;
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSettings.pending, (state) => {
        state.settingsLoading = true;
        state.settingsError = null;
      })
      .addCase(fetchSettings.fulfilled, (state, action) => {
        state.settings = action.payload;
        state.settingsLoading = false;
        state.settingsError = null;
      })
      .addCase(fetchSettings.rejected, (state, action) => {
        if (!state.settings) {
          state.settings = {};
        }
        state.settingsLoading = false;
        state.settingsError = action.payload || action.error?.message || 'Failed to load settings';
      });
  }
});

export const {
  setPhase,
  toggleSidebar,
  toggleSettings,
  setLoading,
  setActiveModal,
  resetUi,
  updateSettings,
  setOrganizing,
  setDiscovering,
  setProcessing,
  setOperationError,
  clearOperationError,
  clearNavigationError,
  goBack
} = uiSlice.actions;

// Export navigation rules for use in components
export { NAVIGATION_RULES, isValidPhase, canTransitionTo };

export default uiSlice.reducer;
