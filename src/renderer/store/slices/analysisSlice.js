import { createSlice } from '@reduxjs/toolkit';
import { FILE_STATES } from '../../../shared/constants';

const initialState = {
  isAnalyzing: false,
  currentAnalysisFile: '',
  analysisProgress: {
    current: 0,
    total: 0,
    lastActivity: 0
  },
  results: [], // Analysis results
  stats: null // Historical stats
};

const analysisSlice = createSlice({
  name: 'analysis',
  initialState,
  reducers: {
    startAnalysis: (state, action) => {
      state.isAnalyzing = true;
      state.analysisProgress = {
        current: 0,
        total: action.payload?.total || 0,
        lastActivity: Date.now()
      };
      // Optionally clear previous results if new batch
      if (action.payload?.clearPrevious) {
        state.results = [];
      }
    },
    updateProgress: (state, action) => {
      state.analysisProgress = {
        ...state.analysisProgress,
        ...action.payload,
        lastActivity: Date.now()
      };
      if (action.payload.currentFile) {
        state.currentAnalysisFile = action.payload.currentFile;
      }
    },
    analysisSuccess: (state, action) => {
      // payload: { file, analysis }
      const { file, analysis } = action.payload;
      // Update or add result
      const index = state.results.findIndex((r) => r.path === file.path);
      const result = {
        ...file,
        analysis,
        status: FILE_STATES.CATEGORIZED,
        analyzedAt: new Date().toISOString()
      };

      if (index >= 0) {
        state.results[index] = result;
      } else {
        state.results.push(result);
      }
    },
    analysisFailure: (state, action) => {
      const { file, error } = action.payload;
      const index = state.results.findIndex((r) => r.path === file.path);
      const result = {
        ...file,
        analysis: null,
        error,
        status: FILE_STATES.ERROR,
        analyzedAt: new Date().toISOString()
      };

      if (index >= 0) {
        state.results[index] = result;
      } else {
        state.results.push(result);
      }
    },
    stopAnalysis: (state) => {
      state.isAnalyzing = false;
      state.currentAnalysisFile = '';
    },
    setAnalysisResults: (state, action) => {
      state.results = action.payload;
    },
    setAnalysisStats: (state, action) => {
      state.stats = action.payload;
    },
    updateAnalysisResult: (state, action) => {
      const { path, changes } = action.payload;
      const index = state.results.findIndex((r) => r.path === path);
      if (index >= 0 && state.results[index].analysis) {
        state.results[index].analysis = {
          ...state.results[index].analysis,
          ...changes
        };
      }
    },
    resetAnalysisState: () => {
      return initialState;
    }
  }
});

export const {
  startAnalysis,
  updateProgress,
  analysisSuccess,
  analysisFailure,
  stopAnalysis,
  setAnalysisResults,
  setAnalysisStats,
  updateAnalysisResult,
  resetAnalysisState
} = analysisSlice.actions;

export default analysisSlice.reducer;
