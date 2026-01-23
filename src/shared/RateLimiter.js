/**
 * Rate Limiter Utilities
 *
 * Provides rate limiting implementations for controlling request frequency.
 *
 * Two patterns are available:
 * 1. SlidingWindowRateLimiter - Limits calls per time window (X calls per Y ms)
 * 2. Semaphore - Limits concurrent in-flight requests (used in OllamaClient)
 *
 * @module shared/RateLimiter
 */

const { TIMEOUTS } = require('./performanceConstants');

/**
 * Sliding window rate limiter
 *
 * Limits the number of calls that can be made within a time window.
 * Useful for preventing bursts and respecting API rate limits.
 *
 * @example
 * const limiter = new SlidingWindowRateLimiter(5, 1000); // 5 calls per second
 * await limiter.waitForSlot();
 * limiter.recordCall();
 * // ... make your API call
 */
class SlidingWindowRateLimiter {
  /**
   * @param {number} maxCalls - Maximum calls allowed in the time window
   * @param {number} windowMs - Time window in milliseconds
   */
  constructor(maxCalls, windowMs) {
    this.maxCalls = maxCalls;
    this.windowMs = windowMs;
    this.calls = [];
  }

  /**
   * Check if a new call can be made
   * @returns {boolean} True if call is allowed
   */
  canCall() {
    this._cleanup();
    return this.calls.length < this.maxCalls;
  }

  /**
   * Record a call timestamp
   */
  recordCall() {
    this._cleanup();
    this.calls.push(Date.now());
  }

  /**
   * Remove expired timestamps from the sliding window
   * @private
   */
  _cleanup() {
    const cutoff = Date.now() - this.windowMs;
    this.calls = this.calls.filter((t) => t > cutoff);
  }

  /**
   * Wait until a slot is available
   * FIX Bug 7: Smart waiting - calculate when oldest call expires instead of blind polling
   * @param {number} initialPollMs - Initial polling interval for fallback (default: TIMEOUTS.DELAY_BATCH)
   * @param {number} maxWaitMs - Maximum time to wait (default: 30 seconds)
   * @returns {Promise<void>}
   * @throws {Error} If max wait time is exceeded
   */
  async waitForSlot(initialPollMs = TIMEOUTS?.DELAY_BATCH || 100, maxWaitMs = 30000) {
    const startTime = Date.now();
    let pollInterval = initialPollMs;
    const MAX_POLL_INTERVAL = 1000; // Cap polling interval at 1 second
    const EXPIRY_BUFFER_MS = 10; // Small buffer after calculated expiry

    while (!this.canCall()) {
      // Check if max wait time exceeded
      if (Date.now() - startTime > maxWaitMs) {
        throw new Error(`Rate limiter wait timeout exceeded (${maxWaitMs}ms)`);
      }

      // FIX Bug 7: Smart waiting - calculate when oldest call will expire
      this._cleanup();
      if (this.calls.length > 0) {
        const oldestCall = Math.min(...this.calls);
        const oldestExpiry = oldestCall + this.windowMs;
        const waitTime = oldestExpiry - Date.now() + EXPIRY_BUFFER_MS;

        if (waitTime > 0 && waitTime < MAX_POLL_INTERVAL) {
          // Wait directly for the calculated expiry time (more efficient)
          await new Promise((r) => setTimeout(r, waitTime));
          continue;
        }
      }

      // Fallback to polling with exponential backoff when we can't calculate expiry
      await new Promise((r) => setTimeout(r, pollInterval));
      pollInterval = Math.min(pollInterval * 1.5, MAX_POLL_INTERVAL);
    }
  }

  /**
   * Get current rate limiter stats
   * @returns {{currentCalls: number, maxCalls: number, windowMs: number}}
   */
  getStats() {
    this._cleanup();
    return {
      currentCalls: this.calls.length,
      maxCalls: this.maxCalls,
      windowMs: this.windowMs
    };
  }

  /**
   * Reset the rate limiter (clear all recorded calls)
   */
  reset() {
    this.calls = [];
  }
}

/**
 * Semaphore for concurrent request limiting
 *
 * Limits the number of concurrent in-flight requests.
 * Useful for controlling load on a server.
 *
 * @example
 * const semaphore = new Semaphore(5); // Max 5 concurrent requests
 * await semaphore.acquire();
 * try {
 *   // ... make your request
 * } finally {
 *   semaphore.release();
 * }
 */
class Semaphore {
  /**
   * @param {number} maxConcurrent - Maximum concurrent operations
   * @param {number} maxQueueSize - Maximum waiting queue size (default: 100)
   * @param {number} queueTimeoutMs - Timeout for queued requests (default: 60000)
   */
  constructor(maxConcurrent, maxQueueSize = 100, queueTimeoutMs = 60000) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueueSize = maxQueueSize;
    this.queueTimeoutMs = queueTimeoutMs;
    this.activeCount = 0;
    this.waitQueue = [];
  }

  /**
   * FIX Bug 8: Check if a slot can be acquired without blocking
   * @returns {boolean} True if acquire() would succeed immediately or queue has space
   */
  canAcquire() {
    return this.activeCount < this.maxConcurrent || this.waitQueue.length < this.maxQueueSize;
  }

  /**
   * FIX Bug 8: Check if a slot is immediately available (no queueing)
   * @returns {boolean} True if acquire() would succeed without waiting
   */
  hasImmediateSlot() {
    return this.activeCount < this.maxConcurrent;
  }

  /**
   * Acquire a slot (blocks if at capacity)
   * FIX Bug 8: Added optional backpressure retry mechanism
   * @param {Object} [options] - Optional configuration
   * @param {boolean} [options.retry=false] - Whether to retry on queue full
   * @param {number} [options.maxRetries=3] - Maximum retry attempts
   * @param {number} [options.retryDelayMs=1000] - Initial retry delay (uses exponential backoff)
   * @returns {Promise<void>}
   * @throws {Error} If queue is full (and retry disabled/exhausted) or timeout reached
   */
  async acquire(options = {}) {
    const { retry = false, maxRetries = 3, retryDelayMs = 1000 } = options;

    // Fast path: slot available
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return;
    }

    // FIX Bug 8: Backpressure with retry mechanism
    let retryAttempt = 0;
    while (this.waitQueue.length >= this.maxQueueSize) {
      if (!retry || retryAttempt >= maxRetries) {
        const error = new Error('Request queue full, try again later');
        error.code = 'QUEUE_FULL';
        error.retryAttempts = retryAttempt;
        throw error;
      }

      // Wait with exponential backoff before retrying
      const delay = retryDelayMs * 2 ** retryAttempt;
      await new Promise((r) => setTimeout(r, delay));
      retryAttempt++;

      // Check again if slot became available during wait
      if (this.activeCount < this.maxConcurrent) {
        this.activeCount++;
        return;
      }
    }

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waitQueue.findIndex((item) => item.resolve === resolve);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
          reject(new Error('Request queue timeout'));
        }
      }, this.queueTimeoutMs);

      this.waitQueue.push({ resolve, reject, timeout });
    });
  }

  /**
   * Release a slot (must be called after acquire)
   * SECURITY FIX (CRIT-11): Guard against misuse where release() is called without matching acquire()
   * FIX: Improved guard to prevent activeCount underflow in all edge cases
   */
  release() {
    // FIX: Check for waiters first - if there are waiters, pass the slot directly
    // This ordering prevents race conditions where activeCount could underflow
    if (this.waitQueue.length > 0) {
      // Pass the slot directly to the next waiter (no net change to activeCount)
      const next = this.waitQueue.shift();
      clearTimeout(next.timeout);
      next.resolve();
    } else if (this.activeCount > 0) {
      // Only decrement if activeCount is positive - this is the normal case
      this.activeCount--;
    } else {
      // FIX (CRIT-11): Guard against activeCount going negative
      // Already at 0 with no waiters - this is a misuse (release without acquire)
      // Log warning but don't throw to maintain backwards compatibility
      // eslint-disable-next-line no-console
      if (typeof console !== 'undefined' && console.warn) {
        // eslint-disable-next-line no-console
        console.warn('[Semaphore] release() called without matching acquire() - ignoring');
      }
    }
  }

  /**
   * Get current semaphore stats
   * @returns {{activeCount: number, queueLength: number, maxConcurrent: number}}
   */
  getStats() {
    return {
      activeCount: this.activeCount,
      queueLength: this.waitQueue.length,
      maxConcurrent: this.maxConcurrent
    };
  }

  /**
   * Reset the semaphore (clears queue with errors)
   */
  reset() {
    for (const item of this.waitQueue) {
      clearTimeout(item.timeout);
      item.reject(new Error('Semaphore reset'));
    }
    this.waitQueue = [];
    this.activeCount = 0;
  }
}

/**
 * Create a pre-configured rate limiter for Ollama requests
 * @param {Object} options - Configuration options
 * @param {number} options.maxCalls - Max calls per window (default: 5)
 * @param {number} options.windowMs - Window size in ms (default: 1000)
 * @returns {SlidingWindowRateLimiter}
 */
function createOllamaRateLimiter(options = {}) {
  return new SlidingWindowRateLimiter(options.maxCalls || 5, options.windowMs || 1000);
}

module.exports = {
  SlidingWindowRateLimiter,
  Semaphore,
  createOllamaRateLimiter,
  // Alias for backward compatibility
  RateLimiter: SlidingWindowRateLimiter
};
