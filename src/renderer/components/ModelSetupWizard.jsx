// src/renderer/components/ModelSetupWizard.jsx

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Download,
  HardDrive,
  Cpu,
  CheckCircle,
  Loader2,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import Button from './ui/Button';
import Card from './ui/Card';
import { Text, Heading } from './ui/Typography';
import { formatBytes, formatDuration } from '../utils/format';
import { AI_DEFAULTS, INSTALL_MODEL_PROFILES } from '../../shared/constants';
import { getModel } from '../../shared/modelRegistry';

const PROFILE_MODELS = {
  base: {
    embedding: INSTALL_MODEL_PROFILES?.BASE_SMALL?.models?.EMBEDDING,
    text: INSTALL_MODEL_PROFILES?.BASE_SMALL?.models?.TEXT_ANALYSIS,
    vision: INSTALL_MODEL_PROFILES?.BASE_SMALL?.models?.IMAGE_ANALYSIS
  },
  quality: {
    embedding: INSTALL_MODEL_PROFILES?.BETTER_QUALITY?.models?.EMBEDDING,
    text: INSTALL_MODEL_PROFILES?.BETTER_QUALITY?.models?.TEXT_ANALYSIS,
    vision: INSTALL_MODEL_PROFILES?.BETTER_QUALITY?.models?.IMAGE_ANALYSIS
  }
};

function detectProfileKey(models) {
  if (
    models?.embedding === PROFILE_MODELS.quality.embedding &&
    models?.text === PROFILE_MODELS.quality.text &&
    models?.vision === PROFILE_MODELS.quality.vision
  ) {
    return 'quality';
  }
  return 'base';
}

export default function ModelSetupWizard({ onComplete, onSkip }) {
  const [systemInfo, setSystemInfo] = useState(null);
  const [recommendations, setRecommendations] = useState(null);
  const [selectedProfile, setSelectedProfile] = useState('base');
  const [selectedModels, setSelectedModels] = useState({});
  const [availableModels, setAvailableModels] = useState([]);
  const [downloadState, setDownloadState] = useState({});
  const [step, setStep] = useState('checking'); // checking, select, downloading, complete
  const [initError, setInitError] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasApi, setHasApi] = useState(true);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const availableSet = useMemo(() => new Set(availableModels || []), [availableModels]);

  const updateDownloadState = useCallback((modelName, patch) => {
    if (!modelName) return;
    setDownloadState((prev) => ({
      ...prev,
      [modelName]: {
        ...(prev[modelName] || {}),
        ...patch
      }
    }));
  }, []);

  const checkSystem = useCallback(async () => {
    if (!isMountedRef.current) return;
    setIsRefreshing(true);
    setInitError(null);

    const llamaApi = window?.electronAPI?.llama;
    const hasLlamaApi =
      typeof llamaApi?.getModels === 'function' && typeof llamaApi?.getConfig === 'function';
    if (!isMountedRef.current) return;
    setHasApi(hasLlamaApi);

    const fallbackDefaults = {
      embedding: PROFILE_MODELS.base.embedding || AI_DEFAULTS?.EMBEDDING?.MODEL,
      text: PROFILE_MODELS.base.text || AI_DEFAULTS?.TEXT?.MODEL,
      vision: PROFILE_MODELS.base.vision || AI_DEFAULTS?.IMAGE?.MODEL
    };

    if (!hasLlamaApi) {
      if (!isMountedRef.current) return;
      const fallbackProfile = detectProfileKey(fallbackDefaults);
      const fallbackSelection = PROFILE_MODELS[fallbackProfile] || fallbackDefaults;
      setSelectedProfile(fallbackProfile);
      setRecommendations(fallbackSelection);
      setSelectedModels(fallbackSelection);
      setSystemInfo({ gpuBackend: null, modelsPath: null });
      setInitError('AI engine is still starting. Please try again in a moment.');
      setStep('select');
      setIsRefreshing(false);
      return;
    }

    try {
      const [config, modelsResponse, downloadStatus] = await Promise.all([
        llamaApi.getConfig(),
        llamaApi.getModels(),
        typeof llamaApi.getDownloadStatus === 'function'
          ? llamaApi.getDownloadStatus().catch(() => null)
          : null
      ]);
      if (!isMountedRef.current) return;

      const defaults = {
        embedding: config?.embeddingModel || fallbackDefaults.embedding,
        text: config?.textModel || fallbackDefaults.text,
        vision: config?.visionModel || fallbackDefaults.vision
      };
      const profileKey = detectProfileKey(defaults);
      const selectedProfileModels = PROFILE_MODELS[profileKey] || defaults;

      const modelList = Array.isArray(modelsResponse)
        ? modelsResponse
        : Array.isArray(modelsResponse?.models)
          ? modelsResponse.models
          : [];
      const available = modelList.map((m) => m.name || m.filename || m).filter(Boolean);
      const availableNow = new Set(available);

      setSelectedProfile(profileKey);
      setRecommendations(selectedProfileModels);
      setSelectedModels(selectedProfileModels);
      setAvailableModels(available);
      setSystemInfo({
        gpuBackend: config?.gpuBackend || null,
        modelsPath: config?.modelsPath || null
      });

      const nextDownloadState = {};
      available.forEach((name) => {
        nextDownloadState[name] = { status: 'ready', percent: 100 };
      });

      const activeDownloads = downloadStatus?.status?.downloads || [];
      activeDownloads.forEach((download) => {
        if (!download?.filename) return;
        nextDownloadState[download.filename] = {
          status: 'downloading',
          percent: download.progress ?? 0,
          downloadedBytes: download.downloadedBytes,
          totalBytes: download.totalBytes
        };
      });
      if (activeDownloads.length > 0) {
        setStep('downloading');
      }

      setDownloadState((prev) => ({ ...prev, ...nextDownloadState }));

      const missingRequired = [defaults.embedding, defaults.text]
        .filter(Boolean)
        .filter((name) => !availableNow.has(name));

      if (activeDownloads.length === 0) {
        setStep(missingRequired.length === 0 ? 'complete' : 'select');
      }
    } catch (error) {
      if (!isMountedRef.current) return;
      setInitError(error?.message || 'Failed to load AI model status.');
      setStep('select');
    } finally {
      if (isMountedRef.current) {
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void checkSystem();
  }, [checkSystem]);

  useEffect(() => {
    // Subscribe to download progress
    // Note: Assuming window.electronAPI.events.onOperationProgress handles this
    const subscribe = window?.electronAPI?.events?.onOperationProgress;
    if (typeof subscribe !== 'function') return undefined;
    const unsubscribe = subscribe((data) => {
      if (!data || data.type !== 'model-download') return;

      const payload = data.progress || data;
      const modelName = data.model || payload.model || payload.filename;
      if (!modelName) return;

      updateDownloadState(modelName, {
        status: 'downloading',
        percent: payload.percent ?? payload.percentage ?? 0,
        downloadedBytes: payload.downloadedBytes,
        totalBytes: payload.totalBytes,
        speedBps: payload.speedBps,
        etaSeconds: payload.etaSeconds
      });
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [updateDownloadState]);

  async function applySelectedProfileConfig() {
    const updateConfig = window?.electronAPI?.llama?.updateConfig;
    if (typeof updateConfig !== 'function') return;
    const payload = {
      textModel: selectedModels.text,
      embeddingModel: selectedModels.embedding
    };
    if (selectedModels.vision) {
      payload.visionModel = selectedModels.vision;
    }
    try {
      await updateConfig(payload);
    } catch (error) {
      setInitError(error?.message || 'Could not apply selected model profile.');
    }
  }

  async function startDownloads() {
    const modelsToDownload = Object.values(selectedModels)
      .filter(Boolean)
      .filter((modelName) => !availableSet.has(modelName));

    if (modelsToDownload.length === 0) {
      await applySelectedProfileConfig();
      setStep('complete');
      return;
    }

    if (!window?.electronAPI?.llama?.downloadModel) {
      setInitError('Download service unavailable. Try again once the app finishes loading.');
      return;
    }

    setStep('downloading');

    const nextAvailable = new Set(availableSet);
    for (const filename of modelsToDownload) {
      updateDownloadState(filename, { status: 'downloading', percent: 0 });
      try {
        const result = await window.electronAPI.llama.downloadModel(filename);
        if (result?.success) {
          if (result?.alreadyInProgress) {
            // Background setup already started this download; keep showing in-progress
            // and wait for actual availability before marking complete.
            updateDownloadState(filename, { status: 'downloading' });
          } else {
            updateDownloadState(filename, { status: 'ready', percent: 100 });
            nextAvailable.add(filename);
            setAvailableModels((prev) => Array.from(new Set([...(prev || []), filename])));
          }
        } else {
          updateDownloadState(filename, {
            status: 'failed',
            error: result?.error || 'Download failed'
          });
        }
      } catch (error) {
        updateDownloadState(filename, {
          status: 'failed',
          error: error?.message || 'Download failed'
        });
      }
    }

    // Refresh availability from source-of-truth after requests complete.
    // This avoids treating "alreadyInProgress" downloads as fully installed.
    let activeDownloads = [];
    try {
      const [modelsResponse, downloadStatus] = await Promise.all([
        window.electronAPI.llama.getModels(),
        typeof window.electronAPI.llama.getDownloadStatus === 'function'
          ? window.electronAPI.llama.getDownloadStatus().catch(() => null)
          : Promise.resolve(null)
      ]);

      const modelList = Array.isArray(modelsResponse)
        ? modelsResponse
        : Array.isArray(modelsResponse?.models)
          ? modelsResponse.models
          : [];
      const latestAvailable = modelList.map((m) => m.name || m.filename || m).filter(Boolean);

      latestAvailable.forEach((name) => nextAvailable.add(name));
      if (latestAvailable.length > 0) {
        setAvailableModels((prev) => Array.from(new Set([...(prev || []), ...latestAvailable])));
      }

      activeDownloads = downloadStatus?.status?.downloads || [];
      activeDownloads.forEach((download) => {
        if (!download?.filename) return;
        updateDownloadState(download.filename, {
          status: 'downloading',
          percent: download.progress ?? 0,
          downloadedBytes: download.downloadedBytes,
          totalBytes: download.totalBytes
        });
      });
    } catch {
      // Non-fatal: fallback to local state if status refresh fails.
    }

    const requiredMissing = [selectedModels.embedding, selectedModels.text]
      .filter(Boolean)
      .filter((name) => !nextAvailable.has(name));

    if (requiredMissing.length === 0) {
      await applySelectedProfileConfig();
    }

    if (requiredMissing.length === 0) {
      setStep('complete');
    } else {
      setStep(activeDownloads.length > 0 ? 'downloading' : 'select');
    }
  }

  function toggleModel(type, filename) {
    setSelectedModels((prev) => ({
      ...prev,
      [type]: prev[type] === filename ? null : filename
    }));
  }

  const getModelSize = (filename) => {
    const model = getModel(filename);
    if (!model) return 0;
    let total = model.size || 0;
    if (model.clipModel?.size) {
      total += model.clipModel.size;
    }
    return total;
  };

  const getProfileSize = (profileKey) =>
    Object.values(PROFILE_MODELS[profileKey] || {})
      .filter(Boolean)
      .reduce((sum, filename) => sum + getModelSize(filename), 0);

  const totalDownloadSize = Object.values(selectedModels)
    .filter(Boolean)
    .filter((filename) => !availableSet.has(filename))
    .reduce((sum, filename) => sum + getModelSize(filename), 0);

  const requiredModelsMissing = [selectedModels.embedding, selectedModels.text]
    .filter(Boolean)
    .filter((name) => !availableSet.has(name));

  if (step === 'checking') {
    return (
      <Card className="max-w-2xl mx-auto p-8 text-center">
        <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-blue-500" />
        <Heading level={2}>Checking System...</Heading>
        <Text className="text-gray-600 mt-2">Detecting GPU and memory configuration</Text>
      </Card>
    );
  }

  if (step === 'select') {
    return (
      <Card className="max-w-2xl mx-auto p-8">
        <div className="text-center mb-6">
          <Cpu className="w-12 h-12 mx-auto mb-4 text-blue-500" />
          <Heading level={2}>AI Model Setup</Heading>
          <Text className="text-gray-600 mt-2">
            StratoSort runs AI locally on your device. Download the core models once, then use them
            offline.
          </Text>
        </div>

        {initError && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
            <div className="space-y-1">
              <Text className="font-medium text-amber-700">Setup not ready</Text>
              <Text variant="small" className="text-amber-700/90">
                {initError}
              </Text>
            </div>
          </div>
        )}

        {/* System Info */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <Text variant="small" className="font-medium mb-2">
            Your System
          </Text>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <div>GPU: {systemInfo?.gpuBackend || 'CPU only'}</div>
            <div>Models path: {systemInfo?.modelsPath || 'Default app storage'}</div>
          </div>
        </div>

        <div className="mb-6">
          <Text variant="small" className="font-medium mb-2">
            Install Profile
          </Text>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setSelectedProfile('base');
                setRecommendations(PROFILE_MODELS.base);
                setSelectedModels(PROFILE_MODELS.base);
              }}
              className={`text-left border rounded-lg p-4 transition ${
                selectedProfile === 'base'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
              disabled={!hasApi || isRefreshing}
            >
              <Text className="font-medium">
                {INSTALL_MODEL_PROFILES?.BASE_SMALL?.label || 'Base (Small & Fast)'}
              </Text>
              <Text variant="small" className="text-gray-600 mt-1">
                {INSTALL_MODEL_PROFILES?.BASE_SMALL?.description ||
                  'Runs on most machines with faster startup and smaller downloads.'}
              </Text>
              <Text variant="tiny" className="text-gray-500 mt-2">
                Approx. download: {formatBytes(getProfileSize('base'))}
              </Text>
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedProfile('quality');
                setRecommendations(PROFILE_MODELS.quality);
                setSelectedModels(PROFILE_MODELS.quality);
              }}
              className={`text-left border rounded-lg p-4 transition ${
                selectedProfile === 'quality'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
              disabled={!hasApi || isRefreshing}
            >
              <Text className="font-medium">
                {INSTALL_MODEL_PROFILES?.BETTER_QUALITY?.label || 'Better Quality (Larger)'}
              </Text>
              <Text variant="small" className="text-gray-600 mt-1">
                {INSTALL_MODEL_PROFILES?.BETTER_QUALITY?.description ||
                  'Higher quality output with larger models and larger downloads.'}
              </Text>
              <Text variant="tiny" className="text-gray-500 mt-2">
                Approx. download: {formatBytes(getProfileSize('quality'))}
              </Text>
            </button>
          </div>
        </div>

        {/* Model Selection */}
        <div className="space-y-4 mb-6">
          <ModelSelector
            type="embedding"
            label="Embedding Model (Required)"
            description="Converts text to vectors for search"
            selected={selectedModels.embedding}
            recommendations={recommendations}
            onChange={(f) => toggleModel('embedding', f)}
            status={downloadState[selectedModels.embedding]?.status}
            error={downloadState[selectedModels.embedding]?.error}
            disabled={!hasApi || isRefreshing}
            required
            getModelSize={getModelSize}
          />

          <ModelSelector
            type="text"
            label="Text Analysis Model (Required)"
            description="Analyzes documents and generates descriptions"
            selected={selectedModels.text}
            recommendations={recommendations}
            onChange={(f) => toggleModel('text', f)}
            status={downloadState[selectedModels.text]?.status}
            error={downloadState[selectedModels.text]?.error}
            disabled={!hasApi || isRefreshing}
            required
            getModelSize={getModelSize}
          />

          <ModelSelector
            type="vision"
            label="Vision Model (Optional)"
            description="Analyzes images and screenshots"
            selected={selectedModels.vision}
            recommendations={recommendations}
            onChange={(f) => toggleModel('vision', f)}
            status={downloadState[selectedModels.vision]?.status}
            error={downloadState[selectedModels.vision]?.error}
            disabled={!hasApi || isRefreshing}
            optional
            getModelSize={getModelSize}
          />
        </div>

        {/* Download Summary */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <Text className="font-medium">Total Download</Text>
              <Text variant="small" className="text-gray-600">
                {formatBytes(totalDownloadSize)}
              </Text>
              <Text variant="tiny" className="text-gray-500">
                One-time download. You can keep using the app while this runs.
              </Text>
            </div>
            <HardDrive className="w-6 h-6 text-blue-500" />
          </div>
        </div>

        {requiredModelsMissing.length > 0 && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
            Required models are missing. Download them to enable AI features.
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={startDownloads}
            variant="primary"
            className="flex-1"
            disabled={!selectedModels.embedding || !selectedModels.text || !hasApi || isRefreshing}
          >
            <Download className="w-4 h-4 mr-2" />
            Download Models
          </Button>
          <Button onClick={checkSystem} variant="secondary" disabled={isRefreshing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={onSkip} variant="secondary" className="sm:min-w-[140px]">
            Continue without AI
          </Button>
        </div>
      </Card>
    );
  }

  if (step === 'downloading') {
    const models = Object.entries(selectedModels).filter(([_, v]) => v);
    // Simple check: if all active downloads are complete
    // In reality, you'd track each download's state from the event
    const allComplete = models.every(([_, filename]) => {
      const status = downloadState[filename]?.status;
      return status === 'ready' || status === 'complete';
    });
    const hasFailures = models.some(
      ([_, filename]) => downloadState[filename]?.status === 'failed'
    );

    return (
      <Card className="max-w-2xl mx-auto p-8">
        <div className="text-center mb-6">
          <Download className="w-12 h-12 mx-auto mb-4 text-blue-500" />
          <Heading level={2}>Downloading Models</Heading>
          <Text className="text-gray-600 mt-2">
            This may take a while depending on your connection speed
          </Text>
        </div>

        <div className="space-y-4">
          {models.map(([_type, filename]) => {
            const progress = downloadState[filename] || { percent: 0 };
            const status = progress.status || 'downloading';
            return (
              <div key={filename} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <Text className="font-medium">{getModel(filename)?.displayName || filename}</Text>
                  <Text variant="small" className="text-gray-600">
                    {status === 'failed' ? 'Failed' : `${progress.percent || 0}%`}
                  </Text>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all"
                    style={{ width: `${progress.percent || 0}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{formatBytes(progress.downloadedBytes || 0)}</span>
                  <span>
                    {progress.speedBps
                      ? `${formatBytes(progress.speedBps)}/s`
                      : status === 'failed'
                        ? 'Download failed'
                        : 'Starting...'}
                  </span>
                  <span>
                    {progress.etaSeconds
                      ? `ETA: ${formatDuration(progress.etaSeconds * 1000)}`
                      : ''}
                  </span>
                </div>
                {progress.error && (
                  <Text variant="tiny" className="text-red-600 mt-2">
                    {progress.error}
                  </Text>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <Button
            onClick={() => {
              if (allComplete) {
                setStep('complete');
              } else {
                onSkip();
              }
            }}
            variant={allComplete ? 'primary' : 'secondary'}
            className="w-full sm:flex-1"
          >
            {allComplete ? 'Continue' : 'Continue while downloading'}
          </Button>
          {hasFailures && (
            <Button onClick={startDownloads} variant="secondary" className="w-full sm:flex-1">
              Retry Failed Downloads
            </Button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card className="max-w-2xl mx-auto p-8 text-center">
      <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500" />
      <Heading level={2}>Setup Complete!</Heading>
      <Text className="text-gray-600 mt-2 mb-6">
        StratoSort is ready to organize your files with AI
      </Text>
      <Button onClick={onComplete} variant="primary">
        Get Started
      </Button>
    </Card>
  );
}

function ModelSelector({
  type,
  label,
  description,
  selected,
  recommendations,
  onChange,
  optional,
  required,
  getModelSize,
  status,
  error,
  disabled
}) {
  // Using passed recommendations to show options
  // In real app, might want a dropdown if there are multiple choices
  const filename = recommendations?.[type];
  if (!filename) return null;

  const modelInfo = getModel(filename);
  const displayName = modelInfo?.displayName || filename;
  const isInstalled = status === 'ready' || status === 'complete';
  const statusLabel = isInstalled ? 'Installed' : status === 'failed' ? 'Failed' : 'Not installed';
  const statusClass = isInstalled
    ? 'bg-green-100 text-green-700'
    : status === 'failed'
      ? 'bg-red-100 text-red-700'
      : 'bg-gray-100 text-gray-700';

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <Text className="font-medium">{label}</Text>
          <Text variant="small" className="text-gray-600">
            {description}
          </Text>
        </div>
        <div className="flex items-center gap-2">
          {required && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">Required</span>
          )}
          {optional && <span className="text-xs bg-gray-100 px-2 py-1 rounded">Optional</span>}
          <span className={`text-xs px-2 py-1 rounded ${statusClass}`}>{statusLabel}</span>
        </div>
      </div>

      <label
        className={`flex items-center p-3 rounded border cursor-pointer transition
          ${
            selected === filename
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-200 hover:border-gray-300'
          }`}
      >
        <input
          type="checkbox"
          checked={selected === filename}
          onChange={() => onChange(filename)}
          disabled={disabled || required}
          className="mr-3"
        />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Text variant="small" className="font-medium">
              {displayName}
            </Text>
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
              Recommended
            </span>
          </div>
          <Text variant="tiny" className="text-gray-500">
            {formatBytes(getModelSize(filename))}
          </Text>
          {error && (
            <Text variant="tiny" className="text-red-600 mt-1">
              {error}
            </Text>
          )}
        </div>
      </label>
    </div>
  );
}
