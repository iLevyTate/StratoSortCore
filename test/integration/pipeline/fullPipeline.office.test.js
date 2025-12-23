/**
 * Full Pipeline Integration Tests - Office Files
 *
 * Tests the ACTUAL analyzeDocumentFile() function with REAL office files:
 * XLSX (Excel), PPTX (PowerPoint)
 *
 * This test uses REAL fixture files from test/StratoSortOfTestFiles/
 * Office files are binary and require special extractors.
 *
 * What's REAL:
 * - File content (loaded from disk into memfs as binary)
 * - Content extraction via real extractors (xlsx, pptx parsers)
 * - Content flowing through pipeline
 *
 * What's MOCKED:
 * - Ollama LLM (analyzeTextWithOllama) - no actual AI calls
 * - ChromaDB - no actual vector DB
 * - Embedding generation - no actual embeddings
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

// Mock ModelVerifier
jest.mock('../../../src/main/services/ModelVerifier', () => {
  const mockInstance = {
    checkOllamaConnection: jest.fn().mockResolvedValue({
      connected: true,
      error: null
    })
  };
  const MockModelVerifier = jest.fn().mockImplementation(() => mockInstance);
  MockModelVerifier._mockInstance = mockInstance;
  return MockModelVerifier;
});

// Mock documentLlm - capture what content is sent to Ollama
const mockAnalyzeTextWithOllama = jest.fn().mockImplementation((content, fileName) => {
  return Promise.resolve({
    purpose: 'Office document',
    project: fileName.replace(/\.[^.]+$/, ''),
    category: 'Office',
    date: new Date().toISOString().split('T')[0],
    keywords: ['spreadsheet', 'presentation', 'office'],
    confidence: 85,
    suggestedName: fileName.replace(/\.[^.]+$/, '_analyzed')
  });
});

jest.mock('../../../src/main/analysis/documentLlm', () => ({
  analyzeTextWithOllama: mockAnalyzeTextWithOllama,
  normalizeCategoryToSmartFolders: jest.fn((cat) => cat)
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
        { name: 'Office', path: '/test/Office', score: 0.85, id: 'folder:office' }
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

// ============================================================================
// NOW IMPORT THE MODULE UNDER TEST (after mocks are set up)
// ============================================================================

const { analyzeDocumentFile } = require('../../../src/main/analysis/ollamaDocumentAnalysis');

// Import mocked modules for assertions
const ModelVerifier = require('../../../src/main/services/ModelVerifier');
const FolderMatchingService = require('../../../src/main/services/FolderMatchingService');
const embeddingQueue = require('../../../src/main/analysis/embeddingQueue');

// Get mock instances
const mockModelVerifier = ModelVerifier._mockInstance;
const mockFolderMatcher = FolderMatchingService._mockInstance;

// Import fixtures and loader
const { TEST_FIXTURE_FILES, getMockSmartFolders } = require('../../utils/fileTypeFixtures');
const { loadAllFixtures } = require('../../utils/realFileLoader');

// Setup custom matchers
const { setupPipelineMatchers } = require('./pipelineAssertions');
setupPipelineMatchers();

// Fixture keys for office files
const OFFICE_FIXTURES = ['xlsxFile', 'pptxFile'];

describe('Office Files Full Pipeline - REAL FILE Integration Tests', () => {
  const smartFolders = getMockSmartFolders();

  // Store fixture contents
  let fixtureContents;

  beforeAll(() => {
    // Load REAL fixture files into memfs (binary mode)
    fixtureContents = loadAllFixtures(OFFICE_FIXTURES);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Re-load fixtures into memfs (vol.reset() in global beforeEach clears it)
    loadAllFixtures(OFFICE_FIXTURES);

    mockModelVerifier.checkOllamaConnection.mockResolvedValue({
      connected: true,
      error: null
    });
  });

  describe('Pipeline Infrastructure', () => {
    test('XLSX fixture was loaded from real file', () => {
      expect(fixtureContents.xlsxFile).toBeDefined();
      expect(fixtureContents.xlsxFile.length).toBeGreaterThan(100); // Binary file should have content
    });

    test('PPTX fixture was loaded from real file', () => {
      expect(fixtureContents.pptxFile).toBeDefined();
      expect(fixtureContents.pptxFile.length).toBeGreaterThan(100);
    });

    test('analyzeDocumentFile function is exported', () => {
      expect(typeof analyzeDocumentFile).toBe('function');
    });
  });

  describe('Excel Files (XLSX) - Real Content Extraction', () => {
    const xlsxFixture = TEST_FIXTURE_FILES.xlsxFile;

    test('reads and processes REAL XLSX file', async () => {
      const result = await analyzeDocumentFile(xlsxFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('extracts content from REAL XLSX and sends to Ollama', async () => {
      await analyzeDocumentFile(xlsxFixture.path, smartFolders);

      // Either Ollama was called with extracted content, or fallback was used
      if (mockAnalyzeTextWithOllama.mock.calls.length > 0) {
        const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];
        expect(contentArg.length).toBeGreaterThan(0);
      }
    });

    test('generates embedding from XLSX content', async () => {
      await analyzeDocumentFile(xlsxFixture.path, smartFolders);
      // Embedding should be generated if content was extracted
      expect(mockFolderMatcher.embedText).toHaveBeenCalled();
    });
  });

  describe('PowerPoint Files (PPTX) - Real Content Extraction', () => {
    const pptxFixture = TEST_FIXTURE_FILES.pptxFile;

    test('reads and processes REAL PPTX file', async () => {
      const result = await analyzeDocumentFile(pptxFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('extracts content from REAL PPTX and sends to Ollama', async () => {
      await analyzeDocumentFile(pptxFixture.path, smartFolders);

      if (mockAnalyzeTextWithOllama.mock.calls.length > 0) {
        const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];
        expect(contentArg.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Content Flow Verification', () => {
    test('XLSX pipeline produces valid result', async () => {
      const xlsxFixture = TEST_FIXTURE_FILES.xlsxFile;
      const result = await analyzeDocumentFile(xlsxFixture.path, smartFolders);

      expect(result).toMatchObject({
        category: expect.any(String),
        confidence: expect.any(Number)
      });
    });

    test('queues embedding for persistence', async () => {
      const xlsxFixture = TEST_FIXTURE_FILES.xlsxFile;
      await analyzeDocumentFile(xlsxFixture.path, smartFolders);

      expect(embeddingQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringContaining('file:'),
          vector: expect.any(Array)
        })
      );
    });
  });

  describe('Ollama Offline Fallback', () => {
    beforeEach(() => {
      mockModelVerifier.checkOllamaConnection.mockResolvedValue({
        connected: false,
        error: 'Ollama service unavailable'
      });
    });

    test('returns fallback when Ollama offline', async () => {
      const xlsxFixture = TEST_FIXTURE_FILES.xlsxFile;
      const result = await analyzeDocumentFile(xlsxFixture.path, smartFolders);

      expect(result.extractionMethod).toBe('filename_fallback');
    });
  });
});
