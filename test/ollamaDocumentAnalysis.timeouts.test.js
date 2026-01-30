/**
 * Verifies long-running extraction steps are wrapped with withTimeout
 */

jest.mock('../src/main/utils/ollamaDetection', () => ({
  isOllamaRunningWithRetry: jest.fn().mockResolvedValue(true)
}));

jest.mock('../src/main/ollamaUtils', () => ({
  getOllamaHost: jest.fn(() => 'http://localhost:11434'),
  getOllamaModel: jest.fn(() => 'test-model'),
  loadOllamaConfig: jest.fn().mockResolvedValue({ selectedTextModel: 'test-model' })
}));

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
  analyzeTextWithOllama: jest.fn().mockResolvedValue({
    category: 'doc',
    keywords: [],
    purpose: 'test',
    confidence: 0.8
  }),
  normalizeCategoryToSmartFolders: jest.fn((category) => category),
  AppConfig: { ai: { textAnalysis: { defaultModel: 'test-model' } } }
}));

jest.mock('../src/main/analysis/semanticFolderMatcher', () => ({
  applySemanticFolderMatching: jest.fn(),
  getServices: jest.fn(() => ({ matcher: null }))
}));

jest.mock('../src/main/analysis/embeddingQueue', () => ({
  flush: jest.fn().mockResolvedValue()
}));

let withTimeout;
let extractTextFromPdf;
let ocrPdfIfNeeded;
let extractTextFromDocx;

describe('ollamaDocumentAnalysis timeouts', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    const promiseUtils = require('../src/shared/promiseUtils');
    withTimeout = jest.spyOn(promiseUtils, 'withTimeout').mockImplementation((promise) => promise);

    const documentExtractors = require('../src/main/analysis/documentExtractors');
    extractTextFromPdf = documentExtractors.extractTextFromPdf;
    ocrPdfIfNeeded = documentExtractors.ocrPdfIfNeeded;
    extractTextFromDocx = documentExtractors.extractTextFromDocx;
  });

  test('wraps PDF extraction with withTimeout', async () => {
    extractTextFromPdf.mockResolvedValue('pdf body');
    const { analyzeDocumentFile } = require('../src/main/analysis/ollamaDocumentAnalysis');

    await analyzeDocumentFile('/tmp/file.pdf', []);

    expect(withTimeout).toHaveBeenCalledWith(
      expect.any(Promise),
      expect.any(Number),
      expect.stringContaining('PDF extraction')
    );
    expect(withTimeout).toHaveBeenCalledTimes(1);
  });

  test('wraps OCR fallback when PDF extraction yields no text', async () => {
    extractTextFromPdf.mockResolvedValue('');
    ocrPdfIfNeeded.mockResolvedValue('ocr text');
    const { analyzeDocumentFile } = require('../src/main/analysis/ollamaDocumentAnalysis');

    await analyzeDocumentFile('/tmp/file.pdf', []);

    const labels = withTimeout.mock.calls.map((call) => call[2]);
    expect(labels.some((label) => String(label).includes('PDF extraction'))).toBe(true);
    expect(labels.some((label) => String(label).includes('OCR'))).toBe(true);
  });

  test('wraps office extraction with withTimeout', async () => {
    extractTextFromDocx.mockResolvedValue('docx body');
    const { analyzeDocumentFile } = require('../src/main/analysis/ollamaDocumentAnalysis');

    await analyzeDocumentFile('/tmp/file.docx', []);

    expect(withTimeout).toHaveBeenCalledWith(
      expect.any(Promise),
      expect.any(Number),
      expect.stringContaining('Office extraction')
    );
  });
});
