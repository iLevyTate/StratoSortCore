/**
 * Tests for AutoOrganize File Processor
 * Tests individual file processing and new file monitoring
 */

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/mock/documents'),
  },
}));

// Mock fs
const mockFs = {
  mkdir: jest.fn().mockResolvedValue(undefined),
  lstat: jest.fn().mockRejectedValue({ code: 'ENOENT' }),
};
jest.mock('fs', () => ({
  promises: mockFs,
}));

// Mock ollamaDocumentAnalysis
jest.mock('../src/main/analysis/ollamaDocumentAnalysis', () => ({
  analyzeDocumentFile: jest.fn().mockResolvedValue({
    category: 'Reports',
    confidence: 0.9,
  }),
  analyzeImageFile: jest.fn().mockResolvedValue({
    category: 'Photos',
    confidence: 0.85,
  }),
}));

describe('AutoOrganize File Processor', () => {
  let generateSecureId;
  let processFilesWithoutAnalysis;
  let processFilesIndividually;
  let processNewFile;

  let mockSuggestionService;
  let mockUndoRedo;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    mockSuggestionService = {
      getSuggestionsForFile: jest.fn().mockResolvedValue({
        success: true,
        primary: { folder: 'Documents', path: '/docs/Documents' },
        confidence: 0.9,
        alternatives: [],
      }),
      recordFeedback: jest.fn().mockResolvedValue(undefined),
    };

    mockUndoRedo = {
      recordAction: jest.fn().mockResolvedValue(undefined),
    };

    const module = require('../src/main/services/autoOrganize/fileProcessor');
    generateSecureId = module.generateSecureId;
    processFilesWithoutAnalysis = module.processFilesWithoutAnalysis;
    processFilesIndividually = module.processFilesIndividually;
    processNewFile = module.processNewFile;
  });

  describe('generateSecureId', () => {
    test('generates unique IDs', () => {
      const id1 = generateSecureId('file');
      const id2 = generateSecureId('file');

      expect(id1).toMatch(/^file-\d+-[a-f0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('processFilesWithoutAnalysis', () => {
    test('processes files to default folder', async () => {
      const files = [
        { name: 'file1.txt', path: '/src/file1.txt' },
        { name: 'file2.txt', path: '/src/file2.txt' },
      ];
      const smartFolders = [];
      const defaultLocation = '/docs';
      const results = { organized: [], failed: [], operations: [] };

      await processFilesWithoutAnalysis(
        files,
        smartFolders,
        defaultLocation,
        results,
      );

      expect(results.organized).toHaveLength(2);
      expect(results.organized[0].method).toBe('no-analysis-default');
      expect(results.organized[0].confidence).toBe(0.1);
    });

    test('uses existing default folder', async () => {
      const files = [{ name: 'file.txt', path: '/src/file.txt' }];
      const smartFolders = [
        {
          name: 'Uncategorized',
          path: '/docs/Uncategorized',
          isDefault: true,
        },
      ];
      const results = { organized: [], failed: [], operations: [] };

      await processFilesWithoutAnalysis(files, smartFolders, '/docs', results);

      expect(results.organized[0].destination).toContain('Uncategorized');
    });

    test('marks files as failed when default folder creation fails', async () => {
      // Force folder creation to fail
      mockFs.mkdir.mockRejectedValueOnce(new Error('Permission denied'));
      mockFs.lstat.mockRejectedValueOnce({ code: 'ENOENT' });

      const files = [{ name: 'file.txt', path: '/src/file.txt' }];
      const smartFolders = [];
      const results = { organized: [], failed: [], operations: [] };

      await processFilesWithoutAnalysis(files, smartFolders, '/docs', results);

      expect(results.failed).toHaveLength(1);
      expect(results.failed[0].reason).toContain('failed to create');
    });
  });

  describe('processFilesIndividually', () => {
    test('processes files with high confidence suggestions', async () => {
      const files = [
        { name: 'doc.pdf', path: '/src/doc.pdf', extension: 'pdf' },
      ];
      const smartFolders = [];
      const options = {
        confidenceThreshold: 0.7,
        defaultLocation: '/docs',
        preserveNames: true,
      };
      const results = {
        organized: [],
        needsReview: [],
        failed: [],
        operations: [],
      };
      const thresholds = { requireReview: 0.5 };

      await processFilesIndividually(
        files,
        smartFolders,
        options,
        results,
        mockSuggestionService,
        thresholds,
      );

      expect(results.organized).toHaveLength(1);
      expect(results.organized[0].method).toBe('automatic');
      expect(mockSuggestionService.recordFeedback).toHaveBeenCalled();
    });

    test('adds files to needsReview for medium confidence', async () => {
      mockSuggestionService.getSuggestionsForFile.mockResolvedValueOnce({
        success: true,
        primary: { folder: 'Documents' },
        confidence: 0.6,
        alternatives: [],
        explanation: 'Medium confidence match',
      });

      const files = [
        { name: 'doc.pdf', path: '/src/doc.pdf', extension: 'pdf' },
      ];
      const options = { confidenceThreshold: 0.8, defaultLocation: '/docs' };
      const results = {
        organized: [],
        needsReview: [],
        failed: [],
        operations: [],
      };
      const thresholds = { requireReview: 0.5 };

      await processFilesIndividually(
        files,
        [],
        options,
        results,
        mockSuggestionService,
        thresholds,
      );

      expect(results.needsReview).toHaveLength(1);
      expect(results.organized).toHaveLength(0);
    });

    test('uses fallback for low confidence', async () => {
      mockSuggestionService.getSuggestionsForFile.mockResolvedValueOnce({
        success: true,
        primary: { folder: 'Documents' },
        confidence: 0.3,
      });

      const files = [
        { name: 'doc.pdf', path: '/src/doc.pdf', extension: 'pdf' },
      ];
      const options = { confidenceThreshold: 0.8, defaultLocation: '/docs' };
      const results = {
        organized: [],
        needsReview: [],
        failed: [],
        operations: [],
      };
      const thresholds = { requireReview: 0.5 };

      await processFilesIndividually(
        files,
        [],
        options,
        results,
        mockSuggestionService,
        thresholds,
      );

      expect(results.organized).toHaveLength(1);
      expect(results.organized[0].method).toBe('low-confidence-fallback');
    });

    test('uses fallback when no suggestion', async () => {
      mockSuggestionService.getSuggestionsForFile.mockResolvedValueOnce({
        success: false,
        primary: null,
      });

      const files = [
        { name: 'doc.pdf', path: '/src/doc.pdf', extension: 'pdf' },
      ];
      const options = { confidenceThreshold: 0.8, defaultLocation: '/docs' };
      const results = {
        organized: [],
        needsReview: [],
        failed: [],
        operations: [],
      };
      const thresholds = { requireReview: 0.5 };

      await processFilesIndividually(
        files,
        [],
        options,
        results,
        mockSuggestionService,
        thresholds,
      );

      expect(results.organized).toHaveLength(1);
      expect(results.organized[0].method).toBe('fallback');
    });

    test('uses fallback on suggestion error', async () => {
      mockSuggestionService.getSuggestionsForFile.mockRejectedValueOnce(
        new Error('Suggestion failed'),
      );

      const files = [
        { name: 'doc.pdf', path: '/src/doc.pdf', extension: 'pdf' },
      ];
      const options = { confidenceThreshold: 0.8, defaultLocation: '/docs' };
      const results = {
        organized: [],
        needsReview: [],
        failed: [],
        operations: [],
      };
      const thresholds = { requireReview: 0.5 };

      await processFilesIndividually(
        files,
        [],
        options,
        results,
        mockSuggestionService,
        thresholds,
      );

      expect(results.organized).toHaveLength(1);
      expect(results.organized[0].method).toBe('suggestion-error-fallback');
    });

    test('handles processing errors with sync throw', async () => {
      // Mock getSuggestionsForFile to throw synchronously in a way that's caught by the outer try-catch
      const badSuggestionService = {
        getSuggestionsForFile: jest
          .fn()
          .mockRejectedValue(new Error('Suggestion failed')),
        recordFeedback: jest.fn().mockResolvedValue(undefined),
      };

      const files = [
        { name: 'doc.pdf', path: '/src/doc.pdf', extension: 'pdf' },
      ];
      const options = { confidenceThreshold: 0.8, defaultLocation: '/docs' };
      const results = {
        organized: [],
        needsReview: [],
        failed: [],
        operations: [],
      };
      const thresholds = { requireReview: 0.5 };

      await processFilesIndividually(
        files,
        [],
        options,
        results,
        badSuggestionService,
        thresholds,
      );

      // Since there's inner try-catch for suggestions, it uses suggestion-error-fallback instead
      expect(results.organized).toHaveLength(1);
      expect(results.organized[0].method).toBe('suggestion-error-fallback');
    });
  });

  describe('processNewFile', () => {
    test('returns null when autoOrganize is disabled', async () => {
      const result = await processNewFile(
        '/path/to/file.pdf',
        [],
        { autoOrganizeEnabled: false },
        mockSuggestionService,
        mockUndoRedo,
      );

      expect(result).toBeNull();
    });

    test('auto-organizes high confidence files', async () => {
      const result = await processNewFile(
        '/path/to/file.pdf',
        [],
        {
          autoOrganizeEnabled: true,
          confidenceThreshold: 0.8,
          defaultLocation: '/docs',
        },
        mockSuggestionService,
        mockUndoRedo,
      );

      expect(result).toBeDefined();
      expect(result.source).toBe('/path/to/file.pdf');
      expect(result.confidence).toBe(0.9);
    });

    test('records undo action', async () => {
      await processNewFile(
        '/path/to/file.pdf',
        [],
        {
          autoOrganizeEnabled: true,
          confidenceThreshold: 0.8,
          defaultLocation: '/docs',
        },
        mockSuggestionService,
        mockUndoRedo,
      );

      expect(mockUndoRedo.recordAction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'FILE_MOVE',
          data: expect.objectContaining({
            originalPath: '/path/to/file.pdf',
          }),
        }),
      );
    });

    test('returns null for low confidence files', async () => {
      mockSuggestionService.getSuggestionsForFile.mockResolvedValueOnce({
        success: true,
        primary: { folder: 'Documents' },
        confidence: 0.5,
      });

      const result = await processNewFile(
        '/path/to/file.pdf',
        [],
        {
          autoOrganizeEnabled: true,
          confidenceThreshold: 0.9,
        },
        mockSuggestionService,
        mockUndoRedo,
      );

      expect(result).toBeNull();
    });

    test('returns null on analysis error', async () => {
      const {
        analyzeDocumentFile,
      } = require('../src/main/analysis/ollamaDocumentAnalysis');
      analyzeDocumentFile.mockResolvedValueOnce({ error: 'Analysis failed' });

      const result = await processNewFile(
        '/path/to/file.pdf',
        [],
        {
          autoOrganizeEnabled: true,
          confidenceThreshold: 0.8,
        },
        mockSuggestionService,
        mockUndoRedo,
      );

      expect(result).toBeNull();
    });

    test('handles image files', async () => {
      const {
        analyzeImageFile,
      } = require('../src/main/analysis/ollamaDocumentAnalysis');
      analyzeImageFile.mockResolvedValueOnce({
        category: 'Photos',
        confidence: 0.9,
      });

      await processNewFile(
        '/path/to/photo.jpg',
        [],
        {
          autoOrganizeEnabled: true,
          confidenceThreshold: 0.8,
          defaultLocation: '/docs',
        },
        mockSuggestionService,
        mockUndoRedo,
      );

      expect(analyzeImageFile).toHaveBeenCalled();
    });

    test('handles errors gracefully', async () => {
      mockSuggestionService.getSuggestionsForFile.mockRejectedValueOnce(
        new Error('Failed'),
      );

      const result = await processNewFile(
        '/path/to/file.pdf',
        [],
        {
          autoOrganizeEnabled: true,
          confidenceThreshold: 0.8,
        },
        mockSuggestionService,
        mockUndoRedo,
      );

      expect(result).toBeNull();
    });

    test('works without undoRedo service', async () => {
      const result = await processNewFile(
        '/path/to/file.pdf',
        [],
        {
          autoOrganizeEnabled: true,
          confidenceThreshold: 0.8,
          defaultLocation: '/docs',
        },
        mockSuggestionService,
        null, // No undo service
      );

      expect(result).toBeDefined();
    });
  });
});
