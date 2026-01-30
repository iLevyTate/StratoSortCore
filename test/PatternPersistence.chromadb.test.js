/**
 * Tests for PatternPersistence ChromaDB dual-write integration.
 * Tests migration, backup, metrics, and ChromaDB-primary reads.
 */

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/mock/userData')
  }
}));

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  },
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }))
}));

// Mock crypto
jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'mock-uuid-12345')
}));

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
  PatternPersistence,
  getMetrics,
  resetMetrics,
  LEARNING_PATTERNS_ID
} = require('../src/main/services/organization/persistence');

describe('PatternPersistence ChromaDB Integration', () => {
  let chromaMock;

  beforeEach(() => {
    chromaMock = {
      upsertLearningPatterns: jest.fn().mockResolvedValue(undefined),
      getLearningPatterns: jest.fn().mockResolvedValue(null),
      deleteLearningPatterns: jest.fn().mockResolvedValue(undefined)
    };
    jest.clearAllMocks();
    resetMetrics();
  });

  describe('Dual-write to ChromaDB', () => {
    beforeEach(() => {
      // Setup proper mock for stat to return correct size
      mockFs.stat.mockImplementation(() => Promise.resolve({ size: 100 }));
      mockFs.writeFile.mockImplementation(() => Promise.resolve());
      mockFs.rename.mockImplementation(() => Promise.resolve());
    });

    test('should call ChromaDB upsert when enableChromaSync is true', async () => {
      const persistence = new PatternPersistence({
        chromaDbService: chromaMock,
        enableChromaSync: true,
        saveThrottleMs: 0
      });
      persistence.lastSaveTime = 0;

      const testData = {
        patterns: [['ext:pdf', { folder: 'Documents', count: 5 }]],
        feedbackHistory: [{ timestamp: Date.now(), accepted: true }],
        folderUsageStats: [['docs', { count: 3 }]]
      };

      // Direct call to _saveToChroma to test the ChromaDB integration
      await persistence._saveToChroma(testData);

      expect(chromaMock.upsertLearningPatterns).toHaveBeenCalledWith(
        expect.objectContaining({
          id: LEARNING_PATTERNS_ID,
          patterns: testData.patterns,
          feedbackHistory: testData.feedbackHistory,
          folderUsageStats: testData.folderUsageStats
        })
      );

      const metrics = getMetrics();
      expect(metrics.chromaWrites).toBe(1);
    });

    test('should not call ChromaDB when enableChromaSync is false', async () => {
      const persistence = new PatternPersistence({
        chromaDbService: chromaMock,
        enableChromaSync: false,
        saveThrottleMs: 0
      });

      const result = await persistence._saveToChroma({ patterns: [] });

      expect(result).toBe(false);
      expect(chromaMock.upsertLearningPatterns).not.toHaveBeenCalled();
    });

    test('should log but not execute ChromaDB writes in dry-run mode', async () => {
      const persistence = new PatternPersistence({
        chromaDbService: chromaMock,
        enableChromaSync: true,
        enableChromaDryRun: true,
        saveThrottleMs: 0
      });

      const result = await persistence._saveToChroma({ patterns: [['test', { folder: 'Test' }]] });

      expect(result).toBe(true);
      expect(chromaMock.upsertLearningPatterns).not.toHaveBeenCalled();
    });
  });

  describe('Migration from JSON to ChromaDB', () => {
    test('should run migration on first load when ChromaDB is enabled', async () => {
      // Simulate no migration marker exists
      mockFs.access.mockRejectedValue({ code: 'ENOENT' });

      // Simulate existing JSON data
      mockFs.readFile.mockImplementation((path) => {
        if (path.includes('user-patterns.json')) {
          return Promise.resolve(
            JSON.stringify({
              patterns: [['pdf:docs', { folder: 'PDFs' }]],
              feedbackHistory: [],
              folderUsageStats: []
            })
          );
        }
        return Promise.reject({ code: 'ENOENT' });
      });

      const persistence = new PatternPersistence({
        chromaDbService: chromaMock,
        enableChromaSync: true,
        saveThrottleMs: 0
      });

      await persistence.load();

      // Should have created backup
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('backup'),
        expect.any(String)
      );

      // Should have upserted to ChromaDB
      expect(chromaMock.upsertLearningPatterns).toHaveBeenCalled();

      // Should have created migration marker
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.patterns-migrated'),
        expect.any(String)
      );

      // Check metrics
      const metrics = getMetrics();
      expect(metrics.migrationRuns).toBe(1);
    });

    test('should skip migration if marker exists', async () => {
      // Simulate migration marker exists
      mockFs.access.mockResolvedValue(undefined);

      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          patterns: [],
          feedbackHistory: [],
          folderUsageStats: []
        })
      );

      const persistence = new PatternPersistence({
        chromaDbService: chromaMock,
        enableChromaSync: true,
        saveThrottleMs: 0
      });

      await persistence.load();

      // Should NOT upsert during migration (only if explicitly saved)
      expect(chromaMock.upsertLearningPatterns).not.toHaveBeenCalled();

      // Check metrics - no migration run
      const metrics = getMetrics();
      expect(metrics.migrationRuns).toBe(0);
    });
  });

  describe('ChromaDB-primary reads', () => {
    test('should read from ChromaDB first when chromaPrimary is true', async () => {
      const chromaData = {
        id: LEARNING_PATTERNS_ID,
        patterns: [['chroma:pattern', { folder: 'FromChroma' }]],
        feedbackHistory: [],
        folderUsageStats: [],
        lastUpdated: new Date().toISOString()
      };

      chromaMock.getLearningPatterns.mockResolvedValue(chromaData);
      mockFs.access.mockResolvedValue(undefined); // Migration done

      const persistence = new PatternPersistence({
        chromaDbService: chromaMock,
        enableChromaSync: true,
        chromaPrimary: true,
        saveThrottleMs: 0
      });

      const result = await persistence.load();

      expect(chromaMock.getLearningPatterns).toHaveBeenCalledWith(LEARNING_PATTERNS_ID);
      expect(result.patterns).toEqual(chromaData.patterns);

      const metrics = getMetrics();
      expect(metrics.chromaReads).toBe(1);
    });

    test('should fall back to JSON when ChromaDB is empty', async () => {
      chromaMock.getLearningPatterns.mockResolvedValue(null);
      mockFs.access.mockResolvedValue(undefined); // Migration marker exists

      mockFs.readFile.mockImplementation((path) => {
        if (path.includes('user-patterns.json')) {
          return Promise.resolve(
            JSON.stringify({
              patterns: [['json:pattern', { folder: 'FromJSON' }]],
              feedbackHistory: [],
              folderUsageStats: []
            })
          );
        }
        return Promise.reject({ code: 'ENOENT' });
      });

      const persistence = new PatternPersistence({
        chromaDbService: chromaMock,
        enableChromaSync: true,
        chromaPrimary: true,
        saveThrottleMs: 0
      });

      const result = await persistence.load();

      expect(result.patterns).toEqual([['json:pattern', { folder: 'FromJSON' }]]);

      const metrics = getMetrics();
      // ChromaDB read returned null; JSON fallback used
      expect(metrics.chromaReads).toBe(0);
      expect(metrics.jsonReads).toBe(1);
    });
  });

  describe('Error handling', () => {
    test('should track ChromaDB write failures via _saveToChroma', async () => {
      chromaMock.upsertLearningPatterns.mockRejectedValue(new Error('ChromaDB down'));

      const persistence = new PatternPersistence({
        chromaDbService: chromaMock,
        enableChromaSync: true,
        saveThrottleMs: 0
      });

      // Directly test _saveToChroma error handling
      const result = await persistence._saveToChroma({ patterns: [] });

      expect(result).toBe(false);
      const metrics = getMetrics();
      expect(metrics.chromaWriteFailures).toBe(1);
      expect(metrics.lastError).toBe('ChromaDB down');
    });

    test('should track ChromaDB read failures', async () => {
      chromaMock.getLearningPatterns.mockRejectedValue(new Error('Read failed'));
      mockFs.access.mockResolvedValue(undefined); // Migration done
      mockFs.readFile.mockImplementation((path) => {
        if (path.includes('user-patterns.json')) {
          return Promise.resolve(JSON.stringify({ patterns: [] }));
        }
        return Promise.reject({ code: 'ENOENT' });
      });

      const persistence = new PatternPersistence({
        chromaDbService: chromaMock,
        enableChromaSync: true,
        chromaPrimary: true,
        saveThrottleMs: 0
      });

      await persistence.load();

      const metrics = getMetrics();
      expect(metrics.chromaReadFailures).toBe(1);
    });
  });

  describe('Metrics', () => {
    test('should track migration operations', async () => {
      mockFs.access.mockRejectedValue({ code: 'ENOENT' }); // No migration marker
      mockFs.readFile.mockImplementation((path) => {
        if (path.includes('user-patterns.json')) {
          return Promise.resolve(JSON.stringify({ patterns: [] }));
        }
        return Promise.reject({ code: 'ENOENT' });
      });

      const persistence = new PatternPersistence({
        chromaDbService: chromaMock,
        enableChromaSync: true,
        saveThrottleMs: 0
      });

      // Load triggers migration
      await persistence.load();

      const metrics = getMetrics();
      expect(metrics.jsonReads).toBeGreaterThanOrEqual(1);
      expect(metrics.migrationRuns).toBe(1);
      expect(metrics.chromaWrites).toBeGreaterThanOrEqual(1); // Migration writes to ChromaDB
      expect(metrics.lastSyncAt).toBeTruthy();
    });

    test('should track ChromaDB writes via _saveToChroma', async () => {
      const persistence = new PatternPersistence({
        chromaDbService: chromaMock,
        enableChromaSync: true,
        saveThrottleMs: 0
      });

      await persistence._saveToChroma({ patterns: [['test', { folder: 'Test' }]] });

      const metrics = getMetrics();
      expect(metrics.chromaWrites).toBe(1);
      expect(metrics.lastSyncAt).toBeTruthy();
    });

    test('resetMetrics should clear all counters', () => {
      resetMetrics();

      const metrics = getMetrics();
      expect(metrics.jsonWrites).toBe(0);
      expect(metrics.chromaWrites).toBe(0);
      expect(metrics.lastSyncAt).toBe(null);
    });
  });

  describe('Backup creation', () => {
    test('should create timestamped backup before migration', async () => {
      mockFs.access.mockRejectedValue({ code: 'ENOENT' });
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          patterns: [['old:pattern', { folder: 'Old' }]]
        })
      );

      const persistence = new PatternPersistence({
        chromaDbService: chromaMock,
        enableChromaSync: true,
        saveThrottleMs: 0
      });

      await persistence.load();

      // Find the backup write call
      const backupCall = mockFs.writeFile.mock.calls.find((call) => call[0].includes('backup'));

      expect(backupCall).toBeTruthy();
      expect(backupCall[0]).toMatch(/backup.*\d+/); // Should include timestamp
    });
  });

  describe('Shutdown', () => {
    test('should flush pending data on shutdown without race condition', async () => {
      const persistence = new PatternPersistence({
        chromaDbService: chromaMock,
        enableChromaSync: true,
        saveThrottleMs: 5000 // Long throttle to ensure data is pending
      });

      // Trigger a save that will be throttled
      const testData = { patterns: [['shutdown:test', { folder: 'Test' }]] };
      await persistence.save(testData);

      // Verify data is pending
      expect(persistence._pendingSaveData).toBeTruthy();

      // Clear mocks to track shutdown writes
      mockFs.writeFile.mockClear();
      mockFs.rename.mockClear();

      // Shutdown should flush the pending data
      await persistence.shutdown();

      // Verify pending data was cleared
      expect(persistence._pendingSaveData).toBeNull();

      // Verify a write occurred during shutdown
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    test('shutdown should not fail if no pending data', async () => {
      const persistence = new PatternPersistence({
        chromaDbService: chromaMock,
        enableChromaSync: true,
        saveThrottleMs: 0
      });

      // No saves made, so no pending data
      expect(persistence._pendingSaveData).toBeNull();

      // Shutdown should complete without error
      await expect(persistence.shutdown()).resolves.not.toThrow();
    });
  });
});
