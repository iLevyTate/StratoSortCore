/**
 * Timing Constants
 *
 * Named constants for all timing-related values used in the main process.
 * Extracted from simple-main.js for maintainability and documentation.
 *
 * @module core/timingConstants
 */

/**
 * Window management timing constants
 */
const WINDOW = {
  /**
   * Delay after restore() before checking visibility.
   * Gives Chromium time to process the window restore operation.
   */
  RESTORE_SETTLE_MS: 50,

  /**
   * Duration to keep window "always on top" when forcing foreground on Windows.
   * Must be long enough for the window to receive focus.
   */
  ALWAYS_ON_TOP_DURATION_MS: 100
};

/**
 * Startup and initialization timing constants
 */
const STARTUP = {
  /**
   * Maximum time to wait for startup manager to complete.
   * If exceeded, app continues in degraded mode.
   */
  MANAGER_TIMEOUT_MS: 30000,

  /**
   * Delay before attempting to resume incomplete organize batches.
   * Allows window to stabilize and render before background processing.
   */
  RESUME_BATCH_DELAY_MS: 500,

  /**
   * Maximum time to wait for service integration to initialize.
   * Should match startup manager timeout for consistency.
   */
  SERVICE_INIT_TIMEOUT_MS: 30000
};

/**
 * Shutdown and cleanup timing constants
 */
const SHUTDOWN = {
  /**
   * Maximum time allowed for all cleanup operations.
   * After this, cleanup is abandoned and app force quits.
   */
  CLEANUP_TIMEOUT_MS: 5000,

  /**
   * Maximum time to wait for shutdown verification checks.
   */
  VERIFY_TIMEOUT_MS: 10000,

  /**
   * Timeout for taskkill command on Windows.
   */
  TASKKILL_TIMEOUT_MS: 5000
};

/**
 * Metrics and monitoring timing constants
 */
const METRICS = {
  /**
   * Interval between system metrics broadcasts to renderer.
   * Increased from 10s to 30s to reduce overhead.
   */
  BROADCAST_INTERVAL_MS: 30000
};

/**
 * Process management timing constants
 */
const PROCESS = {
  /**
   * Time to wait after SIGTERM before sending SIGKILL.
   */
  GRACEFUL_SHUTDOWN_WAIT_MS: 2000,

  /**
   * Timeout for individual kill commands.
   */
  KILL_COMMAND_TIMEOUT_MS: 100
};

module.exports = {
  WINDOW,
  STARTUP,
  SHUTDOWN,
  METRICS,
  PROCESS
};
