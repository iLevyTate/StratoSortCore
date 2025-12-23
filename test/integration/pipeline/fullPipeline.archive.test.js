/**
 * Full Pipeline Integration Tests - Archive Files
 *
 * Tests the ACTUAL analyzeDocumentFile() function with REAL archive files:
 * ZIP
 *
 * This test uses REAL fixture files from test/StratoSortOfTestFiles/
 *
 * What's REAL:
 * - Archive file content (loaded from disk into memfs as binary)
 * - File paths pointing to real fixtures
 *
 * What's MOCKED:
 * - Ollama LLM - no actual AI calls
 * - ChromaDB - no actual vector DB
 * - Embedding generation - no actual embeddings
 * - AdmZip - mocked for consistent entry list
 */

const { vol } = require('memfs'); // For content verification tests

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

// Mock document extractors
jest.mock('../../../src/main/analysis/documentExtractors', () => ({
  extractTextFromPdf: jest.fn().mockResolvedValue('Mock PDF content'),
  extractTextFromDocx: jest.fn().mockResolvedValue('Mock DOCX content'),
  extractTextFromXlsx: jest.fn().mockResolvedValue('Mock XLSX content'),
  extractTextFromPptx: jest.fn().mockResolvedValue('Mock PPTX content'),
  extractTextFromEml: jest.fn().mockResolvedValue('Mock EML content'),
  extractTextFromRtf: jest.fn().mockResolvedValue('Mock RTF content'),
  extractTextFromHtml: jest.fn().mockResolvedValue('Mock HTML content'),
  extractTextFromCsv: jest.fn().mockResolvedValue('Mock CSV content'),
  extractTextFromJson: jest.fn().mockResolvedValue('Mock JSON content'),
  extractTextFromXml: jest.fn().mockResolvedValue('Mock XML content')
}));

// Mock documentLlm
jest.mock('../../../src/main/analysis/documentLlm', () => ({
  analyzeTextWithOllama: jest.fn().mockResolvedValue({
    purpose: 'Archive file',
    project: 'Test Project',
    category: 'Archives',
    date: new Date().toISOString().split('T')[0],
    keywords: ['archive', 'backup', 'compressed'],
    confidence: 70,
    suggestedName: 'archive_file'
  }),
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
        { name: 'Archives', path: '/test/Archives', score: 0.85, id: 'folder:archives' }
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

// Mock AdmZip for archive metadata extraction
jest.mock('adm-zip', () => {
  return jest.fn().mockImplementation(() => ({
    getEntries: jest
      .fn()
      .mockReturnValue([
        { entryName: 'document.txt' },
        { entryName: 'report.pdf' },
        { entryName: 'data/config.json' }
      ])
  }));
});

// ============================================================================
// NOW IMPORT THE MODULE UNDER TEST (after mocks are set up)
// ============================================================================

const {
  analyzeDocumentFile,
  flushAllEmbeddings
} = require('../../../src/main/analysis/ollamaDocumentAnalysis');

// Import mocked modules for assertions
const ModelVerifier = require('../../../src/main/services/ModelVerifier');
const embeddingQueue = require('../../../src/main/analysis/embeddingQueue');

// Get mock instances
const mockModelVerifier = ModelVerifier._mockInstance;

// Import fixtures and loader
const { TEST_FIXTURE_FILES, getMockSmartFolders } = require('../../utils/fileTypeFixtures');
const { loadAllFixtures } = require('../../utils/realFileLoader');

// Setup custom matchers
const { setupPipelineMatchers } = require('./pipelineAssertions');
setupPipelineMatchers();

// Fixture keys for archive files
const ARCHIVE_FIXTURES = ['zipFile'];

describe('Archive Files Full Pipeline - REAL FILE Integration Tests', () => {
  const smartFolders = getMockSmartFolders();

  // Store fixture contents
  let fixtureContents;

  beforeAll(() => {
    // Load REAL archive fixtures into memfs (binary mode)
    fixtureContents = loadAllFixtures(ARCHIVE_FIXTURES);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Re-load fixtures into memfs (vol.reset() in global beforeEach clears it)
    loadAllFixtures(ARCHIVE_FIXTURES);

    mockModelVerifier.checkOllamaConnection.mockResolvedValue({
      connected: true,
      error: null
    });
  });

  describe('Pipeline Infrastructure', () => {
    test('ZIP fixture was loaded from real file', () => {
      expect(fixtureContents.zipFile).toBeDefined();
      expect(fixtureContents.zipFile.length).toBeGreaterThan(100);
    });

    test('analyzeDocumentFile function is exported', () => {
      expect(typeof analyzeDocumentFile).toBe('function');
    });

    test('ZIP fixture has correct properties', () => {
      const zipFixture = TEST_FIXTURE_FILES.zipFile;
      expect(zipFixture).toBeDefined();
      expect(zipFixture.extension).toBe('.zip');
      expect(zipFixture.category).toBe('archives');
    });
  });

  describe('ZIP Files - Real Archive Analysis', () => {
    const zipFixture = TEST_FIXTURE_FILES.zipFile;

    test('reads and processes REAL ZIP file', async () => {
      const result = await analyzeDocumentFile(zipFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('ZIP pipeline produces valid result', async () => {
      const result = await analyzeDocumentFile(zipFixture.path, smartFolders);

      expect(result.category).toBeDefined();
      // Archive uses either 'archive' extraction or fallback
      expect(['archive', 'filename_fallback']).toContain(result.extractionMethod);
    });

    test('ZIP result includes keywords', async () => {
      const result = await analyzeDocumentFile(zipFixture.path, smartFolders);

      expect(result.keywords).toBeDefined();
      expect(Array.isArray(result.keywords)).toBe(true);
    });

    test('ZIP result has confidence level', async () => {
      const result = await analyzeDocumentFile(zipFixture.path, smartFolders);

      expect(result.confidence).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
    });
  });

  describe('Content Flow Verification', () => {
    test('real ZIP binary is loaded into memfs', async () => {
      const zipFixture = TEST_FIXTURE_FILES.zipFile;

      // Verify the file exists in memfs
      const normalizedPath = zipFixture.path.replace(/\\/g, '/');
      const memfsContent = vol.readFileSync(normalizedPath);
      expect(Buffer.isBuffer(memfsContent)).toBe(true);
      expect(memfsContent.length).toBeGreaterThan(100);
    });

    test('pipeline produces valid result structure', async () => {
      const zipFixture = TEST_FIXTURE_FILES.zipFile;
      const result = await analyzeDocumentFile(zipFixture.path, smartFolders);

      expect(result).toMatchObject({
        category: expect.any(String),
        keywords: expect.any(Array)
      });
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
      const zipFixture = TEST_FIXTURE_FILES.zipFile;
      const result = await analyzeDocumentFile(zipFixture.path, smartFolders);

      expect(result.extractionMethod).toBe('filename_fallback');
    });

    test('fallback still has valid structure', async () => {
      const zipFixture = TEST_FIXTURE_FILES.zipFile;
      const result = await analyzeDocumentFile(zipFixture.path, smartFolders);

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
