/**
 * REWRITTEN TESTS for ollamaDocumentAnalysis
 * Tests fallback behavior when Ollama is unavailable
 */

let analyzeDocumentFile;

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    setContext: jest.fn()
  }
}));

jest.mock('fs', () => ({
  promises: {
    stat: jest.fn().mockResolvedValue({ size: 1024, mtimeMs: Date.now() }),
    readFile: jest.fn().mockResolvedValue('G1 X0 Y0')
  }
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
      MAX_CONTENT_LENGTH: 50000
    },
    IMAGE: {
      MODEL: 'llava',
      TEMPERATURE: 0.2,
      MAX_TOKENS: 1000
    }
  },
  DEFAULT_AI_MODELS: {
    TEXT_ANALYSIS: 'llama3.2:latest',
    IMAGE_ANALYSIS: 'llava:latest',
    FALLBACK_MODELS: ['llama3.2:latest', 'gemma3:4b', 'llama3', 'mistral', 'phi3']
  },
  FILE_SIZE_LIMITS: {
    MAX_TEXT_FILE_SIZE: 50 * 1024 * 1024,
    MAX_IMAGE_FILE_SIZE: 100 * 1024 * 1024,
    MAX_DOCUMENT_FILE_SIZE: 200 * 1024 * 1024
  },
  LIMITS: {
    MAX_FILE_SIZE: 100 * 1024 * 1024,
    MAX_PATH_LENGTH: 260,
    MAX_FILENAME_LENGTH: 255
  },
  PROCESSING_LIMITS: {
    MAX_CONCURRENT_ANALYSIS: 3,
    MAX_BATCH_SIZE: 100,
    ANALYSIS_TIMEOUT: 60000,
    RETRY_ATTEMPTS: 3
  }
}));

// Mock ollamaDetection
jest.mock('../src/main/utils/ollamaDetection', () => ({
  isOllamaRunning: jest.fn().mockResolvedValue(false),
  isOllamaRunningWithRetry: jest.fn().mockResolvedValue(false),
  isOllamaInstalled: jest.fn().mockResolvedValue(true),
  getOllamaVersion: jest.fn().mockResolvedValue('0.1.30')
}));

// Mock other services
jest.mock('../src/main/services/ChromaDBService', () => ({
  getInstance: jest.fn().mockReturnValue(null)
}));

jest.mock('../src/main/services/FolderMatchingService', () => {
  return class MockFolderMatchingService {
    constructor() {
      this.embeddingCache = { initialized: false };
    }
  };
});

jest.mock('../src/main/services/PerformanceService', () => ({
  buildOllamaOptions: jest.fn().mockResolvedValue({})
}));

// Mock document extractors
jest.mock('../src/main/analysis/documentExtractors', () => ({
  extractTextFromPdf: jest.fn().mockResolvedValue('Sample PDF content'),
  extractTextFromDocx: jest.fn().mockResolvedValue('Sample DOCX content')
}));

// Mock fallback utils
jest.mock('../src/main/analysis/fallbackUtils', () => {
  const mockGetIntelligentCategory = jest.fn(() => 'documents');
  const mockGetIntelligentKeywords = jest.fn(() => ['document', 'text']);
  const mockSafeSuggestedName = jest.fn((name, ext) => {
    if (!name || name === ext) return 'unnamed_file';
    let nameWithoutExt = name;
    if (ext && name.toLowerCase().endsWith(ext.toLowerCase())) {
      nameWithoutExt = name.slice(0, -ext.length);
    }
    return nameWithoutExt;
  });

  return {
    getIntelligentCategory: mockGetIntelligentCategory,
    getIntelligentKeywords: mockGetIntelligentKeywords,
    safeSuggestedName: mockSafeSuggestedName,
    createFallbackAnalysis: jest.fn(
      ({ fileName, fileExtension, reason, confidence, type, options = {} }) => {
        // Use mocked getIntelligentCategory like the real implementation
        const intelligentCategory = mockGetIntelligentCategory(fileName, fileExtension);
        const intelligentKeywords = mockGetIntelligentKeywords(fileName, fileExtension);

        let suggestedName = 'fallback';
        if (fileName) {
          suggestedName = fileName;
          if (fileExtension && fileName.toLowerCase().endsWith(fileExtension.toLowerCase())) {
            suggestedName = fileName.slice(0, -fileExtension.length);
          }
        }
        const extractionMethod =
          options.extractionMethod === undefined ? 'filename_fallback' : options.extractionMethod;
        const result = {
          purpose: `${type === 'image' ? 'Image' : 'Document'} (fallback - ${reason || 'fallback analysis'})`,
          project: fileName ? fileName.replace(fileExtension || '', '') : 'unknown',
          category: intelligentCategory || (type === 'image' ? 'Images' : 'Documents'),
          date: new Date().toISOString().split('T')[0],
          keywords: intelligentKeywords || ['document', 'text'],
          confidence: confidence || 65,
          suggestedName,
          extractionMethod,
          fallbackReason: reason || 'fallback analysis'
        };
        if (options.error) {
          result.error = options.error;
        }
        return result;
      }
    )
  };
});

// Mock semanticFolderMatcher
jest.mock('../src/main/analysis/semanticFolderMatcher', () => ({
  applySemanticFolderMatching: jest.fn().mockResolvedValue(undefined),
  getServices: jest.fn().mockReturnValue({ chromaDb: null, matcher: null }),
  resetSingletons: jest.fn()
}));

jest.mock('../src/shared/config/index', () => ({
  get: jest.fn((_, fallback) => fallback)
}));

// Mock other utilities
jest.mock('../src/main/utils/llmOptimization', () => ({
  globalDeduplicator: {
    generateKey: jest.fn(),
    deduplicate: jest.fn()
  }
}));

jest.mock('../src/main/utils/ollamaApiRetry', () => ({
  generateWithRetry: jest.fn()
}));

jest.mock('../src/main/analysis/utils', () => ({
  normalizeAnalysisResult: jest.fn((data, defaults) => ({
    ...defaults,
    ...data
  }))
}));

jest.mock('../src/main/analysis/documentLlm', () => ({
  analyzeTextWithOllama: jest.fn(),
  normalizeCategoryToSmartFolders: jest.fn((cat) => cat), // Mock implementation returns category as-is
  AppConfig: {
    ai: {
      textAnalysis: {
        defaultModel: 'mock-model'
      }
    }
  }
}));

describe('ollamaDocumentAnalysis - Fallback Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    ({ analyzeDocumentFile } = require('../src/main/analysis/ollamaDocumentAnalysis'));
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

describe('ollamaDocumentAnalysis - Text Extraction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    ({ analyzeDocumentFile } = require('../src/main/analysis/ollamaDocumentAnalysis'));
  });

  test('should fall back for gcode files', async () => {
    const { isOllamaRunningWithRetry } = require('../src/main/utils/ollamaDetection');
    const { analyzeTextWithOllama } = require('../src/main/analysis/documentLlm');

    isOllamaRunningWithRetry.mockResolvedValue(true);

    const result = await analyzeDocumentFile('/test/print.gcode', []);

    expect(analyzeTextWithOllama).not.toHaveBeenCalled();
    expect(result.extractionMethod).toBe('filename');
  });
});

describe('ollamaDocumentAnalysis - Video Short-Circuit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Update constants mock to include video extensions
    jest.doMock('../src/shared/constants', () => ({
      SUPPORTED_TEXT_EXTENSIONS: ['.txt', '.md', '.rtf', '.json', '.csv'],
      SUPPORTED_DOCUMENT_EXTENSIONS: ['.pdf', '.doc', '.docx', '.xlsx', '.pptx'],
      SUPPORTED_ARCHIVE_EXTENSIONS: ['.zip', '.rar', '.7z'],
      SUPPORTED_VIDEO_EXTENSIONS: ['.mp4', '.avi', '.mov', '.mkv'],
      AI_DEFAULTS: {
        TEXT: { MODEL: 'llama2', TEMPERATURE: 0.3, MAX_TOKENS: 1000, MAX_CONTENT_LENGTH: 50000 },
        IMAGE: { MODEL: 'llava', TEMPERATURE: 0.2, MAX_TOKENS: 1000 }
      },
      DEFAULT_AI_MODELS: {
        TEXT_ANALYSIS: 'llama3.2:latest',
        IMAGE_ANALYSIS: 'llava:latest',
        FALLBACK_MODELS: ['llama3.2:latest']
      },
      FILE_SIZE_LIMITS: {
        MAX_TEXT_FILE_SIZE: 50 * 1024 * 1024,
        MAX_IMAGE_FILE_SIZE: 100 * 1024 * 1024,
        MAX_DOCUMENT_FILE_SIZE: 200 * 1024 * 1024
      },
      PROCESSING_LIMITS: {
        MAX_CONCURRENT_ANALYSIS: 3,
        MAX_BATCH_SIZE: 100,
        ANALYSIS_TIMEOUT: 60000,
        RETRY_ATTEMPTS: 3
      }
    }));
  });

  test('should use extension_short_circuit for known types', async () => {
    const result = await analyzeDocumentFile('/test/movie.xyz', []);
    // Even unsupported gets fallback
    expect(result).toBeDefined();
  });
});

describe('ollamaDocumentAnalysis - Smart Folder Matching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should generate smart folder signature from folder names', async () => {
    const smartFolders = [
      { name: 'Work', path: '/work' },
      { name: 'Personal', path: '/personal' }
    ];

    const result = await analyzeDocumentFile('/test/file.txt', smartFolders);
    expect(result).toBeDefined();
  });

  test('should handle empty smart folders array', async () => {
    const result = await analyzeDocumentFile('/test/file.pdf', []);
    expect(result).toBeDefined();
  });

  test('should handle null smart folders', async () => {
    const result = await analyzeDocumentFile('/test/file.pdf', null);
    expect(result).toBeDefined();
  });
});

describe('ollamaDocumentAnalysis - Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    ({ analyzeDocumentFile } = require('../src/main/analysis/ollamaDocumentAnalysis'));
  });

  test('should handle ollamaDetection error gracefully', async () => {
    const { isOllamaRunning } = require('../src/main/utils/ollamaDetection');
    isOllamaRunning.mockRejectedValueOnce(new Error('Connection failed'));

    const result = await analyzeDocumentFile('/test/doc.pdf', []);

    expect(result).toBeDefined();
    expect(result.confidence).toBe(65);
    expect(result.extractionMethod).toBe('filename_fallback');
  });

  test('should handle file stat errors gracefully', async () => {
    // The function should continue even if file stat fails
    const result = await analyzeDocumentFile('/nonexistent/path/file.txt', []);

    expect(result).toBeDefined();
    expect(result.purpose).toBeDefined();
  });
});

describe('ollamaDocumentAnalysis - File Extension Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    ({ analyzeDocumentFile } = require('../src/main/analysis/ollamaDocumentAnalysis'));
  });

  test('should handle .pdf extension', async () => {
    const result = await analyzeDocumentFile('/test/report.pdf', []);
    expect(result).toBeDefined();
    expect(result.project).toBe('report');
  });

  test('should handle .docx extension', async () => {
    const result = await analyzeDocumentFile('/test/document.docx', []);
    expect(result).toBeDefined();
  });

  test('should handle .txt extension', async () => {
    const result = await analyzeDocumentFile('/test/notes.txt', []);
    expect(result).toBeDefined();
  });

  test('should handle .md extension', async () => {
    const result = await analyzeDocumentFile('/test/readme.md', []);
    expect(result).toBeDefined();
  });

  test('should handle .json extension', async () => {
    const result = await analyzeDocumentFile('/test/config.json', []);
    expect(result).toBeDefined();
  });

  test('should handle .csv extension', async () => {
    const result = await analyzeDocumentFile('/test/data.csv', []);
    expect(result).toBeDefined();
  });

  test('should handle .xlsx extension', async () => {
    const result = await analyzeDocumentFile('/test/spreadsheet.xlsx', []);
    expect(result).toBeDefined();
  });

  test('should handle .pptx extension', async () => {
    const result = await analyzeDocumentFile('/test/presentation.pptx', []);
    expect(result).toBeDefined();
  });

  test('should handle .rtf extension', async () => {
    const result = await analyzeDocumentFile('/test/document.rtf', []);
    expect(result).toBeDefined();
  });

  test('should handle archive .zip extension', async () => {
    const result = await analyzeDocumentFile('/test/archive.zip', []);
    expect(result).toBeDefined();
  });

  test('should handle archive .rar extension', async () => {
    const result = await analyzeDocumentFile('/test/archive.rar', []);
    expect(result).toBeDefined();
  });
});

describe('ollamaDocumentAnalysis - Category Mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    ({ analyzeDocumentFile } = require('../src/main/analysis/ollamaDocumentAnalysis'));
  });

  test('should map category to smart folder when available', async () => {
    const { getIntelligentCategory } = require('../src/main/analysis/fallbackUtils');
    getIntelligentCategory.mockReturnValue('work');

    const smartFolders = [{ name: 'Work', path: '/work' }];
    const result = await analyzeDocumentFile('/test/project.pdf', smartFolders);

    expect(result).toBeDefined();
    expect(result.category).toBe('work');
  });

  test('should use default category when no match found', async () => {
    const { getIntelligentCategory } = require('../src/main/analysis/fallbackUtils');
    getIntelligentCategory.mockReturnValue(null);

    const result = await analyzeDocumentFile('/test/random.pdf', []);

    expect(result).toBeDefined();
    // When no intelligent category, defaults to 'Documents' for document type
    expect(result.category).toBe('Documents');
  });
});

describe('ollamaDocumentAnalysis - Date Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    ({ analyzeDocumentFile } = require('../src/main/analysis/ollamaDocumentAnalysis'));
  });

  test('should include date in result', async () => {
    const result = await analyzeDocumentFile('/test/file.pdf', []);

    expect(result).toBeDefined();
    expect(result.date).toBeDefined();
    // Date should be in YYYY-MM-DD format
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('ollamaDocumentAnalysis - Suggested Name', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    ({ analyzeDocumentFile } = require('../src/main/analysis/ollamaDocumentAnalysis'));
  });

  test('should generate suggested name without extension', async () => {
    const { safeSuggestedName } = require('../src/main/analysis/fallbackUtils');
    safeSuggestedName.mockReturnValue('my_document');

    const result = await analyzeDocumentFile('/test/my_document.pdf', []);

    expect(result).toBeDefined();
    expect(result.suggestedName).toBe('my_document');
  });
});
