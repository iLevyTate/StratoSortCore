/**
 * IPC Channel Registry
 *
 * Tracks all registered IPC channels to enable targeted cleanup
 * instead of the dangerous ipcMain.removeAllListeners().
 *
 * @module core/ipcRegistry
 */

const { createLogger } = require('../../shared/logger');

const logger = createLogger('IPCRegistry');
/**
 * Registry of all IPC channels registered through this module.
 * Separated by type: handlers (handle/invoke) vs listeners (on/send).
 */
const registry = {
  /** Channels registered via ipcMain.handle() */
  handlers: new Set(),
  /** Channels registered via ipcMain.on() */
  listeners: new Map(), // channel -> Set of wrapped listener functions
  /** FIX: Maps original listener to wrapped listener for removeListener lookup */
  listenerWrappers: new WeakMap() // original -> wrapped
};

/**
 * FIX: CRITICAL - Global shutdown flag to prevent IPC handlers from running during shutdown
 * Previously, IPC handlers could fire during shutdown and access destroyed services
 */
let _isShuttingDown = false;
const _inFlightOperations = new Set();

/**
 * Set shutdown state - called by lifecycle during app shutdown
 * @param {boolean} shutting - True if app is shutting down
 */
function setShuttingDown(shutting) {
  _isShuttingDown = shutting;
  if (shutting) {
    logger.info('[REGISTRY] Shutdown mode enabled - IPC handlers will reject new requests');
  }
}

/**
 * Check if app is in shutdown state
 * @returns {boolean} True if app is shutting down
 */
function isShuttingDown() {
  return _isShuttingDown;
}

/**
 * Wrap ipcMain.handle to track registered channels
 *
 * @param {Object} ipcMain - Electron ipcMain
 * @param {string} channel - Channel name
 * @param {Function} handler - Handler function
 */
function registerHandler(ipcMain, channel, handler) {
  if (!channel || typeof channel !== 'string') {
    throw new Error('Channel must be a non-empty string');
  }
  if (!handler || typeof handler !== 'function') {
    throw new Error('Handler must be a function');
  }

  // Check for duplicate registration
  if (registry.handlers.has(channel)) {
    logger.warn(`[REGISTRY] Handler already registered for channel: ${channel}`);
    // Remove old handler before registering new one
    try {
      ipcMain.removeHandler(channel);
    } catch (e) {
      logger.debug(`[REGISTRY] Could not remove old handler: ${e.message}`);
    }
  }

  // FIX: CRITICAL - Wrap handler with shutdown gate to prevent access to destroyed services
  const wrappedHandler = async (event, ...args) => {
    if (_isShuttingDown) {
      logger.debug(`[REGISTRY] Rejecting IPC call during shutdown: ${channel}`);
      return {
        success: false,
        error: {
          code: 'APP_SHUTTING_DOWN',
          message: 'Application is shutting down'
        }
      };
    }
    const operationId = `${channel}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    _inFlightOperations.add(operationId);
    try {
      return await handler(event, ...args);
    } finally {
      _inFlightOperations.delete(operationId);
    }
  };

  ipcMain.handle(channel, wrappedHandler);
  registry.handlers.add(channel);
  logger.debug(`[REGISTRY] Handler registered: ${channel}`);
}

/**
 * Wait for in-flight IPC handlers to finish.
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} True if drained before timeout.
 */
async function waitForInFlightOperations(timeoutMs = 5000) {
  const start = Date.now();
  while (_inFlightOperations.size > 0 && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 50);
      if (timer && typeof timer.unref === 'function') timer.unref();
    });
  }
  return _inFlightOperations.size === 0;
}

/**
 * Wrap ipcMain.on to track registered listeners
 *
 * @param {Object} ipcMain - Electron ipcMain
 * @param {string} channel - Channel name
 * @param {Function} listener - Listener function
 */
function registerListener(ipcMain, channel, listener) {
  if (!channel || typeof channel !== 'string') {
    throw new Error('Channel must be a non-empty string');
  }
  if (!listener || typeof listener !== 'function') {
    throw new Error('Listener must be a function');
  }

  // FIX: Wrap listener with shutdown gate like handlers to prevent access to destroyed services
  const wrappedListener = (event, ...args) => {
    if (_isShuttingDown) {
      logger.debug(`[REGISTRY] Ignoring IPC listener during shutdown: ${channel}`);
      return;
    }
    const operationId = `${channel}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    _inFlightOperations.add(operationId);
    try {
      const result = listener(event, ...args);
      if (result && typeof result.then === 'function') {
        return Promise.resolve(result).finally(() => _inFlightOperations.delete(operationId));
      }
      _inFlightOperations.delete(operationId);
      return result;
    } catch (error) {
      _inFlightOperations.delete(operationId);
      throw error;
    }
  };

  ipcMain.on(channel, wrappedListener);

  if (!registry.listeners.has(channel)) {
    registry.listeners.set(channel, new Set());
  }
  registry.listeners.get(channel).add(wrappedListener);
  // FIX: Store mapping from original to wrapped for removeListener lookup
  registry.listenerWrappers.set(listener, wrappedListener);
  logger.debug(`[REGISTRY] Listener registered: ${channel}`);
}

/**
 * Remove a specific handler by channel
 *
 * @param {Object} ipcMain - Electron ipcMain
 * @param {string} channel - Channel name
 * @returns {boolean} True if handler was removed
 */
function removeHandler(ipcMain, channel) {
  if (!registry.handlers.has(channel)) {
    return false;
  }

  try {
    ipcMain.removeHandler(channel);
    registry.handlers.delete(channel);
    logger.debug(`[REGISTRY] Handler removed: ${channel}`);
    return true;
  } catch (e) {
    logger.error(`[REGISTRY] Failed to remove handler ${channel}:`, e);
    return false;
  }
}

/**
 * Remove a specific listener
 *
 * @param {Object} ipcMain - Electron ipcMain
 * @param {string} channel - Channel name
 * @param {Function} listener - Listener function to remove (original, not wrapped)
 * @returns {boolean} True if listener was removed
 */
function removeListener(ipcMain, channel, listener) {
  const channelListeners = registry.listeners.get(channel);
  // FIX: Look up the wrapped listener from the original
  const wrappedListener = registry.listenerWrappers.get(listener);

  if (!channelListeners || !wrappedListener || !channelListeners.has(wrappedListener)) {
    return false;
  }

  try {
    ipcMain.removeListener(channel, wrappedListener);
    channelListeners.delete(wrappedListener);
    // FIX: Clean up the wrapper mapping
    registry.listenerWrappers.delete(listener);

    // Clean up empty channel entry
    if (channelListeners.size === 0) {
      registry.listeners.delete(channel);
    }

    logger.debug(`[REGISTRY] Listener removed: ${channel}`);
    return true;
  } catch (e) {
    logger.error(`[REGISTRY] Failed to remove listener ${channel}:`, e);
    return false;
  }
}

/**
 * Remove all registered handlers and listeners (targeted cleanup)
 *
 * This is the safe alternative to ipcMain.removeAllListeners().
 * It only removes channels that were registered through this registry.
 *
 * @param {Object} ipcMain - Electron ipcMain
 * @returns {{handlers: number, listeners: number}} Count of removed items
 */
function removeAllRegistered(ipcMain) {
  let handlersRemoved = 0;
  let listenersRemoved = 0;

  // Remove all handlers
  for (const channel of registry.handlers) {
    try {
      ipcMain.removeHandler(channel);
      handlersRemoved++;
      logger.debug(`[REGISTRY] Cleanup: removed handler ${channel}`);
    } catch (e) {
      logger.error(`[REGISTRY] Cleanup: failed to remove handler ${channel}:`, e);
    }
  }
  registry.handlers.clear();

  // Remove all listeners
  for (const [channel, listeners] of registry.listeners) {
    for (const listener of listeners) {
      try {
        ipcMain.removeListener(channel, listener);
        listenersRemoved++;
      } catch (e) {
        logger.error(`[REGISTRY] Cleanup: failed to remove listener ${channel}:`, e);
      }
    }
  }
  registry.listeners.clear();

  logger.info(
    `[REGISTRY] Cleanup complete: ${handlersRemoved} handlers, ${listenersRemoved} listeners removed`
  );

  return { handlers: handlersRemoved, listeners: listenersRemoved };
}

/**
 * Get statistics about registered channels
 *
 * @returns {{handlers: number, listeners: number, channels: string[]}}
 */
function getStats() {
  const handlerChannels = Array.from(registry.handlers);
  const listenerChannels = Array.from(registry.listeners.keys());
  const allChannels = [...new Set([...handlerChannels, ...listenerChannels])];

  return {
    handlers: registry.handlers.size,
    listeners: Array.from(registry.listeners.values()).reduce((sum, set) => sum + set.size, 0),
    channels: allChannels.sort()
  };
}

/**
 * Check if a handler is registered for a channel
 *
 * @param {string} channel - Channel name
 * @returns {boolean}
 */
function hasHandler(channel) {
  return registry.handlers.has(channel);
}

/**
 * Check if any listeners are registered for a channel
 *
 * @param {string} channel - Channel name
 * @returns {boolean}
 */
function hasListeners(channel) {
  return registry.listeners.has(channel) && registry.listeners.get(channel).size > 0;
}

module.exports = {
  registerHandler,
  registerListener,
  removeHandler,
  removeListener,
  removeAllRegistered,
  getStats,
  hasHandler,
  hasListeners,
  // FIX: Shutdown gate control
  setShuttingDown,
  isShuttingDown,
  waitForInFlightOperations
};
