/**
 * @jest-environment node
 */
const { analyzeImageFile } = require('../src/main/analysis/imageAnalysis');

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
  extractAndParseJSON: jest.fn((text) => JSON.parse(text))
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
      analyzeImage: jest.fn()
    };
    require('../src/main/services/LlamaService').getInstance.mockReturnValue(mockLlamaService);

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
