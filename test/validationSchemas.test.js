/**
 * Validation Schemas Tests
 *
 * Tests both Zod-based and fallback validation paths to ensure
 * security-critical input validation works correctly.
 *
 * Coverage target: main/ipc/validationSchemas.js (was 32% stmts, 0.7% branches)
 */

jest.mock('../src/shared/logger', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

describe('validationSchemas (Zod path)', () => {
  let schemas;

  beforeAll(() => {
    jest.resetModules();
    const mod = require('../src/main/ipc/validationSchemas');
    schemas = mod.schemas;
  });

  describe('filePath schema', () => {
    test('accepts valid file path', () => {
      const result = schemas.filePath.safeParse('/home/user/doc.pdf');
      expect(result.success).toBe(true);
    });

    test('rejects empty string', () => {
      const result = schemas.filePath.safeParse('');
      expect(result.success).toBe(false);
    });

    test('rejects non-string types', () => {
      expect(schemas.filePath.safeParse(123).success).toBe(false);
      expect(schemas.filePath.safeParse(null).success).toBe(false);
      expect(schemas.filePath.safeParse(undefined).success).toBe(false);
    });
  });

  describe('settings schema', () => {
    test('accepts valid partial settings', () => {
      const result = schemas.settings.safeParse({
        textModel: 'llama-3.2-1b.gguf',
        autoOrganize: true,
        cacheSize: 100
      });
      expect(result.success).toBe(true);
    });

    test('accepts empty settings object', () => {
      const result = schemas.settings.safeParse({});
      expect(result.success).toBe(true);
    });

    test('rejects invalid cacheSize (below min)', () => {
      const result = schemas.settings.safeParse({ cacheSize: -1 });
      expect(result.success).toBe(false);
    });

    test('rejects invalid model name with special chars', () => {
      // Model names allow alphanumeric, hyphens, underscores, dots, @, colons, slashes
      // but not spaces, shell metacharacters, or control chars
      const result = schemas.settings.safeParse({ textModel: 'model name with spaces' });
      expect(result.success).toBe(false);
    });

    test('rejects model name with shell metacharacters', () => {
      expect(schemas.settings.safeParse({ textModel: 'model;rm -rf /' }).success).toBe(false);
      expect(schemas.settings.safeParse({ textModel: 'model$(evil)' }).success).toBe(false);
    });

    test('rejects model name exceeding max length', () => {
      const result = schemas.settings.safeParse({ textModel: 'a'.repeat(101) });
      expect(result.success).toBe(false);
    });

    test('rejects non-boolean for boolean fields', () => {
      const result = schemas.settings.safeParse({ autoOrganize: 'yes' });
      expect(result.success).toBe(false);
    });

    test('accepts valid embedding timing values', () => {
      for (const val of ['during_analysis', 'after_organize', 'manual']) {
        const result = schemas.settings.safeParse({ embeddingTiming: val });
        expect(result.success).toBe(true);
      }
    });

    test('rejects invalid embedding timing', () => {
      const result = schemas.settings.safeParse({ embeddingTiming: 'always' });
      expect(result.success).toBe(false);
    });

    test('accepts valid confidenceThreshold range', () => {
      expect(schemas.settings.safeParse({ confidenceThreshold: 0 }).success).toBe(true);
      expect(schemas.settings.safeParse({ confidenceThreshold: 0.5 }).success).toBe(true);
      expect(schemas.settings.safeParse({ confidenceThreshold: 1 }).success).toBe(true);
    });

    test('rejects confidenceThreshold out of range', () => {
      expect(schemas.settings.safeParse({ confidenceThreshold: -0.1 }).success).toBe(false);
      expect(schemas.settings.safeParse({ confidenceThreshold: 1.1 }).success).toBe(false);
    });

    test('accepts nullish values for optional fields', () => {
      const result = schemas.settings.safeParse({
        textModel: null,
        autoOrganize: null,
        cacheSize: null
      });
      expect(result.success).toBe(true);
    });
  });

  describe('smartFolder schema', () => {
    test('accepts valid smart folder', () => {
      const result = schemas.smartFolder.safeParse({
        name: 'Invoices',
        path: '/home/user/invoices'
      });
      expect(result.success).toBe(true);
    });

    test('accepts smart folder with optional fields', () => {
      const result = schemas.smartFolder.safeParse({
        name: 'Invoices',
        path: '/home/user/invoices',
        description: 'Financial documents',
        keywords: ['invoice', 'receipt'],
        category: 'finance',
        isDefault: false
      });
      expect(result.success).toBe(true);
    });

    test('rejects missing name', () => {
      const result = schemas.smartFolder.safeParse({ path: '/home' });
      expect(result.success).toBe(false);
    });

    test('rejects missing path', () => {
      const result = schemas.smartFolder.safeParse({ name: 'Test' });
      expect(result.success).toBe(false);
    });

    test('rejects empty name', () => {
      const result = schemas.smartFolder.safeParse({ name: '', path: '/home' });
      expect(result.success).toBe(false);
    });
  });

  describe('batchOrganize schema', () => {
    test('accepts valid batch operations', () => {
      const result = schemas.batchOrganize.safeParse({
        operations: [{ source: '/a/file.txt', destination: '/b/file.txt' }]
      });
      expect(result.success).toBe(true);
    });

    test('rejects empty operations array', () => {
      const result = schemas.batchOrganize.safeParse({ operations: [] });
      expect(result.success).toBe(false);
    });

    test('rejects operations with empty source', () => {
      const result = schemas.batchOrganize.safeParse({
        operations: [{ source: '', destination: '/b/file.txt' }]
      });
      expect(result.success).toBe(false);
    });

    test('rejects too many operations (>1000)', () => {
      const ops = Array.from({ length: 1001 }, (_, i) => ({
        source: `/a/file${i}.txt`,
        destination: `/b/file${i}.txt`
      }));
      const result = schemas.batchOrganize.safeParse({ operations: ops });
      expect(result.success).toBe(false);
    });
  });

  describe('searchQuery schema', () => {
    test('accepts valid search query', () => {
      const result = schemas.searchQuery.safeParse({ query: 'test', limit: 10 });
      expect(result.success).toBe(true);
    });

    test('accepts empty search (no query)', () => {
      const result = schemas.searchQuery.safeParse({});
      expect(result.success).toBe(true);
    });

    test('rejects limit above 1000', () => {
      const result = schemas.searchQuery.safeParse({ limit: 1001 });
      expect(result.success).toBe(false);
    });

    test('rejects negative offset', () => {
      const result = schemas.searchQuery.safeParse({ offset: -1 });
      expect(result.success).toBe(false);
    });
  });

  describe('semanticSearch schema', () => {
    test('accepts valid semantic search', () => {
      const result = schemas.semanticSearch.safeParse({
        query: 'find similar documents',
        topK: 10,
        mode: 'hybrid'
      });
      expect(result.success).toBe(true);
    });

    test('rejects query shorter than 2 chars', () => {
      const result = schemas.semanticSearch.safeParse({ query: 'a' });
      expect(result.success).toBe(false);
    });

    test('rejects query longer than 2000 chars', () => {
      const result = schemas.semanticSearch.safeParse({ query: 'x'.repeat(2001) });
      expect(result.success).toBe(false);
    });

    test('accepts valid modes', () => {
      for (const mode of ['hybrid', 'vector', 'bm25']) {
        expect(schemas.semanticSearch.safeParse({ query: 'test', mode }).success).toBe(true);
      }
    });

    test('rejects invalid mode', () => {
      const result = schemas.semanticSearch.safeParse({ query: 'test', mode: 'turbo' });
      expect(result.success).toBe(false);
    });
  });

  describe('chatQuery schema', () => {
    test('accepts valid chat query', () => {
      const result = schemas.chatQuery.safeParse({
        query: 'What is this document about?',
        topK: 6,
        mode: 'hybrid'
      });
      expect(result.success).toBe(true);
    });

    test('accepts chat query with document scope', () => {
      const result = schemas.chatQuery.safeParse({
        query: 'Summarize this file',
        documentScopeItems: [{ id: 'file-1', path: '/docs/test.pdf', name: 'test.pdf' }],
        strictScope: true
      });
      expect(result.success).toBe(true);
    });

    test('rejects query under 2 chars', () => {
      expect(schemas.chatQuery.safeParse({ query: 'x' }).success).toBe(false);
    });

    test('accepts responseMode values', () => {
      expect(schemas.chatQuery.safeParse({ query: 'test', responseMode: 'fast' }).success).toBe(
        true
      );
      expect(schemas.chatQuery.safeParse({ query: 'test', responseMode: 'deep' }).success).toBe(
        true
      );
    });
  });

  describe('findDuplicates schema', () => {
    test('accepts default parameters', () => {
      const result = schemas.findDuplicates.safeParse({});
      expect(result.success).toBe(true);
    });

    test('rejects threshold below 0.7', () => {
      const result = schemas.findDuplicates.safeParse({ threshold: 0.5 });
      expect(result.success).toBe(false);
    });
  });

  describe('fileOperation schema', () => {
    test('accepts valid move operation', () => {
      const result = schemas.fileOperation.safeParse({
        type: 'move',
        source: '/a/file.txt',
        destination: '/b/file.txt'
      });
      expect(result.success).toBe(true);
    });

    test('rejects invalid operation type', () => {
      const result = schemas.fileOperation.safeParse({
        type: 'hack',
        source: '/a/file.txt'
      });
      expect(result.success).toBe(false);
    });

    test('batch_organize requires operations array', () => {
      const result = schemas.fileOperation.safeParse({
        type: 'batch_organize'
      });
      expect(result.success).toBe(false);
    });

    test('batch_organize rejects empty operations', () => {
      const result = schemas.fileOperation.safeParse({
        type: 'batch_organize',
        operations: []
      });
      expect(result.success).toBe(false);
    });
  });

  describe('smartFolderEdit schema', () => {
    test('accepts valid edit tuple', () => {
      const result = schemas.smartFolderEdit.safeParse(['folder-id-1', { name: 'Updated Name' }]);
      expect(result.success).toBe(true);
    });

    test('rejects empty folder ID', () => {
      const result = schemas.smartFolderEdit.safeParse(['', { name: 'Test' }]);
      expect(result.success).toBe(false);
    });
  });

  describe('scoreFiles schema', () => {
    test('accepts valid input', () => {
      const result = schemas.scoreFiles.safeParse({
        query: 'test query',
        fileIds: ['file-1', 'file-2']
      });
      expect(result.success).toBe(true);
    });

    test('rejects empty fileIds', () => {
      const result = schemas.scoreFiles.safeParse({
        query: 'test',
        fileIds: []
      });
      expect(result.success).toBe(false);
    });
  });

  describe('computeClusters schema', () => {
    test('accepts auto k', () => {
      const result = schemas.computeClusters.safeParse({ k: 'auto' });
      expect(result.success).toBe(true);
    });

    test('accepts numeric k', () => {
      const result = schemas.computeClusters.safeParse({ k: 5 });
      expect(result.success).toBe(true);
    });

    test('accepts empty object (defaults)', () => {
      const result = schemas.computeClusters.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('feedback schemas', () => {
    test('feedbackMemoryAdd accepts valid input', () => {
      const result = schemas.feedbackMemoryAdd.safeParse({
        text: 'Always put invoices in Finance folder'
      });
      expect(result.success).toBe(true);
    });

    test('feedbackMemoryAdd rejects too short text', () => {
      const result = schemas.feedbackMemoryAdd.safeParse({ text: 'x' });
      expect(result.success).toBe(false);
    });

    test('feedbackMemoryDelete accepts valid id', () => {
      const result = schemas.feedbackMemoryDelete.safeParse({ id: 'mem-1' });
      expect(result.success).toBe(true);
    });

    test('feedbackMemoryUpdate accepts valid update', () => {
      const result = schemas.feedbackMemoryUpdate.safeParse({
        id: 'mem-1',
        text: 'Updated memory text'
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('validationSchemas (fallback path)', () => {
  let fallbackSchemas;

  beforeAll(() => {
    jest.resetModules();
    // Force Zod to be unavailable
    jest.doMock('zod', () => {
      throw new Error('zod not installed');
    });
    const mod = require('../src/main/ipc/validationSchemas');
    fallbackSchemas = mod.schemas;
  });

  afterAll(() => {
    jest.unmock('zod');
  });

  test('uses fallback validators when zod is unavailable', () => {
    const mod = require('../src/main/ipc/validationSchemas');
    expect(mod._usingFallback).toBe(true);
    expect(mod.z).toBeNull();
  });

  describe('filePath fallback', () => {
    test('accepts valid path', () => {
      const result = fallbackSchemas.filePath.safeParse('/home/user/file.txt');
      expect(result.success).toBe(true);
    });

    test('rejects empty string', () => {
      const result = fallbackSchemas.filePath.safeParse('');
      expect(result.success).toBe(false);
    });

    test('rejects non-string', () => {
      const result = fallbackSchemas.filePath.safeParse(123);
      expect(result.success).toBe(false);
    });

    test('parse throws on invalid input', () => {
      expect(() => fallbackSchemas.filePath.parse('')).toThrow();
    });

    test('parse returns valid data', () => {
      expect(fallbackSchemas.filePath.parse('/valid/path')).toBe('/valid/path');
    });
  });

  describe('settings fallback', () => {
    test('accepts valid object', () => {
      const result = fallbackSchemas.settings.safeParse({ textModel: 'test' });
      expect(result.success).toBe(true);
    });

    test('rejects null', () => {
      const result = fallbackSchemas.settings.safeParse(null);
      expect(result.success).toBe(false);
    });

    test('strips __proto__ key for prototype pollution protection', () => {
      const malicious = JSON.parse('{"__proto__":{"isAdmin":true},"safe":"value"}');
      const result = fallbackSchemas.settings.safeParse(malicious);
      expect(result.success).toBe(true);
      // __proto__ should not be an own property on the sanitized data
      expect(Object.getOwnPropertyDescriptor(result.data, '__proto__')).toBeUndefined();
      expect(result.data.safe).toBe('value');
    });

    test('strips constructor and prototype keys', () => {
      const result = fallbackSchemas.settings.safeParse({
        constructor: 'bad',
        prototype: 'bad',
        validKey: 'ok'
      });
      expect(result.success).toBe(true);
      // These dangerous keys should not be own properties
      expect(Object.getOwnPropertyDescriptor(result.data, 'constructor')).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(result.data, 'prototype')).toBeUndefined();
      expect(result.data.validKey).toBe('ok');
    });
  });

  describe('smartFolder fallback', () => {
    test('accepts valid smart folder', () => {
      const result = fallbackSchemas.smartFolder.safeParse({
        name: 'Test',
        path: '/test'
      });
      expect(result.success).toBe(true);
    });

    test('rejects missing name', () => {
      const result = fallbackSchemas.smartFolder.safeParse({ path: '/test' });
      expect(result.success).toBe(false);
    });

    test('rejects non-object', () => {
      const result = fallbackSchemas.smartFolder.safeParse('not an object');
      expect(result.success).toBe(false);
    });
  });

  describe('searchQuery fallback', () => {
    test('accepts valid search', () => {
      const result = fallbackSchemas.searchQuery.safeParse({ query: 'test' });
      expect(result.success).toBe(true);
    });

    test('rejects invalid limit', () => {
      const result = fallbackSchemas.searchQuery.safeParse({ limit: 'many' });
      expect(result.success).toBe(false);
    });

    test('rejects limit out of range', () => {
      expect(fallbackSchemas.searchQuery.safeParse({ limit: 0 }).success).toBe(false);
      expect(fallbackSchemas.searchQuery.safeParse({ limit: 1001 }).success).toBe(false);
    });

    test('rejects negative offset', () => {
      const result = fallbackSchemas.searchQuery.safeParse({ offset: -1 });
      expect(result.success).toBe(false);
    });
  });

  describe('batchOrganize fallback', () => {
    test('accepts valid batch', () => {
      const result = fallbackSchemas.batchOrganize.safeParse({
        operations: [{ source: '/a', destination: '/b' }]
      });
      expect(result.success).toBe(true);
    });

    test('rejects empty operations', () => {
      const result = fallbackSchemas.batchOrganize.safeParse({ operations: [] });
      expect(result.success).toBe(false);
    });

    test('rejects missing operations', () => {
      const result = fallbackSchemas.batchOrganize.safeParse({});
      expect(result.success).toBe(false);
    });

    test('rejects operation with empty source', () => {
      const result = fallbackSchemas.batchOrganize.safeParse({
        operations: [{ source: '', destination: '/b' }]
      });
      expect(result.success).toBe(false);
    });

    test('rejects oversized batch (>1000)', () => {
      const ops = Array.from({ length: 1001 }, () => ({
        source: '/a',
        destination: '/b'
      }));
      const result = fallbackSchemas.batchOrganize.safeParse({ operations: ops });
      expect(result.success).toBe(false);
    });

    test('rejects non-object operations entries', () => {
      const result = fallbackSchemas.batchOrganize.safeParse({
        operations: ['not', 'objects']
      });
      expect(result.success).toBe(false);
    });
  });

  describe('pagination fallback', () => {
    test('accepts valid pagination', () => {
      const result = fallbackSchemas.pagination.safeParse({ limit: 10, offset: 0 });
      expect(result.success).toBe(true);
    });

    test('rejects non-object', () => {
      const result = fallbackSchemas.pagination.safeParse('nope');
      expect(result.success).toBe(false);
    });
  });
});
