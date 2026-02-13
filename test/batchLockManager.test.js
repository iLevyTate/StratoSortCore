describe('batchLockManager', () => {
  beforeEach(() => {
    jest.resetModules();
  });

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
    releaseBatchLock('batch-2');
    jest.useRealTimers();
  });

  test('release by non-holder batch does not unlock', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const {
      acquireBatchLock,
      releaseBatchLock
    } = require('../src/main/ipc/files/batchLockManager');

    const acquired = await acquireBatchLock('batch-holder', 1000);
    expect(acquired).toBe(true);

    const waiterPromise = acquireBatchLock('batch-waiter', 1000);
    releaseBatchLock('wrong-batch-id');

    // Waiter should still be blocked until actual holder releases.
    jest.advanceTimersByTime(50);
    let settled = false;
    waiterPromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseBatchLock('batch-holder');
    jest.runOnlyPendingTimers();
    await expect(waiterPromise).resolves.toBe(true);
    releaseBatchLock('batch-waiter');
    jest.useRealTimers();
  });

  test('force-releases stale lock when held past timeout', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const {
      acquireBatchLock,
      releaseBatchLock
    } = require('../src/main/ipc/files/batchLockManager');

    await acquireBatchLock('stale-batch', 10000);
    // Advance time past BATCH_LOCK_TIMEOUT (5 min)
    jest.advanceTimersByTime(6 * 60 * 1000);

    // New batch should acquire immediately (stale was force-released)
    const acquired = await acquireBatchLock('new-batch', 1000);
    expect(acquired).toBe(true);
    releaseBatchLock('new-batch');
    jest.useRealTimers();
  });

  test('acquireBatchLock retries until acquired', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const {
      acquireBatchLock,
      releaseBatchLock
    } = require('../src/main/ipc/files/batchLockManager');

    await acquireBatchLock('holder', 100);
    const waiterPromise = acquireBatchLock('waiter', 100);
    // Advance past first attempt timeout
    jest.advanceTimersByTime(150);
    releaseBatchLock('holder');
    jest.runOnlyPendingTimers();
    const result = await waiterPromise;
    expect(result).toBe(true);
    releaseBatchLock('waiter');
    jest.useRealTimers();
  });
});
