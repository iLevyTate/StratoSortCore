/**
 * @jest-environment node
 */

const mockFileSizes = new Map();

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/test/userData')
  }
}));

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(async (filePath, content) => {
      mockFileSizes.set(filePath, Buffer.byteLength(content));
    }),
    rename: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
    mkdir: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn(async (filePath) => ({ size: mockFileSizes.get(filePath) ?? 0 }))
  }
}));

jest.mock('../src/shared/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })),
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  }
}));

const fs = require('fs').promises;
const { PatternPersistence } = require('../src/main/services/organization/persistence');

describe('PatternPersistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFileSizes.clear();
  });

  it('does not throttle the first save', async () => {
    const persistence = new PatternPersistence({ saveThrottleMs: 10000 });
    const result = await persistence.save({
      patterns: [],
      feedbackHistory: [],
      folderUsageStats: []
    });

    expect(result.success).toBe(true);
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(fs.rename).toHaveBeenCalledTimes(1);
  });

  it('awaits deferred throttled save completion', async () => {
    jest.useFakeTimers();
    try {
      const persistence = new PatternPersistence({ saveThrottleMs: 5000 });
      persistence.lastSaveTime = Date.now();

      const savePromise = persistence.save(
        {
          patterns: [['k', { count: 1 }]],
          feedbackHistory: [],
          folderUsageStats: []
        },
        { waitForFlush: true }
      );

      await Promise.resolve();
      expect(fs.writeFile).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(5000);
      const result = await savePromise;

      expect(result.success).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
