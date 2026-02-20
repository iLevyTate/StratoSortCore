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

      if (!e.dataTransfer) return;

      const { paths, unresolvedNames = [] } = extractDroppedFiles(e.dataTransfer);
      const candidatePaths = [...paths, ...unresolvedNames];

      const uniquePaths = candidatePaths.filter((pathValue) =>
        isAbsolutePath(pathValue, { collapseWhitespace: false })
      );

      const fallbackNames = candidatePaths.filter(
        (pathValue) =>
          typeof pathValue === 'string' && pathValue.length > 0 && !/[\\/]/.test(pathValue)
      );
      const normalizedUnique = Array.from(new Set([...uniquePaths, ...fallbackNames]));

      if (normalizedUnique.length > 0 && onFilesDropped) {
        const fileObjects = normalizedUnique.map((pathValue) => ({
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
