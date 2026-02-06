describe('batchLockManager', () => {
  test('acquire and release lock', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const {
      acquireBatchLock,
      releaseBatchLock
    } = require('../src/main/ipc/files/batchLockManager');

    const acquired = await acquireBatchLock('batch-1', 1000);
    expect(acquired).toBe(true);

    const waiterPromise = acquireBatchLock('batch-2', 1000);
    releaseBatchLock('batch-1');
    jest.runOnlyPendingTimers();
    const waiter = await waiterPromise;
    expect(waiter).toBe(true);
    jest.useRealTimers();
  });
});
