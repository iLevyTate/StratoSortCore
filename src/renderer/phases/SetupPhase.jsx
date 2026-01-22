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
import { Button } from '../components/ui';
import { SmartFolderSkeleton } from '../components/LoadingSkeleton';
import { SmartFolderItem, AddSmartFolderModal } from '../components/setup';
import { Plus, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';

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
  // FIX: Remove defaultLocation from deps to prevent potential infinite loop
  // Only run when documentsPathFromStore changes and we haven't loaded yet
  useEffect(() => {
    if (documentsPathFromStore && !isDefaultLocationLoaded) {
      const normalized = normalizePathValue(documentsPathFromStore, 'Documents');
      // Only update if the normalized value is different from the literal 'Documents'
      if (normalized !== 'Documents') {
        setDefaultLocation(normalized);
      }
      setIsDefaultLocationLoaded(true);
    }
  }, [documentsPathFromStore, isDefaultLocationLoaded]);

  // Keep notification functions stable via ref to avoid effect churn
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
      if (!window.electronAPI?.settings?.get) {
        logger.warn('electronAPI.settings not available, using fallback location');
        if (documentsPathFromStore) {
          setDefaultLocation(normalizePathValue(documentsPathFromStore, 'Documents'));
          setIsDefaultLocationLoaded(true);
        }
        return;
      }

      const settings = await window.electronAPI.settings.get();
      if (settings?.defaultSmartFolderLocation) {
        setDefaultLocation(normalizePathValue(settings.defaultSmartFolderLocation, 'Documents'));
        setIsDefaultLocationLoaded(true);
      } else if (documentsPathFromStore) {
        setDefaultLocation(normalizePathValue(documentsPathFromStore, 'Documents'));
        setIsDefaultLocationLoaded(true);
      } else {
        dispatch(fetchDocumentsPath());
        // Will be set to true when documentsPathFromStore is updated via effect
      }
    } catch (error) {
      logger.error('Failed to load default location', {
        error: error.message
      });
      // Still mark as loaded so modal can open (user can browse manually)
      setIsDefaultLocationLoaded(true);
    }
    // Note: Do NOT include defaultLocation in deps - it would cause infinite loop
    // since this callback calls setDefaultLocation
  }, [documentsPathFromStore, dispatch]);

  // FIX NEW-6: Handler to refresh default location and open add modal
  // This ensures the modal always shows the latest default location from settings
  const handleOpenAddModal = useCallback(async () => {
    await loadDefaultLocation();
    setIsAddModalOpen(true);
  }, [loadDefaultLocation]);

  const loadSmartFolders = useCallback(async () => {
    try {
      if (!window.electronAPI || !window.electronAPI.smartFolders) {
        logger.error('electronAPI.smartFolders not available');
        notifyRef.current.showError?.(
          'Electron API not available. Please restart the application.'
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
        stack: error.stack
      });
      notifyRef.current.showError?.(`Failed to load smart folders: ${error.message}`);
      setSmartFolders([]);
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
    // NOTE: do not depend on notification functions directly; they may be unstable and cause
    // infinite effect re-runs (maximum update depth). We use notifyRef for stability.
  }, [loadSmartFolders, loadDefaultLocation]);

  // Keep skeleton visible until content has had a frame to paint to avoid flash
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
      // FIX Issue 3.1-A, 3.1-B: Removed frontend parent path validation
      // The backend (smartFolders.js) handles directory creation automatically,
      // including creating parent directories recursively if needed.
      // This allows users to specify paths that don't exist yet.

      const result = await window.electronAPI.smartFolders.add(newFolder);
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
      const result = await window.electronAPI.smartFolders.edit(editingFolder.id, editingFolder);
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
        stack: error.stack
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
      const result = await window.electronAPI.smartFolders.resetToDefaults();
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
      await window.electronAPI.files.createFolder(folderPath);
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
      <div className="container-responsive flex flex-col flex-1 min-h-0 p-default md:p-relaxed lg:p-spacious gap-6 lg:gap-8 max-w-6xl w-full mx-auto">
        {/* Header */}
        <div className="text-center flex flex-col flex-shrink-0 gap-compact">
          <h1 className="heading-primary text-xl md:text-2xl">
            Configure <span className="text-gradient">Smart Folders</span>
          </h1>
          <p className="text-system-gray-600 leading-relaxed max-w-xl mx-auto text-sm md:text-base">
            Define trusted destinations so the AI can organize every discovery with confidence.
          </p>
        </div>

        {/* Main content */}
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-cozy mb-default">
            <div className="flex items-center gap-compact">
              <span className="text-sm font-medium text-system-gray-600">
                {isLoading
                  ? 'Loading...'
                  : `${smartFolders.length} folder${smartFolders.length !== 1 ? 's' : ''}`}
              </span>
              {smartFolders.length > 0 && (
                <button
                  onClick={toggleViewMode}
                  className="p-2 text-system-gray-500 hover:text-system-gray-700 hover:bg-system-gray-100 rounded-lg transition-colors"
                  title={isCompactMode ? 'Expand all' : 'Collapse all'}
                  aria-label={isCompactMode ? 'Expand all folders' : 'Collapse all folders'}
                >
                  {isCompactMode ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronUp className="w-4 h-4" />
                  )}
                  <span className="sr-only">
                    {isCompactMode ? 'Expand all folders' : 'Collapse all folders'}
                  </span>
                </button>
              )}
            </div>

            {/* FIX: Simplified toolbar - removed Reset/Rebuild buttons (Issue 3.1-C, 3.1-D)
                These options are available in Settings > Embeddings for advanced users */}
            <div className="flex items-center gap-compact">
              <Button onClick={handleOpenAddModal} variant="primary" className="text-sm">
                <Plus className="w-4 h-4 mr-1.5" />
                Add Folder
              </Button>
            </div>
          </div>

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
                <div
                  className="flex flex-col items-center justify-center py-12 text-center"
                  data-testid="smart-folders-empty-state"
                >
                  <div className="w-16 h-16 rounded-2xl bg-system-gray-100 flex items-center justify-center mb-4">
                    <svg
                      className="w-8 h-8 text-system-gray-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                      />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-system-gray-800 mb-1">
                    No smart folders yet
                  </h3>
                  <p className="text-sm text-system-gray-500 mb-4 max-w-sm">
                    Add at least one destination folder so StratoSort knows where to organize your
                    files.
                  </p>
                  <div className="flex gap-3">
                    <Button onClick={handleResetToDefaults} variant="secondary">
                      <RotateCcw className="w-4 h-4 mr-1.5" />
                      Load Defaults
                    </Button>
                    <Button onClick={handleOpenAddModal} variant="primary">
                      <Plus className="w-4 h-4 mr-1.5" />
                      Add Custom Folder
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
                  data-testid="folder-list"
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
        </div>

        {/* Footer navigation */}
        <div className="mt-auto border-t border-system-gray-200/50 flex flex-col sm:flex-row items-center justify-between flex-shrink-0 pt-6 pb-2 gap-cozy">
          <Button
            onClick={() => actions.advancePhase(PHASES?.WELCOME ?? 'welcome')}
            variant="secondary"
            className="w-full sm:w-auto text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            <span>Back</span>
          </Button>
          <Button
            onClick={async () => {
              const reloadedFolders = await window.electronAPI.smartFolders.get();
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
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Loading...</span>
              </>
            ) : (
              <>
                <span>Continue to Discovery</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
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
          isDefaultLocationLoaded={isDefaultLocationLoaded}
          existingFolders={smartFolders}
          showNotification={addNotification}
        />

        <ConfirmDialog />
      </div>
    </div>
  );
}

export default SetupPhase;
