import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { FolderInput, FileText } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Text } from '../ui/Typography';
import FileIcon from '../ui/FileIcon';
import { useFileActions } from '../../hooks/useFileActions';
import { safeBasename } from '../../utils/pathUtils';
import { createLogger } from '../../../shared/logger';

const logger = createLogger('TriageModal');

/**
 * TriageModal
 *
 * A modal for reviewing and organizing a list of files (e.g. scattered files).
 * Allows batch moving to a selected folder.
 */
export default function TriageModal({
  isOpen,
  onClose,
  files = [], // Array of { path, name, ... }
  title = 'Review Files',
  description = 'Review and organize these files.',
  onMoveFiles // (files, destination) => Promise<void>
}) {
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [destinationPath, setDestinationPath] = useState('');
  const [isMoving, setIsMoving] = useState(false);
  const { openFile, revealFile } = useFileActions();

  // Initialize selection when files change
  React.useEffect(() => {
    if (isOpen && files.length > 0) {
      setSelectedFiles(new Set(files.map((f) => f.path || f.id)));
    }
  }, [isOpen, files]);

  const handleToggleFile = (path) => {
    const next = new Set(selectedFiles);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    setSelectedFiles(next);
  };

  const handleToggleAll = () => {
    if (selectedFiles.size === files.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(files.map((f) => f.path || f.id)));
    }
  };

  const handleBrowse = async () => {
    try {
      if (!window.electronAPI?.files?.selectDirectory) return;
      const res = await window.electronAPI.files.selectDirectory();
      if (res?.success && res.path) {
        setDestinationPath(res.path);
      }
    } catch {
      // Ignore
    }
  };

  const handleMove = async () => {
    if (!destinationPath || selectedFiles.size === 0) return;
    setIsMoving(true);
    try {
      const filesToMove = files.filter((f) => selectedFiles.has(f.path || f.id));
      await onMoveFiles(filesToMove, destinationPath);
      onClose();
    } catch (error) {
      logger.error('Failed to move files', {
        error: error?.message,
        stack: error?.stack
      });
    } finally {
      setIsMoving(false);
    }
  };

  const selectedCount = selectedFiles.size;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={description}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isMoving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleMove}
            disabled={isMoving || !destinationPath || selectedCount === 0}
            isLoading={isMoving}
            leftIcon={<FolderInput className="w-4 h-4" />}
          >
            Move {selectedCount} {selectedCount === 1 ? 'File' : 'Files'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col h-[60vh]">
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4 pb-4 border-b border-system-gray-100">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={files.length > 0 && selectedFiles.size === files.length}
              onChange={handleToggleAll}
              className="rounded border-system-gray-300 text-stratosort-blue focus:ring-stratosort-blue/20"
            />
            <Text variant="small" className="font-medium text-system-gray-700">
              Select All ({selectedCount}/{files.length})
            </Text>
          </div>
          <div className="flex items-center gap-2">
            <Text variant="small" className="text-system-gray-500">
              Move to:
            </Text>
            <div className="flex items-center gap-2">
              <div className="px-3 py-1.5 bg-system-gray-50 border border-system-gray-200 rounded text-sm text-system-gray-700 min-w-[200px] max-w-[300px] truncate">
                {destinationPath ? safeBasename(destinationPath) : 'Select folder...'}
              </div>
              <Button size="sm" variant="secondary" onClick={handleBrowse}>
                Browse
              </Button>
            </div>
          </div>
        </div>

        {/* File List */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-1 pr-2">
          {files.map((file) => {
            const path = file.path || file.id;
            const isSelected = selectedFiles.has(path);
            return (
              <div
                key={path}
                className={`
                  group flex items-center gap-3 p-2 rounded-lg border transition-colors cursor-pointer
                  ${
                    isSelected
                      ? 'bg-stratosort-blue/5 border-stratosort-blue/20'
                      : 'bg-white border-transparent hover:bg-system-gray-50'
                  }
                `}
                onClick={() => handleToggleFile(path)}
              >
                <div onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggleFile(path)}
                    className="rounded border-system-gray-300 text-stratosort-blue focus:ring-stratosort-blue/20"
                  />
                </div>
                <FileIcon fileName={file.name || safeBasename(path)} className="w-8 h-8 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-system-gray-900 truncate">
                    {file.name || safeBasename(path)}
                  </div>
                  <div className="text-xs text-system-gray-500 truncate">{path}</div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      openFile(path);
                    }}
                  >
                    Open
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      revealFile(path);
                    }}
                  >
                    Reveal
                  </Button>
                </div>
              </div>
            );
          })}
          {files.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-system-gray-400">
              <FileText className="w-12 h-12 mb-2 opacity-50" />
              <Text>No files to review</Text>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

TriageModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  files: PropTypes.array,
  title: PropTypes.string,
  description: PropTypes.string,
  onMoveFiles: PropTypes.func.isRequired
};
