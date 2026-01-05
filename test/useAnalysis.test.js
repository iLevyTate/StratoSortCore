/**
 * Tests for useAnalysis Hook
 * Tests file analysis logic and state management
 */

import { renderHook, act } from '@testing-library/react';

// Mock dependencies
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../src/shared/constants', () => ({
  PHASES: { DISCOVER: 'discover', ORGANIZE: 'organize', COMPLETE: 'complete' },
  RENDERER_LIMITS: {
    ANALYSIS_TIMEOUT_MS: 180000,
    FILE_STATS_BATCH_SIZE: 50
  },
  FILE_STATES: {
    PENDING: 'pending',
    ANALYZING: 'analyzing',
    CATEGORIZED: 'categorized',
    ERROR: 'error'
  }
}));

jest.mock('../src/renderer/phases/discover/namingUtils', () => ({
  validateProgressState: jest.fn((progress) => {
    return (
      progress &&
      typeof progress.current === 'number' &&
      typeof progress.total === 'number' &&
      progress.current >= 0 &&
      progress.total >= 0
    );
  }),
  generatePreviewName: jest.fn((name) => name)
}));

// Mock window.electronAPI
const mockElectronAPI = {
  files: {
    analyze: jest.fn()
  },
  settings: {
    get: jest.fn()
  }
};

describe('useAnalysis', () => {
  let useAnalysis;
  let mockSetIsAnalyzing;
  let mockSetAnalysisProgress;
  let mockSetCurrentAnalysisFile;
  let mockSetAnalysisResults;
  let mockSetFileStates;
  let mockUpdateFileState;
  let mockAddNotification;
  let mockActions;

  const createMockOptions = (overrides = {}) => ({
    selectedFiles: [{ path: '/test.txt', name: 'test.txt' }],
    fileStates: {},
    analysisResults: [],
    isAnalyzing: false,
    analysisProgress: { current: 0, total: 0 },
    namingSettings: {
      convention: 'original',
      separator: '-',
      dateFormat: 'YYYY-MM-DD',
      caseConvention: 'original'
    },
    setters: {
      setIsAnalyzing: mockSetIsAnalyzing,
      setAnalysisProgress: mockSetAnalysisProgress,
      setCurrentAnalysisFile: mockSetCurrentAnalysisFile,
      setAnalysisResults: mockSetAnalysisResults,
      setFileStates: mockSetFileStates
    },
    updateFileState: mockUpdateFileState,
    addNotification: mockAddNotification,
    actions: mockActions,
    ...overrides
  });

  beforeEach(() => {
    // jest.resetModules(); // Removed - breaks React hooks context
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Set up window.electronAPI fresh each test (test-setup.js may overwrite global.window)
    global.window = global.window || {};
    global.window.electronAPI = mockElectronAPI;

    mockSetIsAnalyzing = jest.fn();
    mockSetAnalysisProgress = jest.fn();
    mockSetCurrentAnalysisFile = jest.fn();
    mockSetAnalysisResults = jest.fn();
    mockSetFileStates = jest.fn();
    mockUpdateFileState = jest.fn();
    mockAddNotification = jest.fn();
    mockActions = {
      setPhaseData: jest.fn(),
      advancePhase: jest.fn()
    };

    mockElectronAPI.files.analyze.mockResolvedValue({
      category: 'documents',
      suggestedName: 'test-document.txt'
    });
    mockElectronAPI.settings.get.mockResolvedValue({
      maxConcurrentAnalysis: 3
    });

    useAnalysis = require('../src/renderer/phases/discover/useAnalysis').useAnalysis;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('initialization', () => {
    test('returns analyzeFiles function', () => {
      const { result } = renderHook(() => useAnalysis(createMockOptions()));

      expect(typeof result.current.analyzeFiles).toBe('function');
    });

    test('returns cancelAnalysis function', () => {
      const { result } = renderHook(() => useAnalysis(createMockOptions()));

      expect(typeof result.current.cancelAnalysis).toBe('function');
    });

    test('returns clearAnalysisQueue function', () => {
      const { result } = renderHook(() => useAnalysis(createMockOptions()));

      expect(typeof result.current.clearAnalysisQueue).toBe('function');
    });

    test('returns resetAnalysisState function', () => {
      const { result } = renderHook(() => useAnalysis(createMockOptions()));

      expect(typeof result.current.resetAnalysisState).toBe('function');
    });

    test('returns generatePreviewName function', () => {
      const { result } = renderHook(() => useAnalysis(createMockOptions()));

      expect(typeof result.current.generatePreviewName).toBe('function');
    });
  });

  describe('analyzeFiles', () => {
    test('does nothing for empty files array', async () => {
      const { result } = renderHook(() => useAnalysis(createMockOptions()));

      await act(async () => {
        await result.current.analyzeFiles([]);
      });

      expect(mockSetIsAnalyzing).not.toHaveBeenCalled();
    });

    test('does nothing for null files', async () => {
      const { result } = renderHook(() => useAnalysis(createMockOptions()));

      await act(async () => {
        await result.current.analyzeFiles(null);
      });

      expect(mockSetIsAnalyzing).not.toHaveBeenCalled();
    });

    test('sets isAnalyzing to true when starting', async () => {
      const { result } = renderHook(() => useAnalysis(createMockOptions()));
      const files = [{ path: '/test.txt', name: 'test.txt' }];

      // Don't await - just start the analysis
      act(() => {
        result.current.analyzeFiles(files);
      });

      // Advance through initial timeout
      await act(async () => {
        jest.advanceTimersByTime(20);
      });

      expect(mockSetIsAnalyzing).toHaveBeenCalledWith(true);
    });

    test('updates file state to analyzing', async () => {
      const { result } = renderHook(() => useAnalysis(createMockOptions()));
      const files = [{ path: '/test.txt', name: 'test.txt' }];

      act(() => {
        result.current.analyzeFiles(files);
      });

      await act(async () => {
        jest.advanceTimersByTime(20);
        await Promise.resolve();
      });

      expect(mockUpdateFileState).toHaveBeenCalledWith(
        '/test.txt',
        'analyzing',
        expect.any(Object)
      );
    });

    test('prevents concurrent analysis runs', async () => {
      const { result } = renderHook(() => useAnalysis(createMockOptions({ isAnalyzing: true })));
      const files = [{ path: '/test.txt', name: 'test.txt' }];

      await act(async () => {
        await result.current.analyzeFiles(files);
      });

      // Should not start analysis when already analyzing
      expect(mockSetIsAnalyzing).not.toHaveBeenCalledWith(true);
    });
  });

  describe('cancelAnalysis', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('stops analysis and resets state', () => {
      const { result } = renderHook(() => useAnalysis(createMockOptions()));

      act(() => {
        result.current.cancelAnalysis();
      });

      expect(mockSetIsAnalyzing).toHaveBeenCalledWith(false);
      expect(mockSetAnalysisProgress).toHaveBeenCalledWith({
        current: 0,
        total: 0
      });

      // File name is cleared after a delay
      act(() => {
        jest.runAllTimers();
      });

      expect(mockSetCurrentAnalysisFile).toHaveBeenCalledWith('');
    });

    test('updates actions phase data', () => {
      const { result } = renderHook(() => useAnalysis(createMockOptions()));

      act(() => {
        result.current.cancelAnalysis();
      });

      expect(mockActions.setPhaseData).toHaveBeenCalledWith('isAnalyzing', false);

      // File name phase data is cleared after a delay
      act(() => {
        jest.runAllTimers();
      });

      expect(mockActions.setPhaseData).toHaveBeenCalledWith('currentAnalysisFile', '');
    });
  });

  describe('clearAnalysisQueue', () => {
    test('clears all analysis state', () => {
      const { result } = renderHook(() => useAnalysis(createMockOptions()));

      act(() => {
        result.current.clearAnalysisQueue();
      });

      expect(mockSetAnalysisResults).toHaveBeenCalledWith([]);
      expect(mockSetFileStates).toHaveBeenCalledWith({});
      expect(mockSetAnalysisProgress).toHaveBeenCalledWith({
        current: 0,
        total: 0
      });
      expect(mockSetCurrentAnalysisFile).toHaveBeenCalledWith('');
    });

    test('shows notification', () => {
      const { result } = renderHook(() => useAnalysis(createMockOptions()));

      act(() => {
        result.current.clearAnalysisQueue();
      });

      expect(mockAddNotification).toHaveBeenCalledWith(
        'Analysis queue cleared',
        'info',
        2000,
        'queue-management'
      );
    });
  });

  describe('resetAnalysisState', () => {
    test('resets all analysis state', () => {
      const removeItem = jest.fn();
      global.localStorage = { removeItem };

      const { result } = renderHook(() => useAnalysis(createMockOptions()));

      act(() => {
        result.current.resetAnalysisState('test');
      });

      expect(mockSetIsAnalyzing).toHaveBeenCalledWith(false);
      expect(mockSetAnalysisProgress).toHaveBeenCalledWith({
        current: 0,
        total: 0,
        currentFile: ''
      });
      expect(mockSetCurrentAnalysisFile).toHaveBeenCalledWith('');
    });

    test('removes workflow state from localStorage', () => {
      const removeItem = jest.fn();
      Object.defineProperty(window, 'localStorage', {
        value: { removeItem },
        writable: true
      });

      const { result } = renderHook(() => useAnalysis(createMockOptions()));

      act(() => {
        result.current.resetAnalysisState('test');
      });

      expect(removeItem).toHaveBeenCalledWith('stratosort_workflow_state');
    });

    test('handles localStorage errors gracefully', () => {
      Object.defineProperty(window, 'localStorage', {
        value: {
          removeItem: () => {
            throw new Error('Storage error');
          }
        },
        writable: true
      });

      const { result } = renderHook(() => useAnalysis(createMockOptions()));

      expect(() => {
        act(() => {
          result.current.resetAnalysisState('test');
        });
      }).not.toThrow();
    });
  });

  describe('generatePreviewName', () => {
    test('calls utility function with naming settings', () => {
      const { result } = renderHook(() => useAnalysis(createMockOptions()));
      const generatePreviewNameUtil =
        require('../src/renderer/phases/discover/namingUtils').generatePreviewName;

      result.current.generatePreviewName('test.txt');

      expect(generatePreviewNameUtil).toHaveBeenCalledWith('test.txt', {
        convention: 'original',
        separator: '-',
        dateFormat: 'YYYY-MM-DD',
        caseConvention: 'original'
      });
    });
  });

  describe('cleanup on unmount', () => {
    test('cleans up intervals and timeouts', () => {
      const { unmount } = renderHook(() => useAnalysis(createMockOptions()));

      // Should not throw
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('analysis resume on mount', () => {
    test('resumes analysis for remaining files', async () => {
      const options = createMockOptions({
        isAnalyzing: true,
        selectedFiles: [
          { path: '/test1.txt', name: 'test1.txt' },
          { path: '/test2.txt', name: 'test2.txt' }
        ],
        fileStates: {
          '/test1.txt': { state: 'ready' },
          '/test2.txt': { state: 'pending' }
        }
      });

      renderHook(() => useAnalysis(options));

      // Wait for useEffect
      await act(async () => {
        jest.advanceTimersByTime(100);
      });

      // Should show resume notification
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.stringContaining('Resuming analysis'),
        'info',
        3000,
        'analysis-resume'
      );
    });

    test('resets if no remaining files', async () => {
      const options = createMockOptions({
        isAnalyzing: true,
        selectedFiles: [{ path: '/test.txt', name: 'test.txt' }],
        fileStates: {
          '/test.txt': { state: 'ready' }
        }
      });

      renderHook(() => useAnalysis(options));

      await act(async () => {
        jest.advanceTimersByTime(100);
      });

      // Should reset since all files are complete
      expect(mockSetIsAnalyzing).toHaveBeenCalledWith(false);
    });

    test('does NOT show "Resuming" notification for fresh analysis started by analyzeFiles', async () => {
      // This tests the fix for the UX bug where selecting a file would show:
      // 1. "Starting AI analysis..." (correct)
      // 2. "Resuming analysis..." (incorrect - should NOT appear for fresh analysis)
      const options = createMockOptions({
        isAnalyzing: false, // Start with analysis not running
        selectedFiles: [],
        fileStates: {}
      });

      const { result } = renderHook(() => useAnalysis(options));

      // Clear any previous notifications
      mockAddNotification.mockClear();

      // Start a fresh analysis (simulating user selecting a file)
      await act(async () => {
        result.current.analyzeFiles([{ path: '/fresh.pdf', name: 'fresh.pdf' }]);
        jest.advanceTimersByTime(100);
      });

      // Should show "Starting" notification but NOT "Resuming" notification
      const notificationCalls = mockAddNotification.mock.calls;
      const startingNotifications = notificationCalls.filter((call) =>
        call[0].includes('Starting AI analysis')
      );
      const resumingNotifications = notificationCalls.filter((call) =>
        call[0].includes('Resuming')
      );

      expect(startingNotifications.length).toBeGreaterThan(0);
      expect(resumingNotifications.length).toBe(0);
    });
  });
});
