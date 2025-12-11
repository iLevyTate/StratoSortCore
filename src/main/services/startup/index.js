/**
 * StartupManager Module
 *
 * Central export for application startup orchestration.
 *
 * @module services/startup
 */

const { StartupManager } = require('./StartupManagerCore');
const { logger } = require('../../../shared/logger');

logger.setContext('StartupManager');

// Singleton instance
let instance = null;

/**
 * Get the singleton StartupManager instance
 *
 * @param {Object} [options] - Options passed to StartupManager constructor
 * @returns {StartupManager} The singleton instance
 */
function getStartupManager(options = {}) {
  if (!instance) {
    instance = new StartupManager(options);
  }
  return instance;
}

/**
 * Create a new StartupManager instance (for testing or custom configuration)
 *
 * @param {Object} [options] - Configuration options
 * @returns {StartupManager} A new StartupManager instance
 */
function createInstance(options = {}) {
  return new StartupManager(options);
}

/**
 * Reset the singleton instance (primarily for testing)
 * @returns {Promise<void>}
 */
async function resetInstance() {
  if (instance) {
    const oldInstance = instance;
    instance = null; // Clear reference first to prevent reuse during shutdown
    try {
      await oldInstance.shutdown();
    } catch (err) {
      logger.warn('[StartupManager] Error during reset shutdown:', err.message);
    }
  }
}

module.exports = {
  StartupManager,
  getStartupManager,
  createInstance,
  resetInstance
};
