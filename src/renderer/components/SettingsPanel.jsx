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
import { SERVICE_URLS } from '../../shared/configDefaults';
import { useNotification } from '../contexts/NotificationContext';
import { useAppDispatch } from '../store/hooks';
import { toggleSettings } from '../store/slices/uiSlice';
import { useDebouncedCallback } from '../hooks/usePerformance';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import Collapsible from './ui/Collapsible';
import { ModalLoadingOverlay } from './LoadingSkeleton';
import AutoOrganizeSection from './settings/AutoOrganizeSection';
import BackgroundModeSection from './settings/BackgroundModeSection';
import OllamaConfigSection from './settings/OllamaConfigSection';
import ModelSelectionSection from './settings/ModelSelectionSection';
import ModelManagementSection from './settings/ModelManagementSection';
import EmbeddingRebuildSection from './settings/EmbeddingRebuildSection';
import DefaultLocationsSection from './settings/DefaultLocationsSection';
import ApplicationSection from './settings/ApplicationSection';
import APITestSection from './settings/APITestSection';

const AnalysisHistoryModal = lazy(() => import('./AnalysisHistoryModal'));

// Section keys for expand/collapse all functionality
const SECTION_KEYS = [
  'settings-ai',
  'settings-performance',
  'settings-defaults',
  'settings-app',
  'settings-api'
];

// Set logger context for this component
logger.setContext('SettingsPanel');

// FIX: Helper to safely check if electronAPI is available
const isElectronAPIAvailable = () => {
  return typeof window !== 'undefined' && window.electronAPI != null;
};

const SAFE_EMBED_MODEL = 'mxbai-embed-large';

const SettingsPanel = React.memo(function SettingsPanel() {
  const dispatch = useAppDispatch();

  // FIX: All hooks must be called before any conditional returns (React hooks rules)
  const { addNotification } = useNotification();

  // Check if electronAPI is available (used for conditional rendering at end)
  const isApiAvailable = isElectronAPIAvailable();

  // Memoize the toggleSettings function - dispatch is stable so no recreations
  const handleToggleSettings = useCallback(() => {
    dispatch(toggleSettings());
  }, [dispatch]);

  const [settings, setSettings] = useState({
    ollamaHost: SERVICE_URLS.OLLAMA_HOST,
    textModel: 'llama3.2:latest',
    visionModel: 'llava:latest',
    embeddingModel: 'mxbai-embed-large',
    maxConcurrentAnalysis: 3,
    autoOrganize: false,
    backgroundMode: false,
    defaultSmartFolderLocation: 'Documents',
    launchOnStartup: false
  });
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
  const [newModel, setNewModel] = useState('');
  const [modelToDelete, setModelToDelete] = useState('');
  const [isAddingModel, setIsAddingModel] = useState(false);
  const [isDeletingModel, setIsDeletingModel] = useState(false);
  const [pullProgress, setPullProgress] = useState(null);
  const progressUnsubRef = useRef(null);
  const [showAllModels, setShowAllModels] = useState(false);
  const [showAnalysisHistory, setShowAnalysisHistory] = useState(false);
  const [analysisStats, setAnalysisStats] = useState(null);
  const didAutoHealthCheckRef = useRef(false);
  const skipAutoSaveRef = useRef(false);

  // Memoized computed values
  // Text models: use categorized list, but fall back to all if empty (text is the default category)
  const textModelOptions = useMemo(
    () => (ollamaModelLists.text.length ? ollamaModelLists.text : ollamaModelLists.all),
    [ollamaModelLists.text, ollamaModelLists.all]
  );

  // Vision models: only show vision-capable models, don't fall back to all models
  // If no vision models detected, return empty array (UI will show helpful message)
  const visionModelOptions = useMemo(() => ollamaModelLists.vision, [ollamaModelLists.vision]);

  const embeddingModelOptions = useMemo(() => {
    // Only expose the vetted embedding model to keep vector dimensions stable
    const allowed = new Set([SAFE_EMBED_MODEL]);
    if (settings.embeddingModel && settings.embeddingModel === SAFE_EMBED_MODEL) {
      allowed.add(settings.embeddingModel);
    }
    return Array.from(allowed);
  }, [settings.embeddingModel]);

  const pullProgressText = useMemo(() => {
    if (!pullProgress) return null;
    const percentage =
      typeof pullProgress?.completed === 'number' && typeof pullProgress?.total === 'number'
        ? ` (${Math.floor((pullProgress.completed / Math.max(1, pullProgress.total)) * 100)}%)`
        : '';
    return `Pulling ${newModel.trim()}… ${pullProgress?.status || ''}${percentage}`;
  }, [pullProgress, newModel]);

  // Load settings on mount
  const loadSettings = useCallback(async () => {
    try {
      const savedSettings = await window.electronAPI.settings.get();
      if (savedSettings) {
        // Avoid auto-save loops caused by setSettings during hydration
        skipAutoSaveRef.current = true;
        setSettings((prev) => ({ ...prev, ...savedSettings }));
      }
      setSettingsLoaded(true);
    } catch (error) {
      logger.error('Failed to load settings', {
        error: error.message,
        stack: error.stack
      });
      setSettingsLoaded(true);
    }
  }, []);

  // Load Ollama models
  const loadOllamaModels = useCallback(async () => {
    try {
      setIsRefreshingModels(true);
      const response = await window.electronAPI.ollama.getModels();
      const categories = response?.categories || {
        text: [],
        vision: [],
        embedding: []
      };

      setOllamaModelLists({
        text: (categories.text || []).slice().sort(),
        vision: (categories.vision || []).slice().sort(),
        // We intentionally do not expose arbitrary embedding models to keep vector size fixed
        embedding: [SAFE_EMBED_MODEL],
        all: (response?.models || []).slice().sort()
      });
      setModelToDelete((response?.models || [])[0] || '');
      if (response?.ollamaHealth) setOllamaHealth(response.ollamaHealth);
      if (response?.selected) {
        // Avoid auto-save loops caused by setSettings during hydration
        skipAutoSaveRef.current = true;
        setSettings((prev) => {
          const desiredEmbed = response.selected.embeddingModel || prev.embeddingModel;
          const nextEmbeddingModel =
            desiredEmbed === SAFE_EMBED_MODEL ? desiredEmbed : SAFE_EMBED_MODEL;

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
    } finally {
      setIsRefreshingModels(false);
    }
  }, []);

  useEffect(() => {
    // Don't run if API is not available
    if (!isApiAvailable) return undefined;

    let mounted = true;

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

    loadSettingsIfMounted();
    loadOllamaModelsIfMounted();

    return () => {
      mounted = false;
    };
  }, [isApiAvailable, loadSettings, loadOllamaModels]);

  // After settings are loaded the first time, automatically check Ollama health
  useEffect(() => {
    if (!isApiAvailable) return undefined;
    if (!settingsLoaded) return undefined;
    if (didAutoHealthCheckRef.current) return undefined;
    didAutoHealthCheckRef.current = true;

    let isMounted = true;

    (async () => {
      try {
        const res = await window.electronAPI.ollama.testConnection(settings.ollamaHost);
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
  }, [isApiAvailable, settingsLoaded, settings.ollamaHost, loadOllamaModels]);

  // UX: allow ESC to close settings
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
      const normalizedSettings = sanitizeSettings(settings);
      // Avoid auto-save loops caused by setSettings during explicit save
      skipAutoSaveRef.current = true;
      setSettings(normalizedSettings);
      const res = await window.electronAPI.settings.save(normalizedSettings);
      // Apply canonical settings returned from main (may include normalization / warnings)
      if (res?.settings && typeof res.settings === 'object') {
        skipAutoSaveRef.current = true;
        setSettings((prev) => ({ ...prev, ...res.settings }));
      }
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
      addNotification('Failed to save settings', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [settings, addNotification, handleToggleSettings]);

  // Auto-save settings on change (debounced)
  const autoSaveSettings = useDebouncedCallback(
    async () => {
      try {
        const normalizedSettings = sanitizeSettings(settings);
        const res = await window.electronAPI.settings.save(normalizedSettings);
        if (res?.settings && typeof res.settings === 'object') {
          skipAutoSaveRef.current = true;
          setSettings((prev) => ({ ...prev, ...res.settings }));
        }
      } catch (error) {
        logger.error('Auto-save settings failed', {
          error: error.message,
          stack: error.stack
        });
      }
    },
    800,
    [settings]
  );

  useEffect(() => {
    if (isApiAvailable && settingsLoaded) {
      // Prevent auto-save storm during initial hydration or when we just applied canonical settings.
      if (skipAutoSaveRef.current) {
        skipAutoSaveRef.current = false;
        return;
      }
      autoSaveSettings();
    }
  }, [isApiAvailable, settings, settingsLoaded, autoSaveSettings]);

  const testOllamaConnection = useCallback(async () => {
    try {
      const res = await window.electronAPI.ollama.testConnection(settings.ollamaHost);
      setOllamaHealth(res?.ollamaHealth || null);
      if (res?.success) {
        addNotification(`Ollama connected: ${res.modelCount} models found`, 'success');
        await loadOllamaModels();
      } else {
        addNotification(`Ollama connection failed: ${res?.error || 'Unknown error'}`, 'error');
      }
    } catch (e) {
      addNotification(`Ollama test failed: ${e.message}`, 'error');
    }
  }, [settings.ollamaHost, addNotification, loadOllamaModels]);

  const addOllamaModel = useCallback(async () => {
    if (!newModel.trim()) return;
    try {
      setIsAddingModel(true);
      try {
        if (progressUnsubRef.current) progressUnsubRef.current();
        progressUnsubRef.current = window.electronAPI.events.onOperationProgress((evt) => {
          if (evt?.type === 'ollama-pull' && evt?.model?.includes(newModel.trim())) {
            setPullProgress(evt.progress || {});
          }
        });
      } catch {
        // Non-fatal if progress subscription fails
      }
      const res = await window.electronAPI.ollama.pullModels([newModel.trim()]);
      const result = res?.results?.[0];
      if (result?.success) {
        addNotification(`Added model ${newModel.trim()}`, 'success');
        setNewModel('');
        await loadOllamaModels();
      } else {
        addNotification(`Failed to add model: ${result?.error || 'Unknown error'}`, 'error');
      }
    } catch (e) {
      addNotification(`Failed to add model: ${e.message}`, 'error');
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

  const deleteOllamaModel = useCallback(async () => {
    if (!modelToDelete) return;
    try {
      setIsDeletingModel(true);
      const res = await window.electronAPI.ollama.deleteModel(modelToDelete);
      if (res?.success) {
        addNotification(`Deleted model ${modelToDelete}`, 'success');
        setModelToDelete('');
        await loadOllamaModels();
      } else {
        addNotification(`Failed to delete model: ${res?.error || 'Unknown error'}`, 'error');
      }
    } catch (e) {
      addNotification(`Failed to delete model: ${e.message}`, 'error');
    } finally {
      setIsDeletingModel(false);
    }
  }, [modelToDelete, addNotification, loadOllamaModels]);

  // Collapsible section keys for expand/collapse all
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

  // FIX: Guard against missing electronAPI - moved after all hooks to follow React rules
  if (!isApiAvailable) {
    return (
      <div className="p-[var(--panel-padding)] text-center">
        <p className="text-red-600 font-medium">Settings unavailable</p>
        <p className="text-sm text-system-gray-500 mt-[var(--spacing-sm)]">
          Electron API not available. Please restart the application.
        </p>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/50 backdrop-blur-sm p-[var(--panel-padding)]"
      onMouseDown={(e) => {
        // UX: click backdrop closes settings (like a real modal)
        if (e.target === e.currentTarget) handleToggleSettings();
      }}
      role="presentation"
    >
      <div className="surface-panel w-full max-w-5xl mx-auto max-h-[86vh] flex flex-col overflow-hidden shadow-2xl animate-modal-enter">
        <div className="p-[var(--panel-padding)] border-b border-border-soft/70 bg-white/90 backdrop-blur-sm flex-shrink-0 rounded-t-[var(--radius-panel)]">
          <div className="flex items-start sm:items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <SettingsIcon className="h-5 w-5 text-stratosort-blue" aria-hidden="true" />
                <h2 className="heading-secondary">Settings</h2>
              </div>
              <p className="text-xs text-system-gray-500 mt-1">
                Configure AI models, performance, default folders, and app behavior.
              </p>
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

        <div className="p-[var(--panel-padding)] flex flex-col gap-[var(--spacing-default)] flex-1 min-h-0 overflow-y-auto modern-scrollbar">
          <Collapsible
            title={
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-stratosort-blue" aria-hidden="true" />
                <span>AI Configuration</span>
              </div>
            }
            defaultOpen
            persistKey="settings-ai"
          >
            <div className="flex flex-col gap-[var(--spacing-default)]">
              <OllamaConfigSection
                settings={settings}
                setSettings={setSettings}
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
                setSettings={setSettings}
                textModelOptions={textModelOptions}
                visionModelOptions={visionModelOptions}
                embeddingModelOptions={embeddingModelOptions}
              />
              <ModelManagementSection
                newModel={newModel}
                setNewModel={setNewModel}
                modelToDelete={modelToDelete}
                setModelToDelete={setModelToDelete}
                ollamaModelLists={ollamaModelLists}
                isAddingModel={isAddingModel}
                isDeletingModel={isDeletingModel}
                onAddModel={addOllamaModel}
                onDeleteModel={deleteOllamaModel}
              />
              <EmbeddingRebuildSection addNotification={addNotification} />
            </div>
          </Collapsible>

          <Collapsible
            title={
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-stratosort-blue" aria-hidden="true" />
                <span>Performance</span>
              </div>
            }
            defaultOpen
            persistKey="settings-performance"
          >
            <div className="flex flex-col gap-[var(--spacing-default)]">
              <div>
                <label className="block text-sm font-medium text-system-gray-700 mb-2">
                  Max Concurrent Analysis ({settings.maxConcurrentAnalysis})
                </label>
                <input
                  type="range"
                  min="1"
                  max="8"
                  value={settings.maxConcurrentAnalysis}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      maxConcurrentAnalysis: parseInt(e.target.value, 10)
                    }))
                  }
                  className="w-full"
                />
              </div>
              <AutoOrganizeSection settings={settings} setSettings={setSettings} />
              <BackgroundModeSection settings={settings} setSettings={setSettings} />
            </div>
          </Collapsible>

          <Collapsible
            title={
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-stratosort-blue" aria-hidden="true" />
                <span>Default Locations</span>
              </div>
            }
            defaultOpen
            persistKey="settings-defaults"
          >
            <DefaultLocationsSection settings={settings} setSettings={setSettings} />
          </Collapsible>

          <Collapsible
            title={
              <div className="flex items-center gap-2">
                <Monitor className="h-4 w-4 text-stratosort-blue" aria-hidden="true" />
                <span>Application</span>
              </div>
            }
            defaultOpen
            persistKey="settings-app"
          >
            <ApplicationSection settings={settings} setSettings={setSettings} />
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
            <div className="flex flex-col gap-[var(--spacing-cozy)]">
              <p className="text-sm text-system-gray-600">
                View and manage your file analysis history, including past results and statistics.
              </p>
              <Button
                onClick={() => setShowAnalysisHistory(true)}
                variant="secondary"
                className="w-fit"
              >
                View Analysis History
              </Button>
            </div>
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

        <div className="p-[var(--panel-padding)] border-t border-border-soft/70 bg-white/90 backdrop-blur-sm flex items-center justify-end gap-3 flex-shrink-0 rounded-b-[var(--radius-panel)]">
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
    </div>
  );
});

export default SettingsPanel;
