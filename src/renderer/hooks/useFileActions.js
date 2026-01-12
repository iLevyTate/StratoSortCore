import { useCallback } from 'react';
import { logger } from '../../shared/logger';

/**
 * Hook for common file actions (open, reveal, copy path)
 * Provides consistent error handling across components
 *
 * @param {Function} [onError] - Optional error callback (e.g. setError state)
 * @returns {Object} Object containing openFile, revealFile, copyPath functions
 */
export function useFileActions(onError) {
  const openFile = useCallback(
    async (filePath) => {
      if (!filePath) {
        logger.warn('[FileActions] Cannot open file: path is empty');
        onError?.('Cannot open file: no path available');
        return;
      }
      try {
        const result = await window.electronAPI?.files?.open?.(filePath);
        if (result && !result.success) {
          const errorMsg =
            result.errorCode === 'FILE_NOT_FOUND'
              ? 'File not found. It may have been moved or deleted.'
              : result.error || 'Failed to open file';
          onError?.(errorMsg);
          logger.warn('[FileActions] Open file failed:', result.error);
        }
      } catch (e) {
        logger.error('[FileActions] Failed to open file', e);
        onError?.('Failed to open file');
      }
    },
    [onError]
  );

  const revealFile = useCallback(
    async (filePath) => {
      if (!filePath) {
        logger.warn('[FileActions] Cannot reveal file: path is empty');
        onError?.('Cannot reveal file: no path available');
        return;
      }
      try {
        const result = await window.electronAPI?.files?.reveal?.(filePath);
        if (result && !result.success) {
          const errorMsg =
            result.errorCode === 'FILE_NOT_FOUND'
              ? 'File not found. It may have been moved or deleted.'
              : result.error || 'Failed to reveal file';
          onError?.(errorMsg);
          logger.warn('[FileActions] Reveal file failed:', result.error);
        }
      } catch (e) {
        logger.error('[FileActions] Failed to reveal file', e);
        onError?.('Failed to reveal file location');
      }
    },
    [onError]
  );

  const copyPath = useCallback(
    async (filePath) => {
      if (!filePath) {
        logger.warn('[FileActions] Cannot copy path: path is empty');
        onError?.('Cannot copy path: no path available');
        return;
      }
      try {
        await navigator.clipboard.writeText(filePath);
      } catch (e) {
        logger.warn('[FileActions] Clipboard write failed', e?.message || e);
        onError?.('Failed to copy path to clipboard');
      }
    },
    [onError]
  );

  return { openFile, revealFile, copyPath };
}
