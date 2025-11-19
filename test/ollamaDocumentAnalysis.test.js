/**
 * REWRITTEN TESTS for ollamaDocumentAnalysis
 * Tests fallback behavior when Ollama is unavailable
 */

const {
  analyzeDocumentFile,
} = require('../src/main/analysis/ollamaDocumentAnalysis');

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    setContext: jest.fn(),
  },
  appLogger: {
    createLogger: jest.fn(() => ({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
}));

// Mock constants
jest.mock('../src/shared/constants', () => ({
  SUPPORTED_TEXT_EXTENSIONS: ['.txt', '.md', '.rtf', '.json', '.csv'],
  SUPPORTED_DOCUMENT_EXTENSIONS: ['.pdf', '.doc', '.docx', '.xlsx', '.pptx'],
  SUPPORTED_ARCHIVE_EXTENSIONS: ['.zip', '.rar', '.7z'],
  AI_DEFAULTS: {
    TEXT: {
      MODEL: 'llama2',
      HOST: 'http://127.0.0.1:11434',
      TEMPERATURE: 0.3,
      MAX_TOKENS: 1000,
      MAX_CONTENT_LENGTH: 50000,
    },
  },
}));

// Mock ModelVerifier to return Ollama unavailable
jest.mock('../src/main/services/ModelVerifier', () => {
  return jest.fn().mockImplementation(() => ({
    checkOllamaConnection: jest.fn().mockResolvedValue({
      connected: false,
      error: 'Ollama unavailable',
    }),
  }));
});

// Mock other services
jest.mock('../src/main/services/ChromaDBService', () => ({
  getInstance: jest.fn().mockReturnValue(null),
}));

jest.mock('../src/main/services/FolderMatchingService', () => {
  return class MockFolderMatchingService {
    constructor() {
      this.embeddingCache = { initialized: false };
    }
  };
});

jest.mock('../src/main/services/PerformanceService', () => ({
  buildOllamaOptions: jest.fn().mockResolvedValue({}),
}));

// Mock document extractors
jest.mock('../src/main/analysis/documentExtractors', () => ({
  extractTextFromPdf: jest.fn().mockResolvedValue('Sample PDF content'),
  extractTextFromDocx: jest.fn().mockResolvedValue('Sample DOCX content'),
}));

// Mock fallback utils
jest.mock('../src/main/analysis/fallbackUtils', () => ({
  getIntelligentCategory: jest.fn(() => 'documents'),
  getIntelligentKeywords: jest.fn(() => ['document', 'text']),
  safeSuggestedName: jest.fn((name, ext) => name.replace(ext, '')),
}));

// Mock other utilities
jest.mock('../src/main/utils/llmOptimization', () => ({
  globalDeduplicator: {
    generateKey: jest.fn(),
    deduplicate: jest.fn(),
  },
}));

jest.mock('../src/main/utils/ollamaApiRetry', () => ({
  generateWithRetry: jest.fn(),
}));

jest.mock('../src/main/analysis/utils', () => ({
  normalizeAnalysisResult: jest.fn((data, defaults) => ({
    ...defaults,
    ...data,
  })),
}));

jest.mock('../src/main/analysis/documentLlm', () => ({
  analyzeTextWithOllama: jest.fn(),
}));

describe('ollamaDocumentAnalysis - Fallback Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return fallback analysis for PDF when Ollama unavailable', async () => {
    const result = await analyzeDocumentFile('/test/document.pdf', []);

    expect(result).toBeDefined();
    expect(result.project).toBe('document');
    expect(result.purpose).toContain('fallback');
    expect(result.extractionMethod).toBe('filename_fallback');
    expect(result.confidence).toBe(65);
  });

  test('should return fallback analysis for text file when Ollama unavailable', async () => {
    const result = await analyzeDocumentFile('/test/notes.txt', []);

    expect(result).toBeDefined();
    expect(result.project).toBe('notes');
    expect(result.purpose).toContain('fallback');
    expect(result.keywords).toBeDefined();
    expect(Array.isArray(result.keywords)).toBe(true);
  });

  test('should handle unsupported file format', async () => {
    const result = await analyzeDocumentFile('/test/file.unknown', []);

    expect(result).toBeDefined();
    expect(result.category).toBe('documents');
    expect(result.purpose).toBeDefined();
  });

  test('should include keywords in fallback result', async () => {
    const result = await analyzeDocumentFile('/test/report.docx', []);

    expect(result).toBeDefined();
    expect(result.keywords).toEqual(['document', 'text']);
  });
});
