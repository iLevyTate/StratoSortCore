/**
 * Tests for Analysis Slice
 * Tests Redux slice for analysis state management
 */

// Mock constants
jest.mock('../src/shared/constants', () => ({
  FILE_STATES: {
    PENDING: 'pending',
    ANALYZING: 'analyzing',
    CATEGORIZED: 'categorized',
    ERROR: 'error'
  }
}));

import analysisReducer, {
  startAnalysis,
  updateProgress,
  analysisSuccess,
  analysisFailure,
  stopAnalysis,
  setAnalysisResults,
  resetAnalysisState,
  updateResultPathsAfterMove
} from '../src/renderer/store/slices/analysisSlice';

describe('analysisSlice', () => {
  const initialState = {
    isAnalyzing: false,
    currentAnalysisFile: '',
    analysisProgress: {
      current: 0,
      total: 0,
      lastActivity: 0
    },
    results: []
  };

  describe('initial state', () => {
    test('returns initial state', () => {
      const result = analysisReducer(undefined, { type: 'unknown' });

      expect(result.isAnalyzing).toBe(false);
      expect(result.results).toEqual([]);
    });
  });

  describe('startAnalysis', () => {
    test('sets analyzing state', () => {
      const result = analysisReducer(initialState, startAnalysis({ total: 5 }));

      expect(result.isAnalyzing).toBe(true);
      expect(result.analysisProgress.total).toBe(5);
      expect(result.analysisProgress.current).toBe(0);
      expect(result.analysisProgress.lastActivity).toBeGreaterThan(0);
    });

    test('clears previous results when requested', () => {
      const state = {
        ...initialState,
        results: [{ path: '/old.pdf' }]
      };

      const result = analysisReducer(state, startAnalysis({ total: 1, clearPrevious: true }));

      expect(result.results).toEqual([]);
    });

    test('preserves results when clearPrevious is false', () => {
      const state = {
        ...initialState,
        results: [{ path: '/old.pdf' }]
      };

      const result = analysisReducer(state, startAnalysis({ total: 1, clearPrevious: false }));

      expect(result.results).toHaveLength(1);
    });

    test('handles missing payload', () => {
      const result = analysisReducer(initialState, startAnalysis({}));

      expect(result.isAnalyzing).toBe(true);
      expect(result.analysisProgress.total).toBe(0);
    });
  });

  describe('updateProgress', () => {
    test('updates progress values', () => {
      const state = {
        ...initialState,
        isAnalyzing: true,
        analysisProgress: { current: 0, total: 5, lastActivity: 0 }
      };

      const result = analysisReducer(state, updateProgress({ current: 3 }));

      expect(result.analysisProgress.current).toBe(3);
      expect(result.analysisProgress.total).toBe(5);
      expect(result.analysisProgress.lastActivity).toBeGreaterThan(0);
    });

    test('updates current file when provided', () => {
      const state = {
        ...initialState,
        currentAnalysisFile: ''
      };

      const result = analysisReducer(state, updateProgress({ currentFile: '/current.pdf' }));

      expect(result.currentAnalysisFile).toBe('/current.pdf');
    });

    test('preserves current file when not provided', () => {
      const state = {
        ...initialState,
        currentAnalysisFile: '/existing.pdf'
      };

      const result = analysisReducer(state, updateProgress({ current: 1 }));

      expect(result.currentAnalysisFile).toBe('/existing.pdf');
    });
  });

  describe('analysisSuccess', () => {
    test('adds new result', () => {
      const file = { path: '/new.pdf', name: 'new.pdf' };
      const analysis = { category: 'documents', confidence: 0.9 };

      const result = analysisReducer(initialState, analysisSuccess({ file, analysis }));

      expect(result.results).toHaveLength(1);
      expect(result.results[0].path).toBe('/new.pdf');
      expect(result.results[0].analysis).toEqual(analysis);
      expect(result.results[0].status).toBe('categorized');
      expect(result.results[0].analyzedAt).toBeDefined();
    });

    test('updates existing result', () => {
      const state = {
        ...initialState,
        results: [{ path: '/existing.pdf', status: 'pending' }]
      };

      const file = { path: '/existing.pdf', name: 'existing.pdf' };
      const analysis = { category: 'images', confidence: 0.85 };

      const result = analysisReducer(state, analysisSuccess({ file, analysis }));

      expect(result.results).toHaveLength(1);
      expect(result.results[0].analysis).toEqual(analysis);
      expect(result.results[0].status).toBe('categorized');
    });
  });

  describe('analysisFailure', () => {
    test('adds failure result', () => {
      const file = { path: '/failed.pdf', name: 'failed.pdf' };
      const error = 'Analysis failed';

      const result = analysisReducer(initialState, analysisFailure({ file, error }));

      expect(result.results).toHaveLength(1);
      expect(result.results[0].path).toBe('/failed.pdf');
      expect(result.results[0].analysis).toBeNull();
      expect(result.results[0].error).toBe('Analysis failed');
      expect(result.results[0].status).toBe('error');
    });

    test('updates existing result with failure', () => {
      const state = {
        ...initialState,
        results: [{ path: '/file.pdf', status: 'analyzing' }]
      };

      const file = { path: '/file.pdf', name: 'file.pdf' };
      const error = 'Timeout';

      const result = analysisReducer(state, analysisFailure({ file, error }));

      expect(result.results).toHaveLength(1);
      expect(result.results[0].error).toBe('Timeout');
      expect(result.results[0].status).toBe('error');
    });
  });

  describe('stopAnalysis', () => {
    test('stops analysis', () => {
      const state = {
        ...initialState,
        isAnalyzing: true,
        currentAnalysisFile: '/current.pdf'
      };

      const result = analysisReducer(state, stopAnalysis());

      expect(result.isAnalyzing).toBe(false);
      expect(result.currentAnalysisFile).toBe('');
    });
  });

  describe('setAnalysisResults', () => {
    test('sets analysis results', () => {
      const results = [
        { path: '/file1.pdf', analysis: { category: 'docs' } },
        { path: '/file2.pdf', analysis: { category: 'images' } }
      ];

      const result = analysisReducer(initialState, setAnalysisResults(results));

      expect(result.results).toEqual(results);
    });

    test('replaces existing results', () => {
      const state = {
        ...initialState,
        results: [{ path: '/old.pdf' }]
      };

      const newResults = [{ path: '/new.pdf' }];

      const result = analysisReducer(state, setAnalysisResults(newResults));

      expect(result.results).toEqual(newResults);
    });
  });

  describe('updateResultPathsAfterMove', () => {
    test('updates result paths when payload arrays are valid', () => {
      const state = {
        ...initialState,
        results: [{ path: '/old/a.pdf', name: 'a.pdf', analysis: { category: 'docs' } }]
      };

      const result = analysisReducer(
        state,
        updateResultPathsAfterMove({
          oldPaths: ['/old/a.pdf'],
          newPaths: ['/new/a.pdf']
        })
      );

      expect(result.results[0].path).toBe('/new/a.pdf');
      expect(result.results[0].name).toBe('a.pdf');
    });

    test('does not mutate results when payload arrays mismatch', () => {
      const state = {
        ...initialState,
        results: [
          { path: '/old/a.pdf', name: 'a.pdf', analysis: { category: 'docs' } },
          { path: '/old/b.pdf', name: 'b.pdf', analysis: { category: 'docs' } }
        ]
      };

      const result = analysisReducer(
        state,
        updateResultPathsAfterMove({
          oldPaths: ['/old/a.pdf', '/old/b.pdf'],
          newPaths: ['/new/a.pdf']
        })
      );

      expect(result.results[0].path).toBe('/old/a.pdf');
      expect(result.results[1].path).toBe('/old/b.pdf');
    });
  });

  describe('resetAnalysisState', () => {
    test('resets to initial state', () => {
      const modifiedState = {
        isAnalyzing: true,
        currentAnalysisFile: '/file.pdf',
        analysisProgress: { current: 5, total: 10, lastActivity: Date.now() },
        results: [{ path: '/file.pdf' }]
      };

      const result = analysisReducer(modifiedState, resetAnalysisState());

      expect(result.isAnalyzing).toBe(false);
      expect(result.currentAnalysisFile).toBe('');
      expect(result.results).toEqual([]);
    });
  });
});
