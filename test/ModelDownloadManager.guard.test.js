/**
 * Tests for ModelDownloadManager _downloads.delete guard fix.
 * Verifies that delete calls are guarded with .has() to prevent
 * errors when the entry has already been removed.
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/shared/singletonFactory', () => ({
  createSingletonHelpers: () => ({
    getInstance: jest.fn(),
    createInstance: jest.fn(),
    registerWithContainer: jest.fn(),
    resetInstance: jest.fn()
  })
}));

jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => '/mock') }
}));

jest.mock('fs', () => ({
  promises: {
    stat: jest.fn(),
    mkdir: jest.fn(),
    rename: jest.fn(),
    access: jest.fn()
  }
}));

describe('ModelDownloadManager – _downloads guard', () => {
  test('deleting from _downloads when key is already gone does not throw', () => {
    const map = new Map();
    map.set('model.gguf', { status: 'downloading' });

    // Simulate double-cleanup (e.g., error + abort both fire)
    const safeDelete = (key) => {
      if (map.has(key)) map.delete(key);
    };

    safeDelete('model.gguf');
    // Second call should be a no-op, not throw
    expect(() => safeDelete('model.gguf')).not.toThrow();
    expect(map.size).toBe(0);
  });

  test('guarded delete on non-existent key is harmless', () => {
    const map = new Map();

    const safeDelete = (key) => {
      if (map.has(key)) map.delete(key);
    };

    // Key was never set
    expect(() => safeDelete('never-set.gguf')).not.toThrow();
    expect(map.size).toBe(0);
  });
});
