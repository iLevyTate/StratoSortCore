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
  createHealthCheckInterval
} = require('./ChromaHealthChecker');
const { logger } = require('../../../shared/logger');

// Export the core class as ChromaDBService for backward compatibility
const ChromaDBService = ChromaDBServiceCore;

// Singleton management - delegates to DI container when available
let _localInstance = null;
let _containerRegistered = false;

/**
 * Get the singleton ChromaDBService instance
 *
 * This function provides backward compatibility while the DI container
 * is the single source of truth for singleton instances.
 *
 * @example
 * // Using ServiceContainer (recommended)
 * const { container, ServiceIds } = require('../ServiceContainer');
 * const chromaDb = container.resolve(ServiceIds.CHROMA_DB);
 *
 * // Using getInstance (backward compatible)
 * const { getInstance } = require('./chromadb');
 * const chromaDb = getInstance();
 *
 * @returns {ChromaDBService} The singleton instance
 */
function getInstance() {
  // Try to get from DI container first (preferred)
  try {
    const { container, ServiceIds } = require('../ServiceContainer');
    if (container.has(ServiceIds.CHROMA_DB)) {
      return container.resolve(ServiceIds.CHROMA_DB);
    }
  } catch {
    // Container not available yet, use local instance
  }

  // Fallback to local instance for early startup or testing
  if (!_localInstance) {
    _localInstance = new ChromaDBService();
  }
  return _localInstance;
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
 * Register this service with the DI container
 * Called by ServiceIntegration during initialization
 * @param {ServiceContainer} container - The DI container
 * @param {string} serviceId - The service identifier
 */
function registerWithContainer(container, serviceId) {
  if (_containerRegistered) return;

  container.registerSingleton(serviceId, () => {
    // If we have a local instance, migrate it to the container
    if (_localInstance) {
      const instance = _localInstance;
      _localInstance = null; // Clear local reference
      return instance;
    }
    return new ChromaDBService();
  });
  _containerRegistered = true;
  logger.debug('[ChromaDB] Registered with DI container');
}

/**
 * Reset the singleton instance (primarily for testing)
 *
 * This clears the singleton instance, allowing a fresh one to be created
 * on the next getInstance() call. Should be called with caution in production.
 * @returns {Promise<void>}
 */
async function resetInstance() {
  // Reset container registration flag
  _containerRegistered = false;

  // Clear from DI container if registered
  try {
    const { container, ServiceIds } = require('../ServiceContainer');
    if (container.has(ServiceIds.CHROMA_DB)) {
      const instance = container.tryResolve(ServiceIds.CHROMA_DB);
      container.clearInstance(ServiceIds.CHROMA_DB);
      if (instance && typeof instance.cleanup === 'function') {
        try {
          await instance.cleanup();
        } catch (e) {
          logger.warn('[ChromaDB] Error during container instance cleanup:', e.message);
        }
      }
    }
  } catch {
    // Container not available
  }

  // Also clear local instance
  if (_localInstance) {
    const oldInstance = _localInstance;
    _localInstance = null;
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
  registerWithContainer,

  // Sub-modules for direct access if needed
  ChromaQueryCache,
  checkHealthViaHttp,
  checkHealthViaClient,
  isServerAvailable,
  createHealthCheckInterval
};
