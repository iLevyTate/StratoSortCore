/**
 * Tests for persistenceMiddleware re-entry guard fix.
 * Verifies the isSaving double-check prevents concurrent saves.
 */

jest.mock('../src/shared/logger', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { logger, createLogger: jest.fn(() => logger) };
});

jest.mock('../src/shared/constants', () => ({
  PHASES: {
    WELCOME: 'welcome',
    SETUP: 'setup',
    DISCOVER: 'discover',
    ORGANIZE: 'organize',
    COMPLETE: 'complete'
  }
}));

describe('persistenceMiddleware – re-entry guard', () => {
  let persistenceMiddleware;
  let cleanupPersistence;
  let mockStore;
  let mockNext;
  let mockLocalStorage;
  let mockStorage;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();

    mockStorage = {};
    mockLocalStorage = {
      getItem: jest.fn((key) => mockStorage[key] || null),
      setItem: jest.fn((key, value) => {
        mockStorage[key] = value;
      }),
      removeItem: jest.fn((key) => {
        delete mockStorage[key];
      }),
      clear: jest.fn(() => {
        mockStorage = {};
      })
    };

    Object.defineProperty(global, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
      configurable: true
    });

    const mod = require('../src/renderer/store/middleware/persistenceMiddleware');
    persistenceMiddleware = mod.default;
    cleanupPersistence = mod.cleanupPersistence;

    const defaultState = {
      ui: { currentPhase: 'discover', sidebarOpen: true, showSettings: false },
      files: {
        selectedFiles: ['/a.txt'],
        organizedFiles: [],
        smartFolders: [],
        namingConvention: 'default',
        fileStates: {}
      },
      analysis: {
        results: [],
        isAnalyzing: false,
        analysisProgress: { current: 0, total: 0 },
        currentAnalysisFile: ''
      }
    };

    mockStore = {
      dispatch: jest.fn(),
      getState: jest.fn().mockReturnValue(defaultState)
    };
    mockNext = jest.fn((action) => action);
  });

  afterEach(() => {
    if (cleanupPersistence) cleanupPersistence();
    jest.useRealTimers();
  });

  test('only one save runs even when debounce fires quickly', () => {
    const middleware = persistenceMiddleware(mockStore)(mockNext);

    // Dispatch two actions that both trigger saves
    middleware({ type: 'ACTION_1' });
    middleware({ type: 'ACTION_2' });

    // Advance past debounce – only the last scheduled timeout fires
    jest.advanceTimersByTime(2000);

    // setItem should be called exactly once (not twice)
    const setCalls = mockLocalStorage.setItem.mock.calls.filter(
      ([key]) => key === 'stratosort_redux_state'
    );
    expect(setCalls.length).toBe(1);
  });

  test('save during save (re-entrant dispatch) is skipped', () => {
    // Make getState return changing state so save is triggered
    let callCount = 0;
    mockStore.getState.mockImplementation(() => {
      callCount++;
      return {
        ui: { currentPhase: 'discover', sidebarOpen: true, showSettings: false },
        files: {
          selectedFiles: [`/file${callCount}.txt`],
          organizedFiles: [],
          smartFolders: [],
          namingConvention: 'default',
          fileStates: {}
        },
        analysis: {
          results: [],
          isAnalyzing: false,
          analysisProgress: { current: 0, total: 0 },
          currentAnalysisFile: ''
        }
      };
    });

    // On setItem, simulate a re-entrant dispatch
    mockLocalStorage.setItem.mockImplementation((key) => {
      if (key === 'stratosort_redux_state') {
        // Re-entrant: dispatch another action while saving
        middleware({ type: 'REENTRANT_ACTION' });
      }
    });

    const middleware = persistenceMiddleware(mockStore)(mockNext);
    middleware({ type: 'TRIGGER_SAVE' });
    jest.advanceTimersByTime(2000);

    // setItem should have been called exactly once – re-entrant dispatch was skipped
    const setCalls = mockLocalStorage.setItem.mock.calls.filter(
      ([key]) => key === 'stratosort_redux_state'
    );
    expect(setCalls.length).toBe(1);
  });
});
