// src/renderer/components/ModelSetupWizard.jsx

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Download, HardDrive, Cpu, CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import AlertBox from './ui/AlertBox';
import Button from './ui/Button';
import Card from './ui/Card';
import SelectionCard from './ui/SelectionCard';
import { Text, Heading } from './ui/Typography';
import { formatBytes, formatDuration } from '../utils/format';
import { AI_DEFAULTS, INSTALL_MODEL_PROFILES } from '../../shared/constants';
import { getModel } from '../../shared/modelRegistry';

const CHECK_SYSTEM_TIMEOUT_MS = 12000;
const CHECKING_ESCAPE_MS = 7000;
const CONTINUE_WITH_LIMITED_AI_LABEL = 'Continue with limited AI';
const STEP_ORDER = ['checking', 'select', 'downloading', 'complete'];
const STEP_TITLES = {
  checking: 'Check',
  select: 'Choose',
  downloading: 'Download',
  complete: 'Finish'
};
const CHECKING_STATUS_MESSAGES = [
  'Detecting available local models...',
  'Checking active background downloads...',
  'Preparing safe defaults for your setup...'
];

function getSetupCardClassName() {
  return 'max-w-2xl mx-auto p-8 border border-stratosort-blue/15 bg-gradient-to-b from-white to-stratosort-blue/5 animate-loading-fade';
}

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
  if (
    models?.embedding === PROFILE_MODELS.base.embedding &&
    models?.text === PROFILE_MODELS.base.text &&
    models?.vision === PROFILE_MODELS.base.vision
  ) {
    return 'base';
  }
  return 'custom';
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
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
  const [showCheckingEscape, setShowCheckingEscape] = useState(false);
  const [checkingStatusIndex, setCheckingStatusIndex] = useState(0);
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

    const applyFallbackSelection = () => {
      const fallbackProfile = detectProfileKey(fallbackDefaults);
      const fallbackSelection = PROFILE_MODELS[fallbackProfile] || fallbackDefaults;
      setSelectedProfile(fallbackProfile);
      setRecommendations(fallbackSelection);
      setSelectedModels(fallbackSelection);
      setSystemInfo({ gpuBackend: null, modelsPath: null });
    };

    if (!hasLlamaApi) {
      if (!isMountedRef.current) return;
      applyFallbackSelection();
      setInitError('AI engine is still starting. Please try again in a moment.');
      setStep('select');
      setIsRefreshing(false);
      return;
    }

    try {
      const [configResponse, modelsResponse, downloadStatus] = await withTimeout(
        Promise.all([
          llamaApi.getConfig(),
          llamaApi.getModels(),
          typeof llamaApi.getDownloadStatus === 'function'
            ? llamaApi.getDownloadStatus().catch(() => null)
            : null
        ]),
        CHECK_SYSTEM_TIMEOUT_MS,
        'AI system check timed out'
      );
      if (!isMountedRef.current) return;
      const config = configResponse?.config || configResponse || {};

      const defaults = {
        embedding: config?.embeddingModel || fallbackDefaults.embedding,
        text: config?.textModel || fallbackDefaults.text,
        vision: config?.visionModel || fallbackDefaults.vision
      };
      const profileKey = detectProfileKey(defaults);
      const selectedProfileModels = profileKey === 'custom' ? defaults : PROFILE_MODELS[profileKey];

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
      applyFallbackSelection();
      if (error?.message === 'AI system check timed out') {
        setInitError(
          'AI check is taking longer than expected. You can continue with manual setup or press Refresh.'
        );
      } else {
        setInitError(error?.message || 'Failed to load AI model status.');
      }
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

  // Failsafe: If checkSystem hangs (e.g. backend unresponsive), force exit 'checking' state
  useEffect(() => {
    if (step === 'checking') {
      const timer = setTimeout(() => {
        if (isMountedRef.current) {
          setInitError('AI system check timed out. Please select models manually.');
          setStep('select');
          setIsRefreshing(false);
        }
      }, 15000); // 15s failsafe (longer than checkSystem's 12s timeout)
      return () => clearTimeout(timer);
    }
  }, [step]);

  useEffect(() => {
    if (step !== 'checking') {
      setShowCheckingEscape(false);
      setCheckingStatusIndex(0);
      return undefined;
    }

    const escapeTimer = setTimeout(() => {
      if (isMountedRef.current) {
        setShowCheckingEscape(true);
      }
    }, CHECKING_ESCAPE_MS);

    const statusTimer = setInterval(() => {
      if (!isMountedRef.current) return;
      setCheckingStatusIndex((prev) => (prev + 1) % CHECKING_STATUS_MESSAGES.length);
    }, 2200);

    return () => {
      clearTimeout(escapeTimer);
      clearInterval(statusTimer);
    };
  }, [step]);

  useEffect(() => {
    // Subscribe to download progress
    // Note: Assuming window.electronAPI.events.onOperationProgress handles this
    const subscribe = window?.electronAPI?.events?.onOperationProgress;
    if (typeof subscribe !== 'function') return undefined;
    const unsubscribe = subscribe((data) => {
      if (!data) return;
      const eventType = data.type;
      const payload = data.progress || data;
      const modelName = data.model || payload.model || payload.filename;
      if (!modelName) return;

      if (eventType === 'model-download') {
        updateDownloadState(modelName, {
          status: 'downloading',
          percent: payload.percent ?? payload.percentage ?? 0,
          downloadedBytes: payload.downloadedBytes,
          totalBytes: payload.totalBytes,
          speedBps: payload.speedBps,
          etaSeconds: payload.etaSeconds
        });
        return;
      }

      if (eventType === 'model-download-complete') {
        updateDownloadState(modelName, { status: 'ready', percent: 100 });
        setAvailableModels((prev) => Array.from(new Set([...(prev || []), modelName])));
        return;
      }

      if (eventType === 'model-download-error') {
        updateDownloadState(modelName, {
          status: 'failed',
          error: data.error || payload.error || 'Download failed'
        });
      }
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [updateDownloadState]);

  const applySelectedProfileConfig = useCallback(async () => {
    const updateConfig = window?.electronAPI?.llama?.updateConfig;
    if (typeof updateConfig !== 'function') return true;
    const payload = {
      textModel: selectedModels.text,
      embeddingModel: selectedModels.embedding
    };
    if (selectedModels.vision) {
      payload.visionModel = selectedModels.vision;
    }
    try {
      const response = await updateConfig(payload);
      if (response?.success === false) {
        setInitError(response?.error || 'Could not apply selected model profile.');
        return false;
      }
      return true;
    } catch (error) {
      setInitError(error?.message || 'Could not apply selected model profile.');
      return false;
    }
  }, [selectedModels]);

  useEffect(() => {
    if (step !== 'downloading') return undefined;

    const llamaApi = window?.electronAPI?.llama;
    if (typeof llamaApi?.getModels !== 'function') return undefined;

    let cancelled = false;
    const POLL_INTERVAL_MS = 4000;

    async function syncDownloadState() {
      try {
        const [modelsResponse, downloadStatus] = await Promise.all([
          llamaApi.getModels(),
          typeof llamaApi.getDownloadStatus === 'function'
            ? llamaApi.getDownloadStatus().catch(() => null)
            : Promise.resolve(null)
        ]);
        if (cancelled || !isMountedRef.current) return;

        const modelList = Array.isArray(modelsResponse)
          ? modelsResponse
          : Array.isArray(modelsResponse?.models)
            ? modelsResponse.models
            : [];
        const latestAvailable = modelList.map((m) => m.name || m.filename || m).filter(Boolean);
        const latestAvailableSet = new Set(latestAvailable);
        const hasReliableDownloadStatus = Array.isArray(downloadStatus?.status?.downloads);
        const activeDownloads = hasReliableDownloadStatus ? downloadStatus.status.downloads : [];

        if (latestAvailable.length > 0) {
          setAvailableModels((prev) => Array.from(new Set([...(prev || []), ...latestAvailable])));
        }

        setDownloadState((prev) => {
          const next = { ...(prev || {}) };

          latestAvailable.forEach((name) => {
            next[name] = {
              ...(next[name] || {}),
              status: 'ready',
              percent: 100
            };
          });

          activeDownloads.forEach((download) => {
            if (!download?.filename) return;
            next[download.filename] = {
              ...(next[download.filename] || {}),
              status: 'downloading',
              percent: download.progress ?? next[download.filename]?.percent ?? 0,
              downloadedBytes: download.downloadedBytes,
              totalBytes: download.totalBytes
            };
          });

          return next;
        });

        const requiredMissing = [selectedModels.embedding, selectedModels.text]
          .filter(Boolean)
          .filter((name) => !latestAvailableSet.has(name));

        if (requiredMissing.length === 0 && activeDownloads.length === 0) {
          const applied = await applySelectedProfileConfig();
          if (!cancelled && isMountedRef.current && applied) {
            setStep('complete');
          } else if (!cancelled && isMountedRef.current && !applied) {
            setStep('select');
          }
          return;
        }

        if (
          requiredMissing.length > 0 &&
          hasReliableDownloadStatus &&
          activeDownloads.length === 0
        ) {
          setInitError(
            (prev) => prev || 'Required model downloads stopped. Please retry downloads.'
          );
          setStep('select');
        }
      } catch {
        // Best-effort sync only; keep existing state if polling fails.
      }
    }

    void syncDownloadState();
    const timer = setInterval(() => {
      void syncDownloadState();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [step, selectedModels, applySelectedProfileConfig]);

  async function startDownloads() {
    const modelsToDownload = Object.values(selectedModels)
      .filter(Boolean)
      .filter((modelName) => !availableSet.has(modelName));

    if (modelsToDownload.length === 0) {
      const applied = await applySelectedProfileConfig();
      if (applied) {
        setStep('complete');
      }
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
          // downloadModel() acknowledges that a download has started; it does not
          // guarantee the model is installed yet. We only mark ready when the
          // model appears in getModels() or a completion event arrives.
          updateDownloadState(filename, { status: 'downloading' });
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
    let hasReliableDownloadStatus = false;
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

      const downloads = downloadStatus?.status?.downloads;
      if (Array.isArray(downloads)) {
        hasReliableDownloadStatus = true;
        activeDownloads = downloads;
      }
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

    let configApplied = true;
    if (requiredMissing.length === 0) {
      configApplied = await applySelectedProfileConfig();
    }

    if (requiredMissing.length === 0 && configApplied) {
      setStep('complete');
    } else {
      setStep(
        hasReliableDownloadStatus
          ? activeDownloads.length > 0
            ? 'downloading'
            : 'select'
          : 'downloading'
      );
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
      <Card className={`${getSetupCardClassName()} text-center`}>
        <div className="animate-loading-content">
          <SetupHeader
            step="checking"
            icon={Loader2}
            title="Preparing AI Setup"
            description="Detecting model availability and active downloads for your first run."
          />
          <Text variant="tiny" className="text-system-gray-500 mt-2">
            {CHECKING_STATUS_MESSAGES[checkingStatusIndex]}
          </Text>
          <Text variant="tiny" className="text-system-gray-500 mt-1">
            If this takes too long, you can continue now or open manual setup.
          </Text>
          {showCheckingEscape && (
            <div className="mt-4 flex flex-col sm:flex-row gap-3 justify-center">
              <Button onClick={onSkip} variant="secondary">
                {CONTINUE_WITH_LIMITED_AI_LABEL}
              </Button>
              <Button
                onClick={() => {
                  setInitError(
                    'AI check is taking longer than expected. You can continue with manual setup or press Refresh.'
                  );
                  setStep('select');
                  setIsRefreshing(false);
                }}
                variant="primary"
              >
                Open manual setup
              </Button>
            </div>
          )}
        </div>
      </Card>
    );
  }

  if (step === 'select') {
    return (
      <Card className={getSetupCardClassName()}>
        <SetupHeader
          step="select"
          icon={Cpu}
          title="Choose AI Models"
          description="StratoSort runs AI locally. Download core models once, then keep using them offline."
        />

        {initError && (
          <AlertBox variant="warning" className="mb-6">
            <div className="space-y-1">
              <p className="font-medium">Setup not ready</p>
              <p>{initError}</p>
            </div>
          </AlertBox>
        )}

        {/* System Info */}
        <div className="bg-system-gray-50 rounded-lg p-4 mb-6">
          <Text variant="small" className="font-medium mb-2">
            Your System
          </Text>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-system-gray-700">
            <div>GPU: {systemInfo?.gpuBackend || 'CPU only'}</div>
            <div>Models path: {systemInfo?.modelsPath || 'Default app storage'}</div>
          </div>
        </div>

        <div className="mb-6">
          <Text variant="small" className="font-medium mb-2">
            Install Profile
          </Text>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SelectionCard
              selected={selectedProfile === 'base'}
              onSelect={() => {
                setSelectedProfile('base');
                setRecommendations(PROFILE_MODELS.base);
                setSelectedModels(PROFILE_MODELS.base);
              }}
              disabled={!hasApi || isRefreshing}
            >
              <Text className="font-medium">
                {INSTALL_MODEL_PROFILES?.BASE_SMALL?.label || 'Base (Small & Fast)'}
              </Text>
              <Text variant="small" className="mt-1">
                {INSTALL_MODEL_PROFILES?.BASE_SMALL?.description ||
                  'Runs on most machines with faster startup and smaller downloads.'}
              </Text>
              <Text variant="tiny" className="mt-2">
                Approx. download: {formatBytes(getProfileSize('base'))}
              </Text>
            </SelectionCard>
            <SelectionCard
              selected={selectedProfile === 'quality'}
              onSelect={() => {
                setSelectedProfile('quality');
                setRecommendations(PROFILE_MODELS.quality);
                setSelectedModels(PROFILE_MODELS.quality);
              }}
              disabled={!hasApi || isRefreshing}
            >
              <Text className="font-medium">
                {INSTALL_MODEL_PROFILES?.BETTER_QUALITY?.label || 'Better Quality (Larger)'}
              </Text>
              <Text variant="small" className="mt-1">
                {INSTALL_MODEL_PROFILES?.BETTER_QUALITY?.description ||
                  'Higher quality output with larger models and larger downloads.'}
              </Text>
              <Text variant="tiny" className="mt-2">
                Approx. download: {formatBytes(getProfileSize('quality'))}
              </Text>
            </SelectionCard>
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
        <div className="bg-stratosort-blue/5 border border-stratosort-blue/20 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <Text className="font-medium">Total Download</Text>
              <Text variant="small">{formatBytes(totalDownloadSize)}</Text>
              <Text variant="tiny">
                One-time download. You can keep using the app while this runs.
              </Text>
            </div>
            <HardDrive className="w-6 h-6 text-stratosort-blue" />
          </div>
        </div>

        {requiredModelsMissing.length > 0 && (
          <AlertBox variant="warning" className="mb-6">
            Required models are missing. Download them to enable AI features.
          </AlertBox>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={startDownloads}
            variant="primary"
            className="flex-1"
            disabled={!selectedModels.embedding || !selectedModels.text || !hasApi || isRefreshing}
          >
            <Download className="w-4 h-4" />
            Download Models
          </Button>
          <Button onClick={checkSystem} variant="secondary" disabled={isRefreshing}>
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={onSkip} variant="secondary" className="sm:min-w-[140px]">
            {CONTINUE_WITH_LIMITED_AI_LABEL}
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
      <Card className={getSetupCardClassName()}>
        <SetupHeader
          step="downloading"
          icon={Download}
          title="Downloading Models"
          description="This can take a while depending on your connection. You can continue with limited AI at any time."
        />

        <div className="space-y-4">
          {models.map(([_type, filename]) => {
            const progress = downloadState[filename] || { percent: 0 };
            const status = progress.status || 'downloading';
            return (
              <div key={filename} className="border border-border-soft rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <Text className="font-medium">{getModel(filename)?.displayName || filename}</Text>
                  <Text variant="small">
                    {status === 'failed' ? 'Failed' : `${progress.percent || 0}%`}
                  </Text>
                </div>
                <div className="w-full bg-system-gray-200 rounded-full h-2 mb-2">
                  <div
                    className="bg-stratosort-blue h-2 rounded-full transition-all"
                    style={{ width: `${progress.percent || 0}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-system-gray-500">
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
                  <Text variant="tiny" className="text-stratosort-danger mt-2">
                    {progress.error}
                  </Text>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <Button
            onClick={async () => {
              if (allComplete) {
                const applied = await applySelectedProfileConfig();
                if (applied) {
                  setStep('complete');
                }
              } else {
                onSkip();
              }
            }}
            variant={allComplete ? 'primary' : 'secondary'}
            className="w-full sm:flex-1"
          >
            {allComplete ? 'Continue' : CONTINUE_WITH_LIMITED_AI_LABEL}
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
    <Card className={`${getSetupCardClassName()} text-center`}>
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-stratosort-success/10 mb-4">
        <CheckCircle className="w-7 h-7 text-stratosort-success" />
      </div>
      <Heading as="h2" variant="h2">
        Setup Complete!
      </Heading>
      <Text className="text-system-gray-600 mt-2 mb-6">
        StratoSort is ready to organize your files with AI
      </Text>
      <Button onClick={onComplete} variant="primary">
        Get Started
      </Button>
    </Card>
  );
}

function SetupHeader({ step, icon: Icon, title, description }) {
  const currentStepIndex = Math.max(0, STEP_ORDER.indexOf(step));

  return (
    <div className="text-center mb-6">
      <div className="flex items-center justify-center gap-2 mb-3">
        {STEP_ORDER.map((stepKey, index) => {
          const isActive = index <= currentStepIndex;
          return (
            <React.Fragment key={stepKey}>
              <Text
                as="span"
                variant="tiny"
                className={`px-2 py-1 rounded-full border ${
                  isActive
                    ? 'border-stratosort-blue/40 bg-stratosort-blue/10 text-stratosort-blue'
                    : 'border-border-soft bg-white text-system-gray-500'
                }`}
              >
                {STEP_TITLES[stepKey]}
              </Text>
              {index < STEP_ORDER.length - 1 && (
                <span className="text-system-gray-300" aria-hidden="true">
                  -
                </span>
              )}
            </React.Fragment>
          );
        })}
      </div>
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-stratosort-blue/10 mb-4">
        <Icon
          className={`w-7 h-7 text-stratosort-blue ${step === 'checking' ? 'animate-spin' : ''}`}
        />
      </div>
      <Heading as="h2" variant="h2">
        {title}
      </Heading>
      <Text className="text-system-gray-600 mt-2">{description}</Text>
    </div>
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
    ? 'bg-stratosort-success/10 text-stratosort-success'
    : status === 'failed'
      ? 'bg-stratosort-danger/10 text-stratosort-danger'
      : 'bg-system-gray-100 text-system-gray-700';

  return (
    <div className="border border-border-soft rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <Text className="font-medium">{label}</Text>
          <Text variant="small">{description}</Text>
        </div>
        <div className="flex items-center gap-2">
          {required && (
            <Text
              as="span"
              variant="tiny"
              className="bg-stratosort-blue/10 text-stratosort-blue px-2 py-1 rounded"
            >
              Required
            </Text>
          )}
          {optional && (
            <Text
              as="span"
              variant="tiny"
              className="bg-system-gray-100 text-system-gray-600 px-2 py-1 rounded"
            >
              Optional
            </Text>
          )}
          <Text as="span" variant="tiny" className={`px-2 py-1 rounded ${statusClass}`}>
            {statusLabel}
          </Text>
        </div>
      </div>

      <label
        className={`flex items-center p-3 rounded border cursor-pointer transition
          ${
            selected === filename
              ? 'border-stratosort-blue bg-stratosort-blue/5'
              : 'border-system-gray-200 hover:border-system-gray-300'
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
            <Text
              as="span"
              variant="tiny"
              className="bg-stratosort-success/10 text-stratosort-success px-2 py-0.5 rounded"
            >
              Recommended
            </Text>
          </div>
          <Text variant="tiny">{formatBytes(getModelSize(filename))}</Text>
          {error && (
            <Text variant="tiny" className="text-stratosort-danger mt-1">
              {error}
            </Text>
          )}
        </div>
      </label>
    </div>
  );
}
