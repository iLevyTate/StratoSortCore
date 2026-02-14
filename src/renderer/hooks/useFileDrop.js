import { useState, useCallback } from 'react';
import { isAbsolutePath, extractFileName } from '../utils/pathNormalization';
import { extractDroppedFiles, isFileDragEvent } from '../utils/dragAndDrop';

/**
 * useFileDrop - Standardized hook for handling file drag and drop operations
 *
 * @param {Function} onFilesDropped - Callback receiving array of file objects { path, name, type }
 * @returns {Object} { isDragging, dropProps }
 */
export function useFileDrop(onFilesDropped) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only activate for file drags
    if (isFileDragEvent(e)) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set false if leaving the drop zone entirely (not entering child)
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isFileDragEvent(e)) return;
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
    setIsDragging(true);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      // FIX: Use optional chaining consistently for defensive null checks
      if (!e.dataTransfer) return;

      const { paths } = extractDroppedFiles(e.dataTransfer, {
        getFilePath: window.electronAPI?.files?.getPathForFile
      });

      const uniquePaths = paths.filter((pathValue) =>
        isAbsolutePath(pathValue, { collapseWhitespace: false })
      );

      if (uniquePaths.length > 0 && onFilesDropped) {
        const fileObjects = uniquePaths.map((pathValue) => ({
          path: pathValue,
          name: extractFileName(pathValue),
          type: 'file' // Default type, caller can refine
        }));
        onFilesDropped(fileObjects);
      }
    },
    [onFilesDropped]
  );

  return {
    isDragging,
    dropProps: {
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleDrop
    }
  };
}
