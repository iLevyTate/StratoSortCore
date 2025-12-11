/**
 * Circuit Breaker Pattern Implementation
 *
 * Provides fault tolerance for external service calls by tracking failures
 * and preventing cascading failures when a service is unavailable.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, requests are rejected immediately
 * - HALF_OPEN: Testing if service has recovered
 *
 * Configuration:
 * - failureThreshold: Number of failures before opening circuit
 * - successThreshold: Number of successes in HALF_OPEN before closing
 * - timeout: Time in ms before attempting recovery (OPEN -> HALF_OPEN)
 * - resetTimeout: Time in ms before resetting failure count in CLOSED state
 */

const { EventEmitter } = require('events');
const { logger } = require('../../shared/logger');

logger.setContext('CircuitBreaker');

// Circuit states
const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

// Default configuration
const DEFAULT_CONFIG = {
  failureThreshold: 5, // Failures before opening circuit
  successThreshold: 2, // Successes needed in HALF_OPEN to close
  timeout: 30000, // 30 seconds before attempting recovery
  resetTimeout: 60000, // 60 seconds to reset failure count in CLOSED
  maxQueueSize: 1000, // Maximum operations to queue when circuit is open
  halfOpenMaxConcurrent: 1 // Max concurrent requests in HALF_OPEN state
};

/**
 * Circuit Breaker class for managing service availability
 */
class CircuitBreaker extends EventEmitter {
  /**
   * Create a new CircuitBreaker
   * @param {string} serviceName - Name of the service (for logging)
   * @param {Object} config - Configuration options
   */
  constructor(serviceName, config = {}) {
    super();
    this.serviceName = serviceName;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // State tracking
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
    this.lastStateChange = Date.now();
    this.halfOpenInFlight = 0;

    // Timers
    this.recoveryTimer = null;
    this.resetTimer = null;

    // Statistics
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rejectedRequests: 0,
      timeoutsCount: 0,
      stateChanges: []
    };

    logger.info(`[CircuitBreaker:${serviceName}] Initialized`, {
      config: this.config
    });
  }

  /**
   * Get the current circuit state
   * @returns {string} Current state
   */
  getState() {
    return this.state;
  }

  /**
   * Check if the circuit allows requests
   * @returns {boolean} True if requests are allowed
   */
  isAllowed() {
    switch (this.state) {
      case CircuitState.CLOSED:
        return true;
      case CircuitState.OPEN:
        return false;
      case CircuitState.HALF_OPEN:
        // Allow limited requests in HALF_OPEN for testing
        return this.halfOpenInFlight < this.config.halfOpenMaxConcurrent;
      default:
        return false;
    }
  }

  /**
   * Check if service is available (convenience method)
   * @returns {boolean} True if service is available
   */
  isAvailable() {
    return this.state !== CircuitState.OPEN;
  }

  /**
   * Record a successful operation
   */
  recordSuccess() {
    this.stats.totalRequests++;
    this.stats.successfulRequests++;
    this.lastSuccessTime = Date.now();

    switch (this.state) {
      case CircuitState.CLOSED:
        // Reset failure count on success
        this.failureCount = 0;
        this._scheduleResetTimer();
        break;

      case CircuitState.HALF_OPEN:
        this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
        this.successCount++;

        logger.debug(`[CircuitBreaker:${this.serviceName}] Success in HALF_OPEN`, {
          successCount: this.successCount,
          threshold: this.config.successThreshold
        });

        // Close circuit after enough successes
        if (this.successCount >= this.config.successThreshold) {
          this._transitionTo(CircuitState.CLOSED);
        }
        break;

      case CircuitState.OPEN:
        // Shouldn't happen, but handle gracefully
        logger.warn(`[CircuitBreaker:${this.serviceName}] Success recorded while OPEN`);
        break;
    }
  }

  /**
   * Record a failed operation
   * @param {Error} error - The error that occurred
   */
  recordFailure(error) {
    this.stats.totalRequests++;
    this.stats.failedRequests++;
    this.lastFailureTime = Date.now();
    this.failureCount++;

    const errorMessage = error?.message || 'Unknown error';

    // Check for timeout errors
    if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
      this.stats.timeoutsCount++;
    }

    switch (this.state) {
      case CircuitState.CLOSED:
        logger.debug(`[CircuitBreaker:${this.serviceName}] Failure in CLOSED`, {
          failureCount: this.failureCount,
          threshold: this.config.failureThreshold,
          error: errorMessage
        });

        // Open circuit after threshold failures
        if (this.failureCount >= this.config.failureThreshold) {
          this._transitionTo(CircuitState.OPEN);
        }
        break;

      case CircuitState.HALF_OPEN:
        this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
        logger.debug(`[CircuitBreaker:${this.serviceName}] Failure in HALF_OPEN`, {
          error: errorMessage
        });

        // Immediately reopen circuit on failure in HALF_OPEN
        this._transitionTo(CircuitState.OPEN);
        break;

      case CircuitState.OPEN:
        // Already open, update stats but don't change state
        logger.debug(`[CircuitBreaker:${this.serviceName}] Failure recorded while OPEN`);
        break;
    }
  }

  /**
   * Record a rejected request (when circuit is open)
   */
  recordRejection() {
    this.stats.rejectedRequests++;
    logger.debug(`[CircuitBreaker:${this.serviceName}] Request rejected`, {
      state: this.state
    });
  }

  /**
   * Execute an operation through the circuit breaker
   * @param {Function} operation - Async function to execute
   * @returns {Promise<*>} Result of the operation
   * @throws {Error} If circuit is open or operation fails
   */
  async execute(operation) {
    if (!this.isAllowed()) {
      this.recordRejection();
      const error = new Error(`Circuit breaker is ${this.state} for ${this.serviceName}`);
      error.code = 'CIRCUIT_OPEN';
      error.serviceName = this.serviceName;
      error.state = this.state;
      throw error;
    }

    // Track in-flight requests for HALF_OPEN
    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenInFlight++;
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  /**
   * Force the circuit to a specific state
   * @param {string} state - Target state
   */
  forceState(state) {
    if (!Object.values(CircuitState).includes(state)) {
      throw new Error(`Invalid circuit state: ${state}`);
    }

    logger.warn(`[CircuitBreaker:${this.serviceName}] Forcing state to`, state);
    this._transitionTo(state, true);
  }

  /**
   * Reset the circuit breaker to initial state
   */
  reset() {
    this._clearTimers();
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenInFlight = 0;
    this._transitionTo(CircuitState.CLOSED, true);
    logger.info(`[CircuitBreaker:${this.serviceName}] Reset to initial state`);
  }

  /**
   * Get circuit breaker statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      serviceName: this.serviceName,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      lastStateChange: this.lastStateChange,
      timeSinceLastStateChange: Date.now() - this.lastStateChange,
      config: { ...this.config },
      ...this.stats
    };
  }

  /**
   * Transition to a new state
   * @private
   * @param {string} newState - Target state
   * @param {boolean} forced - Whether this is a forced transition
   */
  _transitionTo(newState, forced = false) {
    const oldState = this.state;
    if (oldState === newState && !forced) {
      return;
    }

    this.state = newState;
    this.lastStateChange = Date.now();
    this._clearTimers();

    // Record state change
    this.stats.stateChanges.push({
      from: oldState,
      to: newState,
      timestamp: this.lastStateChange,
      forced
    });

    // Keep only last 100 state changes
    if (this.stats.stateChanges.length > 100) {
      this.stats.stateChanges = this.stats.stateChanges.slice(-100);
    }

    logger.info(
      `[CircuitBreaker:${this.serviceName}] State transition: ${oldState} -> ${newState}`,
      {
        forced,
        failureCount: this.failureCount,
        successCount: this.successCount
      }
    );

    // Emit state change event
    this.emit('stateChange', {
      serviceName: this.serviceName,
      previousState: oldState,
      currentState: newState,
      forced,
      timestamp: this.lastStateChange
    });

    // Set up state-specific behavior
    switch (newState) {
      case CircuitState.OPEN:
        this.successCount = 0;
        this._scheduleRecoveryTimer();
        this.emit('open', {
          serviceName: this.serviceName,
          failureCount: this.failureCount
        });
        break;

      case CircuitState.HALF_OPEN:
        this.successCount = 0;
        this.halfOpenInFlight = 0;
        this.emit('halfOpen', { serviceName: this.serviceName });
        break;

      case CircuitState.CLOSED:
        this.failureCount = 0;
        this.successCount = 0;
        this._scheduleResetTimer();
        this.emit('close', { serviceName: this.serviceName });
        break;
    }
  }

  /**
   * Schedule recovery timer for OPEN -> HALF_OPEN transition
   * @private
   */
  _scheduleRecoveryTimer() {
    this._clearTimers();

    this.recoveryTimer = setTimeout(() => {
      logger.info(
        `[CircuitBreaker:${this.serviceName}] Recovery timeout elapsed, transitioning to HALF_OPEN`
      );
      this._transitionTo(CircuitState.HALF_OPEN);
    }, this.config.timeout);

    // Allow process to exit even if timer is pending
    if (this.recoveryTimer.unref) {
      this.recoveryTimer.unref();
    }
  }

  /**
   * Schedule reset timer for failure count in CLOSED state
   * @private
   */
  _scheduleResetTimer() {
    // Clear existing reset timer
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }

    this.resetTimer = setTimeout(() => {
      if (this.state === CircuitState.CLOSED && this.failureCount > 0) {
        logger.debug(`[CircuitBreaker:${this.serviceName}] Resetting failure count`);
        this.failureCount = 0;
      }
    }, this.config.resetTimeout);

    // Allow process to exit even if timer is pending
    if (this.resetTimer.unref) {
      this.resetTimer.unref();
    }
  }

  /**
   * Clear all timers
   * @private
   */
  _clearTimers() {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this._clearTimers();
    this.removeAllListeners();
    logger.info(`[CircuitBreaker:${this.serviceName}] Cleaned up`);
  }
}

// Export circuit states for external use
module.exports = {
  CircuitBreaker,
  CircuitState,
  DEFAULT_CONFIG
};
