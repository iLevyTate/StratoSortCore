/**
 * useFileEditing Hook
 *
 * File editing, selection, and state display logic.
 *
 * @module organize/useFileEditing
 */

import { useState, useCallback, useEffect, useRef } from 'react';
const { debounce } = require('../../utils/performance');

/**
 * Hook for file state display
 * @param {Object} fileStates - File states object
 * @returns {Object} File state helpers
 */
export function useFileStateDisplay(fileStates) {
  const getFileState = useCallback(
    (filePath) => fileStates[filePath]?.state || 'pending',
    [fileStates],
  );

  const getFileStateDisplay = useCallback(
    (filePath, hasAnalysis, isProcessed = false) => {
      if (isProcessed)
        return {
          icon: '✅',
          label: 'Organized',
          color: 'text-green-600',
          spinning: false,
        };
      const state = getFileState(filePath);
      if (state === 'analyzing')
        return {
          icon: '🔄',
          label: 'Analyzing...',
          color: 'text-blue-600',
          spinning: true,
        };
      if (state === 'error')
        return {
          icon: '❌',
          label: 'Error',
          color: 'text-red-600',
          spinning: false,
        };
      if (hasAnalysis && state === 'ready')
        return {
          icon: '📂',
          label: 'Ready',
          color: 'text-stratosort-blue',
          spinning: false,
        };
      if (state === 'pending')
        return {
          icon: '⏳',
          label: 'Pending',
          color: 'text-yellow-600',
          spinning: false,
        };
      return {
        icon: '❌',
        label: 'Failed',
        color: 'text-red-600',
        spinning: false,
      };
    },
    [getFileState],
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
      [fileIndex]: { ...prev[fileIndex], [field]: value },
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
          category: updatedCategory,
        },
      };
    },
    [editingFiles],
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
    [selectedFiles],
  );

  const selectAllFiles = useCallback(() => {
    selectedFiles.size === totalFiles
      ? setSelectedFiles(new Set())
      : setSelectedFiles(
          new Set(Array.from({ length: totalFiles }, (_, i) => i)),
        );
  }, [selectedFiles, totalFiles]);

  const clearSelection = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  return {
    selectedFiles,
    setSelectedFiles,
    toggleFileSelection,
    selectAllFiles,
    clearSelection,
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
  addNotification,
}) {
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [bulkCategory, setBulkCategory] = useState('');

  // Debounced bulk category change ref
  const debouncedBulkCategoryChangeRef = useRef(null);

  // Initialize debounced function
  useEffect(() => {
    debouncedBulkCategoryChangeRef.current = debounce(
      (category, selected, edits, notify) => {
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
        notify(
          `Applied category "${category}" to ${selected.size} files`,
          'success',
        );
      },
      300,
    );

    return () => {
      if (debouncedBulkCategoryChangeRef.current) {
        debouncedBulkCategoryChangeRef.current.cancel?.();
        debouncedBulkCategoryChangeRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Cleanup only - state setters are stable from useState

  const applyBulkCategoryChange = useCallback(() => {
    if (!bulkCategory) return;
    debouncedBulkCategoryChangeRef.current(
      bulkCategory,
      selectedFiles,
      editingFiles,
      addNotification,
    );
  }, [bulkCategory, selectedFiles, editingFiles, addNotification]);

  return {
    bulkEditMode,
    setBulkEditMode,
    bulkCategory,
    setBulkCategory,
    applyBulkCategoryChange,
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
    [],
  );

  const unmarkFilesAsProcessed = useCallback(
    (filePaths) =>
      setProcessedFileIds((prev) => {
        const next = new Set(prev);
        filePaths.forEach((path) => next.delete(path));
        return next;
      }),
    [],
  );

  // Compute unprocessed and processed files
  const getFilteredFiles = useCallback(
    (filesWithAnalysis) => {
      const unprocessedFiles = filesWithAnalysis.filter(
        (file) => !processedFileIds.has(file.path) && file && file.analysis,
      );
      const processedFiles = Array.isArray(organizedFiles)
        ? organizedFiles.filter((file) =>
            processedFileIds.has(file?.originalPath || file?.path),
          )
        : [];
      return { unprocessedFiles, processedFiles };
    },
    [processedFileIds, organizedFiles],
  );

  return {
    processedFileIds,
    setProcessedFileIds,
    markFilesAsProcessed,
    unmarkFilesAsProcessed,
    getFilteredFiles,
  };
}

export default {
  useFileStateDisplay,
  useFileEditing,
  useFileSelection,
  useBulkOperations,
  useProcessedFiles,
};
