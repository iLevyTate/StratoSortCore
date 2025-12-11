/**
 * ServiceContainer - Dependency Injection Container
 *
 * This module provides a centralized dependency injection (DI) container for managing
 * service instances throughout the application. It supports:
 *
 * - Singleton services: Created once and shared across the application
 * - Transient services: Created fresh for each request
 * - Factory functions: Custom instantiation logic with dependency resolution
 * - Lazy initialization: Services are created only when first requested
 *
 * @example
 * // Register a singleton service
 * container.registerSingleton('chromaDb', () => new ChromaDBService());
 *
 * // Register with dependencies
 * container.registerSingleton('folderMatcher', (c) => {
 *   return new FolderMatchingService(c.resolve('chromaDb'));
 * });
 *
 * // Resolve a service
 * const chromaDb = container.resolve('chromaDb');
 *
 * @module ServiceContainer
 */

const { logger } = require('../../shared/logger');
logger.setContext('ServiceContainer');

/**
 * Service lifetime constants
 * @readonly
 * @enum {string}
 */
const ServiceLifetime = {
  /** Service is created once and reused for all requests */
  SINGLETON: 'singleton',
  /** Service is created fresh for each request */
  TRANSIENT: 'transient'
};

/**
 * Service registration entry
 * @typedef {Object} ServiceRegistration
 * @property {string} name - Service identifier
 * @property {Function} factory - Factory function to create the service
 * @property {ServiceLifetime} lifetime - Service lifetime (singleton or transient)
 * @property {*} [instance] - Cached instance for singletons
 * @property {boolean} [initializing] - Flag to detect circular dependencies
 */

/**
 * Dependency Injection Container
 *
 * Manages service registration, resolution, and lifecycle. Provides:
 * - Type-safe service registration with factory functions
 * - Automatic dependency resolution
 * - Singleton and transient lifetime support
 * - Circular dependency detection
 * - Graceful shutdown with cleanup
 *
 * @class ServiceContainer
 */
class ServiceContainer {
  constructor() {
    /**
     * Registry of all service registrations
     * @type {Map<string, ServiceRegistration>}
     * @private
     */
    this._registrations = new Map();

    /**
     * Resolution stack for circular dependency detection
     * @type {Set<string>}
     * @private
     */
    this._resolutionStack = new Set();

    /**
     * Flag indicating if container is shutting down
     * @type {boolean}
     * @private
     */
    this._isShuttingDown = false;

    /**
     * Initialization promises for async singletons
     * @type {Map<string, Promise<*>>}
     * @private
     */
    this._initPromises = new Map();
  }

  /**
   * Register a singleton service
   *
   * Singleton services are created once on first request and the same instance
   * is returned for all subsequent requests. Use this for stateful services
   * that should be shared across the application.
   *
   * @param {string} name - Unique service identifier
   * @param {Function} factory - Factory function that receives the container and returns the service instance
   * @returns {ServiceContainer} The container instance for chaining
   *
   * @example
   * container.registerSingleton('database', (c) => {
   *   return new DatabaseService(c.resolve('config'));
   * });
   */
  registerSingleton(name, factory) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Service name must be a non-empty string');
    }
    if (typeof factory !== 'function') {
      throw new Error(`Factory for service '${name}' must be a function`);
    }

    this._registrations.set(name, {
      name,
      factory,
      lifetime: ServiceLifetime.SINGLETON,
      instance: null,
      initializing: false
    });

    logger.debug(`[ServiceContainer] Registered singleton: ${name}`);
    return this;
  }

  /**
   * Register a transient service
   *
   * Transient services are created fresh for each request. Use this for
   * stateless services or when you need a new instance each time.
   *
   * @param {string} name - Unique service identifier
   * @param {Function} factory - Factory function that receives the container and returns a new service instance
   * @returns {ServiceContainer} The container instance for chaining
   *
   * @example
   * container.registerTransient('httpClient', () => {
   *   return new HttpClient();
   * });
   */
  registerTransient(name, factory) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Service name must be a non-empty string');
    }
    if (typeof factory !== 'function') {
      throw new Error(`Factory for service '${name}' must be a function`);
    }

    this._registrations.set(name, {
      name,
      factory,
      lifetime: ServiceLifetime.TRANSIENT
    });

    logger.debug(`[ServiceContainer] Registered transient: ${name}`);
    return this;
  }

  /**
   * Register an existing instance as a singleton
   *
   * Use this to register pre-created instances or external dependencies
   * that were created outside the container.
   *
   * @param {string} name - Unique service identifier
   * @param {*} instance - The pre-created service instance
   * @returns {ServiceContainer} The container instance for chaining
   *
   * @example
   * const existingDb = new Database();
   * container.registerInstance('database', existingDb);
   */
  registerInstance(name, instance) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Service name must be a non-empty string');
    }
    if (instance === undefined) {
      throw new Error(`Instance for service '${name}' cannot be undefined`);
    }

    this._registrations.set(name, {
      name,
      factory: () => instance,
      lifetime: ServiceLifetime.SINGLETON,
      instance,
      initializing: false
    });

    logger.debug(`[ServiceContainer] Registered instance: ${name}`);
    return this;
  }

  /**
   * Resolve a service by name
   *
   * Returns the service instance, creating it if necessary for singletons
   * or always creating a new instance for transient services.
   *
   * @param {string} name - The service identifier to resolve
   * @returns {*} The resolved service instance
   * @throws {Error} If service is not registered or circular dependency detected
   *
   * @example
   * const db = container.resolve('database');
   */
  resolve(name) {
    if (this._isShuttingDown) {
      throw new Error(`Cannot resolve service '${name}' - container is shutting down`);
    }

    const registration = this._registrations.get(name);
    if (!registration) {
      throw new Error(
        `Service '${name}' is not registered. Available services: ${Array.from(this._registrations.keys()).join(', ')}`
      );
    }

    // Check for circular dependencies
    if (this._resolutionStack.has(name)) {
      const chain = `${Array.from(this._resolutionStack).join(' -> ')} -> ${name}`;
      throw new Error(`Circular dependency detected while resolving '${name}': ${chain}`);
    }

    // For singletons, return cached instance if available
    if (registration.lifetime === ServiceLifetime.SINGLETON && registration.instance !== null) {
      return registration.instance;
    }

    // Track resolution for circular dependency detection
    this._resolutionStack.add(name);

    try {
      // Create instance using factory
      const instance = registration.factory(this);

      // Cache singleton instances
      if (registration.lifetime === ServiceLifetime.SINGLETON) {
        registration.instance = instance;
        logger.debug(`[ServiceContainer] Created singleton instance: ${name}`);
      } else {
        logger.debug(`[ServiceContainer] Created transient instance: ${name}`);
      }

      return instance;
    } finally {
      this._resolutionStack.delete(name);
    }
  }

  /**
   * Resolve a service asynchronously
   *
   * Similar to resolve() but supports async factory functions and
   * returns a Promise. Useful for services that require async initialization.
   *
   * @param {string} name - The service identifier to resolve
   * @returns {Promise<*>} Promise resolving to the service instance
   *
   * @example
   * const db = await container.resolveAsync('database');
   */
  async resolveAsync(name) {
    if (this._isShuttingDown) {
      throw new Error(`Cannot resolve service '${name}' - container is shutting down`);
    }

    const registration = this._registrations.get(name);
    if (!registration) {
      throw new Error(
        `Service '${name}' is not registered. Available services: ${Array.from(this._registrations.keys()).join(', ')}`
      );
    }

    // For singletons, check for in-progress initialization
    if (registration.lifetime === ServiceLifetime.SINGLETON) {
      // Return cached instance if available
      if (registration.instance !== null) {
        return registration.instance;
      }

      // Return existing init promise if in progress
      if (this._initPromises.has(name)) {
        return this._initPromises.get(name);
      }
    }

    // Check for circular dependencies
    if (this._resolutionStack.has(name)) {
      const chain = `${Array.from(this._resolutionStack).join(' -> ')} -> ${name}`;
      throw new Error(`Circular dependency detected while resolving '${name}': ${chain}`);
    }

    // Track resolution
    this._resolutionStack.add(name);

    try {
      // Create initialization promise for singletons
      const initPromise = (async () => {
        const instance = await registration.factory(this);

        // Cache singleton instances
        if (registration.lifetime === ServiceLifetime.SINGLETON) {
          registration.instance = instance;
          this._initPromises.delete(name);
          logger.debug(`[ServiceContainer] Created async singleton: ${name}`);
        } else {
          logger.debug(`[ServiceContainer] Created async transient: ${name}`);
        }

        return instance;
      })();

      // Store init promise for singletons to prevent duplicate initialization
      if (registration.lifetime === ServiceLifetime.SINGLETON) {
        this._initPromises.set(name, initPromise);
      }

      return await initPromise;
    } finally {
      this._resolutionStack.delete(name);
    }
  }

  /**
   * Try to resolve a service, returning null if not found
   *
   * @param {string} name - The service identifier to resolve
   * @returns {*|null} The resolved service instance or null if not found
   */
  tryResolve(name) {
    try {
      return this.resolve(name);
    } catch {
      return null;
    }
  }

  /**
   * Check if a service is registered
   *
   * @param {string} name - The service identifier to check
   * @returns {boolean} True if the service is registered
   */
  has(name) {
    return this._registrations.has(name);
  }

  /**
   * Get all registered service names
   *
   * @returns {string[]} Array of registered service names
   */
  getRegisteredServices() {
    return Array.from(this._registrations.keys());
  }

  /**
   * Clear a singleton instance (for testing or reconfiguration)
   *
   * @param {string} name - The service identifier to clear
   * @returns {boolean} True if the instance was cleared
   */
  clearInstance(name) {
    const registration = this._registrations.get(name);
    if (registration && registration.lifetime === ServiceLifetime.SINGLETON) {
      registration.instance = null;
      this._initPromises.delete(name);
      logger.debug(`[ServiceContainer] Cleared singleton instance: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * Shutdown the container and all services
   *
   * Calls shutdown/cleanup methods on all singleton services that implement them.
   * Should be called when the application is closing.
   *
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (this._isShuttingDown) {
      logger.warn('[ServiceContainer] Shutdown already in progress');
      return;
    }

    this._isShuttingDown = true;
    logger.info('[ServiceContainer] Starting shutdown...');

    const shutdownPromises = [];

    for (const [name, registration] of this._registrations) {
      if (registration.lifetime === ServiceLifetime.SINGLETON && registration.instance !== null) {
        const instance = registration.instance;

        // Try to call shutdown or cleanup methods
        if (typeof instance.shutdown === 'function') {
          logger.debug(`[ServiceContainer] Calling shutdown on: ${name}`);
          shutdownPromises.push(
            Promise.resolve(instance.shutdown()).catch((error) => {
              logger.error(`[ServiceContainer] Error shutting down ${name}:`, error);
            })
          );
        } else if (typeof instance.cleanup === 'function') {
          logger.debug(`[ServiceContainer] Calling cleanup on: ${name}`);
          shutdownPromises.push(
            Promise.resolve(instance.cleanup()).catch((error) => {
              logger.error(`[ServiceContainer] Error cleaning up ${name}:`, error);
            })
          );
        } else if (typeof instance.dispose === 'function') {
          logger.debug(`[ServiceContainer] Calling dispose on: ${name}`);
          shutdownPromises.push(
            Promise.resolve(instance.dispose()).catch((error) => {
              logger.error(`[ServiceContainer] Error disposing ${name}:`, error);
            })
          );
        }
      }
    }

    // Wait for all shutdown operations
    await Promise.allSettled(shutdownPromises);

    // Clear all registrations
    this._registrations.clear();
    this._initPromises.clear();
    this._resolutionStack.clear();

    logger.info('[ServiceContainer] Shutdown complete');
  }

  /**
   * Reset the container (for testing)
   *
   * Clears all registrations and instances without calling shutdown methods.
   */
  reset() {
    this._registrations.clear();
    this._initPromises.clear();
    this._resolutionStack.clear();
    this._isShuttingDown = false;
    logger.debug('[ServiceContainer] Container reset');
  }
}

// Create and export the global container instance
const container = new ServiceContainer();

/**
 * Service identifiers for type-safe resolution
 * Only includes services that are registered with the container via ServiceIntegration.
 * Other services (OllamaService, ParallelEmbeddingService, etc.) use their own
 * singleton patterns and should be accessed via their respective getInstance() methods.
 * @readonly
 * @enum {string}
 */
const ServiceIds = {
  // Core services
  CHROMA_DB: 'chromaDb',
  SETTINGS: 'settings',

  // AI/Embedding services
  OLLAMA_SERVICE: 'ollamaService',
  OLLAMA_CLIENT: 'ollamaClient',
  PARALLEL_EMBEDDING: 'parallelEmbedding',
  EMBEDDING_CACHE: 'embeddingCache',

  // Analysis services
  FOLDER_MATCHING: 'folderMatching',
  ORGANIZATION_SUGGESTION: 'organizationSuggestion',
  AUTO_ORGANIZE: 'autoOrganize',

  // State services
  ANALYSIS_HISTORY: 'analysisHistory',
  UNDO_REDO: 'undoRedo',
  PROCESSING_STATE: 'processingState'
};

module.exports = {
  ServiceContainer,
  container,
  ServiceLifetime,
  ServiceIds
};
