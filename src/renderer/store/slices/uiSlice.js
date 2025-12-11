import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { PHASES, PHASE_TRANSITIONS } from '../../../shared/constants';
import { logger } from '../../../shared/logger';

// FIX: Phase validation utility to prevent invalid navigation states
const VALID_PHASES = Object.values(PHASES);

function isValidPhase(phase) {
  return phase != null && typeof phase === 'string' && VALID_PHASES.includes(phase);
}

function canTransitionTo(fromPhase, toPhase) {
  if (!isValidPhase(fromPhase) || !isValidPhase(toPhase)) {
    return false;
  }
  const allowedTransitions = PHASE_TRANSITIONS[fromPhase] || [];
  return allowedTransitions.includes(toPhase) || fromPhase === toPhase;
}

// Navigation state rules - determines when navigation buttons should be disabled
// This centralizes the logic to prevent inconsistencies across components
const NAVIGATION_RULES = {
  // Rules for when "Back" button should be disabled
  canGoBack: (state) => {
    // Cannot go back from welcome phase
    if (state.currentPhase === PHASES.WELCOME) return false;
    // Cannot go back while loading/processing
    if (state.isLoading) return false;
    // Cannot go back during file operations
    if (state.isOrganizing || state.isAnalyzing) return false;
    return true;
  },
  // Rules for when "Next/Continue" button should be disabled
  canGoNext: (state, context = {}) => {
    // Cannot advance while loading
    if (state.isLoading) return false;
    // Cannot advance during file operations
    if (state.isOrganizing || state.isAnalyzing) return false;

    // Phase-specific rules
    switch (state.currentPhase) {
      case PHASES.SETUP:
        // Setup requires at least one smart folder (context provides this)
        return context.hasSmartFolders !== false;
      case PHASES.DISCOVER:
        // Discover requires files to be analyzed (or total failure acknowledged)
        return context.hasAnalyzedFiles || context.totalAnalysisFailure;
      case PHASES.ORGANIZE:
        // Organize requires at least one processed file to view results
        return context.hasProcessedFiles;
      case PHASES.COMPLETE:
        // Complete phase can always start a new session
        return true;
      default:
        return true;
    }
  },
  // Get allowed transitions from current phase
  getAllowedTransitions: (fromPhase) => {
    if (!isValidPhase(fromPhase)) return [];
    return PHASE_TRANSITIONS[fromPhase] || [];
  }
};

// Thunk to fetch settings (only once, then cached)
export const fetchSettings = createAsyncThunk('ui/fetchSettings', async (_, { getState }) => {
  const { ui } = getState();
  // Return cached value if already fetched
  if (ui.settings) {
    return ui.settings;
  }
  const settings = await window.electronAPI?.settings?.get?.();
  return settings || {};
});

const initialState = {
  currentPhase: PHASES.WELCOME || 'welcome',
  previousPhase: null, // Track previous phase for back navigation
  theme: 'light', // 'light', 'dark', 'system'
  sidebarOpen: true,
  showSettings: false,
  isLoading: false,
  loadingMessage: '',
  activeModal: null, // 'history', 'confirm', etc.
  settings: null, // Cached settings from main process
  settingsLoading: false,
  // Navigation state tracking for consistent button states
  isOrganizing: false, // True during file organization operations
  isAnalyzing: false, // True during analysis operations
  navigationError: null // Last navigation error for debugging
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    // FIX: Add validation to prevent invalid navigation states
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
        // Reset to safe state instead of corrupting the store
        state.currentPhase = PHASES.WELCOME;
        state.previousPhase = null;
        return;
      }

      // Validate that the transition is allowed (unless it's the same phase)
      if (state.currentPhase !== newPhase && !canTransitionTo(state.currentPhase, newPhase)) {
        const warning = `Invalid phase transition: ${state.currentPhase} -> ${newPhase}`;
        logger.warn(`[uiSlice] ${warning}`, {
          from: state.currentPhase,
          to: newPhase,
          allowedTransitions: PHASE_TRANSITIONS[state.currentPhase] || []
        });
        // Still allow the transition but track the warning for debugging
        // This allows flexibility while tracking potential issues
        state.navigationError = warning;
      }

      // Track previous phase for back navigation
      if (state.currentPhase !== newPhase) {
        state.previousPhase = state.currentPhase;
      }

      state.currentPhase = newPhase;
    },

    // Set operation states that affect navigation
    setOrganizing: (state, action) => {
      state.isOrganizing = Boolean(action.payload);
    },
    setAnalyzing: (state, action) => {
      state.isAnalyzing = Boolean(action.payload);
    },
    setTheme: (state, action) => {
      state.theme = action.payload;
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
    resetUi: () => {
      // Reset to initial state but preserve theme preference
      return {
        ...initialState
        // Theme persisted separately, so we don't reset it
      };
    },
    // Clear navigation error
    clearNavigationError: (state) => {
      state.navigationError = null;
    },
    // Go back to previous phase (if valid)
    goBack: (state) => {
      if (state.previousPhase && isValidPhase(state.previousPhase)) {
        const temp = state.currentPhase;
        state.currentPhase = state.previousPhase;
        state.previousPhase = temp;
        state.navigationError = null;
      } else {
        // Default to welcome if no previous phase
        state.previousPhase = state.currentPhase;
        state.currentPhase = PHASES.WELCOME;
      }
    },
    updateSettings: (state, action) => {
      // CRITICAL FIX: Handle case where settings is null before first fetch
      state.settings = { ...(state.settings || {}), ...action.payload };
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSettings.pending, (state) => {
        state.settingsLoading = true;
      })
      .addCase(fetchSettings.fulfilled, (state, action) => {
        state.settings = action.payload;
        state.settingsLoading = false;
      })
      .addCase(fetchSettings.rejected, (state) => {
        // CRITICAL FIX: Provide default empty object to prevent null reference errors
        // Components accessing settings.someProp will get undefined instead of crashing
        state.settings = {};
        state.settingsLoading = false;
      });
  }
});

export const {
  setPhase,
  setTheme,
  toggleSidebar,
  toggleSettings,
  setLoading,
  setActiveModal,
  resetUi,
  updateSettings,
  setOrganizing,
  setAnalyzing,
  clearNavigationError,
  goBack
} = uiSlice.actions;

// Export navigation rules for use in components
export { NAVIGATION_RULES, isValidPhase, canTransitionTo };

export default uiSlice.reducer;
