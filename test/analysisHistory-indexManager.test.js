/**
 * Tests for Analysis History Index Manager
 * Tests index management, file hashing, and size categorization
 */

describe('indexManager', () => {
  let indexManager;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    indexManager = require('../src/main/services/analysisHistory/indexManager');
  });

  describe('createEmptyIndex', () => {
    test('creates index with correct structure', () => {
      const index = indexManager.createEmptyIndex('2.0');

      expect(index.schemaVersion).toBe('2.0');
      expect(index.createdAt).toBeDefined();
      expect(index.updatedAt).toBeDefined();
      expect(index.fileHashes).toEqual({});
      expect(index.pathLookup).toEqual({});
      expect(index.tagIndex).toEqual({});
      expect(index.categoryIndex).toEqual({});
      expect(index.dateIndex).toEqual({});
      expect(index.sizeIndex).toEqual({});
      expect(index.lastOptimized).toBeNull();
    });
  });

  describe('generateFileHash', () => {
    test('generates consistent hash for same input', () => {
      const hash1 = indexManager.generateFileHash('/path/file.pdf', 1000, '2024-01-15');
      const hash2 = indexManager.generateFileHash('/path/file.pdf', 1000, '2024-01-15');

      expect(hash1).toBe(hash2);
    });

    test('generates different hash for different path', () => {
      const hash1 = indexManager.generateFileHash('/path/file1.pdf', 1000, '2024-01-15');
      const hash2 = indexManager.generateFileHash('/path/file2.pdf', 1000, '2024-01-15');

      expect(hash1).not.toBe(hash2);
    });

    test('generates different hash for different size', () => {
      const hash1 = indexManager.generateFileHash('/path/file.pdf', 1000, '2024-01-15');
      const hash2 = indexManager.generateFileHash('/path/file.pdf', 2000, '2024-01-15');

      expect(hash1).not.toBe(hash2);
    });

    test('generates different hash for different lastModified', () => {
      const hash1 = indexManager.generateFileHash('/path/file.pdf', 1000, '2024-01-15');
      const hash2 = indexManager.generateFileHash('/path/file.pdf', 1000, '2024-01-20');

      expect(hash1).not.toBe(hash2);
    });

    test('generates 16 character hash', () => {
      const hash = indexManager.generateFileHash('/path/file.pdf', 1000, '2024-01-15');

      expect(hash.length).toBe(16);
    });
  });

  describe('getSizeRange', () => {
    test('returns tiny for < 1KB', () => {
      expect(indexManager.getSizeRange(500)).toBe('tiny');
      expect(indexManager.getSizeRange(0)).toBe('tiny');
    });

    test('returns small for < 1MB', () => {
      expect(indexManager.getSizeRange(1024)).toBe('small');
      expect(indexManager.getSizeRange(500000)).toBe('small');
    });

    test('returns medium for < 10MB', () => {
      expect(indexManager.getSizeRange(1024 * 1024)).toBe('medium');
      expect(indexManager.getSizeRange(5 * 1024 * 1024)).toBe('medium');
    });

    test('returns large for < 100MB', () => {
      expect(indexManager.getSizeRange(10 * 1024 * 1024)).toBe('large');
      expect(indexManager.getSizeRange(50 * 1024 * 1024)).toBe('large');
    });

    test('returns huge for >= 100MB', () => {
      expect(indexManager.getSizeRange(100 * 1024 * 1024)).toBe('huge');
      expect(indexManager.getSizeRange(500 * 1024 * 1024)).toBe('huge');
    });
  });

  describe('updateIndexes', () => {
    test('updates file hash index', () => {
      const index = indexManager.createEmptyIndex('2.0');
      const entry = {
        id: 'entry-1',
        fileHash: 'hash123',
        originalPath: '/path/file.pdf',
        timestamp: '2024-01-15T10:00:00Z',
        fileSize: 1000,
        analysis: { tags: [], category: null }
      };

      indexManager.updateIndexes(index, entry);

      expect(index.fileHashes['hash123']).toBe('entry-1');
    });

    test('updates path lookup index', () => {
      const index = indexManager.createEmptyIndex('2.0');
      const entry = {
        id: 'entry-1',
        fileHash: 'hash123',
        originalPath: '/path/file.pdf',
        timestamp: '2024-01-15T10:00:00Z',
        fileSize: 1000,
        analysis: { tags: [], category: null }
      };

      indexManager.updateIndexes(index, entry);

      expect(index.pathLookup['/path/file.pdf']).toBe('entry-1');
    });

    test('updates tag index', () => {
      const index = indexManager.createEmptyIndex('2.0');
      const entry = {
        id: 'entry-1',
        fileHash: 'hash123',
        originalPath: '/path/file.pdf',
        timestamp: '2024-01-15T10:00:00Z',
        fileSize: 1000,
        analysis: { tags: ['invoice', 'finance'], category: null }
      };

      indexManager.updateIndexes(index, entry);

      expect(index.tagIndex['invoice']).toContain('entry-1');
      expect(index.tagIndex['finance']).toContain('entry-1');
    });

    test('updates category index', () => {
      const index = indexManager.createEmptyIndex('2.0');
      const entry = {
        id: 'entry-1',
        fileHash: 'hash123',
        originalPath: '/path/file.pdf',
        timestamp: '2024-01-15T10:00:00Z',
        fileSize: 1000,
        analysis: { tags: [], category: 'documents' }
      };

      indexManager.updateIndexes(index, entry);

      expect(index.categoryIndex['documents']).toContain('entry-1');
    });

    test('updates date index', () => {
      const index = indexManager.createEmptyIndex('2.0');
      const entry = {
        id: 'entry-1',
        fileHash: 'hash123',
        originalPath: '/path/file.pdf',
        timestamp: '2024-01-15T10:00:00Z',
        fileSize: 1000,
        analysis: { tags: [], category: null }
      };

      indexManager.updateIndexes(index, entry);

      expect(index.dateIndex['2024-01']).toContain('entry-1');
    });

    test('updates size index', () => {
      const index = indexManager.createEmptyIndex('2.0');
      const entry = {
        id: 'entry-1',
        fileHash: 'hash123',
        originalPath: '/path/file.pdf',
        timestamp: '2024-01-15T10:00:00Z',
        fileSize: 500,
        analysis: { tags: [], category: null }
      };

      indexManager.updateIndexes(index, entry);

      expect(index.sizeIndex['tiny']).toContain('entry-1');
    });

    test('updates timestamp', () => {
      const index = indexManager.createEmptyIndex('2.0');
      const originalUpdatedAt = index.updatedAt;

      const entry = {
        id: 'entry-1',
        fileHash: 'hash123',
        originalPath: '/path/file.pdf',
        timestamp: '2024-01-15T10:00:00Z',
        fileSize: 1000,
        analysis: { tags: [], category: null }
      };

      // Wait a bit to ensure timestamp changes
      indexManager.updateIndexes(index, entry);

      expect(index.updatedAt).toBeDefined();
      expect(index.updatedAt).not.toBe(originalUpdatedAt);
    });
  });

  describe('removeFromIndexes', () => {
    test('removes from file hash index', () => {
      const index = indexManager.createEmptyIndex('2.0');
      index.fileHashes['hash123'] = 'entry-1';

      const entry = {
        id: 'entry-1',
        fileHash: 'hash123',
        originalPath: '/path/file.pdf',
        timestamp: '2024-01-15T10:00:00Z',
        fileSize: 1000,
        analysis: { tags: [], category: null }
      };

      indexManager.removeFromIndexes(index, entry);

      expect(index.fileHashes['hash123']).toBeUndefined();
    });

    test('removes from path lookup index', () => {
      const index = indexManager.createEmptyIndex('2.0');
      index.pathLookup['/path/file.pdf'] = 'entry-1';

      const entry = {
        id: 'entry-1',
        fileHash: 'hash123',
        originalPath: '/path/file.pdf',
        timestamp: '2024-01-15T10:00:00Z',
        fileSize: 1000,
        analysis: { tags: [], category: null }
      };

      indexManager.removeFromIndexes(index, entry);

      expect(index.pathLookup['/path/file.pdf']).toBeUndefined();
    });

    test('removes from tag index', () => {
      const index = indexManager.createEmptyIndex('2.0');
      index.tagIndex['invoice'] = ['entry-1', 'entry-2'];

      const entry = {
        id: 'entry-1',
        fileHash: 'hash123',
        originalPath: '/path/file.pdf',
        timestamp: '2024-01-15T10:00:00Z',
        fileSize: 1000,
        analysis: { tags: ['invoice'], category: null }
      };

      indexManager.removeFromIndexes(index, entry);

      expect(index.tagIndex['invoice']).not.toContain('entry-1');
      expect(index.tagIndex['invoice']).toContain('entry-2');
    });

    test('removes tag key when empty', () => {
      const index = indexManager.createEmptyIndex('2.0');
      index.tagIndex['invoice'] = ['entry-1'];

      const entry = {
        id: 'entry-1',
        fileHash: 'hash123',
        originalPath: '/path/file.pdf',
        timestamp: '2024-01-15T10:00:00Z',
        fileSize: 1000,
        analysis: { tags: ['invoice'], category: null }
      };

      indexManager.removeFromIndexes(index, entry);

      expect(index.tagIndex['invoice']).toBeUndefined();
    });

    test('removes from category index', () => {
      const index = indexManager.createEmptyIndex('2.0');
      index.categoryIndex['documents'] = ['entry-1', 'entry-2'];

      const entry = {
        id: 'entry-1',
        fileHash: 'hash123',
        originalPath: '/path/file.pdf',
        timestamp: '2024-01-15T10:00:00Z',
        fileSize: 1000,
        analysis: { tags: [], category: 'documents' }
      };

      indexManager.removeFromIndexes(index, entry);

      expect(index.categoryIndex['documents']).not.toContain('entry-1');
    });

    test('removes category key when empty', () => {
      const index = indexManager.createEmptyIndex('2.0');
      index.categoryIndex['documents'] = ['entry-1'];

      const entry = {
        id: 'entry-1',
        fileHash: 'hash123',
        originalPath: '/path/file.pdf',
        timestamp: '2024-01-15T10:00:00Z',
        fileSize: 1000,
        analysis: { tags: [], category: 'documents' }
      };

      indexManager.removeFromIndexes(index, entry);

      expect(index.categoryIndex['documents']).toBeUndefined();
    });

    test('removes from date index', () => {
      const index = indexManager.createEmptyIndex('2.0');
      index.dateIndex['2024-01'] = ['entry-1', 'entry-2'];

      const entry = {
        id: 'entry-1',
        fileHash: 'hash123',
        originalPath: '/path/file.pdf',
        timestamp: '2024-01-15T10:00:00Z',
        fileSize: 1000,
        analysis: { tags: [], category: null }
      };

      indexManager.removeFromIndexes(index, entry);

      expect(index.dateIndex['2024-01']).not.toContain('entry-1');
    });

    test('removes from size index', () => {
      const index = indexManager.createEmptyIndex('2.0');
      index.sizeIndex['tiny'] = ['entry-1', 'entry-2'];

      const entry = {
        id: 'entry-1',
        fileHash: 'hash123',
        originalPath: '/path/file.pdf',
        timestamp: '2024-01-15T10:00:00Z',
        fileSize: 500,
        analysis: { tags: [], category: null }
      };

      indexManager.removeFromIndexes(index, entry);

      expect(index.sizeIndex['tiny']).not.toContain('entry-1');
    });
  });
});
