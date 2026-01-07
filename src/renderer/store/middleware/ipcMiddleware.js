import { updateProgress, stopAnalysis } from '../slices/analysisSlice';
import { updateMetrics, addNotification } from '../slices/systemSlice';
import { updateFilePathsAfterMove, removeSelectedFile } from '../slices/filesSlice';
import { logger } from '../../../shared/logger';
import { validateEventPayload, hasEventSchema } from '../../../shared/ipcEventSchemas';

/**
 * Validate incoming IPC event data against schema.
 * Logs warnings for invalid data but doesn't block processing.
 *
 * @param {string} eventName - The event channel name
 * @param {*} data - The event payload
 * @returns {{ valid: boolean, data: * }} - Validation result with original or validated data
 */
function validateIncomingEvent(eventName, data) {
  if (!hasEventSchema(eventName)) {
    // No schema for this event, pass through
    return { valid: true, data };
  }

  const result = validateEventPayload(eventName, data);

  if (!result.valid) {
    logger.warn(`[IPC Middleware] Received invalid '${eventName}' event:`, {
      error: result.error?.flatten ? result.error.flatten() : String(result.error),
      dataKeys: data && typeof data === 'object' ? Object.keys(data) : typeof data
    });
    // Still return original data to avoid breaking functionality
    return { valid: false, data };
  }

  return { valid: true, data: result.data };
}

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
      const { data: validatedData } = validateIncomingEvent('operation-progress', data);
      store.dispatch(updateProgress(validatedData));
    });
    if (progressCleanup) cleanupFunctions.push(progressCleanup);

    // Listen for system metrics updates
    const metricsCleanup = window.electronAPI.events.onSystemMetrics((metrics) => {
      const { data: validatedMetrics } = validateIncomingEvent('system-metrics', metrics);
      store.dispatch(updateMetrics(validatedMetrics));
    });
    if (metricsCleanup) cleanupFunctions.push(metricsCleanup);

    // FIX: Subscribe to operation complete events for batch operations
    if (window.electronAPI.events.onOperationComplete) {
      const completeCleanup = window.electronAPI.events.onOperationComplete((data) => {
        const { data: validatedData } = validateIncomingEvent('operation-complete', data);
        logger.info('[IPC] Operation complete event received', {
          type: validatedData.operationType
        });

        // Show success notification
        const fileCount = validatedData.affectedFiles?.length || 0;
        if (fileCount > 0) {
          store.dispatch(
            addNotification({
              message: `${validatedData.operationType || 'Operation'} complete: ${fileCount} file(s)`,
              severity: 'success',
              duration: 3000
            })
          );
        }
      });
      if (completeCleanup) cleanupFunctions.push(completeCleanup);
    }

    // FIX: Subscribe to operation error events
    if (window.electronAPI.events.onOperationError) {
      const errorCleanup = window.electronAPI.events.onOperationError((data) => {
        const { data: validatedData } = validateIncomingEvent('operation-error', data);
        logger.error('[IPC] Operation error event received', {
          type: validatedData.operationType,
          error: validatedData.error
        });

        // Show error notification
        store.dispatch(
          addNotification({
            message: `${validatedData.operationType || 'Operation'} failed: ${validatedData.error || 'Unknown error'}`,
            severity: 'error',
            duration: 5000
          })
        );

        // Stop analysis if it was an analysis operation
        if (
          validatedData.operationType === 'analyze' ||
          validatedData.operationType === 'batch_analyze'
        ) {
          store.dispatch(stopAnalysis());
        }
      });
      if (errorCleanup) cleanupFunctions.push(errorCleanup);
    }

    // FIX: Subscribe to file operation complete events (moves, deletes)
    if (window.electronAPI.events.onFileOperationComplete) {
      const fileOpCleanup = window.electronAPI.events.onFileOperationComplete((data) => {
        const { data: validatedData } = validateIncomingEvent('file-operation-complete', data);
        logger.info('[IPC] File operation complete event received', {
          operation: validatedData.operation,
          fileCount: validatedData.files?.length
        });

        if (
          validatedData.operation === 'move' &&
          validatedData.files &&
          validatedData.destinations
        ) {
          // Update file paths in Redux state
          store.dispatch(
            updateFilePathsAfterMove({
              oldPaths: validatedData.files,
              newPaths: validatedData.destinations
            })
          );
        } else if (validatedData.operation === 'delete' && validatedData.files) {
          // Remove deleted files from state
          validatedData.files.forEach((filePath) => {
            store.dispatch(removeSelectedFile(filePath));
          });
        }
      });
      if (fileOpCleanup) cleanupFunctions.push(fileOpCleanup);
    }

    // FIX: Subscribe to notification events from watchers and background processes
    if (window.electronAPI.events.onNotification) {
      const notificationCleanup = window.electronAPI.events.onNotification((data) => {
        const { data: validatedData } = validateIncomingEvent('notification', data);
        // Route notification to toast system
        store.dispatch(
          addNotification({
            message: validatedData.message || validatedData.title || 'Notification',
            severity: validatedData.severity || validatedData.variant || 'info',
            duration: validatedData.duration || 4000
          })
        );
      });
      if (notificationCleanup) cleanupFunctions.push(notificationCleanup);
    }

    // FIX: Subscribe to app error events
    if (window.electronAPI.events.onAppError) {
      const appErrorCleanup = window.electronAPI.events.onAppError((data) => {
        const { data: validatedData } = validateIncomingEvent('app:error', data);
        logger.error('[IPC] App error event received', validatedData);

        store.dispatch(
          addNotification({
            message: validatedData.message || validatedData.error || 'An error occurred',
            severity: 'error',
            duration: 6000
          })
        );
      });
      if (appErrorCleanup) cleanupFunctions.push(appErrorCleanup);
    }

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
