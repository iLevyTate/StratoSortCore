/**
 * ChromaDB Service Module
 *
 * Composed module that provides the ChromaDBService singleton.
 * Maintains backward compatibility with the original ChromaDBService.js.
 *
 * Structure:
 * - index.js - Main export with singleton pattern
 * - ChromaDBServiceCore.js - Core service class (~600 lines)
 * - ChromaQueryCache.js - LRU cache with TTL (~130 lines)
 * - ChromaHealthChecker.js - Health checking utilities (~200 lines)
 * - fileOperations.js - File embedding operations (~350 lines)
 * - folderOperations.js - Folder embedding operations (~400 lines)
 *
 * @module services/chromadb
 */

const { ChromaDBServiceCore } = require('./ChromaDBServiceCore');
const { ChromaQueryCache } = require('./ChromaQueryCache');
const {
  checkHealthViaHttp,
  checkHealthViaClient,
  isServerAvailable,
  createHealthCheckInterval,
} = require('./ChromaHealthChecker');
const { logger } = require('../../../shared/logger');

// Export the core class as ChromaDBService for backward compatibility
const ChromaDBService = ChromaDBServiceCore;

// Singleton instance
let instance = null;

/**
 * Get the singleton ChromaDBService instance
 *
 * This function provides the singleton instance for backward compatibility.
 * For new code, prefer using the ServiceContainer:
 *
 * @example
 * // Using ServiceContainer (recommended)
 * const { container, ServiceIds } = require('./ServiceContainer');
 * const chromaDb = container.resolve(ServiceIds.CHROMA_DB);
 *
 * // Using getInstance (backward compatible)
 * const { getInstance } = require('./ChromaDBService');
 * const chromaDb = getInstance();
 *
 * @returns {ChromaDBService} The singleton instance
 */
function getInstance() {
  if (!instance) {
    instance = new ChromaDBService();
  }
  return instance;
}

/**
 * Create a new ChromaDBService instance (for testing or custom configuration)
 *
 * Unlike getInstance(), this creates a fresh instance not tied to the singleton.
 * Useful for testing or when custom configuration is needed.
 *
 * @param {Object} options - Configuration options (reserved for future use)
 * @returns {ChromaDBService} A new ChromaDBService instance
 */
function createInstance(options = {}) {
  return new ChromaDBService(options);
}

/**
 * Reset the singleton instance (primarily for testing)
 *
 * This clears the singleton instance, allowing a fresh one to be created
 * on the next getInstance() call. Should be called with caution in production.
 * @returns {Promise<void>}
 */
async function resetInstance() {
  if (instance) {
    const oldInstance = instance;
    instance = null; // Clear reference first to prevent reuse during cleanup
    if (typeof oldInstance.cleanup === 'function') {
      try {
        await oldInstance.cleanup();
      } catch (err) {
        logger.warn('[ChromaDB] Error during reset cleanup:', err.message);
      }
    }
  }
}

module.exports = {
  // Main class export
  ChromaDBService,

  // Singleton pattern
  getInstance,
  createInstance,
  resetInstance,

  // Sub-modules for direct access if needed
  ChromaQueryCache,
  checkHealthViaHttp,
  checkHealthViaClient,
  isServerAvailable,
  createHealthCheckInterval,
};
