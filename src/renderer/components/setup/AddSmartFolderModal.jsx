import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { Sparkles, X } from 'lucide-react';
import { Button, Input, Textarea, IconButton } from '../ui';
import { logger } from '../../../shared/logger';

logger.setContext('AddSmartFolderModal');

// Helper to get the correct path separator based on the path format
const getPathSeparator = (path) => (path && path.includes('\\') ? '\\' : '/');

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
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);

  const resetForm = useCallback(() => {
    setFolderName('');
    setFolderPath('');
    setDescription('');
    setIsGeneratingDescription(false);
  }, []);

  // FIX: AI generate description feature (Issue 2.5)
  const handleGenerateDescription = async () => {
    if (!folderName.trim()) {
      showNotification?.('Please enter a folder name first', 'warning');
      return;
    }
    setIsGeneratingDescription(true);
    try {
      const result = await window.electronAPI?.smartFolders?.generateDescription?.(
        folderName.trim()
      );
      if (result?.success && result.description) {
        setDescription(result.description);
        showNotification?.('Description generated', 'success');
      } else {
        showNotification?.(result?.error || 'Failed to generate description', 'error');
      }
    } catch (err) {
      logger.error('Failed to generate description', { error: err.message });
      showNotification?.('Failed to generate description', 'error');
    } finally {
      setIsGeneratingDescription(false);
    }
  };

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

    // Helper to check if path is absolute
    const isAbsolutePath = (p) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/');

    // Build target path - use browsed path if provided, otherwise construct from defaultLocation
    let targetPath = folderPath.trim();
    if (!targetPath) {
      // If defaultLocation is not absolute, try to get the actual documents path
      let resolvedDefaultLocation = defaultLocation;
      if (!isAbsolutePath(defaultLocation)) {
        try {
          const documentsPath = await window.electronAPI?.files?.getDocumentsPath?.();
          if (documentsPath) {
            // Normalize the result (might be string or {path: string})
            resolvedDefaultLocation =
              typeof documentsPath === 'string'
                ? documentsPath
                : documentsPath.path || documentsPath;
          }
        } catch (err) {
          logger.warn('Failed to fetch documents path', { error: err.message });
        }
      }

      // If still not absolute, show error
      if (!isAbsolutePath(resolvedDefaultLocation)) {
        showNotification?.(
          'Unable to determine folder location. Please browse to select a folder.',
          'error'
        );
        return;
      }

      // Use path.join equivalent with correct separator for the platform
      const sep = getPathSeparator(resolvedDefaultLocation);
      targetPath = `${resolvedDefaultLocation}${sep}${folderName.trim()}`;
    }

    // Ensure path is absolute
    if (!isAbsolutePath(targetPath)) {
      showNotification?.(
        'Unable to determine folder location. Please browse to select a folder.',
        'error'
      );
      return;
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

  // Use portal to render to body, preventing backdrop-blur visual glitches
  const portalTarget = typeof document !== 'undefined' ? document.body : null;

  if (!isOpen || !portalTarget) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-folder-title"
    >
      {/* Unified backdrop: blur + overlay in single layer to prevent stacking artifacts */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-modal-backdrop"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-modal-enter">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-system-gray-100">
          <h2 id="add-folder-title" className="heading-secondary">
            Add Smart Folder
          </h2>
          <IconButton
            onClick={handleClose}
            variant="ghost"
            size="sm"
            aria-label="Close"
            icon={<X className="w-5 h-5" />}
          />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
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
                placeholder={`${defaultLocation}${getPathSeparator(defaultLocation)}${folderName || 'FolderName'}`}
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
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="folder-description"
                className="block text-sm font-medium text-system-gray-700"
              >
                Description
                <span className="text-stratosort-blue font-medium ml-1">(AI uses this)</span>
              </label>
              {/* FIX: AI Generate Description button (Issue 2.5) */}
              <button
                type="button"
                onClick={handleGenerateDescription}
                disabled={isGeneratingDescription || !folderName.trim()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-stratosort-blue bg-stratosort-blue/10 hover:bg-stratosort-blue/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  folderName.trim() ? 'Generate description with AI' : 'Enter a folder name first'
                }
              >
                {isGeneratingDescription ? (
                  <>
                    <span className="inline-block w-3 h-3 border-2 border-stratosort-blue border-t-transparent rounded-full animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3" />
                    Generate with AI
                  </>
                )}
              </button>
            </div>
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
          <div className="flex gap-4 pt-4">
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
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Adding...</span>
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

  return createPortal(modalContent, portalTarget);
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
