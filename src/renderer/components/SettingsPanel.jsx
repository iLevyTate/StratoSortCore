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
import { useAppDispatch } from '../store/hooks';
import { toggleSettings } from '../store/slices/uiSlice';
import { useDebouncedCallback } from '../hooks/usePerformance';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import Collapsible from './ui/Collapsible';
import { ModalLoadingOverlay } from './LoadingSkeleton';
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
// UI-1: ProcessingLimitsSection removed - file size limits/processing params not useful for users

const AnalysisHistoryModal = lazy(() => import('./AnalysisHistoryModal'));

// Section keys for expand/collapse all functionality
const SECTION_KEYS = [
  'settings-ai',
  'settings-performance',
  'settings-defaults',
  'settings-app',
  'settings-history',
  'settings-api'
];

// Set logger context for this component
logger.setContext('SettingsPanel');

// FIX: Helper to safely check if electronAPI is available
const isElectronAPIAvailable = () => {
  return typeof window !== 'undefined' && window.electronAPI != null;
};

// Allowed embedding models - must match settingsValidation.js enum
// NOTE: Changing embedding models requires re-embedding all files (dimension mismatch)
const ALLOWED_EMBED_MODELS = [
  'embeddinggemma', // 768 dims (default, Google's best-in-class)
  'mxbai-embed-large', // 1024 dims (legacy)
  'nomic-embed-text', // 768 dims
  'all-minilm', // 384 dims (compact)
  'bge-large' // 1024 dims
];
const DEFAULT_EMBED_MODEL = 'embeddinggemma';

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

  // FIX: Start with DEFAULT_SETTINGS to prevent loading spinner jerk
  // Real settings will be merged in via loadSettings() on mount
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

  // FIX: Cleanup progress listener on unmount to prevent memory leak
  // This handles the case where user closes settings panel mid-model-download
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
  // FIX: Ref to hold cancel function for auto-save debounce (avoids circular dep)
  const cancelAutoSaveRef = useRef(null);
  // FIX: Ref to always hold the current settings value for debounced callbacks
  const settingsRef = useRef(null);

  // Keep settingsRef in sync with settings state
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Helper to update settings and keep the ref in sync immediately (avoids stale reads on quick save)
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
    // FIX NEW-8: Use the dynamically filtered list of installed embedding models
    // This prevents deleted models from appearing in the dropdown
    // NOTE: Changing embedding models requires re-embedding all files (dimension mismatch)
    // embeddinggemma: 768 dims, mxbai-embed-large: 1024 dims
    return ollamaModelLists.embedding.length > 0
      ? ollamaModelLists.embedding
      : ALLOWED_EMBED_MODELS; // Fallback to full list if API fails
  }, [ollamaModelLists.embedding]);

  const pullProgressText = useMemo(() => {
    if (!pullProgress) return null;
    const percentage =
      typeof pullProgress?.completed === 'number' && typeof pullProgress?.total === 'number'
        ? ` (${Math.floor((pullProgress.completed / Math.max(1, pullProgress.total)) * 100)}%)`
        : '';
    return `Pulling ${newModel.trim()}… ${pullProgress?.status || ''}${percentage}`;
  }, [pullProgress, newModel]);

  // Load settings on mount
  // FIX: Set complete settings object with defaults as fallback to prevent flash of wrong values
  // Uses centralized DEFAULT_SETTINGS to avoid duplication and ensure consistency
  const loadSettings = useCallback(async () => {
    try {
      const savedSettings = await window.electronAPI.settings.get();
      // Avoid auto-save loops caused by setSettings during hydration
      skipAutoSaveRef.current = true;
      // Set complete settings: centralized defaults merged with saved settings
      applySettingsUpdate({
        ...DEFAULT_SETTINGS,
        ...(savedSettings || {})
      });
      setSettingsLoaded(true);
    } catch (error) {
      logger.error('Failed to load settings', {
        error: error.message,
        stack: error.stack
      });
      // On error, still set defaults so UI is usable
      skipAutoSaveRef.current = true;
      applySettingsUpdate({ ...DEFAULT_SETTINGS });
      setSettingsLoaded(true);
    }
  }, [applySettingsUpdate]);

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

      // FIX NEW-8: Filter embedding models to only show installed ones
      // This prevents deleted models from appearing in the dropdown
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
        // Only expose vetted embedding models that are actually installed
        embedding: installedEmbeddingModels,
        all: installedModels.slice().sort()
      });
      if (response?.ollamaHealth) setOllamaHealth(response.ollamaHealth);
      if (response?.selected) {
        // Avoid auto-save loops caused by setSettings during hydration
        skipAutoSaveRef.current = true;
        applySettingsUpdate((prev) => {
          const desiredEmbed = response.selected.embeddingModel || prev.embeddingModel;
          // Validate embedding model is in the allowed list
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
      // Notify user about the failure so they know models couldn't be loaded
      addNotification('Failed to load Ollama models. Check if Ollama is running.', 'warning');
    } finally {
      setIsRefreshingModels(false);
    }
  }, [addNotification, applySettingsUpdate]);

  useEffect(() => {
    // Don't run if API is not available
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

    // FIX P1-7: Make loading sequential to prevent race condition
    // Both functions modify settings state, so they must run in sequence
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

  // After settings are loaded the first time, automatically check Ollama health
  useEffect(() => {
    if (!isApiAvailable) return undefined;
    if (!settingsLoaded) return undefined;
    // FIX: Guard against null settings to prevent errors before settings are loaded
    if (settings === null) return undefined;
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
  }, [isApiAvailable, settingsLoaded, settings, loadOllamaModels]);

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
      // Cancel any pending auto-save to prevent race condition where stale auto-save
      // overwrites the manual save (fixes CRITICAL-3 race condition bug)
      if (cancelAutoSaveRef.current) {
        cancelAutoSaveRef.current();
      }
      // Always use the latest settings via ref to avoid stale closures (e.g., save right after slider drag)
      const latest = {
        ...DEFAULT_SETTINGS,
        ...(settingsRef.current || settings || {})
      };
      // Let sanitizeSettings handle normalization (including string->number conversion for confidenceThreshold)
      const sanitized = sanitizeSettings(latest);
      // Force confidenceThreshold to fixed 75% (0.75)
      const normalizedSettings = {
        ...sanitized
      };
      // Avoid auto-save loops caused by setSettings during explicit save
      skipAutoSaveRef.current = true;
      applySettingsUpdate(normalizedSettings);
      const res = await window.electronAPI.settings.save(normalizedSettings);
      if (res?.success === false) {
        throw new Error(res?.error || 'Failed to save settings');
      }
      if (Array.isArray(res?.validationWarnings) && res.validationWarnings.length > 0) {
        addNotification(`Saved with warnings: ${res.validationWarnings.join('; ')}`, 'warning');
      } else {
        addNotification('Settings saved successfully!', 'success');
      }
      // Only close panel on successful save
      handleToggleSettings();
    } catch (error) {
      logger.error('Failed to save settings', {
        error: error.message,
        stack: error.stack
      });
      // Keep panel open on error so user can fix issues
      addNotification(
        'Failed to save settings. Please check your settings and try again.',
        'error'
      );
    } finally {
      setIsSaving(false);
    }
  }, [settings, addNotification, handleToggleSettings, applySettingsUpdate]);

  // Auto-save settings on change (debounced)
  // FIX: Use settingsRef.current to always get the LATEST settings value at execution time
  // This prevents stale closure issues where the debounce captures an old settings value
  const autoSaveSettings = useDebouncedCallback(async () => {
    // Read current settings from ref to avoid stale closure
    const currentSettings = settingsRef.current;
    if (!currentSettings) return;

    try {
      // Let sanitizeSettings handle normalization (including string->number conversion for confidenceThreshold)
      const normalizedSettings = sanitizeSettings({
        ...currentSettings
      });
      await window.electronAPI.settings.save(normalizedSettings);
      // Note: We intentionally don't apply res.settings here to avoid race conditions.
      // The local state is the source of truth during editing.
    } catch (error) {
      logger.error('Auto-save settings failed', {
        error: error.message,
        stack: error.stack
      });
    }
  }, 800);

  // Store cancel function in ref so saveSettings can access it without circular dependency
  useEffect(() => {
    cancelAutoSaveRef.current = autoSaveSettings?.cancel || null;
  }, [autoSaveSettings]);

  useEffect(() => {
    // FIX: Guard against null settings to prevent auto-save before settings are loaded
    if (!isApiAvailable || !settingsLoaded || settings === null) {
      return;
    }
    // Prevent auto-save storm during initial hydration or when we just applied canonical settings.
    if (skipAutoSaveRef.current) {
      skipAutoSaveRef.current = false;
      return;
    }
    autoSaveSettings();
  }, [isApiAvailable, settings, settingsLoaded, autoSaveSettings]);

  // FIX H-2: Flush pending settings saves on unmount to prevent data loss
  // when user closes settings panel before debounce completes
  useEffect(() => {
    return () => {
      if (autoSaveSettings?.flush) {
        autoSaveSettings.flush();
      }
    };
  }, [autoSaveSettings]);

  const testOllamaConnection = useCallback(async () => {
    // FIX: Guard against null/undefined settings or missing ollamaHost
    // Note: settings is initialized with DEFAULT_SETTINGS, so !settings check alone is insufficient
    if (!settings?.ollamaHost) return;
    try {
      const res = await window.electronAPI.ollama.testConnection(settings.ollamaHost);
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
    } catch (e) {
      addNotification('Connection test failed. Is Ollama running?', 'error');
    }
  }, [settings, addNotification, loadOllamaModels]);

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
    } catch (e) {
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
      className="settings-modal fixed inset-0 z-modal flex items-center justify-center bg-black/50 p-[var(--panel-padding)]"
      onMouseDown={(e) => {
        // UX: click backdrop closes settings (like a real modal)
        if (e.target === e.currentTarget) handleToggleSettings();
      }}
      role="presentation"
    >
      <div className="surface-panel !p-0 w-full max-w-4xl mx-auto max-h-[86vh] flex flex-col overflow-hidden shadow-2xl animate-modal-enter">
        <div className="settings-modal-header px-[var(--panel-padding)] py-[calc(var(--panel-padding)*0.75)] border-b border-border-soft/70 bg-white flex-shrink-0 rounded-t-[var(--radius-panel)]">
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

        <div className="px-[var(--panel-padding)] py-[var(--panel-padding)] flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto modern-scrollbar">
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
            <div className="flex flex-col gap-[var(--spacing-default)]">
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
            </div>
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
            <div className="flex flex-col gap-[var(--spacing-default)]">
              {/* UI-1: Processing Limits section removed - file size limits/processing params not useful for users */}
              <AutoOrganizeSection settings={settings} setSettings={applySettingsUpdate} />
              <BackgroundModeSection settings={settings} setSettings={applySettingsUpdate} />
            </div>
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
            <DefaultLocationsSection settings={settings} setSettings={applySettingsUpdate} />

            {/* File Naming Defaults */}
            <div className="mt-6 pt-6 border-t border-system-gray-200">
              <NamingSettingsSection settings={settings} setSettings={applySettingsUpdate} />
            </div>
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
            <ApplicationSection settings={settings} setSettings={applySettingsUpdate} />

            {/* Notification Settings */}
            <div className="mt-6 pt-6 border-t border-system-gray-200">
              <NotificationSettingsSection settings={settings} setSettings={applySettingsUpdate} />
            </div>
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

        <div className="px-[var(--panel-padding)] py-[calc(var(--panel-padding)*0.75)] border-t border-border-soft/70 bg-white flex items-center justify-end gap-3 flex-shrink-0 rounded-b-[var(--radius-panel)]">
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
