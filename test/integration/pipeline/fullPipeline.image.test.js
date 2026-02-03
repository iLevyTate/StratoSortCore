/**
 * Full Pipeline Integration Tests - Image Analysis
 *
 * Tests the ACTUAL analyzeImageFile() function with REAL image files:
 * PNG, JPG, GIF, BMP, WebP, TIFF
 *
 * This test uses REAL fixture files from test/StratoSortOfTestFiles/
 *
 * What's REAL:
 * - Image file content (loaded from disk into memfs as binary)
 * - File paths pointing to real fixtures
 * - Image buffer flowing through pipeline
 *
 * What's MOCKED:
 * - Ollama LLM (vision analysis) - no actual AI calls
 * - ChromaDB - no actual vector DB
 * - Embedding generation - no actual embeddings
 * - Sharp (image processing) - requires native bindings
 */

// ============================================================================
// MOCK SETUP - Only mock external services, NOT file operations
// ============================================================================

// Mock logger
jest.mock('../../../src/shared/logger', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp/test-app')
  }
}));

// Mock sharp for image processing (native module won't work with memfs)
const mockSharpInstance = {
  metadata: jest.fn().mockResolvedValue({
    width: 800,
    height: 600,
    format: 'png',
    exif: null
  }),
  resize: jest.fn().mockReturnThis(),
  png: jest.fn().mockReturnThis(),
  toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed image data'))
};
jest.mock('sharp', () => jest.fn(() => mockSharpInstance));

// Mock exif-reader
jest.mock('exif-reader', () => jest.fn(() => null));

// Mock folderUtils to force a smart folder match for fixture paths
jest.mock('../../../src/shared/folderUtils', () => {
  const actual = jest.requireActual('../../../src/shared/folderUtils');
  return {
    ...actual,
    findContainingSmartFolder: jest.fn((filePath, smartFolders) => {
      const forced = Array.isArray(smartFolders)
        ? smartFolders.find((folder) => folder?.name === 'Fixtures')
        : null;
      if (forced) return forced;
      return actual.findContainingSmartFolder(filePath, smartFolders);
    })
  };
});

// Mock embedding gate to keep analysis-stage embedding enabled
jest.mock('../../../src/main/services/embedding/embeddingGate', () => ({
  shouldEmbed: jest.fn().mockResolvedValue({
    shouldEmbed: true,
    timing: 'during_analysis',
    policy: 'embed'
  })
}));

// Mock ollamaDetection
jest.mock('../../../src/main/utils/ollamaDetection', () => ({
  isOllamaRunning: jest.fn().mockResolvedValue(true),
  isOllamaRunningWithRetry: jest.fn().mockResolvedValue(true),
  isOllamaInstalled: jest.fn().mockResolvedValue(true),
  getOllamaVersion: jest.fn().mockResolvedValue('0.1.30'),
  getInstalledModels: jest.fn().mockResolvedValue(['llava:latest'])
}));

// Mock ollamaUtils - capture vision analysis requests
const mockGenerate = jest.fn().mockResolvedValue({
  response: JSON.stringify({
    purpose: 'Image analysis',
    project: 'Test Project',
    category: 'Images',
    keywords: ['image', 'visual', 'photo'],
    confidence: 80,
    content_type: 'image',
    has_text: false,
    colors: ['gray', 'white', 'black'],
    suggestedName: 'analyzed_image'
  })
});

jest.mock('../../../src/main/ollamaUtils', () => ({
  getOllamaVisionModel: jest.fn(() => 'llava:latest'),
  getOllamaHost: jest.fn(() => 'http://127.0.0.1:11434'),
  loadOllamaConfig: jest.fn().mockResolvedValue({
    selectedVisionModel: 'llava:latest'
  }),
  getOllama: jest.fn().mockResolvedValue({
    generate: mockGenerate
  })
}));

// Mock PerformanceService
jest.mock('../../../src/main/services/PerformanceService', () => ({
  buildOllamaOptions: jest.fn().mockResolvedValue({})
}));

// Mock globalDeduplicator
jest.mock('../../../src/main/utils/llmOptimization', () => ({
  globalDeduplicator: {
    generateKey: jest.fn((obj) => JSON.stringify(obj)),
    deduplicate: jest.fn((key, fn) => fn())
  }
}));

// Mock ollamaApiRetry
jest.mock('../../../src/main/utils/ollamaApiRetry', () => ({
  generateWithRetry: jest.fn().mockResolvedValue({
    response: JSON.stringify({
      purpose: 'Image analysis',
      project: 'Test Project',
      category: 'Images',
      keywords: ['image', 'visual', 'photo'],
      confidence: 80,
      content_type: 'image',
      has_text: false,
      suggestedName: 'analyzed_image'
    })
  })
}));

// Mock jsonRepair
jest.mock('../../../src/main/utils/jsonRepair', () => ({
  extractAndParseJSON: jest.fn((text) => {
    try {
      return JSON.parse(text);
    } catch {
      return {
        purpose: 'Image analysis',
        category: 'Images',
        keywords: ['image'],
        confidence: 80
      };
    }
  })
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
        { name: 'Images', path: '/test/Images', score: 0.85, id: 'folder:images' }
      ]),
    embeddingCache: { initialized: true }
  };
  const MockFolderMatchingService = jest.fn().mockImplementation(() => mockInstance);
  MockFolderMatchingService._mockInstance = mockInstance;
  return MockFolderMatchingService;
});

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

const {
  analyzeImageFile,
  flushAllEmbeddings,
  resetSingletons
} = require('../../../src/main/analysis/ollamaImageAnalysis');
const sharp = require('sharp');

// Import mocked modules for assertions
const FolderMatchingService = require('../../../src/main/services/FolderMatchingService');
const { analysisQueue } = require('../../../src/main/analysis/embeddingQueue/stageQueues');
const { isOllamaRunningWithRetry } = require('../../../src/main/utils/ollamaDetection');

// Get mock instances
const mockFolderMatcher = FolderMatchingService._mockInstance;

// Import fixtures and loader
const {
  TEST_FIXTURE_FILES,
  getMockSmartFolders,
  FIXTURE_DIR
} = require('../../utils/fileTypeFixtures');
const { loadAllFixtures } = require('../../utils/realFileLoader');

// Setup custom matchers
const { setupPipelineMatchers } = require('./pipelineAssertions');
setupPipelineMatchers();

// Fixture keys for image files
const IMAGE_FIXTURES = ['simplePng', 'jpgFile', 'gifFile', 'bmpFile', 'webpFile', 'tiffFile'];

describe('Image Files Full Pipeline - REAL FILE Integration Tests', () => {
  const smartFolders = [
    ...getMockSmartFolders(),
    {
      id: 'fixture-folder',
      name: 'Fixtures',
      path: FIXTURE_DIR, // Add fixture dir as a smart folder so files are considered "organized"
      description: 'Test fixtures',
      keywords: [],
      semanticTags: []
    }
  ];

  // Store fixture contents
  let fixtureContents;

  beforeAll(() => {
    // Load REAL image fixtures into memfs (binary mode)
    fixtureContents = loadAllFixtures(IMAGE_FIXTURES);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    if (!analysisQueue.enqueue?._isMockFunction) {
      jest.spyOn(analysisQueue, 'enqueue').mockResolvedValue(undefined);
    } else {
      analysisQueue.enqueue.mockResolvedValue(undefined);
    }
    if (!analysisQueue.flush?._isMockFunction) {
      jest.spyOn(analysisQueue, 'flush').mockResolvedValue(undefined);
    } else {
      analysisQueue.flush.mockResolvedValue(undefined);
    }

    // Reset singletons if available
    if (typeof resetSingletons === 'function') {
      resetSingletons();
    }

    // Re-load fixtures into memfs (vol.reset() in global beforeEach clears it)
    loadAllFixtures(IMAGE_FIXTURES);

    // Reset mocks
    isOllamaRunningWithRetry.mockResolvedValue(true);
  });

  describe('Pipeline Infrastructure', () => {
    test('PNG fixture was loaded from real file', () => {
      expect(fixtureContents.simplePng).toBeDefined();
      expect(fixtureContents.simplePng.length).toBeGreaterThan(50);
    });

    test('JPG fixture was loaded from real file', () => {
      expect(fixtureContents.jpgFile).toBeDefined();
      expect(fixtureContents.jpgFile.length).toBeGreaterThan(100);
    });

    test('GIF fixture was loaded from real file', () => {
      expect(fixtureContents.gifFile).toBeDefined();
      expect(fixtureContents.gifFile.length).toBeGreaterThan(50);
    });

    test('BMP fixture was loaded from real file', () => {
      expect(fixtureContents.bmpFile).toBeDefined();
      expect(fixtureContents.bmpFile.length).toBeGreaterThan(0);
    });

    test('WebP fixture was loaded from real file', () => {
      expect(fixtureContents.webpFile).toBeDefined();
      expect(fixtureContents.webpFile.length).toBeGreaterThan(100);
    });

    test('TIFF fixture was loaded from real file', () => {
      expect(fixtureContents.tiffFile).toBeDefined();
      expect(fixtureContents.tiffFile.length).toBeGreaterThan(100);
    });

    test('analyzeImageFile function is exported', () => {
      expect(typeof analyzeImageFile).toBe('function');
    });
  });

  describe('PNG Files - Real Image Analysis', () => {
    const pngFixture = TEST_FIXTURE_FILES.simplePng;

    test('reads and processes REAL PNG file', async () => {
      const result = await analyzeImageFile(pngFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('passes PNG to sharp for processing', async () => {
      await analyzeImageFile(pngFixture.path, smartFolders);

      // Sharp should be called with the image buffer
      expect(sharp).toHaveBeenCalled();
    });

    test('generates embedding from PNG analysis', async () => {
      await analyzeImageFile(pngFixture.path, smartFolders);

      expect(mockFolderMatcher.embedText).toHaveBeenCalled();
    });
  });

  describe('JPG Files - Real Image Analysis', () => {
    const jpgFixture = TEST_FIXTURE_FILES.jpgFile;

    test('reads and processes REAL JPG file', async () => {
      const result = await analyzeImageFile(jpgFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    test('JPG pipeline produces valid result', async () => {
      const result = await analyzeImageFile(jpgFixture.path, smartFolders);

      expect(result).toMatchObject({
        category: expect.any(String),
        confidence: expect.any(Number)
      });
    });
  });

  describe('GIF Files - Real Image Analysis', () => {
    const gifFixture = TEST_FIXTURE_FILES.gifFile;

    test('reads and processes REAL GIF file', async () => {
      const result = await analyzeImageFile(gifFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });
  });

  describe('BMP Files - Real Image Analysis', () => {
    const bmpFixture = TEST_FIXTURE_FILES.bmpFile;

    test('reads and processes REAL BMP file', async () => {
      const result = await analyzeImageFile(bmpFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });
  });

  describe('WebP Files - Real Image Analysis', () => {
    const webpFixture = TEST_FIXTURE_FILES.webpFile;

    test('reads and processes REAL WebP file', async () => {
      const result = await analyzeImageFile(webpFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });
  });

  describe('TIFF Files - Real Image Analysis', () => {
    const tiffFixture = TEST_FIXTURE_FILES.tiffFile;

    test('reads and processes REAL TIFF file', async () => {
      const result = await analyzeImageFile(tiffFixture.path, smartFolders);
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });
  });

  describe('Content Flow Verification', () => {
    test('real image binary flows through pipeline', async () => {
      const pngFixture = TEST_FIXTURE_FILES.simplePng;
      await analyzeImageFile(pngFixture.path, smartFolders);

      // Sharp should have been called with image data
      expect(sharp).toHaveBeenCalled();
      // The call should have received a Buffer
      const callArg = sharp.mock.calls[0][0];
      expect(Buffer.isBuffer(callArg)).toBe(true);
    });

    test('generates embedding from real image analysis', async () => {
      const jpgFixture = TEST_FIXTURE_FILES.jpgFile;
      await analyzeImageFile(jpgFixture.path, smartFolders);

      expect(mockFolderMatcher.embedText).toHaveBeenCalled();
    });

    test('queues embedding for persistence', async () => {
      const pngFixture = TEST_FIXTURE_FILES.simplePng;
      await analyzeImageFile(pngFixture.path, smartFolders);

      expect(analysisQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringContaining('image:'),
          vector: expect.any(Array)
        })
      );
    });

    test('pipeline produces valid result structure', async () => {
      const jpgFixture = TEST_FIXTURE_FILES.jpgFile;
      const result = await analyzeImageFile(jpgFixture.path, smartFolders);

      expect(result).toMatchObject({
        category: expect.any(String),
        confidence: expect.any(Number)
      });
    });
  });

  describe('Ollama Offline Fallback', () => {
    beforeEach(() => {
      isOllamaRunningWithRetry.mockResolvedValue(false);
    });

    test('returns fallback when Ollama offline for PNG', async () => {
      const pngFixture = TEST_FIXTURE_FILES.simplePng;
      const result = await analyzeImageFile(pngFixture.path, smartFolders);

      expect(result.extractionMethod).toBe('filename_fallback');
    });

    test('returns fallback when Ollama offline for JPG', async () => {
      const jpgFixture = TEST_FIXTURE_FILES.jpgFile;
      const result = await analyzeImageFile(jpgFixture.path, smartFolders);

      expect(result.extractionMethod).toBe('filename_fallback');
    });

    test('fallback still has valid structure', async () => {
      const pngFixture = TEST_FIXTURE_FILES.simplePng;
      const result = await analyzeImageFile(pngFixture.path, smartFolders);

      expect(result.category).toBeDefined();
      expect(result.keywords).toBeDefined();
    });
  });

  describe('flushAllEmbeddings()', () => {
    test('calls embeddingQueue.flush()', async () => {
      await flushAllEmbeddings();

      expect(analysisQueue.flush).toHaveBeenCalled();
    });
  });
});
