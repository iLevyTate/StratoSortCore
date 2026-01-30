import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useSelector } from 'react-redux';
import { Sparkles, FolderOpen } from 'lucide-react';
import { Button, Input, Textarea } from '../ui';
import { Text } from '../ui/Typography';
import Modal from '../ui/Modal';
import { Inline, Stack } from '../layout';
import { logger } from '../../../shared/logger';
import { filesIpc, smartFoldersIpc } from '../../services/ipc';

logger.setContext('AddSmartFolderModal');

const getPathSeparator = (path) => (path && path.includes('\\') ? '\\' : '/');

function AddSmartFolderModal({
  isOpen,
  onClose,
  onAdd,
  defaultLocation,
  existingFolders = [],
  showNotification
}) {
  const redactPaths = useSelector((state) => Boolean(state?.system?.redactPaths));
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

  const handleGenerateDescription = async () => {
    if (!folderName.trim()) {
      showNotification?.('Please enter a folder name first', 'warning');
      return;
    }
    setIsGeneratingDescription(true);
    try {
      const result = await smartFoldersIpc.generateDescription(folderName.trim());
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
      const res = await filesIpc.selectDirectory();
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

    // eslint-disable-next-line no-control-regex
    const illegalChars = /[<>:"|?*\x00-\x1f]/g;
    if (illegalChars.test(folderName)) {
      showNotification?.(
        'Folder name contains invalid characters. Please avoid: < > : " | ? *',
        'error'
      );
      return;
    }

    const isAbsolutePath = (p) =>
      /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || /^[\\/]{2}[^\\/]/.test(p);

    let targetPath = folderPath.trim();
    if (!targetPath) {
      let resolvedDefaultLocation = defaultLocation;
      if (!isAbsolutePath(defaultLocation)) {
        try {
          const documentsPath = await filesIpc.getDocumentsPath();
          if (documentsPath) {
            resolvedDefaultLocation =
              typeof documentsPath === 'string'
                ? documentsPath
                : documentsPath.path || documentsPath;
          }
        } catch (err) {
          logger.warn('Failed to fetch documents path', { error: err.message });
        }
      }

      if (!isAbsolutePath(resolvedDefaultLocation)) {
        showNotification?.(
          'Unable to determine folder location. Please browse to select a folder.',
          'error'
        );
        return;
      }

      const sep = getPathSeparator(resolvedDefaultLocation);
      targetPath = `${resolvedDefaultLocation}${sep}${folderName.trim()}`;
    }

    if (!isAbsolutePath(targetPath)) {
      showNotification?.(
        'Unable to determine folder location. Please browse to select a folder.',
        'error'
      );
      return;
    }

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

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Smart Folder"
      size="md"
      footer={
        <Inline className="justify-end" gap="compact" wrap={false}>
          <Button
            type="button"
            onClick={handleClose}
            variant="secondary"
            size="sm"
            disabled={isAdding}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            variant="primary"
            size="sm"
            disabled={!folderName.trim() || isAdding}
          >
            {isAdding ? 'Adding...' : 'Add Folder'}
          </Button>
        </Inline>
      }
    >
      <Stack gap="relaxed">
        <Input
          label="Folder Name"
          type="text"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          placeholder="e.g., Documents, Photos, Projects"
          className="w-full"
          autoFocus
          required
        />

        <div className="flex flex-col gap-1.5">
          <Text as="label" variant="small" className="block font-medium text-system-gray-700">
            Target Path <span className="text-system-gray-400 font-normal ml-1">(optional)</span>
          </Text>
          <div className="flex gap-2">
            <Input
              type={redactPaths ? 'password' : 'text'}
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder={
                redactPaths
                  ? `…${getPathSeparator(defaultLocation)}${folderName || 'FolderName'}`
                  : `${defaultLocation}${getPathSeparator(defaultLocation)}${folderName || 'FolderName'}`
              }
              className="flex-1"
            />
            <Button
              type="button"
              onClick={handleBrowse}
              variant="secondary"
              size="sm"
              title="Browse for folder"
              className="shrink-0"
            >
              <FolderOpen className="w-4 h-4" />
              Browse
            </Button>
          </div>
        </div>

        <div className="relative">
          <div className="flex items-center justify-between mb-1.5">
            <Text as="label" variant="small" className="block font-medium text-system-gray-700">
              Description{' '}
              <span className="text-stratosort-blue font-medium ml-1">(AI uses this)</span>
            </Text>
            <Button
              type="button"
              onClick={handleGenerateDescription}
              disabled={isGeneratingDescription || !folderName.trim()}
              isLoading={isGeneratingDescription}
              variant="subtle"
              size="sm"
              leftIcon={!isGeneratingDescription ? <Sparkles className="w-4 h-4" /> : null}
              className="text-stratosort-blue bg-stratosort-blue/10 border-stratosort-blue/20 hover:bg-stratosort-blue/20"
            >
              {isGeneratingDescription ? 'Generating...' : 'Generate with AI'}
            </Button>
          </div>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what types of files should go here..."
            className="w-full"
            rows={3}
          />
        </div>
      </Stack>
    </Modal>
  );
}

AddSmartFolderModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onAdd: PropTypes.func.isRequired,
  defaultLocation: PropTypes.string.isRequired,
  existingFolders: PropTypes.array,
  showNotification: PropTypes.func
};

export default AddSmartFolderModal;
