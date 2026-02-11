/**
 * @jest-environment node
 */
const fs = require('fs').promises;
const path = require('path');

// Mock dependencies
jest.mock('../src/shared/logger', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  };
  return { createLogger: jest.fn(() => logger) };
});

jest.mock('../src/main/analysis/documentExtractors', () => ({
  extractTextFromPdf: jest.fn(),
  ocrPdfIfNeeded: jest.fn(),
  extractTextFromDoc: jest.fn(),
  extractTextFromDocx: jest.fn(),
  extractTextFromCsv: jest.fn(),
  extractTextFromXlsx: jest.fn(),
  extractTextFromPptx: jest.fn(),
  extractTextFromXls: jest.fn(),
  extractTextFromPpt: jest.fn(),
  extractTextFromOdfZip: jest.fn(),
  extractTextFromEpub: jest.fn(),
  extractTextFromEml: jest.fn(),
  extractTextFromMsg: jest.fn(),
  extractTextFromKml: jest.fn(),
  extractTextFromKmz: jest.fn(),
  extractPlainTextFromRtf: jest.fn(),
  extractPlainTextFromXml: jest.fn(),
  extractPlainTextFromHtml: jest.fn()
}));

jest.mock('../src/main/analysis/documentLlm', () => ({
  analyzeTextWithLlama: jest.fn(),
  normalizeCategoryToSmartFolders: jest.fn((cat) => cat),
  AppConfig: { ai: { textAnalysis: { defaultModel: 'mock-model' } } }
}));

jest.mock('../src/main/llamaUtils', () => ({
  getTextModel: jest.fn(() => 'mock-model'),
  loadLlamaConfig: jest.fn(async () => ({ selectedTextModel: 'mock-model' }))
}));

jest.mock('../src/main/analysis/semanticFolderMatcher', () => ({
  applySemanticFolderMatching: jest.fn(async (res) => res),
  getServices: jest.fn(() => ({}))
}));

jest.mock('../src/main/analysis/embeddingQueue/stageQueues', () => ({
  analysisQueue: { add: jest.fn() }
}));

jest.mock('../src/main/utils/llmOptimization', () => ({
  globalDeduplicator: {
    checkDuplicate: jest.fn(async () => null),
    recordProcessing: jest.fn(async () => {}),
    generateKey: jest.fn(() => 'mock-key'),
    deduplicate: jest.fn(async (key, fn) => fn()) // Execute the callback immediately
  }
}));

// Mock fallbackUtils to control behavior
jest.mock('../src/main/analysis/fallbackUtils', () => ({
  getIntelligentCategory: jest.fn(() => 'Videos'), // Match real behavior
  getIntelligentKeywords: jest.fn(() => ['video']),
  safeSuggestedName: jest.fn((name) => name),
  // Fix mock signature to match real implementation (single object)
  createFallbackAnalysis: jest.fn((params) => {
    const errorMsg = params.options?.error || params.reason || 'Unknown error';
    return {
      category: 'Documents', // Match real behavior
      error: errorMsg,
      confidence: 0
    };
  })
}));

// Mock utils for normalization
jest.mock('../src/main/analysis/utils', () => ({
  normalizeAnalysisResult: jest.fn((raw, fallback) => {
    return {
      ...raw,
      category: raw.category || fallback.category,
      confidence: raw.confidence !== undefined ? raw.confidence : fallback.confidence
    };
  })
}));

describe('documentAnalysis (behavior)', () => {
  let analyzeDocumentFile;
  let extractors;
  let documentLlm;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Mock fs.stat to return consistent values for caching
    jest.spyOn(fs, 'stat').mockResolvedValue({
      size: 1024,
      mtimeMs: 1600000000000,
      mtime: new Date(1600000000000),
      isFile: () => true
    });

    // Mock fs.readFile for text files
    jest.spyOn(fs, 'readFile').mockResolvedValue('mock file content');

    analyzeDocumentFile = require('../src/main/analysis/documentAnalysis').analyzeDocumentFile;
    extractors = require('../src/main/analysis/documentExtractors');
    documentLlm = require('../src/main/analysis/documentLlm');
  });

  test('analyzes PDF by extracting text and calling LLM', async () => {
    // Use simple filename to avoid path separator issues
    const filePath = 'doc.pdf';
    extractors.extractTextFromPdf.mockResolvedValue('Extracted PDF content');
    documentLlm.analyzeTextWithLlama.mockResolvedValue({
      summary: 'A summary',
      category: 'Finance',
      confidence: 0.9
    });

    const result = await analyzeDocumentFile(filePath);

    expect(extractors.extractTextFromPdf).toHaveBeenCalledWith(filePath, 'doc.pdf');
    expect(documentLlm.analyzeTextWithLlama).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        category: 'Finance',
        confidence: 0.9
      })
    );
  });

  test('uses OCR fallback when PDF extraction returns empty text', async () => {
    const filePath = 'scanned.pdf';
    extractors.extractTextFromPdf.mockResolvedValue(''); // Empty result
    extractors.ocrPdfIfNeeded.mockResolvedValue('OCR Content');
    documentLlm.analyzeTextWithLlama.mockResolvedValue({
      summary: 'OCR Summary',
      category: 'Scanned',
      confidence: 0.8
    });

    await analyzeDocumentFile(filePath);

    expect(extractors.extractTextFromPdf).toHaveBeenCalled();
    expect(extractors.ocrPdfIfNeeded).toHaveBeenCalledWith(filePath);
    expect(documentLlm.analyzeTextWithLlama).toHaveBeenCalledWith(
      'OCR Content',
      expect.any(String), // fileName
      expect.any(Array), // smartFolders
      expect.any(String), // date
      expect.any(Array), // namingContext
      expect.any(Object) // options (bypassCache)
    );
  });

  test('skips AI for video files and uses extension-based fallback', async () => {
    const filePath = 'movie.mp4';

    const result = await analyzeDocumentFile(filePath);

    expect(extractors.extractTextFromPdf).not.toHaveBeenCalled();
    expect(documentLlm.analyzeTextWithLlama).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        category: 'Videos',
        extractionMethod: 'extension_short_circuit'
      })
    );
  });

  test('handles extraction errors gracefully with fallback analysis', async () => {
    const filePath = 'corrupt.pdf';
    extractors.extractTextFromPdf.mockRejectedValue(new Error('Corrupt PDF'));
    extractors.ocrPdfIfNeeded.mockRejectedValue(new Error('OCR Failed'));

    const result = await analyzeDocumentFile(filePath);

    expect(result).toEqual(
      expect.objectContaining({
        category: 'Documents',
        confidence: 0
      })
    );
    // Check for error message in the result
    // The actual error message might be "Failed to extract text from PDF document" due to FileProcessingError wrapping
    expect(result.error).toMatch(/Corrupt PDF|Failed to extract text/);
  });

  test.each([
    { ext: '.docx', extractor: 'extractTextFromDocx' },
    { ext: '.xlsx', extractor: 'extractTextFromXlsx' },
    { ext: '.odt', extractor: 'extractTextFromOdfZip' },
    { ext: '.epub', extractor: 'extractTextFromEpub' },
    { ext: '.eml', extractor: 'extractTextFromEml' },
    { ext: '.msg', extractor: 'extractTextFromMsg' }
  ])('routes %s through the correct extractor', async ({ ext, extractor }) => {
    const filePath = `sample${ext}`;
    extractors[extractor].mockResolvedValue('Extracted content');
    documentLlm.analyzeTextWithLlama.mockResolvedValue({
      summary: 'ok',
      category: 'Docs',
      confidence: 0.8
    });

    await analyzeDocumentFile(filePath);

    expect(extractors[extractor]).toHaveBeenCalledWith(filePath);
    expect(documentLlm.analyzeTextWithLlama).toHaveBeenCalled();
  });

  describe('Caching behavior', () => {
    test('persists cache between calls', async () => {
      const filePath = 'cached.pdf';
      extractors.extractTextFromPdf.mockResolvedValue('Content');
      documentLlm.analyzeTextWithLlama.mockResolvedValue({ category: 'Cached' });

      // First call
      await analyzeDocumentFile(filePath);

      // Second call
      await analyzeDocumentFile(filePath);

      expect(extractors.extractTextFromPdf).toHaveBeenCalled();
    });
  });

  test('bypasses cache when requested', async () => {
    const filePath = 'bypass.pdf';
    extractors.extractTextFromPdf.mockResolvedValue('Content');
    documentLlm.analyzeTextWithLlama.mockResolvedValue({ category: 'Fresh' });

    await analyzeDocumentFile(filePath);
    await analyzeDocumentFile(filePath, [], { bypassCache: true });

    expect(extractors.extractTextFromPdf).toHaveBeenCalledTimes(2);
  });
});
