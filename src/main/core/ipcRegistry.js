/**
 * IPC Channel Registry
 *
 * Tracks all registered IPC channels to enable targeted cleanup
 * instead of the dangerous ipcMain.removeAllListeners().
 *
 * @module core/ipcRegistry
 */

const { logger } = require('../../shared/logger');

logger.setContext('IPCRegistry');

/**
 * Registry of all IPC channels registered through this module.
 * Separated by type: handlers (handle/invoke) vs listeners (on/send).
 */
const registry = {
  /** Channels registered via ipcMain.handle() */
  handlers: new Set(),
  /** Channels registered via ipcMain.on() */
  listeners: new Map() // channel -> Set of listener functions
};

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

  ipcMain.handle(channel, handler);
  registry.handlers.add(channel);
  logger.debug(`[REGISTRY] Handler registered: ${channel}`);
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

  ipcMain.on(channel, listener);

  if (!registry.listeners.has(channel)) {
    registry.listeners.set(channel, new Set());
  }
  registry.listeners.get(channel).add(listener);
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
 * @param {Function} listener - Listener function to remove
 * @returns {boolean} True if listener was removed
 */
function removeListener(ipcMain, channel, listener) {
  const channelListeners = registry.listeners.get(channel);
  if (!channelListeners || !channelListeners.has(listener)) {
    return false;
  }

  try {
    ipcMain.removeListener(channel, listener);
    channelListeners.delete(listener);

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
  hasListeners
};
