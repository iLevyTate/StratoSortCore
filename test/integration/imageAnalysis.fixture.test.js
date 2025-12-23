/**
 * Integration Tests for Image Analysis
 *
 * Tests image file processing using real test fixtures
 * with mocked Ollama vision service for deterministic results.
 *
 * Uses real test files from test/StratoSortOfTestFiles/
 */

const {
  TEST_FIXTURE_FILES,
  getFixturesByCategory,
  verifyFixturesExist,
  getMockSmartFolders,
  createMockOllamaImageResponse
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

// Mock ServiceContainer
jest.mock('../../src/main/services/ServiceContainer', () => ({
  container: {
    get: jest.fn(),
    register: jest.fn()
  },
  ServiceIds: {}
}));

describe('Image Analysis - PNG Files', () => {
  let fixturesAvailable = false;

  beforeAll(async () => {
    const result = await verifyFixturesExist();
    fixturesAvailable = result.exists;
    if (!fixturesAvailable) {
      console.warn('Some fixture files are missing:', result.missing);
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Image Fixtures', () => {
    const imageFixtures = getFixturesByCategory('images');
    const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tiff', '.tif'];

    test('has correct number of image fixtures', () => {
      expect(imageFixtures.length).toBe(7); // financialImage, simplePng, samplePhoto, animatedGif, legacyBmp, webGraphic, scanDocument
    });

    test('all image fixtures have image extension', () => {
      for (const fixture of imageFixtures) {
        expect(IMAGE_EXTENSIONS).toContain(fixture.extension);
      }
    });

    test('image fixtures support content analysis', () => {
      for (const fixture of imageFixtures) {
        expect(fixture.supportsContentAnalysis).toBe(true);
        expect(fixture.processingPath).toBe('image_analysis');
      }
    });
  });

  describe('Financial Image Fixture', () => {
    const fixture = TEST_FIXTURE_FILES.financialImage;

    test('has expected metadata', () => {
      expect(fixture.name).toContain('Financial');
      expect(fixture.extension).toBe('.png');
      expect(fixture.category).toBe('images');
    });

    test('has complex filename with date pattern', () => {
      // Filename contains date pattern: 20250911_1017
      expect(fixture.name).toMatch(/\d{8}_\d{4}/);
    });

    test('expected category is Images', () => {
      expect(fixture.expectedCategory).toBe('Images');
    });
  });

  describe('Simple PNG Fixture', () => {
    const fixture = TEST_FIXTURE_FILES.simplePng;

    test('has expected metadata', () => {
      expect(fixture.name).toBe('t2v7h5.png');
      expect(fixture.extension).toBe('.png');
    });

    test('has minimal filename (alphanumeric)', () => {
      expect(fixture.name).toMatch(/^[a-z0-9]+\.png$/);
    });
  });
});

describe('Image Analysis - Fallback Processing', () => {
  const {
    getIntelligentCategory,
    getIntelligentKeywords,
    safeSuggestedName
  } = require('../../src/main/analysis/fallbackUtils');

  describe('Category Detection', () => {
    test('PNG files map to Images category', () => {
      const category = getIntelligentCategory('photo.png', '.png', []);
      expect(category).toBe('Images');
    });

    test('JPEG files map to Images category', () => {
      const category = getIntelligentCategory('photo.jpg', '.jpg', []);
      expect(category).toBe('Images');
    });

    test('WebP files map to Images category', () => {
      const category = getIntelligentCategory('image.webp', '.webp', []);
      expect(category).toBe('Images');
    });

    test('BMP files map to Images category', () => {
      const category = getIntelligentCategory('bitmap.bmp', '.bmp', []);
      expect(category).toBe('Images');
    });
  });

  describe('Smart Folder Matching for Images', () => {
    const smartFolders = getMockSmartFolders();

    test('matches Images folder for generic image', () => {
      const category = getIntelligentCategory('screenshot.png', '.png', smartFolders);
      // "screenshot" matches Images folder keyword
      expect(category).toBe('Images');
    });

    test('matches Images folder by extension fallback', () => {
      const category = getIntelligentCategory('xyz123.png', '.png', smartFolders);
      expect(category).toBe('Images');
    });
  });

  describe('Keyword Generation for Images', () => {
    test('generates image-related keywords', () => {
      const keywords = getIntelligentKeywords('photo.png', '.png');
      expect(keywords).toContain('image');
      expect(keywords).toContain('visual');
      expect(keywords).toContain('graphic');
    });

    test('includes extension in keywords', () => {
      const keywords = getIntelligentKeywords('photo.png', '.png');
      expect(keywords).toContain('png');
    });
  });

  describe('Safe Filename Generation', () => {
    test('sanitizes image filename by replacing spaces', () => {
      const safeName = safeSuggestedName('my photo (1).png', '.png');
      // safeSuggestedName replaces spaces with underscores but keeps parentheses
      expect(safeName).not.toContain(' ');
      expect(safeName.endsWith('.png')).toBe(true);
    });

    test('handles long image filenames', () => {
      const longName = 'a'.repeat(250) + '.png';
      const safeName = safeSuggestedName(longName, '.png');
      expect(safeName.length).toBeLessThanOrEqual(205);
      expect(safeName.endsWith('.png')).toBe(true);
    });
  });
});

describe('Image Analysis - Mock Response', () => {
  test('creates valid mock image response', () => {
    const fixture = TEST_FIXTURE_FILES.simplePng;
    const response = createMockOllamaImageResponse(fixture);

    expect(response.response).toBeDefined();

    const parsed = JSON.parse(response.response);
    expect(parsed.purpose).toBeDefined();
    expect(parsed.category).toBe('Images');
    expect(parsed.content_type).toBe('image');
    expect(parsed.has_text).toBe(false);
    expect(Array.isArray(parsed.colors)).toBe(true);
  });

  test('mock response has required image-specific fields', () => {
    const fixture = TEST_FIXTURE_FILES.financialImage;
    const response = createMockOllamaImageResponse(fixture);
    const parsed = JSON.parse(response.response);

    // Image-specific fields
    expect(parsed.content_type).toBeDefined();
    expect(typeof parsed.has_text).toBe('boolean');
    expect(Array.isArray(parsed.colors)).toBe(true);
  });
});

describe('Image Analysis - Suggested Name Generation', () => {
  const { safeSuggestedName } = require('../../src/main/analysis/fallbackUtils');

  test('handles complex image filename', () => {
    const complexName =
      '20250911_1017_Imposter Financial Document_simple_compose_01k4wj305neqr9pjgx4m1b9mdr.png';
    const safeName = safeSuggestedName(complexName, '.png');

    expect(safeName).toBeDefined();
    expect(safeName.endsWith('.png')).toBe(true);
    expect(safeName.length).toBeLessThanOrEqual(205);
    expect(safeName).not.toContain(' ');
  });

  test('preserves alphanumeric characters', () => {
    const simpleName = 't2v7h5.png';
    const safeName = safeSuggestedName(simpleName, '.png');

    expect(safeName).toBe('t2v7h5.png');
  });

  test('handles image names with special characters', () => {
    const specialName = 'image [final] (copy).png';
    const safeName = safeSuggestedName(specialName, '.png');

    // safeSuggestedName only removes: < > : " / \ | ? * and control chars
    // Brackets and parentheses are preserved but spaces become underscores
    expect(safeName).not.toContain(' ');
    expect(safeName.endsWith('.png')).toBe(true);
  });
});

describe('Image Analysis - Edge Cases', () => {
  const {
    getIntelligentCategory,
    safeSuggestedName
  } = require('../../src/main/analysis/fallbackUtils');

  describe('Unsupported Image Formats', () => {
    test('TIFF files map to Images', () => {
      const category = getIntelligentCategory('scan.tiff', '.tiff', []);
      expect(category).toBe('Images');
    });

    test('Unknown image format falls back to Documents', () => {
      const category = getIntelligentCategory('file.raw', '.raw', []);
      expect(category).toBe('Documents');
    });
  });

  describe('Filename Edge Cases', () => {
    test('handles emoji in filename', () => {
      const safeName = safeSuggestedName('photo_📸.png', '.png');
      expect(safeName).toBeDefined();
      expect(safeName.endsWith('.png')).toBe(true);
    });

    test('handles only extension', () => {
      const safeName = safeSuggestedName('.png', '.png');
      expect(safeName).toBeDefined();
      expect(safeName.length).toBeGreaterThan(4);
    });

    test('handles double extensions', () => {
      const safeName = safeSuggestedName('file.backup.png', '.png');
      expect(safeName.endsWith('.png')).toBe(true);
    });
  });
});
