/**
 * Singleton Factory
 *
 * Provides a reusable pattern for creating singleton services with:
 * - DI container integration
 * - Local fallback for early startup/testing
 * - Instance migration from local to container
 * - Proper cleanup on reset
 *
 * Eliminates ~60-80 lines of boilerplate per service.
 *
 * @module shared/singletonFactory
 *
 * @example
 * // In a service file (e.g., MyService.js)
 * const { createSingletonHelpers } = require('../../shared/singletonFactory');
 * const MyServiceClass = require('./MyServiceClass');
 *
 * const {
 *   getInstance,
 *   createInstance,
 *   registerWithContainer,
 *   resetInstance
 * } = createSingletonHelpers({
 *   ServiceClass: MyServiceClass,
 *   serviceId: 'MY_SERVICE',
 *   serviceName: 'MyService',
 *   containerPath: './ServiceContainer',
 *   shutdownMethod: 'shutdown' // or 'cleanup'
 * });
 *
 * module.exports = { MyService: MyServiceClass, getInstance, ... };
 */

const { logger } = require('./logger');

/**
 * Get a Node-style require that bypasses Webpack static analysis when bundled.
 * In Electron main, Webpack exposes __non_webpack_require__ for this purpose.
 * FIX: Replaced eval('require') with safer alternatives to eliminate security risk.
 */
function getNodeRequire() {
  /* global __non_webpack_require__ */
  // Webpack's escape hatch for dynamic require in bundled code
  if (typeof __non_webpack_require__ !== 'undefined') {
    return __non_webpack_require__;
  }
  // In Node.js/Electron main process, require is available on global
  if (typeof global !== 'undefined' && typeof global.require === 'function') {
    return global.require;
  }
  // CommonJS module's own require function
  if (typeof module !== 'undefined' && typeof module.require === 'function') {
    return module.require.bind(module);
  }
  // Last resort: direct require (works in non-bundled Node.js)
  // eslint-disable-next-line
  if (typeof __webpack_require__ === 'undefined' && typeof require === 'function') {
    return require;
  }
  throw new Error('Cannot access Node.js require - running in unsupported environment');
}

/**
 * Create singleton helper functions for a service
 *
 * @param {Object} options - Configuration options
 * @param {Function} options.ServiceClass - The service class constructor
 * @param {string} options.serviceId - ServiceIds enum key (e.g., 'CHROMA_DB')
 * @param {string} options.serviceName - Human-readable name for logging
 * @param {string} options.containerPath - Relative path to ServiceContainer from caller
 * @param {string} options.shutdownMethod - Method to call on cleanup ('shutdown' or 'cleanup')
 * @param {Function} options.createFactory - Optional custom factory function for creating instances
 * @returns {Object} Object with getInstance, createInstance, registerWithContainer, resetInstance
 */
function createSingletonHelpers(options) {
  const {
    ServiceClass,
    serviceId,
    serviceName,
    containerPath = './ServiceContainer',
    shutdownMethod = 'shutdown',
    createFactory = null
  } = options;

  // Module-level state (closure)
  let _localInstance = null;
  let _containerRegistered = false;
  // FIX: Add pending promise for concurrent getInstance() calls to prevent race condition
  // Two concurrent calls could both pass the if (!_localInstance) check and create duplicates
  let _pendingInstance = null;

  /**
   * Get or create the singleton instance
   * FIX: Thread-safe using promise deduplication pattern for async factories
   * Maintains synchronous return for sync factories (backward compatible)
   * @param {Object} instanceOptions - Options passed to constructor
   * @returns {Object|Promise<Object>} The singleton instance or promise resolving to it
   */
  function getInstance(instanceOptions = {}) {
    // Try to get from DI container first (preferred)
    try {
      const dynamicRequire = getNodeRequire();
      const { container, ServiceIds } = dynamicRequire(containerPath);
      if (container.has(ServiceIds[serviceId])) {
        return container.resolve(ServiceIds[serviceId]);
      }
    } catch {
      // Container not available yet, use local instance
    }

    // FIX: Fast path - return existing instance immediately
    if (_localInstance) {
      return _localInstance;
    }

    // FIX: If initialization is in progress (async factory), return pending promise
    // This ensures all concurrent callers wait for the same instance
    if (_pendingInstance) {
      return _pendingInstance;
    }

    // Create the instance
    const instance = createFactory
      ? createFactory(instanceOptions)
      : new ServiceClass(instanceOptions);

    // FIX: Handle both sync and async factory results
    // For sync factories, return synchronously (backward compatible)
    // For async factories, wrap in promise deduplication to prevent race conditions
    if (instance && typeof instance.then === 'function') {
      // Async factory - use promise deduplication
      _pendingInstance = Promise.resolve(instance)
        .then((resolvedInstance) => {
          _localInstance = resolvedInstance;
          _pendingInstance = null;
          return resolvedInstance;
        })
        .catch((error) => {
          // On failure, clear pending so next call can retry
          _pendingInstance = null;
          throw error;
        });
      return _pendingInstance;
    }

    // Sync factory - return immediately (backward compatible)
    _localInstance = instance;
    return _localInstance;
  }

  /**
   * Create a new instance (not tied to singleton)
   * @param {Object} instanceOptions - Options passed to constructor
   * @returns {Object} A new instance
   */
  function createInstance(instanceOptions = {}) {
    return createFactory ? createFactory(instanceOptions) : new ServiceClass(instanceOptions);
  }

  /**
   * Register this service with the DI container
   * FIX: Made idempotent using container.has() as authoritative source of truth
   * This prevents race conditions where two calls both pass the _containerRegistered check
   * @param {Object} container - The DI container
   * @param {string} registrationId - The service identifier
   */
  function registerWithContainer(container, registrationId) {
    // FIX: Use container.has() as the atomic check - it's the source of truth
    // This handles cases where another module registered the service first
    // Note: Check if has() exists for backward compatibility with mock containers
    if (typeof container.has === 'function' && container.has(registrationId)) {
      _containerRegistered = true;
      return;
    }

    // Also check our local flag for performance (avoids redundant has() calls)
    if (_containerRegistered) return;

    container.registerSingleton(registrationId, () => {
      // FIX: If there's a pending async instance being created, wait for it
      // This prevents creating duplicate instances when registerWithContainer is called
      // while an async factory is still initializing
      if (_pendingInstance) {
        return _pendingInstance;
      }

      // If we have a local instance, migrate it to the container
      if (_localInstance) {
        const instance = _localInstance;
        _localInstance = null; // Clear local reference
        return instance;
      }
      return createFactory ? createFactory() : new ServiceClass();
    });

    _containerRegistered = true;
    logger.debug(`[${serviceName}] Registered with DI container`);
  }

  /**
   * Reset the singleton instance (for testing)
   * @returns {Promise<void>}
   */
  async function resetInstance() {
    // Reset container registration flag
    _containerRegistered = false;

    // FIX: Clear pending instance promise to ensure clean reset
    _pendingInstance = null;

    // Clear from DI container if registered
    try {
      const dynamicRequire = getNodeRequire();
      const { container, ServiceIds } = dynamicRequire(containerPath);
      if (container.has(ServiceIds[serviceId])) {
        const instance = container.tryResolve(ServiceIds[serviceId]);
        container.clearInstance(ServiceIds[serviceId]);
        if (instance && typeof instance[shutdownMethod] === 'function') {
          try {
            await instance[shutdownMethod]();
          } catch (e) {
            logger.warn(`[${serviceName}] Error during container instance cleanup:`, e.message);
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
      if (typeof oldInstance[shutdownMethod] === 'function') {
        try {
          await oldInstance[shutdownMethod]();
        } catch (e) {
          logger.warn(`[${serviceName}] Error during reset cleanup:`, e.message);
        }
      }
    }
  }

  /**
   * Check if container is registered (for testing)
   * @returns {boolean}
   */
  function isContainerRegistered() {
    return _containerRegistered;
  }

  /**
   * Get local instance directly (for testing)
   * @returns {Object|null}
   */
  function getLocalInstance() {
    return _localInstance;
  }

  return {
    getInstance,
    createInstance,
    registerWithContainer,
    resetInstance,
    // Testing helpers
    isContainerRegistered,
    getLocalInstance
  };
}

module.exports = { createSingletonHelpers };
