import { useCallback, useState } from 'react';

// Simple absolute-path check (Windows drive/UNC, extended, or POSIX root)
const isAbsolutePath = (p) =>
  typeof p === 'string' &&
  (/^[A-Za-z]:[\\/]/.test(p) || // C:\path or C:/path
    p.startsWith('\\\\') || // UNC \\server\share or \\?\C:\path
    p.startsWith('//') || // UNC with forward slashes
    p.startsWith('/')); // POSIX

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

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0 && onFilesDropped) {
        const fileObjects = files
          .map((file) => ({
            path: file.path || file.name,
            name: file.name,
            type: 'file',
            size: file.size,
          }))
          // Only keep absolute paths; drop names without a real path (prevents security errors)
          .filter((f) => isAbsolutePath(f.path));

        // If filtering removed everything, fall back to the raw list so UI can notify
        onFilesDropped(fileObjects.length > 0 ? fileObjects : files);
      }
    },
    [onFilesDropped],
  );

  return {
    isDragging,
    dragProps: {
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleDrop,
    },
  };
}
