/**
 * Tests for ServiceContainer
 * Tests dependency injection container with singleton/transient lifetime
 */

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('ServiceContainer', () => {
  let ServiceContainer;
  let container;
  let ServiceLifetime;
  let ServiceIds;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    const module = require('../src/main/services/ServiceContainer');
    ServiceContainer = module.ServiceContainer;
    ServiceLifetime = module.ServiceLifetime;
    ServiceIds = module.ServiceIds;

    // Create a fresh container for each test
    container = new ServiceContainer();
  });

  describe('registerSingleton', () => {
    test('registers a singleton service', () => {
      const factory = jest.fn(() => ({ name: 'test' }));

      container.registerSingleton('testService', factory);

      expect(container.has('testService')).toBe(true);
    });

    test('supports chaining', () => {
      const result = container
        .registerSingleton('service1', () => ({}))
        .registerSingleton('service2', () => ({}));

      expect(result).toBe(container);
    });

    test('throws for empty service name', () => {
      expect(() => container.registerSingleton('', () => ({}))).toThrow(
        'Service name must be a non-empty string'
      );
    });

    test('throws for non-function factory', () => {
      expect(() => container.registerSingleton('test', 'not a function')).toThrow(
        'must be a function'
      );
    });
  });

  describe('registerTransient', () => {
    test('registers a transient service', () => {
      container.registerTransient('testService', () => ({}));

      expect(container.has('testService')).toBe(true);
    });

    test('creates new instance for each resolve', () => {
      let counter = 0;
      container.registerTransient('counter', () => ({ id: ++counter }));

      const instance1 = container.resolve('counter');
      const instance2 = container.resolve('counter');

      expect(instance1.id).toBe(1);
      expect(instance2.id).toBe(2);
    });
  });

  describe('registerInstance', () => {
    test('registers pre-created instance', () => {
      const instance = { name: 'preCreated' };

      container.registerInstance('testService', instance);

      expect(container.resolve('testService')).toBe(instance);
    });

    test('throws for undefined instance', () => {
      expect(() => container.registerInstance('test', undefined)).toThrow('cannot be undefined');
    });
  });

  describe('resolve', () => {
    test('resolves a registered service', () => {
      container.registerSingleton('test', () => ({ name: 'test' }));

      const instance = container.resolve('test');

      expect(instance.name).toBe('test');
    });

    test('returns same instance for singleton', () => {
      container.registerSingleton('test', () => ({ id: Math.random() }));

      const instance1 = container.resolve('test');
      const instance2 = container.resolve('test');

      expect(instance1).toBe(instance2);
    });

    test('throws for unregistered service', () => {
      expect(() => container.resolve('unknown')).toThrow('is not registered');
    });

    test('detects circular dependencies', () => {
      container.registerSingleton('a', (c) => ({
        b: c.resolve('b')
      }));
      container.registerSingleton('b', (c) => ({
        a: c.resolve('a')
      }));

      expect(() => container.resolve('a')).toThrow('Circular dependency');
    });

    test('passes container to factory', () => {
      container.registerSingleton('config', () => ({ port: 3000 }));
      container.registerSingleton('server', (c) => ({
        config: c.resolve('config')
      }));

      const server = container.resolve('server');

      expect(server.config.port).toBe(3000);
    });

    test('throws when container is shutting down', async () => {
      container.registerSingleton('test', () => ({}));

      await container.shutdown();

      expect(() => container.resolve('test')).toThrow('shutting down');
    });
  });

  describe('resolveAsync', () => {
    test('resolves async factory', async () => {
      container.registerSingleton('asyncService', async () => {
        return { name: 'async' };
      });

      const instance = await container.resolveAsync('asyncService');

      expect(instance.name).toBe('async');
    });

    test('returns same instance for async singleton', async () => {
      let counter = 0;
      container.registerSingleton('async', async () => ({ id: ++counter }));

      const [instance1, instance2] = await Promise.all([
        container.resolveAsync('async'),
        container.resolveAsync('async')
      ]);

      // Both should get the same instance
      expect(instance1).toBe(instance2);
      expect(counter).toBe(1);
    });

    test('throws for unregistered service', async () => {
      await expect(container.resolveAsync('unknown')).rejects.toThrow('is not registered');
    });
  });

  describe('tryResolve', () => {
    test('returns instance for registered service', () => {
      container.registerSingleton('test', () => ({ name: 'test' }));

      const instance = container.tryResolve('test');

      expect(instance.name).toBe('test');
    });

    test('returns null for unregistered service', () => {
      const instance = container.tryResolve('unknown');

      expect(instance).toBeNull();
    });
  });

  describe('has', () => {
    test('returns true for registered service', () => {
      container.registerSingleton('test', () => ({}));

      expect(container.has('test')).toBe(true);
    });

    test('returns false for unregistered service', () => {
      expect(container.has('unknown')).toBe(false);
    });
  });

  describe('getRegisteredServices', () => {
    test('returns all registered service names', () => {
      container.registerSingleton('service1', () => ({}));
      container.registerSingleton('service2', () => ({}));

      const services = container.getRegisteredServices();

      expect(services).toContain('service1');
      expect(services).toContain('service2');
    });
  });

  describe('clearInstance', () => {
    test('clears singleton instance', () => {
      let counter = 0;
      container.registerSingleton('counter', () => ({ id: ++counter }));

      container.resolve('counter');
      container.clearInstance('counter');
      container.resolve('counter');

      expect(counter).toBe(2);
    });

    test('returns false for non-singleton', () => {
      container.registerTransient('test', () => ({}));

      const result = container.clearInstance('test');

      expect(result).toBe(false);
    });
  });

  describe('shutdown', () => {
    test('calls shutdown on services', async () => {
      const shutdown = jest.fn();
      container.registerSingleton('test', () => ({ shutdown }));
      container.resolve('test');

      await container.shutdown();

      expect(shutdown).toHaveBeenCalled();
    });

    test('calls cleanup on services', async () => {
      const cleanup = jest.fn();
      container.registerSingleton('test', () => ({ cleanup }));
      container.resolve('test');

      await container.shutdown();

      expect(cleanup).toHaveBeenCalled();
    });

    test('calls dispose on services', async () => {
      const dispose = jest.fn();
      container.registerSingleton('test', () => ({ dispose }));
      container.resolve('test');

      await container.shutdown();

      expect(dispose).toHaveBeenCalled();
    });

    test('handles errors during shutdown', async () => {
      container.registerSingleton('failing', () => ({
        shutdown: async () => {
          throw new Error('Shutdown failed');
        }
      }));
      container.resolve('failing');

      // Shutdown catches errors from individual services, so it should complete
      // But the shutdown method wraps in Promise.resolve, so sync throws may propagate
      // Let's just ensure the method completes without crashing the container
      await container.shutdown();

      // Container should be in shutdown state
      expect(container._isShuttingDown).toBe(true);
    });

    test('does not double shutdown', async () => {
      await container.shutdown();
      await container.shutdown();

      // No error thrown
    });

    test('clears all registrations', async () => {
      container.registerSingleton('test', () => ({}));

      await container.shutdown();

      expect(container.has('test')).toBe(false);
    });
  });

  describe('reset', () => {
    test('clears all registrations', () => {
      container.registerSingleton('test', () => ({}));
      container.resolve('test');

      container.reset();

      expect(container.has('test')).toBe(false);
    });

    test('allows reuse after shutdown', async () => {
      await container.shutdown();

      container.reset();
      container.registerSingleton('test', () => ({ name: 'new' }));

      expect(container.resolve('test').name).toBe('new');
    });
  });

  describe('ServiceLifetime', () => {
    test('defines SINGLETON', () => {
      expect(ServiceLifetime.SINGLETON).toBe('singleton');
    });

    test('defines TRANSIENT', () => {
      expect(ServiceLifetime.TRANSIENT).toBe('transient');
    });
  });

  describe('ServiceIds', () => {
    test('defines core service identifiers', () => {
      expect(ServiceIds.CHROMA_DB).toBe('chromaDb');
      expect(ServiceIds.SETTINGS).toBe('settings');
      expect(ServiceIds.FOLDER_MATCHING).toBe('folderMatching');
    });
  });

  describe('global container', () => {
    test('exports a global container instance', () => {
      const { container: globalContainer } = require('../src/main/services/ServiceContainer');

      expect(globalContainer).toBeInstanceOf(ServiceContainer);
    });
  });
});
