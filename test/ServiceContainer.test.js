/**
 * Tests for ServiceContainer
 */

jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  },
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

const { ServiceContainer, ServiceLifetime } = require('../src/main/services/ServiceContainer');

describe('ServiceContainer', () => {
  test('registerSingleton validates inputs', () => {
    const container = new ServiceContainer();
    expect(() => container.registerSingleton('', () => {})).toThrow();
    expect(() => container.registerSingleton('svc', null)).toThrow();
  });

  test('registerTransient validates inputs', () => {
    const container = new ServiceContainer();
    expect(() => container.registerTransient('', () => {})).toThrow();
    expect(() => container.registerTransient('svc', null)).toThrow();
  });

  test('registerInstance validates inputs', () => {
    const container = new ServiceContainer();
    expect(() => container.registerInstance('', {})).toThrow();
    expect(() => container.registerInstance('svc', undefined)).toThrow();
  });

  test('resolve returns singleton instance', () => {
    const container = new ServiceContainer();
    const instance = { name: 'singleton' };
    container.registerSingleton('svc', () => instance);
    expect(container.resolve('svc')).toBe(instance);
    expect(container.resolve('svc')).toBe(instance);
  });

  test('resolve returns new transient instances', () => {
    const container = new ServiceContainer();
    container.registerTransient('svc', () => ({ id: Math.random() }));
    const first = container.resolve('svc');
    const second = container.resolve('svc');
    expect(first).not.toBe(second);
  });

  test('resolve throws for missing service', () => {
    const container = new ServiceContainer();
    container.registerSingleton('known', () => ({}));
    expect(() => container.resolve('missing')).toThrow(/known/);
  });

  test('detects circular dependencies', () => {
    const container = new ServiceContainer();
    container.registerSingleton('a', (c) => c.resolve('b'));
    container.registerSingleton('b', (c) => c.resolve('a'));
    expect(() => container.resolve('a')).toThrow(/Circular dependency/);
  });

  test('resolveAsync caches singleton instance', async () => {
    const container = new ServiceContainer();
    const instance = { name: 'async' };
    container.registerSingleton('svc', async () => instance);
    const first = await container.resolveAsync('svc');
    const second = await container.resolveAsync('svc');
    expect(first).toBe(instance);
    expect(second).toBe(instance);
  });

  test('resolveAsync detects circular dependencies', async () => {
    const container = new ServiceContainer();
    container.registerSingleton('a', async (c) => {
      const b = await c.resolveAsync('b');
      return { b };
    });
    container.registerSingleton('b', async (c) => {
      const a = await c.resolveAsync('a');
      return { a };
    });
    await expect(container.resolveAsync('a')).rejects.toThrow(/Circular dependency/);
  });

  test('resolveAsync allows concurrent unrelated resolutions', async () => {
    const container = new ServiceContainer();
    container.registerSingleton('x', async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { name: 'x' };
    });
    container.registerSingleton('y', async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { name: 'y' };
    });
    const [x, y] = await Promise.all([container.resolveAsync('x'), container.resolveAsync('y')]);
    expect(x).toEqual({ name: 'x' });
    expect(y).toEqual({ name: 'y' });
  });

  test('resolveAsync deduplicates concurrent calls to the same singleton', async () => {
    const container = new ServiceContainer();
    let callCount = 0;
    container.registerSingleton('svc', async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 10));
      return { id: 1 };
    });
    const [first, second] = await Promise.all([
      container.resolveAsync('svc'),
      container.resolveAsync('svc')
    ]);
    expect(first).toBe(second);
    expect(callCount).toBe(1);
  });

  test('clearInstance refuses during async resolution', async () => {
    const container = new ServiceContainer();
    let resolveFactory;
    const promise = new Promise((resolve) => {
      resolveFactory = resolve;
    });
    container.registerSingleton('svc', async () => {
      await promise;
      return { ok: true };
    });
    const asyncResolve = container.resolveAsync('svc');
    const cleared = container.clearInstance('svc');
    expect(cleared).toBe(false);
    resolveFactory();
    await asyncResolve;
  });

  test('shutdown calls cleanup/shutdown/dispose', async () => {
    const container = new ServiceContainer();
    const withCleanup = { cleanup: jest.fn() };
    const withShutdown = { shutdown: jest.fn() };
    const withDispose = { dispose: jest.fn() };

    container.registerSingleton('one', () => withCleanup);
    container.registerSingleton('two', () => withShutdown);
    container.registerSingleton('three', () => withDispose);

    container.resolve('one');
    container.resolve('two');
    container.resolve('three');

    await container.shutdown(['two', 'one', 'three']);

    expect(withCleanup.cleanup).toHaveBeenCalled();
    expect(withShutdown.shutdown).toHaveBeenCalled();
    expect(withDispose.dispose).toHaveBeenCalled();
    expect(container.getRegisteredServices()).toHaveLength(0);
  });
});
