/**
 * useFileEditing Hook
 *
 * File editing, selection, and state display logic.
 *
 * @module organize/useFileEditing
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { debounce } from '../../utils/performance';

// Inline SVG Icons (keep UI visuals)
const CheckCircleIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const RefreshCwIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

const XCircleIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const FolderOpenIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"
    />
  </svg>
);

const ClockIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const iconPropTypes = {
  className: PropTypes.string
};

CheckCircleIcon.propTypes = iconPropTypes;
RefreshCwIcon.propTypes = iconPropTypes;
XCircleIcon.propTypes = iconPropTypes;
FolderOpenIcon.propTypes = iconPropTypes;
ClockIcon.propTypes = iconPropTypes;

/**
 * Hook for file state display
 * @param {Object} fileStates - File states object
 * @returns {Object} File state helpers
 */
export function useFileStateDisplay(fileStates) {
  const getFileState = useCallback(
    (filePath) => fileStates[filePath]?.state || 'pending',
    [fileStates]
  );

  const getFileStateDisplay = useCallback(
    (filePath, hasAnalysis, isProcessed = false) => {
      if (isProcessed)
        return {
          icon: <CheckCircleIcon className="w-4 h-4" />,
          iconSymbol: '✅',
          label: 'Organized',
          color: 'text-green-600',
          spinning: false
        };
      const state = getFileState(filePath);
      if (state === 'analyzing')
        return {
          icon: <RefreshCwIcon className="w-4 h-4" />,
          iconSymbol: '🔄',
          label: 'Analyzing...',
          color: 'text-blue-600',
          spinning: true
        };
      if (state === 'error')
        return {
          icon: <XCircleIcon className="w-4 h-4" />,
          iconSymbol: '❌',
          label: 'Error',
          color: 'text-red-600',
          spinning: false
        };
      if (hasAnalysis && state === 'ready')
        return {
          icon: <FolderOpenIcon className="w-4 h-4" />,
          iconSymbol: '📂',
          label: 'Ready',
          color: 'text-stratosort-blue',
          spinning: false
        };
      if (state === 'pending')
        return {
          icon: <ClockIcon className="w-4 h-4" />,
          iconSymbol: '🕒',
          label: 'Pending',
          color: 'text-yellow-600',
          spinning: false
        };
      return {
        icon: <XCircleIcon className="w-4 h-4" />,
        iconSymbol: '❌',
        label: 'Failed',
        color: 'text-red-600',
        spinning: false
      };
    },
    [getFileState]
  );

  return { getFileState, getFileStateDisplay };
}

/**
 * Hook for file editing
 * @returns {Object} File editing state and handlers
 */
export function useFileEditing() {
  const [editingFiles, setEditingFiles] = useState({});

  const handleEditFile = useCallback((fileIndex, field, value) => {
    setEditingFiles((prev) => ({
      ...prev,
      [fileIndex]: { ...prev[fileIndex], [field]: value }
    }));
  }, []);

  const getFileWithEdits = useCallback(
    (file, index) => {
      const edits = editingFiles[index];
      if (!edits) return file;
      const updatedCategory = edits.category || file.analysis?.category;
      return {
        ...file,
        analysis: {
          ...file.analysis,
          suggestedName: edits.suggestedName || file.analysis?.suggestedName,
          category: updatedCategory
        }
      };
    },
    [editingFiles]
  );

  return { editingFiles, setEditingFiles, handleEditFile, getFileWithEdits };
}

/**
 * Hook for file selection
 * @param {number} totalFiles - Total number of files
 * @returns {Object} Selection state and handlers
 */
export function useFileSelection(totalFiles) {
  const [selectedFiles, setSelectedFiles] = useState(new Set());

  const toggleFileSelection = useCallback(
    (index) => {
      const next = new Set(selectedFiles);
      next.has(index) ? next.delete(index) : next.add(index);
      setSelectedFiles(next);
    },
    [selectedFiles]
  );

  const selectAllFiles = useCallback(() => {
    selectedFiles.size === totalFiles
      ? setSelectedFiles(new Set())
      : setSelectedFiles(new Set(Array.from({ length: totalFiles }, (_, i) => i)));
  }, [selectedFiles, totalFiles]);

  const clearSelection = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  return {
    selectedFiles,
    setSelectedFiles,
    toggleFileSelection,
    selectAllFiles,
    clearSelection
  };
}

/**
 * Hook for bulk operations
 * @param {Object} params - Parameters
 * @returns {Object} Bulk operation state and handlers
 */
export function useBulkOperations({
  selectedFiles,
  editingFiles,
  setEditingFiles,
  setSelectedFiles,
  addNotification
}) {
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [bulkCategory, setBulkCategory] = useState('');

  // Debounced bulk category change ref
  const debouncedBulkCategoryChangeRef = useRef(null);

  // Initialize debounced function
  useEffect(() => {
    debouncedBulkCategoryChangeRef.current = debounce((category, selected, edits, notify) => {
      if (!category) return;
      const newEdits = {};
      selected.forEach((i) => {
        const existingEdit = edits[i] || {};
        newEdits[i] = { ...existingEdit, category };
      });
      setEditingFiles((prev) => ({ ...prev, ...newEdits }));
      setBulkEditMode(false);
      setBulkCategory('');
      setSelectedFiles(new Set());
      notify(`Applied category "${category}" to ${selected.size} files`, 'success');
    }, 300);

    return () => {
      if (debouncedBulkCategoryChangeRef.current) {
        debouncedBulkCategoryChangeRef.current.cancel?.();
        debouncedBulkCategoryChangeRef.current = null;
      }
    };
  }, [setEditingFiles, setBulkEditMode, setBulkCategory, setSelectedFiles]);

  const applyBulkCategoryChange = useCallback(() => {
    if (!bulkCategory) return;
    debouncedBulkCategoryChangeRef.current(
      bulkCategory,
      selectedFiles,
      editingFiles,
      addNotification
    );
  }, [bulkCategory, selectedFiles, editingFiles, addNotification]);

  return {
    bulkEditMode,
    setBulkEditMode,
    bulkCategory,
    setBulkCategory,
    applyBulkCategoryChange
  };
}

/**
 * Hook for processed files tracking
 * @param {Array} organizedFiles - Array of organized files
 * @returns {Object} Processed files state and handlers
 */
export function useProcessedFiles(organizedFiles) {
  const [processedFileIds, setProcessedFileIds] = useState(new Set());

  const markFilesAsProcessed = useCallback(
    (filePaths) =>
      setProcessedFileIds((prev) => {
        const next = new Set(prev);
        filePaths.forEach((path) => next.add(path));
        return next;
      }),
    []
  );

  const unmarkFilesAsProcessed = useCallback(
    (filePaths) =>
      setProcessedFileIds((prev) => {
        const next = new Set(prev);
        filePaths.forEach((path) => next.delete(path));
        return next;
      }),
    []
  );

  // Compute unprocessed and processed files
  const getFilteredFiles = useCallback(
    (filesWithAnalysis) => {
      const unprocessedFiles = filesWithAnalysis.filter(
        (file) => !processedFileIds.has(file.path) && file && file.analysis
      );
      const processedFiles = Array.isArray(organizedFiles)
        ? organizedFiles.filter((file) => processedFileIds.has(file?.originalPath || file?.path))
        : [];
      return { unprocessedFiles, processedFiles };
    },
    [processedFileIds, organizedFiles]
  );

  return {
    processedFileIds,
    setProcessedFileIds,
    markFilesAsProcessed,
    unmarkFilesAsProcessed,
    getFilteredFiles
  };
}

export default {
  useFileStateDisplay,
  useFileEditing,
  useFileSelection,
  useBulkOperations,
  useProcessedFiles
};
