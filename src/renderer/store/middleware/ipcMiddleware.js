import { updateProgress, stopAnalysis, updateResultPathsAfterMove } from '../slices/analysisSlice';
import { updateMetrics, updateHealth, addNotification } from '../slices/systemSlice';
import { updateFilePathsAfterMove, removeSelectedFiles } from '../slices/filesSlice';
import { logger } from '../../../shared/logger';
import { mapErrorToNotification } from '../../utils/errorMapping';
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

// FIX Issue 3: Event queue for early IPC events
// Events that arrive before store.dispatch is ready are queued and flushed later
let isStoreReady = false;
let eventQueue = [];
let storeRef = null;

// FIX: Maximum event queue size to prevent unbounded memory growth during startup
const MAX_EVENT_QUEUE_SIZE = 300;
const CRITICAL_ACTION_CREATORS = new Set([
  updateProgress,
  stopAnalysis,
  updateMetrics,
  updateHealth,
  updateResultPathsAfterMove,
  updateFilePathsAfterMove,
  addNotification
]);

/**
 * Queue an event for later dispatch or dispatch immediately if store is ready
 * @param {Function} actionCreator - The Redux action creator
 * @param {*} data - The event payload
 */
function safeDispatch(actionCreator, data) {
  if (isStoreReady && storeRef) {
    storeRef.dispatch(actionCreator(data));
  } else {
    // FIX: Enforce queue size limit to prevent unbounded memory growth
    if (eventQueue.length >= MAX_EVENT_QUEUE_SIZE) {
      logger.warn('[IPC Middleware] Event queue full, dropping oldest event', {
        queueSize: eventQueue.length,
        maxSize: MAX_EVENT_QUEUE_SIZE
      });
      const dropIndex = eventQueue.findIndex(
        (entry) => !CRITICAL_ACTION_CREATORS.has(entry.actionCreator)
      );
      if (dropIndex >= 0) {
        eventQueue.splice(dropIndex, 1);
      } else {
        eventQueue.shift(); // Remove oldest event
      }
    }
    eventQueue.push({ actionCreator, data });
    logger.debug('[IPC Middleware] Queued early event', {
      actionType: actionCreator?.name || 'unknown',
      queueSize: eventQueue.length,
      isStoreReady,
      hasStoreRef: !!storeRef
    });
  }
}

/**
 * Mark the store as ready and flush any queued events
 * Called after store configuration is complete
 */
export function markStoreReady() {
  logger.debug('[IPC Middleware] markStoreReady called', {
    isStoreReady,
    queueSize: eventQueue.length,
    hasStoreRef: !!storeRef
  });

  if (isStoreReady) return;
  isStoreReady = true;

  if (eventQueue.length > 0 && storeRef) {
    logger.info('[IPC Middleware] Flushing event queue', { count: eventQueue.length });
    // FIX: Swap references before processing to prevent race condition
    // If events arrive during the forEach loop, they would be added to eventQueue
    // and then lost when eventQueue = [] runs. By swapping first, new events
    // go into a fresh array while we process the old one.
    const eventsToFlush = eventQueue;
    eventQueue = [];
    eventsToFlush.forEach(({ actionCreator, data }) => {
      // FIX HIGH-44: Wrap dispatch in try-catch to prevent one error stopping the queue
      try {
        storeRef.dispatch(actionCreator(data));
      } catch (e) {
        logger.error('[IPC Middleware] Error flushing queued event:', e.message);
      }
    });
  }
}

const ipcMiddleware = (store) => {
  // FIX Issue 3: Store reference for event queue flushing
  storeRef = store;

  // Set up listeners once (with cleanup tracking)
  if (window.electronAPI?.events && !listenersInitialized) {
    // FIX: Clean up any existing listeners first (defensive for HMR edge cases)
    // This ensures no duplicate listeners accumulate even if listenersInitialized
    // was incorrectly reset or the module was partially reloaded
    cleanupIpcListeners(false);

    listenersInitialized = true;

    // Listen for operation progress from batch operations
    // FIX: Use safeDispatch to handle early events
    const progressCleanup = window.electronAPI.events.onOperationProgress((data) => {
      const { data: validatedData } = validateIncomingEvent('operation-progress', data);
      safeDispatch(updateProgress, validatedData);
    });
    if (progressCleanup) cleanupFunctions.push(progressCleanup);

    // Listen for system metrics updates
    const metricsCleanup = window.electronAPI.events.onSystemMetrics((metrics) => {
      const { data: validatedMetrics } = validateIncomingEvent('system-metrics', metrics);
      safeDispatch(updateMetrics, validatedMetrics);
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
        const notification = mapErrorToNotification({
          error: validatedData.error,
          errorType: validatedData.errorType,
          operationType: validatedData.operationType || 'Operation'
        });
        store.dispatch(addNotification(notification));

        // Stop analysis if it was an analysis operation
        // FIX: Wrap dispatch in try-catch to prevent silent failures
        if (
          validatedData.operationType === 'analyze' ||
          validatedData.operationType === 'batch_analyze'
        ) {
          try {
            store.dispatch(stopAnalysis());
          } catch (e) {
            logger.error('[IPC Middleware] Failed to dispatch stopAnalysis', { error: e.message });
          }
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

        // FIX: Wrap dispatches in try-catch to prevent silent failures
        try {
          if (
            validatedData.operation === 'move' &&
            validatedData.files &&
            validatedData.destinations
          ) {
            // Update file paths in Redux state (both filesSlice and analysisSlice)
            const pathUpdate = {
              oldPaths: validatedData.files,
              newPaths: validatedData.destinations
            };
            store.dispatch(updateFilePathsAfterMove(pathUpdate));
            // FIX: Also update analysis results to prevent path desync
            store.dispatch(updateResultPathsAfterMove(pathUpdate));
          } else if (validatedData.operation === 'delete' && validatedData.files) {
            // Remove deleted files from state using batch action
            store.dispatch(removeSelectedFiles(validatedData.files));
          }

          // FIX: Dispatch DOM event for components that need to react to file operations
          // (e.g., UnifiedSearchModal graph updates, search index invalidation)
          try {
            window.dispatchEvent(
              new CustomEvent('file-operation-complete', { detail: validatedData })
            );
          } catch (eventErr) {
            logger.warn(
              '[IPC Middleware] Failed to dispatch file-operation-complete event:',
              eventErr.message
            );
          }
        } catch (e) {
          logger.error('[IPC Middleware] Failed to dispatch file operation update', {
            operation: validatedData.operation,
            error: e.message
          });
        }
      });
      if (fileOpCleanup) cleanupFunctions.push(fileOpCleanup);
    }

    // FIX: Subscribe to notification events from watchers and background processes
    // Now uses unified notification schema from main process (no field translation needed)
    if (window.electronAPI.events.onNotification) {
      const notificationCleanup = window.electronAPI.events.onNotification((data) => {
        const { data: validatedData } = validateIncomingEvent('notification', data);

        // Pass standardized notification directly to Redux
        // Main process now sends unified schema with: id, message, severity, duration, etc.
        store.dispatch(addNotification(validatedData));

        // Emit custom event for toast display (decoupled from IPC middleware)
        // This allows NotificationContext to listen without duplicate IPC listeners
        try {
          window.dispatchEvent(new CustomEvent('app:notification', { detail: validatedData }));
        } catch (e) {
          logger.warn('[IPC Middleware] Failed to dispatch notification event:', e.message);
        }
      });
      if (notificationCleanup) cleanupFunctions.push(notificationCleanup);
    }

    // FIX: Subscribe to batch results chunk events for progressive streaming
    if (window.electronAPI.events.onBatchResultsChunk) {
      const batchChunkCleanup = window.electronAPI.events.onBatchResultsChunk((data) => {
        const { data: validatedData } = validateIncomingEvent('batch-results-chunk', data);
        logger.debug('[IPC] Batch results chunk received', {
          chunk: validatedData?.chunk,
          total: validatedData?.total,
          resultCount: validatedData?.results?.length
        });

        // Emit custom event for components that need progressive batch updates
        try {
          window.dispatchEvent(new CustomEvent('batch-results-chunk', { detail: validatedData }));
        } catch (e) {
          logger.warn('[IPC Middleware] Failed to dispatch batch-results-chunk event:', e.message);
        }
      });
      if (batchChunkCleanup) cleanupFunctions.push(batchChunkCleanup);
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

    const normalizeServiceHealth = (status, health) => {
      const normalizedStatus = status ? String(status).toLowerCase() : '';
      const normalizedHealth = health ? String(health).toLowerCase() : '';

      if (['healthy', 'ok', 'online'].includes(normalizedHealth)) return 'online';
      if (['unhealthy', 'permanently_failed', 'offline', 'error'].includes(normalizedHealth)) {
        return 'offline';
      }

      if (['online', 'connected', 'running', 'available'].includes(normalizedStatus)) {
        return 'online';
      }
      if (
        ['connecting', 'starting', 'initializing', 'recovering', 'booting'].includes(
          normalizedStatus
        )
      ) {
        return 'connecting';
      }
      if (
        ['offline', 'disconnected', 'stopped', 'failed', 'disabled', 'error'].includes(
          normalizedStatus
        )
      ) {
        return 'offline';
      }
      return 'unknown';
    };

    // FIX: Subscribe to ChromaDB status changes
    if (window.electronAPI?.chromadb?.onStatusChanged) {
      const chromaStatusCleanup = window.electronAPI.chromadb.onStatusChanged((data) => {
        const { data: validatedData } = validateIncomingEvent('chromadb-status-changed', data);
        logger.debug('[IPC] ChromaDB status changed', { status: validatedData?.status });

        // Update health state with new ChromaDB status
        if (validatedData?.status) {
          const mapped = normalizeServiceHealth(validatedData.status);
          store.dispatch(updateHealth({ chromadb: mapped }));
        }
      });
      if (chromaStatusCleanup) cleanupFunctions.push(chromaStatusCleanup);
    }

    // FIX: Subscribe to dependency service status changes (Ollama/ChromaDB)
    if (window.electronAPI?.dependencies?.onServiceStatusChanged) {
      const depsStatusCleanup = window.electronAPI.dependencies.onServiceStatusChanged((data) => {
        const { data: validatedData } = validateIncomingEvent(
          'dependencies-service-status-changed',
          data
        );
        logger.debug('[IPC] Dependency service status changed', {
          service: validatedData?.service,
          status: validatedData?.status
        });

        // Update health state based on which service changed
        if (validatedData?.service && (validatedData?.status || validatedData?.health)) {
          const service = validatedData.service.toLowerCase();
          if (service === 'chromadb' || service === 'ollama') {
            const mapped = normalizeServiceHealth(validatedData.status, validatedData.health);
            store.dispatch(updateHealth({ [service]: mapped }));
          }
        }
      });
      if (depsStatusCleanup) cleanupFunctions.push(depsStatusCleanup);
    }

    // Fetch initial dependency status once on startup (best-effort)
    if (window.electronAPI?.dependencies?.getStatus) {
      window.electronAPI.dependencies
        .getStatus()
        .then((result) => {
          const status = result?.status || result;
          const chromaStatus = normalizeServiceHealth(
            status?.chromadb?.status || (status?.chromadb?.running ? 'running' : 'stopped'),
            status?.chromadb?.health
          );
          const ollamaStatus = normalizeServiceHealth(
            status?.ollama?.status || (status?.ollama?.running ? 'running' : 'stopped'),
            status?.ollama?.health
          );
          store.dispatch(updateHealth({ chromadb: chromaStatus, ollama: ollamaStatus }));
        })
        .catch((error) => {
          logger.debug('[IPC] Failed to fetch dependency status', { error: error?.message });
          // FIX: Set services to 'unknown' on fetch failure so UI can show appropriate state
          store.dispatch(updateHealth({ chromadb: 'unknown', ollama: 'unknown' }));
        });
    }

    // Clean up listeners on window unload to prevent memory leaks
    // FIX: Store handler reference so it can be removed during cleanup
    beforeUnloadHandler = () => cleanupIpcListeners(true);
    window.addEventListener('beforeunload', beforeUnloadHandler);

    // Handle HMR cleanup if webpack hot module replacement is enabled
    if (module.hot) {
      module.hot.dispose(() => {
        cleanupIpcListeners(true);
      });
    }
  }

  // FIX Issue 3: Automatically mark store as ready if this is a re-initialization
  // but we already have a storeRef from before. This handles HMR and late-loading middleware.
  if (storeRef && !isStoreReady) {
    setTimeout(markStoreReady, 0);
  }

  return (next) => (action) => {
    return next(action);
  };
};

// Export cleanup function for use during hot reload or app teardown
export const cleanupIpcListeners = (isTeardown = false) => {
  cleanupFunctions.forEach((cleanup) => {
    try {
      cleanup();
    } catch (e) {
      logger.warn('Error cleaning up IPC listener:', e);
    }
  });
  cleanupFunctions = [];
  listenersInitialized = false;

  // FIX: ALWAYS remove the beforeunload listener to prevent accumulation during HMR
  // This must happen BEFORE the isTeardown check, otherwise HMR calls with
  // isTeardown=false would leave orphaned handlers in the event listener list
  if (beforeUnloadHandler) {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    beforeUnloadHandler = null;
  }

  // FIX Issue 3: Reset event queue state only on real teardown
  // During HMR or listener refresh, we want to keep the store state
  if (isTeardown) {
    isStoreReady = false;
    eventQueue = [];
    storeRef = null;
  }
};

export default ipcMiddleware;
