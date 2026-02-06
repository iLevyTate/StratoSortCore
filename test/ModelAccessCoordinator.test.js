/**
 * Tests for ModelAccessCoordinator
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })
}));

jest.mock('p-queue', () => {
  class MockQueue {
    constructor() {
      this.size = 0;
      this.concurrency = 1;
    }
    add(fn) {
      this.size += 1;
      const run = async () => {
        try {
          await fn();
        } finally {
          this.size = Math.max(0, this.size - 1);
        }
      };
      run();
    }
  }
  return { default: MockQueue };
});

const { ModelAccessCoordinator } = require('../src/main/services/ModelAccessCoordinator');

describe('ModelAccessCoordinator', () => {
  test('acquireLoadLock resolves and releases', async () => {
    const coordinator = new ModelAccessCoordinator();
    const release = await coordinator.acquireLoadLock('text');
    expect(typeof release).toBe('function');
    release();
  });

  test('acquireLoadLock rejects unknown model type', async () => {
    const coordinator = new ModelAccessCoordinator();
    await expect(coordinator.acquireLoadLock('unknown')).rejects.toThrow(/Unknown model type/);
  });

  test('acquireInferenceSlot tracks active operations', async () => {
    const coordinator = new ModelAccessCoordinator();
    const release = await coordinator.acquireInferenceSlot('op-1');
    expect(coordinator.getStatus().activeOperations).toBe(1);
    release();
    expect(coordinator.getStatus().activeOperations).toBe(0);
  });

  test('withModel executes operation and releases slot', async () => {
    const coordinator = new ModelAccessCoordinator();
    const result = await coordinator.withModel('text', async () => 'ok', {
      operationId: 'op-2'
    });
    expect(result).toBe('ok');
    expect(coordinator.getStatus().activeOperations).toBe(0);
  });

  test('acquireInferenceSlot throws when queue full', async () => {
    const coordinator = new ModelAccessCoordinator();
    coordinator._inferenceQueue.size = 100;
    await expect(coordinator.acquireInferenceSlot('op-3')).rejects.toThrow(/queue full/i);
  });
});
