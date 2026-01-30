/**
 * Tests for FeedbackMemoryStore dual-write to ChromaDB.
 * Includes tests for migration, backup, metrics, and ChromaDB-primary reads.
 */

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/mock/documents')
  }
}));

// Mock logger
jest.mock('../src/shared/logger', () => {
  const baseLogger = {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  const createdLogger = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return {
    logger: baseLogger,
    createLogger: jest.fn(() => createdLogger),
    __createdLogger: createdLogger
  };
});

// Mock fs
const mockFs = {
  __lastWrite: '',
  readFile: jest.fn(),
  writeFile: jest.fn().mockImplementation(async (_path, content) => {
    mockFs.__lastWrite = typeof content === 'string' ? content : JSON.stringify(content || '');
  }),
  rename: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockImplementation(async () => ({
    size: Buffer.byteLength(mockFs.__lastWrite || '')
  })),
  access: jest.fn()
};

jest.mock('fs', () => ({
  promises: mockFs
}));

const {
  FeedbackMemoryStore,
  getMetrics,
  resetMetrics
} = require('../src/main/services/organization/feedbackMemoryStore');

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe('FeedbackMemoryStore Chroma dual-write', () => {
  let chromaMock;

  beforeEach(() => {
    chromaMock = {
      upsertFeedbackMemory: jest.fn().mockResolvedValue(undefined),
      deleteFeedbackMemory: jest.fn().mockResolvedValue(undefined)
    };
    jest.clearAllMocks();
    resetMetrics();
  });

  test('add/update/remove sync to Chroma when enabled', async () => {
    // No migration marker
    mockFs.access.mockRejectedValue({ code: 'ENOENT' });
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

    const store = new FeedbackMemoryStore({
      chromaDbService: chromaMock,
      enableChromaSync: true,
      saveThrottleMs: 0
    });

    await store.add({ id: '1', text: 'hello' });
    await store.update('1', { text: 'world' });
    await store.remove('1');

    expect(chromaMock.upsertFeedbackMemory).toHaveBeenCalledTimes(2);
    expect(chromaMock.upsertFeedbackMemory).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', document: expect.any(String) })
    );
    expect(chromaMock.deleteFeedbackMemory).toHaveBeenCalledWith('1');
  });

  test('skipChromaSync avoids placeholder writes', async () => {
    mockFs.access.mockRejectedValue({ code: 'ENOENT' });
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

    const store = new FeedbackMemoryStore({
      chromaDbService: chromaMock,
      enableChromaSync: true,
      saveThrottleMs: 0
    });

    await store.add({ id: 'skip-1', text: 'hello' }, { skipChromaSync: true });
    await store.update('skip-1', { text: 'world' }, { skipChromaSync: true });
    await store.remove('skip-1', { skipChromaSync: true });

    expect(chromaMock.upsertFeedbackMemory).not.toHaveBeenCalled();
    expect(chromaMock.deleteFeedbackMemory).not.toHaveBeenCalled();
  });

  test('dry-run skips Chroma calls but logs details', async () => {
    mockFs.access.mockResolvedValue(undefined); // Migration done
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

    const store = new FeedbackMemoryStore({
      chromaDbService: chromaMock,
      enableChromaSync: true,
      enableChromaDryRun: true,
      saveThrottleMs: 0
    });

    await store.add({ id: '2', text: 'dry run test', targetFolder: 'TestFolder' });
    await store.remove('2');

    expect(chromaMock.upsertFeedbackMemory).not.toHaveBeenCalled();
    expect(chromaMock.deleteFeedbackMemory).not.toHaveBeenCalled();
  });

  test('load triggers migration only once (persistent marker)', async () => {
    // First load - no migration marker
    mockFs.access.mockRejectedValueOnce({ code: 'ENOENT' });
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({ items: [{ id: '3', text: 'sync me' }] })
    );

    const store1 = new FeedbackMemoryStore({
      chromaDbService: chromaMock,
      enableChromaSync: true,
      saveThrottleMs: 0
    });

    await store1.load();
    await flushPromises();

    // Should have synced
    expect(chromaMock.upsertFeedbackMemory).toHaveBeenCalledWith(
      expect.objectContaining({ id: '3', document: 'sync me' })
    );

    // Should have created migration marker
    expect(mockFs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.feedback-memory-migrated'),
      expect.any(String)
    );

    // Clear mocks for second load
    jest.clearAllMocks();

    // Second load - migration marker exists
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readFile.mockResolvedValue(JSON.stringify({ items: [{ id: '3', text: 'sync me' }] }));

    const store2 = new FeedbackMemoryStore({
      chromaDbService: chromaMock,
      enableChromaSync: true,
      saveThrottleMs: 0
    });

    await store2.load();
    await flushPromises();

    // Should NOT sync again
    expect(chromaMock.upsertFeedbackMemory).not.toHaveBeenCalled();
  });
});

describe('FeedbackMemoryStore Migration', () => {
  let chromaMock;

  beforeEach(() => {
    chromaMock = {
      upsertFeedbackMemory: jest.fn().mockResolvedValue(undefined),
      deleteFeedbackMemory: jest.fn().mockResolvedValue(undefined)
    };
    jest.clearAllMocks();
    resetMetrics();
  });

  test('should create backup before migration', async () => {
    mockFs.access.mockRejectedValue({ code: 'ENOENT' });
    mockFs.readFile.mockResolvedValue(
      JSON.stringify({ items: [{ id: 'backup-test', text: 'old data' }] })
    );

    const store = new FeedbackMemoryStore({
      chromaDbService: chromaMock,
      enableChromaSync: true,
      saveThrottleMs: 0
    });

    await store.load();

    // Find backup write call
    const backupCall = mockFs.writeFile.mock.calls.find((call) => call[0].includes('backup'));

    expect(backupCall).toBeTruthy();
    expect(backupCall[0]).toMatch(/backup.*\d+/);
  });

  test('should track migration runs in metrics', async () => {
    mockFs.access.mockRejectedValue({ code: 'ENOENT' });
    mockFs.readFile.mockResolvedValue(JSON.stringify({ items: [] }));

    const store = new FeedbackMemoryStore({
      chromaDbService: chromaMock,
      enableChromaSync: true,
      saveThrottleMs: 0
    });

    await store.load();

    const metrics = getMetrics();
    expect(metrics.migrationRuns).toBe(1);
  });
});

describe('FeedbackMemoryStore Metrics', () => {
  let chromaMock;

  beforeEach(() => {
    chromaMock = {
      upsertFeedbackMemory: jest.fn().mockResolvedValue(undefined),
      deleteFeedbackMemory: jest.fn().mockResolvedValue(undefined)
    };
    jest.clearAllMocks();
    resetMetrics();
  });

  test('should track JSON reads', async () => {
    mockFs.access.mockResolvedValue(undefined); // Migration done
    mockFs.readFile.mockResolvedValue(JSON.stringify({ items: [] }));

    const store = new FeedbackMemoryStore({
      chromaDbService: chromaMock,
      enableChromaSync: true,
      saveThrottleMs: 0
    });

    await store.load();

    const metrics = getMetrics();
    expect(metrics.jsonReads).toBe(1);
  });

  test('should track JSON writes', async () => {
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

    const store = new FeedbackMemoryStore({
      chromaDbService: chromaMock,
      enableChromaSync: true,
      saveThrottleMs: 0
    });
    // Bypass throttle
    store.lastSaveTime = 0;

    await store.add({ id: 'metrics-test', text: 'test' });

    const metrics = getMetrics();
    expect(metrics.jsonWrites).toBe(1);
  });

  test('should track ChromaDB writes', async () => {
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

    const store = new FeedbackMemoryStore({
      chromaDbService: chromaMock,
      enableChromaSync: true,
      saveThrottleMs: 0
    });

    await store.add({ id: 'chroma-test', text: 'test' });
    await flushPromises();

    const metrics = getMetrics();
    expect(metrics.chromaWrites).toBe(1);
    expect(metrics.lastSyncAt).toBeTruthy();
  });

  test('should track ChromaDB write failures', async () => {
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });
    chromaMock.upsertFeedbackMemory.mockRejectedValue(new Error('ChromaDB error'));

    const store = new FeedbackMemoryStore({
      chromaDbService: chromaMock,
      enableChromaSync: true,
      saveThrottleMs: 0
    });

    await store.add({ id: 'fail-test', text: 'test' });
    await flushPromises();

    const metrics = getMetrics();
    expect(metrics.chromaWriteFailures).toBe(1);
    expect(metrics.lastError).toBe('ChromaDB error');
  });

  test('resetMetrics should clear all counters', () => {
    resetMetrics();

    const metrics = getMetrics();
    expect(metrics.jsonWrites).toBe(0);
    expect(metrics.jsonReads).toBe(0);
    expect(metrics.chromaWrites).toBe(0);
    expect(metrics.chromaWriteFailures).toBe(0);
    expect(metrics.migrationRuns).toBe(0);
    expect(metrics.lastSyncAt).toBeNull();
    expect(metrics.lastError).toBeNull();
  });
});

describe('FeedbackMemoryStore Error Handling', () => {
  let chromaMock;

  beforeEach(() => {
    chromaMock = {
      upsertFeedbackMemory: jest.fn().mockResolvedValue(undefined),
      deleteFeedbackMemory: jest.fn().mockResolvedValue(undefined)
    };
    jest.clearAllMocks();
    resetMetrics();
  });

  test('should continue with JSON when ChromaDB sync fails during migration', async () => {
    mockFs.access.mockRejectedValue({ code: 'ENOENT' });
    mockFs.readFile.mockResolvedValue(
      JSON.stringify({ items: [{ id: 'err-test', text: 'data' }] })
    );
    chromaMock.upsertFeedbackMemory.mockRejectedValue(new Error('Sync failed'));

    const store = new FeedbackMemoryStore({
      chromaDbService: chromaMock,
      enableChromaSync: true,
      saveThrottleMs: 0
    });

    // Should not throw
    const entries = await store.load();

    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('err-test');

    // Migration marker should not be written on failure
    const markerWrite = mockFs.writeFile.mock.calls.find((call) =>
      String(call?.[0] || '').includes('.feedback-memory-migrated')
    );
    expect(markerWrite).toBeUndefined();
  });
});

describe('FeedbackMemoryStore Shutdown', () => {
  let chromaMock;

  beforeEach(() => {
    chromaMock = {
      upsertFeedbackMemory: jest.fn().mockResolvedValue(undefined),
      deleteFeedbackMemory: jest.fn().mockResolvedValue(undefined)
    };
    jest.clearAllMocks();
    resetMetrics();
  });

  test('should flush pending saves on shutdown', async () => {
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

    const store = new FeedbackMemoryStore({
      chromaDbService: chromaMock,
      enableChromaSync: false,
      saveThrottleMs: 5000 // Long throttle to create pending state
    });

    // Load to initialize
    await store.load();

    // Add an entry - this will be throttled
    store._entries.push({ id: 'pending-test', text: 'pending data' });
    store._needsSave = true;

    // Clear mocks to track shutdown writes
    mockFs.writeFile.mockClear();
    mockFs.rename.mockClear();

    // Shutdown should flush pending data
    await store.shutdown();

    // Verify _needsSave was cleared
    expect(store._needsSave).toBe(false);

    // Verify a write occurred
    expect(mockFs.writeFile).toHaveBeenCalled();
  });

  test('shutdown should clear pending timeout without data loss', async () => {
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

    const store = new FeedbackMemoryStore({
      chromaDbService: chromaMock,
      enableChromaSync: false,
      saveThrottleMs: 5000
    });

    await store.load();

    // Manually set up a pending save scenario
    store._needsSave = true;
    store.pendingSave = setTimeout(() => {}, 5000);

    // Shutdown should clear the timeout
    await store.shutdown();

    expect(store.pendingSave).toBeNull();
    expect(store._needsSave).toBe(false);
  });

  test('shutdown should not fail if nothing is pending', async () => {
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

    const store = new FeedbackMemoryStore({
      chromaDbService: chromaMock,
      enableChromaSync: false,
      saveThrottleMs: 0
    });

    // No load, no pending data
    await expect(store.shutdown()).resolves.not.toThrow();
  });
});

describe('FeedbackMemoryStore chromaPrimary Warning', () => {
  let chromaMock;

  beforeEach(() => {
    chromaMock = {
      upsertFeedbackMemory: jest.fn().mockResolvedValue(undefined),
      deleteFeedbackMemory: jest.fn().mockResolvedValue(undefined)
    };
    jest.clearAllMocks();
    resetMetrics();
  });

  test('should log warning when chromaPrimary is enabled', async () => {
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readFile.mockResolvedValue(JSON.stringify({ items: [] }));

    const { logger, __createdLogger } = require('../src/shared/logger');

    const store = new FeedbackMemoryStore({
      chromaDbService: chromaMock,
      enableChromaSync: true,
      chromaPrimary: true,
      saveThrottleMs: 0
    });

    await store.load();

    // Should have logged a warning about chromaPrimary not being fully supported
    const warnCalls = [
      ...(logger.warn?.mock?.calls || []),
      ...(__createdLogger?.warn?.mock?.calls || [])
    ];
    expect(
      warnCalls.some((call) =>
        String(call?.[0] || '').includes('chromaPrimary mode is not fully supported')
      )
    ).toBe(true);
  });
});
