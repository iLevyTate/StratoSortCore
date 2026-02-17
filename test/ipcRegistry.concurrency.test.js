jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

describe('ipcRegistry concurrency and shutdown gate', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('waitForInFlightOperations tracks multiple concurrent handlers', async () => {
    const {
      registerHandler,
      waitForInFlightOperations,
      setShuttingDown
    } = require('../src/main/core/ipcRegistry');

    setShuttingDown(false);

    const handlers = {};
    const ipcMain = {
      handle: jest.fn((channel, handler) => {
        handlers[channel] = handler;
      }),
      removeHandler: jest.fn(),
      on: jest.fn(),
      removeListener: jest.fn()
    };

    const pendingResolves = [];
    registerHandler(ipcMain, 'concurrent:handler', async () => {
      return await new Promise((resolve) => pendingResolves.push(resolve));
    });

    const wrapped = handlers['concurrent:handler'];
    const p1 = wrapped({}, { id: 1 });
    const p2 = wrapped({}, { id: 2 });
    const p3 = wrapped({}, { id: 3 });

    const drainWhileBusy = waitForInFlightOperations(40);
    await expect(drainWhileBusy).resolves.toBe(false);

    pendingResolves.forEach((resolve) => resolve({ success: true }));
    await Promise.all([p1, p2, p3]);
    await expect(waitForInFlightOperations(100)).resolves.toBe(true);
  });

  test('async listeners are counted in-flight and blocked once shutdown starts', async () => {
    const {
      registerListener,
      waitForInFlightOperations,
      setShuttingDown
    } = require('../src/main/core/ipcRegistry');

    const listeners = {};
    const ipcMain = {
      handle: jest.fn(),
      removeHandler: jest.fn(),
      on: jest.fn((channel, listener) => {
        listeners[channel] = listener;
      }),
      removeListener: jest.fn()
    };

    let releaseListener;
    const originalListener = jest.fn(
      async () =>
        await new Promise((resolve) => {
          releaseListener = resolve;
        })
    );

    setShuttingDown(false);
    registerListener(ipcMain, 'listener:async', originalListener);
    const wrapped = listeners['listener:async'];

    const inFlightPromise = wrapped({}, { payload: 1 });
    const drainWhileBusy = waitForInFlightOperations(40);
    await expect(drainWhileBusy).resolves.toBe(false);

    releaseListener();
    await inFlightPromise;
    await expect(waitForInFlightOperations(100)).resolves.toBe(true);

    setShuttingDown(true);
    wrapped({}, { payload: 2 });
    expect(originalListener).toHaveBeenCalledTimes(1);

    setShuttingDown(false);
  });
});
