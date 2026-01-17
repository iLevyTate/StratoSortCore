import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Modal from './Modal';
import Button from './ui/Button';
import { logger } from '../../shared/logger';
import { ErrorBoundaryCore as ErrorBoundary } from './ErrorBoundary';

logger.setContext('AiDependenciesModal');

function normalizeOllamaModelName(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  // If user selected "mxbai-embed-large" without tag, pull latest
  if (!trimmed.includes(':')) return `${trimmed}:latest`;
  return trimmed;
}

// Unique ID counter for log entries (prevents key collisions)
let logIdCounter = 0;
const MAX_LOG_ENTRIES = 50;

// Status badge component
function StatusBadge({ status, label }) {
  const styles = {
    running: 'bg-green-100 text-green-700 border-green-200',
    installed: 'bg-blue-100 text-blue-700 border-blue-200',
    missing: 'bg-amber-100 text-amber-700 border-amber-200',
    error: 'bg-red-100 text-red-700 border-red-200',
    checking: 'bg-gray-100 text-gray-600 border-gray-200'
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${styles[status] || styles.missing}`}
    >
      {status === 'running' && (
        <span className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1.5 animate-pulse" />
      )}
      {status === 'checking' && (
        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full mr-1.5 animate-pulse" />
      )}
      {label}
    </span>
  );
}

StatusBadge.propTypes = {
  status: PropTypes.oneOf(['running', 'installed', 'missing', 'error', 'checking']).isRequired,
  label: PropTypes.string.isRequired
};

export default function AiDependenciesModal({ isOpen, onClose }) {
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState({ ollama: false, chromadb: false });
  const [downloadingModels, setDownloadingModels] = useState(false);
  const [logLines, setLogLines] = useState([]); // Now stores { id, text } objects
  const [installedModels, setInstalledModels] = useState([]); // Models already downloaded
  const [downloadProgress, setDownloadProgress] = useState(null); // { model, percent }
  const unsubRef = useRef(null);
  const statusUnsubRef = useRef(null);
  const logContainerRef = useRef(null);

  // Mutex for refresh operations
  const isRefreshingRef = useRef(false);
  const pendingRefreshRef = useRef(false);

  // Helper to add a log entry
  const addLogEntry = useCallback((text) => {
    setLogLines((prev) => [...prev, { id: ++logIdCounter, text }].slice(-MAX_LOG_ENTRIES));
  }, []);

  // Memoized refresh function - stable reference for use in effects
  const refresh = useCallback(async () => {
    // Mutex guard to prevent overlapping refresh calls
    if (isRefreshingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    isRefreshingRef.current = true;

    try {
      setLoading(true);
      // Validate API availability before calling
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
      // Handle error responses from IPC
      if (st?.success === false) {
        logger.error('Failed to get dependency status', { error: st?.error });
        addLogEntry(
          `[error] Failed to get status: ${st?.error?.message || st?.error || 'Unknown'}`
        );
      }
      setSettings(s || {});
      setStatus(st?.status || null);

      // Fetch installed models if Ollama is running
      if (st?.status?.ollama?.running && window.electronAPI?.ollama?.getModels) {
        try {
          const modelsRes = await window.electronAPI.ollama.getModels();
          if (modelsRes?.models) {
            setInstalledModels(modelsRes.models);
          }
        } catch {
          // Non-fatal - just won't show installed models
        }
      }
    } catch (e) {
      logger.error('Failed to refresh dependency status', { error: e?.message });
      addLogEntry(`[error] Refresh failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
      isRefreshingRef.current = false;

      // Handle pending refresh if one was requested during execution
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        // Schedule next refresh on next tick
        setTimeout(refresh, 0);
      }
    }
  }, [addLogEntry]); // addLogEntry is stable (useCallback with empty deps)

  const recommendedModels = useMemo(() => {
    const text = normalizeOllamaModelName(settings?.textModel);
    const vision = normalizeOllamaModelName(settings?.visionModel);
    const embed = normalizeOllamaModelName(settings?.embeddingModel);
    return [text, vision, embed].filter(Boolean);
  }, [settings]);

  useEffect(() => {
    if (!isOpen) return undefined;

    refresh();

    // Subscribe to progress while modal is open
    try {
      if (window.electronAPI?.events?.onOperationProgress) {
        unsubRef.current = window.electronAPI.events.onOperationProgress((evt) => {
          try {
            if (!evt) return;
            // Only show dependency + model download progress to avoid noisy logs
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
                // Update progress bar state
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

    // Subscribe to service status changes (auto-refresh when services start/stop/fail)
    try {
      if (window.electronAPI?.dependencies?.onServiceStatusChanged) {
        statusUnsubRef.current = window.electronAPI.dependencies.onServiceStatusChanged((evt) => {
          try {
            if (!evt) return;
            // Log the status change
            const statusMsg =
              evt.status === 'permanently_failed'
                ? `${evt.service} permanently failed (circuit breaker tripped)`
                : `${evt.service} is now ${evt.status}`;
            setLogLines((prev) =>
              [...prev, { id: ++logIdCounter, text: `[status] ${statusMsg}` }].slice(
                -MAX_LOG_ENTRIES
              )
            );
            // Auto-refresh status to update UI
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
  }, [isOpen, refresh]); // refresh is stable (useCallback with empty deps)

  // Auto-scroll log container to latest entry
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
    // Validate API availability
    if (!window.electronAPI?.dependencies?.installOllama) {
      addLogEntry('[error] Install API not available. Please restart the application.');
      return;
    }
    setInstalling((p) => ({ ...p, ollama: true }));
    try {
      const result = await window.electronAPI.dependencies.installOllama();
      // Check for failure response
      if (result && !result.success) {
        addLogEntry(`[error] Ollama install failed: ${result.error || 'Unknown error'}`);
      } else if (result?.startupError) {
        // Installed but failed to start
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
    // Validate API availability
    if (!window.electronAPI?.dependencies?.installChromaDb) {
      addLogEntry('[error] Install API not available. Please restart the application.');
      return;
    }
    setInstalling((p) => ({ ...p, chromadb: true }));
    try {
      const result = await window.electronAPI.dependencies.installChromaDb();
      // Check for failure response
      if (result && !result.success) {
        addLogEntry(`[error] ChromaDB install failed: ${result.error || 'Unknown error'}`);
      } else if (result?.startupError) {
        // Installed but failed to start
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
    // Validate API availability
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
        // Log individual model results
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

  // Derive status badges
  const getOllamaStatus = () => {
    if (status === null) return { status: 'checking', label: 'Checking...' };
    if (ollamaRunning) return { status: 'running', label: 'Running' };
    if (ollamaOk) return { status: 'installed', label: 'Installed' };
    return { status: 'missing', label: 'Not Installed' };
  };

  const getChromaStatus = () => {
    if (status === null) return { status: 'checking', label: 'Checking...' };
    if (chromaRunning) return { status: 'running', label: 'Running' };
    if (chromaOk) return { status: 'installed', label: 'Installed' };
    return { status: 'missing', label: 'Not Installed' };
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="AI Components Setup" size="large">
      <ErrorBoundary variant="phase" contextName="AI Dependencies">
        <div className="flex flex-col gap-5">
          {/* Header description */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-blue-600"
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
                <h3 className="font-medium text-gray-900">Get Started with AI Features</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Install Ollama for AI-powered file analysis and ChromaDB for Knowledge OS
                  (semantic search + RAG). These are optional but unlock powerful organization
                  features.
                </p>
              </div>
            </div>
          </div>

          {/* Dependency Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Ollama Card */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-red-500 rounded-lg flex items-center justify-center shadow-sm">
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
                      <h4 className="font-semibold text-gray-900">Ollama</h4>
                      <p className="text-xs text-gray-500">Local AI inference engine</p>
                    </div>
                  </div>
                  <StatusBadge {...getOllamaStatus()} />
                </div>
              </div>

              <div className="p-4 space-y-4">
                {ollamaVersion && (
                  <div className="text-xs text-gray-500">Version: {ollamaVersion}</div>
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

                {/* Models Section */}
                {ollamaOk && (
                  <div className="border-t border-gray-100 pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-gray-700">AI Models</span>
                      <Button
                        variant="secondary"
                        className="text-xs px-3 py-1.5"
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

                    {/* Download Progress Bar */}
                    {downloadingModels && downloadProgress && (
                      <div className="mb-3">
                        <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                          <span>Downloading {downloadProgress.model?.replace(':latest', '')}</span>
                          <span>{downloadProgress.percent}%</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-300"
                            style={{ width: `${downloadProgress.percent}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Models List */}
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
                                isInstalled ? 'bg-green-50' : 'bg-gray-50'
                              }`}
                            >
                              <span className="text-sm text-gray-700">
                                {model.replace(':latest', '')}
                              </span>
                              {isInstalled ? (
                                <span className="flex items-center text-xs text-green-600 font-medium">
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
                                </span>
                              ) : (
                                <span className="text-xs text-gray-500">Not downloaded</span>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-xs text-gray-500 text-center py-2">
                          No models configured. Set models in Settings.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ChromaDB Card */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-indigo-500 rounded-lg flex items-center justify-center shadow-sm">
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
                      <h4 className="font-semibold text-gray-900">ChromaDB</h4>
                      <p className="text-xs text-gray-500">Vector database for Knowledge OS</p>
                    </div>
                  </div>
                  <StatusBadge {...getChromaStatus()} />
                </div>
              </div>

              <div className="p-4 space-y-4">
                {/* Status Details */}
                {status !== null && (
                  <div className="space-y-1 text-xs text-gray-500">
                    {chromaExternal ? (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">Mode:</span> External Server
                        </div>
                        {status?.chromadb?.serverUrl && (
                          <div className="flex items-center gap-2">
                            <span className="font-medium">URL:</span>
                            <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">
                              {status.chromadb.serverUrl}
                            </code>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${pythonOk ? 'bg-green-400' : 'bg-amber-400'}`}
                          />
                          Python: {pythonOk ? pythonVersion || 'Detected' : 'Required'}
                        </div>
                      </>
                    )}
                  </div>
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

                {/* Help messages */}
                {!pythonOk && !chromaExternal && status !== null && (
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                    <p className="text-xs text-amber-700">
                      Python 3 is required. Install it and ensure it&apos;s available as{' '}
                      <code className="bg-amber-100 px-1 rounded">py -3</code> (Windows) or{' '}
                      <code className="bg-amber-100 px-1 rounded">python3</code>.
                    </p>
                  </div>
                )}

                {chromaExternal && !chromaRunning && (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                    <p className="text-xs text-blue-700">
                      Ensure your Docker container is running and the port is mapped (e.g.{' '}
                      <code className="bg-blue-100 px-1 rounded">-p 8000:8000</code>), then click
                      Refresh.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Auto-Update Permissions */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 bg-gray-200 rounded-lg flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-gray-600"
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
                <h4 className="font-medium text-gray-900 text-sm">Automatic Updates</h4>
                <p className="text-xs text-gray-500">
                  Allow StratoSort to keep dependencies up to date
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 ml-11">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={Boolean(settings?.autoUpdateOllama)}
                  onChange={(e) => saveSetting({ autoUpdateOllama: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <span className="group-hover:text-gray-900 transition-colors">Ollama</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={Boolean(settings?.autoUpdateChromaDb)}
                  onChange={(e) => saveSetting({ autoUpdateChromaDb: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <span className="group-hover:text-gray-900 transition-colors">ChromaDB</span>
              </label>
            </div>
          </div>

          {/* Activity Log */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
                  <svg
                    className="w-4 h-4 text-gray-600"
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
                  <h4 className="font-medium text-gray-900 text-sm">Activity Log</h4>
                  <p className="text-xs text-gray-500">
                    {loading ? 'Checking status...' : 'Live updates while this modal is open'}
                  </p>
                </div>
              </div>
              <Button
                variant="secondary"
                className="text-xs px-3 py-1.5"
                onClick={refresh}
                disabled={loading}
              >
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
              className="p-4 bg-gray-900 max-h-32 overflow-auto text-xs font-mono modern-scrollbar"
            >
              {logLines.length === 0 ? (
                <div className="text-gray-500 text-center py-4">
                  No activity yet. Install or refresh to see updates.
                </div>
              ) : (
                <ul className="space-y-1">
                  {logLines.map((entry) => (
                    <li
                      key={entry.id}
                      className={`${
                        entry.text.includes('[error]')
                          ? 'text-red-400'
                          : entry.text.includes('[success]')
                            ? 'text-green-400'
                            : entry.text.includes('[warning]')
                              ? 'text-amber-400'
                              : entry.text.includes('[status]')
                                ? 'text-blue-400'
                                : 'text-gray-300'
                      }`}
                    >
                      {entry.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end pt-2">
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </ErrorBoundary>
    </Modal>
  );
}

AiDependenciesModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired
};
