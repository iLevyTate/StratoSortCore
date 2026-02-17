/**
 * Race-condition and shutdown tests for ServiceContainer.
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

const { ServiceContainer } = require('../src/main/services/ServiceContainer');

describe('ServiceContainer race and shutdown behavior', () => {
  test('discards async singleton resolved during shutdown and runs cleanup', async () => {
    const container = new ServiceContainer();
    let releaseFactory;
    const gate = new Promise((resolve) => {
      releaseFactory = resolve;
    });
    const cleanup = jest.fn().mockResolvedValue(undefined);

    container.registerSingleton('slowService', async () => {
      await gate;
      return { cleanup };
    });

    const resolvePromise = container.resolveAsync('slowService');
    const shutdownPromise = container.shutdown([]);

    releaseFactory();
    const resolvedInstance = await resolvePromise;
    await shutdownPromise;

    expect(resolvedInstance).toBeNull();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(container.getRegisteredServices()).toEqual([]);
  });

  test('resolveAsync rejects once container is shutting down', async () => {
    const container = new ServiceContainer();
    container.registerSingleton('svc', async () => ({ ok: true }));

    await container.shutdown([]);

    await expect(container.resolveAsync('svc')).rejects.toThrow(
      "Cannot resolve service 'svc' - container is shutting down"
    );
  });

  test('failed async singleton initialization does not leave stale init promise', async () => {
    const container = new ServiceContainer();
    let attempts = 0;

    container.registerSingleton('failingSvc', async () => {
      attempts += 1;
      throw new Error('factory failed');
    });

    await expect(container.resolveAsync('failingSvc')).rejects.toThrow('factory failed');
    await expect(container.resolveAsync('failingSvc')).rejects.toThrow('factory failed');

    // If _initPromises cleanup fails, second call would not re-enter factory.
    expect(attempts).toBe(2);
  });
});
