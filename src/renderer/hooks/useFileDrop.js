import { useState, useCallback } from 'react';

// Helper to decode file URIs
const decodeFileUri = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/^['"](.*)['"]$/, '$1');
  if (trimmed.toLowerCase().startsWith('file://')) {
    try {
      const url = new URL(trimmed);
      const pathname = decodeURIComponent(url.pathname || '');
      // Handle Windows paths like /C:/path
      if (/^\/[a-zA-Z]:[\\/]/.test(pathname)) {
        return pathname.slice(1);
      }
      return pathname;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
};

const isAbsolutePath = (value) =>
  typeof value === 'string' &&
  (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/'));

const extractName = (pathValue) => {
  if (typeof pathValue !== 'string') return '';
  const parts = pathValue.split(/[\\/]/);
  return parts[parts.length - 1] || pathValue;
};

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
        .map((line) => decodeFileUri(line));

      // Parse plain text (common on Windows for some apps)
      const parsedPlainText =
        textPlainRaw && !textPlainRaw.includes('\n')
          ? [decodeFileUri(textPlainRaw)]
          : textPlainRaw
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => decodeFileUri(line));

      // Combine and deduplicate
      const collectedPaths = [
        ...fileList.map((f) => decodeFileUri(f.path || f.name)),
        ...parsedUris,
        ...parsedPlainText
      ].filter(isAbsolutePath);

      const uniquePaths = Array.from(new Set(collectedPaths));

      if (uniquePaths.length > 0 && onFilesDropped) {
        const fileObjects = uniquePaths.map((pathValue) => ({
          path: pathValue,
          name: extractName(pathValue),
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
