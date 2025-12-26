import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Modal from './Modal';
import Button from './ui/Button';
import { logger } from '../../shared/logger';

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

export default function AiDependenciesModal({ isOpen, onClose }) {
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState({ ollama: false, chromadb: false });
  const [downloadingModels, setDownloadingModels] = useState(false);
  const [logLines, setLogLines] = useState([]); // Now stores { id, text } objects
  const [installedModels, setInstalledModels] = useState([]); // Models already downloaded
  const unsubRef = useRef(null);
  const statusUnsubRef = useRef(null);
  const logContainerRef = useRef(null);

  // Helper to add a log entry
  const addLogEntry = useCallback((text) => {
    setLogLines((prev) => [...prev.slice(-20), { id: ++logIdCounter, text }]);
  }, []);

  // Memoized refresh function - stable reference for use in effects
  const refresh = useCallback(async () => {
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
              const next = prev.slice(-20);
              if (evt.type === 'dependency') {
                const dep = evt.dependency ? `(${evt.dependency}) ` : '';
                next.push({ id: ++logIdCounter, text: `${dep}${evt.message || 'Working…'}` });
              } else if (evt.type === 'ollama-pull') {
                const p = evt.progress;
                const pct =
                  p && typeof p.completed === 'number' && typeof p.total === 'number' && p.total > 0
                    ? ` ${Math.round((p.completed / p.total) * 100)}%`
                    : '';
                next.push({ id: ++logIdCounter, text: `(ollama) Downloading ${evt.model}${pct}` });
              }
              return next;
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
            setLogLines((prev) => [
              ...prev.slice(-20),
              { id: ++logIdCounter, text: `[status] ${statusMsg}` }
            ]);
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="AI Components Setup" size="large">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-system-gray-600">
          StratoSort can run immediately, but AI features come online after Ollama + models are
          installed, and semantic search comes online after ChromaDB is installed.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="surface-panel">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-system-gray-800">Ollama</div>
                <div className="text-xs text-system-gray-500 mt-1">
                  Status: {ollamaOk ? 'Installed' : 'Not installed'}
                  {ollamaVersion ? ` (v${ollamaVersion})` : ''}
                  {ollamaOk ? ` • ${ollamaRunning ? 'Running' : 'Not running'}` : ''}
                </div>
              </div>
              <Button
                variant="primary"
                disabled={installing.ollama}
                onClick={installOllama}
                title="Download and install Ollama silently"
              >
                {installing.ollama ? 'Installing…' : ollamaOk ? 'Reinstall/Repair' : 'Install'}
              </Button>
            </div>

            <div className="mt-3 flex flex-col gap-2">
              <Button
                variant="secondary"
                onClick={downloadModels}
                disabled={
                  !ollamaOk || !ollamaRunning || recommendedModels.length === 0 || downloadingModels
                }
                title={
                  downloadingModels
                    ? 'Downloading models...'
                    : !ollamaRunning
                      ? 'Ollama must be running to download models'
                      : 'Download recommended models in the background'
                }
              >
                {downloadingModels ? 'Downloading…' : 'Download recommended models'}
              </Button>
              <div className="text-xs text-system-gray-500">
                {recommendedModels.length ? (
                  <>
                    Models:{' '}
                    {recommendedModels.map((model, idx) => {
                      // Check if model is installed (handle tag matching like "llama3.2:latest")
                      const isInstalled = installedModels.some(
                        (m) => m === model || m.startsWith(`${model.split(':')[0]}:`)
                      );
                      return (
                        <span key={model}>
                          {idx > 0 && ', '}
                          <span className={isInstalled ? 'text-green-600' : 'text-system-gray-500'}>
                            {model.replace(':latest', '')}
                            {isInstalled ? ' ✓' : ''}
                          </span>
                        </span>
                      );
                    })}
                  </>
                ) : (
                  'Models: None selected'
                )}
              </div>
            </div>
          </div>

          <div className="surface-panel">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-system-gray-800">ChromaDB</div>
                <div className="text-xs text-system-gray-500 mt-1">
                  {chromaExternal ? (
                    <>
                      External server: {chromaRunning ? 'Connected' : 'Not reachable'}
                      {status?.chromadb?.serverUrl ? ` • ${status.chromadb.serverUrl}` : ''}
                    </>
                  ) : (
                    <>
                      Python: {pythonOk ? `${pythonVersion || 'Detected'}` : 'Missing'} • Module:{' '}
                      {chromaOk ? 'Installed' : 'Not installed'}
                      {chromaOk ? ` • ${chromaRunning ? 'Running' : 'Not running'}` : ''}
                    </>
                  )}
                </div>
              </div>
              <Button
                variant="primary"
                disabled={installing.chromadb || !pythonOk || chromaExternal}
                onClick={installChromaDb}
                title={
                  chromaExternal
                    ? 'ChromaDB is configured as an external server (CHROMA_SERVER_URL).'
                    : pythonOk
                      ? 'Install ChromaDB Python module for the current user'
                      : 'Install Python 3 first'
                }
              >
                {installing.chromadb ? 'Installing…' : chromaOk ? 'Reinstall/Upgrade' : 'Install'}
              </Button>
            </div>
            {!pythonOk && (
              <div className="mt-3 text-xs text-system-gray-600">
                Install Python 3 and ensure it is available as <code>py -3</code> (Windows) or{' '}
                <code>python3</code>.
              </div>
            )}
            {chromaExternal && !chromaRunning && (
              <div className="mt-3 text-xs text-system-gray-600">
                ChromaDB is set to an external URL. Make sure your Docker container is running and
                the port is mapped (e.g. <code>-p 8000:8000</code>), then click Refresh.
              </div>
            )}
          </div>
        </div>

        <div className="surface-panel">
          <div className="font-semibold text-system-gray-800">Permissions</div>
          <div className="text-xs text-system-gray-500 mt-1">
            Optional: allow StratoSort to update these dependencies automatically.
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-system-gray-700">
              <input
                type="checkbox"
                checked={Boolean(settings?.autoUpdateOllama)}
                onChange={(e) => saveSetting({ autoUpdateOllama: e.target.checked })}
              />
              Allow auto-updates for Ollama
            </label>
            <label className="flex items-center gap-2 text-sm text-system-gray-700">
              <input
                type="checkbox"
                checked={Boolean(settings?.autoUpdateChromaDb)}
                onChange={(e) => saveSetting({ autoUpdateChromaDb: e.target.checked })}
              />
              Allow auto-updates for ChromaDB
            </label>
          </div>
        </div>

        <div className="surface-panel">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-system-gray-800">Progress</div>
              <div className="text-xs text-system-gray-500 mt-1">
                {loading ? 'Checking status…' : 'Live updates while this modal is open.'}
              </div>
            </div>
            <Button variant="secondary" onClick={refresh} disabled={loading}>
              Refresh
            </Button>
          </div>

          <div
            ref={logContainerRef}
            className="mt-3 bg-system-gray-50 rounded-lg p-3 max-h-40 overflow-auto text-xs text-system-gray-700 modern-scrollbar"
          >
            {logLines.length === 0 ? (
              <div className="text-system-gray-500">No activity yet.</div>
            ) : (
              <ul className="flex flex-col gap-1">
                {logLines.map((entry) => (
                  <li key={entry.id}>{entry.text}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AiDependenciesModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired
};
