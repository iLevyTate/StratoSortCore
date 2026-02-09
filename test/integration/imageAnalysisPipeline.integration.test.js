/**
 * Integration Tests - Image Analysis & Embedding Pipeline
 *
 * Validates the image analysis → embedding pipeline works correctly:
 * 1. Image preprocessing and validation
 * 2. AI analysis with result validation and hallucination detection
 * 3. Embedding queue integration (items are enqueued after successful analysis)
 * 4. Fallback behavior when AI engine is unavailable
 * 5. Complete flow for multiple image types (PNG, JPG, etc.)
 *
 * Mocks: LlamaService (no real GPU), sharp (no binary dep), fs I/O
 * Tests: Full analysis flow logic, validation, queue integration
 */

const path = require('path');

// ---------- Mock setup (before any require) ----------

jest.mock('fs', () => ({
  promises: {
    stat: jest.fn(),
    readFile: jest.fn()
  }
}));

jest.mock('sharp', () => {
  const mockSharp = jest.fn(() => ({
    metadata: jest.fn().mockResolvedValue({ width: 800, height: 600, format: 'png' }),
    resize: jest.fn().mockReturnThis(),
    png: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed-image-data'))
  }));
  return mockSharp;
});

jest.mock('../../src/shared/logger', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  };
  return { createLogger: jest.fn(() => logger) };
});

jest.mock('../../src/main/services/LlamaService', () => ({
  getInstance: jest.fn()
}));

jest.mock('../../src/main/services/FolderMatchingService', () => ({
  matchCategoryToFolder: jest.fn((cat) => cat)
}));

const mockEnqueue = jest.fn();
jest.mock('../../src/main/analysis/embeddingQueue/stageQueues', () => ({
  analysisQueue: { enqueue: mockEnqueue }
}));

jest.mock('../../src/main/analysis/embeddingQueue/queueManager', () => ({
  removeByFilePath: jest.fn()
}));

jest.mock('../../src/main/services/AnalysisCacheService', () => {
  const mockCache = { get: jest.fn(), set: jest.fn(), clear: jest.fn() };
  return { getImageAnalysisCache: jest.fn(() => mockCache) };
});

jest.mock('../../src/main/utils/llmOptimization', () => ({
  globalDeduplicator: {
    generateKey: jest.fn(() => 'test-key'),
    deduplicate: jest.fn((key, fn) => fn())
  }
}));

jest.mock('../../src/main/utils/jsonRepair', () => ({
  extractAndParseJSON: jest.fn((text) => JSON.parse(text))
}));

jest.mock('../../src/main/utils/tesseractUtils', () => ({
  recognizeIfAvailable: jest.fn().mockResolvedValue({ success: false, text: '' })
}));

jest.mock('../../src/main/analysis/semanticFolderMatcher', () => {
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

jest.mock('../../src/shared/promiseUtils', () => ({
  withAbortableTimeout: jest.fn((fn) => fn({ signal: {} }))
}));

jest.mock('../../src/main/analysis/fallbackUtils', () => {
  const actual = jest.requireActual('../../src/main/analysis/fallbackUtils');
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

jest.mock('../../src/main/services/embedding/embeddingGate', () => ({
  shouldEmbed: jest.fn().mockResolvedValue({ shouldEmbed: true })
}));

jest.mock('../../src/shared/folderUtils', () => ({
  findContainingSmartFolder: jest.fn()
}));

// ---------- Imports ----------

const { analyzeImageFile } = require('../../src/main/analysis/imageAnalysis');
const { getInstance: getLlamaService } = require('../../src/main/services/LlamaService');
const { getImageAnalysisCache } = require('../../src/main/services/AnalysisCacheService');
const { getServices } = require('../../src/main/analysis/semanticFolderMatcher');
const { findContainingSmartFolder } = require('../../src/shared/folderUtils');
const { shouldEmbed } = require('../../src/main/services/embedding/embeddingGate');

// ---------- Helpers ----------

function createMockLlamaService(overrides = {}) {
  return {
    getConfig: jest.fn().mockResolvedValue({ visionModel: 'test-vision-model' }),
    testConnection: jest.fn().mockResolvedValue({ success: true }),
    listModels: jest.fn().mockResolvedValue([{ name: 'test-vision-model' }]),
    analyzeImage: jest.fn(),
    supportsVisionInput: jest.fn().mockResolvedValue(true),
    ...overrides
  };
}

function createAiResponse(data) {
  return { response: JSON.stringify(data) };
}

// ---------- Test fixtures ----------

const FIXTURE_IMAGES = {
  invoice: {
    path: '/docs/images/invoice_scan_2024.png',
    aiResponse: {
      category: 'Financial',
      keywords: ['invoice', 'payment', 'receipt'],
      confidence: 90,
      suggestedName: 'invoice_scan_2024',
      has_text: true,
      content_type: 'text_document',
      summary: 'Scanned invoice document with payment details'
    }
  },
  photo: {
    path: '/photos/vacation_beach.jpg',
    aiResponse: {
      category: 'Personal',
      keywords: ['beach', 'vacation', 'travel'],
      confidence: 85,
      suggestedName: 'vacation_beach',
      has_text: false,
      content_type: 'photograph',
      summary: 'Beach vacation photograph'
    }
  },
  screenshot: {
    path: '/screenshots/app_error_report.png',
    aiResponse: {
      category: 'Technical',
      keywords: ['screenshot', 'error', 'application'],
      confidence: 80,
      suggestedName: 'app_error_report',
      has_text: true,
      content_type: 'screenshot',
      summary: 'Application error report screenshot'
    }
  },
  diagram: {
    path: '/docs/architecture_diagram.webp',
    aiResponse: {
      category: 'Technical',
      keywords: ['architecture', 'diagram', 'system'],
      confidence: 88,
      suggestedName: 'architecture_diagram',
      has_text: true,
      content_type: 'other',
      summary: 'System architecture diagram'
    }
  }
};

// ---------- Tests ----------

describe('Image Analysis Pipeline - Successful Analysis', () => {
  let fs;
  let mockLlamaService;
  let mockCacheInstance;
  let mockMatcherInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    mockCacheInstance = getImageAnalysisCache();
    mockCacheInstance.get.mockReturnValue(null);

    mockMatcherInstance = getServices().matcher;
    mockMatcherInstance.embedText.mockResolvedValue({ vector: [0.1, 0.2, 0.3] });

    fs = require('fs').promises;
    fs.stat.mockResolvedValue({ size: 2048, mtimeMs: Date.now() });
    fs.readFile.mockResolvedValue(Buffer.from('fake-image-data'));

    mockLlamaService = createMockLlamaService();
    getLlamaService.mockReturnValue(mockLlamaService);

    findContainingSmartFolder.mockReturnValue(null);
    shouldEmbed.mockResolvedValue({ shouldEmbed: true });
  });

  test('analyzes invoice image and produces correct category', async () => {
    const fixture = FIXTURE_IMAGES.invoice;
    mockLlamaService.analyzeImage.mockResolvedValue(createAiResponse(fixture.aiResponse));

    const result = await analyzeImageFile(fixture.path);

    expect(result.error).toBeUndefined();
    expect(result.category).toBe('Financial');
    expect(result.confidence).toBeGreaterThanOrEqual(80);
    expect(result.suggestedName).toContain('invoice_scan_2024');
  });

  test('analyzes photo and produces correct category', async () => {
    const fixture = FIXTURE_IMAGES.photo;
    mockLlamaService.analyzeImage.mockResolvedValue(createAiResponse(fixture.aiResponse));

    const result = await analyzeImageFile(fixture.path);

    expect(result.error).toBeUndefined();
    expect(result.category).toBe('Personal');
    expect(result.confidence).toBeGreaterThanOrEqual(80);
  });

  test('analyzes screenshot with text content', async () => {
    const fixture = FIXTURE_IMAGES.screenshot;
    mockLlamaService.analyzeImage.mockResolvedValue(createAiResponse(fixture.aiResponse));

    const result = await analyzeImageFile(fixture.path);

    expect(result.error).toBeUndefined();
    expect(result.category).toBe('Technical');
  });

  test('caches result after successful analysis', async () => {
    const fixture = FIXTURE_IMAGES.invoice;
    mockLlamaService.analyzeImage.mockResolvedValue(createAiResponse(fixture.aiResponse));

    await analyzeImageFile(fixture.path);

    expect(mockCacheInstance.set).toHaveBeenCalled();
  });

  test('returns cached result on second call', async () => {
    const cachedResult = { category: 'Cached', confidence: 95, isCached: true };
    mockCacheInstance.get.mockReturnValue(cachedResult);

    const result = await analyzeImageFile('/any/path.png');

    expect(result).toBe(cachedResult);
    expect(mockLlamaService.analyzeImage).not.toHaveBeenCalled();
  });
});

describe('Image Analysis Pipeline - Multiple File Types', () => {
  let fs;
  let mockLlamaService;

  beforeEach(() => {
    jest.clearAllMocks();

    const mockCacheInstance = getImageAnalysisCache();
    mockCacheInstance.get.mockReturnValue(null);

    const mockMatcherInstance = getServices().matcher;
    mockMatcherInstance.embedText.mockResolvedValue({ vector: [0.1, 0.2, 0.3] });

    fs = require('fs').promises;
    fs.stat.mockResolvedValue({ size: 2048, mtimeMs: Date.now() });
    fs.readFile.mockResolvedValue(Buffer.from('fake-image-data'));

    mockLlamaService = createMockLlamaService();
    getLlamaService.mockReturnValue(mockLlamaService);

    findContainingSmartFolder.mockReturnValue(null);
    shouldEmbed.mockResolvedValue({ shouldEmbed: true });
  });

  const imageTypes = [
    { ext: '.png', path: '/images/test.png' },
    { ext: '.jpg', path: '/images/test.jpg' },
    { ext: '.jpeg', path: '/images/test.jpeg' },
    { ext: '.webp', path: '/images/test.webp' },
    { ext: '.gif', path: '/images/test.gif' },
    { ext: '.bmp', path: '/images/test.bmp' },
    { ext: '.tiff', path: '/images/test.tiff' }
  ];

  test.each(imageTypes)('processes $ext image file successfully', async ({ path: imgPath }) => {
    mockLlamaService.analyzeImage.mockResolvedValue(
      createAiResponse({
        category: 'Images',
        keywords: ['image'],
        confidence: 80,
        suggestedName: 'test_image'
      })
    );

    const result = await analyzeImageFile(imgPath);

    // Should not have an error for supported formats
    expect(result.category).toBeDefined();
    expect(typeof result.category).toBe('string');
  });

  test('rejects unsupported image format', async () => {
    const result = await analyzeImageFile('/images/test.raw');

    expect(result.error).toContain('Unsupported image format');
    expect(result.confidence).toBe(0);
  });
});

describe('Image Analysis Pipeline - Embedding Queue Integration', () => {
  let fs;
  let mockLlamaService;

  beforeEach(() => {
    jest.clearAllMocks();

    const mockCacheInstance = getImageAnalysisCache();
    mockCacheInstance.get.mockReturnValue(null);

    const mockMatcherInstance = getServices().matcher;
    mockMatcherInstance.embedText.mockResolvedValue({ vector: [0.1, 0.2, 0.3] });

    fs = require('fs').promises;
    fs.stat.mockResolvedValue({ size: 2048, mtimeMs: Date.now() });
    fs.readFile.mockResolvedValue(Buffer.from('fake-image-data'));

    mockLlamaService = createMockLlamaService();
    getLlamaService.mockReturnValue(mockLlamaService);

    findContainingSmartFolder.mockReturnValue(null);
    shouldEmbed.mockResolvedValue({ shouldEmbed: true });
  });

  test('queues embedding when image is in a smart folder', async () => {
    const smartFolders = [{ name: 'Photos', path: '/photos' }];
    findContainingSmartFolder.mockReturnValue(smartFolders[0]);

    mockLlamaService.analyzeImage.mockResolvedValue(
      createAiResponse({
        category: 'Photos',
        keywords: ['photo'],
        confidence: 85,
        suggestedName: 'vacation_photo'
      })
    );

    await analyzeImageFile('/photos/vacation.jpg', smartFolders);

    expect(mockEnqueue).toHaveBeenCalled();
    const enqueueCall = mockEnqueue.mock.calls[0][0];
    expect(enqueueCall).toBeDefined();
    expect(enqueueCall.id).toContain('vacation.jpg');
  });

  test('does not queue embedding when file is not in smart folder', async () => {
    findContainingSmartFolder.mockReturnValue(null);

    mockLlamaService.analyzeImage.mockResolvedValue(
      createAiResponse({
        category: 'Photos',
        keywords: ['photo'],
        confidence: 85,
        suggestedName: 'random_photo'
      })
    );

    await analyzeImageFile('/random/photo.jpg');

    // Embedding should not be queued for files outside smart folders
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  test('respects embedding gate decision', async () => {
    const smartFolders = [{ name: 'Photos', path: '/photos' }];
    findContainingSmartFolder.mockReturnValue(smartFolders[0]);
    shouldEmbed.mockResolvedValue({ shouldEmbed: false, reason: 'already embedded' });

    mockLlamaService.analyzeImage.mockResolvedValue(
      createAiResponse({
        category: 'Photos',
        keywords: ['photo'],
        confidence: 85,
        suggestedName: 'vacation'
      })
    );

    await analyzeImageFile('/photos/vacation.jpg', smartFolders);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

describe('Image Analysis Pipeline - Hallucination Detection', () => {
  let fs;
  let mockLlamaService;

  beforeEach(() => {
    jest.clearAllMocks();

    const mockCacheInstance = getImageAnalysisCache();
    mockCacheInstance.get.mockReturnValue(null);

    const mockMatcherInstance = getServices().matcher;
    mockMatcherInstance.embedText.mockResolvedValue({ vector: [0.1, 0.2, 0.3] });

    fs = require('fs').promises;
    fs.stat.mockResolvedValue({ size: 2048, mtimeMs: Date.now() });
    fs.readFile.mockResolvedValue(Buffer.from('fake-image-data'));

    mockLlamaService = createMockLlamaService();
    getLlamaService.mockReturnValue(mockLlamaService);

    findContainingSmartFolder.mockReturnValue(null);
    shouldEmbed.mockResolvedValue({ shouldEmbed: true });
  });

  test('detects hallucination when filename says financial but AI says nature', async () => {
    mockLlamaService.analyzeImage.mockResolvedValue(
      createAiResponse({
        category: 'Nature',
        keywords: ['sunset', 'beach', 'ocean'],
        confidence: 90,
        suggestedName: 'sunset_beach',
        has_text: false,
        content_type: 'photograph'
      })
    );

    const result = await analyzeImageFile('/docs/financial_report_2024.png');

    expect(result.validation_warnings).toBeDefined();
    expect(result.validation_warnings.some((w) => w.includes('HALLUCINATION'))).toBe(true);
    expect(result.confidence).toBeLessThan(50);
  });

  test('does not flag hallucination when filename and AI agree', async () => {
    mockLlamaService.analyzeImage.mockResolvedValue(
      createAiResponse({
        category: 'Financial',
        keywords: ['invoice', 'payment'],
        confidence: 90,
        suggestedName: 'invoice_2024',
        has_text: true,
        content_type: 'text_document'
      })
    );

    const result = await analyzeImageFile('/docs/invoice_2024.png');

    // Should not have hallucination warnings
    if (result.validation_warnings) {
      expect(result.validation_warnings.every((w) => !w.includes('HALLUCINATION'))).toBe(true);
    }
    expect(result.confidence).toBeGreaterThanOrEqual(80);
  });
});

describe('Image Analysis Pipeline - Graceful Degradation', () => {
  let fs;

  beforeEach(() => {
    jest.clearAllMocks();

    const mockCacheInstance = getImageAnalysisCache();
    mockCacheInstance.get.mockReturnValue(null);

    fs = require('fs').promises;
    fs.stat.mockResolvedValue({ size: 2048, mtimeMs: Date.now() });
    fs.readFile.mockResolvedValue(Buffer.from('fake-image-data'));

    findContainingSmartFolder.mockReturnValue(null);
    shouldEmbed.mockResolvedValue({ shouldEmbed: true });
  });

  test('returns fallback when AI engine is unavailable', async () => {
    const mockLlama = createMockLlamaService({
      testConnection: jest.fn().mockResolvedValue({ success: false })
    });
    getLlamaService.mockReturnValue(mockLlama);

    const result = await analyzeImageFile('/path/to/image.png');

    expect(result.confidence).toBe(60);
    expect(result.reason).toBe('AI engine unavailable');
    expect(mockLlama.analyzeImage).not.toHaveBeenCalled();
  });

  test('returns fallback when AI engine throws', async () => {
    getLlamaService.mockImplementation(() => {
      throw new Error('LlamaService not initialized');
    });

    const result = await analyzeImageFile('/path/to/image.png');

    expect(result.confidence).toBeLessThanOrEqual(60);
    expect(result.isFallback).toBe(true);
  });

  test('returns fallback when vision model is not loaded', async () => {
    const mockLlama = createMockLlamaService({
      listModels: jest.fn().mockResolvedValue([{ name: 'text-model-only' }]),
      analyzeImage: jest.fn().mockRejectedValue(new Error('model not found'))
    });
    getLlamaService.mockReturnValue(mockLlama);

    const result = await analyzeImageFile('/path/to/image.png');

    expect(result.confidence).toBeLessThanOrEqual(60);
    expect(mockLlama.analyzeImage).toHaveBeenCalled();
  });
});

describe('Image Analysis Pipeline - Batch Processing Scenario', () => {
  let fs;
  let mockLlamaService;

  beforeEach(() => {
    jest.clearAllMocks();

    const mockCacheInstance = getImageAnalysisCache();
    mockCacheInstance.get.mockReturnValue(null);

    const mockMatcherInstance = getServices().matcher;
    mockMatcherInstance.embedText.mockResolvedValue({ vector: [0.1, 0.2, 0.3] });

    fs = require('fs').promises;
    fs.stat.mockResolvedValue({ size: 2048, mtimeMs: Date.now() });
    fs.readFile.mockResolvedValue(Buffer.from('fake-image-data'));

    mockLlamaService = createMockLlamaService();
    getLlamaService.mockReturnValue(mockLlamaService);

    findContainingSmartFolder.mockReturnValue(null);
    shouldEmbed.mockResolvedValue({ shouldEmbed: true });
  });

  test('processes multiple images sequentially with consistent results', async () => {
    const images = Object.entries(FIXTURE_IMAGES);
    const results = [];

    for (const [name, fixture] of images) {
      // Use mockResolvedValue (not Once) because the OCR re-analysis path
      // may call analyzeImage multiple times when has_text is true.
      mockLlamaService.analyzeImage.mockResolvedValue(createAiResponse(fixture.aiResponse));

      const result = await analyzeImageFile(fixture.path);
      results.push({ name, result });
    }

    // All should succeed
    expect(results.length).toBe(images.length);
    for (const { result } of results) {
      expect(result.category).toBeDefined();
      expect(typeof result.category).toBe('string');
    }

    // Each should have the correct category
    expect(results.find((r) => r.name === 'invoice').result.category).toBe('Financial');
    expect(results.find((r) => r.name === 'photo').result.category).toBe('Personal');
    expect(results.find((r) => r.name === 'screenshot').result.category).toBe('Technical');
    expect(results.find((r) => r.name === 'diagram').result.category).toBe('Technical');
  });

  test('AI engine is called for each uncached image', async () => {
    const fixture = FIXTURE_IMAGES.invoice;
    mockLlamaService.analyzeImage.mockResolvedValue(createAiResponse(fixture.aiResponse));

    await analyzeImageFile(fixture.path);

    // analyzeImage may be called more than once per image (e.g., OCR re-analysis
    // when has_text is true), but it must be called at least once.
    expect(mockLlamaService.analyzeImage).toHaveBeenCalled();
    expect(mockLlamaService.testConnection).toHaveBeenCalledTimes(1);
  });
});
