import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { PHASES, PHASE_TRANSITIONS, PHASE_ORDER } from '../../../shared/constants';
import { logger } from '../../../shared/logger';
import { serializeData } from '../../utils/serialization';
import { settingsIpc } from '../../services/ipc';

// FIX: Define explicit phase order for navigation logic
// PHASE_ORDER is imported from constants
// FIX: Add fallback to prevent crash if PHASES is undefined during module initialization
const VALID_PHASES = PHASE_ORDER || ['welcome', 'setup', 'discover', 'organize', 'complete'];

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

// Navigation state rules - determines when navigation buttons should be disabled
// This centralizes the logic to prevent inconsistencies across components
// FIX: isAnalyzing should be passed in context from analysisSlice for accurate state
const NAVIGATION_RULES = {
  // Rules for when "Back" button should be disabled
  // context.isAnalyzing must be passed from analysisSlice.isAnalyzing
  canGoBack: (state, context = {}) => {
    // Cannot go back from welcome phase
    // FIX: Add null check for PHASES to prevent crash during module initialization
    if (state.currentPhase === (PHASES?.WELCOME ?? 'welcome')) return false;
    // Cannot go back while loading/processing
    if (state.isLoading) return false;
    // Cannot go back during file operations
    if (state.isOrganizing || context.isAnalyzing) return false;
    return true;
  },
  // Rules for when "Next/Continue" button should be disabled
  canGoNext: (state, context = {}) => {
    // Cannot advance while loading
    if (state.isLoading) return false;
    // Cannot advance during file operations
    if (state.isOrganizing || context.isAnalyzing) return false;

    // Phase-specific rules
    // FIX: Add null checks for PHASES to prevent crash during module initialization
    switch (state.currentPhase) {
      case PHASES?.SETUP ?? 'setup':
        // Setup requires at least one smart folder (context provides this)
        return context.hasSmartFolders === true;
      case PHASES?.DISCOVER ?? 'discover':
        // Discover requires files to be analyzed (or total failure acknowledged)
        return context.hasAnalyzedFiles || context.totalAnalysisFailure;
      case PHASES?.ORGANIZE ?? 'organize':
        // Organize requires at least one processed file to view results
        return context.hasProcessedFiles;
      case PHASES?.COMPLETE ?? 'complete':
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
// FIX: Added forceRefresh parameter to allow cache invalidation
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
  // FIX: Add null check for PHASES to prevent crash during module initialization
  currentPhase: PHASES?.WELCOME ?? 'welcome',
  previousPhase: null, // Track previous phase for back navigation
  sidebarOpen: true,
  showSettings: false,
  isLoading: false,
  loadingMessage: '',
  activeModal: null, // 'history', 'confirm', etc.
  settings: null, // Cached settings from main process
  settingsLoading: false,
  settingsError: null, // FIX: Track settings fetch errors
  // Navigation state tracking for consistent button states
  isOrganizing: false, // True during file organization operations
  // FIX MEDIUM-1: Add additional processing states for better UX feedback
  isDiscovering: false, // True during file discovery/scanning operations
  isProcessing: false, // Generic processing state for any background operation
  navigationError: null, // Last navigation error for debugging
  // FIX MEDIUM-2: Track operation errors with more detail
  lastOperationError: null, // { operation: string, message: string, timestamp: number }
  resetCounter: 0 // Incremented on reset to invalidate selector caches
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
        // FIX: Add null check for PHASES to prevent crash during module initialization
        state.currentPhase = PHASES?.WELCOME ?? 'welcome';
        state.previousPhase = null;
        return;
      }

      const currentPhaseValid = isValidPhase(state.currentPhase);
      if (!currentPhaseValid) {
        logger.warn('[uiSlice] Recovering from invalid current phase during setPhase', {
          currentPhase: state.currentPhase,
          nextPhase: newPhase
        });
        state.previousPhase = null;
        state.currentPhase = newPhase;
        return;
      }

      // Validate that the transition is allowed by the central transition graph.
      if (state.currentPhase !== newPhase && !canTransitionTo(state.currentPhase, newPhase)) {
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
        state.previousPhase = state.currentPhase;
      }

      state.currentPhase = newPhase;
    },

    // Set operation states that affect navigation
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
    // Clear navigation error
    clearNavigationError: (state) => {
      state.navigationError = null;
    },
    // Go back to previous phase (if valid)
    goBack: (state) => {
      if (state.previousPhase && isValidPhase(state.previousPhase)) {
        state.currentPhase = state.previousPhase;
        state.previousPhase = null;
        state.navigationError = null;
      } else {
        // Default to welcome if no previous phase - don't store current as previous
        // to avoid toggle loop between welcome and the phase the user just left
        state.previousPhase = null;
        state.currentPhase = PHASES?.WELCOME ?? 'welcome';
      }
    },
    updateSettings: (state, action) => {
      // CRITICAL FIX: Handle case where settings is null before first fetch
      state.settings = { ...(state.settings || {}), ...serializeData(action.payload) };
    },
    // FIX MEDIUM-1: Add reducers for new processing states
    setDiscovering: (state, action) => {
      state.isDiscovering = Boolean(action.payload);
    },
    setProcessing: (state, action) => {
      state.isProcessing = Boolean(action.payload);
    },
    // FIX MEDIUM-2: Set operation error with details
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
    // Clear operation error
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
        // FIX: Preserve existing settings on failure instead of wiping them
        // Only set to empty object if no previous settings exist
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
