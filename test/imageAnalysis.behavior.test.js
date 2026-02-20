/**
 * @jest-environment node
 */
const { analyzeImageFile, resetSingletons } = require('../src/main/analysis/imageAnalysis');

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    stat: jest.fn(),
    readFile: jest.fn()
  }
}));

jest.mock('sharp', () => {
  const mockSharp = jest.fn(() => ({
    metadata: jest.fn().mockResolvedValue({ width: 100, height: 100, format: 'png' }),
    resize: jest.fn().mockReturnThis(),
    png: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed-image'))
  }));
  return mockSharp;
});

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

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: jest.fn()
}));

jest.mock('../src/main/analysis/documentLlm', () => ({
  analyzeTextWithLlama: jest.fn().mockResolvedValue({
    category: 'General',
    keywords: ['text'],
    confidence: 80,
    suggestedName: 'ocr_analysis'
  })
}));

jest.mock('../src/main/services/FolderMatchingService', () => ({
  matchCategoryToFolder: jest.fn((cat) => cat)
}));

jest.mock('../src/main/analysis/embeddingQueue/stageQueues', () => ({
  analysisQueue: { enqueue: jest.fn() }
}));

jest.mock('../src/main/analysis/embeddingQueue/queueManager', () => ({
  removeByFilePath: jest.fn()
}));

// Mock AnalysisCacheService with a singleton mock
jest.mock('../src/main/services/AnalysisCacheService', () => {
  const mockCache = {
    get: jest.fn(),
    set: jest.fn(),
    clear: jest.fn()
  };
  return {
    getImageAnalysisCache: jest.fn(() => mockCache)
  };
});

jest.mock('../src/main/utils/llmOptimization', () => ({
  globalDeduplicator: {
    generateKey: jest.fn(() => 'test-key'),
    deduplicate: jest.fn((key, fn) => fn())
  }
}));

jest.mock('../src/main/utils/jsonRepair', () => ({
  extractAndParseJSON: jest.fn((text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })
}));

jest.mock('../src/main/utils/llmJsonRepair', () => ({
  attemptJsonRepairWithLlama: jest.fn(),
  attemptProseExtractionWithLlama: jest.fn()
}));

jest.mock('../src/main/utils/tesseractUtils', () => ({
  recognizeIfAvailable: jest.fn().mockResolvedValue({ success: false, text: '' })
}));

// Inline mock definition for semanticFolderMatcher
jest.mock('../src/main/analysis/semanticFolderMatcher', () => {
  const mockMatcher = {
    embeddingCache: { initialized: true },
    initialize: jest.fn(),
    embedText: jest.fn()
  };
  return {
    applySemanticFolderMatching: jest.fn(),
    getServices: jest.fn(() => ({ matcher: mockMatcher })),
    resetSingletons: jest.fn()
  };
});

jest.mock('../src/shared/promiseUtils', () => ({
  withAbortableTimeout: jest.fn((fn) => fn({ signal: {} }))
}));

// Mock fallbackUtils properly as it's used directly
jest.mock('../src/main/analysis/fallbackUtils', () => {
  const actual = jest.requireActual('../src/main/analysis/fallbackUtils');
  return {
    ...actual,
    createFallbackAnalysis: jest.fn((params) => ({
      ...params,
      isFallback: true,
      confidence: 60
    })),
    getIntelligentKeywords: jest.fn(() => ['fallback', 'keyword']),
    getIntelligentCategory: jest.fn(() => 'General')
  };
});

// Mock embeddingGate
jest.mock('../src/main/services/embedding/embeddingGate', () => ({
  shouldEmbed: jest.fn().mockResolvedValue({ shouldEmbed: true })
}));

// Mock folderUtils to support destructuring in SUT
jest.mock('../src/shared/folderUtils', () => ({
  findContainingSmartFolder: jest.fn()
}));

describe('Image Analysis Behavior', () => {
  let fs;
  let mockLlamaService;
  let mockCacheInstance;
  let mockMatcherInstance;

  beforeEach(() => {
    jest.clearAllMocks(); // Use clearAllMocks to preserve factory implementations
    resetSingletons();

    // Get fresh mock references
    mockCacheInstance =
      require('../src/main/services/AnalysisCacheService').getImageAnalysisCache();
    mockCacheInstance.get.mockReturnValue(null); // Cache miss by default

    // Access nested mock: getServices() -> returns object with matcher -> matcher has embedText
    mockMatcherInstance = require('../src/main/analysis/semanticFolderMatcher').getServices()
      .matcher;
    mockMatcherInstance.embedText.mockResolvedValue({ vector: [0.1, 0.2] });

    fs = require('fs').promises;
    // Default fs behavior
    fs.stat.mockResolvedValue({ size: 1024, mtimeMs: 1000 });
    fs.readFile.mockResolvedValue(Buffer.from('image-data'));

    mockLlamaService = {
      getConfig: jest.fn().mockResolvedValue({ visionModel: 'test-vision-model' }),
      testConnection: jest.fn().mockResolvedValue({ success: true }),
      listModels: jest.fn().mockResolvedValue([{ name: 'test-vision-model' }]),
      analyzeImage: jest.fn(),
      supportsVisionInput: jest.fn().mockResolvedValue(true)
    };
    require('../src/main/services/LlamaService').getInstance.mockReturnValue(mockLlamaService);
    const llmJsonRepair = require('../src/main/utils/llmJsonRepair');
    llmJsonRepair.attemptJsonRepairWithLlama.mockResolvedValue(null);
    llmJsonRepair.attemptProseExtractionWithLlama.mockResolvedValue(null);

    // Setup folderUtils mock default
    require('../src/shared/folderUtils').findContainingSmartFolder.mockReturnValue(null);

    // Setup embeddingGate mock default
    require('../src/main/services/embedding/embeddingGate').shouldEmbed.mockResolvedValue({
      shouldEmbed: true
    });
  });

  test('analyzes image successfully with AI', async () => {
    // Mock successful AI response
    const aiResponse = {
      response: JSON.stringify({
        category: 'Finance',
        keywords: ['receipt', 'tax'],
        confidence: 90,
        suggestedName: 'tax_receipt',
        has_text: false
      })
    };
    mockLlamaService.analyzeImage.mockResolvedValue(aiResponse);

    const result = await analyzeImageFile('/path/to/image.png');

    expect(result.error).toBeUndefined();
    expect(result.category).toBe('Finance');
    expect(result.suggestedName).toBe('tax_receipt.png'); // Expect extension appended
    expect(mockLlamaService.analyzeImage).toHaveBeenCalled();
    expect(mockCacheInstance.set).toHaveBeenCalled();
  });

  test('uses cached result if available', async () => {
    const cachedResult = { category: 'Cached', confidence: 95 };
    mockCacheInstance.get.mockReturnValue(cachedResult);

    const result = await analyzeImageFile('/path/to/image.png');

    expect(result).toBe(cachedResult);
    expect(mockLlamaService.analyzeImage).not.toHaveBeenCalled();
  });

  test('handles AI engine unavailability gracefully', async () => {
    mockLlamaService.testConnection.mockResolvedValue({ success: false });

    const result = await analyzeImageFile('/path/to/image.png');

    // Check for fallback indicators
    expect(result.confidence).toBe(60);
    expect(result.reason).toBe('AI engine unavailable');
    expect(mockLlamaService.analyzeImage).not.toHaveBeenCalled();
  });

  test('retries image preflight once before fallback', async () => {
    mockLlamaService.testConnection
      .mockResolvedValueOnce({ success: false, status: 'warming_up' })
      .mockResolvedValueOnce({ success: true });
    mockLlamaService.analyzeImage.mockResolvedValue({
      response: JSON.stringify({
        category: 'Finance',
        keywords: ['invoice'],
        confidence: 85,
        suggestedName: 'invoice_scan'
      })
    });

    const result = await analyzeImageFile('/path/to/image.png');

    expect(mockLlamaService.testConnection).toHaveBeenCalledTimes(2);
    expect(mockLlamaService.analyzeImage).toHaveBeenCalled();
    expect(result.error).toBeUndefined();
    expect(result.category).toBe('Finance');
  });

  test('routes recoverable vision errors through OCR/text fallback before filename fallback', async () => {
    mockLlamaService.analyzeImage.mockRejectedValue(
      new Error('Failed to parse JSON from vision response (empty response)')
    );
    const { recognizeIfAvailable } = require('../src/main/utils/tesseractUtils');
    recognizeIfAvailable.mockResolvedValueOnce({
      success: true,
      text: 'Invoice #123 total amount due'
    });
    const { analyzeTextWithLlama } = require('../src/main/analysis/documentLlm');
    analyzeTextWithLlama.mockResolvedValueOnce({
      category: 'Financial',
      keywords: ['invoice', 'amount'],
      confidence: 84,
      suggestedName: 'invoice_scan'
    });

    const result = await analyzeImageFile('/path/to/invoice_scan.png');

    expect(analyzeTextWithLlama).toHaveBeenCalled();
    expect(result.category).toBe('Financial');
    expect(result.analysisWarning).toMatch(/parse json|empty response/i);
    expect(result.reason).not.toBe('AI engine failed');
  });

  test('skips JSON repair for prose-like vision responses and uses prose extraction directly', async () => {
    mockLlamaService.analyzeImage.mockResolvedValue({
      response: 'The image appears to be a team structure chart for a project meeting.'
    });

    const { extractAndParseJSON } = require('../src/main/utils/jsonRepair');
    extractAndParseJSON.mockReturnValueOnce(null).mockReturnValueOnce({
      category: 'Work',
      keywords: ['team', 'project'],
      confidence: 88,
      suggestedName: 'team_structure',
      has_text: true
    });

    const {
      attemptJsonRepairWithLlama,
      attemptProseExtractionWithLlama
    } = require('../src/main/utils/llmJsonRepair');
    attemptProseExtractionWithLlama.mockResolvedValueOnce(
      JSON.stringify({
        category: 'Work',
        keywords: ['team', 'project'],
        confidence: 88,
        suggestedName: 'team_structure',
        has_text: true
      })
    );

    const result = await analyzeImageFile('/path/to/image.png');

    expect(attemptJsonRepairWithLlama).not.toHaveBeenCalled();
    expect(attemptProseExtractionWithLlama).toHaveBeenCalledTimes(1);
    expect(result.error).toBeUndefined();
    expect(result.category).toBe('Work');
  });

  test('routes non-recoverable vision error payloads through final OCR/text fallback', async () => {
    mockLlamaService.analyzeImage
      .mockResolvedValueOnce({
        response: JSON.stringify({
          error: 'gpu overload',
          confidence: 60
        })
      })
      .mockResolvedValueOnce({
        response: JSON.stringify({
          error: 'gpu overload',
          confidence: 60
        })
      });

    const { recognizeIfAvailable } = require('../src/main/utils/tesseractUtils');
    recognizeIfAvailable.mockResolvedValueOnce({
      success: true,
      text: 'Invoice #987 subtotal tax total due'
    });

    const { analyzeTextWithLlama } = require('../src/main/analysis/documentLlm');
    analyzeTextWithLlama.mockResolvedValueOnce({
      category: 'Financial',
      keywords: ['invoice', 'total'],
      confidence: 82,
      suggestedName: 'invoice_987'
    });

    const result = await analyzeImageFile('/path/to/invoice_photo.png');

    expect(result.error).toBeUndefined();
    expect(result.category).toBe('Financial');
    expect(result.analysisWarning).toMatch(/gpu overload/i);
  });

  test('detects hallucination (financial doc -> landscape)', async () => {
    // Filename suggests financial, AI suggests landscape
    const aiResponse = {
      response: JSON.stringify({
        category: 'Nature',
        keywords: ['sunset', 'beach'],
        confidence: 90,
        suggestedName: 'sunset_beach',
        has_text: false,
        content_type: 'photograph'
      })
    };
    mockLlamaService.analyzeImage.mockResolvedValue(aiResponse);

    const result = await analyzeImageFile('/path/to/invoice_2024.png');

    // Should detect hallucination and penalize confidence
    expect(result.validation_warnings).toBeDefined();
    expect(result.validation_warnings.some((w) => w.includes('HALLUCINATION'))).toBe(true);
    expect(result.confidence).toBeLessThan(50);
  });

  test('queues embedding if in smart folder', async () => {
    // Mock smart folder match using the proper mock
    const smartFolders = [{ name: 'Docs', path: '/path/to' }];
    require('../src/shared/folderUtils').findContainingSmartFolder.mockReturnValue(smartFolders[0]);

    // Mock successful AI response
    mockLlamaService.analyzeImage.mockResolvedValue({
      response: JSON.stringify({ category: 'Docs', keywords: [], confidence: 80 })
    });

    await analyzeImageFile('/path/to/image.png', smartFolders);

    // Verify embedding was queued
    const { analysisQueue } = require('../src/main/analysis/embeddingQueue/stageQueues');
    expect(analysisQueue.enqueue).toHaveBeenCalled();
  });
});
