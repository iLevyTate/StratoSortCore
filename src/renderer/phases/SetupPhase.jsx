import React, { useEffect, useState } from 'react';
import { PHASES } from '../../shared/constants';
import { logger } from '../../shared/logger';
import { usePhase } from '../contexts/PhaseContext';
import { useNotification } from '../contexts/NotificationContext';
import { useConfirmDialog } from '../hooks';
import { Collapsible, Button, Input, Textarea } from '../components/ui';
import { SmartFolderSkeleton } from '../components/LoadingSkeleton';
import { SmartFolderItem } from '../components/setup';

// Set logger context for this component
logger.setContext('SetupPhase');

function SetupPhase() {
  const { actions } = usePhase();
  const { showConfirm, ConfirmDialog } = useConfirmDialog();
  const { showSuccess, showError, showWarning, showInfo, addNotification } =
    useNotification();

  const [smartFolders, setSmartFolders] = useState([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderPath, setNewFolderPath] = useState('');
  const [newFolderDescription, setNewFolderDescription] = useState('');
  const [editingFolder, setEditingFolder] = useState(null);
  const [defaultLocation, setDefaultLocation] = useState('Documents');
  const [isLoading, setIsLoading] = useState(true);
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeletingFolder, setIsDeletingFolder] = useState(null);

  useEffect(() => {
    const initializeSetup = async () => {
      setIsLoading(true);
      try {
        await Promise.all([loadSmartFolders(), loadDefaultLocation()]);
      } catch (error) {
        logger.error('Failed to initialize setup', {
          error: error.message,
          stack: error.stack,
        });
        showError('Failed to load setup data');
      } finally {
        setIsLoading(false);
      }
    };
    initializeSetup();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && editingFolder) {
        setEditingFolder(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editingFolder]);

  const loadDefaultLocation = async () => {
    try {
      const settings = await window.electronAPI.settings.get();
      if (settings?.defaultSmartFolderLocation) {
        setDefaultLocation(settings.defaultSmartFolderLocation);
      } else {
        const documentsPath = await window.electronAPI.files.getDocumentsPath();
        if (documentsPath) {
          setDefaultLocation(documentsPath);
        }
      }
    } catch (error) {
      logger.error('Failed to load default location', {
        error: error.message,
      });
    }
  };

  const loadSmartFolders = async () => {
    try {
      // Debug logging in development mode
      if (process.env.NODE_ENV === 'development') {
        logger.debug('Loading smart folders');
      }

      // Check if electronAPI is available
      if (!window.electronAPI || !window.electronAPI.smartFolders) {
        logger.error('electronAPI.smartFolders not available');
        showError(
          'Electron API not available. Please restart the application.',
        );
        return;
      }

      const folders = await window.electronAPI.smartFolders.get();
      // Debug logging in development mode
      if (process.env.NODE_ENV === 'development') {
        logger.debug('Loaded smart folders', {
          count: folders?.length || 0,
          folders,
        });
      }

      if (!Array.isArray(folders)) {
        logger.warn('Received non-array response', { folders });
        setSmartFolders([]);
        return;
      }

      setSmartFolders(folders);
      actions.setPhaseData('smartFolders', folders);

      // Debug logging in development mode
      if (process.env.NODE_ENV === 'development') {
        if (folders.length > 0) {
          logger.debug('Smart folders loaded successfully', {
            count: folders.length,
          });
        } else {
          logger.debug('No smart folders found (using defaults)');
        }
      }
    } catch (error) {
      logger.error('Failed to load smart folders', {
        error: error.message,
        stack: error.stack,
        electronAPI: !!window.electronAPI,
        smartFolders: !!window.electronAPI?.smartFolders,
      });
      showError(`Failed to load smart folders: ${error.message}`);
      // Set empty array as fallback
      setSmartFolders([]);
    }
  };

  const handleAddFolder = async () => {
    if (!newFolderName.trim()) {
      showWarning('Please enter a folder name');
      return;
    }
    setIsAddingFolder(true);
    try {
      let targetPath;
      if (newFolderPath.trim()) {
        targetPath = newFolderPath.trim();
      } else {
        let resolvedDefaultLocation = defaultLocation;
        if (
          !/^[A-Za-z]:[\\/]/.test(resolvedDefaultLocation) &&
          !resolvedDefaultLocation.startsWith('/')
        ) {
          try {
            const documentsPath =
              await window.electronAPI.files.getDocumentsPath();
            if (documentsPath) {
              resolvedDefaultLocation = documentsPath;
            }
          } catch {
            // Non-fatal if documents path fails
          }
        }
        targetPath = `${resolvedDefaultLocation}/${newFolderName.trim()}`;
      }
      if (!/^[A-Za-z]:[\\/]/.test(targetPath) && !targetPath.startsWith('/')) {
        try {
          const documentsPath =
            await window.electronAPI.files.getDocumentsPath();
          if (documentsPath) {
            targetPath = `${documentsPath}/${targetPath}`;
          }
        } catch {
          // Non-fatal if documents path fails
        }
      }

      // eslint-disable-next-line no-control-regex
      const illegalChars = /[<>:"|?*\x00-\x1f]/g;
      if (illegalChars.test(newFolderName)) {
        showError(
          'Folder name contains invalid characters. Please avoid: < > : " | ? *',
        );
        return;
      }

      const existingFolder = smartFolders.find(
        (f) =>
          f.name.toLowerCase() === newFolderName.trim().toLowerCase() ||
          (f.path && f.path.toLowerCase() === targetPath.toLowerCase()),
      );
      if (existingFolder) {
        showWarning(
          `A smart folder with name "${existingFolder.name}" or path "${existingFolder.path}" already exists`,
        );
        return;
      }

      const parentPath = targetPath.substring(
        0,
        targetPath.lastIndexOf('/') || targetPath.lastIndexOf('\\'),
      );
      try {
        if (parentPath) {
          const parentStats =
            await window.electronAPI.files.getStats(parentPath);
          if (!parentStats || !parentStats.isDirectory) {
            showError(
              `Parent directory "${parentPath}" does not exist or is not accessible`,
            );
            return;
          }
        }
      } catch {
        showWarning(
          'Cannot verify parent directory permissions. Folder creation may fail.',
        );
      }

      const newFolder = {
        name: newFolderName.trim(),
        path: targetPath,
        description:
          newFolderDescription.trim() ||
          `Smart folder for ${newFolderName.trim()}`,
        isDefault: false,
      };
      const result = await window.electronAPI.smartFolders.add(newFolder);
      if (result.success) {
        if (result.directoryCreated) {
          showSuccess(
            `✅ Added smart folder and created directory: ${newFolder.name}`,
          );
        } else if (result.directoryExisted) {
          showSuccess(
            `✅ Added smart folder: ${newFolder.name} (directory already exists)`,
          );
        } else {
          showSuccess(`✅ Added smart folder: ${newFolder.name}`);
        }
        if (result.llmEnhanced) {
          showInfo('🤖 Smart folder enhanced with AI suggestions', 5000);
        }
        showInfo(
          '💡 Tip: You can reanalyze files to see how they fit with your new smart folder',
          5000,
        );
        await loadSmartFolders();
        setNewFolderName('');
        setNewFolderPath('');
        setNewFolderDescription('');
      } else {
        showError(`❌ Failed to add folder: ${result.error}`);
      }
    } catch (error) {
      logger.error('Failed to add smart folder', {
        error: error.message,
        stack: error.stack,
      });
      showError('Failed to add smart folder');
    } finally {
      setIsAddingFolder(false);
    }
  };

  const handleEditFolder = (folder) => {
    setEditingFolder({ ...folder });
  };

  const handleSaveEdit = async () => {
    if (!editingFolder.name.trim()) {
      showWarning('Folder name cannot be empty');
      return;
    }
    setIsSavingEdit(true);
    try {
      const result = await window.electronAPI.smartFolders.edit(
        editingFolder.id,
        editingFolder,
      );
      if (result.success) {
        showSuccess(`✅ Updated folder: ${editingFolder.name}`);
        showInfo(
          '💡 Tip: You can reanalyze files to see how they fit with updated smart folders',
          5000,
        );
        await loadSmartFolders();
        setEditingFolder(null);
      } else {
        showError(`❌ Failed to update folder: ${result.error}`);
      }
    } catch (error) {
      logger.error('Failed to update folder', {
        error: error.message,
        stack: error.stack,
      });
      showError('Failed to update folder');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingFolder(null);
  };

  const handleDeleteFolder = async (folderId) => {
    const folder = smartFolders.find((f) => f.id === folderId);
    if (!folder) return;
    const confirmDelete = await showConfirm({
      title: 'Delete Smart Folder',
      message:
        'Are you sure you want to remove this smart folder from StratoSort? This will not delete the physical directory or its files.',
      confirmText: 'Remove Folder',
      cancelText: 'Cancel',
      variant: 'danger',
      fileName: folder.name,
    });
    if (!confirmDelete) return;
    setIsDeletingFolder(folderId);
    try {
      const result = await window.electronAPI.smartFolders.delete(folderId);
      if (result.success) {
        if (result.deletedFolder) {
          showSuccess(`✅ Removed smart folder: ${result.deletedFolder.name}`);
        } else {
          showSuccess('✅ Removed smart folder');
        }
        await loadSmartFolders();
      } else {
        showError(`❌ Failed to delete folder: ${result.error}`);
      }
    } catch (error) {
      logger.error('Failed to delete folder', {
        error: error.message,
        stack: error.stack,
      });
      showError('❌ Failed to delete folder');
    } finally {
      setIsDeletingFolder(null);
    }
  };

  const handleBrowseFolder = async () => {
    try {
      const res = await window.electronAPI.files.selectDirectory();
      if (res?.success && res.folder) {
        setNewFolderPath(res.folder);
      }
    } catch (error) {
      logger.error('Failed to browse folder', {
        error: error.message,
      });
      showError('Failed to browse folder');
    }
  };

  const handleOpenFolder = async (folderPath) => {
    try {
      const result = await window.electronAPI.files.openFolder(folderPath);
      if (result?.success) {
        showSuccess(`📁 Opened folder: ${folderPath.split(/[\\/]/).pop()}`);
      } else {
        showError(`Failed to open folder: ${result?.error || 'Unknown error'}`);
      }
    } catch (error) {
      logger.error('Failed to open folder', {
        error: error.message,
        folderPath,
      });
      showError('Failed to open folder');
    }
  };

  const createSingleFolder = async (folderPath) => {
    try {
      await window.electronAPI.files.createFolder(folderPath);
      return { success: true };
    } catch (error) {
      logger.error('Failed to create folder', {
        error: error.message,
        folderPath,
      });
      return { success: false, error: error.message };
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden modern-scrollbar">
      <div className="container-responsive gap-6 py-6 flex flex-col min-h-min">
        <div className="text-center space-y-4 flex-shrink-0">
          <h1 className="heading-primary">
            ⚙️ Configure <span className="text-gradient">Smart Folders</span>
          </h1>
          <p className="text-lg text-system-gray-600 leading-relaxed max-w-2xl mx-auto">
            Define trusted destinations so the AI can organize every discovery
            with confidence.
          </p>
          <div className="flex items-center justify-center gap-6 text-xs text-system-gray-500">
            <button
              className="hover:text-system-gray-800 underline"
              onClick={() => {
                try {
                  const keys = ['setup-current-folders', 'setup-add-folder'];
                  keys.forEach((k) =>
                    window.localStorage.setItem(`collapsible:${k}`, 'true'),
                  );
                  window.dispatchEvent(new Event('storage'));
                } catch {
                  // Non-fatal if localStorage fails
                }
              }}
            >
              Expand all
            </button>
            <span className="text-system-gray-300">•</span>
            <button
              className="hover:text-system-gray-800 underline"
              onClick={() => {
                try {
                  const keys = ['setup-current-folders', 'setup-add-folder'];
                  keys.forEach((k) =>
                    window.localStorage.setItem(`collapsible:${k}`, 'false'),
                  );
                  window.dispatchEvent(new Event('storage'));
                } catch {
                  // Non-fatal if localStorage fails
                }
              }}
            >
              Collapse all
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <Collapsible
            className="glass-panel"
            title="📁 Current Smart Folders"
            actions={
              smartFolders.length > 0 ? (
                <Button
                  onClick={async () => {
                    try {
                      const res =
                        await window.electronAPI.embeddings.rebuildFolders();
                      if (res?.success) {
                        showSuccess(
                          `🧠 Rebuilt ${res.folders || 0} folder embeddings`,
                        );
                      } else {
                        showError(
                          `Failed to rebuild embeddings: ${res?.error || 'Unknown error'}`,
                        );
                      }
                    } catch (e) {
                      showError(`Failed: ${e.message}`);
                    }
                  }}
                  variant="primary"
                  className="text-sm"
                  title="Rebuild all smart folder embeddings"
                >
                  🧠 Rebuild Embeddings
                </Button>
              ) : null
            }
            defaultOpen
            persistKey="setup-current-folders"
            contentClassName="p-8"
          >
            {isLoading ? (
              <SmartFolderSkeleton count={3} />
            ) : smartFolders.length === 0 ? (
              <div className="text-center py-21">
                <div
                  className="text-4xl mb-8 opacity-50"
                  role="img"
                  aria-label="empty folder"
                >
                  📂
                </div>
                <p className="text-muted italic">
                  No smart folders configured yet.
                </p>
              </div>
            ) : (
              <div className="space-y-8">
                {smartFolders.map((folder, index) => (
                  <SmartFolderItem
                    key={folder.id}
                    folder={folder}
                    index={index}
                    editingFolder={editingFolder}
                    setEditingFolder={setEditingFolder}
                    isSavingEdit={isSavingEdit}
                    isDeleting={isDeletingFolder === folder.id}
                    onSaveEdit={handleSaveEdit}
                    onCancelEdit={handleCancelEdit}
                    onEditStart={handleEditFolder}
                    onDeleteFolder={handleDeleteFolder}
                    onCreateDirectory={createSingleFolder}
                    onOpenFolder={handleOpenFolder}
                    addNotification={addNotification}
                  />
                ))}
              </div>
            )}
          </Collapsible>

          <Collapsible
            title="Add New Smart Folder"
            defaultOpen={false}
            persistKey="setup-add-folder"
            className="glass-panel"
          >
            <div className="space-y-13">
              <div>
                <label className="block text-sm font-medium text-system-gray-700 mb-5">
                  Folder Name
                </label>
                <Input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === 'Enter' &&
                      newFolderName.trim() &&
                      !isAddingFolder
                    ) {
                      handleAddFolder();
                    }
                  }}
                  placeholder="e.g., Documents, Photos, Projects"
                  className="w-full"
                  aria-describedby="folder-name-help"
                />
                <div
                  id="folder-name-help"
                  className="text-xs text-system-gray-500 mt-3"
                >
                  Enter a descriptive name for your smart folder. Press Enter to
                  add the folder.
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-system-gray-700 mb-5">
                  Target Path (optional)
                </label>
                <div className="flex gap-8 flex-col sm:flex-row">
                  <Input
                    type="text"
                    value={newFolderPath}
                    onChange={(e) => setNewFolderPath(e.target.value)}
                    placeholder="e.g., Documents/Work, Pictures/Family"
                    className="flex-1"
                  />
                  <Button
                    onClick={handleBrowseFolder}
                    variant="secondary"
                    title="Browse for folder"
                    className="w-full sm:w-auto"
                  >
                    📁 Browse
                  </Button>
                </div>
                <p className="text-xs text-system-gray-500 mt-3">
                  Leave empty to use default {defaultLocation}/
                  {newFolderName || 'FolderName'}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-system-gray-700 mb-5">
                  Description{' '}
                  <span className="text-stratosort-blue font-semibold">
                    (Important for AI)
                  </span>
                </label>
                <Textarea
                  value={newFolderDescription}
                  onChange={(e) => setNewFolderDescription(e.target.value)}
                  placeholder="Describe what types of files should go in this folder. E.g., 'Work documents, contracts, and business correspondence' or 'Family photos from vacations and special events'"
                  className="w-full"
                  rows={4}
                  aria-describedby="description-help"
                />
                <div
                  id="description-help"
                  className="text-xs text-system-gray-500 mt-3"
                >
                  💡 <strong>Tip:</strong> The more specific your description,
                  the better the AI will organize your files. Include file
                  types, content themes, and use cases.
                </div>
              </div>
              <Button
                onClick={handleAddFolder}
                disabled={!newFolderName.trim() || isAddingFolder}
                variant="primary"
                className="w-full sm:w-auto"
                aria-label={
                  isAddingFolder ? 'Adding folder...' : 'Add smart folder'
                }
              >
                {isAddingFolder ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full inline-block mr-2"></div>
                    Adding...
                  </>
                ) : (
                  <>➕ Add Smart Folder</>
                )}
              </Button>
            </div>
          </Collapsible>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between flex-shrink-0">
          <Button
            onClick={() => actions.advancePhase(PHASES.WELCOME)}
            variant="secondary"
            className="w-full sm:w-auto"
          >
            ← Back to Welcome
          </Button>
          <Button
            onClick={async () => {
              // Reload folders to ensure we have latest data
              const reloadedFolders =
                await window.electronAPI.smartFolders.get();
              const currentFolders = Array.isArray(reloadedFolders)
                ? reloadedFolders
                : [];

              if (currentFolders.length === 0) {
                showWarning(
                  'Please add at least one smart folder before continuing. Smart folders help the AI organize your files effectively.',
                );
              } else {
                // Fixed: Update phase data synchronously BEFORE advancing to prevent race condition
                // This ensures Discover phase has access to latest folder data
                actions.setPhaseData('smartFolders', currentFolders);

                // Update local state (async, but not critical for phase transition)
                setSmartFolders(currentFolders);

                // Small delay to ensure context update propagates
                await new Promise((resolve) => setTimeout(resolve, 50));

                // Now safe to advance - Discover phase will have fresh folder data
                actions.advancePhase(PHASES.DISCOVER);
              }
            }}
            variant="primary"
            className="w-full sm:w-auto"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full inline-block mr-2"></div>
                Loading...
              </>
            ) : (
              <>Continue to File Discovery →</>
            )}
          </Button>
        </div>

        <ConfirmDialog />
      </div>
    </div>
  );
}

export default SetupPhase;
