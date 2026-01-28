import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { PHASES } from '../../shared/constants';
import { TIMEOUTS } from '../../shared/performanceConstants';
import { logger } from '../../shared/logger';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setSmartFolders as setSmartFoldersAction } from '../store/slices/filesSlice';
import { setPhase } from '../store/slices/uiSlice';
import { fetchDocumentsPath } from '../store/slices/systemSlice';
import { useNotification } from '../contexts/NotificationContext';
import { useConfirmDialog } from '../hooks';
import { Button, IconButton, StateMessage } from '../components/ui';
import { Heading, Text } from '../components/ui/Typography';
import { ActionBar, Inline, Stack } from '../components/layout';
import { SmartFolderSkeleton } from '../components/ui/LoadingSkeleton';
import { SmartFolderItem, AddSmartFolderModal } from '../components/setup';
import { Plus, ChevronDown, ChevronUp, RotateCcw, Folder } from 'lucide-react';
import { filesIpc, settingsIpc, smartFoldersIpc } from '../services/ipc';
import { normalizePathValue } from '../utils/pathNormalization';

logger.setContext('SetupPhase');

const normalizePathWithFallback = (value, fallback = 'Documents') => {
  const normalized = normalizePathValue(value);
  return normalized || fallback;
};

function SetupPhase() {
  const dispatch = useAppDispatch();
  const documentsPathFromStore = useAppSelector((state) => state.system.documentsPath);
  const smartFoldersFromStore = useAppSelector((state) => state.files.smartFolders);

  const actions = useMemo(
    () => ({
      setPhaseData: (key, value) => {
        if (key === 'smartFolders') dispatch(setSmartFoldersAction(value));
      },
      advancePhase: (phase) => dispatch(setPhase(phase))
    }),
    [dispatch]
  );

  const { showConfirm, ConfirmDialog } = useConfirmDialog();
  const { showSuccess, showError, showWarning, showInfo, addNotification } = useNotification();

  const [smartFolders, setSmartFolders] = useState([]);
  const [editingFolder, setEditingFolder] = useState(null);
  const [defaultLocation, setDefaultLocation] = useState('Documents');
  const [isDefaultLocationLoaded, setIsDefaultLocationLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showSkeletonLayer, setShowSkeletonLayer] = useState(true);
  const [contentVisible, setContentVisible] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeletingFolder, setIsDeletingFolder] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [viewMode, setViewMode] = useState('compact'); // 'compact' or 'expanded'
  const isMountedRef = useRef(true);
  const notifyRef = useRef({});

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
    if (documentsPathFromStore && !isDefaultLocationLoaded) {
      const normalized = normalizePathWithFallback(documentsPathFromStore, 'Documents');
      if (normalized !== 'Documents') {
        setDefaultLocation(normalized);
      }
      setIsDefaultLocationLoaded(true);
    }
  }, [documentsPathFromStore, isDefaultLocationLoaded]);

  // Keep notification functions stable via ref
  useEffect(() => {
    notifyRef.current = {
      showSuccess,
      showError,
      showWarning,
      showInfo,
      addNotification
    };
  }, [showSuccess, showError, showWarning, showInfo, addNotification]);

  const loadDefaultLocation = useCallback(async () => {
    try {
      if (!documentsPathFromStore) {
        dispatch(fetchDocumentsPath());
      }
      const settings = await settingsIpc.get();
      if (settings?.defaultSmartFolderLocation) {
        setDefaultLocation(
          normalizePathWithFallback(settings.defaultSmartFolderLocation, 'Documents')
        );
        setIsDefaultLocationLoaded(true);
        return;
      }

      if (documentsPathFromStore) {
        setDefaultLocation(normalizePathWithFallback(documentsPathFromStore, 'Documents'));
        setIsDefaultLocationLoaded(true);
        return;
      }

      setIsDefaultLocationLoaded(true);
      return;
    } catch (error) {
      logger.warn('Failed to load default smart folder location from settings', {
        error: error?.message
      });
      if (documentsPathFromStore) {
        setDefaultLocation(normalizePathWithFallback(documentsPathFromStore, 'Documents'));
        setIsDefaultLocationLoaded(true);
        return;
      }
      setIsDefaultLocationLoaded(true);
    }
  }, [documentsPathFromStore, dispatch]);

  const handleOpenAddModal = useCallback(async () => {
    await loadDefaultLocation();
    setIsAddModalOpen(true);
  }, [loadDefaultLocation]);

  const loadSmartFolders = useCallback(async () => {
    try {
      const folders = await smartFoldersIpc.get();

      if (!Array.isArray(folders)) {
        logger.warn('Received non-array response', { folders });
        notifyRef.current.showError?.('Failed to load smart folders. Please try again.');
        return;
      }

      setSmartFolders(folders);
      actions.setPhaseData('smartFolders', folders);
    } catch (error) {
      logger.error('Failed to load smart folders', {
        error: error.message,
        stack: error.stack
      });
      notifyRef.current.showError?.(`Failed to load smart folders: ${error.message}`);
    }
  }, [actions]);

  useEffect(() => {
    if (Array.isArray(smartFoldersFromStore) && smartFoldersFromStore.length > 0) {
      setSmartFolders((prev) => (prev !== smartFoldersFromStore ? smartFoldersFromStore : prev));
    }
  }, [smartFoldersFromStore]);

  useEffect(() => {
    isMountedRef.current = true;
    const initializeSetup = async () => {
      if (isMountedRef.current) setIsLoading(true);
      try {
        await Promise.all([loadSmartFolders(), loadDefaultLocation()]);
      } catch (error) {
        logger.error('Failed to initialize setup', {
          error: error.message,
          stack: error.stack
        });
        if (isMountedRef.current) notifyRef.current.showError?.('Failed to load setup data');
      } finally {
        if (isMountedRef.current) setIsLoading(false);
      }
    };
    initializeSetup();
    return () => {
      isMountedRef.current = false;
    };
  }, [loadSmartFolders, loadDefaultLocation]);

  useEffect(() => {
    let fadeTimeout;

    if (isLoading) {
      setShowSkeletonLayer(true);
      setContentVisible(false);
    } else {
      setContentVisible(true);
      fadeTimeout = setTimeout(() => setShowSkeletonLayer(false), TIMEOUTS.ANIMATION_FADE);
    }

    return () => {
      if (fadeTimeout) clearTimeout(fadeTimeout);
    };
  }, [isLoading]);

  const handleAddFolder = async (newFolder) => {
    try {
      const result = await smartFoldersIpc.add(newFolder);
      if (result.success) {
        if (result.directoryCreated) {
          showSuccess(`Added smart folder and created directory: ${newFolder.name}`);
        } else if (result.directoryExisted) {
          showSuccess(`Added smart folder: ${newFolder.name} (directory already exists)`);
        } else {
          showSuccess(`Added smart folder: ${newFolder.name}`);
        }
        if (result.llmEnhanced) {
          showInfo('Smart folder enhanced with AI suggestions', 5000);
        }
        await loadSmartFolders();
        return true;
      }
      showError(`Failed to add folder: ${result.error}`);
      return false;
    } catch (error) {
      logger.error('Failed to add smart folder', {
        error: error.message,
        stack: error.stack
      });
      showError('Failed to add smart folder');
      return false;
    }
  };

  const handleEditFolder = (folder) => {
    setEditingFolder({ ...folder });
    setExpandedFolders((prev) => new Set([...prev, folder.id]));
  };

  const handleSaveEdit = async () => {
    if (!editingFolder.name.trim()) {
      showWarning('Folder name cannot be empty');
      return;
    }
    setIsSavingEdit(true);
    try {
      const result = await smartFoldersIpc.edit(editingFolder.id, editingFolder);
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
        stack: error.stack
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
      fileName: folder.name
    });
    if (!confirmDelete) return;
    setIsDeletingFolder(folderId);
    try {
      const result = await smartFoldersIpc.delete(folderId);
      if (result.success) {
        showSuccess(`Removed smart folder: ${result.deletedFolder?.name || folder.name}`);
        await loadSmartFolders();
      } else {
        showError(`Failed to delete folder: ${result.error}`);
      }
    } catch (error) {
      logger.error('Failed to delete folder', {
        error: error.message,
        stack: error.stack
      });
      showError('Failed to delete folder');
    } finally {
      setIsDeletingFolder(null);
    }
  };

  const handleOpenFolder = async (folderPath) => {
    try {
      const result = await filesIpc.openFolder(folderPath);
      if (result?.success) {
        showSuccess(`Opened folder: ${folderPath.split(/[\\/]/).pop()}`);
      } else {
        showError(`Failed to open folder: ${result?.error || 'Unknown error'}`);
      }
    } catch (error) {
      logger.error('Failed to open folder', {
        error: error.message,
        folderPath
      });
      showError('Failed to open folder');
    }
  };

  const handleResetToDefaults = async () => {
    const confirmReset = await showConfirm({
      title: 'Reset to Default Folders',
      message:
        'This will replace all smart folders with the default set (Documents, Images, Videos, Music, etc.). Your existing folder configurations will be lost. Continue?',
      confirmText: 'Reset',
      cancelText: 'Cancel',
      variant: 'warning'
    });
    if (!confirmReset) return;

    try {
      setIsLoading(true);
      const result = await smartFoldersIpc.resetToDefaults();
      if (result?.success) {
        showSuccess(result.message || 'Smart folders reset to defaults');
        await loadSmartFolders();
      } else {
        showError(`Failed to reset: ${result?.error || 'Unknown error'}`);
      }
    } catch (error) {
      logger.error('Failed to reset smart folders', {
        error: error.message,
        stack: error.stack
      });
      showError('Failed to reset smart folders');
    } finally {
      setIsLoading(false);
    }
  };

  const createSingleFolder = async (folderPath) => {
    try {
      await filesIpc.createFolder(folderPath);
      return { success: true };
    } catch (error) {
      logger.error('Failed to create folder', {
        error: error.message,
        folderPath
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
    if (viewMode === 'compact') {
      setExpandedFolders(new Set(smartFolders.map((f) => f.id)));
    } else {
      setExpandedFolders(new Set());
    }
  };

  const isCompactMode = viewMode === 'compact';

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-6 lg:gap-8 pb-6">
      {/* Header */}
      <Stack className="text-center flex-shrink-0" gap="compact">
        <Heading as="h1" variant="display">
          Configure <span className="text-gradient">Smart Folders</span>
        </Heading>
        <Text variant="lead" className="max-w-xl mx-auto">
          Define trusted destinations so the AI can organize every discovery with confidence.
        </Text>
      </Stack>

      {/* Toolbar */}
      <Inline className="justify-between" gap="cozy">
        <Inline gap="compact">
          <Text variant="small" className="font-medium">
            {isLoading
              ? 'Loading...'
              : `${smartFolders.length} folder${smartFolders.length !== 1 ? 's' : ''}`}
          </Text>
          {smartFolders.length > 0 && (
            <Inline gap="compact" className="text-system-gray-500">
              <IconButton
                onClick={toggleViewMode}
                variant="ghost"
                size="sm"
                aria-label={isCompactMode ? 'Expand all folders' : 'Collapse all folders'}
                title={isCompactMode ? 'Expand all' : 'Collapse all'}
                icon={
                  isCompactMode ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronUp className="w-4 h-4" />
                  )
                }
              />
            </Inline>
          )}
        </Inline>

        <Inline gap="default">
          {smartFolders.length > 0 && (
            <Button onClick={handleResetToDefaults} variant="secondary" size="sm">
              <RotateCcw className="w-4 h-4 mr-1.5" />
              Reset to Defaults
            </Button>
          )}
          <Button onClick={handleOpenAddModal} variant="primary" size="sm">
            <Plus className="w-4 h-4 mr-1.5" />
            Add Folder
          </Button>
        </Inline>
      </Inline>

      {/* Folder list */}
      <div className="flex-1 min-h-0 relative">
        {showSkeletonLayer && (
          <div
            className={`transition-opacity duration-200 ${
              isLoading ? 'opacity-100' : 'opacity-0 pointer-events-none absolute inset-0'
            }`}
            aria-hidden={!isLoading}
          >
            <SmartFolderSkeleton count={3} compact={isCompactMode} />
          </div>
        )}

        <div
          className={`transition-opacity duration-200 ${
            contentVisible ? 'opacity-100' : 'opacity-0 pointer-events-none absolute inset-0'
          }`}
        >
          {smartFolders.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <StateMessage
                icon={Folder}
                size="lg"
                title="No smart folders yet"
                description="Add at least one destination folder so StratoSort knows where to organize your files."
                action={
                  <Inline gap="default">
                    <Button onClick={handleResetToDefaults} variant="secondary">
                      <RotateCcw className="w-4 h-4 mr-1.5" />
                      Load Defaults
                    </Button>
                    <Button onClick={handleOpenAddModal} variant="primary">
                      <Plus className="w-4 h-4 mr-1.5" />
                      Add Custom Folder
                    </Button>
                  </Inline>
                }
                contentClassName="max-w-md"
              />
            </div>
          ) : (
            <div
              className={`grid grid-cols-1 ${
                isCompactMode ? 'md:grid-cols-2 gap-4' : 'md:grid-cols-2 xl:grid-cols-3 gap-6'
              }`}
            >
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
      <ActionBar>
        <Button
          onClick={() => actions.advancePhase(PHASES?.WELCOME ?? 'welcome')}
          variant="secondary"
          size="md"
          className="w-full sm:w-auto min-w-[180px]"
        >
          Back
        </Button>
        <Button
          onClick={async () => {
            const reloadedFolders = await smartFoldersIpc.get();
            const currentFolders = Array.isArray(reloadedFolders) ? reloadedFolders : [];

            if (currentFolders.length === 0) {
              showWarning('Please add at least one smart folder before continuing.');
            } else {
              actions.setPhaseData('smartFolders', currentFolders);
              setSmartFolders(currentFolders);
              actions.advancePhase(PHASES?.DISCOVER ?? 'discover');
            }
          }}
          variant="primary"
          size="md"
          className="w-full sm:w-auto min-w-[180px]"
          disabled={isLoading}
        >
          {isLoading ? 'Loading...' : 'Continue to Discovery'}
        </Button>
      </ActionBar>

      {/* Add Folder Modal */}
      <AddSmartFolderModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={handleAddFolder}
        defaultLocation={defaultLocation}
        isDefaultLocationLoaded={isDefaultLocationLoaded}
        existingFolders={smartFolders}
        showNotification={addNotification}
      />

      <ConfirmDialog />
    </div>
  );
}

export default SetupPhase;
