/**
 * Correlation ID Context
 *
 * Provides operation correlation tracking across async calls using AsyncLocalStorage.
 * Allows tracing a request through various services and logs.
 *
 * Robustly handles environments where AsyncLocalStorage or crypto is unavailable (e.g. Renderer).
 */

/* global globalThis */

let AsyncLocalStorage;
try {
  ({ AsyncLocalStorage } = require('async_hooks'));
} catch (e) {
  // async_hooks not available (e.g. browser/renderer without polyfill)
}

let randomUUID;
try {
  ({ randomUUID } = require('crypto'));
} catch (e) {
  // crypto not available via require
}

// Fallback UUID generator if crypto.randomUUID is not available
const generateUUID = () => {
  if (typeof randomUUID === 'function') {
    return randomUUID();
  }
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  // Simple fallback for environments without crypto
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

// Fallback storage if AsyncLocalStorage is not available
// This won't actually track context across async calls in the renderer,
// but ensures the code doesn't crash.
const dummyStorage = {
  run: (store, callback) => callback(),
  getStore: () => undefined
};

const correlationStorage = AsyncLocalStorage ? new AsyncLocalStorage() : dummyStorage;

/**
 * Generate a new correlation ID
 * @param {string} prefix - Optional prefix for the ID
 * @returns {string} The generated ID
 */
function generateCorrelationId(prefix = 'req') {
  const uuid = generateUUID();
  // If uuid is full UUID, take substring, otherwise use as is if it came from math.random fallback
  const shortUuid = uuid.length > 8 ? uuid.substring(0, 8) : uuid;
  return `${prefix}_${Date.now()}_${shortUuid}`;
}

/**
 * Run a function within a correlation context
 * @param {Function} fn - The function to run
 * @param {string} [id] - Optional ID to use (generates new one if not provided)
 * @returns {*} The result of the function
 */
function withCorrelationId(fn, id = null) {
  const correlationId = id || generateCorrelationId();
  return correlationStorage.run(correlationId, fn);
}

/**
 * Get the current correlation ID
 * @returns {string|undefined} The current correlation ID or undefined
 */
function getCorrelationId() {
  return correlationStorage.getStore();
}

module.exports = {
  withCorrelationId,
  getCorrelationId,
  generateCorrelationId
};
