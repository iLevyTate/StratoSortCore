/**
 * Tests for useDiscoverState Hook
 * Tests Redux state bindings and action wrappers for discover phase
 */

import { renderHook, act } from '@testing-library/react';

// Mock the logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the store modules
jest.mock('../src/renderer/store/hooks', () => ({
  useAppSelector: jest.fn((selector) => selector),
  useAppDispatch: jest.fn(() => jest.fn()),
}));

jest.mock('../src/renderer/store/slices/filesSlice', () => ({
  setSelectedFiles: jest.fn((payload) => ({
    type: 'files/setSelectedFiles',
    payload,
  })),
  updateFileState: jest.fn((payload) => ({
    type: 'files/updateFileState',
    payload,
  })),
  setFileStates: jest.fn((payload) => ({
    type: 'files/setFileStates',
    payload,
  })),
  setNamingConvention: jest.fn((payload) => ({
    type: 'files/setNamingConvention',
    payload,
  })),
}));

jest.mock('../src/renderer/store/slices/analysisSlice', () => ({
  startAnalysis: jest.fn((payload) => ({
    type: 'analysis/startAnalysis',
    payload,
  })),
  updateProgress: jest.fn((payload) => ({
    type: 'analysis/updateProgress',
    payload,
  })),
  stopAnalysis: jest.fn(() => ({ type: 'analysis/stopAnalysis' })),
  setAnalysisResults: jest.fn((payload) => ({
    type: 'analysis/setAnalysisResults',
    payload,
  })),
  resetAnalysisState: jest.fn(() => ({ type: 'analysis/resetAnalysisState' })),
}));

jest.mock('../src/renderer/store/slices/uiSlice', () => ({
  setPhase: jest.fn((payload) => ({ type: 'ui/setPhase', payload })),
  setAnalyzing: jest.fn((payload) => ({ type: 'ui/setAnalyzing', payload })),
}));

describe('useDiscoverState', () => {
  let useDiscoverState;
  let mockDispatch;
  let mockUseAppSelector;
  let mockUseAppDispatch;

  const defaultState = {
    files: {
      selectedFiles: [{ path: '/test.txt', name: 'test.txt' }],
      fileStates: { '/test.txt': { state: 'pending' } },
      namingConvention: {
        convention: 'original',
        dateFormat: 'YYYY-MM-DD',
        caseConvention: 'original',
        separator: '-',
      },
    },
    analysis: {
      results: [{ path: '/test.txt', analysis: { category: 'documents' } }],
      isAnalyzing: false,
      analysisProgress: { current: 0, total: 0 },
      currentAnalysisFile: '',
    },
    ui: {
      phase: 'discover',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockDispatch = jest.fn();
    mockUseAppDispatch = require('../src/renderer/store/hooks').useAppDispatch;
    mockUseAppSelector = require('../src/renderer/store/hooks').useAppSelector;

    mockUseAppDispatch.mockReturnValue(mockDispatch);
    mockUseAppSelector.mockImplementation((selector) => {
      if (typeof selector === 'function') {
        return selector(defaultState);
      }
      return selector;
    });

    useDiscoverState =
      require('../src/renderer/phases/discover/useDiscoverState').useDiscoverState;
  });

  describe('state selectors', () => {
    test('returns selectedFiles from state', () => {
      const { result } = renderHook(() => useDiscoverState());

      expect(result.current.selectedFiles).toEqual(
        defaultState.files.selectedFiles,
      );
    });

    test('returns analysisResults from state', () => {
      const { result } = renderHook(() => useDiscoverState());

      expect(result.current.analysisResults).toEqual(
        defaultState.analysis.results,
      );
    });

    test('returns isAnalyzing from state', () => {
      const { result } = renderHook(() => useDiscoverState());

      expect(result.current.isAnalyzing).toBe(false);
    });

    test('returns fileStates from state', () => {
      const { result } = renderHook(() => useDiscoverState());

      expect(result.current.fileStates).toEqual(defaultState.files.fileStates);
    });

    test('returns namingConvention settings', () => {
      const { result } = renderHook(() => useDiscoverState());

      expect(result.current.namingConvention).toBe('original');
      expect(result.current.dateFormat).toBe('YYYY-MM-DD');
      expect(result.current.caseConvention).toBe('original');
      expect(result.current.separator).toBe('-');
    });
  });

  describe('action wrappers', () => {
    test('setSelectedFiles dispatches action with array', () => {
      const { result } = renderHook(() => useDiscoverState());
      const newFiles = [{ path: '/new.txt' }];

      act(() => {
        result.current.setSelectedFiles(newFiles);
      });

      expect(mockDispatch).toHaveBeenCalled();
    });

    test('setSelectedFiles handles function updater', () => {
      const { result } = renderHook(() => useDiscoverState());

      act(() => {
        result.current.setSelectedFiles((prev) => [
          ...prev,
          { path: '/new.txt' },
        ]);
      });

      expect(mockDispatch).toHaveBeenCalled();
    });

    test('setIsAnalyzing starts analysis when true', () => {
      const { result } = renderHook(() => useDiscoverState());

      act(() => {
        result.current.setIsAnalyzing(true);
      });

      expect(mockDispatch).toHaveBeenCalled();
    });

    test('setIsAnalyzing stops analysis when false', () => {
      const { result } = renderHook(() => useDiscoverState());

      act(() => {
        result.current.setIsAnalyzing(false);
      });

      expect(mockDispatch).toHaveBeenCalled();
    });

    test('setNamingConvention dispatches action', () => {
      const { result } = renderHook(() => useDiscoverState());

      act(() => {
        result.current.setNamingConvention('kebab-case');
      });

      expect(mockDispatch).toHaveBeenCalled();
    });

    test('setDateFormat dispatches action', () => {
      const { result } = renderHook(() => useDiscoverState());

      act(() => {
        result.current.setDateFormat('DD-MM-YYYY');
      });

      expect(mockDispatch).toHaveBeenCalled();
    });

    test('updateFileState dispatches action with path and state', () => {
      const { result } = renderHook(() => useDiscoverState());

      act(() => {
        result.current.updateFileState('/test.txt', 'analyzing', {
          progress: 50,
        });
      });

      expect(mockDispatch).toHaveBeenCalled();
    });
  });

  describe('computed values', () => {
    test('successfulAnalysisCount returns count of files with analysis', () => {
      const { result } = renderHook(() => useDiscoverState());

      expect(result.current.successfulAnalysisCount).toBe(1);
    });

    test('failedAnalysisCount returns count of files with errors', () => {
      mockUseAppSelector.mockImplementation((selector) => {
        const stateWithError = {
          ...defaultState,
          analysis: {
            ...defaultState.analysis,
            results: [{ path: '/test.txt', error: 'Failed' }],
          },
        };
        return selector(stateWithError);
      });

      const { result } = renderHook(() => useDiscoverState());

      expect(result.current.failedAnalysisCount).toBe(1);
    });

    test('readySelectedFilesCount returns count of ready files', () => {
      mockUseAppSelector.mockImplementation((selector) => {
        const stateWithReady = {
          ...defaultState,
          files: {
            ...defaultState.files,
            fileStates: { '/test.txt': { state: 'ready' } },
          },
        };
        return selector(stateWithReady);
      });

      const { result } = renderHook(() => useDiscoverState());

      expect(result.current.readySelectedFilesCount).toBe(1);
    });
  });

  describe('namingSettings', () => {
    test('returns memoized naming settings object', () => {
      const { result } = renderHook(() => useDiscoverState());

      expect(result.current.namingSettings).toEqual({
        convention: 'original',
        separator: '-',
        dateFormat: 'YYYY-MM-DD',
        caseConvention: 'original',
      });
    });
  });

  describe('actions object', () => {
    test('setPhaseData handles isAnalyzing key', () => {
      const { result } = renderHook(() => useDiscoverState());

      act(() => {
        result.current.actions.setPhaseData('isAnalyzing', true);
      });

      expect(mockDispatch).toHaveBeenCalled();
    });

    test('advancePhase dispatches setPhase action', () => {
      const { result } = renderHook(() => useDiscoverState());

      act(() => {
        result.current.actions.advancePhase('organize');
      });

      expect(mockDispatch).toHaveBeenCalled();
    });
  });

  describe('resetAnalysisState', () => {
    test('clears analysis state and localStorage', () => {
      const removeItem = jest.fn();
      Object.defineProperty(global, 'localStorage', {
        value: { removeItem },
        writable: true,
      });

      const { result } = renderHook(() => useDiscoverState());

      act(() => {
        result.current.resetAnalysisState('test reset');
      });

      expect(mockDispatch).toHaveBeenCalled();
      expect(removeItem).toHaveBeenCalledWith('stratosort_workflow_state');
    });

    test('handles localStorage errors gracefully', () => {
      Object.defineProperty(global, 'localStorage', {
        value: {
          removeItem: () => {
            throw new Error('Storage error');
          },
        },
        writable: true,
      });

      const { result } = renderHook(() => useDiscoverState());

      expect(() => {
        act(() => {
          result.current.resetAnalysisState('test');
        });
      }).not.toThrow();
    });
  });
});
