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
 * FIX CRIT-3: Simplified stable selector that uses shallow equality checking
 * to return the same reference when output is unchanged.
 *
 * The previous implementation used WeakMap which fails for arrays because
 * array references change even when contents are the same. This simpler
 * approach stores the last result and compares with shallow equality.
 *
 * FIX C12: Prevents memory retention of mega-arrays. When the result is an
 * array with more than LARGE_ARRAY_THRESHOLD items, we skip caching to avoid
 * pinning large data structures in the closure indefinitely (e.g., after the
 * consuming component unmounts). Small results are still cached for reference
 * stability, which is the common case for filtered file lists.
 */
const LARGE_ARRAY_THRESHOLD = 1000;

const createStableSelector = (dependencies, combiner) => {
  const baseSelector = createSelector(dependencies, combiner);

  // Store last result for reference stability
  let lastResult = null;
  let lastResetCounter = null;

  /**
   * Shallow equality check for arrays and objects
   */
  const shallowEqual = (a, b) => {
    if (a === b) return true;
    if (a == null || b == null) return false;

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    }

    if (typeof a === 'object' && typeof b === 'object') {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      if (keysA.length !== keysB.length) return false;
      for (const key of keysA) {
        if (a[key] !== b[key]) return false;
      }
      return true;
    }

    return false;
  };

  return (state) => {
    const resetCounter = state?.ui?.resetCounter;
    if (typeof resetCounter === 'number' && resetCounter !== lastResetCounter) {
      lastResetCounter = resetCounter;
      lastResult = null;
    }

    const result = baseSelector(state);

    // in the closure. Components handling 1000+ items should already handle
    // reference changes via virtualization or their own memoization.
    if (Array.isArray(result) && result.length > LARGE_ARRAY_THRESHOLD) {
      lastResult = null;
      return result;
    }

    // Return cached result if shallowly equal
    if (shallowEqual(result, lastResult)) {
      return lastResult;
    }

    // Store and return new result
    lastResult = result;
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

    const safeAnalysisResults = Array.isArray(analysisResults) ? analysisResults : [];
    const safeFileStates =
      fileStates && typeof fileStates === 'object' && !Array.isArray(fileStates) ? fileStates : {};
    const hasAnalysis = safeAnalysisResults.length > 0;
    const hasStates = Object.keys(safeFileStates).length > 0;
    const needsExtensionExtraction = files.some((file) => !file.extension && file.path);

    // Early exit only if no data to merge AND all extensions are already set
    if (!hasAnalysis && !hasStates && !needsExtensionExtraction) {
      return files;
    }

    // Create a map for O(1) lookup of analysis results by path
    const analysisMap = new Map();
    safeAnalysisResults.forEach((result) => {
      if (result && result.path) {
        analysisMap.set(result.path, result);
      }
    });

    // This reduces object churn when analysis hasn't changed
    let hasChanges = false;
    const mergedFiles = files.map((file) => {
      const analysisResult = analysisMap.get(file.path);
      const fileState = safeFileStates?.[file.path];
      const nextStatus = analysisResult?.status || fileState?.state || file.status || 'pending';
      const nextError = analysisResult?.error || file.error || null;
      const nextAnalyzedAt = analysisResult?.analyzedAt || file.analyzedAt || null;

      // Check if this file needs modification
      const needsAnalysis = analysisResult && file.analysis !== analysisResult.analysis;
      const needsExtension = !file.extension && file.path;
      const needsStatus = nextStatus !== file.status;
      const needsError = nextError !== file.error;
      const needsAnalyzedAt = nextAnalyzedAt !== file.analyzedAt;

      // If no changes needed, return original file object
      if (!needsAnalysis && !needsExtension && !needsStatus && !needsError && !needsAnalyzedAt) {
        return file;
      }

      hasChanges = true;

      // Ensure extension is always set
      let { extension } = file;
      if (!extension && file.path) {
        const fileName = file.name || file.path.split(/[\\/]/).pop() || '';
        const dotIdx = fileName.lastIndexOf('.');
        extension = dotIdx > 0 ? fileName.slice(dotIdx).toLowerCase() : '';
      }

      return {
        ...file,
        extension,
        // Merge analysis from results
        analysis: analysisResult?.analysis || file.analysis || null,
        // Keep error info if present
        error: nextError,
        status: nextStatus,
        analyzedAt: nextAnalyzedAt
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
 * PERF: Single-pass counting instead of multiple filter() calls
 */
export const selectFileStats = createStableSelector(
  [selectFilesWithAnalysis],
  (filesWithAnalysis) => {
    let ready = 0;
    let failed = 0;
    for (const f of filesWithAnalysis) {
      if (f.error) {
        failed++;
      } else if (f.analysis) {
        ready++;
      }
    }
    const total = filesWithAnalysis.length;
    return { total, ready, failed, pending: total - ready - failed };
  }
);

/**
 * Get vector DB service status from Redux store
 * Returns: 'online', 'offline', 'connecting', or 'unknown'
 * PERF: Memoized to prevent unnecessary recalculations
 */
export const selectVectorDbStatus = createSelector(
  [(state) => state.system?.health?.vectorDb],
  (vectorDb) => vectorDb || 'unknown'
);

/**
 * Check if vector DB/embeddings features should be available
 * PERF: Memoized and depends on selectVectorDbStatus
 */
export const selectVectorDbAvailable = createSelector(
  [selectVectorDbStatus],
  (status) => status === 'online' || status === 'connecting'
);

/**
 * Get redactPaths setting from system state
 * PERF: Memoized selector to prevent re-renders across 8+ components
 * that were previously using inline useSelector with Boolean coercion
 */
export const selectRedactPaths = createSelector(
  [(state) => state?.system?.redactPaths],
  (redactPaths) => Boolean(redactPaths)
);

/**
 * Get default embedding policy from UI settings with safe fallback.
 * Keeps list components subscribed to one field instead of the full settings object.
 */
export const selectDefaultEmbeddingPolicy = createSelector(
  [(state) => state?.ui?.settings?.defaultEmbeddingPolicy],
  (policy) => (policy === 'embed' || policy === 'skip' || policy === 'web_only' ? policy : 'embed')
);

// Re-export base selectors and constants for convenience
export {
  selectSelectedFiles,
  selectAnalysisResults,
  selectFileStates,
  selectSmartFolders,
  selectOrganizedFiles,
  LARGE_ARRAY_THRESHOLD
};
