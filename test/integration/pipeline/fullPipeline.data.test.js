/**
 * Full Pipeline Integration Tests - Data Files
 *
 * Tests the ACTUAL analyzeDocumentFile() function with REAL data files:
 * JSON, CSV, XML, YAML
 *
 * This test uses REAL fixture files from test/StratoSortOfTestFiles/
 * to verify actual content extraction and processing.
 *
 * What's REAL:
 * - File content (loaded from disk into memfs)
 * - Content extraction (CSV parser, etc.)
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

// Mock ModelVerifier - pretend Ollama is available
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
  // Return mock analysis but we can verify content was passed
  return Promise.resolve({
    purpose: 'Data file analysis',
    project: fileName.replace(/\.[^.]+$/, ''),
    category: 'Data',
    date: new Date().toISOString().split('T')[0],
    keywords: ['data', 'structured', 'records'],
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
    matchVectorToFolders: jest.fn().mockResolvedValue([
      { name: 'Data', path: '/test/Data', score: 0.85, id: 'folder:data' },
      { name: 'Documents', path: '/test/Documents', score: 0.65, id: 'folder:docs' }
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

// Mock globalDeduplicator - let it pass through
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

// Fixture keys for data files
const DATA_FIXTURES = ['jsonFile', 'csvFile', 'xmlFile', 'yamlFile'];

describe('Data Files Full Pipeline - REAL FILE Integration Tests', () => {
  const smartFolders = getMockSmartFolders();

  // Store real file contents for assertions
  let fixtureContents;

  beforeAll(() => {
    // Load REAL fixture files into memfs before tests run
    fixtureContents = loadAllFixtures(DATA_FIXTURES);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Re-load fixtures into memfs (vol.reset() in global beforeEach clears it)
    loadAllFixtures(DATA_FIXTURES);

    mockModelVerifier.checkOllamaConnection.mockResolvedValue({
      connected: true,
      error: null
    });
  });

  describe('Pipeline Infrastructure', () => {
    test('JSON fixture content was loaded from real file', () => {
      expect(fixtureContents.jsonFile).toBeDefined();
      expect(fixtureContents.jsonFile).toContain('Sample Configuration');
    });

    test('CSV fixture content was loaded from real file', () => {
      expect(fixtureContents.csvFile).toBeDefined();
      expect(fixtureContents.csvFile).toContain('Product');
    });

    test('analyzeDocumentFile function is exported', () => {
      expect(typeof analyzeDocumentFile).toBe('function');
    });
  });

  describe('JSON Files - Real Content Extraction', () => {
    const jsonFixture = TEST_FIXTURE_FILES.jsonFile;

    test('reads and processes REAL JSON file', async () => {
      const result = await analyzeDocumentFile(jsonFixture.path, smartFolders);

      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('extracts REAL JSON content and sends to Ollama', async () => {
      await analyzeDocumentFile(jsonFixture.path, smartFolders);

      // Verify Ollama was called with REAL content from the file
      expect(mockAnalyzeTextWithOllama).toHaveBeenCalled();

      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      // The real JSON file contains these strings
      expect(contentArg).toContain('Sample Configuration');
      expect(contentArg).toContain('settings');
      expect(contentArg).toContain('theme');
    });

    test('JSON content includes actual file data', async () => {
      await analyzeDocumentFile(jsonFixture.path, smartFolders);

      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      // Verify specific content from config_data.json
      expect(contentArg).toContain('dark'); // theme value
      expect(contentArg).toContain('autoSave'); // setting name
      expect(contentArg).toContain('features'); // key
    });

    test('generates embedding from real content', async () => {
      await analyzeDocumentFile(jsonFixture.path, smartFolders);

      expect(mockFolderMatcher.embedText).toHaveBeenCalled();
    });

    test('queues embedding for persistence', async () => {
      await analyzeDocumentFile(jsonFixture.path, smartFolders);

      expect(embeddingQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringContaining('file:'),
          vector: expect.any(Array)
        })
      );
    });
  });

  describe('CSV Files - Real Content Extraction', () => {
    const csvFixture = TEST_FIXTURE_FILES.csvFile;

    test('reads and processes REAL CSV file', async () => {
      const result = await analyzeDocumentFile(csvFixture.path, smartFolders);

      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('extracts REAL CSV content and sends to Ollama', async () => {
      await analyzeDocumentFile(csvFixture.path, smartFolders);

      expect(mockAnalyzeTextWithOllama).toHaveBeenCalled();

      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      // The real CSV file contains sales data
      expect(contentArg).toContain('Product');
      expect(contentArg).toContain('Revenue');
    });

    test('CSV content includes actual data rows', async () => {
      await analyzeDocumentFile(csvFixture.path, smartFolders);

      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      // Verify specific content from sales_data.csv
      expect(contentArg).toContain('Widget');
      expect(contentArg).toContain('Electronics');
      expect(contentArg).toContain('Region');
    });
  });

  describe('XML Files - Real Content Extraction', () => {
    const xmlFixture = TEST_FIXTURE_FILES.xmlFile;

    test('reads and processes REAL XML file', async () => {
      const result = await analyzeDocumentFile(xmlFixture.path, smartFolders);

      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('extracts REAL XML content and sends to Ollama', async () => {
      await analyzeDocumentFile(xmlFixture.path, smartFolders);

      expect(mockAnalyzeTextWithOllama).toHaveBeenCalled();

      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      // XML should contain tag content
      expect(contentArg.length).toBeGreaterThan(50);
    });
  });

  describe('YAML Files - Real Content Extraction', () => {
    const yamlFixture = TEST_FIXTURE_FILES.yamlFile;

    test('reads and processes REAL YAML file', async () => {
      const result = await analyzeDocumentFile(yamlFixture.path, smartFolders);

      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('extracts REAL YAML content and sends to Ollama', async () => {
      await analyzeDocumentFile(yamlFixture.path, smartFolders);

      expect(mockAnalyzeTextWithOllama).toHaveBeenCalled();

      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      // YAML file should have content
      expect(contentArg.length).toBeGreaterThan(20);
    });
  });

  describe('Content Flow Verification', () => {
    test('real file content flows through entire pipeline', async () => {
      const jsonFixture = TEST_FIXTURE_FILES.jsonFile;

      // Process through pipeline
      await analyzeDocumentFile(jsonFixture.path, smartFolders);

      // Verify the content sent to Ollama contains the actual file content
      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      // The extracted content should contain key parts of the original file
      expect(contentArg).toContain('Sample Configuration');

      // Also verify our stored content matches
      expect(fixtureContents.jsonFile).toContain('Sample Configuration');
    });

    test('pipeline completes with valid result structure', async () => {
      const csvFixture = TEST_FIXTURE_FILES.csvFile;
      const result = await analyzeDocumentFile(csvFixture.path, smartFolders);

      expect(result).toMatchObject({
        purpose: expect.any(String),
        category: expect.any(String),
        keywords: expect.any(Array),
        confidence: expect.any(Number),
        suggestedName: expect.any(String)
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
      const jsonFixture = TEST_FIXTURE_FILES.jsonFile;
      const result = await analyzeDocumentFile(jsonFixture.path, smartFolders);

      expect(result.extractionMethod).toBe('filename_fallback');
    });

    test('fallback still has valid structure', async () => {
      const csvFixture = TEST_FIXTURE_FILES.csvFile;
      const result = await analyzeDocumentFile(csvFixture.path, smartFolders);

      expect(result.category).toBeDefined();
      expect(result.keywords).toBeDefined();
    });
  });
});
