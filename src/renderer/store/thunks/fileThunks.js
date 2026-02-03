/**
 * File-related Redux thunks for atomic operations across multiple slices.
 *
 * These thunks ensure that when files are modified, all related state
 * (filesSlice, analysisSlice, etc.) stays in sync.
 */

import { removeSelectedFile } from '../slices/filesSlice';
import { removeAnalysisResult } from '../slices/analysisSlice';
import { atomicRemoveFilesWithCleanup } from '../slices/atomicActions';
import { updateEmbeddingState } from '../slices/analysisSlice';

/**
 * Atomically remove a single file from both filesSlice and analysisSlice.
 * This prevents state desynchronization where analysis results would become
 * orphaned after their corresponding files are removed.
 *
 * @param {string} filePath - The path of the file to remove
 */
export const removeFileWithCleanup = (filePath) => (dispatch) => {
  if (!filePath) return;

  // Remove from filesSlice first (includes fileStates cleanup)
  dispatch(removeSelectedFile(filePath));

  // Also remove any analysis results for this file
  dispatch(removeAnalysisResult(filePath));
};

/**
 * Atomically remove multiple files from both filesSlice and analysisSlice.
 * Use this for batch operations to maintain state consistency.
 *
 * @param {string[]} filePaths - Array of file paths to remove
 */
export const removeFilesWithCleanup = (filePaths) => atomicRemoveFilesWithCleanup(filePaths);

/**
 * Clear all files and their associated analysis results.
 * Use this when starting fresh or resetting the workflow.
 */
export const clearAllFilesWithCleanup = () => (dispatch, getState) => {
  const state = getState();
  const selectedFiles = state.files?.selectedFiles || [];

  if (selectedFiles.length > 0) {
    const filePaths = selectedFiles.map((f) => f.path);
    dispatch(removeFilesWithCleanup(filePaths));
  }
};

/**
 * Persist per-file embedding policy and update local Redux state.
 *
 * @param {string} filePath
 * @param {'embed'|'skip'|'web_only'} policy
 */
export const setEmbeddingPolicyForFile = (filePath, policy) => async (dispatch, getState) => {
  if (!filePath || !policy) return;
  const api = window.electronAPI?.analysisHistory;
  if (!api?.setEmbeddingPolicy) return;

  const result = await api.setEmbeddingPolicy(filePath, policy);
  if (result?.success) {
    const state = typeof getState === 'function' ? getState() : null;
    const existing = state?.analysis?.results?.find?.((r) => r?.path === filePath) || null;
    const prevStatus = existing?.embeddingStatus || existing?.analysis?.embeddingStatus || null;
    const nextStatus =
      policy === 'embed' ? (prevStatus === 'done' ? 'done' : 'pending') : 'skipped';
    dispatch(
      updateEmbeddingState({
        path: filePath,
        embeddingPolicy: policy,
        // Treat policy changes as immediate state changes for UI clarity
        embeddingStatus: nextStatus
      })
    );
  }
};
