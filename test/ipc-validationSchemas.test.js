/**
 * Tests for IPC Validation Schemas
 * Tests Zod schema validation for IPC input data
 */

describe('IPC Validation Schemas', () => {
  let schemas;
  let z;
  let moduleRef;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    moduleRef = require('../src/main/ipc/validationSchemas');
    schemas = moduleRef.schemas;
    z = moduleRef.z;

    if (!z || !schemas) {
      const detail = moduleRef?.zodLoadError?.message || 'unknown';
      throw new Error(`zod not available for validation schema tests: ${detail}`);
    }
  });

  // All schema tests must run; keep a guard per test for clarity
  const testIfZod = (name, fn, timeout) =>
    test(
      name,
      (...args) => {
        return fn(...args);
      },
      timeout
    );

  describe('filePath schema', () => {
    testIfZod('accepts valid file path', () => {
      const result = schemas.filePath.safeParse('/path/to/file.pdf');
      expect(result.success).toBe(true);
    });

    testIfZod('rejects empty string', () => {
      const result = schemas.filePath.safeParse('');
      expect(result.success).toBe(false);
    });
  });

  describe('settings schema', () => {
    testIfZod('accepts valid settings', () => {
      const result = schemas.settings.safeParse({
        language: 'en',
        launchOnStartup: true
      });
      expect(result.success).toBe(true);
    });

    testIfZod('accepts partial settings', () => {
      const result = schemas.settings.safeParse({
        language: 'en'
      });
      expect(result.success).toBe(true);
    });

    testIfZod('accepts valid logging levels', () => {
      for (const level of ['error', 'warn', 'info', 'debug']) {
        const result = schemas.settings.safeParse({ loggingLevel: level });
        expect(result.success).toBe(true);
      }
    });

    testIfZod('validates ollamaHost as URL or empty', () => {
      expect(
        schemas.settings.safeParse({
          ollamaHost: 'http://localhost:11434'
        }).success
      ).toBe(true);
      expect(schemas.settings.safeParse({ ollamaHost: '' }).success).toBe(true);
    });

    testIfZod('validates model name format', () => {
      expect(schemas.settings.safeParse({ textModel: 'llama2:7b' }).success).toBe(true);
      expect(schemas.settings.safeParse({ textModel: 'model@latest' }).success).toBe(true);
    });

    testIfZod('validates notification settings', () => {
      const validNotifications = {
        notifications: true,
        notificationMode: 'both',
        notifyOnAutoAnalysis: false,
        notifyOnLowConfidence: true
      };
      expect(schemas.settings.safeParse(validNotifications).success).toBe(true);

      const invalidMode = { notificationMode: 'invalid' };
      expect(schemas.settings.safeParse(invalidMode).success).toBe(false);
    });

    testIfZod('validates naming convention settings', () => {
      const validNaming = {
        namingConvention: 'subject-date',
        dateFormat: 'YYYY-MM-DD',
        caseConvention: 'kebab-case',
        separator: '-'
      };
      expect(schemas.settings.safeParse(validNaming).success).toBe(true);

      const invalidNaming = { namingConvention: 'invalid-convention' };
      expect(schemas.settings.safeParse(invalidNaming).success).toBe(false);
    });

    testIfZod('validates file size limits', () => {
      const validLimits = {
        maxFileSize: 1024 * 1024 * 10,
        maxImageFileSize: 1024 * 1024 * 5,
        maxDocumentFileSize: 1024 * 1024 * 5,
        maxTextFileSize: 1024 * 1024
      };
      expect(schemas.settings.safeParse(validLimits).success).toBe(true);

      const invalidLimit = { maxFileSize: 100 }; // Too small
      expect(schemas.settings.safeParse(invalidLimit).success).toBe(false);
    });

    testIfZod('validates timeouts and retry settings', () => {
      const validProcess = {
        analysisTimeout: 30000,
        fileOperationTimeout: 5000,
        retryAttempts: 3,
        saveDebounceMs: 1000
      };
      expect(schemas.settings.safeParse(validProcess).success).toBe(true);

      const invalidTimeout = { analysisTimeout: 100 }; // Too small
      expect(schemas.settings.safeParse(invalidTimeout).success).toBe(false);
    });
  });

  describe('smartFolder schema', () => {
    testIfZod('accepts valid smart folder', () => {
      const result = schemas.smartFolder.safeParse({
        name: 'Documents',
        path: '/home/user/Documents'
      });
      expect(result.success).toBe(true);
    });

    testIfZod('accepts smart folder with all fields', () => {
      const result = schemas.smartFolder.safeParse({
        id: 'folder-1',
        name: 'Documents',
        path: '/home/user/Documents',
        description: 'Important documents',
        keywords: ['important', 'docs'],
        category: 'personal',
        isDefault: false
      });
      expect(result.success).toBe(true);
    });

    testIfZod('rejects empty name', () => {
      const result = schemas.smartFolder.safeParse({
        name: '',
        path: '/path'
      });
      expect(result.success).toBe(false);
    });

    testIfZod('rejects empty path', () => {
      const result = schemas.smartFolder.safeParse({
        name: 'Folder',
        path: ''
      });
      expect(result.success).toBe(false);
    });
  });

  describe('batchOrganize schema', () => {
    testIfZod('accepts valid batch operations', () => {
      const result = schemas.batchOrganize.safeParse({
        operations: [
          { source: '/src/file1.pdf', destination: '/dest/file1.pdf' },
          { source: '/src/file2.pdf', destination: '/dest/file2.pdf' }
        ]
      });
      expect(result.success).toBe(true);
    });

    testIfZod('rejects empty operations array', () => {
      const result = schemas.batchOrganize.safeParse({
        operations: []
      });
      expect(result.success).toBe(false);
    });

    testIfZod('rejects operations with empty source', () => {
      const result = schemas.batchOrganize.safeParse({
        operations: [{ source: '', destination: '/dest/file.pdf' }]
      });
      expect(result.success).toBe(false);
    });
  });

  describe('fileOperation schema', () => {
    testIfZod('rejects batch_organize without operations', () => {
      const result = schemas.fileOperation.safeParse({
        type: 'batch_organize'
      });
      expect(result.success).toBe(false);
    });

    testIfZod('accepts batch_organize with operations', () => {
      const result = schemas.fileOperation.safeParse({
        type: 'batch_organize',
        operations: [{ source: '/src/file1.pdf', destination: '/dest/file1.pdf' }]
      });
      expect(result.success).toBe(true);
    });
  });

  describe('pagination schema', () => {
    testIfZod('accepts valid pagination', () => {
      const result = schemas.pagination.safeParse({
        limit: 50,
        offset: 10
      });
      expect(result.success).toBe(true);
    });

    testIfZod('rejects negative offset', () => {
      const result = schemas.pagination.safeParse({
        offset: -1
      });
      expect(result.success).toBe(false);
    });

    testIfZod('rejects limit above maximum', () => {
      const result = schemas.pagination.safeParse({
        limit: 2000
      });
      expect(result.success).toBe(false);
    });
  });

  describe('searchQuery schema', () => {
    testIfZod('accepts valid search query', () => {
      const result = schemas.searchQuery.safeParse({
        query: 'test search',
        limit: 20
      });
      expect(result.success).toBe(true);
    });

    testIfZod('accepts query with all option', () => {
      const result = schemas.searchQuery.safeParse({
        all: true
      });
      expect(result.success).toBe(true);
    });
  });

  describe('analysisFile schema', () => {
    testIfZod('accepts valid analysis file', () => {
      const result = schemas.analysisFile.safeParse({
        path: '/path/to/file.pdf',
        name: 'file.pdf',
        size: 1024,
        type: 'application/pdf'
      });
      expect(result.success).toBe(true);
    });

    testIfZod('accepts minimal analysis file', () => {
      const result = schemas.analysisFile.safeParse({
        path: '/path/to/file.pdf'
      });
      expect(result.success).toBe(true);
    });

    testIfZod('rejects missing path', () => {
      const result = schemas.analysisFile.safeParse({
        name: 'file.pdf'
      });
      expect(result.success).toBe(false);
    });
  });

  describe('feedback schema', () => {
    testIfZod('accepts valid feedback', () => {
      const result = schemas.feedback.safeParse({
        file: { path: '/path/to/file.pdf' },
        suggestion: { folder: 'Documents', confidence: 0.9 },
        accepted: true
      });
      expect(result.success).toBe(true);
    });

    testIfZod('requires accepted boolean', () => {
      const result = schemas.feedback.safeParse({
        file: { path: '/path/to/file.pdf' },
        suggestion: { folder: 'Documents' }
      });
      expect(result.success).toBe(false);
    });
  });

  describe('findSimilar schema', () => {
    testIfZod('accepts valid input', () => {
      const result = schemas.findSimilar.safeParse({
        fileId: 'file-123',
        topK: 5
      });
      expect(result.success).toBe(true);
    });

    testIfZod('applies default topK', () => {
      const result = schemas.findSimilar.safeParse({
        fileId: 'file-123'
      });
      expect(result.success).toBe(true);
      expect(result.data.topK).toBe(10);
    });

    testIfZod('rejects missing fileId', () => {
      const result = schemas.findSimilar.safeParse({
        topK: 5
      });
      expect(result.success).toBe(false);
    });

    testIfZod('rejects topK above max', () => {
      const result = schemas.findSimilar.safeParse({
        fileId: 'file-123',
        topK: 200
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ollamaHost schema', () => {
    testIfZod('accepts valid URL', () => {
      const result = schemas.ollamaHost.safeParse('http://localhost:11434');
      expect(result.success).toBe(true);
    });

    testIfZod('accepts URL pasted from a command (extracts first URL-like token)', () => {
      const result = schemas.ollamaHost.safeParse('curl http://127.0.0.1:11434/api/tags');
      expect(result.success).toBe(true);
      expect(result.data).toBe('http://127.0.0.1:11434/api/tags');
    });

    testIfZod('accepts a URL with duplicated protocol (normalizes it)', () => {
      const result = schemas.ollamaHost.safeParse('http://http://127.0.0.1:11434');
      expect(result.success).toBe(true);
      expect(result.data).toBe('http://127.0.0.1:11434');
    });

    testIfZod('accepts empty string', () => {
      const result = schemas.ollamaHost.safeParse('');
      expect(result.success).toBe(true);
    });

    testIfZod('accepts undefined', () => {
      const result = schemas.ollamaHost.safeParse(undefined);
      expect(result.success).toBe(true);
    });
  });

  describe('thresholds schema', () => {
    testIfZod('accepts valid thresholds', () => {
      const result = schemas.thresholds.safeParse({
        thresholds: {
          autoApprove: 0.9,
          review: 0.5,
          reject: 0.2
        }
      });
      expect(result.success).toBe(true);
    });

    testIfZod('rejects threshold above 1', () => {
      const result = schemas.thresholds.safeParse({
        thresholds: {
          autoApprove: 1.5
        }
      });
      expect(result.success).toBe(false);
    });

    testIfZod('rejects negative threshold', () => {
      const result = schemas.thresholds.safeParse({
        thresholds: {
          reject: -0.1
        }
      });
      expect(result.success).toBe(false);
    });
  });

  describe('module exports without zod', () => {
    test('exports null schemas when zod is not available', () => {
      // Force zod not to be available
      jest.resetModules();
      jest.doMock('zod', () => {
        throw new Error('Module not found');
      });

      // Re-require the module
      const moduleWithoutZod = require('../src/main/ipc/validationSchemas');

      expect(moduleWithoutZod.z).toBeNull();
      // FIX: Now provides fallback validators instead of null schemas for security
      expect(moduleWithoutZod._usingFallback).toBe(true);
      expect(moduleWithoutZod.schemas).not.toBeNull();
      expect(moduleWithoutZod.schemas.filePath._isFallback).toBe(true);
      expect(moduleWithoutZod.schemas.settings._isFallback).toBe(true);
      expect(moduleWithoutZod.schemas.smartFolder._isFallback).toBe(true);

      // Test that fallback validators work
      const validPath = moduleWithoutZod.schemas.filePath.safeParse('/test/path');
      expect(validPath.success).toBe(true);

      const invalidPath = moduleWithoutZod.schemas.filePath.safeParse('');
      expect(invalidPath.success).toBe(false);
    });
  });
});
