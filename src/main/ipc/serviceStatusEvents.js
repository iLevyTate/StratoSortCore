// Shared, lightweight service-status emitter.
// Intentionally does NOT import StartupManager/DependencyManager to avoid circular dependencies.

let _getMainWindow = null;
let _IPC_CHANNELS = null;
let _safeLogger = null;

function configureServiceStatusEmitter({ getMainWindow, IPC_CHANNELS, logger }) {
  _getMainWindow = typeof getMainWindow === 'function' ? getMainWindow : null;
  _IPC_CHANNELS = IPC_CHANNELS || null;
  _safeLogger = logger || {
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {}
  };
}

/**
 * Emit service status change to renderer.
 *
 * @param {Object} payload - Status change payload
 * @param {string} payload.service - 'chromadb' | 'ollama'
 * @param {string} payload.status - 'running' | 'stopped' | 'starting' | 'failed' | 'disabled'
 * @param {string} payload.health - 'healthy' | 'unhealthy' | 'unknown' | 'permanently_failed'
 * @param {Object} [payload.details] - Additional details (error messages, circuit breaker state, etc.)
 */
function emitServiceStatusChange(payload) {
  try {
    const win = typeof _getMainWindow === 'function' ? _getMainWindow() : null;
    if (win && !win.isDestroyed() && _IPC_CHANNELS?.DEPENDENCIES?.SERVICE_STATUS_CHANGED) {
      win.webContents.send(_IPC_CHANNELS.DEPENDENCIES.SERVICE_STATUS_CHANGED, {
        timestamp: Date.now(),
        ...payload
      });
      _safeLogger?.debug?.('[ServiceStatusEvents] Emitted service status change', {
        service: payload.service,
        status: payload.status
      });
    }
  } catch (e) {
    _safeLogger?.debug?.('[ServiceStatusEvents] Failed to emit service status', {
      error: e?.message
    });
  }
}

module.exports = {
  configureServiceStatusEmitter,
  emitServiceStatusChange
};
