/**
 * File Actions Hook
 *
 * Custom hook for file action operations (open, reveal, delete).
 * Extracted from DiscoverPhase for better maintainability.
 *
 * @module phases/discover/useFileActions
 */

import { useCallback } from 'react';
import { logger } from '../../../shared/logger';

logger.setContext('DiscoverPhase:FileActions');

/**
 * Custom hook for file action operations
 * @param {Object} options - Hook options
 * @param {Function} options.setAnalysisResults - Set analysis results
 * @param {Function} options.setSelectedFiles - Set selected files
 * @param {Function} options.setFileStates - Set file states
 * @param {Function} options.addNotification - Add notification
 * @param {Function} options.showConfirm - Show confirm dialog
 * @param {Object} options.phaseData - Phase data for organized files lookup
 * @returns {Object} File action functions
 */
export function useFileActions({
  setAnalysisResults,
  setSelectedFiles,
  setFileStates,
  addNotification,
  showConfirm,
  phaseData
}) {
  /**
   * Handle file action (open, reveal, delete)
   */
  const handleFileAction = useCallback(
    async (action, filePath) => {
      try {
        switch (action) {
          case 'open':
            await window.electronAPI.files.open(filePath);
            addNotification(
              `Opened: ${filePath.split(/[\\/]/).pop()}`,
              'success',
              2000,
              'file-actions'
            );
            break;

          case 'reveal': {
            // Check if file exists at current path, if not try originalPath
            // This handles cases where files were organized and then undone
            let pathToReveal = filePath;
            try {
              const stats = await window.electronAPI.files.getStats(filePath);
              if (!stats || !stats.exists) {
                // File doesn't exist at current path, check if it's in organizedFiles
                const organizedFile = phaseData?.organizedFiles?.find(
                  (f) => f.path === filePath || f.originalPath === filePath
                );
                if (organizedFile?.originalPath) {
                  const originalStats = await window.electronAPI.files.getStats(
                    organizedFile.originalPath
                  );
                  if (originalStats?.exists) {
                    pathToReveal = organizedFile.originalPath;
                  }
                }
              }
            } catch {
              // If stats check fails, try original path anyway
              const organizedFile = phaseData?.organizedFiles?.find(
                (f) => f.path === filePath || f.originalPath === filePath
              );
              if (organizedFile?.originalPath) {
                pathToReveal = organizedFile.originalPath;
              }
            }
            await window.electronAPI.files.reveal(pathToReveal);
            addNotification(
              `Revealed: ${pathToReveal.split(/[\\/]/).pop()}`,
              'success',
              2000,
              'file-actions'
            );
            break;
          }

          case 'remove': {
            // Remove from queue without deleting from disk
            const fileName = filePath.split(/[\\/]/).pop();
            setAnalysisResults((prev) => prev.filter((f) => f.path !== filePath));
            setSelectedFiles((prev) => prev.filter((f) => f.path !== filePath));
            setFileStates((prev) => {
              if (!prev) return prev;
              const next = { ...prev };
              delete next[filePath];
              return next;
            });
            addNotification(`Removed from queue: ${fileName}`, 'info', 2000, 'file-actions');
            break;
          }

          case 'delete': {
            const fileName = filePath.split(/[\\/]/).pop();
            const confirmDelete = await showConfirm({
              title: 'Delete File',
              message:
                'This action cannot be undone. Are you sure you want to permanently delete this file?',
              confirmText: 'Delete',
              cancelText: 'Cancel',
              variant: 'danger',
              fileName
            });
            if (confirmDelete) {
              const result = await window.electronAPI.files.delete(filePath);
              if (result.success) {
                setAnalysisResults((prev) => prev.filter((f) => f.path !== filePath));
                setSelectedFiles((prev) => prev.filter((f) => f.path !== filePath));
                setFileStates((prev) => {
                  if (!prev) return prev;
                  const next = { ...prev };
                  delete next[filePath];
                  return next;
                });
                addNotification(`Deleted: ${fileName}`, 'success', 3000, 'file-actions');
              } else {
                addNotification(`Failed to delete: ${fileName}`, 'error', 4000, 'file-actions');
              }
            }
            break;
          }

          default:
            addNotification(`Unknown action: ${action}`, 'error', 4000, 'file-actions');
        }
      } catch (error) {
        addNotification(`Action failed: ${error.message}`, 'error', 4000, 'file-actions');
      }
    },
    [addNotification, setSelectedFiles, setAnalysisResults, setFileStates, showConfirm, phaseData]
  );

  return {
    handleFileAction
  };
}

export default useFileActions;
