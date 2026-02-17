import { updateProgress } from '../slices/analysisSlice';
import { updateMetrics, updateHealth, addNotification } from '../slices/systemSlice';
import { atomicUpdateFilePathsAfterMove, atomicRemoveFilesWithCleanup } from '../slices/filesSlice';
import { logger } from '../../../shared/logger';
import { IPC_CHANNELS } from '../../../shared/constants';
import { validateEventPayload, hasEventSchema } from '../../../shared/ipcEventSchemas';

/**
 * Validate incoming IPC event data against schema.
 * Logs warnings for invalid data and drops invalid payloads.
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
    return { valid: false, data: null };
  }

  return { valid: true, data: result.data };
}

/**
 * Normalize operation-progress payloads used by analysis UI.
 * Main process batch analysis emits { completed, total }, while renderer analysis
 * state expects { current, total }.
 *
 * Only normalize analysis-related events so model download progress does not
 * pollute discover/organize analysis progress state.
 *
 * @param {*} payload
 * @returns {*}
 */
function normalizeAnalysisProgressPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;

  const type = String(payload.type || '').toLowerCase();
  if (type !== 'batch_analyze' && type !== 'analyze') {
    return payload;
  }

  const normalized = { ...payload };
  const completed = Number(payload.completed);
  const total = Number(payload.total);

  if (!Number.isFinite(Number(payload.current)) && Number.isFinite(completed) && completed >= 0) {
    normalized.current = completed;
  }

  if (Number.isFinite(total) && total >= 0) {
    normalized.total = total;
  }

  return normalized;
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
  updateMetrics,
  updateHealth,
  addNotification
]);
let droppedCriticalEventCount = 0;

/**
 * Emit a startup warning if critical events were dropped due to queue pressure.
 * Should be called after markStoreReady.
 */
export function recoverPersistedCriticalEvents() {
  if (!storeRef || !isStoreReady) return;
  if (droppedCriticalEventCount <= 0) return;
  const droppedCount = droppedCriticalEventCount;
  droppedCriticalEventCount = 0;
  storeRef.dispatch(
    addNotification({
      message: `${droppedCount} critical updates were dropped during startup pressure.`,
      severity: 'warning',
      duration: 6000
    })
  );
}

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
    }

    const dropOneEvent = () => {
      if (eventQueue.length === 0) return;
      const dropIndex = eventQueue.findIndex(
        (entry) => !CRITICAL_ACTION_CREATORS.has(entry.actionCreator)
      );
      if (dropIndex >= 0) {
        eventQueue.splice(dropIndex, 1);
      } else {
        // Queue is fully critical. Drop oldest and track a visible warning for startup.
        const droppedEvent = eventQueue.shift();
        if (droppedEvent) droppedCriticalEventCount += 1;
      }
    };

    // Ensure we have room for overflow warning (if needed) and the new event
    while (eventQueue.length >= MAX_EVENT_QUEUE_SIZE) {
      dropOneEvent();
    }

    // FIX HIGH-1: Only warn about overflow when queue is actually near capacity
    if (!safeDispatch.hasWarnedOverflow && eventQueue.length >= MAX_EVENT_QUEUE_SIZE * 0.8) {
      safeDispatch.hasWarnedOverflow = true;
      if (eventQueue.length >= MAX_EVENT_QUEUE_SIZE) {
        dropOneEvent();
      }
      eventQueue.push({
        actionCreator: addNotification,
        data: {
          message: 'System is busy - some updates may be delayed.',
          severity: 'warning',
          duration: 5000
        }
      });
    }

    // Ensure we still have space for the incoming event
    while (eventQueue.length >= MAX_EVENT_QUEUE_SIZE) {
      dropOneEvent();
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
        // FIX: Dispatch error notification for critical event failures
        // Only notify for non-notification actions to avoid infinite loops
        if (actionCreator !== addNotification) {
          try {
            storeRef.dispatch(
              addNotification({
                message: 'Some updates may not have been applied correctly.',
                severity: 'warning',
                duration: 4000
              })
            );
          } catch (notifyError) {
            // Last resort - can't notify, just log
            logger.error(
              '[IPC Middleware] Failed to dispatch error notification:',
              notifyError.message
            );
          }
        }
      }
    });
  }

  if (safeDispatch.hasWarnedOverflow) {
    safeDispatch.hasWarnedOverflow = false;
  }

  // Recover any critical events that were persisted to localStorage during overflow
  recoverPersistedCriticalEvents();
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
    if (typeof window.electronAPI.events.onOperationProgress === 'function') {
      const progressCleanup = window.electronAPI.events.onOperationProgress((data) => {
        const { valid, data: validatedData } = validateIncomingEvent('operation-progress', data);
        if (!valid) return;
        safeDispatch(updateProgress, normalizeAnalysisProgressPayload(validatedData));
        // Re-dispatch as DOM CustomEvent so runBatchPath's progress listener receives it
        window.dispatchEvent(new CustomEvent('operation-progress', { detail: validatedData }));
      });
      if (progressCleanup) cleanupFunctions.push(progressCleanup);
    } else {
      logger.debug('[IPC] onOperationProgress handler unavailable');
    }

    // Listen for system metrics updates
    if (typeof window.electronAPI.events.onSystemMetrics === 'function') {
      const metricsCleanup = window.electronAPI.events.onSystemMetrics((metrics) => {
        const { valid, data: validatedMetrics } = validateIncomingEvent('system-metrics', metrics);
        if (!valid) return;
        safeDispatch(updateMetrics, validatedMetrics);
      });
      if (metricsCleanup) cleanupFunctions.push(metricsCleanup);
    } else {
      logger.debug('[IPC] onSystemMetrics handler unavailable');
    }

    // FIX: Subscribe to file operation complete events (moves, deletes)
    if (window.electronAPI.events.onFileOperationComplete) {
      const fileOpCleanup = window.electronAPI.events.onFileOperationComplete((data) => {
        const { valid, data: validatedData } = validateIncomingEvent(
          'file-operation-complete',
          data
        );
        if (!valid) return;
        logger.info('[IPC] File operation complete event received', {
          operation: validatedData.operation,
          fileCount: validatedData.files?.length
        });

        // FIX: Wrap dispatches in try-catch to prevent silent failures
        try {
          if (validatedData.operation === 'move') {
            // Support both batch payloads (files/destinations) and single-file payloads
            // (oldPath/newPath) emitted by main file operation handlers.
            const oldPaths =
              Array.isArray(validatedData.files) && validatedData.files.length > 0
                ? validatedData.files
                : validatedData.oldPath
                  ? [validatedData.oldPath]
                  : [];
            const newPaths =
              Array.isArray(validatedData.destinations) && validatedData.destinations.length > 0
                ? validatedData.destinations
                : validatedData.newPath
                  ? [validatedData.newPath]
                  : [];

            if (oldPaths.length > 0 && newPaths.length > 0) {
              // Use atomic action to update BOTH filesSlice AND analysisSlice
              // in a single dispatch, preventing path desync from race conditions.
              safeDispatch(atomicUpdateFilePathsAfterMove, { oldPaths, newPaths });
            }
          } else if (validatedData.operation === 'delete') {
            // Support both batch payloads (files) and single-file payloads (oldPath).
            const removedPaths =
              Array.isArray(validatedData.files) && validatedData.files.length > 0
                ? validatedData.files
                : validatedData.oldPath
                  ? [validatedData.oldPath]
                  : [];
            if (removedPaths.length > 0) {
              // Use atomic action to remove files from BOTH filesSlice AND analysisSlice.
              safeDispatch(atomicRemoveFilesWithCleanup, removedPaths);
            }
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
        const { valid, data: validatedData } = validateIncomingEvent('notification', data);
        if (!valid) return;

        // Pass standardized notification directly to Redux
        // Main process now sends unified schema with: id, message, severity, duration, etc.
        safeDispatch(addNotification, validatedData);

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
        const { valid, data: validatedData } = validateIncomingEvent('batch-results-chunk', data);
        if (!valid) return;
        const chunkItems = Array.isArray(validatedData?.chunk)
          ? validatedData.chunk
          : Array.isArray(validatedData?.results)
            ? validatedData.results
            : [];
        const chunkIndex = Number.isInteger(validatedData?.chunkIndex)
          ? validatedData.chunkIndex
          : Number.isInteger(validatedData?.chunk)
            ? validatedData.chunk
            : 0;
        const totalChunks = Number.isInteger(validatedData?.totalChunks)
          ? validatedData.totalChunks
          : Number.isInteger(validatedData?.total)
            ? validatedData.total
            : 0;
        const normalizedPayload = {
          ...validatedData,
          chunk: chunkItems,
          chunkIndex,
          totalChunks
        };
        logger.debug('[IPC] Batch results chunk received', {
          chunkIndex: normalizedPayload.chunkIndex,
          totalChunks: normalizedPayload.totalChunks,
          resultCount: normalizedPayload.chunk.length
        });

        // Emit custom event for components that need progressive batch updates
        try {
          window.dispatchEvent(
            new CustomEvent('batch-results-chunk', { detail: normalizedPayload })
          );
        } catch (e) {
          logger.warn('[IPC Middleware] Failed to dispatch batch-results-chunk event:', e.message);
        }
      });
      if (batchChunkCleanup) cleanupFunctions.push(batchChunkCleanup);
    }

    // FIX: Subscribe to app error events
    if (window.electronAPI.events.onAppError) {
      const appErrorCleanup = window.electronAPI.events.onAppError((data) => {
        const { valid, data: validatedData } = validateIncomingEvent('app:error', data);
        if (!valid) return;
        logger.error('[IPC] App error event received', validatedData);

        safeDispatch(addNotification, {
          message: validatedData.message || validatedData.error || 'An error occurred',
          severity: 'error',
          duration: 6000
        });
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

    // Subscribe to Vector DB status changes (Orama)
    if (window.electronAPI?.vectorDb?.onStatusChanged) {
      const vectorStatusCleanup = window.electronAPI.vectorDb.onStatusChanged((data) => {
        const { valid, data: validatedData } = validateIncomingEvent(
          IPC_CHANNELS.VECTOR_DB.STATUS_CHANGED,
          data
        );
        if (!valid) return;
        logger.debug('[IPC] Vector DB status changed', { status: validatedData?.status });

        if (validatedData?.status || validatedData?.health) {
          const mapped = normalizeServiceHealth(validatedData.status, validatedData.health);
          safeDispatch(updateHealth, { vectorDb: mapped });
        }
      });
      if (vectorStatusCleanup) cleanupFunctions.push(vectorStatusCleanup);
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
    droppedCriticalEventCount = 0;
    storeRef = null;
    // FIX: Reset overflow warning flag so it can fire again after reinit
    if (typeof safeDispatch !== 'undefined') {
      safeDispatch.hasWarnedOverflow = false;
    }
  }
};

export default ipcMiddleware;
