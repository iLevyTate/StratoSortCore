import { updateProgress } from '../slices/analysisSlice';
import { updateMetrics } from '../slices/systemSlice';
import { logger } from '../../../shared/logger';

// Track listeners for cleanup to prevent memory leaks
let listenersInitialized = false;
let cleanupFunctions = [];

const ipcMiddleware = (store) => {
  // Set up listeners once (with cleanup tracking)
  if (window.electronAPI?.events && !listenersInitialized) {
    listenersInitialized = true;

    // Listen for operation progress from batch operations
    const progressCleanup = window.electronAPI.events.onOperationProgress(
      (data) => {
        store.dispatch(updateProgress(data));
      },
    );
    if (progressCleanup) cleanupFunctions.push(progressCleanup);

    // Listen for system metrics updates
    const metricsCleanup = window.electronAPI.events.onSystemMetrics(
      (metrics) => {
        store.dispatch(updateMetrics(metrics));
      },
    );
    if (metricsCleanup) cleanupFunctions.push(metricsCleanup);

    // Clean up listeners on window unload to prevent memory leaks
    window.addEventListener('beforeunload', cleanupIpcListeners);

    // Handle HMR cleanup if webpack hot module replacement is enabled
    if (module.hot) {
      module.hot.dispose(() => {
        cleanupIpcListeners();
      });
    }
  }

  return (next) => (action) => {
    return next(action);
  };
};

// Export cleanup function for use during hot reload or app teardown
export const cleanupIpcListeners = () => {
  cleanupFunctions.forEach((cleanup) => {
    try {
      cleanup();
    } catch (e) {
      logger.warn('Error cleaning up IPC listener:', e);
    }
  });
  cleanupFunctions = [];
  listenersInitialized = false;
};

export default ipcMiddleware;
