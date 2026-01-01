/**
 * ChromaDB Status IPC Handlers
 *
 * Provides IPC endpoints for:
 * - Getting ChromaDB service status
 * - Circuit breaker statistics
 * - Offline queue statistics
 * - Manual health check and recovery
 * - Real-time status updates to renderer
 */

const { getInstance: getChromaDB } = require('../services/chromadb');
const { withErrorLogging, safeHandle } = require('./ipcWrappers');
const { CircuitState } = require('../utils/CircuitBreaker');

/**
 * Register ChromaDB IPC handlers
 * @param {Object} params - Parameters object
 * @param {Object} params.ipcMain - Electron IPC main
 * @param {Object} params.IPC_CHANNELS - IPC channel constants
 * @param {Object} params.logger - Logger instance
 * @param {Function} params.getMainWindow - Get main window function
 */
function registerChromaDBIpc({ ipcMain, IPC_CHANNELS, logger, getMainWindow }) {
  const chromaDbService = getChromaDB();

  // Set up event forwarding to renderer
  _setupEventForwarding(chromaDbService, getMainWindow, IPC_CHANNELS, logger);

  /**
   * Get current ChromaDB service status
   * Returns: { isOnline, circuitState, queueSize, isInitialized }
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.CHROMADB.GET_STATUS,
    withErrorLogging(logger, async () => {
      return {
        isOnline: chromaDbService.isOnline,
        isInitialized: chromaDbService.initialized,
        circuitState: chromaDbService.getCircuitState(),
        isServiceAvailable: chromaDbService.isServiceAvailable(),
        queueSize: chromaDbService.offlineQueue?.size() || 0,
        serverUrl: chromaDbService.serverUrl
      };
    })
  );

  /**
   * Get circuit breaker statistics
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.CHROMADB.GET_CIRCUIT_STATS,
    withErrorLogging(logger, async () => {
      return chromaDbService.getCircuitStats();
    })
  );

  /**
   * Get offline queue statistics
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.CHROMADB.GET_QUEUE_STATS,
    withErrorLogging(logger, async () => {
      return chromaDbService.getQueueStats();
    })
  );

  /**
   * Force recovery attempt
   * Resets circuit breaker and triggers health check
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.CHROMADB.FORCE_RECOVERY,
    withErrorLogging(logger, async () => {
      logger.info('[CHROMADB-IPC] Force recovery requested');
      chromaDbService.forceRecovery();

      // Trigger health check
      const isHealthy = await chromaDbService.checkHealth();

      return {
        success: true,
        isHealthy,
        circuitState: chromaDbService.getCircuitState()
      };
    })
  );

  /**
   * Perform manual health check
   */
  safeHandle(
    ipcMain,
    IPC_CHANNELS.CHROMADB.HEALTH_CHECK,
    withErrorLogging(logger, async () => {
      const isHealthy = await chromaDbService.checkHealth();
      return {
        isHealthy,
        isOnline: chromaDbService.isOnline,
        circuitState: chromaDbService.getCircuitState(),
        queueSize: chromaDbService.offlineQueue?.size() || 0
      };
    })
  );

  logger.info('[CHROMADB-IPC] ChromaDB status handlers registered');
}

// FIX: Track event listener references for cleanup to prevent memory leaks
let _eventListeners = [];
let _chromaDbServiceRef = null;

/**
 * Set up event forwarding from ChromaDB service to renderer
 * @private
 */
function _setupEventForwarding(chromaDbService, getMainWindow, IPC_CHANNELS, logger) {
  // FIX: Store service reference for cleanup
  _chromaDbServiceRef = chromaDbService;

  // Helper to send status to renderer
  const sendStatusUpdate = (status, data = {}) => {
    try {
      const win = getMainWindow?.();
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.CHROMADB.STATUS_CHANGED, {
          status,
          timestamp: Date.now(),
          ...data
        });
        logger.debug('[CHROMADB-IPC] Sent status update to renderer', {
          status
        });
      }
    } catch (error) {
      // FIX: Log at warn level for better visibility of IPC communication issues
      logger.warn('[CHROMADB-IPC] Failed to send status update', {
        error: error.message
      });
    }
  };

  // FIX: Store handler references for cleanup
  const onlineHandler = (data) => {
    sendStatusUpdate('online', {
      reason: data.reason,
      circuitState: chromaDbService.getCircuitState()
    });
  };

  const offlineHandler = (data) => {
    sendStatusUpdate('offline', {
      reason: data.reason,
      failureCount: data.failureCount,
      circuitState: chromaDbService.getCircuitState()
    });
  };

  const recoveringHandler = (data) => {
    sendStatusUpdate('recovering', {
      reason: data.reason,
      circuitState: chromaDbService.getCircuitState()
    });
  };

  const circuitStateChangeHandler = (data) => {
    sendStatusUpdate('circuit_changed', {
      previousState: data.previousState,
      currentState: data.currentState
    });
  };

  const operationQueuedHandler = (data) => {
    sendStatusUpdate('operation_queued', {
      operationType: data.type,
      queueSize: data.queueSize
    });
  };

  const queueFlushedHandler = (data) => {
    sendStatusUpdate('queue_flushed', {
      processed: data.processed,
      failed: data.failed,
      remaining: data.remaining
    });
  };

  // Register handlers and store references
  chromaDbService.on('online', onlineHandler);
  chromaDbService.on('offline', offlineHandler);
  chromaDbService.on('recovering', recoveringHandler);
  chromaDbService.on('circuitStateChange', circuitStateChangeHandler);
  chromaDbService.on('operationQueued', operationQueuedHandler);
  chromaDbService.on('queueFlushed', queueFlushedHandler);

  // FIX: Store references for cleanup
  _eventListeners = [
    { event: 'online', handler: onlineHandler },
    { event: 'offline', handler: offlineHandler },
    { event: 'recovering', handler: recoveringHandler },
    { event: 'circuitStateChange', handler: circuitStateChangeHandler },
    { event: 'operationQueued', handler: operationQueuedHandler },
    { event: 'queueFlushed', handler: queueFlushedHandler }
  ];

  logger.info('[CHROMADB-IPC] Event forwarding set up');
}

/**
 * FIX: Cleanup event listeners to prevent memory leaks
 * Call this during app shutdown or hot reload
 */
function cleanupEventListeners() {
  if (_chromaDbServiceRef && _eventListeners.length > 0) {
    _eventListeners.forEach(({ event, handler }) => {
      try {
        _chromaDbServiceRef.off(event, handler);
      } catch {
        // Ignore cleanup errors
      }
    });
    _eventListeners = [];
    _chromaDbServiceRef = null;
  }
}

/**
 * Get a summary of ChromaDB status for UI display
 * @param {Object} chromaDbService - ChromaDB service instance
 * @returns {Object} Status summary
 */
function getStatusSummary(chromaDbService) {
  const circuitState = chromaDbService.getCircuitState();
  const queueStats = chromaDbService.getQueueStats();

  let statusLevel = 'healthy';
  let statusMessage = 'ChromaDB is connected and operational';

  if (circuitState === CircuitState.OPEN) {
    statusLevel = 'error';
    statusMessage = 'ChromaDB is offline. Operations are being queued.';
  } else if (circuitState === CircuitState.HALF_OPEN) {
    statusLevel = 'warning';
    statusMessage = 'Attempting to reconnect to ChromaDB...';
  } else if (!chromaDbService.isOnline) {
    statusLevel = 'warning';
    statusMessage = 'ChromaDB connection is unstable';
  }

  if (queueStats.queueSize > 0) {
    statusMessage += ` (${queueStats.queueSize} operations queued)`;
  }

  return {
    level: statusLevel,
    message: statusMessage,
    circuitState,
    isOnline: chromaDbService.isOnline,
    queueSize: queueStats.queueSize
  };
}

module.exports = {
  registerChromaDBIpc,
  getStatusSummary,
  // FIX: Export cleanup function for use during app shutdown
  cleanupEventListeners
};
