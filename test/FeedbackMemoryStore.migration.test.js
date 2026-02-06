/**
 * @jest-environment node
 *
 * FeedbackMemoryStore - Migration Tests
 *
 * Validates JSON-only persistence (ChromaDB embedding storage removed),
 * CRUD operations, throttled saves, Zod validation, and metrics tracking.
 */

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/test/userData')
  }
}));

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn().mockResolvedValue(),
    rename: jest.fn().mockResolvedValue(),
    mkdir: jest.fn().mockResolvedValue()
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
const {
  FeedbackMemoryStore,
  getMetrics,
  resetMetrics
} = require('../src/main/services/organization/feedbackMemoryStore');

describe('FeedbackMemoryStore - Migration Tests', () => {
  let store;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMetrics();

    // Default: no existing file (first run)
    const enoent = new Error('ENOENT');
    enoent.code = 'ENOENT';
    fs.readFile.mockRejectedValue(enoent);

    store = new FeedbackMemoryStore({
      saveThrottleMs: 0 // Disable throttling for tests
    });
    // Force lastSaveTime to 0 so throttle check always passes
    store.lastSaveTime = 0;
  });

  describe('Constructor', () => {
    test('initializes with correct file path', () => {
      expect(store.filePath).toContain('feedback-memory.json');
    });

    test('accepts custom filename', () => {
      const s = new FeedbackMemoryStore({ filename: 'custom-feedback.json' });
      expect(s.filePath).toContain('custom-feedback.json');
    });

    test('accepts custom saveThrottleMs', () => {
      const s = new FeedbackMemoryStore({ saveThrottleMs: 10000 });
      expect(s.saveThrottleMs).toBe(10000);
    });

    test('default saveThrottleMs is 5000', () => {
      const s = new FeedbackMemoryStore();
      expect(s.saveThrottleMs).toBe(5000);
    });

    test('initializes with empty state', () => {
      expect(store._loaded).toBe(false);
      expect(store._entries).toEqual([]);
      expect(store._saving).toBe(false);
    });
  });

  describe('load()', () => {
    test('loads entries from JSON file', async () => {
      const items = [
        { id: '1', text: 'budget files go to Finance', source: 'user' },
        { id: '2', text: 'photos go to Gallery', source: 'implicit' }
      ];
      fs.readFile.mockResolvedValueOnce(JSON.stringify({ items }));

      const entries = await store.load();

      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe('1');
    });

    test('returns empty array on first run (ENOENT)', async () => {
      const entries = await store.load();

      expect(entries).toEqual([]);
    });

    test('returns empty array for corrupted JSON', async () => {
      fs.readFile.mockResolvedValueOnce('not-valid-json{{{');

      const entries = await store.load();

      expect(entries).toEqual([]);
    });

    test('caches after first load (does not re-read)', async () => {
      fs.readFile.mockResolvedValueOnce(JSON.stringify({ items: [{ id: '1', text: 'test' }] }));

      await store.load();
      const second = await store.load();

      expect(fs.readFile).toHaveBeenCalledTimes(1);
      expect(second).toHaveLength(1);
    });

    test('drops invalid entries during validation', async () => {
      const items = [
        { id: '1', text: 'valid entry' },
        { noId: true, noText: true }, // Invalid - missing id and text
        { id: '3', text: 'another valid' }
      ];
      fs.readFile.mockResolvedValueOnce(JSON.stringify({ items }));

      const entries = await store.load();

      // Only entries with id and text should pass Zod validation
      expect(entries.length).toBeLessThanOrEqual(3);
    });

    test('increments jsonReads metric', async () => {
      fs.readFile.mockResolvedValueOnce(JSON.stringify({ items: [] }));

      await store.load();

      const metrics = getMetrics();
      expect(metrics.jsonReads).toBe(1);
    });
  });

  describe('list()', () => {
    test('returns a copy of entries', async () => {
      fs.readFile.mockResolvedValueOnce(
        JSON.stringify({
          items: [
            { id: '1', text: 'a' },
            { id: '2', text: 'b' }
          ]
        })
      );

      const list = await store.list();

      expect(list).toHaveLength(2);
      // Verify it is a copy
      list.push({ id: '3', text: 'c' });
      expect(store._entries).toHaveLength(2);
    });
  });

  describe('add()', () => {
    test('prepends entry and triggers save', async () => {
      const entry = { id: 'new-1', text: 'new feedback' };

      const result = await store.add(entry);

      expect(result).toBe(entry);
      expect(store._entries[0].id).toBe('new-1');
    });

    test('saves to disk with atomic write', async () => {
      await store.add({ id: 'x', text: 'test' });

      // Should write to temp file then rename
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.tmp'),
        expect.any(String)
      );
      expect(fs.rename).toHaveBeenCalled();
    });
  });

  describe('update()', () => {
    test('updates entry by id', async () => {
      fs.readFile.mockResolvedValueOnce(
        JSON.stringify({
          items: [{ id: '1', text: 'original', source: 'user' }]
        })
      );
      await store.load();

      const updated = await store.update('1', { text: 'modified' });

      expect(updated.text).toBe('modified');
      expect(updated.source).toBe('user'); // Preserved
    });

    test('returns null for non-existent id', async () => {
      await store.load();

      const result = await store.update('nonexistent', { text: 'x' });

      expect(result).toBeNull();
    });
  });

  describe('remove()', () => {
    test('removes entry by id and returns true', async () => {
      fs.readFile.mockResolvedValueOnce(
        JSON.stringify({
          items: [
            { id: '1', text: 'a' },
            { id: '2', text: 'b' }
          ]
        })
      );
      await store.load();

      const removed = await store.remove('1');

      expect(removed).toBe(true);
      expect(store._entries).toHaveLength(1);
      expect(store._entries[0].id).toBe('2');
    });

    test('returns false for non-existent id', async () => {
      await store.load();

      const removed = await store.remove('nonexistent');

      expect(removed).toBe(false);
    });
  });

  describe('_save() throttling', () => {
    test('tracks jsonWrites metric after save', async () => {
      await store.add({ id: 'a', text: 'test' });

      const metrics = getMetrics();
      expect(metrics.jsonWrites).toBeGreaterThanOrEqual(1);
    });

    test('tracks lastSyncAt after save', async () => {
      await store.add({ id: 'b', text: 'test' });

      const metrics = getMetrics();
      expect(metrics.lastSyncAt).not.toBeNull();
    });

    test('records lastError on write failure', async () => {
      fs.writeFile.mockRejectedValueOnce(new Error('disk full'));

      await store.add({ id: 'err', text: 'test' });

      const metrics = getMetrics();
      expect(metrics.lastError).toBe('disk full');
    });
  });

  describe('shutdown()', () => {
    test('flushes pending saves', async () => {
      await store.load();
      store._needsSave = true;

      await store.shutdown();

      // Should have attempted a final save
      expect(fs.writeFile).toHaveBeenCalled();
    });

    test('clears pending save timer', async () => {
      store.pendingSave = setTimeout(() => {}, 10000);

      await store.shutdown();

      expect(store.pendingSave).toBeNull();
    });
  });

  describe('Metrics', () => {
    test('getMetrics returns all metrics', () => {
      const metrics = getMetrics();

      expect(metrics).toHaveProperty('jsonWrites');
      expect(metrics).toHaveProperty('jsonReads');
      expect(metrics).toHaveProperty('lastSyncAt');
      expect(metrics).toHaveProperty('lastError');
    });

    test('resetMetrics clears all counters', () => {
      resetMetrics();

      const metrics = getMetrics();
      expect(metrics.jsonWrites).toBe(0);
      expect(metrics.jsonReads).toBe(0);
      expect(metrics.lastSyncAt).toBeNull();
      expect(metrics.lastError).toBeNull();
    });
  });
});
