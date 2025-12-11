/**
 * Tests for Persistence Middleware
 * Tests Redux middleware for state persistence to localStorage
 */

// Mock the logger module
jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock constants
jest.mock('../src/shared/constants', () => ({
  PHASES: {
    WELCOME: 'welcome',
    SETUP: 'setup',
    DISCOVER: 'discover',
    ORGANIZE: 'organize',
    COMPLETE: 'complete'
  }
}));

describe('persistenceMiddleware', () => {
  let persistenceMiddleware;
  let cleanupPersistence;
  let mockStore;
  let mockNext;
  let mockStorage;
  let mockLocalStorage;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();

    // Set up localStorage mock before importing module
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

    // Use Object.defineProperty to properly override localStorage
    Object.defineProperty(global, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
      configurable: true
    });

    // Import module fresh each test
    const persistenceModule = require('../src/renderer/store/middleware/persistenceMiddleware');
    persistenceMiddleware = persistenceModule.default;
    cleanupPersistence = persistenceModule.cleanupPersistence;

    // Default mock state - must include all properties the middleware accesses
    const defaultState = {
      ui: {
        currentPhase: 'discover',
        theme: 'light',
        sidebarOpen: true,
        showSettings: false
      },
      files: {
        selectedFiles: [],
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
    if (cleanupPersistence) {
      cleanupPersistence();
    }
    jest.useRealTimers();
  });

  describe('middleware setup', () => {
    test('returns a function', () => {
      expect(typeof persistenceMiddleware).toBe('function');
    });

    test('returns next middleware in chain', () => {
      const middleware = persistenceMiddleware(mockStore);
      expect(typeof middleware).toBe('function');

      const nextHandler = middleware(mockNext);
      expect(typeof nextHandler).toBe('function');
    });

    test('passes action through the chain', () => {
      const middleware = persistenceMiddleware(mockStore);
      const nextHandler = middleware(mockNext);
      const action = { type: 'TEST_ACTION' };

      const result = nextHandler(action);

      expect(mockNext).toHaveBeenCalledWith(action);
      expect(result).toEqual(action);
    });
  });

  describe('state persistence', () => {
    test('saves state after debounce period', () => {
      const middleware = persistenceMiddleware(mockStore);
      const nextHandler = middleware(mockNext);

      nextHandler({ type: 'SOME_ACTION' });

      // Before debounce
      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();

      // After debounce
      jest.advanceTimersByTime(1000);

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'stratosort_redux_state',
        expect.any(String)
      );
    });

    test('does not save in WELCOME phase', () => {
      mockStore.getState.mockReturnValue({
        ui: { currentPhase: 'welcome', theme: 'light', sidebarOpen: true, showSettings: false },
        files: {
          selectedFiles: [],
          organizedFiles: [],
          smartFolders: [],
          fileStates: {},
          namingConvention: 'default'
        },
        analysis: {
          results: [],
          isAnalyzing: false,
          analysisProgress: { current: 0, total: 0 },
          currentAnalysisFile: ''
        }
      });

      const middleware = persistenceMiddleware(mockStore);
      const nextHandler = middleware(mockNext);

      nextHandler({ type: 'SOME_ACTION' });
      jest.advanceTimersByTime(2000);

      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    });

    test('does not save on setLoading actions', () => {
      const middleware = persistenceMiddleware(mockStore);
      const nextHandler = middleware(mockNext);

      nextHandler({ type: 'ui/setLoading' });
      jest.advanceTimersByTime(2000);

      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    });

    test('debounces multiple rapid actions', () => {
      const middleware = persistenceMiddleware(mockStore);
      const nextHandler = middleware(mockNext);

      nextHandler({ type: 'ACTION_1' });
      jest.advanceTimersByTime(500);
      nextHandler({ type: 'ACTION_2' });
      jest.advanceTimersByTime(500);
      nextHandler({ type: 'ACTION_3' });
      jest.advanceTimersByTime(1000);

      // Should only save once after final debounce
      expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('change detection', () => {
    test('skips save when state has not changed', () => {
      const middleware = persistenceMiddleware(mockStore);
      const nextHandler = middleware(mockNext);

      // First action triggers save
      nextHandler({ type: 'ACTION_1' });
      jest.advanceTimersByTime(1000);
      expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(1);

      // Second action with same state should not trigger save
      nextHandler({ type: 'ACTION_2' });
      jest.advanceTimersByTime(1000);
      expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(1);
    });

    test('saves when phase changes', () => {
      const middleware = persistenceMiddleware(mockStore);
      const nextHandler = middleware(mockNext);

      nextHandler({ type: 'ACTION_1' });
      jest.advanceTimersByTime(1000);
      mockLocalStorage.setItem.mockClear();

      // Change phase
      mockStore.getState.mockReturnValue({
        ui: { currentPhase: 'organize', theme: 'light', sidebarOpen: true, showSettings: false },
        files: {
          selectedFiles: [],
          organizedFiles: [],
          smartFolders: [],
          fileStates: {},
          namingConvention: 'default'
        },
        analysis: {
          results: [],
          isAnalyzing: false,
          analysisProgress: { current: 0, total: 0 },
          currentAnalysisFile: ''
        }
      });

      nextHandler({ type: 'ACTION_2' });
      jest.advanceTimersByTime(1000);

      expect(mockLocalStorage.setItem).toHaveBeenCalled();
    });

    test('saves when files count changes', () => {
      const middleware = persistenceMiddleware(mockStore);
      const nextHandler = middleware(mockNext);

      nextHandler({ type: 'ACTION_1' });
      jest.advanceTimersByTime(1000);
      mockLocalStorage.setItem.mockClear();

      // Add files
      mockStore.getState.mockReturnValue({
        ui: { currentPhase: 'discover', theme: 'light', sidebarOpen: true, showSettings: false },
        files: {
          selectedFiles: [{ path: '/file.txt' }],
          organizedFiles: [],
          smartFolders: [],
          fileStates: {},
          namingConvention: 'default'
        },
        analysis: {
          results: [],
          isAnalyzing: false,
          analysisProgress: { current: 0, total: 0 },
          currentAnalysisFile: ''
        }
      });

      nextHandler({ type: 'ACTION_2' });
      jest.advanceTimersByTime(1000);

      expect(mockLocalStorage.setItem).toHaveBeenCalled();
    });
  });

  describe('quota handling', () => {
    test('handles QuotaExceededError gracefully', () => {
      let callCount = 0;
      mockLocalStorage.setItem.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          const error = new Error('Quota exceeded');
          error.name = 'QuotaExceededError';
          throw error;
        }
        // Subsequent calls succeed
      });

      const middleware = persistenceMiddleware(mockStore);
      const nextHandler = middleware(mockNext);

      expect(() => {
        nextHandler({ type: 'ACTION_1' });
        jest.advanceTimersByTime(1000);
      }).not.toThrow();
    });

    test('attempts reduced state save on quota error', () => {
      let callCount = 0;
      mockLocalStorage.setItem.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          const error = new Error('Quota exceeded');
          error.name = 'QuotaExceededError';
          throw error;
        }
      });

      const middleware = persistenceMiddleware(mockStore);
      const nextHandler = middleware(mockNext);

      nextHandler({ type: 'ACTION_1' });
      jest.advanceTimersByTime(1000);

      // Should have attempted multiple times
      expect(mockLocalStorage.setItem.mock.calls.length).toBeGreaterThan(1);
    });
  });

  describe('cleanupPersistence', () => {
    test('clears pending save timeout', () => {
      const middleware = persistenceMiddleware(mockStore);
      const nextHandler = middleware(mockNext);

      nextHandler({ type: 'ACTION_1' });

      // Don't advance time - timeout still pending
      cleanupPersistence();

      // Now advance time
      jest.advanceTimersByTime(2000);

      // Save should not have happened
      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    });

    test('resets tracking variables', () => {
      const middleware = persistenceMiddleware(mockStore);
      const nextHandler = middleware(mockNext);

      // Trigger initial save
      nextHandler({ type: 'ACTION_1' });
      jest.advanceTimersByTime(1000);
      mockLocalStorage.setItem.mockClear();

      // Cleanup and reinitialize
      cleanupPersistence();

      // Same state should now trigger save since tracking is reset
      nextHandler({ type: 'ACTION_2' });
      jest.advanceTimersByTime(1000);

      expect(mockLocalStorage.setItem).toHaveBeenCalled();
    });
  });

  describe('max debounce wait', () => {
    test('forces save after max wait time', () => {
      const middleware = persistenceMiddleware(mockStore);
      const nextHandler = middleware(mockNext);

      // First, trigger an initial save to set lastSaveAttempt
      nextHandler({ type: 'INITIAL_ACTION' });
      jest.advanceTimersByTime(1000);
      expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(1);
      mockLocalStorage.setItem.mockClear();

      // Now trigger many rapid actions that keep resetting the debounce
      // MAX_DEBOUNCE_WAIT_MS is 5000ms, so after 5 seconds of debouncing, it should force save
      for (let i = 0; i < 10; i++) {
        mockStore.getState.mockReturnValue({
          ui: { currentPhase: 'discover', theme: 'light', sidebarOpen: true, showSettings: false },
          files: {
            selectedFiles: Array(i + 1).fill({}),
            organizedFiles: [],
            smartFolders: [],
            fileStates: {},
            namingConvention: 'default'
          },
          analysis: {
            results: [],
            isAnalyzing: false,
            analysisProgress: { current: 0, total: 0 },
            currentAnalysisFile: ''
          }
        });
        nextHandler({ type: `ACTION_${i}` });
        jest.advanceTimersByTime(600);
      }

      // Should have saved at least once due to max wait (6000ms > MAX_DEBOUNCE_WAIT_MS of 5000ms)
      expect(mockLocalStorage.setItem).toHaveBeenCalled();
    });
  });

  describe('state serialization', () => {
    test('limits selectedFiles to 200 items', () => {
      const largeFilesList = Array(300)
        .fill()
        .map((_, i) => ({ path: `/file${i}.txt` }));

      mockStore.getState.mockReturnValue({
        ui: { currentPhase: 'discover', theme: 'light', sidebarOpen: true, showSettings: false },
        files: {
          selectedFiles: largeFilesList,
          organizedFiles: [],
          fileStates: {},
          smartFolders: [],
          namingConvention: 'default'
        },
        analysis: {
          results: [],
          isAnalyzing: false,
          analysisProgress: { current: 0, total: 0 },
          currentAnalysisFile: ''
        }
      });

      const middleware = persistenceMiddleware(mockStore);
      const nextHandler = middleware(mockNext);

      nextHandler({ type: 'ACTION' });
      jest.advanceTimersByTime(1000);

      const savedData = JSON.parse(mockLocalStorage.setItem.mock.calls[0][1]);
      expect(savedData.files.selectedFiles.length).toBeLessThanOrEqual(200);
    });

    test('limits fileStates to 100 entries', () => {
      const largeFileStates = {};
      for (let i = 0; i < 150; i++) {
        largeFileStates[`/file${i}.txt`] = { state: 'analyzed' };
      }

      mockStore.getState.mockReturnValue({
        ui: { currentPhase: 'discover', theme: 'light', sidebarOpen: true, showSettings: false },
        files: {
          selectedFiles: [],
          organizedFiles: [],
          fileStates: largeFileStates,
          smartFolders: [],
          namingConvention: 'default'
        },
        analysis: {
          results: [],
          isAnalyzing: false,
          analysisProgress: { current: 0, total: 0 },
          currentAnalysisFile: ''
        }
      });

      const middleware = persistenceMiddleware(mockStore);
      const nextHandler = middleware(mockNext);

      nextHandler({ type: 'ACTION' });
      jest.advanceTimersByTime(1000);

      const savedData = JSON.parse(mockLocalStorage.setItem.mock.calls[0][1]);
      expect(Object.keys(savedData.files.fileStates).length).toBeLessThanOrEqual(100);
    });
  });
});
