import { useState, useCallback } from 'react';
import { normalizeFileUri, isAbsolutePath, extractFileName } from '../utils/pathNormalization';

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
    if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/uri-list')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set false if leaving the drop zone entirely (not entering child)
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      // FIX: Use optional chaining consistently for defensive null checks
      if (!e.dataTransfer) return;

      const fileList = Array.from(e.dataTransfer?.files || []);
      const uriListRaw = e.dataTransfer?.getData?.('text/uri-list') || '';
      const textPlainRaw = e.dataTransfer?.getData?.('text/plain') || '';

      // Parse URIs (common on Linux/GTK)
      const parsedUris = uriListRaw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => normalizeFileUri(line));

      // Parse plain text (common on Windows for some apps)
      const parsedPlainText =
        textPlainRaw && !textPlainRaw.includes('\n')
          ? [normalizeFileUri(textPlainRaw)]
          : textPlainRaw
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => normalizeFileUri(line));

      // Combine and deduplicate
      const collectedPaths = [
        ...fileList.map((f) => normalizeFileUri(f.path || f.name)),
        ...parsedUris,
        ...parsedPlainText
      ].filter((pathValue) => isAbsolutePath(pathValue, { collapseWhitespace: false }));

      const uniquePaths = Array.from(new Set(collectedPaths));

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
