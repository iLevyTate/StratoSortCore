import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { PHASES } from '../../shared/constants';
import { logger } from '../../shared/logger';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setSmartFolders as setSmartFoldersAction } from '../store/slices/filesSlice';
import { setPhase } from '../store/slices/uiSlice';
import { fetchDocumentsPath } from '../store/slices/systemSlice';
import { useNotification } from '../contexts/NotificationContext';
import { useConfirmDialog } from '../hooks';
import { Button } from '../components/ui';
import { SmartFolderSkeleton } from '../components/LoadingSkeleton';
import { SmartFolderItem, AddSmartFolderModal } from '../components/setup';

logger.setContext('SetupPhase');

const normalizePathValue = (value, fallback = 'Documents') => {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.path === 'string') {
    return value.path;
  }
  return fallback;
};

function SetupPhase() {
  const dispatch = useAppDispatch();
  const documentsPathFromStore = useAppSelector(
    (state) => state.system.documentsPath,
  );

  const actions = useMemo(
    () => ({
      setPhaseData: (key, value) => {
        if (key === 'smartFolders') dispatch(setSmartFoldersAction(value));
      },
      advancePhase: (phase) => dispatch(setPhase(phase)),
    }),
    [dispatch],
  );

  const { showConfirm, ConfirmDialog } = useConfirmDialog();
  const { showSuccess, showError, showWarning, showInfo, addNotification } =
    useNotification();

  const [smartFolders, setSmartFolders] = useState([]);
  const [editingFolder, setEditingFolder] = useState(null);
  const [defaultLocation, setDefaultLocation] = useState('Documents');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeletingFolder, setIsDeletingFolder] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [viewMode, setViewMode] = useState('compact'); // 'compact' or 'expanded'
  const isMountedRef = useRef(true);

  // Use ref to avoid re-adding listener on every editingFolder change
  const editingFolderRef = useRef(editingFolder);
  useEffect(() => {
    editingFolderRef.current = editingFolder;
  }, [editingFolder]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && editingFolderRef.current) {
        setEditingFolder(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Update defaultLocation when Redux store gets the path
  useEffect(() => {
    if (documentsPathFromStore && defaultLocation === 'Documents') {
      setDefaultLocation(
        normalizePathValue(documentsPathFromStore, defaultLocation),
      );
    }
  }, [documentsPathFromStore, defaultLocation]);

  const loadDefaultLocation = useCallback(async () => {
    try {
      const settings = await window.electronAPI.settings.get();
      if (settings?.defaultSmartFolderLocation) {
        setDefaultLocation(
          normalizePathValue(
            settings.defaultSmartFolderLocation,
            defaultLocation,
          ),
        );
      } else if (documentsPathFromStore) {
        setDefaultLocation(
          normalizePathValue(documentsPathFromStore, defaultLocation),
        );
      } else {
        dispatch(fetchDocumentsPath());
      }
    } catch (error) {
      logger.error('Failed to load default location', {
        error: error.message,
      });
    }
  }, [defaultLocation, documentsPathFromStore, dispatch]);

  const loadSmartFolders = useCallback(async () => {
    try {
      if (!window.electronAPI || !window.electronAPI.smartFolders) {
        logger.error('electronAPI.smartFolders not available');
        showError(
          'Electron API not available. Please restart the application.',
        );
        return;
      }

      const folders = await window.electronAPI.smartFolders.get();

      if (!Array.isArray(folders)) {
        logger.warn('Received non-array response', { folders });
        setSmartFolders([]);
        return;
      }

      setSmartFolders(folders);
      actions.setPhaseData('smartFolders', folders);
    } catch (error) {
      logger.error('Failed to load smart folders', {
        error: error.message,
        stack: error.stack,
      });
      showError(`Failed to load smart folders: ${error.message}`);
      setSmartFolders([]);
    }
  }, [actions, showError]);

  useEffect(() => {
    isMountedRef.current = true;
    const initializeSetup = async () => {
      if (isMountedRef.current) setIsLoading(true);
      try {
        await Promise.all([loadSmartFolders(), loadDefaultLocation()]);
      } catch (error) {
        logger.error('Failed to initialize setup', {
          error: error.message,
          stack: error.stack,
        });
        if (isMountedRef.current) showError('Failed to load setup data');
      } finally {
        if (isMountedRef.current) setIsLoading(false);
      }
    };
    initializeSetup();
    return () => {
      isMountedRef.current = false;
    };
  }, [loadSmartFolders, loadDefaultLocation, showError]);

  const handleAddFolder = async (newFolder) => {
    try {
      // Validate parent path
      const parentPath = newFolder.path.substring(
        0,
        newFolder.path.lastIndexOf('/') || newFolder.path.lastIndexOf('\\'),
      );
      try {
        if (parentPath) {
          const parentStats =
            await window.electronAPI.files.getStats(parentPath);
          if (!parentStats || !parentStats.isDirectory) {
            showError(
              `Parent directory "${parentPath}" does not exist or is not accessible`,
            );
            return false;
          }
        }
      } catch {
        showWarning(
          'Cannot verify parent directory permissions. Folder creation may fail.',
        );
      }

      const result = await window.electronAPI.smartFolders.add(newFolder);
      if (result.success) {
        if (result.directoryCreated) {
          showSuccess(
            `Added smart folder and created directory: ${newFolder.name}`,
          );
        } else if (result.directoryExisted) {
          showSuccess(
            `Added smart folder: ${newFolder.name} (directory already exists)`,
          );
        } else {
          showSuccess(`Added smart folder: ${newFolder.name}`);
        }
        if (result.llmEnhanced) {
          showInfo('Smart folder enhanced with AI suggestions', 5000);
        }
        await loadSmartFolders();
        return true;
      } else {
        showError(`Failed to add folder: ${result.error}`);
        return false;
      }
    } catch (error) {
      logger.error('Failed to add smart folder', {
        error: error.message,
        stack: error.stack,
      });
      showError('Failed to add smart folder');
      return false;
    }
  };

  const handleEditFolder = (folder) => {
    setEditingFolder({ ...folder });
    // Expand the folder being edited
    setExpandedFolders((prev) => new Set([...prev, folder.id]));
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
        showSuccess(`Updated folder: ${editingFolder.name}`);
        await loadSmartFolders();
        setEditingFolder(null);
      } else {
        showError(`Failed to update folder: ${result.error}`);
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
        showSuccess(`Removed smart folder: ${result.deletedFolder?.name || folder.name}`);
        await loadSmartFolders();
      } else {
        showError(`Failed to delete folder: ${result.error}`);
      }
    } catch (error) {
      logger.error('Failed to delete folder', {
        error: error.message,
        stack: error.stack,
      });
      showError('Failed to delete folder');
    } finally {
      setIsDeletingFolder(null);
    }
  };

  const handleOpenFolder = async (folderPath) => {
    try {
      const result = await window.electronAPI.files.openFolder(folderPath);
      if (result?.success) {
        showSuccess(`Opened folder: ${folderPath.split(/[\\/]/).pop()}`);
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

  const handleToggleExpand = useCallback((folderId) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const toggleViewMode = () => {
    setViewMode((prev) => (prev === 'compact' ? 'expanded' : 'compact'));
    // When switching to expanded, expand all; when switching to compact, collapse all
    if (viewMode === 'compact') {
      setExpandedFolders(new Set(smartFolders.map((f) => f.id)));
    } else {
      setExpandedFolders(new Set());
    }
  };

  const isCompactMode = viewMode === 'compact';

  return (
    <div className="phase-container">
      <div className="container-responsive flex flex-col flex-1 min-h-0 py-4 md:py-6 gap-4">
        {/* Header */}
        <div className="text-center flex flex-col flex-shrink-0 gap-2">
          <h1 className="heading-primary text-xl md:text-2xl">
            Configure <span className="text-gradient">Smart Folders</span>
          </h1>
          <p className="text-system-gray-600 leading-relaxed max-w-xl mx-auto text-sm md:text-base">
            Define trusted destinations so the AI can organize every discovery
            with confidence.
          </p>
        </div>

        {/* Main content */}
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-system-gray-600">
                {isLoading
                  ? 'Loading...'
                  : `${smartFolders.length} folder${smartFolders.length !== 1 ? 's' : ''}`}
              </span>
              {smartFolders.length > 0 && (
                <button
                  onClick={toggleViewMode}
                  className="text-xs text-system-gray-500 hover:text-system-gray-700 underline transition-colors"
                >
                  {isCompactMode ? 'Expand all' : 'Collapse all'}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {smartFolders.length > 0 && (
                <Button
                  onClick={async () => {
                    try {
                      const res =
                        await window.electronAPI.embeddings.rebuildFolders();
                      if (res?.success) {
                        showSuccess(
                          `Rebuilt ${res.folders || 0} folder embeddings`,
                        );
                      } else {
                        showError(
                          `Failed to rebuild: ${res?.error || 'Unknown error'}`,
                        );
                      }
                    } catch (e) {
                      showError(`Failed: ${e.message}`);
                    }
                  }}
                  variant="secondary"
                  className="text-sm"
                  title="Rebuild all folder embeddings"
                >
                  <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Rebuild
                </Button>
              )}
              <Button
                onClick={() => setIsAddModalOpen(true)}
                variant="primary"
                className="text-sm"
              >
                <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Folder
              </Button>
            </div>
          </div>

          {/* Folder list */}
          <div className="flex-1 min-h-0">
            {isLoading ? (
              <SmartFolderSkeleton count={3} />
            ) : smartFolders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-16 h-16 rounded-2xl bg-system-gray-100 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-system-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-system-gray-800 mb-1">
                  No smart folders yet
                </h3>
                <p className="text-sm text-system-gray-500 mb-4 max-w-sm">
                  Add at least one destination folder so StratoSort knows where to organize your files.
                </p>
                <Button
                  onClick={() => setIsAddModalOpen(true)}
                  variant="primary"
                >
                  <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add your first folder
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
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
                    compact={isCompactMode}
                    isExpanded={expandedFolders.has(folder.id)}
                    onToggleExpand={handleToggleExpand}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer navigation */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between flex-shrink-0 gap-3 pt-3 border-t border-border-soft/50">
          <Button
            onClick={() => actions.advancePhase(PHASES.WELCOME)}
            variant="secondary"
            className="w-full sm:w-auto text-sm"
          >
            <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </Button>
          <Button
            onClick={async () => {
              const reloadedFolders =
                await window.electronAPI.smartFolders.get();
              const currentFolders = Array.isArray(reloadedFolders)
                ? reloadedFolders
                : [];

              if (currentFolders.length === 0) {
                showWarning(
                  'Please add at least one smart folder before continuing.',
                );
              } else {
                actions.setPhaseData('smartFolders', currentFolders);
                setSmartFolders(currentFolders);
                actions.advancePhase(PHASES.DISCOVER);
              }
            }}
            variant="primary"
            className="w-full sm:w-auto text-sm"
            disabled={isLoading}
            title={
              smartFolders.length === 0
                ? 'Add at least one smart folder before continuing.'
                : undefined
            }
          >
            {isLoading ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                Loading...
              </>
            ) : (
              <>
                Continue to Discovery
                <svg className="w-4 h-4 ml-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </>
            )}
          </Button>
        </div>

        {/* Add Folder Modal */}
        <AddSmartFolderModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          onAdd={handleAddFolder}
          defaultLocation={defaultLocation}
          existingFolders={smartFolders}
          showNotification={addNotification}
        />

        <ConfirmDialog />
      </div>
    </div>
  );
}

export default SetupPhase;
