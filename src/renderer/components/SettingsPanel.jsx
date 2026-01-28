import React, { useEffect, useRef, useState, useCallback, useMemo, Suspense, lazy } from 'react';
import {
  Brain,
  ChevronsDown,
  ChevronsUp,
  FolderOpen,
  History,
  Monitor,
  Save,
  Settings as SettingsIcon,
  Wrench,
  X,
  Zap
} from 'lucide-react';
import { logger } from '../../shared/logger';
import { sanitizeSettings } from '../../shared/settingsValidation';
import { DEFAULT_SETTINGS } from '../../shared/defaultSettings';
import { useNotification } from '../contexts/NotificationContext';
import { getElectronAPI, eventsIpc, ollamaIpc, settingsIpc } from '../services/ipc';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { toggleSettings, updateSettings } from '../store/slices/uiSlice';
import { useDebouncedCallback } from '../hooks/usePerformance';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import Collapsible from './ui/Collapsible';
import { ModalLoadingOverlay } from './ui/LoadingSkeleton';
import { Heading, Text } from './ui/Typography';
import { Stack } from './layout';
import AutoOrganizeSection from './settings/AutoOrganizeSection';
import BackgroundModeSection from './settings/BackgroundModeSection';
import NotificationSettingsSection from './settings/NotificationSettingsSection';
import OllamaConfigSection from './settings/OllamaConfigSection';
import ModelSelectionSection from './settings/ModelSelectionSection';
import ChatPersonaSection from './settings/ChatPersonaSection';
import ModelManagementSection from './settings/ModelManagementSection';
import EmbeddingRebuildSection from './settings/EmbeddingRebuildSection';
import DefaultLocationsSection from './settings/DefaultLocationsSection';
import NamingSettingsSection from './settings/NamingSettingsSection';
import ApplicationSection from './settings/ApplicationSection';
import APITestSection from './settings/APITestSection';
import SettingsBackupSection from './settings/SettingsBackupSection';

const AnalysisHistoryModal = lazy(() => import('./AnalysisHistoryModal'));

const SECTION_KEYS = [
  'settings-ai',
  'settings-performance',
  'settings-defaults',
  'settings-app',
  'settings-history',
  'settings-api'
];

logger.setContext('SettingsPanel');

const isElectronAPIAvailable = () => {
  return getElectronAPI() != null;
};

const ALLOWED_EMBED_MODELS = [
  'embeddinggemma',
  'mxbai-embed-large',
  'nomic-embed-text',
  'all-minilm',
  'bge-large'
];
const DEFAULT_EMBED_MODEL = 'embeddinggemma';

const stableStringify = (value) =>
  JSON.stringify(
    value,
    (key, val) => {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        return Object.keys(val)
          .sort()
          .reduce((acc, k) => {
            acc[k] = val[k];
            return acc;
          }, {});
      }
      return val;
    },
    0
  );

const SettingsPanel = React.memo(function SettingsPanel() {
  const dispatch = useAppDispatch();
  const uiSettings = useAppSelector((state) => state.ui.settings);
  const { addNotification } = useNotification();
  const isApiAvailable = isElectronAPIAvailable();

  const handleToggleSettings = useCallback(() => {
    dispatch(toggleSettings());
  }, [dispatch]);

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [ollamaModelLists, setOllamaModelLists] = useState({
    text: [],
    vision: [],
    embedding: [],
    all: []
  });
  const [ollamaHealth, setOllamaHealth] = useState(null);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);
  const [newModel, setNewModel] = useState('');
  const [isAddingModel, setIsAddingModel] = useState(false);
  const [pullProgress, setPullProgress] = useState(null);
  const progressUnsubRef = useRef(null);

  useEffect(() => {
    return () => {
      if (progressUnsubRef.current) {
        try {
          progressUnsubRef.current();
        } catch {
          // Non-fatal if cleanup fails
        }
        progressUnsubRef.current = null;
      }
    };
  }, []);

  const [showAllModels, setShowAllModels] = useState(false);
  const [showAnalysisHistory, setShowAnalysisHistory] = useState(false);
  const [analysisStats, setAnalysisStats] = useState(null);
  const didAutoHealthCheckRef = useRef(false);
  const skipAutoSaveRef = useRef(false);
  const cancelAutoSaveRef = useRef(null);
  const settingsRef = useRef(null);
  const uiSettingsRef = useRef(uiSettings);
  const settingsLoadedRef = useRef(false);
  const lastSavedSnapshotRef = useRef(stableStringify(sanitizeSettings(DEFAULT_SETTINGS)));

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const applySettingsUpdate = useCallback(
    (updater) => {
      setSettings((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        settingsRef.current = next;
        return next;
      });
    },
    [setSettings]
  );

  const updateLastSavedSnapshot = useCallback((nextSettings) => {
    lastSavedSnapshotRef.current = stableStringify(sanitizeSettings(nextSettings || {}));
  }, []);

  useEffect(() => {
    uiSettingsRef.current = uiSettings;
  }, [uiSettings]);

  useEffect(() => {
    settingsLoadedRef.current = settingsLoaded;
  }, [settingsLoaded]);

  const textModelOptions = useMemo(
    () => (ollamaModelLists.text.length ? ollamaModelLists.text : ollamaModelLists.all),
    [ollamaModelLists.text, ollamaModelLists.all]
  );

  const visionModelOptions = useMemo(() => ollamaModelLists.vision, [ollamaModelLists.vision]);

  const embeddingModelOptions = useMemo(() => {
    return ollamaModelLists.embedding.length > 0
      ? ollamaModelLists.embedding
      : ALLOWED_EMBED_MODELS;
  }, [ollamaModelLists.embedding]);

  const pullProgressText = useMemo(() => {
    if (!pullProgress) return null;
    const percentage =
      typeof pullProgress?.completed === 'number' && typeof pullProgress?.total === 'number'
        ? ` (${Math.floor((pullProgress.completed / Math.max(1, pullProgress.total)) * 100)}%)`
        : '';
    return `Pulling ${newModel.trim()}… ${pullProgress?.status || ''}${percentage}`;
  }, [pullProgress, newModel]);

  const loadSettings = useCallback(async () => {
    try {
      if (settingsLoadedRef.current) return;
      const hasCachedSettings =
        uiSettingsRef.current &&
        typeof uiSettingsRef.current === 'object' &&
        Object.keys(uiSettingsRef.current).length > 0;
      const savedSettings = hasCachedSettings ? uiSettingsRef.current : await settingsIpc.get();
      const mergedSettings = {
        ...DEFAULT_SETTINGS,
        ...(savedSettings || {})
      };
      skipAutoSaveRef.current = true;
      applySettingsUpdate(mergedSettings);
      dispatch(updateSettings(mergedSettings));
      updateLastSavedSnapshot(mergedSettings);
      setSettingsLoaded(true);
      settingsLoadedRef.current = true;
    } catch (error) {
      logger.error('Failed to load settings', {
        error: error.message,
        stack: error.stack
      });
      skipAutoSaveRef.current = true;
      applySettingsUpdate({ ...DEFAULT_SETTINGS });
      dispatch(updateSettings({ ...DEFAULT_SETTINGS }));
      updateLastSavedSnapshot(DEFAULT_SETTINGS);
      setSettingsLoaded(true);
      settingsLoadedRef.current = true;
    }
  }, [applySettingsUpdate, dispatch, updateLastSavedSnapshot]);

  const loadOllamaModels = useCallback(async () => {
    try {
      setIsRefreshingModels(true);
      const response = await ollamaIpc.getModels();
      const categories = response?.categories || {
        text: [],
        vision: [],
        embedding: []
      };

      const installedModels = response?.models || [];
      const installedEmbeddingModels = ALLOWED_EMBED_MODELS.filter((allowedModel) =>
        installedModels.some(
          (installed) =>
            installed === allowedModel ||
            installed.startsWith(`${allowedModel}:`) ||
            installed.includes(allowedModel)
        )
      );

      setOllamaModelLists({
        text: (categories.text || []).slice().sort(),
        vision: (categories.vision || []).slice().sort(),
        embedding: installedEmbeddingModels,
        all: installedModels.slice().sort()
      });
      if (response?.ollamaHealth) setOllamaHealth(response.ollamaHealth);
      if (response?.selected) {
        skipAutoSaveRef.current = true;
        applySettingsUpdate((prev) => {
          const desiredEmbed = response.selected.embeddingModel || prev.embeddingModel;
          const nextEmbeddingModel = ALLOWED_EMBED_MODELS.includes(desiredEmbed)
            ? desiredEmbed
            : DEFAULT_EMBED_MODEL;

          return {
            ...prev,
            textModel: response.selected.textModel || prev.textModel,
            visionModel: response.selected.visionModel || prev.visionModel,
            embeddingModel: nextEmbeddingModel,
            ollamaHost: response.host || prev.ollamaHost
          };
        });
      }
    } catch (error) {
      logger.error('Failed to load Ollama models', {
        error: error.message,
        stack: error.stack
      });
      setOllamaModelLists({ text: [], vision: [], embedding: [], all: [] });
      addNotification('Failed to load Ollama models. Check if Ollama is running.', 'warning');
    } finally {
      setIsRefreshingModels(false);
    }
  }, [addNotification, applySettingsUpdate]);

  useEffect(() => {
    if (!isApiAvailable) return undefined;

    let mounted = true;
    setIsHydrating(true);

    const loadSettingsIfMounted = async () => {
      if (mounted) {
        await loadSettings();
      }
    };

    const loadOllamaModelsIfMounted = async () => {
      if (mounted) {
        await loadOllamaModels();
      }
    };

    (async () => {
      try {
        await loadSettingsIfMounted();
        await loadOllamaModelsIfMounted();
      } finally {
        if (mounted) {
          setIsHydrating(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [isApiAvailable, loadSettings, loadOllamaModels]);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (!uiSettings || typeof uiSettings !== 'object') return;
    const mergedSettings = {
      ...DEFAULT_SETTINGS,
      ...(uiSettings || {})
    };
    const mergedSnapshot = stableStringify(sanitizeSettings(mergedSettings));
    const currentSnapshot = stableStringify(sanitizeSettings(settingsRef.current || {}));
    if (mergedSnapshot === currentSnapshot) {
      updateLastSavedSnapshot(mergedSettings);
      return;
    }
    skipAutoSaveRef.current = true;
    applySettingsUpdate(mergedSettings);
    updateLastSavedSnapshot(mergedSettings);
  }, [applySettingsUpdate, settingsLoaded, uiSettings, updateLastSavedSnapshot]);

  useEffect(() => {
    if (!isApiAvailable) return undefined;
    if (!settingsLoaded) return undefined;
    if (settings === null) return undefined;
    if (didAutoHealthCheckRef.current) return undefined;
    didAutoHealthCheckRef.current = true;

    let isMounted = true;

    (async () => {
      try {
        const res = await ollamaIpc.testConnection(settings.ollamaHost);
        if (!isMounted) return;
        setOllamaHealth(res?.ollamaHealth || null);
        if (res?.success && isMounted) {
          await loadOllamaModels();
        }
      } catch (e) {
        logger.error('Auto Ollama health check failed', {
          error: e.message
        });
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [isApiAvailable, settingsLoaded, settings, loadOllamaModels]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') handleToggleSettings();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleToggleSettings]);

  const saveSettings = useCallback(async () => {
    try {
      setIsSaving(true);
      if (cancelAutoSaveRef.current) {
        cancelAutoSaveRef.current();
      }
      const latest = {
        ...DEFAULT_SETTINGS,
        ...(settingsRef.current || settings || {})
      };
      const sanitized = sanitizeSettings(latest);
      const normalizedSettings = {
        ...sanitized
      };
      skipAutoSaveRef.current = true;
      applySettingsUpdate(normalizedSettings);
      const res = await settingsIpc.save(normalizedSettings);
      if (res?.success === false) {
        throw new Error(res?.error || 'Failed to save settings');
      }
      const savedSettings = res?.settings || normalizedSettings;
      dispatch(updateSettings(savedSettings));
      updateLastSavedSnapshot(savedSettings);
      if (Array.isArray(res?.validationWarnings) && res.validationWarnings.length > 0) {
        addNotification(`Saved with warnings: ${res.validationWarnings.join('; ')}`, 'warning');
      } else {
        addNotification('Settings saved successfully!', 'success');
      }
      handleToggleSettings();
    } catch (error) {
      logger.error('Failed to save settings', {
        error: error.message,
        stack: error.stack
      });
      addNotification(
        'Failed to save settings. Please check your settings and try again.',
        'error'
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    settings,
    dispatch,
    addNotification,
    handleToggleSettings,
    applySettingsUpdate,
    updateLastSavedSnapshot
  ]);

  const autoSaveSettings = useDebouncedCallback(async () => {
    const currentSettings = settingsRef.current;
    if (!currentSettings) return;

    try {
      const normalizedSettings = sanitizeSettings({
        ...currentSettings
      });
      const nextSnapshot = stableStringify(normalizedSettings);
      if (nextSnapshot === lastSavedSnapshotRef.current) {
        return;
      }
      const res = await settingsIpc.save(normalizedSettings);
      const savedSettings = res?.settings || normalizedSettings;
      dispatch(updateSettings(savedSettings));
      updateLastSavedSnapshot(savedSettings);
    } catch (error) {
      logger.error('Auto-save settings failed', {
        error: error.message,
        stack: error.stack
      });
    }
  }, 800);

  useEffect(() => {
    cancelAutoSaveRef.current = autoSaveSettings?.cancel || null;
  }, [autoSaveSettings]);

  useEffect(() => {
    if (!isApiAvailable || !settingsLoaded || settings === null) {
      return;
    }
    if (skipAutoSaveRef.current) {
      skipAutoSaveRef.current = false;
      return;
    }
    autoSaveSettings();
  }, [isApiAvailable, settings, settingsLoaded, autoSaveSettings]);

  useEffect(() => {
    return () => {
      if (autoSaveSettings?.flush) {
        autoSaveSettings.flush();
      }
    };
  }, [autoSaveSettings]);

  const testOllamaConnection = useCallback(async () => {
    if (!settings?.ollamaHost) return;
    try {
      const res = await ollamaIpc.testConnection(settings.ollamaHost);
      setOllamaHealth(res?.ollamaHealth || null);
      if (res?.success) {
        const modelText = res.modelCount === 1 ? '1 model' : `${res.modelCount} models`;
        addNotification(`Connected to Ollama (${modelText} available)`, 'success');
        await loadOllamaModels();
      } else {
        const errorMsg = res?.error || '';
        if (errorMsg.includes('ECONNREFUSED')) {
          addNotification('Cannot reach Ollama. Make sure it is running.', 'error');
        } else {
          addNotification('Connection failed. Check Ollama is running.', 'error');
        }
      }
    } catch (error) {
      logger.error('Ollama connection test failed', {
        error: error?.message || String(error)
      });
      addNotification('Connection test failed. Is Ollama running?', 'error');
    }
  }, [settings, addNotification, loadOllamaModels]);

  const addOllamaModel = useCallback(async () => {
    if (!newModel.trim()) return;
    try {
      setIsAddingModel(true);
      try {
        if (progressUnsubRef.current) progressUnsubRef.current();
        progressUnsubRef.current = eventsIpc.onOperationProgress((evt) => {
          if (evt?.type === 'ollama-pull' && evt?.model?.includes(newModel.trim())) {
            setPullProgress(evt.progress || {});
          }
        });
      } catch {
        // Non-fatal if progress subscription fails
      }
      const res = await ollamaIpc.pullModels([newModel.trim()]);
      const result = res?.results?.[0];
      if (result?.success) {
        addNotification(`Model "${newModel.trim()}" installed`, 'success');
        setNewModel('');
        await loadOllamaModels();
      } else {
        const errorMsg = result?.error || '';
        if (errorMsg.includes('not found') || errorMsg.includes('404')) {
          addNotification('Model not found. Check the model name on ollama.com/library', 'error');
        } else if (errorMsg.includes('timeout')) {
          addNotification('Download timed out. Try again or check your connection.', 'error');
        } else {
          addNotification('Could not install model. Check the name and try again.', 'error');
        }
      }
    } catch (error) {
      logger.error('Ollama model installation failed', {
        error: error?.message || String(error)
      });
      addNotification('Model installation failed. Check your connection.', 'error');
    } finally {
      setIsAddingModel(false);
      const NOTIFICATION_DELAY_MS = 1500;
      setTimeout(() => setPullProgress(null), NOTIFICATION_DELAY_MS);
      try {
        if (progressUnsubRef.current) progressUnsubRef.current();
        progressUnsubRef.current = null;
      } catch {
        // Non-fatal if progress unsubscribe fails
      }
    }
  }, [newModel, addNotification, loadOllamaModels]);

  const expandAll = useCallback(() => {
    try {
      SECTION_KEYS.forEach((k) => localStorage.setItem(`collapsible:${k}`, 'true'));
      window.dispatchEvent(new Event('storage'));
    } catch {
      // Non-fatal if localStorage fails
    }
  }, []);

  const collapseAll = useCallback(() => {
    try {
      SECTION_KEYS.forEach((k) => localStorage.setItem(`collapsible:${k}`, 'false'));
      window.dispatchEvent(new Event('storage'));
    } catch {
      // Non-fatal if localStorage fails
    }
  }, []);

  if (!isApiAvailable) {
    return (
      <div className="p-8 text-center">
        <Text variant="body" className="text-stratosort-danger font-medium">
          Settings unavailable
        </Text>
        <Text variant="small" className="text-system-gray-500 mt-2">
          Electron API not available. Please restart the application.
        </Text>
      </div>
    );
  }

  return (
    <div
      className="settings-modal fixed inset-0 z-modal flex items-center justify-center bg-black/50 p-6"
      style={{
        paddingTop: 'calc(var(--app-nav-height) + 1rem)',
        paddingBottom: '1.5rem'
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleToggleSettings();
      }}
      role="presentation"
    >
      <div className="surface-panel !p-0 w-full max-w-4xl mx-auto max-h-[86vh] flex flex-col overflow-hidden shadow-2xl animate-modal-enter">
        <div className="settings-modal-header px-6 py-4 border-b border-border-soft/70 bg-white flex-shrink-0 rounded-t-2xl">
          <div className="flex items-start sm:items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <SettingsIcon className="h-5 w-5 text-stratosort-blue" aria-hidden="true" />
                <Heading as="h2" variant="h4">
                  Settings
                </Heading>
              </div>
              <Text variant="tiny" className="text-system-gray-500 mt-1">
                Configure AI models, performance, default folders, and app behavior.
              </Text>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <IconButton
                icon={<ChevronsDown className="w-4 h-4" />}
                size="md"
                variant="secondary"
                onClick={expandAll}
                aria-label="Expand all settings sections"
                title="Expand all"
              />
              <IconButton
                icon={<ChevronsUp className="w-4 h-4" />}
                size="md"
                variant="secondary"
                onClick={collapseAll}
                aria-label="Collapse all settings sections"
                title="Collapse all"
              />
              <IconButton
                icon={<X className="w-4 h-4" />}
                size="md"
                variant="ghost"
                onClick={handleToggleSettings}
                aria-label="Close settings"
                title="Close"
              />
            </div>
          </div>
        </div>

        <div className="px-6 py-6 flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto modern-scrollbar">
          <Collapsible
            title={
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-stratosort-blue" aria-hidden="true" />
                <span>AI Configuration</span>
              </div>
            }
            defaultOpen={false}
            persistKey="settings-ai"
          >
            <Stack gap="default">
              <OllamaConfigSection
                settings={settings}
                setSettings={applySettingsUpdate}
                ollamaHealth={ollamaHealth}
                isRefreshingModels={isRefreshingModels}
                pullProgressText={pullProgressText}
                showAllModels={showAllModels}
                setShowAllModels={setShowAllModels}
                ollamaModelLists={ollamaModelLists}
                onTestConnection={testOllamaConnection}
                onRefreshModels={loadOllamaModels}
              />
              <ModelSelectionSection
                settings={settings}
                setSettings={applySettingsUpdate}
                textModelOptions={textModelOptions}
                visionModelOptions={visionModelOptions}
                embeddingModelOptions={embeddingModelOptions}
              />
              <ChatPersonaSection settings={settings} setSettings={applySettingsUpdate} />
              <ModelManagementSection
                newModel={newModel}
                setNewModel={setNewModel}
                isAddingModel={isAddingModel}
                onAddModel={addOllamaModel}
              />
              <EmbeddingRebuildSection addNotification={addNotification} />
            </Stack>
          </Collapsible>

          <Collapsible
            title={
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-stratosort-blue" aria-hidden="true" />
                <span>Performance</span>
              </div>
            }
            defaultOpen={false}
            persistKey="settings-performance"
          >
            <Stack gap="default">
              <AutoOrganizeSection settings={settings} setSettings={applySettingsUpdate} />
              <BackgroundModeSection settings={settings} setSettings={applySettingsUpdate} />
            </Stack>
          </Collapsible>

          <Collapsible
            title={
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-stratosort-blue" aria-hidden="true" />
                <span>Default Locations</span>
              </div>
            }
            defaultOpen={false}
            persistKey="settings-defaults"
          >
            <Stack gap="default">
              <DefaultLocationsSection settings={settings} setSettings={applySettingsUpdate} />
              <div className="pt-6 border-t border-system-gray-200">
                <NamingSettingsSection settings={settings} setSettings={applySettingsUpdate} />
              </div>
            </Stack>
          </Collapsible>

          <Collapsible
            title={
              <div className="flex items-center gap-2">
                <Monitor className="h-4 w-4 text-stratosort-blue" aria-hidden="true" />
                <span>Application</span>
              </div>
            }
            defaultOpen={false}
            persistKey="settings-app"
          >
            <Stack gap="default">
              <ApplicationSection settings={settings} setSettings={applySettingsUpdate} />
              <div className="pt-6 border-t border-system-gray-200">
                <NotificationSettingsSection
                  settings={settings}
                  setSettings={applySettingsUpdate}
                />
              </div>
              <div className="pt-6 border-t border-system-gray-200">
                <SettingsBackupSection addNotification={addNotification} />
              </div>
            </Stack>
          </Collapsible>

          <Collapsible
            title={
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-stratosort-blue" aria-hidden="true" />
                <span>Analysis History</span>
              </div>
            }
            defaultOpen={false}
            persistKey="settings-history"
          >
            <Stack gap="cozy">
              <Text variant="small" className="text-system-gray-600">
                View and manage your file analysis history, including past results and statistics.
              </Text>
              <Button
                onClick={() => setShowAnalysisHistory(true)}
                variant="secondary"
                className="w-fit"
              >
                View Analysis History
              </Button>
            </Stack>
          </Collapsible>

          <Collapsible
            title={
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-stratosort-blue" aria-hidden="true" />
                <span>Backend API Test</span>
              </div>
            }
            defaultOpen={false}
            persistKey="settings-api"
          >
            <APITestSection addNotification={addNotification} />
          </Collapsible>
        </div>

        <div className="px-6 py-4 border-t border-border-soft/70 bg-white flex items-center justify-end gap-3 flex-shrink-0 rounded-b-2xl">
          <Button
            onClick={handleToggleSettings}
            variant="secondary"
            size="sm"
            leftIcon={<X className="w-4 h-4" />}
          >
            Cancel
          </Button>
          <Button
            onClick={saveSettings}
            variant="primary"
            size="sm"
            disabled={isSaving}
            leftIcon={<Save className="w-4 h-4" />}
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </div>
      {showAnalysisHistory && (
        <Suspense fallback={<ModalLoadingOverlay message="Loading History..." />}>
          <AnalysisHistoryModal
            onClose={() => setShowAnalysisHistory(false)}
            analysisStats={analysisStats}
            setAnalysisStats={setAnalysisStats}
          />
        </Suspense>
      )}
      {isHydrating && <ModalLoadingOverlay message="Loading settings..." />}
    </div>
  );
});

export default SettingsPanel;
