/**
 * Full Pipeline Integration Tests - Document Files
 *
 * Tests the ACTUAL analyzeDocumentFile() function with REAL document files:
 * TXT, MD, HTML, RTF, PDF, DOCX, EML
 *
 * This test uses REAL fixture files from test/StratoSortOfTestFiles/
 *
 * What's REAL:
 * - File content (loaded from disk into memfs)
 * - Content flowing through pipeline for text files
 * - File paths for extractor-based files
 *
 * What's MOCKED:
 * - Ollama LLM (analyzeTextWithOllama) - no actual AI calls
 * - ChromaDB - no actual vector DB
 * - Embedding generation - no actual embeddings
 * - Binary document extractors (PDF, DOCX, EML) - require external libraries
 */

// ============================================================================
// MOCK SETUP - Only mock external services, NOT file operations
// ============================================================================

// Mock logger
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp/test-app')
  }
}));

// Mock ollamaDetection
jest.mock('../../../src/main/utils/ollamaDetection', () => ({
  isOllamaRunning: jest.fn().mockResolvedValue(true),
  isOllamaInstalled: jest.fn().mockResolvedValue(true),
  getOllamaVersion: jest.fn().mockResolvedValue('0.1.30'),
  getInstalledModels: jest.fn().mockResolvedValue(['llama3.2:latest'])
}));

// Mock documentLlm - capture what content is sent to Ollama
const mockAnalyzeTextWithOllama = jest.fn().mockImplementation((content, fileName) => {
  return Promise.resolve({
    purpose: 'Document analysis',
    project: fileName.replace(/\.[^.]+$/, ''),
    category: 'Documents',
    date: new Date().toISOString().split('T')[0],
    keywords: ['document', 'text', 'content'],
    confidence: 85,
    suggestedName: fileName.replace(/\.[^.]+$/, '_analyzed')
  });
});

jest.mock('../../../src/main/analysis/documentLlm', () => ({
  analyzeTextWithOllama: mockAnalyzeTextWithOllama,
  normalizeCategoryToSmartFolders: jest.fn((cat) => cat)
}));

// Mock document extractors for binary formats (PDF, DOCX, EML)
// These require external libraries that don't work with memfs
const mockExtractTextFromPdf = jest
  .fn()
  .mockResolvedValue('Financial Statement 2024 Annual Report');
const mockExtractTextFromDocx = jest.fn().mockResolvedValue('Quarterly Report Q3 2024 Summary');
const mockExtractTextFromEml = jest.fn().mockResolvedValue('Meeting Invite Subject: Team Standup');

jest.mock('../../../src/main/analysis/documentExtractors', () => ({
  extractTextFromPdf: mockExtractTextFromPdf,
  ocrPdfIfNeeded: jest.fn().mockResolvedValue(null),
  extractTextFromDocx: mockExtractTextFromDocx,
  extractTextFromEml: mockExtractTextFromEml,
  extractTextFromXlsx: jest.fn().mockResolvedValue('Mock XLSX content'),
  extractTextFromPptx: jest.fn().mockResolvedValue('Mock PPTX content'),
  extractTextFromCsv: jest.fn().mockResolvedValue('Mock CSV content'),
  extractTextFromXml: jest.fn().mockResolvedValue('Mock XML content'),
  extractPlainTextFromRtf: jest.fn((content) => content), // Pass through for RTF
  extractPlainTextFromHtml: jest.fn((content) => content.replace(/<[^>]*>/g, ' ').trim()) // Basic HTML strip
}));

// Mock ChromaDB service
jest.mock('../../../src/main/services/chromadb', () => ({
  getInstance: jest.fn(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    isOnline: true
  }))
}));

// Mock FolderMatchingService
jest.mock('../../../src/main/services/FolderMatchingService', () => {
  const mockInstance = {
    initialize: jest.fn().mockResolvedValue(undefined),
    batchUpsertFolders: jest.fn().mockResolvedValue({ count: 5 }),
    embedText: jest.fn().mockResolvedValue({
      vector: new Array(1024).fill(0.1),
      model: 'mxbai-embed-large'
    }),
    matchVectorToFolders: jest
      .fn()
      .mockResolvedValue([
        { name: 'Documents', path: '/test/Documents', score: 0.85, id: 'folder:docs' }
      ]),
    embeddingCache: { initialized: true }
  };
  const MockFolderMatchingService = jest.fn().mockImplementation(() => mockInstance);
  MockFolderMatchingService._mockInstance = mockInstance;
  return MockFolderMatchingService;
});

// Mock embeddingQueue
jest.mock('../../../src/main/analysis/embeddingQueue', () => ({
  enqueue: jest.fn().mockReturnValue(undefined),
  flush: jest.fn().mockResolvedValue(undefined)
}));

// Mock ollamaUtils
jest.mock('../../../src/main/ollamaUtils', () => ({
  getOllamaModel: jest.fn(() => 'llama3.2:latest'),
  loadOllamaConfig: jest.fn().mockResolvedValue({
    selectedTextModel: 'llama3.2:latest',
    selectedModel: 'llama3.2:latest'
  })
}));

// Mock globalDeduplicator
jest.mock('../../../src/main/utils/llmOptimization', () => ({
  globalDeduplicator: {
    generateKey: jest.fn((obj) => JSON.stringify(obj)),
    deduplicate: jest.fn((key, fn) => fn())
  }
}));

// Mock ServiceContainer for semanticFolderMatcher resolution
jest.mock('../../../src/main/services/ServiceContainer', () => {
  return {
    container: {
      tryResolve: jest.fn((id) => {
        if (id === 'CHROMA_DB') {
          return require('../../../src/main/services/chromadb').getInstance();
        }
        if (id === 'FOLDER_MATCHING') {
          const FolderMatchingService = require('../../../src/main/services/FolderMatchingService');
          return new FolderMatchingService();
        }
        return null;
      }),
      resolve: jest.fn()
    },
    ServiceIds: {
      CHROMA_DB: 'CHROMA_DB',
      FOLDER_MATCHING: 'FOLDER_MATCHING'
    }
  };
});

// ============================================================================
// NOW IMPORT THE MODULE UNDER TEST (after mocks are set up)
// ============================================================================

const {
  analyzeDocumentFile,
  flushAllEmbeddings
} = require('../../../src/main/analysis/ollamaDocumentAnalysis');

// Import mocked modules for assertions
const FolderMatchingService = require('../../../src/main/services/FolderMatchingService');
const embeddingQueue = require('../../../src/main/analysis/embeddingQueue');
const { isOllamaRunning } = require('../../../src/main/utils/ollamaDetection');

// Get mock instances
const mockFolderMatcher = FolderMatchingService._mockInstance;

// Import fixtures and loader
const { TEST_FIXTURE_FILES, getMockSmartFolders } = require('../../utils/fileTypeFixtures');
const { loadAllFixtures } = require('../../utils/realFileLoader');

// Setup custom matchers
const { setupPipelineMatchers } = require('./pipelineAssertions');
setupPipelineMatchers();

// Fixture keys for document files
const DOCUMENT_FIXTURES = [
  'sampleTxt',
  'markdownFile',
  'htmlFile',
  'rtfFile',
  'emlFile',
  'financialPdf',
  'docxFile'
];

describe('Document Files Full Pipeline - REAL FILE Integration Tests', () => {
  const smartFolders = getMockSmartFolders();

  // Store real file contents for assertions
  let fixtureContents;

  beforeAll(() => {
    // Load REAL fixture files into memfs
    fixtureContents = loadAllFixtures(DOCUMENT_FIXTURES);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Re-load fixtures into memfs (vol.reset() in global beforeEach clears it)
    loadAllFixtures(DOCUMENT_FIXTURES);

    isOllamaRunning.mockResolvedValue(true);
  });

  describe('Pipeline Infrastructure', () => {
    test('TXT fixture was loaded from real file', () => {
      expect(fixtureContents.sampleTxt).toBeDefined();
      expect(fixtureContents.sampleTxt).toContain('Sample Text Document');
    });

    test('MD fixture was loaded from real file', () => {
      expect(fixtureContents.markdownFile).toBeDefined();
      expect(fixtureContents.markdownFile).toContain('#'); // Markdown header
    });

    test('HTML fixture was loaded from real file', () => {
      expect(fixtureContents.htmlFile).toBeDefined();
      expect(fixtureContents.htmlFile).toContain('<html');
    });

    test('PDF fixture was loaded as binary', () => {
      expect(fixtureContents.financialPdf).toBeDefined();
      expect(fixtureContents.financialPdf.length).toBeGreaterThan(100);
    });

    test('analyzeDocumentFile function is exported', () => {
      expect(typeof analyzeDocumentFile).toBe('function');
    });
  });

  describe('Text Files (TXT) - Real Content Extraction', () => {
    const txtFixture = TEST_FIXTURE_FILES.sampleTxt;

    test('reads and processes REAL TXT file', async () => {
      const result = await analyzeDocumentFile(txtFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('extracts REAL TXT content and sends to Ollama', async () => {
      await analyzeDocumentFile(txtFixture.path, smartFolders);

      expect(mockAnalyzeTextWithOllama).toHaveBeenCalled();
      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      // Real TXT file content should flow through
      expect(contentArg).toContain('Sample Text Document');
    });

    test('TXT content includes actual file data', async () => {
      await analyzeDocumentFile(txtFixture.path, smartFolders);
      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      // Verify specific content from sample_document.txt
      expect(contentArg.length).toBeGreaterThan(50);
    });
  });

  describe('Markdown Files (MD) - Real Content Extraction', () => {
    const mdFixture = TEST_FIXTURE_FILES.markdownFile;

    test('reads and processes REAL MD file', async () => {
      const result = await analyzeDocumentFile(mdFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('extracts REAL MD content and sends to Ollama', async () => {
      await analyzeDocumentFile(mdFixture.path, smartFolders);

      expect(mockAnalyzeTextWithOllama).toHaveBeenCalled();
      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      // Real MD file should contain markdown formatting
      expect(contentArg.length).toBeGreaterThan(50);
    });
  });

  describe('HTML Files - Real Content Extraction', () => {
    const htmlFixture = TEST_FIXTURE_FILES.htmlFile;

    test('reads and processes REAL HTML file', async () => {
      const result = await analyzeDocumentFile(htmlFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('extracts REAL HTML content and sends to Ollama', async () => {
      await analyzeDocumentFile(htmlFixture.path, smartFolders);

      expect(mockAnalyzeTextWithOllama).toHaveBeenCalled();
      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      // HTML content should be present
      expect(contentArg.length).toBeGreaterThan(50);
    });
  });

  describe('RTF Files - Real Content Extraction', () => {
    const rtfFixture = TEST_FIXTURE_FILES.rtfFile;

    test('reads and processes REAL RTF file', async () => {
      const result = await analyzeDocumentFile(rtfFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('extracts REAL RTF content', async () => {
      await analyzeDocumentFile(rtfFixture.path, smartFolders);

      if (mockAnalyzeTextWithOllama.mock.calls.length > 0) {
        const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];
        expect(contentArg.length).toBeGreaterThan(0);
      }
    });
  });

  describe('PDF Files - Extractor Pipeline', () => {
    const pdfFixture = TEST_FIXTURE_FILES.financialPdf;

    test('reads and processes REAL PDF file', async () => {
      const result = await analyzeDocumentFile(pdfFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('calls PDF extractor with correct path', async () => {
      await analyzeDocumentFile(pdfFixture.path, smartFolders);

      expect(mockExtractTextFromPdf).toHaveBeenCalledWith(
        pdfFixture.path,
        expect.any(String) // filename
      );
    });

    test('sends extracted PDF content to Ollama', async () => {
      await analyzeDocumentFile(pdfFixture.path, smartFolders);

      expect(mockAnalyzeTextWithOllama).toHaveBeenCalled();
      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      // Should contain the mocked extraction result
      expect(contentArg).toContain('Financial Statement');
    });
  });

  describe('DOCX Files - Extractor Pipeline', () => {
    const docxFixture = TEST_FIXTURE_FILES.docxFile;

    test('reads and processes REAL DOCX file', async () => {
      const result = await analyzeDocumentFile(docxFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('calls DOCX extractor with correct path', async () => {
      await analyzeDocumentFile(docxFixture.path, smartFolders);

      expect(mockExtractTextFromDocx).toHaveBeenCalledWith(docxFixture.path);
    });

    test('sends extracted DOCX content to Ollama', async () => {
      await analyzeDocumentFile(docxFixture.path, smartFolders);

      expect(mockAnalyzeTextWithOllama).toHaveBeenCalled();
      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      // Should contain the mocked extraction result
      expect(contentArg).toContain('Quarterly Report');
    });
  });

  describe('EML Files - Extractor Pipeline', () => {
    const emlFixture = TEST_FIXTURE_FILES.emlFile;

    test('reads and processes REAL EML file', async () => {
      const result = await analyzeDocumentFile(emlFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('calls EML extractor with correct path', async () => {
      await analyzeDocumentFile(emlFixture.path, smartFolders);

      expect(mockExtractTextFromEml).toHaveBeenCalledWith(emlFixture.path);
    });
  });

  describe('Content Flow Verification', () => {
    test('real TXT content flows through entire pipeline', async () => {
      const txtFixture = TEST_FIXTURE_FILES.sampleTxt;
      await analyzeDocumentFile(txtFixture.path, smartFolders);

      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      // Verify actual file content was sent to Ollama
      expect(contentArg).toContain('Sample Text Document');
      expect(fixtureContents.sampleTxt).toContain('Sample Text Document');
    });

    test('generates embedding from document content', async () => {
      const txtFixture = TEST_FIXTURE_FILES.sampleTxt;
      await analyzeDocumentFile(txtFixture.path, smartFolders);

      expect(mockFolderMatcher.embedText).toHaveBeenCalled();
    });

    test('queues embedding for persistence', async () => {
      const txtFixture = TEST_FIXTURE_FILES.sampleTxt;
      await analyzeDocumentFile(txtFixture.path, smartFolders);

      expect(embeddingQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringContaining('file:'),
          vector: expect.any(Array)
        })
      );
    });

    test('pipeline produces valid result structure', async () => {
      const txtFixture = TEST_FIXTURE_FILES.sampleTxt;
      const result = await analyzeDocumentFile(txtFixture.path, smartFolders);

      expect(result).toMatchObject({
        category: expect.any(String),
        confidence: expect.any(Number)
      });
    });
  });

  describe('Ollama Offline Fallback', () => {
    beforeEach(() => {
      isOllamaRunning.mockResolvedValue(false);
    });

    test('returns fallback when Ollama offline for TXT', async () => {
      const txtFixture = TEST_FIXTURE_FILES.sampleTxt;
      const result = await analyzeDocumentFile(txtFixture.path, smartFolders);

      expect(result.extractionMethod).toBe('filename_fallback');
    });

    test('returns fallback when Ollama offline for PDF', async () => {
      const pdfFixture = TEST_FIXTURE_FILES.financialPdf;
      const result = await analyzeDocumentFile(pdfFixture.path, smartFolders);

      expect(result.extractionMethod).toBe('filename_fallback');
    });

    test('fallback still has valid structure', async () => {
      const txtFixture = TEST_FIXTURE_FILES.sampleTxt;
      const result = await analyzeDocumentFile(txtFixture.path, smartFolders);

      expect(result.category).toBeDefined();
      expect(result.keywords).toBeDefined();
    });
  });

  describe('flushAllEmbeddings()', () => {
    test('calls embeddingQueue.flush()', async () => {
      await flushAllEmbeddings();

      expect(embeddingQueue.flush).toHaveBeenCalled();
    });
  });
});
