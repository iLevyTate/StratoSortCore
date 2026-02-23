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
  timeout: 300000, // 300s (5m) before probing recovery (increased for CPU fallback)
  resetTimeout: 300000 // Reset failure count after 300s of no failures
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
 * Non-transient error codes/patterns that should NOT trip the circuit breaker.
 * These represent expected business failures (model not downloaded, file corrupted,
 * input validation), not service health degradation. Allowing them to count as
 * circuit breaker failures causes 5-minute blackouts after harmless scenarios like
 * a user not having downloaded the model yet.
 */
const NON_TRANSIENT_ERROR_PATTERNS = [
  'model not found',
  'model file not found',
  'not found',
  'invalid gguf',
  'corrupted',
  'bad magic',
  'no model',
  'download',
  'unsupported image format',
  'zero length image',
  'invalid image'
];

const NON_TRANSIENT_ERROR_CODES = new Set([
  'LLAMA_001', // LLAMA_MODEL_LOAD_FAILED
  'LLAMA_002' // LLAMA_MODEL_NOT_FOUND
]);

/**
 * Check if an error is non-transient (should NOT count against circuit breaker)
 */
function isNonTransientError(error) {
  // Check error code first (most reliable)
  const code = error?.code || error?.originalError?.code;
  if (code && NON_TRANSIENT_ERROR_CODES.has(code)) return true;

  const message = (error?.message || '').toLowerCase();
  return NON_TRANSIENT_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * Errors that indicate we should retry
 */
const RETRYABLE_LLAMA_ERRORS = [
  'context allocation failed',
  'failed to create context',
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
  'vk_error',
  'cuda error',
  'gpu not available',
  'no metal device',
  'unable to allocate',
  'failed to allocate',
  'buffer allocation failed',
  'not enough vram',
  'available vram',
  'context size of'
];

const TRANSIENT_GPU_ERROR_PATTERNS = [
  'metal error',
  'vulkan error',
  'vk_error',
  'cuda error',
  'driver',
  'busy'
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

function isTransientGpuError(error) {
  const message = (error?.message || '').toLowerCase();
  return TRANSIENT_GPU_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
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

  let lastError;
  let usedCPUFallback = false;

  // Try with current GPU setting
  try {
    return await withRetry(operation, {
      maxRetries,
      initialDelay,
      maxDelay,
      shouldRetry: isRetryableLlamaError,
      onRetry: (error, attempt) => {
        logger.warn(`[Resilience] Retry attempt ${attempt}`, { error: error.message });
        if (onRetry) onRetry(error, attempt);
      }
    })();
  } catch (error) {
    lastError = error;

    // Check if we should fall back to CPU
    if (allowCPUFallback && shouldFallbackToCPU(error)) {
      const cpuFallbackRequestedByDegradation = error?._degradationAction === 'retry_with_cpu';
      const transientGpuError = isTransientGpuError(error);

      // Transient backend faults should retry on the primary backend before
      // escalating to CPU fallback.
      if (!cpuFallbackRequestedByDegradation && transientGpuError) {
        try {
          logger.warn('[Resilience] Transient GPU error, retrying primary backend', {
            error: error.message
          });
          return await withRetry(operation, {
            maxRetries: 2,
            initialDelay: 500,
            maxDelay: 2000,
            shouldRetry: isRetryableLlamaError,
            onRetry: (retryErr, attempt) => {
              logger.warn(`[Resilience] Primary-backend retry attempt ${attempt}`, {
                error: retryErr.message
              });
              if (onRetry) onRetry(retryErr, attempt);
            }
          })();
        } catch (transientRetryError) {
          lastError = transientRetryError;
        }
      }

      logger.warn('[Resilience] GPU error, falling back to CPU', {
        error: lastError?.message || error.message
      });

      if (onFallback) onFallback(lastError || error);
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
 * until the 5 min recovery probe succeeds.
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
    // Wrap the retry logic so non-transient errors (model-not-found, etc.) bypass
    // the circuit breaker's failure recording. These are expected business failures,
    // not service health degradation. Without this, 5 "model not found" errors
    // open the circuit for 5 minutes, blocking operations even after the model is
    // downloaded.
    return breaker.execute(async () => {
      try {
        return await _executeWithRetries(operation, retryOptions);
      } catch (error) {
        if (isNonTransientError(error)) {
          // In HALF_OPEN state, non-transient errors must still transition the
          // breaker to OPEN. Otherwise the breaker stays stuck in HALF_OPEN
          // because _skipCircuitBreakerCount prevents recordFailure() from
          // being called, and recordFailure() is the only path that transitions
          // HALF_OPEN -> OPEN.
          if (breaker.getState() !== 'HALF_OPEN') {
            // Tag the error so CircuitBreaker.execute() still throws it, but
            // we record a success to prevent the breaker from tripping.
            // This is safe because the breaker's recordFailure() has already been
            // called by execute()'s catch block — we need to undo that.
            // Simpler approach: throw a wrapper that CircuitBreaker won't count.
            error._skipCircuitBreakerCount = true;
          }
        }
        throw error;
      }
    });
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
