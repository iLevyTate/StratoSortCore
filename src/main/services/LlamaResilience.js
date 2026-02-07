// src/main/services/LlamaResilience.js

const { createLogger } = require('../../shared/logger');
const { withRetry } = require('../../shared/errorHandlingUtils');
const { CircuitBreaker } = require('../utils/CircuitBreaker');

const logger = createLogger('LlamaResilience');

/**
 * Per-model-type circuit breakers.
 * Separate breakers prevent a text model failure from blocking embedding operations.
 * @type {Map<string, CircuitBreaker>}
 */
const _circuitBreakers = new Map();

/** @type {{ failureThreshold: number, successThreshold: number, timeout: number, resetTimeout: number }} */
const LLAMA_BREAKER_CONFIG = {
  failureThreshold: 5, // Open after 5 consecutive complete failures
  successThreshold: 2, // 2 successes in HALF_OPEN to close
  timeout: 30000, // 30s before probing recovery
  resetTimeout: 60000 // Reset failure count after 60s of no failures
};

/**
 * Get or create a circuit breaker for the given model type.
 * @param {string} modelType - 'text' | 'vision' | 'embedding'
 * @returns {CircuitBreaker}
 */
function _getCircuitBreaker(modelType) {
  if (!_circuitBreakers.has(modelType)) {
    _circuitBreakers.set(modelType, new CircuitBreaker(`llama-${modelType}`, LLAMA_BREAKER_CONFIG));
  }
  return _circuitBreakers.get(modelType);
}

/**
 * Errors that indicate we should retry
 */
const RETRYABLE_LLAMA_ERRORS = [
  'context allocation failed',
  'memory allocation failed',
  'gpu memory',
  'vram',
  'cuda',
  'metal',
  'timeout',
  'busy'
];

/**
 * Errors that indicate we should fall back to CPU
 */
const GPU_FALLBACK_ERRORS = [
  'cuda out of memory',
  'metal error',
  'vulkan error',
  'gpu not available',
  'no metal device'
];

/**
 * Check if error is retryable
 */
function isRetryableLlamaError(error) {
  const message = (error.message || '').toLowerCase();
  return RETRYABLE_LLAMA_ERRORS.some((pattern) => message.includes(pattern));
}

/**
 * Check if error suggests GPU fallback
 */
function shouldFallbackToCPU(error) {
  const message = (error.message || '').toLowerCase();
  return GPU_FALLBACK_ERRORS.some((pattern) => message.includes(pattern));
}

/**
 * Core retry + GPU-fallback logic, separated from the circuit breaker wrapper
 * so the breaker records a single success/failure for the entire attempt chain.
 * @private
 */
async function _executeWithRetries(operation, options) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 5000,
    allowCPUFallback = true,
    onRetry = null,
    onFallback = null
  } = options;

  let lastError = null;
  let usedCPUFallback = false;

  // Try with current GPU setting
  try {
    return await withRetry(operation, {
      maxRetries,
      initialDelay,
      maxDelay,
      shouldRetry: isRetryableLlamaError,
      onRetry: (attempt, error) => {
        logger.warn(`[Resilience] Retry attempt ${attempt}`, { error: error.message });
        if (onRetry) onRetry(attempt, error);
      }
    })();
  } catch (error) {
    lastError = error;

    // Check if we should fall back to CPU
    if (allowCPUFallback && shouldFallbackToCPU(error)) {
      logger.warn('[Resilience] GPU error, falling back to CPU', { error: error.message });

      if (onFallback) onFallback(error);
      usedCPUFallback = true;

      // Retry with CPU
      try {
        return await withRetry(() => operation({ forceCPU: true }), {
          maxRetries: 2,
          initialDelay: 500,
          maxDelay: 2000
        })();
      } catch (cpuError) {
        lastError = cpuError;
      }
    }
  }

  // All retries exhausted
  const enrichedError = new Error(
    `Llama operation failed: ${lastError.message}` +
      (usedCPUFallback ? ' (including CPU fallback)' : '')
  );
  enrichedError.originalError = lastError;
  enrichedError.usedCPUFallback = usedCPUFallback;

  throw enrichedError;
}

/**
 * Wrap Llama operations with resilience (circuit breaker + retry + GPU fallback).
 *
 * When `modelType` is provided, a per-model-type circuit breaker guards the
 * operation.  After 5 consecutive complete failures (all retries exhausted)
 * the breaker opens and immediately rejects further calls for that model type
 * until the 30 s recovery probe succeeds.
 *
 * @param {Function} operation - The async operation to execute
 * @param {Object}   [options]
 * @param {string}   [options.modelType]        - 'text' | 'vision' | 'embedding'
 * @param {number}   [options.maxRetries=3]
 * @param {number}   [options.initialDelay=1000]
 * @param {number}   [options.maxDelay=5000]
 * @param {boolean}  [options.allowCPUFallback=true]
 * @param {Function} [options.onRetry]
 * @param {Function} [options.onFallback]
 */
async function withLlamaResilience(operation, options = {}) {
  const { modelType, ...retryOptions } = options;

  if (modelType) {
    const breaker = _getCircuitBreaker(modelType);
    // CircuitBreaker.execute() checks isAllowed(), records success/failure
    return breaker.execute(() => _executeWithRetries(operation, retryOptions));
  }

  // Backward-compatible: no circuit breaker when modelType is omitted
  return _executeWithRetries(operation, retryOptions);
}

/**
 * Wrap Orama persistence operations
 */
async function withOramaResilience(operation, options = {}) {
  const { maxRetries = 3 } = options;

  return withRetry(operation, {
    maxRetries,
    initialDelay: 100,
    maxDelay: 1000,
    shouldRetry: (error) => {
      const message = (error.message || '').toLowerCase();
      // Retry on disk I/O errors
      return (
        message.includes('ebusy') ||
        message.includes('eacces') ||
        message.includes('eperm') ||
        message.includes('enospc')
      );
    }
  })();
}

/**
 * Get circuit breaker stats for all model types (diagnostics).
 * @returns {Object<string, Object>}
 */
function getLlamaCircuitStats() {
  const stats = {};
  for (const [type, breaker] of _circuitBreakers) {
    stats[type] = breaker.getStats();
  }
  return stats;
}

/**
 * Reset the circuit breaker for a specific model type.
 * @param {string} modelType - 'text' | 'vision' | 'embedding'
 */
function resetLlamaCircuit(modelType) {
  const breaker = _circuitBreakers.get(modelType);
  if (breaker) breaker.reset();
}

/**
 * Cleanup all circuit breakers (call during shutdown).
 */
function cleanupLlamaCircuits() {
  for (const breaker of _circuitBreakers.values()) {
    breaker.cleanup();
  }
  _circuitBreakers.clear();
}

module.exports = {
  withLlamaResilience,
  withOramaResilience,
  isRetryableLlamaError,
  shouldFallbackToCPU,
  getLlamaCircuitStats,
  resetLlamaCircuit,
  cleanupLlamaCircuits,
  // Exposed for testing only
  _circuitBreakers,
  _getCircuitBreaker
};
