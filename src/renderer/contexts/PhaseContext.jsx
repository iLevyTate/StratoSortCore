import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useMemo,
} from 'react';
import PropTypes from 'prop-types';
import {
  PHASES,
  PHASE_TRANSITIONS,
  PHASE_METADATA,
  UI_WORKFLOW,
} from '../../shared/constants';
import { logger } from '../../shared/logger';
logger.setContext('PhaseContext');

function phaseReducer(state, action) {
  switch (action.type) {
    case 'ADVANCE_PHASE': {
      // MEDIUM PRIORITY FIX (MED-1): Validate payload structure
      if (!action.payload || typeof action.payload !== 'object') {
        logger.error('Invalid payload in ADVANCE_PHASE action', {
          payload: action.payload,
        });
        return state;
      }

      const { targetPhase, data = {} } = action.payload;

      // Validate targetPhase
      if (!targetPhase || typeof targetPhase !== 'string') {
        logger.error('Invalid or missing targetPhase in ADVANCE_PHASE action', {
          targetPhase,
        });
        return state;
      }

      // Validate data is an object
      if (data !== null && typeof data !== 'object') {
        logger.error('Invalid data in ADVANCE_PHASE action', { data });
        return state;
      }

      const allowedTransitions = PHASE_TRANSITIONS[state.currentPhase] || [];
      if (
        targetPhase !== state.currentPhase &&
        !allowedTransitions.includes(targetPhase)
      ) {
        logger.warn('Invalid phase transition', {
          from: state.currentPhase,
          to: targetPhase,
        });
        return state;
      }
      return {
        ...state,
        currentPhase: targetPhase,
        phaseData: { ...state.phaseData, ...data },
      };
    }
    case 'SET_PHASE_DATA':
      // MEDIUM PRIORITY FIX (MED-1): Validate payload structure
      if (!action.payload || typeof action.payload !== 'object') {
        logger.error('Invalid payload in SET_PHASE_DATA action', {
          payload: action.payload,
        });
        return state;
      }

      if (!action.payload.key || typeof action.payload.key !== 'string') {
        logger.error('Invalid or missing key in SET_PHASE_DATA action', {
          key: action.payload.key,
        });
        return state;
      }

      return {
        ...state,
        phaseData: {
          ...state.phaseData,
          [action.payload.key]: action.payload.value,
        },
      };
    case 'SET_LOADING':
      // MEDIUM PRIORITY FIX (MED-1): Validate payload
      if (!action.payload || typeof action.payload.isLoading !== 'boolean') {
        logger.error('Invalid isLoading in SET_LOADING action', {
          payload: action.payload,
        });
        return state;
      }
      return { ...state, isLoading: action.payload.isLoading };

    case 'TOGGLE_SETTINGS':
      return { ...state, showSettings: !state.showSettings };

    case 'RESTORE_STATE':
      // MEDIUM PRIORITY FIX (MED-1): Validate payload
      if (!action.payload || typeof action.payload !== 'object') {
        logger.error('Invalid payload in RESTORE_STATE action', {
          payload: action.payload,
        });
        return state;
      }

      if (
        !action.payload.currentPhase ||
        typeof action.payload.currentPhase !== 'string'
      ) {
        logger.error('Invalid currentPhase in RESTORE_STATE action', {
          currentPhase: action.payload.currentPhase,
        });
        return state;
      }

      return {
        ...state,
        currentPhase: action.payload.currentPhase,
        phaseData: action.payload.phaseData || state.phaseData,
      };
    case 'RESET_WORKFLOW':
      return {
        ...state,
        currentPhase: PHASES.WELCOME,
        phaseData: {
          smartFolders: [],
          selectedFiles: [],
          analysisResults: [],
          organizedFiles: [],
        },
      };
    default:
      return state;
  }
}

const PhaseContext = createContext(null);

export function PhaseProvider({ children }) {
  const [state, dispatch] = useReducer(phaseReducer, {
    currentPhase: PHASES.WELCOME,
    phaseData: {
      smartFolders: [],
      selectedFiles: [],
      analysisResults: [],
      organizedFiles: [],
    },
    isLoading: false,
    showSettings: false,
  });

  useEffect(() => {
    try {
      const savedState = localStorage.getItem('stratosort_workflow_state');
      if (savedState) {
        const parsed = JSON.parse(savedState);
        const age = Date.now() - parsed.timestamp;
        if (age < UI_WORKFLOW.RESTORE_MAX_AGE_MS) {
          dispatch({ type: 'RESTORE_STATE', payload: parsed });
        }
      }
    } catch (error) {
      logger.error('Failed to load workflow state', {
        error: error.message,
        stack: error.stack,
      });
      // Fixed: Clear corrupt localStorage data to prevent reload loops
      try {
        localStorage.removeItem('stratosort_workflow_state');
      } catch {
        // Non-fatal if removal fails
      }
    }
  }, []);

  useEffect(() => {
    const save = () => {
      try {
        if (state.currentPhase !== PHASES.WELCOME) {
          // Fixed: Prune large data to prevent localStorage quota exceeded
          const prunedPhaseData = { ...state.phaseData };

          // Limit analysis results to prevent quota issues (max 200 most recent)
          if (
            Array.isArray(prunedPhaseData.analysisResults) &&
            prunedPhaseData.analysisResults.length > 200
          ) {
            prunedPhaseData.analysisResults = prunedPhaseData.analysisResults
              .slice(0, 200)
              .map((r) => ({
                path: r.path,
                name: r.name,
                size: r.size,
                type: r.type,
                status: r.status,
                analysis: r.analysis
                  ? {
                      category: r.analysis.category,
                      confidence: r.analysis.confidence,
                      suggestedName: r.analysis.suggestedName,
                      // Omit large text content to save space
                    }
                  : null,
                error: r.error,
                analyzedAt: r.analyzedAt,
              }));
          }

          // Limit selected files list
          if (
            Array.isArray(prunedPhaseData.selectedFiles) &&
            prunedPhaseData.selectedFiles.length > 200
          ) {
            prunedPhaseData.selectedFiles = prunedPhaseData.selectedFiles.slice(
              0,
              200,
            );
          }

          const workflowState = {
            currentPhase: state.currentPhase,
            phaseData: prunedPhaseData,
            timestamp: Date.now(),
          };

          localStorage.setItem(
            'stratosort_workflow_state',
            JSON.stringify(workflowState),
          );
        }
      } catch (error) {
        // Fixed: Handle QuotaExceededError specifically
        if (error.name === 'QuotaExceededError') {
          logger.warn('LocalStorage quota exceeded, clearing old state');
          try {
            // Clear the old state and try saving minimal data
            localStorage.removeItem('stratosort_workflow_state');
            const minimalState = {
              currentPhase: state.currentPhase,
              phaseData: {
                smartFolders: state.phaseData.smartFolders || [],
                // Only save essential data
              },
              timestamp: Date.now(),
            };
            localStorage.setItem(
              'stratosort_workflow_state',
              JSON.stringify(minimalState),
            );
          } catch (saveError) {
            logger.error(
              'Cannot save even minimal state, continuing without persistence',
              {
                error: saveError.message,
              },
            );
          }
        } else {
          logger.error('Failed to save workflow state', {
            error: error.message,
            stack: error.stack,
          });
        }
      }
    };
    const timeoutId = setTimeout(save, UI_WORKFLOW.SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timeoutId);
  }, [state.currentPhase, state.phaseData]);

  const advancePhase = useCallback(
    (targetPhase, data) =>
      dispatch({ type: 'ADVANCE_PHASE', payload: { targetPhase, data } }),
    [dispatch],
  );
  const setPhaseData = useCallback(
    (key, value) =>
      dispatch({ type: 'SET_PHASE_DATA', payload: { key, value } }),
    [dispatch],
  );
  const setLoading = useCallback(
    (isLoading) => dispatch({ type: 'SET_LOADING', payload: { isLoading } }),
    [dispatch],
  );
  const toggleSettings = useCallback(
    () => dispatch({ type: 'TOGGLE_SETTINGS' }),
    [dispatch],
  );
  const resetWorkflow = useCallback(() => {
    try {
      localStorage.removeItem('stratosort_workflow_state');
    } catch (error) {
      // Fixed: Log localStorage errors instead of silently swallowing
      logger.warn('Failed to clear workflow state from localStorage', {
        error: error.message,
      });
    }
    dispatch({ type: 'RESET_WORKFLOW' });
  }, [dispatch]);

  const actions = useMemo(
    () => ({
      advancePhase,
      setPhaseData,
      setLoading,
      toggleSettings,
      resetWorkflow,
    }),
    [advancePhase, setPhaseData, setLoading, toggleSettings, resetWorkflow],
  );

  // HIGH PRIORITY FIX (HIGH-1): Optimize memoization by destructuring state
  // This prevents unnecessary re-renders by depending on specific state values
  const contextValue = useMemo(() => {
    const getCurrentMetadata = () => PHASE_METADATA[state.currentPhase];
    return {
      currentPhase: state.currentPhase,
      phaseData: state.phaseData,
      isLoading: state.isLoading,
      showSettings: state.showSettings,
      actions,
      getCurrentMetadata,
    };
  }, [
    state.currentPhase,
    state.phaseData,
    state.isLoading,
    state.showSettings,
    actions,
  ]);

  return (
    <PhaseContext.Provider value={contextValue}>
      {children}
    </PhaseContext.Provider>
  );
}

PhaseProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export function usePhase() {
  const context = useContext(PhaseContext);
  if (!context) throw new Error('usePhase must be used within a PhaseProvider');
  return context;
}
