import { createSlice } from '@reduxjs/toolkit';
import { FILE_STATES } from '../../../shared/constants';
import { logger } from '../../../shared/logger';
import { serializeData } from '../../utils/serialization';

/**
 * Maximum number of analysis results to retain in the store.
 * When this limit is exceeded, the oldest entries are trimmed.
 * Uses a hardcoded default as a safety net in case the import fails
 * (performanceConstants is a CommonJS module).
 */
let MAX_ANALYSIS_RESULTS = 5000;
try {
  const { LIMITS } = require('../../../shared/performanceConstants');
  if (LIMITS && typeof LIMITS.MAX_ANALYSIS_RESULTS === 'number') {
    MAX_ANALYSIS_RESULTS = LIMITS.MAX_ANALYSIS_RESULTS;
  }
} catch {
  // Use default if import fails
}

/**
 * Trim the results array to the maximum allowed size by removing the oldest entries.
 * Oldest entries are those at the beginning of the array (earliest push order).
 */
function enforceResultsLimit(results) {
  if (results.length > MAX_ANALYSIS_RESULTS) {
    const excess = results.length - MAX_ANALYSIS_RESULTS;
    results.splice(0, excess);
  }
}

const initialState = {
  isAnalyzing: false,
  currentAnalysisFile: '',
  analysisProgress: {
    current: 0,
    total: 0,
    lastActivity: 0
  },
  results: [] // Analysis results
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
      const payload = action.payload;
      const current = state.analysisProgress;
      // Skip update if nothing meaningful changed (avoid re-render from lastActivity alone)
      const meaningfulChange = Object.keys(payload).some(
        (key) => key !== 'lastActivity' && current[key] !== payload[key]
      );
      if (meaningfulChange || !current.lastActivity) {
        state.analysisProgress = {
          ...current,
          ...payload,
          lastActivity: Date.now()
        };
      } else if (payload.lastActivity) {
        // Always keep lastActivity fresh for liveness detection, even when
        // progress counts haven't changed. Without this, heartbeat-only
        // updates are silently discarded and the stale-lock detector at
        // useAnalysis.js:700-715 can false-trigger during slow inference.
        state.analysisProgress = { ...current, lastActivity: Date.now() };
      }
      if (payload.currentFile) {
        state.currentAnalysisFile = payload.currentFile;
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
        embeddingPolicy: analysis?.embeddingPolicy ?? null,
        embeddingStatus: analysis?.embeddingStatus ?? null,
        status: FILE_STATES.CATEGORIZED,
        analyzedAt: new Date().toISOString()
      };

      if (index >= 0) {
        state.results[index] = result;
      } else {
        state.results.push(result);
        enforceResultsLimit(state.results);
      }
    },
    analysisFailure: (state, action) => {
      const { file, error } = action.payload;
      const index = state.results.findIndex((r) => r.path === file.path);
      const result = {
        ...serializeData(file),
        analysis: null,
        error: serializeData(error),
        status: FILE_STATES.ERROR,
        analyzedAt: new Date().toISOString()
      };

      if (index >= 0) {
        state.results[index] = result;
      } else {
        state.results.push(result);
        enforceResultsLimit(state.results);
      }
    },
    stopAnalysis: (state) => {
      state.isAnalyzing = false;
      state.currentAnalysisFile = '';
    },
    setAnalysisResults: (state, action) => {
      state.results = action.payload;
      enforceResultsLimit(state.results);
    },
    mergeAnalysisResults: (state, action) => {
      const incoming = Array.isArray(action.payload) ? action.payload : [];
      if (incoming.length === 0) return;

      const indexByPath = new Map();
      state.results.forEach((result, index) => {
        const resultPath = result?.path;
        if (typeof resultPath === 'string' && resultPath.length > 0) {
          indexByPath.set(resultPath, index);
        }
      });

      incoming.forEach((result) => {
        const resultPath = result?.path;
        if (typeof resultPath !== 'string' || resultPath.length === 0) return;

        const existingIndex = indexByPath.get(resultPath);
        if (existingIndex === undefined) {
          state.results.push(result);
          indexByPath.set(resultPath, state.results.length - 1);
          return;
        }
        state.results[existingIndex] = result;
      });

      enforceResultsLimit(state.results);
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
    updateEmbeddingState: (state, action) => {
      const { path, embeddingPolicy, embeddingStatus } = action.payload || {};
      if (!path) return;
      const index = state.results.findIndex((r) => r.path === path);
      if (index < 0) return;
      if (embeddingPolicy !== undefined) {
        state.results[index].embeddingPolicy = embeddingPolicy;
        if (state.results[index].analysis) {
          state.results[index].analysis.embeddingPolicy = embeddingPolicy;
        }
      }
      if (embeddingStatus !== undefined) {
        state.results[index].embeddingStatus = embeddingStatus;
        if (state.results[index].analysis) {
          state.results[index].analysis.embeddingStatus = embeddingStatus;
        }
      }
    },
    resetAnalysisState: () => {
      return initialState;
    },
    // Clears in-progress state but preserves existing results
    resetToSafeState: (state) => {
      state.isAnalyzing = false;
      state.currentAnalysisFile = '';
      state.analysisProgress = { current: 0, total: 0, lastActivity: 0 };
      // Keep results - user may want to see what was analyzed before the error
    },
    // This prevents orphaned analysis results that consume memory
    removeAnalysisResultsByPaths: (state, action) => {
      if (!Array.isArray(action.payload)) return;
      const pathsToRemove = new Set(action.payload);
      state.results = state.results.filter((r) => !pathsToRemove.has(r.path));
    },
    // Remove single analysis result by path
    removeAnalysisResult: (state, action) => {
      const pathToRemove = action.payload;
      if (!pathToRemove) return;
      state.results = state.results.filter((r) => r.path !== pathToRemove);
    },
    // Keeps analysis results in sync with actual file locations
    updateResultPathsAfterMove: (state, action) => {
      const { oldPaths, newPaths } = action.payload;
      if (!Array.isArray(oldPaths) || !Array.isArray(newPaths)) return;

      // Enforce atomicity: never perform partial path remaps.
      if (oldPaths.length !== newPaths.length) {
        logger.error(
          '[analysisSlice] updateResultPathsAfterMove: array length mismatch, skipping',
          {
            oldPathsLength: oldPaths.length,
            newPathsLength: newPaths.length,
            action: 'no-op to preserve state consistency'
          }
        );
        return;
      }

      // Create path mapping only after payload validation passes.
      const pathMap = Object.fromEntries(oldPaths.map((oldPath, i) => [oldPath, newPaths[i]]));

      // Update results array with new paths
      state.results = state.results.map((result) => {
        const newPath = pathMap[result.path];
        if (newPath) {
          return {
            ...result,
            path: newPath,
            name: newPath.split(/[\\/]/).pop() || result.name
          };
        }
        return result;
      });
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
  mergeAnalysisResults,
  updateAnalysisResult,
  updateEmbeddingState,
  resetAnalysisState,
  resetToSafeState,
  removeAnalysisResultsByPaths,
  removeAnalysisResult,
  updateResultPathsAfterMove
} = analysisSlice.actions;

export default analysisSlice.reducer;
