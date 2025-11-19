import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  Suspense,
  lazy,
} from 'react';
import { PHASES, RENDERER_LIMITS } from '../../shared/constants';
import { logger } from '../../shared/logger';
import { usePhase } from '../contexts/PhaseContext';
import { useNotification } from '../contexts/NotificationContext';
import { useConfirmDialog, useDragAndDrop } from '../hooks';
import { Collapsible, Button } from '../components/ui';
import { ModalLoadingOverlay } from '../components/LoadingSkeleton';
const AnalysisHistoryModal = lazy(
  () => import('../components/AnalysisHistoryModal'),
);
import {
  NamingSettings,
  SelectionControls,
  DragAndDropZone,
  AnalysisResultsList,
  AnalysisProgress,
} from '../components/discover';

// Set logger context for this component
logger.setContext('DiscoverPhase');

function DiscoverPhase() {
  const { actions, phaseData } = usePhase();
  const { addNotification } = useNotification();
  const { showConfirm, ConfirmDialog } = useConfirmDialog();
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [analysisResults, setAnalysisResults] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [currentAnalysisFile, setCurrentAnalysisFile] = useState('');
  const [analysisProgress, setAnalysisProgress] = useState({
    current: 0,
    total: 0,
  });
  const [showAnalysisHistory, setShowAnalysisHistory] = useState(false);
  const [analysisStats, setAnalysisStats] = useState(null);

  const [namingConvention, setNamingConvention] = useState('subject-date');
  const [dateFormat, setDateFormat] = useState('YYYY-MM-DD');
  const [caseConvention, setCaseConvention] = useState('kebab-case');
  const [separator, setSeparator] = useState('-');

  const [fileStates, setFileStates] = useState({});
  const hasResumedRef = useRef(false);
  const analysisLockRef = useRef(false); // Add analysis lock to prevent multiple simultaneous calls
  const [globalAnalysisActive, setGlobalAnalysisActive] = useState(false); // Global analysis state
  const analyzeFilesRef = useRef(null);
  const heartbeatIntervalRef = useRef(null); // Store heartbeat interval for cleanup
  const analysisTimeoutRef = useRef(null); // Store analysis timeout for cleanup
  // Bug #35: Add AbortController for progress cancellation
  const abortControllerRef = useRef(null); // Store AbortController for cancellation support

  // CRITICAL FIX: Initial state restoration effect - runs only once on mount
  // This prevents infinite loops from phaseData updates
  useEffect(() => {
    const persistedResults = phaseData.analysisResults || [];
    const persistedFiles = phaseData.selectedFiles || [];
    const persistedStates = phaseData.fileStates || {};
    const persistedNaming = phaseData.namingConvention || {};
    const persistedIsAnalyzing = !!phaseData.isAnalyzing;
    const persistedProgress = phaseData.analysisProgress || {
      current: 0,
      total: 0,
    };
    const persistedCurrent = phaseData.currentAnalysisFile || '';

    // Restore persisted state regardless of whether results exist yet
    setSelectedFiles(persistedFiles);
    setFileStates(persistedStates);
    setNamingConvention(persistedNaming.convention || 'subject-date');
    setDateFormat(persistedNaming.dateFormat || 'YYYY-MM-DD');
    setCaseConvention(persistedNaming.caseConvention || 'kebab-case');
    setSeparator(persistedNaming.separator || '-');
    if (persistedResults.length > 0) setAnalysisResults(persistedResults);
    if (persistedIsAnalyzing) {
      // Check if analysis state is actually valid (not stuck)
      const lastActivity = persistedProgress.lastActivity || Date.now();
      const timeSinceActivity = Date.now() - lastActivity;
      const isStuck = timeSinceActivity > 2 * 60 * 1000; // 2 minutes

      if (isStuck) {
        logger.info('Detected stuck analysis state on mount, resetting');
        // Don't restore stuck analysis state
        actions.setPhaseData('isAnalyzing', false);
        actions.setPhaseData('analysisProgress', { current: 0, total: 0 });
        actions.setPhaseData('currentAnalysisFile', '');

        // Clear any stuck localStorage state
        try {
          localStorage.removeItem('stratosort_workflow_state');
        } catch {
          // Non-fatal if localStorage fails
        }
      } else {
        // Analysis state is valid, restore it
        setIsAnalyzing(true);
        setAnalysisProgress(persistedProgress);
        setCurrentAnalysisFile(persistedCurrent);
      }
    }
    // CRITICAL FIX: Only run on mount, not on every phaseData change
    // This prevents infinite loops and stale closures
  }, []);

  // Fixed: Consolidated analysis resume logic - extracted reset function
  const resetAnalysisState = useCallback(
    (reason) => {
      logger.info('Resetting analysis state', { reason });
      actions.setPhaseData('isAnalyzing', false);
      actions.setPhaseData('analysisProgress', { current: 0, total: 0 });
      actions.setPhaseData('currentAnalysisFile', '');
      setIsAnalyzing(false);
      setAnalysisProgress({ current: 0, total: 0 });
      setCurrentAnalysisFile('');

      // Clear any stuck localStorage state
      try {
        localStorage.removeItem('stratosort_workflow_state');
      } catch {
        // Non-fatal if localStorage fails
      }
    },
    [actions],
  );

  // Separate effect: Resume analysis on mount if needed
  useEffect(() => {
    if (
      !hasResumedRef.current &&
      phaseData.isAnalyzing &&
      Array.isArray(selectedFiles) &&
      selectedFiles.length > 0
    ) {
      const remaining = selectedFiles.filter((f) => {
        const state = fileStates[f.path]?.state;
        return state !== 'ready' && state !== 'error';
      });

      hasResumedRef.current = true;

      if (remaining.length > 0) {
        addNotification(
          `Resuming analysis of ${remaining.length} files...`,
          'info',
          3000,
          'analysis-resume',
        );
        const runAnalysis = analyzeFilesRef.current;
        if (runAnalysis) {
          runAnalysis(remaining);
        } else {
          logger.warn(
            'analyzeFiles not ready during resume, skipping remaining files',
          );
        }
      } else {
        // Nothing left to do; clear analyzing flag
        resetAnalysisState('No remaining files to analyze');
      }
    }
  }, [
    phaseData.isAnalyzing,
    selectedFiles,
    fileStates,
    addNotification,
    resetAnalysisState,
  ]);

  // Separate effect: Auto-reset stuck/stalled analysis
  useEffect(() => {
    if (!phaseData.isAnalyzing || !hasResumedRef.current) return;

    const lastActivity = phaseData.analysisProgress?.lastActivity || Date.now();
    const timeSinceActivity = Date.now() - lastActivity;
    const current = phaseData.analysisProgress?.current || 0;
    const total = phaseData.analysisProgress?.total || 0;

    // Check for stalled analysis (no progress after 2 minutes)
    const twoMinutes = 2 * 60 * 1000;
    if (current === 0 && total > 0 && timeSinceActivity > twoMinutes) {
      addNotification(
        'Analysis stalled with no progress - auto-resetting',
        'warning',
        5000,
        'analysis-stalled',
      );
      resetAnalysisState('Analysis stalled with no progress after 2 minutes');
      return;
    }

    // Check for stuck analysis (5 minutes of inactivity)
    const fiveMinutes = 5 * 60 * 1000;
    if (timeSinceActivity > fiveMinutes) {
      addNotification(
        'Detected stuck analysis state - auto-resetting',
        'warning',
        5000,
        'analysis-auto-reset',
      );
      resetAnalysisState('Stuck analysis state after 5 minutes of inactivity');
    }
  }, [
    phaseData.isAnalyzing,
    phaseData.analysisProgress,
    addNotification,
    resetAnalysisState,
  ]);

  // Bug #35: Cleanup resources on unmount including AbortController
  useEffect(() => {
    return () => {
      // Bug #35: Cancel any ongoing operations via AbortController
      if (abortControllerRef.current) {
        try {
          abortControllerRef.current.abort();
        } catch (error) {
          logger.error('Error aborting operations', { error: error.message });
        }
        abortControllerRef.current = null;
      }

      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      if (analysisTimeoutRef.current) {
        clearTimeout(analysisTimeoutRef.current);
        analysisTimeoutRef.current = null;
      }
    };
  }, []);

  const updateFileState = useCallback(
    (filePath, state, metadata = {}) => {
      try {
        setFileStates((prev) => {
          if (!prev || typeof prev !== 'object') prev = {};
          let newStates = { ...prev };
          const entries = Object.entries(newStates);
          if (entries.length > 100) {
            const sortedEntries = entries.sort(
              (a, b) => new Date(b[1].timestamp) - new Date(a[1].timestamp),
            );
            newStates = Object.fromEntries(sortedEntries.slice(0, 100));
          }
          newStates[filePath] = {
            state,
            timestamp: new Date().toISOString(),
            ...metadata,
          };
          return newStates;
        });
      } catch {
        // Fallback for unexpected state corruption
        setFileStates({
          [filePath]: {
            state,
            timestamp: new Date().toISOString(),
            ...metadata,
          },
        });
      }
    },
    [setFileStates],
  );

  const getFileState = useCallback(
    (filePath) => fileStates[filePath]?.state || 'pending',
    [fileStates],
  );

  const getFileStateDisplay = useCallback(
    (filePath, hasAnalysis) => {
      const state = getFileState(filePath);
      if (state === 'analyzing')
        return {
          icon: '🔄',
          label: 'Analyzing...',
          color: 'text-blue-600',
          spinning: true,
        };
      if (state === 'error')
        return {
          icon: '❌',
          label: 'Error',
          color: 'text-red-600',
          spinning: false,
        };
      if (hasAnalysis && state === 'ready')
        return {
          icon: '✅',
          label: 'Ready',
          color: 'text-green-600',
          spinning: false,
        };
      if (state === 'pending')
        return {
          icon: '⏳',
          label: 'Pending',
          color: 'text-yellow-600',
          spinning: false,
        };
      return {
        icon: '❌',
        label: 'Failed',
        color: 'text-red-600',
        spinning: false,
      };
    },
    [getFileState],
  );

  const validateProgressState = useCallback((progress) => {
    // Ensure progress state is valid
    if (!progress || typeof progress !== 'object') return false;
    if (
      typeof progress.current !== 'number' ||
      typeof progress.total !== 'number'
    )
      return false;
    if (progress.current < 0 || progress.total < 0) return false;
    if (progress.current > progress.total) return false;
    if (!progress.lastActivity || typeof progress.lastActivity !== 'number')
      return false;

    // Fixed: Check if progress is too old (more than 15 minutes)
    // Increased from 10 to 15 minutes to prevent false positive "stuck" detection
    // since heartbeat updates every 30 seconds and network/system delays can occur
    const timeSinceActivity = Date.now() - progress.lastActivity;
    if (timeSinceActivity > 15 * 60 * 1000) return false;

    return true;
  }, []);

  const formatDate = useCallback((date, format) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    switch (format) {
      case 'YYYY-MM-DD':
        return `${year}-${month}-${day}`;
      case 'MM-DD-YYYY':
        return `${month}-${day}-${year}`;
      case 'DD-MM-YYYY':
        return `${day}-${month}-${year}`;
      case 'YYYYMMDD':
        return `${year}${month}${day}`;
      default:
        return `${year}-${month}-${day}`;
    }
  }, []);

  const applyCaseConvention = useCallback((text, convention) => {
    switch (convention) {
      case 'kebab-case':
        return text
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
      case 'snake_case':
        return text
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '');
      case 'camelCase':
        return text
          .split(/[^a-z0-9]+/i)
          .map((word, index) =>
            index === 0
              ? word.toLowerCase()
              : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
          )
          .join('');
      case 'PascalCase':
        return text
          .split(/[^a-z0-9]+/i)
          .map(
            (word) =>
              word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
          )
          .join('');
      case 'lowercase':
        return text.toLowerCase();
      case 'UPPERCASE':
        return text.toUpperCase();
      default:
        return text;
    }
  }, []);

  const generatePreviewName = useCallback(
    (originalName) => {
      const baseName = originalName.replace(/\.[^/.]+$/, '');
      const extension = originalName.includes('.')
        ? '.' + originalName.split('.').pop()
        : '';
      const today = new Date();
      let previewName = '';
      switch (namingConvention) {
        case 'subject-date':
          previewName = `${baseName}${separator}${formatDate(today, dateFormat)}`;
          break;
        case 'date-subject':
          previewName = `${formatDate(today, dateFormat)}${separator}${baseName}`;
          break;
        case 'project-subject-date':
          previewName = `Project${separator}${baseName}${separator}${formatDate(today, dateFormat)}`;
          break;
        case 'category-subject':
          previewName = `Category${separator}${baseName}`;
          break;
        case 'keep-original':
          previewName = baseName;
          break;
        default:
          previewName = baseName;
      }
      return applyCaseConvention(previewName, caseConvention) + extension;
    },
    [
      namingConvention,
      separator,
      dateFormat,
      caseConvention,
      formatDate,
      applyCaseConvention,
    ],
  );

  const handleFileDrop = useCallback(
    async (files) => {
      if (files && files.length > 0) {
        // Get existing file paths to prevent duplicates
        const existingPaths = new Set(selectedFiles.map((f) => f.path));

        // Filter out files that are already selected
        const newFiles = files.filter((file) => !existingPaths.has(file.path));

        if (newFiles.length === 0) {
          addNotification(
            'All dropped files are already in the queue',
            'info',
            2000,
            'duplicate-files',
          );
          return;
        }

        if (newFiles.length < files.length) {
          const duplicateCount = files.length - newFiles.length;
          addNotification(
            `Skipped ${duplicateCount} duplicate files already in queue`,
            'info',
            2000,
            'duplicate-files',
          );
        }

        const enhancedFiles = newFiles.map((file) => ({
          ...file,
          source: 'drag_drop',
          droppedAt: new Date().toISOString(),
        }));

        // Update file states for new files only
        enhancedFiles.forEach((file) => updateFileState(file.path, 'pending'));

        // Merge with existing files, avoiding duplicates
        const allFiles = [...selectedFiles, ...enhancedFiles];
        const uniqueFiles = allFiles.filter(
          (file, index, self) =>
            index === self.findIndex((f) => f.path === file.path),
        );

        setSelectedFiles(uniqueFiles);
        actions.setPhaseData('selectedFiles', uniqueFiles);

        // Use batch notification for multiple files
        if (enhancedFiles.length > 1) {
          addNotification(
            `Added ${enhancedFiles.length} new files for analysis`,
            'success',
            2500,
            'files-added',
          );
        } else {
          addNotification(
            `Added ${enhancedFiles.length} new file for analysis`,
            'success',
            2500,
            'files-added',
          );
        }

        const runAnalysis = analyzeFilesRef.current;
        if (runAnalysis) {
          await runAnalysis(enhancedFiles);
        } else {
          logger.warn('analyzeFiles not ready for drag & drop processing');
        }
      }
    },
    [selectedFiles, addNotification, actions, updateFileState, analyzeFilesRef],
  );

  const { isDragging, dragProps } = useDragAndDrop(handleFileDrop);

  const getBatchFileStats = useCallback(
    async (filePaths, batchSize = RENDERER_LIMITS.FILE_STATS_BATCH_SIZE) => {
      const results = [];
      for (let i = 0; i < filePaths.length; i += batchSize) {
        const batch = filePaths.slice(i, i + batchSize);
        const batchResults = await Promise.allSettled(
          batch.map(async (filePath) => {
            try {
              if (i > 0) await new Promise((resolve) => setTimeout(resolve, 5));
              const stats = await window.electronAPI.files.getStats(filePath);
              const fileName = filePath.split(/[\\/]/).pop();
              const extension = fileName.includes('.')
                ? '.' + fileName.split('.').pop().toLowerCase()
                : '';
              return {
                name: fileName,
                path: filePath,
                extension,
                size: stats?.size || 0,
                type: 'file',
                created: stats?.created,
                modified: stats?.modified,
                success: true,
              };
            } catch (error) {
              const fileName = filePath.split(/[\\/]/).pop();
              return {
                name: fileName,
                path: filePath,
                extension: fileName.includes('.')
                  ? '.' + fileName.split('.').pop().toLowerCase()
                  : '',
                size: 0,
                type: 'file',
                success: false,
                error: error.message,
              };
            }
          }),
        );
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') results.push(result.value);
          else {
            const filePath = batch[index];
            const fileName = filePath.split(/[\\/]/).pop();
            results.push({
              name: fileName,
              path: filePath,
              extension: fileName.includes('.')
                ? '.' + fileName.split('.').pop().toLowerCase()
                : '',
              size: 0,
              type: 'file',
              success: false,
              error: result.reason?.message || 'Unknown error',
            });
          }
        });
        if (i + batchSize < filePaths.length)
          await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return results;
    },
    [],
  );

  const handleFileSelection = useCallback(async () => {
    try {
      setIsScanning(true);
      const result = await window.electronAPI.files.select();
      if (result?.success && result?.files?.length > 0) {
        const { files } = result;

        // Get existing file paths to prevent duplicates
        const existingPaths = new Set(selectedFiles.map((f) => f.path));

        // Filter out files that are already selected
        const newFiles = files.filter(
          (filePath) => !existingPaths.has(filePath),
        );

        if (newFiles.length === 0) {
          addNotification(
            'All selected files are already in the queue',
            'info',
            2000,
            'duplicate-files',
          );
          return;
        }

        if (newFiles.length < files.length) {
          const duplicateCount = files.length - newFiles.length;
          addNotification(
            `Skipped ${duplicateCount} duplicate files already in queue`,
            'info',
            2000,
            'duplicate-files',
          );
        }

        // Update file states for new files only
        newFiles.forEach((filePath) => updateFileState(filePath, 'pending'));

        const fileObjects = await getBatchFileStats(newFiles);
        const enhancedFiles = fileObjects.map((file) => ({
          ...file,
          source: 'file_selection',
        }));

        // Merge with existing files, avoiding duplicates
        const allFiles = [...selectedFiles, ...enhancedFiles];
        const uniqueFiles = allFiles.filter(
          (file, index, self) =>
            index === self.findIndex((f) => f.path === file.path),
        );

        setSelectedFiles(uniqueFiles);
        actions.setPhaseData('selectedFiles', uniqueFiles);

        const failedFiles = fileObjects.filter((f) => !f.success);
        if (failedFiles.length > 0) {
          addNotification(
            `Warning: ${failedFiles.length} files had issues loading metadata`,
            'warning',
            3000,
            'file-issues',
          );
        }

        // Use batch notification for multiple files
        if (enhancedFiles.length > 1) {
          addNotification(
            `Added ${enhancedFiles.length} new files for analysis`,
            'success',
            2500,
            'files-added',
          );
        } else {
          addNotification(
            `Added ${enhancedFiles.length} new file for analysis`,
            'success',
            2500,
            'files-added',
          );
        }

        // Only analyze the new files
        const runAnalysis = analyzeFilesRef.current;
        if (runAnalysis) {
          await runAnalysis(enhancedFiles);
        } else {
          logger.warn('analyzeFiles not ready after manual file selection');
        }
      } else {
        addNotification('No files selected', 'info', 2000, 'file-selection');
      }
    } catch (error) {
      addNotification(
        `Error selecting files: ${error.message}`,
        'error',
        4000,
        'file-selection-error',
      );
    } finally {
      setIsScanning(false);
    }
  }, [
    selectedFiles,
    addNotification,
    actions,
    updateFileState,
    getBatchFileStats,
  ]);

  const handleFolderSelection = useCallback(async () => {
    try {
      setIsScanning(true);
      const result = await window.electronAPI.files.selectDirectory();
      if (result?.success && result?.folder) {
        // Fixed: Add timeout protection for folder scanning (30 seconds)
        const SCAN_TIMEOUT = 30000; // 30 seconds
        const scanResult = await Promise.race([
          window.electronAPI.smartFolders.scanStructure(result.folder),
          new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    'Folder scan timeout - the folder may be on a slow network drive or contain too many files',
                  ),
                ),
              SCAN_TIMEOUT,
            ),
          ),
        ]);
        if (scanResult && scanResult.files && scanResult.files.length > 0) {
          const supportedExts = [
            '.pdf',
            '.doc',
            '.docx',
            '.xls',
            '.xlsx',
            '.ppt',
            '.pptx',
            '.txt',
            '.md',
            '.rtf',
            '.odt',
            '.ods',
            '.odp',
            '.epub',
            '.eml',
            '.msg',
            '.jpg',
            '.jpeg',
            '.png',
            '.gif',
            '.bmp',
            '.webp',
            '.tiff',
            '.svg',
            '.zip',
            '.rar',
            '.7z',
            '.tar',
            '.gz',
            '.kml',
            '.kmz',
          ];
          const supportedFiles = scanResult.files.filter((file) => {
            const ext = file.name.includes('.')
              ? '.' + file.name.split('.').pop().toLowerCase()
              : '';
            return supportedExts.includes(ext);
          });

          if (supportedFiles.length === 0) {
            addNotification(
              'No supported files found in the selected folder',
              'warning',
              3000,
              'folder-scan',
            );
            return;
          }

          // Get existing file paths to prevent duplicates
          const existingPaths = new Set(selectedFiles.map((f) => f.path));

          // Filter out files that are already selected
          const newFiles = supportedFiles.filter(
            (file) => !existingPaths.has(file.path),
          );

          if (newFiles.length === 0) {
            addNotification(
              'All files from this folder are already in the queue',
              'info',
              2000,
              'duplicate-files',
            );
            return;
          }

          if (newFiles.length < supportedFiles.length) {
            const duplicateCount = supportedFiles.length - newFiles.length;
            addNotification(
              `Skipped ${duplicateCount} duplicate files already in queue`,
              'info',
              2000,
              'duplicate-files',
            );
          }

          // Update file states for new files only
          newFiles.forEach((file) => updateFileState(file.path, 'pending'));

          const fileObjects = await getBatchFileStats(
            newFiles.map((f) => f.path),
          );
          const enhancedFiles = fileObjects.map((file) => ({
            ...file,
            source: 'folder_scan',
          }));

          // Merge with existing files, avoiding duplicates
          const allFiles = [...selectedFiles, ...enhancedFiles];
          const uniqueFiles = allFiles.filter(
            (file, index, self) =>
              index === self.findIndex((f) => f.path === file.path),
          );

          setSelectedFiles(uniqueFiles);
          actions.setPhaseData('selectedFiles', uniqueFiles);

          // Use batch notification for multiple files
          if (enhancedFiles.length > 1) {
            addNotification(
              `Added ${enhancedFiles.length} new files from folder for analysis`,
              'success',
              2500,
              'files-added',
            );
          } else {
            addNotification(
              `Added ${enhancedFiles.length} new file from folder for analysis`,
              'success',
              2500,
              'files-added',
            );
          }

          const runAnalysis = analyzeFilesRef.current;
          if (runAnalysis) {
            await runAnalysis(enhancedFiles);
          } else {
            logger.warn('analyzeFiles not ready after folder selection');
          }
        } else {
          addNotification(
            'No files found in the selected folder',
            'warning',
            3000,
            'folder-scan',
          );
        }
      } else if (result?.success === false && result?.folder === null) {
        addNotification(
          'Folder selection cancelled',
          'info',
          2000,
          'folder-selection',
        );
      } else {
        addNotification('No folder selected', 'info', 2000, 'folder-selection');
      }
    } catch (error) {
      addNotification(
        `Error selecting folder: ${error.message}`,
        'error',
        4000,
        'folder-selection-error',
      );
    } finally {
      setIsScanning(false);
    }
  }, [
    selectedFiles,
    addNotification,
    actions,
    updateFileState,
    getBatchFileStats,
  ]);

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
              'file-actions',
            );
            break;
          case 'reveal':
            await window.electronAPI.files.reveal(filePath);
            addNotification(
              `Revealed: ${filePath.split(/[\\/]/).pop()}`,
              'success',
              2000,
              'file-actions',
            );
            break;
          case 'delete': {
            const fileName = filePath.split(/[\\/]/).pop();
            const confirmDelete = await showConfirm({
              title: 'Delete File',
              message:
                'This action cannot be undone. Are you sure you want to permanently delete this file?',
              confirmText: 'Delete',
              cancelText: 'Cancel',
              variant: 'danger',
              fileName,
            });
            if (confirmDelete) {
              const result = await window.electronAPI.files.delete(filePath);
              if (result.success) {
                setAnalysisResults((prev) =>
                  prev.filter((f) => f.path !== filePath),
                );
                setSelectedFiles((prev) =>
                  prev.filter((f) => f.path !== filePath),
                );
                setFileStates((prev) => {
                  if (!prev) return prev;
                  const next = { ...prev };
                  delete next[filePath];
                  return next;
                });
                addNotification(
                  `Deleted: ${fileName}`,
                  'success',
                  3000,
                  'file-actions',
                );
              } else {
                addNotification(
                  `Failed to delete: ${fileName}`,
                  'error',
                  4000,
                  'file-actions',
                );
              }
            }
            break;
          }
          default:
            addNotification(
              `Unknown action: ${action}`,
              'error',
              4000,
              'file-actions',
            );
        }
      } catch (error) {
        addNotification(
          `Action failed: ${error.message}`,
          'error',
          4000,
          'file-actions',
        );
      }
    },
    [
      addNotification,
      selectedFiles,
      setSelectedFiles,
      analysisResults,
      setAnalysisResults,
      actions,
      updateFileState,
      showConfirm, // CRITICAL FIX: Missing dependency for delete confirmation
    ],
  );

  const analyzeFiles = useCallback(
    async (files) => {
      if (!files || files.length === 0) return;

      // Debug logging in development mode
      if (process.env.NODE_ENV === 'development') {
        logger.debug('analyzeFiles called', {
          filesCount: files.length,
          isAnalyzing,
          analysisProgress,
          hasLastActivity: !!analysisProgress.lastActivity,
          timeSinceActivity: analysisProgress.lastActivity
            ? Date.now() - analysisProgress.lastActivity
            : 'N/A',
          lockStatus: analysisLockRef.current,
        });
      }

      // Fixed: True atomic lock acquisition using IIFE closure to prevent race conditions
      // This ensures check-and-set happens in a single atomic operation
      const lockAcquired = (() => {
        if (analysisLockRef.current || globalAnalysisActive || isAnalyzing) {
          return false;
        }
        analysisLockRef.current = true;
        return true;
      })();

      if (!lockAcquired) {
        logger.debug('Lock already held by another call, skipping');
        return;
      }

      // Lock acquired successfully, continue with analysis
      setGlobalAnalysisActive(true);
      logger.debug('Analysis lock acquired atomically');

      // Bug #35: Create new AbortController for this analysis session
      abortControllerRef.current = new AbortController();
      const abortSignal = abortControllerRef.current.signal;

      // Bug #35: Check if already aborted before continuing
      if (abortSignal.aborted) {
        logger.debug('Analysis aborted before start');
        analysisLockRef.current = false;
        setGlobalAnalysisActive(false);
        return;
      }

      // Small delay to ensure lock is properly established
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Set a timeout to release the lock after 5 minutes (safety measure)
      const lockTimeout = setTimeout(
        () => {
          if (analysisLockRef.current) {
            logger.warn('Analysis lock timeout reached, forcing release');
            analysisLockRef.current = false;
            // Fixed: Clear heartbeat interval to prevent memory leak
            if (heartbeatIntervalRef.current) {
              clearInterval(heartbeatIntervalRef.current);
              heartbeatIntervalRef.current = null;
            }
            // Fixed: Clear analysis timeout
            if (analysisTimeoutRef.current) {
              clearTimeout(analysisTimeoutRef.current);
              analysisTimeoutRef.current = null;
            }
          }
        },
        5 * 60 * 1000,
      ); // 5 minutes

      // Force reset any existing analysis state to ensure clean start
      if (isAnalyzing || analysisProgress.total > 0) {
        logger.debug('Force resetting existing analysis state for clean start');
        setIsAnalyzing(false);
        setCurrentAnalysisFile('');
        setAnalysisProgress({ current: 0, total: 0 });
        actions.setPhaseData('isAnalyzing', false);
        actions.setPhaseData('currentAnalysisFile', '');
        actions.setPhaseData('analysisProgress', { current: 0, total: 0 });
      }

      // Remove the old blocking logic since we now have the lock system
      // The lock check at the beginning is sufficient

      setIsAnalyzing(true);
      const initialProgress = {
        current: 0,
        total: files.length,
        lastActivity: Date.now(),
      };
      setAnalysisProgress(initialProgress);
      setCurrentAnalysisFile('');
      actions.setPhaseData('isAnalyzing', true);
      actions.setPhaseData('analysisProgress', initialProgress);
      actions.setPhaseData('currentAnalysisFile', '');

      // Debug logging in development mode
      if (process.env.NODE_ENV === 'development') {
        logger.debug('Started analysis with progress', { initialProgress });
      }

      // Set up progress heartbeat to prevent stuck states
      // Fixed: Store in ref for cleanup on unmount
      // Fixed: Do NOT update lastActivity in heartbeat - only update on real progress
      heartbeatIntervalRef.current = setInterval(() => {
        if (isAnalyzing) {
          const currentProgress = {
            current: analysisProgress.current,
            total: analysisProgress.total,
            lastActivity: analysisProgress.lastActivity || Date.now(), // Keep existing lastActivity
          };

          // Validate progress before updating
          if (validateProgressState(currentProgress)) {
            setAnalysisProgress(currentProgress);
            actions.setPhaseData('analysisProgress', currentProgress);
          } else {
            logger.warn(
              'Invalid heartbeat progress state detected, resetting analysis',
            );
            if (heartbeatIntervalRef.current) {
              clearInterval(heartbeatIntervalRef.current);
              heartbeatIntervalRef.current = null;
            }
            resetAnalysisState();
          }
        }
      }, 30000); // Update every 30 seconds

      // Fixed: Set up global analysis timeout (10 minutes max for entire batch)
      analysisTimeoutRef.current = setTimeout(
        () => {
          logger.warn(
            'Global analysis timeout reached (10 minutes), forcing completion',
          );
          if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
            heartbeatIntervalRef.current = null;
          }
          addNotification(
            'Analysis took too long and was stopped. Proceeding with completed files.',
            'warning',
            5000,
            'analysis-timeout',
          );
        },
        10 * 60 * 1000,
      ); // 10 minutes

      const results = [];
      let maxConcurrent = 3;
      try {
        const persistedSettings = await window.electronAPI.settings.get();
        if (
          persistedSettings &&
          typeof persistedSettings.maxConcurrentAnalysis !== 'undefined'
        ) {
          maxConcurrent = Number(persistedSettings.maxConcurrentAnalysis);
        }
      } catch {
        // Non-fatal, use default concurrency
      }

      const concurrency = Math.max(1, Math.min(Number(maxConcurrent) || 3, 8));

      try {
        // Single notification for analysis start
        addNotification(
          `Starting AI analysis of ${files.length} files...`,
          'info',
          3000,
          'analysis-start',
        );

        // Create a Set to track processed files and prevent duplicates
        const processedFiles = new Set();
        const fileQueue = [...files];
        let completedCount = 0;

        // Create a single worker function that processes files sequentially
        const processFile = async (file) => {
          // Skip if already processed
          if (processedFiles.has(file.path)) {
            return;
          }

          const fileName = file.name || file.path.split(/[\\/]/).pop();

          // Mark as processing
          processedFiles.add(file.path);
          updateFileState(file.path, 'analyzing', { fileName });

          try {
            // Update progress atomically with proper lastActivity tracking
            completedCount++;
            const progress = {
              current: completedCount,
              total: files.length,
              lastActivity: Date.now(),
            };

            // Validate progress before updating
            if (validateProgressState(progress)) {
              // Update all progress states atomically
              setAnalysisProgress(progress);
              setCurrentAnalysisFile(fileName);
              actions.setPhaseData('analysisProgress', progress);
              actions.setPhaseData('currentAnalysisFile', fileName);
            } else {
              logger.warn('Invalid progress state detected, skipping update');
            }

            const fileInfo = {
              ...file,
              size: file.size || 0,
              created: file.created,
              modified: file.modified,
            };

            // Fixed: Implement retry logic for resilient AI analysis
            const MAX_RETRIES = 3;
            const RETRY_BASE_DELAY = 1000; // 1 second

            const analyzeWithRetry = async (filePath, attempt = 1) => {
              try {
                return await Promise.race([
                  window.electronAPI.files.analyze(filePath),
                  new Promise((_, reject) =>
                    setTimeout(
                      () =>
                        reject(new Error('Analysis timeout after 3 minutes')),
                      RENDERER_LIMITS.ANALYSIS_TIMEOUT_MS,
                    ),
                  ),
                ]);
              } catch (error) {
                // Retry on transient errors, fail fast on permanent errors
                const isTransient =
                  error.message?.includes('timeout') ||
                  error.message?.includes('network') ||
                  error.message?.includes('ECONNREFUSED') ||
                  error.message?.includes('ETIMEDOUT');

                if (attempt < MAX_RETRIES && isTransient) {
                  const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
                  logger.debug('Retry attempt', {
                    attempt,
                    maxRetries: MAX_RETRIES,
                    filePath,
                    delay,
                    error: error.message,
                  });
                  await new Promise((resolve) => setTimeout(resolve, delay));
                  return analyzeWithRetry(filePath, attempt + 1);
                }

                // Log final failure
                if (attempt >= MAX_RETRIES) {
                  logger.warn('Failed after max retries', {
                    maxRetries: MAX_RETRIES,
                    filePath,
                    error: error.message,
                  });
                }
                throw error;
              }
            };

            const analysis = await analyzeWithRetry(file.path);

            if (analysis && !analysis.error) {
              const enhancedAnalysis = {
                ...analysis,
                suggestedName: generatePreviewName(
                  analysis.suggestedName || fileName,
                ),
                namingConvention: {
                  convention: namingConvention,
                  dateFormat,
                  caseConvention,
                  separator,
                },
              };
              const result = {
                ...fileInfo,
                analysis: enhancedAnalysis,
                status: 'analyzed',
                analyzedAt: new Date().toISOString(),
              };
              results.push(result);
              // Fixed: Store complete file metadata for proper state reconstruction
              updateFileState(file.path, 'ready', {
                analysis: enhancedAnalysis,
                analyzedAt: new Date().toISOString(),
                name: fileInfo.name,
                size: fileInfo.size,
                type: fileInfo.type,
                confidence: enhancedAnalysis.confidence,
              });
            } else {
              const result = {
                ...fileInfo,
                analysis: null,
                error: analysis?.error || 'Analysis failed',
                status: 'failed',
                analyzedAt: new Date().toISOString(),
              };
              results.push(result);
              // Fixed: Store complete file metadata even for errors
              updateFileState(file.path, 'error', {
                error: analysis?.error || 'Analysis failed',
                analyzedAt: new Date().toISOString(),
                name: fileInfo.name,
                size: fileInfo.size,
                type: fileInfo.type,
              });
            }
          } catch (error) {
            const result = {
              ...file,
              analysis: null,
              error: error.message,
              status: 'failed',
              analyzedAt: new Date().toISOString(),
            };
            results.push(result);
            updateFileState(file.path, 'error', {
              error: error.message,
              analyzedAt: new Date().toISOString(),
            });
          }

          // Persist progress to localStorage
          try {
            const workflowState = {
              currentPhase: phaseData.currentPhase || PHASES.DISCOVER,
              phaseData: {
                ...phaseData,
                isAnalyzing: true,
                analysisProgress: {
                  current: completedCount,
                  total: files.length,
                },
                currentAnalysisFile: fileName,
              },
              timestamp: Date.now(),
            };
            localStorage.setItem(
              'stratosort_workflow_state',
              JSON.stringify(workflowState),
            );
          } catch {
            // Non-fatal if localStorage fails
          }
        };

        // Process files with controlled concurrency
        const processBatch = async (batch) => {
          try {
            // Bug #35: Check abort signal before processing each batch
            if (abortSignal.aborted) {
              logger.info('Batch processing aborted by user');
              throw new Error('Analysis cancelled by user');
            }

            const promises = batch.map((file) => processFile(file));
            await Promise.all(promises);

            // Update lastActivity after each batch to prevent stuck state
            const currentProgress = {
              current: completedCount,
              total: files.length,
              lastActivity: Date.now(),
            };

            // Validate progress before updating
            if (validateProgressState(currentProgress)) {
              setAnalysisProgress(currentProgress);
              actions.setPhaseData('analysisProgress', currentProgress);
            } else {
              logger.warn(
                'Invalid batch progress state detected, skipping update',
              );
            }
          } catch (error) {
            // Bug #35: Don't log abort errors as errors
            if (error.message === 'Analysis cancelled by user') {
              logger.info('User cancelled batch processing');
              throw error; // Re-throw to stop processing
            }
            logger.error('Batch processing error', {
              error: error.message,
              stack: error.stack,
            });
            // Don't fail the entire analysis for batch errors
          }
        };

        // Process files in batches to control concurrency
        for (let i = 0; i < fileQueue.length; i += concurrency) {
          // Bug #35: Check abort signal before each batch
          if (abortSignal.aborted) {
            logger.info('Analysis cancelled, stopping batch processing');
            addNotification('Analysis cancelled by user', 'info', 2000);
            break;
          }

          const batch = fileQueue.slice(i, i + concurrency);
          await processBatch(batch);
        }

        // Merge with any existing results (important for resume)
        const resultsByPath = new Map(
          (analysisResults || []).map((r) => [r.path, r]),
        );
        results.forEach((r) => resultsByPath.set(r.path, r));
        const mergedResults = Array.from(resultsByPath.values());
        setAnalysisResults(mergedResults);

        // Merge file states (preserve previous states, update changed)
        const mergedStates = { ...(fileStates || {}) };
        results.forEach((result) => {
          if (result.analysis && !result.error) {
            mergedStates[result.path] = {
              state: 'ready',
              timestamp: new Date().toISOString(),
              analysis: result.analysis,
              analyzedAt: result.analyzedAt,
            };
          } else if (result.error) {
            mergedStates[result.path] = {
              state: 'error',
              timestamp: new Date().toISOString(),
              error: result.error,
              analyzedAt: new Date().toISOString(),
            };
          }
        });
        setFileStates(mergedStates);

        actions.setPhaseData('analysisResults', mergedResults);
        actions.setPhaseData('fileStates', mergedStates);
        actions.setPhaseData('namingConvention', {
          convention: namingConvention,
          dateFormat,
          caseConvention,
          separator,
        });

        const successCount = results.filter((r) => r.analysis).length;
        const failureCount = results.length - successCount;

        // Consolidated completion notification
        if (successCount > 0 && failureCount === 0) {
          addNotification(
            `🎉 Analysis complete! ${successCount} files ready for organization`,
            'success',
            4000,
            'analysis-complete',
          );
          setTimeout(() => {
            addNotification(
              '📂 Proceeding to organize phase...',
              'info',
              3000,
              'phase-transition',
            );
            actions.advancePhase(PHASES.ORGANIZE);
          }, 2000);
        } else if (successCount > 0 && failureCount > 0) {
          addNotification(
            `Analysis complete: ${successCount} successful, ${failureCount} failed`,
            'warning',
            4000,
            'analysis-complete',
          );
          setTimeout(() => {
            addNotification(
              '📂 Proceeding to organize phase...',
              'info',
              3000,
              'phase-transition',
            );
            actions.advancePhase(PHASES.ORGANIZE);
          }, 2000);
        } else if (failureCount > 0) {
          addNotification(
            `Analysis failed for all ${failureCount} files`,
            'error',
            5000,
            'analysis-complete',
          );
        }
      } catch (error) {
        addNotification(
          `Analysis process failed: ${error.message}`,
          'error',
          5000,
          'analysis-error',
        );
      } finally {
        // Always reset analysis state, regardless of success/failure
        // Fixed: Clear heartbeat interval from ref
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        // Fixed: Clear analysis timeout
        if (analysisTimeoutRef.current) {
          clearTimeout(analysisTimeoutRef.current);
          analysisTimeoutRef.current = null;
        }
        setIsAnalyzing(false);
        setCurrentAnalysisFile('');
        setAnalysisProgress({ current: 0, total: 0 });
        actions.setPhaseData('isAnalyzing', false);
        actions.setPhaseData('currentAnalysisFile', '');
        actions.setPhaseData('analysisProgress', { current: 0, total: 0 });

        // Release the analysis lock
        analysisLockRef.current = false;
        setGlobalAnalysisActive(false);
        clearTimeout(lockTimeout); // Clear the timeout

        // Clear any stuck localStorage state
        try {
          localStorage.removeItem('stratosort_workflow_state');
        } catch {
          // Non-fatal if localStorage fails
        }
      }
    },
    [
      // CRITICAL FIX: Complete dependency array to prevent stale closures
      // State setters (stable - don't cause re-renders)
      setIsAnalyzing,
      setCurrentAnalysisFile,
      setAnalysisProgress,
      setAnalysisResults,
      setSelectedFiles,
      setFileStates,
      setGlobalAnalysisActive,
      // Context functions
      addNotification,
      actions,
      // Callback functions (already memoized)
      updateFileState,
      generatePreviewName,
      validateProgressState,
      resetAnalysisState,
      // State values used in the callback
      namingConvention,
      dateFormat,
      caseConvention,
      separator,
      isAnalyzing, // CRITICAL: Used in lock check
      analysisProgress, // CRITICAL: Used in lock check and progress tracking
      phaseData, // CRITICAL: Used for localStorage persistence
      analysisResults, // CRITICAL: Used for merging results
      fileStates, // CRITICAL: Used for merging file states
      // Refs are stable and don't need to be in deps, but included for completeness
      // analysisLockRef - stable ref, doesn't trigger re-renders
      // heartbeatIntervalRef - stable ref
      // analysisTimeoutRef - stable ref
    ],
  );

  analyzeFilesRef.current = analyzeFiles;

  const forceReleaseAnalysisLock = useCallback(() => {
    logger.info('Manually releasing analysis lock');
    analysisLockRef.current = false;
    setGlobalAnalysisActive(false);
    addNotification(
      'Analysis lock manually released',
      'info',
      2000,
      'analysis-reset',
    );
  }, [analysisLockRef, setGlobalAnalysisActive, addNotification]);

  const clearAnalysisQueue = useCallback(() => {
    setSelectedFiles([]);
    setAnalysisResults([]);
    setFileStates({});
    setAnalysisProgress({ current: 0, total: 0 });
    setCurrentAnalysisFile('');
    actions.setPhaseData('selectedFiles', []);
    actions.setPhaseData('analysisResults', []);
    actions.setPhaseData('fileStates', {});
    actions.setPhaseData('isAnalyzing', false);
    actions.setPhaseData('analysisProgress', { current: 0, total: 0 });
    actions.setPhaseData('currentAnalysisFile', '');
    addNotification('Analysis queue cleared', 'info', 2000, 'queue-management');
  }, [actions, addNotification]);

  return (
    <div className="container-responsive gap-6 py-6 flex flex-col">
      <div className="text-center space-y-3 flex-shrink-0">
        <h1 className="heading-primary">🔍 Discover & Analyze</h1>
        <p className="text-lg text-system-gray-600 leading-relaxed max-w-3xl mx-auto">
          Select folders, drag files, or run a system scan, then let StratoSort
          prepare clean insights.
        </p>
      </div>
      <div className="flex flex-col items-center justify-center gap-3 text-xs text-system-gray-500 sm:flex-row flex-shrink-0">
        <button
          className="hover:text-system-gray-800 underline"
          onClick={() => {
            try {
              const keys = [
                'discover-naming',
                'discover-selection',
                'discover-dnd',
                'discover-results',
              ];
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
        <span className="text-system-gray-300 hidden sm:inline">•</span>
        <button
          className="hover:text-system-gray-800 underline"
          onClick={() => {
            try {
              const keys = [
                'discover-naming',
                'discover-selection',
                'discover-dnd',
                'discover-results',
              ];
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
        <span className="text-system-gray-300 hidden sm:inline">•</span>
        <button
          className="hover:text-stratosort-blue underline"
          onClick={() => setShowAnalysisHistory(true)}
        >
          Open Analysis History
        </button>
      </div>
      <div className="flex flex-col gap-6 desktop-grid-2">
        <Collapsible
          title="Naming Settings"
          defaultOpen
          persistKey="discover-naming"
          className="glass-panel"
        >
          <NamingSettings
            namingConvention={namingConvention}
            setNamingConvention={setNamingConvention}
            dateFormat={dateFormat}
            setDateFormat={setDateFormat}
            caseConvention={caseConvention}
            setCaseConvention={setCaseConvention}
            separator={separator}
            setSeparator={setSeparator}
          />
        </Collapsible>

        <Collapsible
          title="Select Files or Folder"
          defaultOpen
          persistKey="discover-selection"
          className="glass-panel"
        >
          <SelectionControls
            onSelectFiles={handleFileSelection}
            onSelectFolder={handleFolderSelection}
            isScanning={isScanning}
          />
          {selectedFiles.length > 0 && (
            <div className="mt-4 flex items-center justify-between p-8 bg-system-gray-50 rounded-lg border border-system-gray-200">
              <div className="text-sm text-system-gray-600">
                <span className="font-medium">{selectedFiles.length}</span> file
                {selectedFiles.length !== 1 ? 's' : ''} in queue
                {analysisResults.length > 0 && (
                  <span className="ml-2">
                    •{' '}
                    <span className="font-medium">
                      {analysisResults.filter((r) => r.analysis).length}
                    </span>{' '}
                    analyzed
                    {analysisResults.filter((r) => r.error).length > 0 && (
                      <span className="ml-2 text-red-600">
                        •{' '}
                        <span className="font-medium">
                          {analysisResults.filter((r) => r.error).length}
                        </span>{' '}
                        failed
                      </span>
                    )}
                  </span>
                )}
                {analysisLockRef.current && (
                  <span className="ml-2 text-orange-600">
                    • 🔒 Analysis locked
                  </span>
                )}
              </div>
              <div className="flex gap-5">
                <button
                  onClick={clearAnalysisQueue}
                  className="px-8 py-5 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                  title="Clear all files from the analysis queue"
                >
                  Clear Queue
                </button>
                {isAnalyzing && (
                  <button
                    onClick={() => {
                      setIsAnalyzing(false);
                      setCurrentAnalysisFile('');
                      setAnalysisProgress({ current: 0, total: 0 });
                      actions.setPhaseData('isAnalyzing', false);
                      actions.setPhaseData('currentAnalysisFile', '');
                      actions.setPhaseData('analysisProgress', {
                        current: 0,
                        total: 0,
                      });
                      addNotification(
                        'Analysis state reset',
                        'info',
                        2000,
                        'analysis-reset',
                      );
                    }}
                    className="px-8 py-5 text-sm bg-yellow-100 text-yellow-700 rounded-lg hover:bg-yellow-200 transition-colors"
                    title="Reset stuck analysis state"
                  >
                    Reset Analysis
                  </button>
                )}
                {analysisLockRef.current && !isAnalyzing && (
                  <button
                    onClick={forceReleaseAnalysisLock}
                    className="px-8 py-5 text-sm bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors"
                    title="Release stuck analysis lock"
                  >
                    Release Lock
                  </button>
                )}
              </div>
            </div>
          )}
        </Collapsible>

        <Collapsible
          title="Drag & Drop"
          defaultOpen
          persistKey="discover-dnd"
          className="glass-panel"
        >
          <DragAndDropZone isDragging={isDragging} dragProps={dragProps} />
        </Collapsible>

        {isAnalyzing && (
          <Collapsible
            title="Analysis Progress"
            defaultOpen
            persistKey="discover-progress"
            className="glass-panel"
          >
            <AnalysisProgress
              progress={analysisProgress}
              currentFile={currentAnalysisFile}
            />
            {/* Add reset button if analysis appears stuck */}
            {analysisProgress.lastActivity &&
              Date.now() - analysisProgress.lastActivity > 2 * 60 * 1000 && (
                <div className="mt-8 p-8 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-5">
                      <span className="text-amber-600">⚠️</span>
                      <span className="text-sm text-amber-800">
                        Analysis appears to be stuck. Last activity:{' '}
                        {new Date(
                          analysisProgress.lastActivity,
                        ).toLocaleTimeString()}
                      </span>
                    </div>
                    <button
                      onClick={resetAnalysisState}
                      className="px-8 py-5 text-sm bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 transition-colors"
                      title="Reset stuck analysis state"
                    >
                      Reset Analysis
                    </button>
                  </div>
                </div>
              )}
          </Collapsible>
        )}

        {analysisResults.length > 0 && (
          <Collapsible
            title="Analysis Results"
            defaultOpen
            persistKey="discover-results"
            contentClassName="p-8"
            className="glass-panel lg:col-span-2"
          >
            <AnalysisResultsList
              results={analysisResults}
              onFileAction={handleFileAction}
              getFileStateDisplay={getFileStateDisplay}
            />
          </Collapsible>
        )}
      </div>

      {/* Navigation Buttons */}
      <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between flex-shrink-0">
        <Button
          onClick={() => actions.advancePhase(PHASES.SETUP)}
          variant="secondary"
          className="w-full sm:w-auto"
        >
          ← Back to Setup
        </Button>
        <div className="flex gap-8">
          <Button
            onClick={clearAnalysisQueue}
            variant="outline"
            className="w-full sm:w-auto"
            disabled={
              selectedFiles.length === 0 && analysisResults.length === 0
            }
          >
            Clear Queue
          </Button>
          <Button
            onClick={() => {
              // Fixed: Add comprehensive validation before phase transition
              // Check if analysis is still running
              if (isAnalyzing) {
                addNotification(
                  'Please wait for analysis to complete before proceeding',
                  'warning',
                  3000,
                );
                return;
              }

              const readyCount = analysisResults.filter(
                (r) => r.analysis && !r.error,
              ).length;
              const errorCount = analysisResults.filter((r) => r.error).length;

              if (readyCount === 0 && errorCount === 0) {
                addNotification(
                  'Please analyze at least one file before proceeding',
                  'warning',
                  3000,
                );
                return;
              }

              if (readyCount === 0) {
                addNotification(
                  'All files failed analysis. Please check your files or Ollama service and try again',
                  'error',
                  4000,
                );
                return;
              }

              if (readyCount > 0) {
                addNotification(
                  `Proceeding to organize ${readyCount} analyzed file${readyCount > 1 ? 's' : ''}`,
                  'info',
                  2000,
                );
              }

              actions.advancePhase(PHASES.ORGANIZE);
            }}
            variant="primary"
            className="w-full sm:w-auto"
            disabled={
              isAnalyzing ||
              (analysisResults.length === 0 &&
                selectedFiles.filter((f) => getFileState(f.path) === 'ready')
                  .length === 0)
            }
          >
            Continue to Organize →
          </Button>
        </div>
      </div>

      <ConfirmDialog />
      {showAnalysisHistory && (
        <Suspense
          fallback={
            <ModalLoadingOverlay message="Loading Analysis History..." />
          }
        >
          <AnalysisHistoryModal
            onClose={() => setShowAnalysisHistory(false)}
            analysisStats={analysisStats}
            setAnalysisStats={setAnalysisStats}
          />
        </Suspense>
      )}
    </div>
  );
}

export default DiscoverPhase;
