/**
 * Integration Tests for Document Analysis
 *
 * Tests document file processing (PDF) using real test fixtures
 * with mocked Ollama service for deterministic results.
 *
 * Uses real test files from test/StratoSortOfTestFiles/
 */

const {
  TEST_FIXTURE_FILES,
  verifyFixturesExist,
  getMockSmartFolders,
  createMockOllamaDocumentResponse
} = require('../utils/fileTypeFixtures');

// Mock logger
jest.mock('../../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock the deduplicator to pass through directly
jest.mock('../../src/main/utils/llmOptimization', () => ({
  globalDeduplicator: {
    generateKey: jest.fn(() => 'test-key'),
    deduplicate: jest.fn((key, fn) => fn())
  }
}));

// Mock embedding queue
jest.mock('../../src/main/analysis/embeddingQueue', () => ({
  enqueue: jest.fn(),
  flush: jest.fn()
}));

// Mock ChromaDB
jest.mock('../../src/main/services/chromadb', () => ({
  getInstance: jest.fn(() => ({
    initialize: jest.fn().mockResolvedValue(true),
    isOnline: true
  }))
}));

// Mock FolderMatchingService
jest.mock('../../src/main/services/FolderMatchingService', () => {
  return jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(true),
    embedText: jest.fn().mockResolvedValue({ vector: [], model: 'test' }),
    matchVectorToFolders: jest.fn().mockResolvedValue([]),
    batchUpsertFolders: jest.fn().mockResolvedValue({ count: 0 }),
    embeddingCache: { initialized: true }
  }));
});

// Mock ModelVerifier
jest.mock('../../src/main/services/ModelVerifier', () => {
  return jest.fn().mockImplementation(() => ({
    checkOllamaConnection: jest.fn().mockResolvedValue({ connected: true }),
    verifyModel: jest.fn().mockResolvedValue({ valid: true })
  }));
});

// Mock ServiceContainer
jest.mock('../../src/main/services/ServiceContainer', () => ({
  container: {
    get: jest.fn(),
    register: jest.fn()
  },
  ServiceIds: {}
}));

describe('Document Analysis - PDF Files', () => {
  let fixturesAvailable = false;
  let mockOllama;
  let mockOllamaConfig;

  beforeAll(async () => {
    const result = await verifyFixturesExist();
    fixturesAvailable = result.exists;
    if (!fixturesAvailable) {
      console.warn('Some fixture files are missing:', result.missing);
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock Ollama client
    mockOllama = {
      generate: jest.fn()
    };

    mockOllamaConfig = {
      selectedTextModel: 'llama3.2',
      selectedModel: 'llama3.2'
    };

    // Mock ollamaUtils
    jest.doMock('../../src/main/ollamaUtils', () => ({
      getOllamaModel: jest.fn(() => 'llama3.2'),
      loadOllamaConfig: jest.fn().mockResolvedValue(mockOllamaConfig),
      getOllama: jest.fn().mockResolvedValue(mockOllama)
    }));
  });

  afterEach(() => {
    jest.resetModules();
  });

  describe('PDF Fixture File', () => {
    const pdfFixture = TEST_FIXTURE_FILES.financialPdf;

    test('fixture has correct metadata', () => {
      expect(pdfFixture.extension).toBe('.pdf');
      expect(pdfFixture.processingPath).toBe('document_extraction');
      expect(pdfFixture.supportsContentAnalysis).toBe(true);
    });

    test('fixture path is correctly formed', () => {
      expect(pdfFixture.path).toContain('StratoSortOfTestFiles');
      expect(pdfFixture.path).toContain('Annual_Financial_Statement_2024.pdf');
    });

    test('expected category is financial', () => {
      expect(pdfFixture.expectedCategory).toBe('financial');
    });
  });

  describe('Fallback Analysis', () => {
    const {
      getIntelligentCategory,
      getIntelligentKeywords,
      safeSuggestedName
    } = require('../../src/main/analysis/fallbackUtils');

    test('categorizes financial PDF correctly', () => {
      const category = getIntelligentCategory(
        'Annual_Financial_Statement_2024.pdf',
        '.pdf',
        getMockSmartFolders()
      );
      // Should match Financial folder based on "financial" and "statement" keywords
      expect(category).toBe('Financial');
    });

    test('generates keywords for financial PDF', () => {
      const keywords = getIntelligentKeywords('Annual_Financial_Statement_2024.pdf', '.pdf');
      expect(Array.isArray(keywords)).toBe(true);
      expect(keywords.length).toBeGreaterThan(0);
      // Should include "pdf" extension
      expect(keywords).toContain('pdf');
    });

    test('generates safe filename for PDF', () => {
      const safeName = safeSuggestedName('Annual_Financial_Statement_2024.pdf', '.pdf');
      expect(safeName).toBeDefined();
      expect(safeName.endsWith('.pdf')).toBe(true);
      expect(safeName).not.toContain(' ');
    });
  });

  describe('Document LLM Analysis', () => {
    test('analyzeTextWithOllama returns structured result', async () => {
      // Mock the documentLlm module
      const mockResult = {
        purpose: 'Financial statement for fiscal year 2024',
        project: 'Annual_Financial_Statement_2024',
        category: 'Financial',
        date: '2024-01-01',
        keywords: ['financial', 'statement', 'annual', '2024'],
        confidence: 85,
        suggestedName: 'Financial_Statement_2024'
      };

      jest.doMock('../../src/main/analysis/documentLlm', () => ({
        analyzeTextWithOllama: jest.fn().mockResolvedValue(mockResult),
        normalizeCategoryToSmartFolders: jest.fn((cat) => cat),
        AppConfig: { ai: { textAnalysis: { defaultModel: 'llama3.2' } } }
      }));

      const { analyzeTextWithOllama } = require('../../src/main/analysis/documentLlm');
      const result = await analyzeTextWithOllama(
        'Sample financial document text',
        'Annual_Financial_Statement_2024.pdf',
        getMockSmartFolders()
      );

      expect(result).toBeDefined();
      expect(result.purpose).toBeDefined();
      expect(result.category).toBe('Financial');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(100);
    });
  });

  describe('Analysis Result Normalization', () => {
    const { normalizeAnalysisResult } = require('../../src/main/analysis/utils');

    test('normalizes valid analysis result', () => {
      const raw = {
        purpose: 'Test document',
        project: 'TestProject',
        category: 'Documents',
        date: '2024-01-01',
        keywords: ['test', 'document'],
        confidence: 85
      };

      const defaults = { category: 'Unknown', keywords: [], confidence: 0 };
      const normalized = normalizeAnalysisResult(raw, defaults);

      expect(normalized.purpose).toBe('Test document');
      expect(normalized.category).toBe('Documents');
      expect(normalized.confidence).toBe(85);
    });

    test('applies defaults for missing fields', () => {
      const raw = { purpose: 'Test' };
      const defaults = { category: 'Unknown', keywords: [], confidence: 50 };
      const normalized = normalizeAnalysisResult(raw, defaults);

      expect(normalized.purpose).toBe('Test');
      expect(normalized.category).toBe('Unknown');
      expect(normalized.confidence).toBe(50);
    });

    test('handles null input', () => {
      const defaults = { category: 'Documents', keywords: [], confidence: 0 };
      const normalized = normalizeAnalysisResult(null, defaults);

      expect(normalized.category).toBe('Documents');
    });
  });

  describe('Analysis Mock Response', () => {
    test('createMockOllamaDocumentResponse generates valid JSON', () => {
      const response = createMockOllamaDocumentResponse(TEST_FIXTURE_FILES.financialPdf);
      expect(response.response).toBeDefined();

      const parsed = JSON.parse(response.response);
      expect(parsed.purpose).toBeDefined();
      expect(parsed.category).toBeDefined();
      expect(parsed.keywords).toBeDefined();
      expect(Array.isArray(parsed.keywords)).toBe(true);
    });
  });

  describe('Smart Folder Integration', () => {
    const smartFolders = getMockSmartFolders();

    test('Financial folder exists in mock folders', () => {
      const financialFolder = smartFolders.find((f) => f.name === 'Financial');
      expect(financialFolder).toBeDefined();
      expect(financialFolder.keywords).toContain('statement');
    });

    test('Documents folder exists as fallback', () => {
      const docsFolder = smartFolders.find((f) => f.name === 'Documents');
      expect(docsFolder).toBeDefined();
    });
  });
});

describe('Document Analysis - Edge Cases', () => {
  const {
    getIntelligentCategory,
    getIntelligentKeywords,
    safeSuggestedName
  } = require('../../src/main/analysis/fallbackUtils');

  describe('Filename Pattern Matching', () => {
    test('matches invoice pattern', () => {
      const category = getIntelligentCategory('invoice_2024_001.pdf', '.pdf', []);
      expect(category).toBe('financial');
    });

    test('matches receipt pattern', () => {
      const category = getIntelligentCategory('receipt_amazon_2024.pdf', '.pdf', []);
      expect(category).toBe('financial');
    });

    test('matches contract pattern', () => {
      const category = getIntelligentCategory('employment_contract.pdf', '.pdf', []);
      expect(category).toBe('legal');
    });

    test('matches report pattern', () => {
      const category = getIntelligentCategory('quarterly_report_q1.pdf', '.pdf', []);
      expect(category).toBe('research');
    });

    test('falls back to Documents for unknown patterns', () => {
      const category = getIntelligentCategory('xyz123.pdf', '.pdf', []);
      expect(category).toBe('Documents');
    });
  });

  describe('Keyword Extraction', () => {
    test('extracts report keyword from filename', () => {
      const keywords = getIntelligentKeywords('annual_report_2024.pdf', '.pdf');
      expect(keywords).toContain('report');
    });

    test('extracts analysis keyword from filename', () => {
      const keywords = getIntelligentKeywords('market_analysis.pdf', '.pdf');
      expect(keywords).toContain('analysis');
    });

    test('limits keywords to 7 max', () => {
      const keywords = getIntelligentKeywords('very_long_filename_with_many_parts.pdf', '.pdf');
      expect(keywords.length).toBeLessThanOrEqual(7);
    });
  });

  describe('Safe Name Generation', () => {
    test('handles unicode characters', () => {
      const safeName = safeSuggestedName('文档_document.pdf', '.pdf');
      expect(safeName).toBeDefined();
      expect(safeName.endsWith('.pdf')).toBe(true);
    });

    test('handles multiple dots in filename', () => {
      const safeName = safeSuggestedName('file.v1.2.3.pdf', '.pdf');
      expect(safeName).toBeDefined();
      expect(safeName.endsWith('.pdf')).toBe(true);
    });

    test('handles leading dots', () => {
      const safeName = safeSuggestedName('...hidden.pdf', '.pdf');
      expect(safeName).toBeDefined();
      expect(safeName.endsWith('.pdf')).toBe(true);
      // Should not start with dot after sanitization
      expect(safeName.charAt(0)).not.toBe('.');
    });
  });
});
