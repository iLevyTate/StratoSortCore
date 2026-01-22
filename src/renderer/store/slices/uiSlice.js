import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { PHASES, PHASE_TRANSITIONS } from '../../../shared/constants';
import { logger } from '../../../shared/logger';
import { serializeData } from '../../utils/serialization';

// FIX: Phase validation utility to prevent invalid navigation states
// FIX: Add fallback to prevent crash if PHASES is undefined during module initialization
const VALID_PHASES = PHASES
  ? Object.values(PHASES)
  : ['welcome', 'setup', 'discover', 'organize', 'complete'];

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
// FIX: isAnalyzing should be passed in context from analysisSlice for accurate state
const NAVIGATION_RULES = {
  // Rules for when "Back" button should be disabled
  // context.isAnalyzing should be passed from analysisSlice.isAnalyzing for accurate value
  canGoBack: (state, context = {}) => {
    // Cannot go back from welcome phase
    // FIX: Add null check for PHASES to prevent crash during module initialization
    if (state.currentPhase === (PHASES?.WELCOME ?? 'welcome')) return false;
    // Cannot go back while loading/processing
    if (state.isLoading) return false;
    // Cannot go back during file operations
    // FIX: Prefer context.isAnalyzing (from analysisSlice) over state.isAnalyzing (deprecated)
    const isAnalyzing = context.isAnalyzing ?? state.isAnalyzing;
    if (state.isOrganizing || isAnalyzing) return false;
    return true;
  },
  // Rules for when "Next/Continue" button should be disabled
  canGoNext: (state, context = {}) => {
    // Cannot advance while loading
    if (state.isLoading) return false;
    // Cannot advance during file operations
    // FIX: Prefer context.isAnalyzing (from analysisSlice) over state.isAnalyzing (deprecated)
    const isAnalyzing = context.isAnalyzing ?? state.isAnalyzing;
    if (state.isOrganizing || isAnalyzing) return false;

    // Phase-specific rules
    // FIX: Add null checks for PHASES to prevent crash during module initialization
    switch (state.currentPhase) {
      case PHASES?.SETUP ?? 'setup':
        // Setup requires at least one smart folder (context provides this)
        return context.hasSmartFolders !== false;
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
  async (forceRefresh = false, { getState }) => {
    const { ui } = getState();
    // Return cached value if already fetched and not forcing refresh
    if (!forceRefresh && ui.settings) {
      return ui.settings;
    }
    const settings = await window.electronAPI?.settings?.get?.();
    return settings || {};
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
  // DEPRECATED: isAnalyzing is now tracked in analysisSlice only
  // Kept here for backward compatibility with NAVIGATION_RULES
  // Pass context.isAnalyzing from analysisSlice when calling NAVIGATION_RULES
  isAnalyzing: false,
  // FIX MEDIUM-1: Add additional processing states for better UX feedback
  isDiscovering: false, // True during file discovery/scanning operations
  isProcessing: false, // Generic processing state for any background operation
  navigationError: null, // Last navigation error for debugging
  // FIX MEDIUM-2: Track operation errors with more detail
  lastOperationError: null // { operation: string, message: string, timestamp: number }
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
    // DEPRECATED: Use analysisSlice.startAnalysis/stopAnalysis instead
    // Kept for backward compatibility but no longer dispatched by useDiscoverState
    // FIX L-5: Add deprecation warning to help migration
    setAnalyzing: (state, action) => {
      if (process.env.NODE_ENV === 'development') {
        logger.warn(
          '[uiSlice] setAnalyzing is DEPRECATED. Use analysisSlice.startAnalysis/stopAnalysis instead.',
          { calledWith: action.payload }
        );
      }
      state.isAnalyzing = Boolean(action.payload);
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
      return {
        ...initialState
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
        // FIX: Add null check for PHASES to prevent crash during module initialization
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
        state.settingsError = action.error?.message || 'Failed to load settings';
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
  setAnalyzing,
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
