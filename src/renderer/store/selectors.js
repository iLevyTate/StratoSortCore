/**
 * Redux Selectors
 *
 * Centralized selectors for computed state. These help prevent disconnections
 * between phases by ensuring data is consistently merged.
 *
 * PERFORMANCE FIX: Uses reference-stable selectors to prevent unnecessary re-renders.
 * Each selector caches its previous result and returns the same reference if the
 * output is deeply equal, preventing React components from re-rendering.
 */

import { createSelector } from '@reduxjs/toolkit';

/**
 * Creates a selector that returns stable references when output is unchanged.
 * Prevents unnecessary re-renders in consuming components.
 *
 * FIX: Uses WeakMap to store per-state-tree caching, avoiding global closure race condition.
 * Each unique state root gets its own cached result, preventing cross-component interference.
 */
const createStableSelector = (dependencies, combiner) => {
  const baseSelector = createSelector(dependencies, combiner);

  // FIX: Use WeakMap keyed by first dependency result to avoid global state sharing
  // This ensures each selector instance maintains its own cache per input reference
  const cacheMap = new WeakMap();
  let lastPrimitiveKey = null;
  let lastPrimitiveResult = null;

  return (state) => {
    const result = baseSelector(state);

    // Get a cache key from the first dependency (typically a slice of state)
    const firstDep = dependencies[0];
    const cacheKey = typeof firstDep === 'function' ? firstDep(state) : state;

    // For object cache keys, use WeakMap
    if (cacheKey && typeof cacheKey === 'object') {
      // FIX HIGH-45: Use lastResult strategy for unstable object keys (like arrays)
      // WeakMap fails when input reference changes but content is same
      // So we fallback to comparing current result with last result

      // First try WeakMap for stable references (fast path)
      if (cacheMap.has(cacheKey)) {
        return cacheMap.get(cacheKey);
      }

      // Fallback: compare with lastResult regardless of key
      // This handles case where cacheKey is a new object/array but content implies same result
      if (lastPrimitiveResult !== null) {
        // Compare result vs lastPrimitiveResult (which holds the last output)
        if (Array.isArray(result) && Array.isArray(lastPrimitiveResult)) {
          if (
            result.length === lastPrimitiveResult.length &&
            result.every((item, i) => item === lastPrimitiveResult[i])
          ) {
            // Update WeakMap for this new key to point to old result (fast path next time)
            cacheMap.set(cacheKey, lastPrimitiveResult);
            return lastPrimitiveResult;
          }
        }

        if (
          result &&
          typeof result === 'object' &&
          !Array.isArray(result) &&
          lastPrimitiveResult &&
          typeof lastPrimitiveResult === 'object'
        ) {
          const keys = Object.keys(result);
          const prevKeys = Object.keys(lastPrimitiveResult);
          if (
            keys.length === prevKeys.length &&
            keys.every((key) => result[key] === lastPrimitiveResult[key])
          ) {
            cacheMap.set(cacheKey, lastPrimitiveResult);
            return lastPrimitiveResult;
          }
        }
      }

      // Cache the new result
      cacheMap.set(cacheKey, result);
      // Also update lastPrimitiveResult for next comparison
      lastPrimitiveResult = result;
      return result;
    }

    // Fallback for primitive cache keys
    if (cacheKey === lastPrimitiveKey && lastPrimitiveResult !== null) {
      if (Array.isArray(result) && Array.isArray(lastPrimitiveResult)) {
        if (
          result.length === lastPrimitiveResult.length &&
          result.every((item, i) => item === lastPrimitiveResult[i])
        ) {
          return lastPrimitiveResult;
        }
      }
    }

    lastPrimitiveKey = cacheKey;
    lastPrimitiveResult = result;
    return result;
  };
};

// Base selectors
const selectSelectedFiles = (state) => state.files.selectedFiles;
const selectAnalysisResults = (state) => state.analysis.results;
const selectFileStates = (state) => state.files.fileStates;
const selectSmartFolders = (state) => state.files.smartFolders;
const selectOrganizedFiles = (state) => state.files.organizedFiles;

/**
 * FIX: Merged selector that always returns files with their analysis attached.
 * This prevents the disconnection between DiscoverPhase (which stores analysis separately)
 * and OrganizePhase (which expects files to have analysis property).
 *
 * Returns an array of files with:
 * - All properties from selectedFiles
 * - analysis property merged from analysisResults
 * - extension property guaranteed to exist
 *
 * NOTE: createSelector memoizes based on input reference equality. The output
 * will only be recomputed when selectedFiles, analysisResults, or fileStates
 * change by reference. However, the output array/objects are always new references.
 * For components that need shallow equality of individual items, consider using
 * React.memo with custom comparison or useRef to track previous values.
 */
export const selectFilesWithAnalysis = createSelector(
  [selectSelectedFiles, selectAnalysisResults, selectFileStates],
  (selectedFiles, analysisResults, fileStates) => {
    // Early return for empty state - stable empty array reference
    const files = selectedFiles || [];
    if (files.length === 0) {
      return files; // Return original reference for empty arrays
    }

    // Fix 7: Check if any files need extension extraction
    const hasAnalysis = Array.isArray(analysisResults) && analysisResults.length > 0;
    const hasStates = fileStates && Object.keys(fileStates).length > 0;
    const needsExtensionExtraction = files.some((file) => !file.extension && file.path);

    // Early exit only if no data to merge AND all extensions are already set
    if (!hasAnalysis && !hasStates && !needsExtensionExtraction) {
      return files;
    }

    // Create a map for O(1) lookup of analysis results by path
    const analysisMap = new Map();
    if (Array.isArray(analysisResults)) {
      analysisResults.forEach((result) => {
        if (result && result.path) {
          analysisMap.set(result.path, result);
        }
      });
    }

    // FIX: Only create new objects for files that actually need merging
    // This reduces object churn when analysis hasn't changed
    let hasChanges = false;
    const mergedFiles = files.map((file) => {
      const analysisResult = analysisMap.get(file.path);
      const fileState = fileStates?.[file.path];

      // Check if this file needs modification
      const needsAnalysis = analysisResult && file.analysis !== analysisResult.analysis;
      const needsExtension = !file.extension && file.path;
      const needsState = fileState?.state && file.status !== fileState.state;

      // If no changes needed, return original file object
      if (!needsAnalysis && !needsExtension && !needsState && !analysisResult?.error) {
        return file;
      }

      hasChanges = true;

      // Ensure extension is always set
      let { extension } = file;
      if (!extension && file.path) {
        const fileName = file.name || file.path.split(/[\\/]/).pop() || '';
        extension = fileName.includes('.') ? `.${fileName.split('.').pop().toLowerCase()}` : '';
      }

      return {
        ...file,
        extension,
        // Merge analysis from results
        analysis: analysisResult?.analysis || file.analysis || null,
        // Keep error info if present
        error: analysisResult?.error || file.error || null,
        status: analysisResult?.status || file.status || fileState?.state || 'pending',
        analyzedAt: analysisResult?.analyzedAt || file.analyzedAt || null
      };
    });

    // If no files changed, return original array to maintain reference
    return hasChanges ? mergedFiles : files;
  }
);

/**
 * Returns only files that have been successfully analyzed and are ready for organization.
 * Filters out files with errors or pending analysis.
 * PERF: Uses stable selector to prevent re-renders when filter result is unchanged.
 */
export const selectReadyFiles = createStableSelector(
  [selectFilesWithAnalysis],
  (filesWithAnalysis) => {
    return filesWithAnalysis.filter((file) => file.analysis && !file.error);
  }
);

/**
 * Returns files that failed analysis
 * PERF: Uses stable selector to prevent re-renders when filter result is unchanged.
 */
export const selectFailedFiles = createStableSelector(
  [selectFilesWithAnalysis],
  (filesWithAnalysis) => {
    return filesWithAnalysis.filter((file) => file.error);
  }
);

/**
 * Returns files that are still pending analysis
 * PERF: Uses stable selector to prevent re-renders when filter result is unchanged.
 * FIX: Removed redundant selectFileStates dependency - selectFilesWithAnalysis already
 * merges file states into file.status, so we use that instead of re-reading fileStates.
 * NOTE: A file is pending if it has no analysis result and no error, regardless of status.
 * This handles cases where status defaults to 'pending' but analysis actually exists.
 */
export const selectPendingFiles = createStableSelector(
  [selectFilesWithAnalysis],
  (filesWithAnalysis) => {
    return filesWithAnalysis.filter((file) => {
      // A file is pending only if it hasn't been analyzed yet (no analysis and no error)
      return !file.analysis && !file.error;
    });
  }
);

/**
 * Returns count statistics for file states
 * PERF: Uses stable selector to prevent re-renders when stats are unchanged.
 */
export const selectFileStats = createStableSelector(
  [selectFilesWithAnalysis],
  (filesWithAnalysis) => {
    const total = filesWithAnalysis.length;
    const ready = filesWithAnalysis.filter((f) => f.analysis && !f.error).length;
    const failed = filesWithAnalysis.filter((f) => f.error).length;
    const pending = total - ready - failed;

    return { total, ready, failed, pending };
  }
);

/**
 * Get ChromaDB service status from Redux store
 * Returns: 'online', 'offline', 'connecting', or 'unknown'
 */
export const selectChromaDBStatus = (state) => {
  return state.system?.health?.chromadb || 'unknown';
};

/**
 * Check if ChromaDB/embeddings features should be available
 */
export const selectChromaDBAvailable = (state) => {
  const status = selectChromaDBStatus(state);
  return status === 'online' || status === 'connecting';
};

// Re-export base selectors for convenience
export {
  selectSelectedFiles,
  selectAnalysisResults,
  selectFileStates,
  selectSmartFolders,
  selectOrganizedFiles
};
