/**
 * File-related Redux thunks for atomic operations across multiple slices.
 *
 * These thunks ensure that when files are modified, all related state
 * (filesSlice, analysisSlice, etc.) stays in sync.
 */

import { removeSelectedFile, removeSelectedFiles } from '../slices/filesSlice';
import { removeAnalysisResult, removeAnalysisResultsByPaths } from '../slices/analysisSlice';

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
export const removeFilesWithCleanup = (filePaths) => (dispatch) => {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return;

  // Remove from filesSlice first (includes fileStates cleanup)
  dispatch(removeSelectedFiles(filePaths));

  // Also remove any analysis results for these files
  dispatch(removeAnalysisResultsByPaths(filePaths));
};

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
