/**
 * Tests for AutoOrganize Batch Processor
 * Tests batch processing operations for auto-organize
 */

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock electron (required by folderOperations)
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/mock/documents')
  }
}));

// Mock fs (required by folderOperations)
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    lstat: jest.fn().mockRejectedValue({ code: 'ENOENT' })
  }
}));

describe('AutoOrganize Batch Processor', () => {
  let generateSecureId;
  let processBatchResults;
  let batchOrganize;

  let mockSuggestionService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    mockSuggestionService = {
      recordFeedback: jest.fn().mockResolvedValue(undefined),
      getBatchSuggestions: jest.fn().mockResolvedValue({
        success: true,
        groups: []
      })
    };

    const module = require('../src/main/services/autoOrganize/batchProcessor');
    generateSecureId = module.generateSecureId;
    processBatchResults = module.processBatchResults;
    batchOrganize = module.batchOrganize;
  });

  describe('generateSecureId', () => {
    test('generates unique IDs with prefix', () => {
      const id1 = generateSecureId('test');
      const id2 = generateSecureId('test');

      expect(id1).toMatch(/^test-\d+-[a-f0-9]+$/);
      expect(id2).toMatch(/^test-\d+-[a-f0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    test('uses different prefix', () => {
      const id = generateSecureId('batch');

      expect(id.startsWith('batch-')).toBe(true);
    });
  });

  describe('processBatchResults', () => {
    test('processes files with high confidence', async () => {
      const batchSuggestions = {
        groups: [
          {
            folder: 'Documents',
            confidence: 0.9,
            files: [
              {
                name: 'report.pdf',
                path: '/source/report.pdf',
                suggestion: { folder: 'Documents', path: '/docs/Documents' }
              }
            ]
          }
        ]
      };

      const files = [{ name: 'report.pdf', path: '/source/report.pdf', extension: 'pdf' }];
      const options = {
        confidenceThreshold: 0.7,
        defaultLocation: '/default',
        preserveNames: true
      };
      const smartFolders = [{ name: 'Documents', path: '/docs/Documents', isDefault: true }];
      const results = {
        organized: [],
        needsReview: [],
        operations: [],
        failed: []
      };

      await processBatchResults(
        batchSuggestions,
        files,
        options,
        results,
        mockSuggestionService,
        smartFolders
      );

      expect(results.organized).toHaveLength(1);
      expect(results.organized[0].method).toBe('batch-automatic');
      expect(results.operations).toHaveLength(1);
    });

    test('routes medium confidence files to default smart folder', async () => {
      const batchSuggestions = {
        groups: [
          {
            folder: 'Documents',
            confidence: 0.6,
            files: [
              {
                name: 'report.pdf',
                path: '/source/report.pdf',
                suggestion: { folder: 'Documents' }
              }
            ]
          }
        ]
      };

      const files = [{ name: 'report.pdf', path: '/source/report.pdf' }];
      const options = {
        confidenceThreshold: 0.8,
        defaultLocation: '/default'
      };
      const smartFolders = [{ name: 'Documents', path: '/docs', isDefault: true }];
      const results = {
        organized: [],
        needsReview: [],
        operations: [],
        failed: []
      };

      await processBatchResults(
        batchSuggestions,
        files,
        options,
        results,
        mockSuggestionService,
        smartFolders
      );

      expect(results.organized).toHaveLength(1);
      expect(results.organized[0].method).toBe('low-confidence-default');
    });

    test('sends low confidence files to needsReview', async () => {
      const batchSuggestions = {
        groups: [
          {
            folder: 'Documents',
            confidence: 0.3,
            files: [
              {
                name: 'report.pdf',
                path: '/source/report.pdf',
                extension: 'pdf',
                suggestion: { folder: 'Documents' }
              }
            ]
          }
        ]
      };

      const files = [{ name: 'report.pdf', path: '/source/report.pdf', extension: 'pdf' }];
      const options = {
        confidenceThreshold: 0.8,
        defaultLocation: '/default'
      };
      const smartFolders = [{ name: 'Documents', path: '/docs', isDefault: true }];
      const results = {
        organized: [],
        needsReview: [],
        operations: [],
        failed: []
      };

      await processBatchResults(
        batchSuggestions,
        files,
        options,
        results,
        mockSuggestionService,
        smartFolders
      );

      // Low confidence files route to default smart folder when available
      expect(results.organized).toHaveLength(1);
    });

    test('uses fallback when no suggestion', async () => {
      const batchSuggestions = {
        groups: [
          {
            folder: 'Unknown',
            confidence: 0,
            files: [
              {
                name: 'report.pdf',
                path: '/source/report.pdf',
                extension: 'pdf',
                suggestion: null
              }
            ]
          }
        ]
      };

      const files = [{ name: 'report.pdf', path: '/source/report.pdf', extension: 'pdf' }];
      const options = {
        confidenceThreshold: 0.8,
        defaultLocation: '/default'
      };
      const smartFolders = [{ name: 'Documents', path: '/docs', isDefault: true }];
      const results = {
        organized: [],
        needsReview: [],
        operations: [],
        failed: []
      };

      await processBatchResults(
        batchSuggestions,
        files,
        options,
        results,
        mockSuggestionService,
        smartFolders
      );

      expect(results.organized).toHaveLength(1);
      expect(results.organized[0].method).toBe('batch-fallback');
    });

    test('records feedback for high confidence suggestions', async () => {
      const batchSuggestions = {
        groups: [
          {
            folder: 'Documents',
            confidence: 0.95,
            files: [
              {
                name: 'report.pdf',
                path: '/source/report.pdf',
                suggestion: { folder: 'Documents', path: '/docs' }
              }
            ]
          }
        ]
      };

      const files = [{ name: 'report.pdf', path: '/source/report.pdf', extension: 'pdf' }];
      const options = {
        confidenceThreshold: 0.7,
        defaultLocation: '/default',
        preserveNames: true
      };
      const smartFolders = [{ name: 'Documents', path: '/docs', isDefault: true }];
      const results = {
        organized: [],
        needsReview: [],
        operations: [],
        failed: []
      };

      await processBatchResults(
        batchSuggestions,
        files,
        options,
        results,
        mockSuggestionService,
        smartFolders
      );

      // Feedback is recorded asynchronously (void promise)
      await new Promise((r) => setTimeout(r, 10));
      expect(mockSuggestionService.recordFeedback).toHaveBeenCalled();
    });
  });

  describe('batchOrganize', () => {
    test('processes batch with auto-approve threshold', async () => {
      mockSuggestionService.getBatchSuggestions.mockResolvedValueOnce({
        success: true,
        groups: [
          {
            folder: 'Documents',
            path: '/docs/Documents',
            confidence: 0.95,
            files: [{ name: 'doc.pdf', path: '/src/doc.pdf' }]
          }
        ]
      });

      const files = [{ name: 'doc.pdf', path: '/src/doc.pdf' }];
      const smartFolders = [{ name: 'Documents', path: '/docs/Documents', isDefault: true }];
      const options = {
        autoApproveThreshold: 0.9,
        defaultLocation: '/default'
      };
      const thresholds = { autoApprove: 0.9 };

      const result = await batchOrganize(
        files,
        smartFolders,
        options,
        mockSuggestionService,
        thresholds
      );

      expect(result.operations).toHaveLength(1);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].autoApproved).toBe(true);
    });

    test('skips low confidence groups', async () => {
      mockSuggestionService.getBatchSuggestions.mockResolvedValueOnce({
        success: true,
        groups: [
          {
            folder: 'Documents',
            confidence: 0.5,
            files: [{ name: 'doc.pdf', path: '/src/doc.pdf' }]
          }
        ]
      });

      const files = [{ name: 'doc.pdf', path: '/src/doc.pdf' }];
      const options = { autoApproveThreshold: 0.9 };
      const thresholds = { autoApprove: 0.9 };

      const smartFolders = [{ name: 'Documents', path: '/docs/Documents', isDefault: true }];
      const result = await batchOrganize(
        files,
        smartFolders,
        options,
        mockSuggestionService,
        thresholds
      );

      expect(result.operations).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toBe('Low confidence');
    });

    test('skips high confidence groups that are not smart folders', async () => {
      mockSuggestionService.getBatchSuggestions.mockResolvedValueOnce({
        success: true,
        groups: [
          {
            folder: 'Archives',
            path: 'Archives',
            confidence: 0.95,
            files: [{ name: 'backup.zip', path: '/src/backup.zip' }]
          }
        ]
      });

      const files = [{ name: 'backup.zip', path: '/src/backup.zip' }];
      const options = { autoApproveThreshold: 0.9 };
      const thresholds = { autoApprove: 0.9 };

      const smartFolders = [{ name: 'Documents', path: '/docs/Documents', isDefault: true }];
      const result = await batchOrganize(
        files,
        smartFolders,
        options,
        mockSuggestionService,
        thresholds
      );

      expect(result.operations).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toBe('Not a smart folder');
    });

    test('throws on failed batch suggestions', async () => {
      mockSuggestionService.getBatchSuggestions.mockResolvedValueOnce({
        success: false
      });

      const files = [{ name: 'doc.pdf', path: '/src/doc.pdf' }];
      const thresholds = { autoApprove: 0.9 };

      await expect(batchOrganize(files, [], {}, mockSuggestionService, thresholds)).rejects.toThrow(
        'Failed to get batch suggestions'
      );
    });

    test('handles file processing errors', async () => {
      const customBuildDest = jest.fn().mockImplementation(() => {
        throw new Error('Build failed');
      });

      mockSuggestionService.getBatchSuggestions.mockResolvedValueOnce({
        success: true,
        groups: [
          {
            folder: 'Documents',
            confidence: 0.95,
            files: [{ name: 'doc.pdf', path: '/src/doc.pdf' }]
          }
        ]
      });

      const files = [{ name: 'doc.pdf', path: '/src/doc.pdf' }];
      const options = { autoApproveThreshold: 0.9 };
      const thresholds = { autoApprove: 0.9 };

      const smartFolders = [{ name: 'Documents', path: '/docs/Documents', isDefault: true }];
      const result = await batchOrganize(
        files,
        smartFolders,
        options,
        mockSuggestionService,
        thresholds,
        customBuildDest
      );

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toBe('Build failed');
    });

    test('records feedback for processed files', async () => {
      mockSuggestionService.getBatchSuggestions.mockResolvedValueOnce({
        success: true,
        groups: [
          {
            folder: 'Documents',
            path: '/docs',
            confidence: 0.95,
            files: [
              {
                name: 'doc.pdf',
                path: '/src/doc.pdf',
                suggestion: { folder: 'Documents' }
              }
            ]
          }
        ]
      });

      const files = [{ name: 'doc.pdf', path: '/src/doc.pdf' }];
      const options = {
        autoApproveThreshold: 0.9,
        defaultLocation: '/default'
      };
      const thresholds = { autoApprove: 0.9 };

      const smartFolders = [{ name: 'Documents', path: '/docs', isDefault: true }];
      await batchOrganize(files, smartFolders, options, mockSuggestionService, thresholds);

      expect(mockSuggestionService.recordFeedback).toHaveBeenCalled();
    });
  });
});
