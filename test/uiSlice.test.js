/**
 * Tests for UI Slice
 * Tests Redux slice for UI state management
 */

// Mock constants
jest.mock('../src/shared/constants', () => ({
  PHASES: {
    WELCOME: 'welcome',
    SETUP: 'setup',
    DISCOVER: 'discover',
    ORGANIZE: 'organize',
    COMPLETE: 'complete'
  },
  PHASE_TRANSITIONS: {
    welcome: ['setup'],
    setup: ['welcome', 'discover'],
    discover: ['setup', 'organize'],
    organize: ['discover', 'complete'],
    complete: ['welcome']
  }
}));

// Mock logger
jest.mock('../src/shared/logger', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

import uiReducer, {
  setPhase,
  toggleSidebar,
  toggleSettings,
  setLoading,
  setActiveModal,
  resetUi,
  updateSettings,
  setOrganizing,
  setAnalyzing,
  clearNavigationError,
  goBack,
  fetchSettings,
  NAVIGATION_RULES,
  isValidPhase,
  canTransitionTo
} from '../src/renderer/store/slices/uiSlice';

describe('uiSlice', () => {
  const initialState = {
    currentPhase: 'welcome',
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
  };

  describe('initial state', () => {
    test('returns initial state', () => {
      const result = uiReducer(undefined, { type: 'unknown' });

      expect(result.currentPhase).toBe('welcome');
      expect(result.sidebarOpen).toBe(true);
    });
  });

  describe('setPhase', () => {
    test('sets valid phase', () => {
      const state = { ...initialState, currentPhase: 'welcome' };

      const result = uiReducer(state, setPhase('setup'));

      expect(result.currentPhase).toBe('setup');
      expect(result.previousPhase).toBe('welcome');
    });

    test('rejects invalid phase', () => {
      const state = { ...initialState, currentPhase: 'welcome' };

      const result = uiReducer(state, setPhase('invalid-phase'));

      expect(result.currentPhase).toBe('welcome');
      expect(result.navigationError).toContain('Invalid phase');
    });

    test('rejects null phase', () => {
      const state = { ...initialState, currentPhase: 'setup' };

      const result = uiReducer(state, setPhase(null));

      expect(result.currentPhase).toBe('welcome');
      expect(result.navigationError).toBeDefined();
    });

    test('allows same phase transition', () => {
      const state = { ...initialState, currentPhase: 'setup' };

      const result = uiReducer(state, setPhase('setup'));

      expect(result.currentPhase).toBe('setup');
      expect(result.navigationError).toBeNull();
    });

    test('tracks invalid transition but allows it', () => {
      const state = { ...initialState, currentPhase: 'welcome' };

      // Direct transition from welcome to organize is not in PHASE_TRANSITIONS
      const result = uiReducer(state, setPhase('organize'));

      expect(result.currentPhase).toBe('organize');
      expect(result.navigationError).toContain('Invalid phase transition');
    });

    test('clears previous navigation error', () => {
      const state = {
        ...initialState,
        currentPhase: 'welcome',
        navigationError: 'previous error'
      };

      const result = uiReducer(state, setPhase('setup'));

      expect(result.navigationError).toBeNull();
    });
  });

  describe('setOrganizing', () => {
    test('sets organizing state to true', () => {
      const result = uiReducer(initialState, setOrganizing(true));

      expect(result.isOrganizing).toBe(true);
    });

    test('sets organizing state to false', () => {
      const state = { ...initialState, isOrganizing: true };

      const result = uiReducer(state, setOrganizing(false));

      expect(result.isOrganizing).toBe(false);
    });

    test('coerces truthy values to boolean', () => {
      const result = uiReducer(initialState, setOrganizing('yes'));

      expect(result.isOrganizing).toBe(true);
    });
  });

  describe('setAnalyzing', () => {
    test('sets analyzing state', () => {
      const result = uiReducer(initialState, setAnalyzing(true));

      expect(result.isAnalyzing).toBe(true);
    });
  });

  describe('toggleSidebar', () => {
    test('toggles sidebar open to closed', () => {
      const result = uiReducer(initialState, toggleSidebar());

      expect(result.sidebarOpen).toBe(false);
    });

    test('toggles sidebar closed to open', () => {
      const state = { ...initialState, sidebarOpen: false };

      const result = uiReducer(state, toggleSidebar());

      expect(result.sidebarOpen).toBe(true);
    });
  });

  describe('toggleSettings', () => {
    test('toggles settings visibility', () => {
      const result = uiReducer(initialState, toggleSettings());

      expect(result.showSettings).toBe(true);
    });
  });

  describe('setLoading', () => {
    test('sets loading with boolean', () => {
      const result = uiReducer(initialState, setLoading(true));

      expect(result.isLoading).toBe(true);
      expect(result.loadingMessage).toBe('');
    });

    test('sets loading with object', () => {
      const result = uiReducer(
        initialState,
        setLoading({ isLoading: true, message: 'Processing...' })
      );

      expect(result.isLoading).toBe(true);
      expect(result.loadingMessage).toBe('Processing...');
    });

    test('clears loading message on false', () => {
      const state = {
        ...initialState,
        isLoading: true,
        loadingMessage: 'Loading...'
      };

      const result = uiReducer(state, setLoading(false));

      expect(result.isLoading).toBe(false);
      expect(result.loadingMessage).toBe('');
    });
  });

  describe('setActiveModal', () => {
    test('sets active modal', () => {
      const result = uiReducer(initialState, setActiveModal('history'));

      expect(result.activeModal).toBe('history');
    });

    test('clears active modal with null', () => {
      const state = { ...initialState, activeModal: 'history' };

      const result = uiReducer(state, setActiveModal(null));

      expect(result.activeModal).toBeNull();
    });
  });

  describe('resetUi', () => {
    test('resets to initial state', () => {
      const modifiedState = {
        ...initialState,
        currentPhase: 'organize',
        isLoading: true,
        showSettings: true
      };

      const result = uiReducer(modifiedState, resetUi());

      expect(result.currentPhase).toBe('welcome');
      expect(result.isLoading).toBe(false);
      expect(result.showSettings).toBe(false);
    });
  });

  describe('updateSettings', () => {
    test('updates settings', () => {
      const result = uiReducer(initialState, updateSettings({ language: 'en', autoSave: true }));

      expect(result.settings.language).toBe('en');
      expect(result.settings.autoSave).toBe(true);
    });

    test('merges with existing settings', () => {
      const state = {
        ...initialState,
        settings: { language: 'fr', existing: true }
      };

      const result = uiReducer(state, updateSettings({ language: 'en' }));

      expect(result.settings.language).toBe('en');
      expect(result.settings.existing).toBe(true);
    });

    test('handles null settings', () => {
      const state = { ...initialState, settings: null };

      const result = uiReducer(state, updateSettings({ key: 'value' }));

      expect(result.settings.key).toBe('value');
    });
  });

  describe('clearNavigationError', () => {
    test('clears navigation error', () => {
      const state = { ...initialState, navigationError: 'some error' };

      const result = uiReducer(state, clearNavigationError());

      expect(result.navigationError).toBeNull();
    });
  });

  describe('goBack', () => {
    test('returns to previous phase', () => {
      const state = {
        ...initialState,
        currentPhase: 'setup',
        previousPhase: 'welcome'
      };

      const result = uiReducer(state, goBack());

      expect(result.currentPhase).toBe('welcome');
      // goBack is single-step: once used, it clears previousPhase to prevent ping-pong
      expect(result.previousPhase).toBeNull();
    });

    test('goes to welcome if no previous phase', () => {
      const state = {
        ...initialState,
        currentPhase: 'setup',
        previousPhase: null
      };

      const result = uiReducer(state, goBack());

      expect(result.currentPhase).toBe('welcome');
    });

    test('handles invalid previous phase', () => {
      const state = {
        ...initialState,
        currentPhase: 'setup',
        previousPhase: 'invalid'
      };

      const result = uiReducer(state, goBack());

      expect(result.currentPhase).toBe('welcome');
    });
  });

  describe('fetchSettings async thunk', () => {
    test('sets loading state on pending', () => {
      const result = uiReducer(initialState, {
        type: fetchSettings.pending.type
      });

      expect(result.settingsLoading).toBe(true);
    });

    test('sets settings on fulfilled', () => {
      const settings = { language: 'en' };

      const result = uiReducer(initialState, {
        type: fetchSettings.fulfilled.type,
        payload: settings
      });

      expect(result.settings).toEqual(settings);
      expect(result.settingsLoading).toBe(false);
    });

    test('sets empty object on rejected', () => {
      const result = uiReducer(initialState, {
        type: fetchSettings.rejected.type
      });

      expect(result.settings).toEqual({});
      expect(result.settingsLoading).toBe(false);
    });
  });

  describe('NAVIGATION_RULES', () => {
    describe('canGoBack', () => {
      test('returns false for welcome phase', () => {
        expect(NAVIGATION_RULES.canGoBack({ currentPhase: 'welcome' })).toBe(false);
      });

      test('returns false when loading', () => {
        expect(
          NAVIGATION_RULES.canGoBack({
            currentPhase: 'setup',
            isLoading: true
          })
        ).toBe(false);
      });

      test('returns false when organizing', () => {
        expect(
          NAVIGATION_RULES.canGoBack({
            currentPhase: 'organize',
            isOrganizing: true
          })
        ).toBe(false);
      });

      test('returns false when analyzing', () => {
        expect(
          NAVIGATION_RULES.canGoBack({
            currentPhase: 'discover',
            isAnalyzing: true
          })
        ).toBe(false);
      });

      test('returns true otherwise', () => {
        expect(
          NAVIGATION_RULES.canGoBack({
            currentPhase: 'setup',
            isLoading: false,
            isOrganizing: false,
            isAnalyzing: false
          })
        ).toBe(true);
      });
    });

    describe('canGoNext', () => {
      test('returns false when loading', () => {
        expect(NAVIGATION_RULES.canGoNext({ currentPhase: 'setup', isLoading: true })).toBe(false);
      });

      test('checks hasSmartFolders for setup phase', () => {
        expect(
          NAVIGATION_RULES.canGoNext({ currentPhase: 'setup' }, { hasSmartFolders: true })
        ).toBe(true);
        expect(
          NAVIGATION_RULES.canGoNext({ currentPhase: 'setup' }, { hasSmartFolders: false })
        ).toBe(false);
      });

      test('checks hasAnalyzedFiles for discover phase', () => {
        expect(
          NAVIGATION_RULES.canGoNext({ currentPhase: 'discover' }, { hasAnalyzedFiles: true })
        ).toBe(true);
      });

      test('allows totalAnalysisFailure for discover phase', () => {
        expect(
          NAVIGATION_RULES.canGoNext({ currentPhase: 'discover' }, { totalAnalysisFailure: true })
        ).toBe(true);
      });

      test('checks hasProcessedFiles for organize phase', () => {
        expect(
          NAVIGATION_RULES.canGoNext({ currentPhase: 'organize' }, { hasProcessedFiles: true })
        ).toBe(true);
      });

      test('returns true for complete phase', () => {
        expect(NAVIGATION_RULES.canGoNext({ currentPhase: 'complete' })).toBe(true);
      });
    });

    describe('getAllowedTransitions', () => {
      test('returns allowed transitions for phase', () => {
        expect(NAVIGATION_RULES.getAllowedTransitions('welcome')).toEqual(['setup']);
        expect(NAVIGATION_RULES.getAllowedTransitions('setup')).toContain('discover');
      });

      test('returns empty array for invalid phase', () => {
        expect(NAVIGATION_RULES.getAllowedTransitions('invalid')).toEqual([]);
      });
    });
  });

  describe('helper functions', () => {
    describe('isValidPhase', () => {
      test('returns true for valid phases', () => {
        expect(isValidPhase('welcome')).toBe(true);
        expect(isValidPhase('setup')).toBe(true);
        expect(isValidPhase('discover')).toBe(true);
        expect(isValidPhase('organize')).toBe(true);
        expect(isValidPhase('complete')).toBe(true);
      });

      test('returns false for invalid phases', () => {
        expect(isValidPhase('invalid')).toBe(false);
        expect(isValidPhase(null)).toBe(false);
        expect(isValidPhase(undefined)).toBe(false);
        expect(isValidPhase(123)).toBe(false);
      });
    });

    describe('canTransitionTo', () => {
      test('allows valid transitions', () => {
        expect(canTransitionTo('welcome', 'setup')).toBe(true);
        expect(canTransitionTo('setup', 'discover')).toBe(true);
      });

      test('allows same phase transition', () => {
        expect(canTransitionTo('setup', 'setup')).toBe(true);
      });

      test('rejects invalid transitions', () => {
        expect(canTransitionTo('welcome', 'complete')).toBe(false);
      });

      test('rejects invalid phases', () => {
        expect(canTransitionTo('invalid', 'setup')).toBe(false);
        expect(canTransitionTo('welcome', 'invalid')).toBe(false);
      });
    });
  });
});
