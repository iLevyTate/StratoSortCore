jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(),
  mkdir: jest.fn().mockResolvedValue()
};

jest.mock('fs', () => ({
  promises: mockFs
}));

const { FileOperationTracker } = require('../src/shared/fileOperationTracker');

describe('FileOperationTracker', () => {
  beforeEach(() => {
    mockFs.readFile.mockReset();
    mockFs.writeFile.mockReset();
    mockFs.mkdir.mockReset();
  });

  test('recordOperation and wasRecentlyOperated respect cooldown', () => {
    jest.useFakeTimers();
    const tracker = new FileOperationTracker({ cooldownMs: 1000 });

    tracker.recordOperation('C:\\file.txt', 'move', 'watcher');
    expect(tracker.wasRecentlyOperated('C:\\file.txt')).toBe(true);

    jest.advanceTimersByTime(1001);
    expect(tracker.wasRecentlyOperated('C:\\file.txt')).toBe(false);
    jest.useRealTimers();
  });

  test('wasRecentlyOperated excludes source', () => {
    const tracker = new FileOperationTracker({ cooldownMs: 1000 });
    tracker.recordOperation('C:\\file.txt', 'move', 'watcher');
    expect(tracker.wasRecentlyOperated('C:\\file.txt', 'watcher')).toBe(false);
  });

  test('initialize loads persisted operations within cooldown', async () => {
    const now = Date.now();
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify([
        { path: 'c:\\file.txt', timestamp: now, operationType: 'move', source: 'persisted' }
      ])
    );

    const tracker = new FileOperationTracker({
      cooldownMs: 5000,
      persistencePath: 'C:\\ops.json'
    });
    await tracker.initialize();

    expect(tracker.wasRecentlyOperated('C:\\file.txt')).toBe(true);
  });

  test('shutdown persists remaining operations', async () => {
    const tracker = new FileOperationTracker({
      cooldownMs: 5000,
      persistencePath: 'C:\\ops.json'
    });
    tracker.recordOperation('C:\\file.txt', 'move', 'watcher');
    await tracker.shutdown();
    expect(mockFs.writeFile).toHaveBeenCalled();
  });
});
