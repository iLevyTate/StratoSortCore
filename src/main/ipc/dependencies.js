const { createHandler, safeHandle } = require('./ipcWrappers');
const { getInstance: getDependencyManager } = require('../services/DependencyManagerService');
const { getStartupManager } = require('../services/startup');
const { configureServiceStatusEmitter, emitServiceStatusChange } = require('./serviceStatusEvents');

/**
 * Dependency management IPC.
 *
 * Emits progress via the existing 'operation-progress' event channel to avoid
 * introducing new receive channels.
 *
 * Uses singleton DependencyManagerService to prevent concurrent installation
 * race conditions between UI-triggered installs and background setup.
 */
function registerDependenciesIpc({ ipcMain, IPC_CHANNELS, logger, getMainWindow }) {
  const safeLogger = logger || {
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {}
  };

  // Configure shared service-status emitter for other modules (startup/health monitoring)
  configureServiceStatusEmitter({ getMainWindow, IPC_CHANNELS, logger: safeLogger });

  const sendProgress = (payload) => {
    try {
      const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
      if (win && !win.isDestroyed()) {
        win.webContents.send('operation-progress', {
          type: 'dependency',
          ...payload
        });
      }
    } catch (e) {
      safeLogger.debug?.('[DependenciesIPC] Failed to emit progress', { error: e?.message });
    }
  };

  // Use singleton to share lock with backgroundSetup
  const manager = getDependencyManager({
    onProgress: (data) => sendProgress(data)
  });

  safeHandle(
    ipcMain,
    IPC_CHANNELS.DEPENDENCIES.GET_STATUS,
    createHandler({
      logger: safeLogger,
      context: 'DependenciesIPC',
      handler: async () => {
        const status = await manager.getStatus();
        return { success: true, status };
      }
    })
  );

  safeHandle(
    ipcMain,
    IPC_CHANNELS.DEPENDENCIES.INSTALL_OLLAMA,
    createHandler({
      logger: safeLogger,
      context: 'DependenciesIPC',
      handler: async () => {
        sendProgress({ message: 'Starting Ollama installation…', dependency: 'ollama' });
        const result = await manager.installOllama();
        if (result.success) {
          sendProgress({ message: 'Ollama installed.', dependency: 'ollama', stage: 'done' });
          // Best-effort: start via StartupManager so it is tracked/managed
          try {
            const startupManager = getStartupManager();
            await startupManager.startOllama();
          } catch (e) {
            safeLogger.warn?.('[DependenciesIPC] Failed to start Ollama after install', {
              error: e?.message
            });
          }
        } else {
          sendProgress({
            message: `Ollama install failed: ${result.error}`,
            dependency: 'ollama',
            stage: 'error'
          });
        }
        return result;
      }
    })
  );

  safeHandle(
    ipcMain,
    IPC_CHANNELS.DEPENDENCIES.UPDATE_OLLAMA,
    createHandler({
      logger: safeLogger,
      context: 'DependenciesIPC',
      handler: async () => {
        sendProgress({ message: 'Updating Ollama…', dependency: 'ollama' });
        const result = await manager.updateOllama();
        return result;
      }
    })
  );

  safeHandle(
    ipcMain,
    IPC_CHANNELS.DEPENDENCIES.INSTALL_CHROMADB,
    createHandler({
      logger: safeLogger,
      context: 'DependenciesIPC',
      handler: async () => {
        sendProgress({ message: 'Installing ChromaDB…', dependency: 'chromadb' });
        const result = await manager.installChromaDb({ upgrade: false, userInstall: true });
        if (result.success) {
          sendProgress({ message: 'ChromaDB installed.', dependency: 'chromadb', stage: 'done' });
          // Attempt to start right away without requiring an app restart
          let startupError = null;
          try {
            const startupManager = getStartupManager();
            // CRITICAL FIX: Explicitly clear the dependency missing flag before starting
            // This ensures the newly installed ChromaDB module is detected
            startupManager.setChromadbDependencyMissing(false);
            sendProgress({
              message: 'Starting ChromaDB service…',
              dependency: 'chromadb',
              stage: 'start'
            });
            await startupManager.startChromaDB();
          } catch (e) {
            startupError = e?.message || 'Unknown startup error';
            safeLogger.warn?.('[DependenciesIPC] Failed to start ChromaDB after install', {
              error: startupError
            });
            sendProgress({
              message: `ChromaDB installed but failed to start: ${startupError}`,
              dependency: 'chromadb',
              stage: 'warning'
            });
          }
          // Return startup error info so UI can display appropriate message
          return startupError ? { ...result, startupError } : result;
        }
        sendProgress({
          message: `ChromaDB install failed: ${result.error}`,
          dependency: 'chromadb',
          stage: 'error'
        });

        return result;
      }
    })
  );

  safeHandle(
    ipcMain,
    IPC_CHANNELS.DEPENDENCIES.UPDATE_CHROMADB,
    createHandler({
      logger: safeLogger,
      context: 'DependenciesIPC',
      handler: async () => {
        sendProgress({ message: 'Updating ChromaDB…', dependency: 'chromadb' });
        const result = await manager.updateChromaDb();
        return result;
      }
    })
  );
}

module.exports = { registerDependenciesIpc, emitServiceStatusChange };
