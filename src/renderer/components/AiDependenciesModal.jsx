import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Info } from 'lucide-react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Card from './ui/Card';
import StatusBadge from './ui/StatusBadge';
import StateMessage from './ui/StateMessage';
import { Heading, Text } from './ui/Typography';
import { ErrorBoundaryCore as ErrorBoundary } from './ErrorBoundary';
import { logger } from '../../shared/logger';
import { Inline } from './layout';

logger.setContext('AiDependenciesModal');

function normalizeOllamaModelName(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (!trimmed.includes(':')) return `${trimmed}:latest`;
  return trimmed;
}

let logIdCounter = 0;
const MAX_LOG_ENTRIES = 50;

export default function AiDependenciesModal({ isOpen, onClose }) {
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState({ ollama: false, chromadb: false });
  const [downloadingModels, setDownloadingModels] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const [installedModels, setInstalledModels] = useState([]);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const unsubRef = useRef(null);
  const statusUnsubRef = useRef(null);
  const logContainerRef = useRef(null);

  const isRefreshingRef = useRef(false);
  const pendingRefreshRef = useRef(false);

  const addLogEntry = useCallback((text) => {
    setLogLines((prev) => [...prev, { id: ++logIdCounter, text }].slice(-MAX_LOG_ENTRIES));
  }, []);

  const refresh = useCallback(async () => {
    if (isRefreshingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    isRefreshingRef.current = true;

    try {
      setLoading(true);
      if (!window.electronAPI?.dependencies?.getStatus) {
        addLogEntry('[error] Dependencies API not available. Please restart the application.');
        setStatus(null);
        setSettings({});
        return;
      }
      const [s, st] = await Promise.all([
        window.electronAPI?.settings?.get?.(),
        window.electronAPI.dependencies.getStatus()
      ]);
      if (st?.success === false) {
        logger.error('Failed to get dependency status', { error: st?.error });
        addLogEntry(
          `[error] Failed to get status: ${st?.error?.message || st?.error || 'Unknown'}`
        );
      }
      setSettings(s || {});
      setStatus(st?.status || null);

      if (st?.status?.ollama?.running && window.electronAPI?.ollama?.getModels) {
        try {
          const modelsRes = await window.electronAPI.ollama.getModels();
          if (modelsRes?.models) {
            setInstalledModels(modelsRes.models);
          }
        } catch {
          // Non-fatal
        }
      }
    } catch (e) {
      logger.error('Failed to refresh dependency status', { error: e?.message });
      addLogEntry(`[error] Refresh failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
      isRefreshingRef.current = false;

      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        setTimeout(refresh, 0);
      }
    }
  }, [addLogEntry]);

  const recommendedModels = useMemo(() => {
    const text = normalizeOllamaModelName(settings?.textModel);
    const vision = normalizeOllamaModelName(settings?.visionModel);
    const embed = normalizeOllamaModelName(settings?.embeddingModel);
    return [text, vision, embed].filter(Boolean);
  }, [settings]);

  useEffect(() => {
    if (!isOpen) return undefined;

    refresh();

    try {
      if (window.electronAPI?.events?.onOperationProgress) {
        unsubRef.current = window.electronAPI.events.onOperationProgress((evt) => {
          try {
            if (!evt) return;
            if (evt.type !== 'dependency' && evt.type !== 'ollama-pull') return;

            setLogLines((prev) => {
              const next = [...prev];
              if (evt.type === 'dependency') {
                const dep = evt.dependency ? `(${evt.dependency}) ` : '';
                next.push({ id: ++logIdCounter, text: `${dep}${evt.message || 'Working…'}` });
              } else if (evt.type === 'ollama-pull') {
                const p = evt.progress;
                const pct =
                  p && typeof p.completed === 'number' && typeof p.total === 'number' && p.total > 0
                    ? Math.round((p.completed / p.total) * 100)
                    : null;
                if (pct !== null) {
                  setDownloadProgress({ model: evt.model, percent: pct });
                }
                next.push({
                  id: ++logIdCounter,
                  text: `(ollama) Downloading ${evt.model}${pct !== null ? ` ${pct}%` : ''}`
                });
              }
              return next.slice(-MAX_LOG_ENTRIES);
            });
          } catch (e) {
            logger.debug('Progress handler error', { error: e?.message });
          }
        });
      }
    } catch (e) {
      logger.warn('Failed to subscribe to progress events', { error: e?.message });
    }

    try {
      if (window.electronAPI?.dependencies?.onServiceStatusChanged) {
        statusUnsubRef.current = window.electronAPI.dependencies.onServiceStatusChanged((evt) => {
          try {
            if (!evt) return;
            const statusMsg =
              evt.status === 'permanently_failed'
                ? `${evt.service} permanently failed (circuit breaker tripped)`
                : `${evt.service} is now ${evt.status}`;
            setLogLines((prev) =>
              [...prev, { id: ++logIdCounter, text: `[status] ${statusMsg}` }].slice(
                -MAX_LOG_ENTRIES
              )
            );
            refresh();
          } catch (e) {
            logger.debug('Status change handler error', { error: e?.message });
          }
        });
      }
    } catch (e) {
      logger.warn('Failed to subscribe to service status events', { error: e?.message });
    }

    return () => {
      if (typeof unsubRef.current === 'function') {
        try {
          unsubRef.current();
        } catch {
          // ignore
        }
      }
      unsubRef.current = null;

      if (typeof statusUnsubRef.current === 'function') {
        try {
          statusUnsubRef.current();
        } catch {
          // ignore
        }
      }
      statusUnsubRef.current = null;
    };
  }, [isOpen, refresh]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logLines]);

  const saveSetting = async (patch) => {
    const next = { ...(settings || {}), ...(patch || {}) };
    setSettings(next);
    try {
      await window.electronAPI?.settings?.save?.(next);
    } catch (e) {
      logger.error('Failed to save settings', { error: e?.message });
    }
  };

  const installOllama = async () => {
    if (!window.electronAPI?.dependencies?.installOllama) {
      addLogEntry('[error] Install API not available. Please restart the application.');
      return;
    }
    setInstalling((p) => ({ ...p, ollama: true }));
    try {
      const result = await window.electronAPI.dependencies.installOllama();
      if (result && !result.success) {
        addLogEntry(`[error] Ollama install failed: ${result.error || 'Unknown error'}`);
      } else if (result?.startupError) {
        addLogEntry(`[warning] Ollama installed but failed to start: ${result.startupError}`);
      }
      await refresh();
    } catch (e) {
      logger.error('Failed to install Ollama', { error: e?.message });
      addLogEntry(`[error] Installation failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setInstalling((p) => ({ ...p, ollama: false }));
    }
  };

  const installChromaDb = async () => {
    if (!window.electronAPI?.dependencies?.installChromaDb) {
      addLogEntry('[error] Install API not available. Please restart the application.');
      return;
    }
    setInstalling((p) => ({ ...p, chromadb: true }));
    try {
      const result = await window.electronAPI.dependencies.installChromaDb();
      if (result && !result.success) {
        addLogEntry(`[error] ChromaDB install failed: ${result.error || 'Unknown error'}`);
      } else if (result?.startupError) {
        addLogEntry(`[warning] ChromaDB installed but failed to start: ${result.startupError}`);
      }
      await refresh();
    } catch (e) {
      logger.error('Failed to install ChromaDB', { error: e?.message });
      addLogEntry(`[error] Installation failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setInstalling((p) => ({ ...p, chromadb: false }));
    }
  };

  const downloadModels = async () => {
    if (!recommendedModels.length || downloadingModels) return;
    if (!window.electronAPI?.ollama?.pullModels) {
      addLogEntry('[error] Ollama API not available. Please restart the application.');
      return;
    }
    setDownloadingModels(true);
    setDownloadProgress(null);
    try {
      const result = await window.electronAPI.ollama.pullModels(recommendedModels);
      if (result && !result.success) {
        addLogEntry(`[error] Model download failed: ${result.error || 'Unknown error'}`);
      } else if (result?.results) {
        for (const r of result.results) {
          if (r.success) {
            addLogEntry(`[success] Downloaded ${r.model}`);
          } else {
            addLogEntry(`[error] Failed to download ${r.model}: ${r.error || 'Unknown'}`);
          }
        }
      }
      await refresh();
    } catch (e) {
      logger.error('Failed to download models', { error: e?.message });
      addLogEntry(`[error] Model download failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setDownloadingModels(false);
      setDownloadProgress(null);
    }
  };

  const ollamaOk = Boolean(status?.ollama?.installed);
  const ollamaRunning = Boolean(status?.ollama?.running);
  const ollamaVersion = status?.ollama?.version || null;
  const chromaExternal = Boolean(status?.chromadb?.external);
  const chromaOk = Boolean(
    chromaExternal ? status?.chromadb?.running : status?.chromadb?.pythonModuleInstalled
  );
  const chromaRunning = Boolean(status?.chromadb?.running);
  const pythonOk = Boolean(status?.python?.installed);
  const pythonVersion = status?.python?.version || null;

  const getStatusBadgeProps = (running, installed) => {
    if (status === null) return { variant: 'info', children: 'Checking...', animated: true };
    if (running) return { variant: 'success', children: 'Running', animated: true };
    if (installed) return { variant: 'info', children: 'Installed', animated: false };
    return { variant: 'warning', children: 'Not Installed', animated: false };
  };

  const getOllamaStatusProps = () => getStatusBadgeProps(ollamaRunning, ollamaOk);
  const getChromaStatusProps = () => getStatusBadgeProps(chromaRunning, chromaOk);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="AI Components Setup"
      size="lg"
      footer={
        <Inline className="justify-end" gap="compact" wrap={false}>
          <Button variant="secondary" onClick={onClose} size="sm">
            Done
          </Button>
        </Inline>
      }
    >
      <ErrorBoundary variant="phase" contextName="AI Dependencies">
        <div className="flex flex-col gap-5">
          <div className="bg-stratosort-blue/5 rounded-xl p-4 border border-stratosort-blue/20">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-stratosort-blue/10 rounded-lg flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-stratosort-blue"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <div>
                <Heading as="h3" variant="h6" className="text-system-gray-900">
                  Get Started with AI Features
                </Heading>
                <Text variant="small" className="text-system-gray-600 mt-1">
                  Install Ollama for AI-powered file analysis and ChromaDB for Knowledge OS
                  (semantic search + RAG). These are optional but unlock powerful organization
                  features.
                </Text>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card variant="default" className="p-0 overflow-hidden">
              <div className="p-4 border-b border-system-gray-100 bg-system-gray-50/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-stratosort-warning to-stratosort-danger rounded-lg flex items-center justify-center shadow-sm">
                      <svg
                        className="w-5 h-5 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                    <div>
                      <Heading as="h4" variant="h6" className="text-system-gray-900">
                        Ollama
                      </Heading>
                      <Text variant="tiny" className="text-system-gray-500">
                        Local AI inference engine
                      </Text>
                    </div>
                  </div>
                  <StatusBadge {...getOllamaStatusProps()} size="sm" />
                </div>
              </div>

              <div className="p-4 space-y-4">
                {ollamaVersion && (
                  <Text variant="tiny" className="text-system-gray-500">
                    Version: {ollamaVersion}
                  </Text>
                )}

                <Button
                  variant={ollamaOk ? 'secondary' : 'primary'}
                  className="w-full justify-center"
                  disabled={installing.ollama || status === null}
                  onClick={installOllama}
                  title={
                    status === null ? 'Checking status...' : 'Download and install Ollama silently'
                  }
                >
                  {installing.ollama ? (
                    <>
                      <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                      Installing...
                    </>
                  ) : ollamaOk ? (
                    'Reinstall / Repair'
                  ) : (
                    <>
                      <svg
                        className="w-4 h-4 mr-2"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                        />
                      </svg>
                      Install Ollama
                    </>
                  )}
                </Button>

                {ollamaOk && (
                  <div className="border-t border-system-gray-100 pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <Text variant="small" className="font-medium text-system-gray-700">
                        AI Models
                      </Text>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={downloadModels}
                        disabled={
                          !ollamaRunning || recommendedModels.length === 0 || downloadingModels
                        }
                        title={
                          downloadingModels
                            ? 'Downloading models...'
                            : !ollamaRunning
                              ? 'Ollama must be running to download models'
                              : 'Download recommended models'
                        }
                      >
                        {downloadingModels ? 'Downloading...' : 'Download All'}
                      </Button>
                    </div>

                    {downloadingModels && downloadProgress && (
                      <div className="mb-3">
                        <div className="flex items-center justify-between mb-1">
                          <Text variant="tiny" className="text-system-gray-600">
                            Downloading {downloadProgress.model?.replace(':latest', '')}
                          </Text>
                          <Text variant="tiny" className="text-system-gray-600">
                            {downloadProgress.percent}%
                          </Text>
                        </div>
                        <div className="h-2 bg-system-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-stratosort-blue to-stratosort-indigo transition-all duration-300"
                            style={{ width: `${downloadProgress.percent}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      {recommendedModels.length > 0 ? (
                        recommendedModels.map((model) => {
                          const isInstalled = installedModels.some(
                            (m) => m === model || m.startsWith(`${model.split(':')[0]}:`)
                          );
                          return (
                            <div
                              key={model}
                              className={`flex items-center justify-between p-2 rounded-lg ${
                                isInstalled ? 'bg-stratosort-success/5' : 'bg-system-gray-50'
                              }`}
                            >
                              <Text variant="small" className="text-system-gray-700">
                                {model.replace(':latest', '')}
                              </Text>
                              {isInstalled ? (
                                <Text
                                  as="span"
                                  variant="tiny"
                                  className="flex items-center text-stratosort-success font-medium"
                                >
                                  <svg
                                    className="w-4 h-4 mr-1"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M5 13l4 4L19 7"
                                    />
                                  </svg>
                                  Ready
                                </Text>
                              ) : (
                                <Text variant="tiny" className="text-system-gray-500">
                                  Not downloaded
                                </Text>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <StateMessage
                          icon={Info}
                          tone="neutral"
                          size="sm"
                          title="No models configured"
                          description="Set models in Settings."
                          className="py-2"
                          contentClassName="max-w-xs"
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Card>

            <Card variant="default" className="p-0 overflow-hidden">
              <div className="p-4 border-b border-system-gray-100 bg-system-gray-50/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-stratosort-purple to-stratosort-indigo rounded-lg flex items-center justify-center shadow-sm">
                      <svg
                        className="w-5 h-5 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
                        />
                      </svg>
                    </div>
                    <div>
                      <Heading as="h4" variant="h6" className="text-system-gray-900">
                        ChromaDB
                      </Heading>
                      <Text variant="tiny" className="text-system-gray-500">
                        Vector database for Knowledge OS
                      </Text>
                    </div>
                  </div>
                  <StatusBadge {...getChromaStatusProps()} size="sm" />
                </div>
              </div>

              <div className="p-4 space-y-4">
                {status !== null && (
                  <Text as="div" variant="tiny" className="space-y-1 text-system-gray-500">
                    {chromaExternal ? (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">Mode:</span> External Server
                        </div>
                        {status?.chromadb?.serverUrl && (
                          <div className="flex items-center gap-2">
                            <span className="font-medium">URL:</span>
                            <code className="bg-system-gray-100 px-1.5 py-0.5 rounded text-xs">
                              {status.chromadb.serverUrl}
                            </code>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${pythonOk ? 'bg-stratosort-success' : 'bg-stratosort-warning'}`}
                          />
                          Python: {pythonOk ? pythonVersion || 'Detected' : 'Required'}
                        </div>
                      </>
                    )}
                  </Text>
                )}

                <Button
                  variant={chromaOk ? 'secondary' : 'primary'}
                  className="w-full justify-center"
                  disabled={installing.chromadb || !pythonOk || chromaExternal || status === null}
                  onClick={installChromaDb}
                  title={
                    status === null
                      ? 'Checking status...'
                      : chromaExternal
                        ? 'ChromaDB is configured as an external server'
                        : pythonOk
                          ? 'Install ChromaDB Python module'
                          : 'Install Python 3 first'
                  }
                >
                  {installing.chromadb ? (
                    <>
                      <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                      Installing...
                    </>
                  ) : chromaOk ? (
                    'Reinstall / Upgrade'
                  ) : (
                    <>
                      <svg
                        className="w-4 h-4 mr-2"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                        />
                      </svg>
                      Install ChromaDB
                    </>
                  )}
                </Button>

                {!pythonOk && !chromaExternal && status !== null && (
                  <div className="bg-stratosort-warning/10 border border-stratosort-warning/20 rounded-lg p-3">
                    <Text variant="tiny" className="text-stratosort-warning">
                      Python 3 is required. Install it and ensure it&apos;s available as{' '}
                      <code className="bg-white/50 px-1 rounded">py -3</code> (Windows) or{' '}
                      <code className="bg-white/50 px-1 rounded">python3</code>.
                    </Text>
                  </div>
                )}

                {chromaExternal && !chromaRunning && (
                  <div className="bg-stratosort-blue/10 border border-stratosort-blue/20 rounded-lg p-3">
                    <Text variant="tiny" className="text-stratosort-blue">
                      Ensure your Docker container is running and the port is mapped (e.g.{' '}
                      <code className="bg-white/50 px-1 rounded">-p 8000:8000</code>), then click
                      Refresh.
                    </Text>
                  </div>
                )}
              </div>
            </Card>
          </div>

          <Card variant="default" className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 bg-system-gray-200 rounded-lg flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-system-gray-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </div>
              <div>
                <Heading as="h4" variant="h6" className="text-sm">
                  Automatic Updates
                </Heading>
                <Text variant="tiny" className="text-system-gray-500">
                  Allow StratoSort to keep dependencies up to date
                </Text>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 ml-11">
              <label className="flex items-center gap-2 text-sm text-system-gray-700 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={Boolean(settings?.autoUpdateOllama)}
                  onChange={(e) => saveSetting({ autoUpdateOllama: e.target.checked })}
                  className="w-4 h-4 rounded border-system-gray-300 text-stratosort-blue focus:ring-stratosort-blue cursor-pointer"
                />
                <span className="group-hover:text-system-gray-900 transition-colors">Ollama</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-system-gray-700 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={Boolean(settings?.autoUpdateChromaDb)}
                  onChange={(e) => saveSetting({ autoUpdateChromaDb: e.target.checked })}
                  className="w-4 h-4 rounded border-system-gray-300 text-stratosort-blue focus:ring-stratosort-blue cursor-pointer"
                />
                <span className="group-hover:text-system-gray-900 transition-colors">ChromaDB</span>
              </label>
            </div>
          </Card>

          <Card variant="default" className="p-0 overflow-hidden">
            <div className="p-4 border-b border-system-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-system-gray-100 rounded-lg flex items-center justify-center">
                  <svg
                    className="w-4 h-4 text-system-gray-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h7"
                    />
                  </svg>
                </div>
                <div>
                  <Heading as="h4" variant="h6" className="text-sm">
                    Activity Log
                  </Heading>
                  <Text variant="tiny" className="text-system-gray-500">
                    {loading ? 'Checking status...' : 'Live updates while this modal is open'}
                  </Text>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>
                {loading ? (
                  <>
                    <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1.5" />
                    Checking
                  </>
                ) : (
                  <>
                    <svg
                      className="w-3 h-3 mr-1.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    Refresh
                  </>
                )}
              </Button>
            </div>

            <div
              ref={logContainerRef}
              className="p-4 bg-system-gray-900 max-h-32 overflow-auto text-xs font-mono modern-scrollbar"
            >
              {logLines.length === 0 ? (
                <StateMessage
                  icon={Info}
                  tone="neutral"
                  surface="inverse"
                  size="sm"
                  title="No activity yet"
                  description="Install or refresh to see updates."
                  className="py-4"
                />
              ) : (
                <ul className="space-y-1">
                  {logLines.map((entry) => (
                    <li
                      key={entry.id}
                      className={`${
                        entry.text.includes('[error]')
                          ? 'text-stratosort-danger'
                          : entry.text.includes('[success]')
                            ? 'text-stratosort-success'
                            : entry.text.includes('[warning]')
                              ? 'text-stratosort-warning'
                              : entry.text.includes('[status]')
                                ? 'text-stratosort-blue'
                                : 'text-system-gray-300'
                      }`}
                    >
                      {entry.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </ErrorBoundary>
    </Modal>
  );
}

AiDependenciesModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired
};
