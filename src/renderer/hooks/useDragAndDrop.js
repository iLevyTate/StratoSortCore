import { useCallback, useState } from 'react';

const decodeFileUri = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/^['"](.*)['"]$/, '$1');

  if (trimmed.toLowerCase().startsWith('file://')) {
    try {
      const url = new URL(trimmed);
      const pathname = decodeURIComponent(url.pathname || '');
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

// NOTE: This feature is currently disabled/inactive in the UI but preserved for future use.
// See: https://github.com/stratosort/stratosort/issues/123 (if applicable)
export function useDragAndDrop(onFilesDropped) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      // FIX: Add null check for dataTransfer to prevent crashes
      if (!e.dataTransfer?.files) {
        return;
      }

      const fileList = Array.from(e.dataTransfer.files || []);
      const uriListRaw = e.dataTransfer.getData('text/uri-list') || '';
      const textPlainRaw = e.dataTransfer.getData('text/plain') || '';

      const parsedUris = uriListRaw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => decodeFileUri(line));

      // Some Windows drags provide the absolute path as plain text
      const parsedPlainText =
        textPlainRaw && !textPlainRaw.includes('\n')
          ? [decodeFileUri(textPlainRaw)]
          : textPlainRaw
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => decodeFileUri(line));

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
          type: 'file'
        }));
        onFilesDropped(fileObjects);
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
