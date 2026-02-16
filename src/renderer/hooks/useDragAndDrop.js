import { useCallback, useState } from 'react';
import { normalizeFileUri, extractFileName } from '../utils/pathNormalization';
import { extractDroppedFiles, isFileDragEvent } from '../utils/dragAndDrop';

// Drag-and-drop is active in the Discover phase. Keep this hook shared.
export function useDragAndDrop(onFilesDropped) {
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

      // FIX: Add null check for dataTransfer to prevent crashes
      if (!e.dataTransfer) {
        return;
      }

      const {
        paths,
        unresolvedNames = [],
        fileList,
        itemFiles
      } = extractDroppedFiles(e.dataTransfer);
      const uniquePaths = Array.from(new Set([...paths, ...unresolvedNames]));

      if (uniquePaths.length > 0 && onFilesDropped) {
        const fileObjects = uniquePaths.map((pathValue) => ({
          path: pathValue,
          name: extractFileName(pathValue),
          type: 'file'
        }));
        onFilesDropped(fileObjects);
        return;
      }

      // Fallback: pass through file entries so downstream can surface warnings
      const fallbackFiles = [...fileList, ...itemFiles]
        .map((file) => {
          const pathValue = normalizeFileUri(file?.path || file?.name || '');
          return pathValue
            ? {
                path: pathValue,
                name: file?.name || extractFileName(pathValue),
                type: 'file'
              }
            : null;
        })
        .filter(Boolean);

      if (fallbackFiles.length > 0 && onFilesDropped) {
        onFilesDropped(fallbackFiles);
      }
    },
    [onFilesDropped]
  );

  return {
    isDragging,
    dragProps: {
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleDrop
    }
  };
}
