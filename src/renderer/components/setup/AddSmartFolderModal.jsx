import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { Button, Input, Textarea } from '../ui';
import { logger } from '../../../shared/logger';

logger.setContext('AddSmartFolderModal');

/**
 * Modal for adding a new smart folder
 */
function AddSmartFolderModal({
  isOpen,
  onClose,
  onAdd,
  defaultLocation,
  existingFolders = [],
  showNotification
}) {
  const [folderName, setFolderName] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [description, setDescription] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const resetForm = useCallback(() => {
    setFolderName('');
    setFolderPath('');
    setDescription('');
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleBrowse = async () => {
    try {
      const res = await window.electronAPI.files.selectDirectory();
      if (res?.success && res.path) {
        setFolderPath(res.path);
      }
    } catch (error) {
      logger.error('Failed to browse folder', { error: error.message });
      showNotification?.('Failed to browse folder', 'error');
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();

    if (!folderName.trim()) {
      showNotification?.('Please enter a folder name', 'warning');
      return;
    }

    // Validate folder name
    // eslint-disable-next-line no-control-regex
    const illegalChars = /[<>:"|?*\x00-\x1f]/g;
    if (illegalChars.test(folderName)) {
      showNotification?.(
        'Folder name contains invalid characters. Please avoid: < > : " | ? *',
        'error'
      );
      return;
    }

    // Build target path
    let targetPath = folderPath.trim() || `${defaultLocation}/${folderName.trim()}`;

    // Make absolute if needed
    if (!/^[A-Za-z]:[\\/]/.test(targetPath) && !targetPath.startsWith('/')) {
      targetPath = `${defaultLocation}/${targetPath}`;
    }

    // Check for duplicates
    const existing = existingFolders.find(
      (f) =>
        f.name.toLowerCase() === folderName.trim().toLowerCase() ||
        (f.path && f.path.toLowerCase() === targetPath.toLowerCase())
    );
    if (existing) {
      showNotification?.(`A smart folder with this name or path already exists`, 'warning');
      return;
    }

    setIsAdding(true);
    try {
      const newFolder = {
        name: folderName.trim(),
        path: targetPath,
        description: description.trim() || `Smart folder for ${folderName.trim()}`,
        isDefault: false
      };

      const success = await onAdd(newFolder);
      if (success) {
        handleClose();
      }
    } finally {
      setIsAdding(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-folder-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-system-gray-100">
          <h2 id="add-folder-title" className="text-lg font-semibold text-system-gray-900">
            Add Smart Folder
          </h2>
          <button
            onClick={handleClose}
            className="p-2 -m-2 text-system-gray-400 hover:text-system-gray-600 transition-colors rounded-lg hover:bg-system-gray-100"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Folder Name */}
          <div>
            <label
              htmlFor="folder-name"
              className="block text-sm font-medium text-system-gray-700 mb-1.5"
            >
              Folder Name
            </label>
            <Input
              id="folder-name"
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="e.g., Documents, Photos, Projects"
              className="w-full"
              autoFocus
            />
            <p className="text-xs text-system-gray-500 mt-1">
              Avoid special characters: &lt; &gt; : &quot; | ? *
            </p>
          </div>

          {/* Target Path */}
          <div>
            <label
              htmlFor="folder-path"
              className="block text-sm font-medium text-system-gray-700 mb-1.5"
            >
              Target Path
              <span className="text-system-gray-400 font-normal ml-1">(optional)</span>
            </label>
            <div className="flex gap-2">
              <Input
                id="folder-path"
                type="text"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                placeholder={`${defaultLocation}/${folderName || 'FolderName'}`}
                className="flex-1"
              />
              <Button
                type="button"
                onClick={handleBrowse}
                variant="secondary"
                title="Browse for folder"
                className="px-3 shrink-0"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
              </Button>
            </div>
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="folder-description"
              className="block text-sm font-medium text-system-gray-700 mb-1.5"
            >
              Description
              <span className="text-stratosort-blue font-medium ml-1">(AI uses this)</span>
            </label>
            <Textarea
              id="folder-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what types of files should go here, e.g., 'Work documents and contracts' or 'Family photos from vacations'"
              className="w-full"
              rows={3}
            />
            <p className="text-xs text-system-gray-500 mt-1">
              More specific descriptions help the AI make better decisions
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              onClick={handleClose}
              variant="secondary"
              className="flex-1"
              disabled={isAdding}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              className="flex-1"
              disabled={!folderName.trim() || isAdding}
            >
              {isAdding ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Adding...
                </>
              ) : (
                'Add Folder'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

AddSmartFolderModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onAdd: PropTypes.func.isRequired,
  defaultLocation: PropTypes.string.isRequired,
  existingFolders: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      name: PropTypes.string,
      path: PropTypes.string
    })
  ),
  showNotification: PropTypes.func
};

export default AddSmartFolderModal;
