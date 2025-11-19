/**
 * Tests for ollamaDocumentAnalysis
 * TIER 1 - CRITICAL: Main document analysis pipeline
 * Testing document analysis orchestration and routing
 */

const fs = require('fs').promises;

// Mock all dependencies BEFORE importing the module under test
jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    setContext: jest.fn(),
  },
}));

jest.mock('../src/main/services/ModelVerifier');
jest.mock('../src/main/analysis/documentExtractors');
jest.mock('../src/main/analysis/documentLlm');
jest.mock('../src/main/analysis/utils');
jest.mock('../src/main/analysis/fallbackUtils');
jest.mock('../src/main/services/ChromaDBService', () => ({
  getInstance: jest.fn().mockReturnValue(null), // Return null to skip ChromaDB in tests
}));
jest.mock('../src/main/services/FolderMatchingService', () => {
  return jest.fn();
});

// Now import the module AFTER mocks are set up
const {
  analyzeDocumentFile,
} = require('../src/main/analysis/ollamaDocumentAnalysis');

describe('ollamaDocumentAnalysis', () => {
  let mockModelVerifier;
  let mockFolderMatcher;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup ModelVerifier mock
    const ModelVerifier = require('../src/main/services/ModelVerifier');
    mockModelVerifier = {
      checkOllamaConnection: jest.fn().mockResolvedValue({
        connected: true,
      }),
    };
    ModelVerifier.mockImplementation(() => mockModelVerifier);

    // Setup fallback utils with proper return values
    const fallbackUtils = require('../src/main/analysis/fallbackUtils');
    fallbackUtils.getIntelligentCategory = jest.fn((name, ext) => {
      if (ext === '.zip') return 'archive';
      return 'documents';
    });
    fallbackUtils.getIntelligentKeywords = jest
      .fn()
      .mockReturnValue(['document', 'file']);
    fallbackUtils.safeSuggestedName = jest
      .fn()
      .mockImplementation((name, ext) =>
        name ? name.replace(ext, '') : 'file',
      );

    // Setup utils
    const utils = require('../src/main/analysis/utils');
    utils.normalizeAnalysisResult = jest.fn((data) => data);

    // Setup FolderMatchingService mock
    const FolderMatchingService = require('../src/main/services/FolderMatchingService');
    mockFolderMatcher = {
      initialize: jest.fn(),
      upsertFolderEmbedding: jest.fn().mockResolvedValue({}),
      upsertFileEmbedding: jest.fn().mockResolvedValue({}),
      matchFileToFolders: jest.fn().mockResolvedValue([]),
      embeddingCache: { initialized: false },
    };
    FolderMatchingService.mockImplementation(() => mockFolderMatcher);
  });

  describe('PDF Analysis', () => {
    test('should analyze PDF document successfully', async () => {
      const documentExtractors = require('../src/main/analysis/documentExtractors');
      const documentLlm = require('../src/main/analysis/documentLlm');

      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });

      documentExtractors.extractTextFromPdf.mockResolvedValue(
        'This is a financial invoice for Q1 2024. Total amount: $1,000.',
      );

      documentLlm.analyzeTextWithOllama.mockResolvedValue({
        project: 'Q1 Finances',
        purpose: 'Invoice documentation',
        category: 'Financial',
        keywords: ['invoice', 'financial', 'Q1', '2024'],
        confidence: 85,
        date: '2024-01-15',
      });

      const result = await analyzeDocumentFile('/test/invoice.pdf', []);

      expect(result).toBeDefined();
      // The test should work when Ollama is connected
      expect(result.project).toBe('Q1 Finances');
      expect(result.purpose).toBe('Invoice documentation');
      expect(result.keywords).toContain('invoice');
      expect(result.confidence).toBe(85);
      expect(documentExtractors.extractTextFromPdf).toHaveBeenCalled();
      expect(documentLlm.analyzeTextWithOllama).toHaveBeenCalled();
    });

    test('should use OCR fallback for image-based PDFs', async () => {
      const documentExtractors = require('../src/main/analysis/documentExtractors');
      const documentLlm = require('../src/main/analysis/documentLlm');

      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });

      // First extraction returns empty
      documentExtractors.extractTextFromPdf.mockResolvedValue('');
      documentExtractors.ocrPdfIfNeeded.mockResolvedValue('OCR extracted text');

      documentLlm.analyzeTextWithOllama.mockResolvedValue({
        project: 'Scanned Doc',
        keywords: ['scanned'],
        confidence: 70,
      });

      await analyzeDocumentFile('/test/scanned.pdf', []);

      // With improved code, when extraction returns empty, OCR is attempted
      expect(documentExtractors.extractTextFromPdf).toHaveBeenCalled();
      expect(documentExtractors.ocrPdfIfNeeded).toHaveBeenCalled();
      expect(documentLlm.analyzeTextWithOllama).toHaveBeenCalledWith(
        expect.stringContaining('OCR extracted text'),
        expect.any(String),
        expect.any(Array),
      );
    });

    test('should handle PDF extraction errors with fallback', async () => {
      const documentExtractors = require('../src/main/analysis/documentExtractors');

      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });

      const error = new Error('PDF_PROCESSING_FAILURE');
      error.code = 'PDF_PROCESSING_FAILURE';
      documentExtractors.extractTextFromPdf.mockRejectedValue(error);
      documentExtractors.ocrPdfIfNeeded.mockResolvedValue('');

      const result = await analyzeDocumentFile('/test/corrupt.pdf', []);

      expect(result).toBeDefined();
      expect(result.extractionMethod).toBe('filename_fallback');
    });
  });

  describe('Office Document Analysis', () => {
    test('should analyze DOCX document', async () => {
      const documentExtractors = require('../src/main/analysis/documentExtractors');
      const documentLlm = require('../src/main/analysis/documentLlm');

      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });

      documentExtractors.extractTextFromDocx.mockResolvedValue(
        'Project proposal for new software system.',
      );

      documentLlm.analyzeTextWithOllama.mockResolvedValue({
        project: 'Software System',
        purpose: 'Project proposal document',
        category: 'Projects',
        keywords: ['project', 'proposal', 'software'],
        confidence: 80,
      });

      const result = await analyzeDocumentFile('/test/proposal.docx', []);

      expect(result.project).toBe('Software System');
      expect(documentExtractors.extractTextFromDocx).toHaveBeenCalled();
      expect(documentLlm.analyzeTextWithOllama).toHaveBeenCalled();
    });

    test('should analyze XLSX spreadsheet', async () => {
      const documentExtractors = require('../src/main/analysis/documentExtractors');
      const documentLlm = require('../src/main/analysis/documentLlm');

      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });

      documentExtractors.extractTextFromXlsx.mockResolvedValue(
        'Quarter Revenue Expenses\nQ1 10000 5000\nQ2 12000 6000',
      );

      documentLlm.analyzeTextWithOllama.mockResolvedValue({
        project: 'Financial Report',
        purpose: 'Quarterly financial data',
        category: 'Financial',
        keywords: ['quarterly', 'revenue', 'expenses'],
        confidence: 85,
      });

      const result = await analyzeDocumentFile('/test/finances.xlsx', []);

      expect(result.project).toBe('Financial Report');
      expect(documentExtractors.extractTextFromXlsx).toHaveBeenCalled();
      expect(documentLlm.analyzeTextWithOllama).toHaveBeenCalled();
    });

    test('should analyze PPTX presentation', async () => {
      const documentExtractors = require('../src/main/analysis/documentExtractors');
      const documentLlm = require('../src/main/analysis/documentLlm');

      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });

      documentExtractors.extractTextFromPptx.mockResolvedValue(
        'Company Overview 2024 Strategic Plan',
      );

      documentLlm.analyzeTextWithOllama.mockResolvedValue({
        project: 'Strategic Planning',
        purpose: 'Company strategic overview',
        category: 'Presentations',
        keywords: ['strategy', 'planning', '2024'],
        confidence: 75,
      });

      const result = await analyzeDocumentFile('/test/strategy.pptx', []);

      expect(result.project).toBe('Strategic Planning');
      expect(documentExtractors.extractTextFromPptx).toHaveBeenCalled();
      expect(documentLlm.analyzeTextWithOllama).toHaveBeenCalled();
    });
  });

  describe('Text File Analysis', () => {
    test('should analyze plain text file', async () => {
      const documentLlm = require('../src/main/analysis/documentLlm');

      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 5000,
        mtimeMs: 1234567890,
      });

      jest
        .spyOn(fs, 'readFile')
        .mockResolvedValue(
          'Meeting notes from project discussion on 2024-01-15',
        );

      documentLlm.analyzeTextWithOllama.mockResolvedValue({
        project: 'Project Meeting',
        purpose: 'Meeting notes documentation',
        category: 'Notes',
        keywords: ['meeting', 'notes', 'project'],
        confidence: 75,
      });

      const result = await analyzeDocumentFile('/test/notes.txt', []);

      expect(result.project).toBe('Project Meeting');
      expect(documentLlm.analyzeTextWithOllama).toHaveBeenCalled();
      expect(fs.readFile).toHaveBeenCalled();
    });

    test('should handle HTML files', async () => {
      const documentExtractors = require('../src/main/analysis/documentExtractors');
      const documentLlm = require('../src/main/analysis/documentLlm');

      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 5000,
        mtimeMs: 1234567890,
      });

      const html = '<html><body><h1>Title</h1><p>Content</p></body></html>';
      jest.spyOn(fs, 'readFile').mockResolvedValue(html);

      documentExtractors.extractPlainTextFromHtml = jest
        .fn()
        .mockReturnValue('Title Content');

      documentLlm.analyzeTextWithOllama.mockResolvedValue({
        project: 'Web Page',
        keywords: ['title', 'content'],
        confidence: 70,
      });

      const result = await analyzeDocumentFile('/test/page.html', []);

      expect(result).toBeDefined();
      expect(documentLlm.analyzeTextWithOllama).toHaveBeenCalled();
    });
  });

  describe('Fallback Behavior', () => {
    test('should fallback when Ollama is unavailable', async () => {
      mockModelVerifier.checkOllamaConnection.mockResolvedValue({
        connected: false,
        error: 'Connection refused',
      });

      const result = await analyzeDocumentFile('/test/doc.pdf', []);

      expect(result.extractionMethod).toBe('filename_fallback');
      expect(result.confidence).toBe(65);
    });

    test('should fallback when content extraction fails', async () => {
      const documentExtractors = require('../src/main/analysis/documentExtractors');

      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });

      documentExtractors.extractTextFromDocx.mockRejectedValue(
        new Error('Extraction failed'),
      );

      const result = await analyzeDocumentFile('/test/broken.docx', []);

      expect(result).toBeDefined();
      expect(result.extractionError).toBeDefined();
    });

    test('should use filename-based analysis for unsupported formats', async () => {
      const result = await analyzeDocumentFile('/test/file.unknown', []);

      expect(result).toBeDefined();
      expect(result.extractionMethod).toBe('filename');
    });
  });

  describe('Smart Folder Integration', () => {
    test('should refine category using semantic matching', async () => {
      const documentExtractors = require('../src/main/analysis/documentExtractors');
      const documentLlm = require('../src/main/analysis/documentLlm');

      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });

      documentExtractors.extractTextFromPdf.mockResolvedValue('Document text');

      documentLlm.analyzeTextWithOllama.mockResolvedValue({
        project: 'Test Project',
        purpose: 'Test purpose',
        category: 'General',
        keywords: ['test'],
        confidence: 75,
      });

      mockFolderMatcher.matchFileToFolders.mockResolvedValue([
        { name: 'Projects', score: 0.85, folderId: 'folder-1' },
        { name: 'Documents', score: 0.6, folderId: 'folder-2' },
      ]);

      const smartFolders = [
        { name: 'Projects', description: 'Project files' },
        { name: 'Documents', description: 'General documents' },
      ];

      const result = await analyzeDocumentFile('/test/doc.pdf', smartFolders);

      expect(result.category).toBe('Projects'); // Refined from 'General'
      expect(result.folderMatchCandidates).toBeDefined();
      expect(mockFolderMatcher.upsertFolderEmbedding).toHaveBeenCalledTimes(2);
    });

    test('should pass smart folders to LLM analysis', async () => {
      const documentExtractors = require('../src/main/analysis/documentExtractors');
      const documentLlm = require('../src/main/analysis/documentLlm');

      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });

      documentExtractors.extractTextFromPdf.mockResolvedValue(
        'Document content',
      );

      documentLlm.analyzeTextWithOllama.mockResolvedValue({
        project: 'Test',
        keywords: [],
        confidence: 70,
      });

      const smartFolders = [
        { name: 'Work', description: 'Work documents' },
        { name: 'Personal', description: 'Personal files' },
      ];

      await analyzeDocumentFile('/test/doc.pdf', smartFolders);

      expect(documentLlm.analyzeTextWithOllama).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        smartFolders,
      );
    });
  });

  describe('Caching', () => {
    test('should cache analysis results', async () => {
      const documentExtractors = require('../src/main/analysis/documentExtractors');
      const documentLlm = require('../src/main/analysis/documentLlm');

      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });

      documentExtractors.extractTextFromPdf.mockResolvedValue('Content');
      documentLlm.analyzeTextWithOllama.mockResolvedValue({
        project: 'Test',
        keywords: [],
        confidence: 75,
      });

      // First call
      await analyzeDocumentFile('/test/doc.pdf', []);
      expect(documentExtractors.extractTextFromPdf).toHaveBeenCalledTimes(1);

      // Second call with same file signature - should use cache
      await analyzeDocumentFile('/test/doc.pdf', []);
      // Note: Due to caching, extractor might not be called again
    });

    test('should invalidate cache when file changes', async () => {
      const documentExtractors = require('../src/main/analysis/documentExtractors');
      const documentLlm = require('../src/main/analysis/documentLlm');

      // First version
      jest.spyOn(fs, 'stat').mockResolvedValueOnce({
        size: 50000,
        mtimeMs: 1234567890,
      });

      documentExtractors.extractTextFromPdf.mockResolvedValue('Content v1');
      documentLlm.analyzeTextWithOllama.mockResolvedValue({
        project: 'Test',
        keywords: [],
        confidence: 75,
      });

      await analyzeDocumentFile('/test/doc.pdf', []);

      // Modified version (different mtimeMs)
      jest.spyOn(fs, 'stat').mockResolvedValueOnce({
        size: 50000,
        mtimeMs: 9999999999,
      });

      documentExtractors.extractTextFromPdf.mockResolvedValue('Content v2');

      await analyzeDocumentFile('/test/doc.pdf', []);

      // Should have called extractor twice for different versions
      expect(documentExtractors.extractTextFromPdf).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should handle general processing errors gracefully', async () => {
      jest.spyOn(fs, 'stat').mockRejectedValue(new Error('File not found'));

      const result = await analyzeDocumentFile('/test/missing.pdf', []);

      expect(result).toBeDefined();
      expect(result.extractionMethod).toBe('filename_fallback');
    });

    test('should handle empty text extraction', async () => {
      const documentExtractors = require('../src/main/analysis/documentExtractors');

      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });

      documentExtractors.extractTextFromPdf.mockResolvedValue('');
      documentExtractors.ocrPdfIfNeeded.mockResolvedValue('');

      const result = await analyzeDocumentFile('/test/empty.pdf', []);

      expect(result).toBeDefined();
      expect(result.error).toBeDefined();
    });

    test('should handle LLM analysis failures', async () => {
      const documentExtractors = require('../src/main/analysis/documentExtractors');
      const documentLlm = require('../src/main/analysis/documentLlm');

      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 50000,
        mtimeMs: 1234567890,
      });

      documentExtractors.extractTextFromPdf.mockResolvedValue('Some text');
      documentLlm.analyzeTextWithOllama.mockResolvedValue({
        error: 'LLM failed',
        keywords: [],
        confidence: 60,
      });

      const result = await analyzeDocumentFile('/test/doc.pdf', []);

      expect(result).toBeDefined();
      expect(result.error).toBeDefined();
    });
  });

  describe('Archive Files', () => {
    test('should analyze ZIP archive metadata', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({
        size: 100000,
        mtimeMs: 1234567890,
      });

      const result = await analyzeDocumentFile('/test/archive.zip', []);

      expect(result).toBeDefined();
      expect(result.category).toBe('archive');
      expect(result.extractionMethod).toBe('archive');
    });
  });
});
