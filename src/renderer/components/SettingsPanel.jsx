import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { logger } from '../../shared/logger';
import { useNotification } from '../contexts/NotificationContext';
import { usePhase } from '../contexts/PhaseContext';
import { useDebouncedCallback } from '../hooks/usePerformance';
import Button from './ui/Button';
import Input from './ui/Input';
import Select from './ui/Select';
import Collapsible from './ui/Collapsible';
import AutoOrganizeSection from './settings/AutoOrganizeSection';
import BackgroundModeSection from './settings/BackgroundModeSection';

// Set logger context for this component
logger.setContext('SettingsPanel');

const SettingsPanel = React.memo(function SettingsPanel() {
  const { actions } = usePhase();
  const { addNotification } = useNotification();

  // Memoize the toggleSettings function to avoid unnecessary re-renders
  const handleToggleSettings = useCallback(() => {
    actions.toggleSettings();
  }, [actions]);
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
  const [testResults, setTestResults] = useState({});
  const [isTestingApi, setIsTestingApi] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRebuildingFolders, setIsRebuildingFolders] = useState(false);
  const [isRebuildingFiles, setIsRebuildingFiles] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [newModel, setNewModel] = useState('');
  const [modelToDelete, setModelToDelete] = useState('');
  const [isAddingModel, setIsAddingModel] = useState(false);
  const [isDeletingModel, setIsDeletingModel] = useState(false);
  const [pullProgress, setPullProgress] = useState(null);
  const progressUnsubRef = useRef(null);
  const [showAllModels, setShowAllModels] = useState(false);
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

  useEffect(() => {
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
  }, []);

  // After settings are loaded the first time, automatically check Ollama health
  useEffect(() => {
    if (!settingsLoaded) return;
    if (didAutoHealthCheckRef.current) return;
    didAutoHealthCheckRef.current = true;
    (async () => {
      try {
        const res = await window.electronAPI.ollama.testConnection(
          settings.ollamaHost,
        );
        setOllamaHealth(res?.ollamaHealth || null);
        if (res?.success) {
          // Refresh models to reflect current host/models
          await loadOllamaModels();
        }
      } catch (e) {
        // Silent fail; status text already reflects failure via GET_MODELS
        logger.error('Auto Ollama health check failed', {
          error: e.message,
        });
      }
    })();
  }, [settingsLoaded]);

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

  const saveSettings = useCallback(async () => {
    try {
      setIsSaving(true);
      await window.electronAPI.settings.save(settings);
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
  }, [settings, addNotification, handleToggleSettings]);

  // Auto-save settings on change (debounced), without closing the panel or toasts
  const autoSaveSettings = useDebouncedCallback(
    async () => {
      try {
        await window.electronAPI.settings.save(settings);
      } catch (error) {
        logger.error('Auto-save settings failed', {
          error: error.message,
          stack: error.stack,
        });
      }
    },
    800,
    [],
  );

  // Trigger auto-save when settings change
  useEffect(() => {
    if (settingsLoaded) {
      autoSaveSettings();
    }
  }, [settings, settingsLoaded, autoSaveSettings]);

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
      // subscribe to progress
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
      // Use constant for notification delay (1.5 seconds)
      const NOTIFICATION_DELAY_MS = 1500; // Could be moved to shared constants
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

  const runAPITests = useCallback(async () => {
    setIsTestingApi(true);
    const results = {};

    try {
      await window.electronAPI.files.getDocumentsPath();
      results.fileOperations = '✅ Working';
    } catch (error) {
      results.fileOperations = `❌ Error: ${error.message}`;
    }

    try {
      await window.electronAPI.smartFolders.get();
      results.smartFolders = '✅ Working';
    } catch (error) {
      results.smartFolders = `❌ Error: ${error.message}`;
    }

    try {
      await window.electronAPI.analysisHistory.getStatistics();
      results.analysisHistory = '✅ Working';
    } catch (error) {
      results.analysisHistory = `❌ Error: ${error.message}`;
    }

    try {
      await window.electronAPI.undoRedo.canUndo();
      results.undoRedo = '✅ Working';
    } catch (error) {
      results.undoRedo = `❌ Error: ${error.message}`;
    }

    try {
      await window.electronAPI.system.getApplicationStatistics();
      results.systemMonitoring = '✅ Working';
    } catch (error) {
      results.systemMonitoring = `❌ Error: ${error.message}`;
    }

    try {
      await window.electronAPI.ollama.getModels();
      results.ollama = '✅ Working';
    } catch (error) {
      results.ollama = `❌ Error: ${error.message}`;
    }

    setTestResults(results);
    setIsTestingApi(false);
    addNotification('API tests completed', 'info');
  }, [addNotification]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl xl:max-w-4xl 2xl:max-w-5xl w-full mx-21 max-h-[85vh] overflow-y-auto modern-scrollbar">
        <div className="p-21 border-b border-system-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-system-gray-900">
              ⚙️ Settings
            </h2>
            <div className="flex items-center gap-8">
              <Button
                onClick={() => {
                  try {
                    [
                      'settings-ai',
                      'settings-performance',
                      'settings-defaults',
                      'settings-api',
                    ].forEach((k) =>
                      localStorage.setItem(`collapsible:${k}`, 'true'),
                    );
                    window.dispatchEvent(new Event('storage'));
                  } catch {
                    // Non-fatal if localStorage fails
                  }
                }}
                variant="subtle"
                className="text-xs"
              >
                Expand all
              </Button>
              <Button
                onClick={() => {
                  try {
                    [
                      'settings-ai',
                      'settings-performance',
                      'settings-defaults',
                      'settings-api',
                    ].forEach((k) =>
                      localStorage.setItem(`collapsible:${k}`, 'false'),
                    );
                    window.dispatchEvent(new Event('storage'));
                  } catch {
                    // Non-fatal if localStorage fails
                  }
                }}
                variant="subtle"
                className="text-xs"
              >
                Collapse all
              </Button>
              <Button
                onClick={handleToggleSettings}
                variant="ghost"
                className="text-system-gray-500 hover:text-system-gray-700 p-5"
                aria-label="Close settings"
                title="Close settings"
              >
                ✕
              </Button>
            </div>
          </div>
        </div>

        <div className="p-21 space-y-21">
          <Collapsible
            title="🤖 AI Configuration"
            defaultOpen
            persistKey="settings-ai"
          >
            <div className="space-y-13">
              <div>
                <label className="block text-sm font-medium text-system-gray-700 mb-5">
                  Ollama Host URL
                </label>
                <div className="flex gap-8">
                  <Input
                    type="text"
                    value={settings.ollamaHost}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        ollamaHost: e.target.value,
                      }))
                    }
                    placeholder="http://127.0.0.1:11434"
                    className="flex-1"
                  />
                  <Button
                    onClick={testOllamaConnection}
                    variant="secondary"
                    type="button"
                    title="Test Ollama connection"
                  >
                    🔗 Test
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-8">
                <Button
                  onClick={loadOllamaModels}
                  variant="secondary"
                  type="button"
                  title="Refresh models"
                  disabled={isRefreshingModels}
                >
                  {isRefreshingModels ? 'Refreshing…' : '🔄 Refresh Models'}
                </Button>
                <Button
                  onClick={() => setShowAllModels((v) => !v)}
                  variant="subtle"
                  type="button"
                  title="Toggle raw model list"
                >
                  {showAllModels ? 'Hide Models' : 'View All Models'}
                </Button>
                {pullProgressText && (
                  <span className="text-xs text-system-gray-600">
                    {pullProgressText}
                  </span>
                )}
                {ollamaHealth && (
                  <span
                    className={`text-xs ${ollamaHealth.status === 'healthy' ? 'text-green-600' : 'text-red-600'}`}
                  >
                    {ollamaHealth.status === 'healthy'
                      ? `Healthy (${ollamaHealth.modelCount || 0} models)`
                      : `Unhealthy${ollamaHealth.error ? `: ${ollamaHealth.error}` : ''}`}
                  </span>
                )}
              </div>
              {showAllModels && (
                <div className="mt-8 p-8 bg-system-gray-50 rounded border border-system-gray-200 text-xs">
                  <div className="mb-5 font-medium text-system-gray-700">
                    All models from Ollama:
                  </div>
                  {ollamaModelLists.all.length === 0 ? (
                    <div className="text-system-gray-500">
                      No models returned
                    </div>
                  ) : (
                    <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {ollamaModelLists.all.map((m) => (
                        <li key={m} className="font-mono">
                          {m}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-13">
                <div>
                  <label className="block text-sm font-medium text-system-gray-700 mb-5">
                    Text Model
                  </label>
                  <Select
                    value={settings.textModel}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        textModel: e.target.value,
                      }))
                    }
                  >
                    {textModelOptions.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-system-gray-700 mb-5">
                    Vision Model
                  </label>
                  <Select
                    value={settings.visionModel}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        visionModel: e.target.value,
                      }))
                    }
                  >
                    {visionModelOptions.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-system-gray-700 mb-5">
                    Embedding Model
                  </label>
                  <Select
                    value={settings.embeddingModel}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        embeddingModel: e.target.value,
                      }))
                    }
                  >
                    {embeddingModelOptions.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="border-t border-system-gray-200 pt-13 mt-13 space-y-13">
                <div>
                  <label className="block text-sm font-medium text-system-gray-700 mb-5">
                    Add Model
                  </label>
                  <div className="flex gap-8">
                    <Input
                      type="text"
                      value={newModel}
                      onChange={(e) => setNewModel(e.target.value)}
                      placeholder="model:tag"
                      className="flex-1"
                    />
                    <Button
                      onClick={addOllamaModel}
                      variant="secondary"
                      type="button"
                      disabled={isAddingModel}
                      title="Pull model"
                    >
                      {isAddingModel ? 'Adding…' : 'Add'}
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-system-gray-700 mb-5">
                    Delete Model
                  </label>
                  <div className="flex gap-8">
                    <Select
                      value={modelToDelete}
                      onChange={(e) => setModelToDelete(e.target.value)}
                      className="flex-1"
                    >
                      <option value="" disabled>
                        Select model
                      </option>
                      {ollamaModelLists.all.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </Select>
                    <Button
                      onClick={deleteOllamaModel}
                      variant="danger"
                      type="button"
                      disabled={isDeletingModel || !modelToDelete}
                      title="Delete model"
                    >
                      {isDeletingModel ? 'Deleting…' : 'Delete'}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-13">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-system-gray-700 mb-5">
                    Smart Folder Embeddings
                  </label>
                  <p className="text-xs text-system-gray-500 mb-8">
                    Rebuild embeddings for all smart folders to improve semantic
                    matching after you edit folder names or descriptions.
                  </p>
                  <div className="flex gap-8">
                    <Button
                      onClick={async () => {
                        try {
                          setIsRebuildingFolders(true);
                          const res =
                            await window.electronAPI.embeddings.rebuildFolders();
                          addNotification(
                            res?.success
                              ? `Rebuilt ${res.folders || 0} folder embeddings`
                              : `Failed: ${res?.error || 'Unknown error'}`,
                            res?.success ? 'success' : 'error',
                          );
                        } catch (e) {
                          addNotification(`Failed: ${e.message}`, 'error');
                        } finally {
                          setIsRebuildingFolders(false);
                        }
                      }}
                      variant="secondary"
                      disabled={isRebuildingFolders}
                      type="button"
                      title="Rebuild folder embeddings"
                    >
                      {isRebuildingFolders
                        ? 'Rebuilding…'
                        : 'Rebuild Folder Embeddings'}
                    </Button>
                    <Button
                      onClick={async () => {
                        try {
                          setIsRebuildingFiles(true);
                          const res =
                            await window.electronAPI.embeddings.rebuildFiles();
                          addNotification(
                            res?.success
                              ? `Rebuilt ${res.files || 0} file embeddings`
                              : `Failed: ${res?.error || 'Unknown error'}`,
                            res?.success ? 'success' : 'error',
                          );
                        } catch (e) {
                          addNotification(`Failed: ${e.message}`, 'error');
                        } finally {
                          setIsRebuildingFiles(false);
                        }
                      }}
                      variant="secondary"
                      disabled={isRebuildingFiles}
                      type="button"
                      title="Rebuild file embeddings from analysis history"
                    >
                      {isRebuildingFiles
                        ? 'Rebuilding…'
                        : 'Rebuild File Embeddings'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </Collapsible>

          <Collapsible
            title="⚡ Performance"
            defaultOpen
            persistKey="settings-performance"
          >
            <div className="space-y-13">
              <div>
                <label className="block text-sm font-medium text-system-gray-700 mb-5">
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
            <div className="space-y-13">
              <div>
                <label className="block text-sm font-medium text-system-gray-700 mb-5">
                  Default Smart Folder Location
                </label>
                <div className="flex gap-8">
                  <Input
                    type="text"
                    value={settings.defaultSmartFolderLocation}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        defaultSmartFolderLocation: e.target.value,
                      }))
                    }
                    className="flex-1"
                    placeholder="Documents"
                  />
                  <Button
                    onClick={async () => {
                      const res =
                        await window.electronAPI.files.selectDirectory();
                      if (res?.success && res.folder) {
                        setSettings((prev) => ({
                          ...prev,
                          defaultSmartFolderLocation: res.folder,
                        }));
                      }
                    }}
                    variant="secondary"
                    type="button"
                    title="Browse"
                    aria-label="Browse for default folder"
                  >
                    📁 Browse
                  </Button>
                </div>
                <p className="text-xs text-system-gray-500 mt-3">
                  Where new smart folders will be created by default
                </p>
              </div>
            </div>
          </Collapsible>

          <Collapsible
            title="🖥️ Application"
            defaultOpen
            persistKey="settings-app"
          >
            <div className="space-y-13">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="launchOnStartup"
                  checked={!!settings.launchOnStartup}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      launchOnStartup: e.target.checked,
                    }))
                  }
                  className="mr-8"
                />
                <label
                  htmlFor="launchOnStartup"
                  className="text-sm text-system-gray-700"
                >
                  Launch StratoSort on system startup
                </label>
              </div>
            </div>
          </Collapsible>

          <Collapsible
            title="🔧 Backend API Test"
            defaultOpen={false}
            persistKey="settings-api"
          >
            <div className="p-13 bg-system-gray-50 rounded-lg">
              <Button
                onClick={runAPITests}
                disabled={isTestingApi}
                variant="primary"
                className="text-sm mb-8 w-full"
              >
                {isTestingApi ? 'Testing APIs...' : 'Test All APIs'}
              </Button>
              {Object.keys(testResults).length > 0 && (
                <div className="space-y-3 text-sm">
                  {Object.entries(testResults).map(([service, status]) => (
                    <div key={service} className="flex justify-between">
                      <span className="capitalize">
                        {service.replace(/([A-Z])/g, ' $1').trim()}:
                      </span>
                      <span className="font-mono text-xs">{status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Collapsible>
        </div>

        <div className="p-21 border-t border-system-gray-200 flex justify-end gap-13">
          <Button onClick={handleToggleSettings} variant="secondary">
            Cancel
          </Button>
          <Button onClick={saveSettings} variant="primary" disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </div>
    </div>
  );
});

export default SettingsPanel;
