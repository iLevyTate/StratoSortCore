import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  Suspense,
  lazy,
} from 'react';
import { logger } from '../../shared/logger';
import { sanitizeSettings } from '../../shared/settingsValidation';
import { useNotification } from '../contexts/NotificationContext';
import { useAppDispatch } from '../store/hooks';
import { toggleSettings } from '../store/slices/uiSlice';
import { useDebouncedCallback } from '../hooks/usePerformance';
import Button from './ui/Button';
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
  'settings-api',
];

// Set logger context for this component
logger.setContext('SettingsPanel');

// FIX: Helper to safely check if electronAPI is available
const isElectronAPIAvailable = () => {
  return typeof window !== 'undefined' && window.electronAPI != null;
};

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
    ollamaHost: 'http://127.0.0.1:11434',
    textModel: 'llama3.2:latest',
    visionModel: 'llava:latest',
    embeddingModel: 'mxbai-embed-large',
    maxConcurrentAnalysis: 3,
    autoOrganize: false,
    backgroundMode: false,
    defaultSmartFolderLocation: 'Documents',
    launchOnStartup: false,
  });
  const [ollamaModelLists, setOllamaModelLists] = useState({
    text: [],
    vision: [],
    embedding: [],
    all: [],
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

  // Memoized computed values
  const textModelOptions = useMemo(
    () =>
      ollamaModelLists.text.length
        ? ollamaModelLists.text
        : ollamaModelLists.all,
    [ollamaModelLists.text, ollamaModelLists.all],
  );

  const visionModelOptions = useMemo(
    () =>
      ollamaModelLists.vision.length
        ? ollamaModelLists.vision
        : ollamaModelLists.all,
    [ollamaModelLists.vision, ollamaModelLists.all],
  );

  const embeddingModelOptions = useMemo(
    () =>
      ollamaModelLists.embedding.length
        ? ollamaModelLists.embedding
        : ollamaModelLists.all,
    [ollamaModelLists.embedding, ollamaModelLists.all],
  );

  const pullProgressText = useMemo(() => {
    if (!pullProgress) return null;
    const percentage =
      typeof pullProgress?.completed === 'number' &&
      typeof pullProgress?.total === 'number'
        ? ` (${Math.floor((pullProgress.completed / Math.max(1, pullProgress.total)) * 100)}%)`
        : '';
    return `Pulling ${newModel.trim()}… ${pullProgress?.status || ''}${percentage}`;
  }, [pullProgress, newModel]);

  // Load settings on mount
  const loadSettings = useCallback(async () => {
    try {
      const savedSettings = await window.electronAPI.settings.get();
      if (savedSettings) {
        setSettings((prev) => ({ ...prev, ...savedSettings }));
      }
      setSettingsLoaded(true);
    } catch (error) {
      logger.error('Failed to load settings', {
        error: error.message,
        stack: error.stack,
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
        embedding: [],
      };
      setOllamaModelLists({
        text: (categories.text || []).slice().sort(),
        vision: (categories.vision || []).slice().sort(),
        embedding: (categories.embedding || []).slice().sort(),
        all: (response?.models || []).slice().sort(),
      });
      setModelToDelete((response?.models || [])[0] || '');
      if (response?.ollamaHealth) setOllamaHealth(response.ollamaHealth);
      if (response?.selected) {
        setSettings((prev) => ({
          ...prev,
          textModel: response.selected.textModel || prev.textModel,
          visionModel: response.selected.visionModel || prev.visionModel,
          embeddingModel:
            response.selected.embeddingModel || prev.embeddingModel,
          ollamaHost: response.host || prev.ollamaHost,
        }));
      }
    } catch (error) {
      logger.error('Failed to load Ollama models', {
        error: error.message,
        stack: error.stack,
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
        const res = await window.electronAPI.ollama.testConnection(
          settings.ollamaHost,
        );
        if (!isMounted) return;
        setOllamaHealth(res?.ollamaHealth || null);
        if (res?.success && isMounted) {
          await loadOllamaModels();
        }
      } catch (e) {
        logger.error('Auto Ollama health check failed', {
          error: e.message,
        });
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [isApiAvailable, settingsLoaded, settings.ollamaHost, loadOllamaModels]);

  const saveSettings = useCallback(async () => {
    try {
      setIsSaving(true);
      const normalizedSettings = sanitizeSettings(settings);
      setSettings(normalizedSettings);
      await window.electronAPI.settings.save(normalizedSettings);
      addNotification('Settings saved successfully!', 'success');
      handleToggleSettings();
    } catch (error) {
      logger.error('Failed to save settings', {
        error: error.message,
        stack: error.stack,
      });
      addNotification('Failed to save settings', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [settings, addNotification, handleToggleSettings, sanitizeSettings]);

  // Auto-save settings on change (debounced)
  const autoSaveSettings = useDebouncedCallback(
    async () => {
      try {
        const normalizedSettings = sanitizeSettings(settings);
        setSettings(normalizedSettings);
        await window.electronAPI.settings.save(normalizedSettings);
      } catch (error) {
        logger.error('Auto-save settings failed', {
          error: error.message,
          stack: error.stack,
        });
      }
    },
    800,
    [sanitizeSettings],
  );

  useEffect(() => {
    if (isApiAvailable && settingsLoaded) {
      autoSaveSettings();
    }
  }, [isApiAvailable, settings, settingsLoaded, autoSaveSettings]);

  const testOllamaConnection = useCallback(async () => {
    try {
      const res = await window.electronAPI.ollama.testConnection(
        settings.ollamaHost,
      );
      setOllamaHealth(res?.ollamaHealth || null);
      if (res?.success) {
        addNotification(
          `Ollama connected: ${res.modelCount} models found`,
          'success',
        );
        await loadOllamaModels();
      } else {
        addNotification(
          `Ollama connection failed: ${res?.error || 'Unknown error'}`,
          'error',
        );
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
        progressUnsubRef.current =
          window.electronAPI.events.onOperationProgress((evt) => {
            if (
              evt?.type === 'ollama-pull' &&
              evt?.model?.includes(newModel.trim())
            ) {
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
        addNotification(
          `Failed to add model: ${result?.error || 'Unknown error'}`,
          'error',
        );
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
        addNotification(
          `Failed to delete model: ${res?.error || 'Unknown error'}`,
          'error',
        );
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
      SECTION_KEYS.forEach((k) =>
        localStorage.setItem(`collapsible:${k}`, 'true'),
      );
      window.dispatchEvent(new Event('storage'));
    } catch {
      // Non-fatal if localStorage fails
    }
  }, []);

  const collapseAll = useCallback(() => {
    try {
      SECTION_KEYS.forEach((k) =>
        localStorage.setItem(`collapsible:${k}`, 'false'),
      );
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
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/50 backdrop-blur-sm p-[var(--panel-padding)]">
      <div className="surface-panel w-full max-w-2xl xl:max-w-4xl 2xl:max-w-5xl mx-auto max-h-[86vh] flex flex-col overflow-hidden shadow-2xl animate-modal-enter">
        <div className="p-[var(--panel-padding)] border-b border-border-soft/70 bg-white/90 backdrop-blur-sm flex-shrink-0 rounded-t-[var(--radius-panel)]">
          <div className="flex items-center justify-between">
            <h2 className="heading-secondary">⚙️ Settings</h2>
            <div className="flex flex-wrap items-center gap-[var(--spacing-md)]">
              <Button
                onClick={expandAll}
                variant="subtle"
                className="text-xs px-[var(--spacing-md)]"
              >
                Expand all
              </Button>
              <Button
                onClick={collapseAll}
                variant="subtle"
                className="text-xs px-[var(--spacing-md)]"
              >
                Collapse all
              </Button>
              <Button
                onClick={handleToggleSettings}
                variant="ghost"
                className="text-system-gray-500 hover:text-system-gray-700 p-[var(--spacing-sm)]"
                aria-label="Close settings"
                title="Close settings"
              >
                ✕
              </Button>
            </div>
          </div>
        </div>

        <div className="p-[var(--panel-padding)] flex flex-col gap-[var(--section-gap)] flex-1 min-h-0 overflow-y-auto modern-scrollbar">
          <Collapsible
            title="🤖 AI Configuration"
            defaultOpen
            persistKey="settings-ai"
          >
            <div className="flex flex-col gap-[var(--section-gap)]">
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
            title="⚡ Performance"
            defaultOpen
            persistKey="settings-performance"
          >
            <div className="flex flex-col gap-[var(--section-gap)]">
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
                      maxConcurrentAnalysis: parseInt(e.target.value),
                    }))
                  }
                  className="w-full"
                />
              </div>
              <AutoOrganizeSection
                settings={settings}
                setSettings={setSettings}
              />
              <BackgroundModeSection
                settings={settings}
                setSettings={setSettings}
              />
            </div>
          </Collapsible>

          <Collapsible
            title="📁 Default Locations"
            defaultOpen
            persistKey="settings-defaults"
          >
            <DefaultLocationsSection
              settings={settings}
              setSettings={setSettings}
            />
          </Collapsible>

          <Collapsible
            title="🖥️ Application"
            defaultOpen
            persistKey="settings-app"
          >
            <ApplicationSection settings={settings} setSettings={setSettings} />
          </Collapsible>

          <Collapsible
            title="📜 Analysis History"
            defaultOpen={false}
            persistKey="settings-history"
          >
            <div className="flex flex-col gap-[var(--spacing-cozy)]">
              <p className="text-sm text-system-gray-600">
                View and manage your file analysis history, including past
                results and statistics.
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
            title="🔧 Backend API Test"
            defaultOpen={false}
            persistKey="settings-api"
          >
            <APITestSection addNotification={addNotification} />
          </Collapsible>
        </div>

        <div className="p-[var(--panel-padding)] border-t border-border-soft/70 bg-white/90 backdrop-blur-sm flex flex-wrap justify-end gap-[var(--spacing-xl)] flex-shrink-0 rounded-b-[var(--radius-panel)]">
          <Button onClick={handleToggleSettings} variant="secondary">
            Cancel
          </Button>
          <Button onClick={saveSettings} variant="primary" disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </div>
      {showAnalysisHistory && (
        <Suspense
          fallback={<ModalLoadingOverlay message="Loading History..." />}
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
});

export default SettingsPanel;
