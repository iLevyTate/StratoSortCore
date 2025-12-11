import { updateProgress } from '../slices/analysisSlice';
import { updateMetrics } from '../slices/systemSlice';
import { logger } from '../../../shared/logger';

// Track listeners for cleanup to prevent memory leaks
let listenersInitialized = false;
let cleanupFunctions = [];
// FIX: Track beforeunload handler reference for proper cleanup
let beforeUnloadHandler = null;

const ipcMiddleware = (store) => {
  // Set up listeners once (with cleanup tracking)
  if (window.electronAPI?.events && !listenersInitialized) {
    // FIX: Clean up any existing listeners first (defensive for HMR edge cases)
    // This ensures no duplicate listeners accumulate even if listenersInitialized
    // was incorrectly reset or the module was partially reloaded
    cleanupIpcListeners();

    listenersInitialized = true;

    // Listen for operation progress from batch operations
    const progressCleanup = window.electronAPI.events.onOperationProgress((data) => {
      store.dispatch(updateProgress(data));
    });
    if (progressCleanup) cleanupFunctions.push(progressCleanup);

    // Listen for system metrics updates
    const metricsCleanup = window.electronAPI.events.onSystemMetrics((metrics) => {
      store.dispatch(updateMetrics(metrics));
    });
    if (metricsCleanup) cleanupFunctions.push(metricsCleanup);

    // Clean up listeners on window unload to prevent memory leaks
    // FIX: Store handler reference so it can be removed during cleanup
    beforeUnloadHandler = cleanupIpcListeners;
    window.addEventListener('beforeunload', beforeUnloadHandler);

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

  // FIX: Remove the beforeunload listener to prevent accumulation during HMR
  if (beforeUnloadHandler) {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    beforeUnloadHandler = null;
  }
};

export default ipcMiddleware;
