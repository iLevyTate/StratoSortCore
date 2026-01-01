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
   * FIX: HIGH - Add maximum wait time to prevent indefinite blocking
   * @param {number} pollIntervalMs - Polling interval (default: TIMEOUTS.DELAY_BATCH)
   * @param {number} maxWaitMs - Maximum time to wait (default: 30 seconds)
   * @returns {Promise<void>}
   * @throws {Error} If max wait time is exceeded
   */
  async waitForSlot(pollIntervalMs = TIMEOUTS?.DELAY_BATCH || 100, maxWaitMs = 30000) {
    const startTime = Date.now();

    while (!this.canCall()) {
      // FIX: Check if max wait time exceeded
      if (Date.now() - startTime > maxWaitMs) {
        throw new Error(`Rate limiter wait timeout exceeded (${maxWaitMs}ms)`);
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
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
   * Acquire a slot (blocks if at capacity)
   * @returns {Promise<void>}
   * @throws {Error} If queue is full or timeout reached
   */
  async acquire() {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return;
    }

    if (this.waitQueue.length >= this.maxQueueSize) {
      throw new Error('Request queue full, try again later');
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
   */
  release() {
    this.activeCount--;

    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      clearTimeout(next.timeout);
      this.activeCount++;
      next.resolve();
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
