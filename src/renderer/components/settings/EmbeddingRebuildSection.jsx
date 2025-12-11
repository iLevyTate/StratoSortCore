import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import Button from '../ui/Button';

/**
 * Embedding rebuild section for folder and file embeddings
 */
function EmbeddingRebuildSection({ addNotification }) {
  const [isRebuildingFolders, setIsRebuildingFolders] = useState(false);
  const [isRebuildingFiles, setIsRebuildingFiles] = useState(false);

  const handleRebuildFolders = useCallback(async () => {
    try {
      setIsRebuildingFolders(true);
      const res = await window.electronAPI.embeddings.rebuildFolders();
      addNotification(
        res?.success
          ? `Rebuilt ${res.folders || 0} folder embeddings`
          : `Failed: ${res?.error || 'Unknown error'}`,
        res?.success ? 'success' : 'error'
      );
    } catch (e) {
      addNotification(`Failed: ${e.message}`, 'error');
    } finally {
      setIsRebuildingFolders(false);
    }
  }, [addNotification]);

  const handleRebuildFiles = useCallback(async () => {
    try {
      setIsRebuildingFiles(true);
      const res = await window.electronAPI.embeddings.rebuildFiles();
      addNotification(
        res?.success
          ? `Rebuilt ${res.files || 0} file embeddings`
          : `Failed: ${res?.error || 'Unknown error'}`,
        res?.success ? 'success' : 'error'
      );
    } catch (e) {
      addNotification(`Failed: ${e.message}`, 'error');
    } finally {
      setIsRebuildingFiles(false);
    }
  }, [addNotification]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-system-gray-700 mb-2">
          Smart Folder Embeddings
        </label>
        <p className="text-xs text-system-gray-500 mb-4">
          Rebuild embeddings for all smart folders to improve semantic matching after you edit
          folder names or descriptions.
        </p>
        <div className="flex gap-3">
          <Button
            onClick={handleRebuildFolders}
            variant="secondary"
            disabled={isRebuildingFolders}
            type="button"
            title="Rebuild folder embeddings"
          >
            {isRebuildingFolders ? 'Rebuilding…' : 'Rebuild Folder Embeddings'}
          </Button>
          <Button
            onClick={handleRebuildFiles}
            variant="secondary"
            disabled={isRebuildingFiles}
            type="button"
            title="Rebuild file embeddings from analysis history"
          >
            {isRebuildingFiles ? 'Rebuilding…' : 'Rebuild File Embeddings'}
          </Button>
        </div>
      </div>
    </div>
  );
}

EmbeddingRebuildSection.propTypes = {
  addNotification: PropTypes.func.isRequired
};

export default EmbeddingRebuildSection;
