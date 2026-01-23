/**
 * Full Pipeline Integration Tests - Code Files
 *
 * Tests the ACTUAL analyzeDocumentFile() function with REAL code files:
 * JS, PY, CSS, SQL
 *
 * This test uses REAL fixture files from test/StratoSortOfTestFiles/
 * to verify actual content extraction and processing.
 *
 * What's REAL:
 * - File content (loaded from disk into memfs)
 * - Content extraction
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
    purpose: 'Source code file',
    project: fileName.replace(/\.[^.]+$/, ''),
    category: 'Code',
    date: new Date().toISOString().split('T')[0],
    keywords: ['code', 'programming', 'development'],
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
      .mockResolvedValue([{ name: 'Code', path: '/test/Code', score: 0.85, id: 'folder:code' }]),
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

const { analyzeDocumentFile } = require('../../../src/main/analysis/ollamaDocumentAnalysis');

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

// Fixture keys for code files
const CODE_FIXTURES = ['jsFile', 'pythonFile', 'cssFile', 'sqlFile'];

describe('Code Files Full Pipeline - REAL FILE Integration Tests', () => {
  const smartFolders = getMockSmartFolders();

  // Store real file contents for assertions
  let fixtureContents;

  beforeAll(() => {
    // Load REAL fixture files into memfs
    fixtureContents = loadAllFixtures(CODE_FIXTURES);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Re-load fixtures into memfs (vol.reset() in global beforeEach clears it)
    loadAllFixtures(CODE_FIXTURES);

    // Reset mocks
    isOllamaRunning.mockResolvedValue(true);
  });

  describe('Pipeline Infrastructure', () => {
    test('JS fixture content was loaded from real file', () => {
      expect(fixtureContents.jsFile).toBeDefined();
      expect(fixtureContents.jsFile).toContain('function');
    });

    test('Python fixture content was loaded from real file', () => {
      expect(fixtureContents.pythonFile).toBeDefined();
      expect(fixtureContents.pythonFile).toContain('class DataProcessor');
    });

    test('analyzeDocumentFile function is exported', () => {
      expect(typeof analyzeDocumentFile).toBe('function');
    });
  });

  describe('JavaScript Files - Real Content Extraction', () => {
    const jsFixture = TEST_FIXTURE_FILES.jsFile;

    test('reads and processes REAL JS file', async () => {
      const result = await analyzeDocumentFile(jsFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('extracts REAL JS content and sends to Ollama', async () => {
      await analyzeDocumentFile(jsFixture.path, smartFolders);

      expect(mockAnalyzeTextWithOllama).toHaveBeenCalled();
      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      // Real JS file contains these
      expect(contentArg).toContain('function');
      expect(contentArg).toContain('module.exports');
    });

    test('JS content includes actual code', async () => {
      await analyzeDocumentFile(jsFixture.path, smartFolders);
      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      expect(contentArg).toContain('processData');
      expect(contentArg).toContain('validateConfig');
    });
  });

  describe('Python Files - Real Content Extraction', () => {
    const pyFixture = TEST_FIXTURE_FILES.pythonFile;

    test('reads and processes REAL Python file', async () => {
      const result = await analyzeDocumentFile(pyFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('extracts REAL Python content and sends to Ollama', async () => {
      await analyzeDocumentFile(pyFixture.path, smartFolders);

      expect(mockAnalyzeTextWithOllama).toHaveBeenCalled();
      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      expect(contentArg).toContain('class');
      expect(contentArg).toContain('def');
    });

    test('Python content includes actual code', async () => {
      await analyzeDocumentFile(pyFixture.path, smartFolders);
      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      expect(contentArg).toContain('DataProcessor');
      expect(contentArg).toContain('process');
    });
  });

  describe('CSS Files - Real Content Extraction', () => {
    const cssFixture = TEST_FIXTURE_FILES.cssFile;

    test('reads and processes REAL CSS file', async () => {
      const result = await analyzeDocumentFile(cssFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('extracts REAL CSS content and sends to Ollama', async () => {
      await analyzeDocumentFile(cssFixture.path, smartFolders);

      expect(mockAnalyzeTextWithOllama).toHaveBeenCalled();
      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      // CSS should contain style-related content
      expect(contentArg.length).toBeGreaterThan(50);
    });
  });

  describe('SQL Files - Real Content Extraction', () => {
    const sqlFixture = TEST_FIXTURE_FILES.sqlFile;

    test('reads and processes REAL SQL file', async () => {
      const result = await analyzeDocumentFile(sqlFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('extracts REAL SQL content and sends to Ollama', async () => {
      await analyzeDocumentFile(sqlFixture.path, smartFolders);

      expect(mockAnalyzeTextWithOllama).toHaveBeenCalled();
      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];

      // SQL should contain query keywords
      expect(contentArg.length).toBeGreaterThan(50);
    });
  });

  describe('Content Flow Verification', () => {
    test('real code content flows through pipeline', async () => {
      const jsFixture = TEST_FIXTURE_FILES.jsFile;
      await analyzeDocumentFile(jsFixture.path, smartFolders);

      const [contentArg] = mockAnalyzeTextWithOllama.mock.calls[0];
      expect(contentArg).toContain('Sample JavaScript Utility Module');
    });

    test('generates embedding from real content', async () => {
      const jsFixture = TEST_FIXTURE_FILES.jsFile;
      await analyzeDocumentFile(jsFixture.path, smartFolders);

      expect(mockFolderMatcher.embedText).toHaveBeenCalled();
    });

    test('queues embedding for persistence', async () => {
      const pyFixture = TEST_FIXTURE_FILES.pythonFile;
      await analyzeDocumentFile(pyFixture.path, smartFolders);

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
      isOllamaRunning.mockResolvedValue(false);
    });

    test('returns fallback when Ollama offline', async () => {
      const jsFixture = TEST_FIXTURE_FILES.jsFile;
      const result = await analyzeDocumentFile(jsFixture.path, smartFolders);

      expect(result.extractionMethod).toBe('filename_fallback');
    });
  });
});
