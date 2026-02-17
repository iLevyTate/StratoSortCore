/**
 * Tests for useAnalysis Hook
 * Tests file analysis logic and state management
 */

import { renderHook, act } from '@testing-library/react';

// Mock dependencies
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
  generatePreviewName: jest.fn((name) => name),
  generateSuggestedNameFromAnalysis: jest.fn(({ originalFileName }) => originalFileName),
  makeUniqueFileName: jest.fn((candidate) => candidate),
  extractFileName: jest.fn((filePath) => {
    const value = String(filePath || '');
    const parts = value.split(/[\\/]/);
    return parts[parts.length - 1] || value;
  })
}));

// Mock window.electronAPI
const mockElectronAPI = {
  files: {
    analyze: jest.fn()
  },
  analysis: {
    batch: jest.fn()
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
    mockElectronAPI.analysis.batch.mockResolvedValue({
      success: true,
      results: [],
      errors: [],
      total: 0,
      successful: 0
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
      const { result } = renderHook(() =>
        useAnalysis(
          createMockOptions({
            isAnalyzing: true,
            analysisProgress: { current: 0, total: 1, lastActivity: Date.now() }
          })
        )
      );
      const files = [{ path: '/test.txt', name: 'test.txt' }];

      await act(async () => {
        await result.current.analyzeFiles(files);
      });

      // Should not start analysis when already analyzing
      expect(mockSetIsAnalyzing).not.toHaveBeenCalledWith(true);
    });

    test('uses batch analysis route for large runs', async () => {
      const { result } = renderHook(() => useAnalysis(createMockOptions()));
      const files = Array.from({ length: 40 }, (_, index) => ({
        path: `/batch/file-${index}.txt`,
        name: `file-${index}.txt`
      }));

      mockElectronAPI.analysis.batch.mockResolvedValueOnce({
        success: true,
        results: files.map((file) => ({
          filePath: file.path,
          success: true,
          result: {
            category: 'documents',
            suggestedName: `${file.name}-done`
          }
        })),
        errors: [],
        total: files.length,
        successful: files.length
      });

      await act(async () => {
        const promise = result.current.analyzeFiles(files);
        jest.advanceTimersByTime(50);
        await promise;
      });

      expect(mockElectronAPI.analysis.batch).toHaveBeenCalledWith(
        expect.objectContaining({
          filePaths: files.map((file) => file.path)
        })
      );
    });

    test('falls back to per-file analysis when batch route fails', async () => {
      const { result } = renderHook(() => useAnalysis(createMockOptions()));
      const files = Array.from({ length: 40 }, (_, index) => ({
        path: `/fallback/file-${index}.txt`,
        name: `file-${index}.txt`
      }));

      mockElectronAPI.analysis.batch.mockRejectedValueOnce(new Error('Batch route failed'));

      await act(async () => {
        const promise = result.current.analyzeFiles(files);
        jest.advanceTimersByTime(50);
        await promise;
      });

      expect(mockElectronAPI.analysis.batch).toHaveBeenCalled();
      expect(mockElectronAPI.files.analyze).toHaveBeenCalled();
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
        total: 0,
        lastActivity: 0
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

      // File name phase data is cleared after a delay
      act(() => {
        jest.runAllTimers();
      });

      expect(mockActions.setPhaseData).toHaveBeenCalledWith('currentAnalysisFile', '');
    });

    test('requeues in-flight files to pending when cancelled', () => {
      const { result } = renderHook(() =>
        useAnalysis(
          createMockOptions({
            fileStates: {
              '/inflight.txt': { state: 'analyzing' },
              '/ready.txt': { state: 'ready' }
            }
          })
        )
      );

      act(() => {
        result.current.cancelAnalysis();
      });

      const updaterCalls = mockSetFileStates.mock.calls.filter(
        (call) => typeof call[0] === 'function'
      );
      const updaterCall = updaterCalls[updaterCalls.length - 1];
      expect(updaterCall).toBeDefined();
      const updater = updaterCall[0];
      const updated = updater({
        '/inflight.txt': { state: 'analyzing' },
        '/ready.txt': { state: 'ready' }
      });
      expect(updated['/inflight.txt'].state).toBe('pending');
      expect(updated['/ready.txt'].state).toBe('ready');
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
      // clearAnalysisQueue delegates to resetAnalysisState which clears progress
      // with full shape including currentFile and lastActivity
      expect(mockSetAnalysisProgress).toHaveBeenCalledWith({
        current: 0,
        total: 0,
        currentFile: '',
        lastActivity: 0
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
        currentFile: '',
        lastActivity: 0
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

    test('preserves completed batch subset when reset is triggered mid-run', async () => {
      const files = Array.from({ length: 40 }, (_, index) => ({
        path: `/reset-batch/file-${index}.txt`,
        name: `file-${index}.txt`
      }));

      let resolveBatch;
      const batchPromise = new Promise((resolve) => {
        resolveBatch = resolve;
      });

      mockElectronAPI.settings.get.mockResolvedValueOnce({
        maxConcurrentAnalysis: 1
      });
      mockElectronAPI.analysis.batch.mockReturnValueOnce(batchPromise);

      const { result } = renderHook(() =>
        useAnalysis(
          createMockOptions({
            selectedFiles: files
          })
        )
      );

      let analyzePromise;
      await act(async () => {
        analyzePromise = result.current.analyzeFiles(files);
        jest.advanceTimersByTime(50);
        await Promise.resolve();
      });

      const progressEvent = (completed, currentFile) =>
        new CustomEvent('operation-progress', {
          detail: {
            type: 'batch_analyze',
            batchId: 'batch-reset-test',
            completed,
            total: files.length,
            currentFile
          }
        });

      act(() => {
        window.dispatchEvent(progressEvent(1, files[0].path));
        window.dispatchEvent(progressEvent(2, files[1].path));
        result.current.resetAnalysisState('Analysis lock timeout');
      });

      resolveBatch({
        success: true,
        results: files.map((file) => ({
          filePath: file.path,
          success: true,
          result: {
            category: 'documents',
            suggestedName: `${file.name}-done`
          }
        })),
        errors: [],
        total: files.length,
        successful: files.length
      });

      await act(async () => {
        await analyzePromise;
      });

      const resultArrayCalls = mockSetAnalysisResults.mock.calls
        .map((call) => call[0])
        .filter((value) => Array.isArray(value));
      expect(resultArrayCalls.length).toBeGreaterThan(0);
      const lastResults = resultArrayCalls[resultArrayCalls.length - 1];
      expect(lastResults).toHaveLength(2);
      expect(lastResults.map((item) => item.path)).toEqual(files.slice(0, 2).map((f) => f.path));
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

    test('clears analysis flags on unmount', () => {
      const { unmount } = renderHook(() =>
        useAnalysis(
          createMockOptions({
            isAnalyzing: true,
            analysisProgress: { current: 1, total: 3, lastActivity: Date.now() }
          })
        )
      );

      act(() => {
        unmount();
      });

      expect(mockSetIsAnalyzing).toHaveBeenCalledWith(false);
      expect(mockSetAnalysisProgress).toHaveBeenCalledWith({
        current: 0,
        total: 0,
        lastActivity: 0
      });
      expect(mockSetCurrentAnalysisFile).toHaveBeenCalledWith('');
      expect(mockActions.setPhaseData).toHaveBeenCalledWith('currentAnalysisFile', '');
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

    test('preserves already-completed batch results when cancelled', async () => {
      const files = Array.from({ length: 40 }, (_, index) => ({
        path: `/cancelled-batch/file-${index}.txt`,
        name: `file-${index}.txt`
      }));

      let resolveBatch;
      const batchPromise = new Promise((resolve) => {
        resolveBatch = resolve;
      });

      mockElectronAPI.settings.get.mockResolvedValueOnce({
        maxConcurrentAnalysis: 1
      });
      mockElectronAPI.analysis.batch.mockReturnValueOnce(batchPromise);

      const { result } = renderHook(() =>
        useAnalysis(
          createMockOptions({
            selectedFiles: files
          })
        )
      );

      let analyzePromise;
      await act(async () => {
        analyzePromise = result.current.analyzeFiles(files);
        jest.advanceTimersByTime(50);
        await Promise.resolve();
      });

      const progressEvent = (completed, currentFile) =>
        new CustomEvent('operation-progress', {
          detail: {
            type: 'batch_analyze',
            batchId: 'batch-cancel-test',
            completed,
            total: files.length,
            currentFile
          }
        });

      act(() => {
        window.dispatchEvent(progressEvent(1, files[0].path));
        window.dispatchEvent(progressEvent(2, files[1].path));
        window.dispatchEvent(progressEvent(3, files[2].path));
        result.current.cancelAnalysis();
      });

      resolveBatch({
        success: true,
        results: files.map((file) => ({
          filePath: file.path,
          success: true,
          result: {
            category: 'documents',
            suggestedName: `${file.name}-done`
          }
        })),
        errors: [],
        total: files.length,
        successful: files.length
      });

      await act(async () => {
        await analyzePromise;
      });

      const resultArrayCalls = mockSetAnalysisResults.mock.calls
        .map((call) => call[0])
        .filter((value) => Array.isArray(value));
      expect(resultArrayCalls.length).toBeGreaterThan(0);
      const lastResults = resultArrayCalls[resultArrayCalls.length - 1];
      expect(lastResults).toHaveLength(3);
      expect(lastResults.map((item) => item.path)).toEqual(files.slice(0, 3).map((f) => f.path));
    });
  });
});
