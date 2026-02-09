/**
 * OramaVectorService - Persist promise race condition test
 *
 * Verifies that _schedulePersist does not overwrite _currentPersistPromise
 * with a no-op promise when a persist is already running, which would cause
 * cleanup() to skip waiting for the in-flight persist.
 */

let mockLogger;

// Mock electron
jest.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-vector-db' }
}));

// Mock logger
jest.mock('../src/shared/logger', () => {
  mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };
  return {
    createLogger: () => mockLogger
  };
});

// Mock singleton factory
jest.mock('../src/shared/singletonFactory', () => ({
  createSingletonHelpers: () => ({
    getInstance: jest.fn(),
    createInstance: jest.fn(),
    registerWithContainer: jest.fn(),
    resetInstance: jest.fn()
  })
}));

// Mock Orama
jest.mock('@orama/orama', () => ({
  create: jest.fn().mockResolvedValue({ __mock: true }),
  insert: jest.fn().mockResolvedValue(undefined),
  search: jest.fn().mockResolvedValue({ hits: [] }),
  remove: jest.fn().mockResolvedValue(undefined),
  update: jest.fn().mockResolvedValue(undefined),
  count: jest.fn().mockResolvedValue(0),
  getByID: jest.fn().mockResolvedValue(null)
}));

jest.mock('@orama/plugin-data-persistence', () => ({
  persist: jest.fn().mockResolvedValue('{}'),
  restore: jest.fn().mockResolvedValue({ __mock: true })
}));

// Mock llama utils
jest.mock('../src/main/llamaUtils', () => ({
  getEmbeddingModel: jest.fn().mockReturnValue('test-model.gguf'),
  loadLlamaConfig: jest.fn().mockResolvedValue(undefined)
}));

// Mock vectorDb metadata
jest.mock('../src/main/services/vectorDb/embeddingIndexMetadata', () => ({
  writeEmbeddingIndexMetadata: jest.fn().mockResolvedValue(undefined)
}));

const { OramaVectorService } = require('../src/main/services/OramaVectorService');

describe('OramaVectorService - persist promise race condition', () => {
  let service;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new OramaVectorService();
    // Simulate initialized state so _schedulePersist doesn't short-circuit
    service._initialized = true;
    service._databases = { files: { __mock: true } };
    service._schemas = {
      files: {},
      folders: {},
      fileChunks: {},
      feedback: {},
      learningPatterns: {}
    };
    service._dataPath = '/tmp/test-vector-db';
  });

  afterEach(() => {
    jest.useRealTimers();
    // Clear any pending timers
    if (service._persistTimer) {
      clearTimeout(service._persistTimer);
      service._persistTimer = null;
    }
  });

  test('_schedulePersist does not overwrite _currentPersistPromise when _isPersisting is true (force path)', () => {
    // Simulate a long-running persist
    const realPersistPromise = new Promise(() => {}); // Never resolves (simulates in-flight persist)
    service._currentPersistPromise = realPersistPromise;
    service._isPersisting = true;
    service._lastPersist = 0; // Force the MAX_PERSIST_WAIT_MS path

    // Call _schedulePersist - should NOT overwrite _currentPersistPromise
    service._schedulePersist();

    // The promise reference should still point to the real persist, not a no-op
    expect(service._currentPersistPromise).toBe(realPersistPromise);
    // _persistPending should be set so the running persist reschedules
    expect(service._persistPending).toBe(true);
  });

  test('_schedulePersist does not overwrite _currentPersistPromise when _isPersisting is true (debounce path)', () => {
    // Simulate a long-running persist
    const realPersistPromise = new Promise(() => {}); // Never resolves
    service._currentPersistPromise = realPersistPromise;
    service._isPersisting = true;
    service._lastPersist = Date.now(); // Recent persist -> debounce path

    // Call _schedulePersist - should set a debounce timer
    service._schedulePersist();
    expect(service._persistTimer).not.toBeNull();

    // Fast-forward timer - the callback should check _isPersisting before overwriting
    jest.runAllTimers();

    // After the timer fires with _isPersisting = true, the promise should be unchanged
    expect(service._currentPersistPromise).toBe(realPersistPromise);
  });

  test('_schedulePersist starts persist normally when _isPersisting is false (force path)', () => {
    service._isPersisting = false;
    service._lastPersist = 0; // Force the MAX_PERSIST_WAIT_MS path
    service._persistPending = false;
    service._currentPersistPromise = null;

    // _doPersist will set _persistPending to false and return
    service._schedulePersist();

    // _currentPersistPromise should be set to the new persist promise
    expect(service._currentPersistPromise).not.toBeNull();
  });

  test('_schedulePersist starts persist normally when _isPersisting is false (debounce path)', () => {
    service._isPersisting = false;
    service._lastPersist = Date.now(); // Recent -> debounce path
    service._persistPending = false;
    service._currentPersistPromise = null;

    service._schedulePersist();

    // Timer should be set
    expect(service._persistTimer).not.toBeNull();

    // Fire the timer
    jest.runAllTimers();

    // _currentPersistPromise should now be set
    expect(service._currentPersistPromise).not.toBeNull();
  });

  test('_persistPending flag is set even when persist is skipped due to _isPersisting guard', () => {
    service._isPersisting = true;
    service._lastPersist = 0; // Force path
    service._persistPending = false;

    service._schedulePersist();

    // Even though we didn't start a new persist, the flag ensures
    // the running persist's finally block will reschedule
    expect(service._persistPending).toBe(true);
  });

  test('cleanup waits for real in-flight persist when _currentPersistPromise is preserved', async () => {
    jest.useRealTimers(); // Need real timers for async cleanup

    let persistResolve;
    let persistFinished = false;

    // Create a controlled promise that simulates an in-flight persist
    const controlledPromise = new Promise((resolve) => {
      persistResolve = resolve;
    });

    service._currentPersistPromise = controlledPromise.then(() => {
      persistFinished = true;
    });
    service._isPersisting = true;

    // Start cleanup in background
    const cleanupPromise = service.cleanup();

    // Give cleanup a chance to start awaiting
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Persist hasn't finished yet
    expect(persistFinished).toBe(false);

    // Resolve the in-flight persist
    service._isPersisting = false;
    persistResolve();

    // Wait for cleanup to finish
    await cleanupPromise;

    // Verify the persist was actually waited for
    expect(persistFinished).toBe(true);
    expect(service._isShuttingDown).toBe(true);
  });
});
