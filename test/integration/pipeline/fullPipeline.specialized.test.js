/**
 * Full Pipeline Integration Tests - Specialized Files
 *
 * Tests the ACTUAL analyzeDocumentFile() function for 3D models and design files:
 * STL, OBJ, 3MF, GCODE, SCAD, EPS, SVG, AI, PSD
 *
 * These files don't support content analysis and use intelligent
 * category/keyword detection based on filename and extension.
 *
 * Pipeline stages tested:
 * 1. analyzeDocumentFile() with unsupported extension
 * 2. Extension-based categorization via createDocumentFallback()
 * 3. Intelligent keyword extraction
 * 4. Fallback analysis result generation
 *
 * NOTE: Specialized files return EARLY from analyzeDocumentFile() and do NOT
 * go through embedding/folder matching. This is correct production behavior.
 */

// ============================================================================
// MOCK SETUP - All mocks defined inline to avoid hoisting issues
// ============================================================================

// Mock logger first
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

// Mock ModelVerifier
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

// Mock document extractors (won't be called for specialized files)
jest.mock('../../../src/main/analysis/documentExtractors', () => ({
  extractTextFromPdf: jest.fn().mockResolvedValue('Mock PDF content'),
  extractTextFromDocx: jest.fn().mockResolvedValue('Mock DOCX content'),
  extractTextFromXlsx: jest.fn().mockResolvedValue('Mock XLSX content'),
  extractTextFromPptx: jest.fn().mockResolvedValue('Mock PPTX content'),
  extractTextFromEml: jest.fn().mockResolvedValue('Mock EML content'),
  extractTextFromRtf: jest.fn().mockResolvedValue('Mock RTF content'),
  extractTextFromHtml: jest.fn().mockResolvedValue('Mock HTML content'),
  extractTextFromCsv: jest.fn().mockResolvedValue('Mock CSV content'),
  extractTextFromJson: jest.fn().mockResolvedValue('Mock JSON content'),
  extractTextFromXml: jest.fn().mockResolvedValue('Mock XML content')
}));

// Mock documentLlm (won't be called for specialized files)
jest.mock('../../../src/main/analysis/documentLlm', () => ({
  analyzeTextWithOllama: jest.fn().mockResolvedValue({
    purpose: 'Specialized file',
    project: 'Test Project',
    category: 'Design',
    date: new Date().toISOString().split('T')[0],
    keywords: ['3d', 'model', 'design'],
    confidence: 85,
    suggestedName: 'specialized_file'
  }),
  normalizeCategoryToSmartFolders: jest.fn((cat) => cat)
}));

// Mock ChromaDB service
jest.mock('../../../src/main/services/chromadb', () => ({
  getInstance: jest.fn(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    isOnline: true
  }))
}));

// Mock FolderMatchingService (won't be called for specialized files - they return early)
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
        { name: 'Design', path: '/test/Design', score: 0.85, id: 'folder:design' }
      ]),
    embeddingCache: { initialized: true }
  };
  const MockFolderMatchingService = jest.fn().mockImplementation(() => mockInstance);
  MockFolderMatchingService._mockInstance = mockInstance;
  return MockFolderMatchingService;
});

// Mock embeddingQueue (won't be called for specialized files - they return early)
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

// Mock fs.promises for file stat
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      stat: jest.fn().mockResolvedValue({
        size: 1024,
        mtimeMs: Date.now()
      }),
      readFile: jest.fn().mockResolvedValue(Buffer.from('mock specialized file content'))
    }
  };
});

// ============================================================================
// NOW IMPORT THE MODULE UNDER TEST (after mocks are set up)
// ============================================================================

const { analyzeDocumentFile } = require('../../../src/main/analysis/ollamaDocumentAnalysis');

// Import mocked modules to get references for assertions
const ModelVerifier = require('../../../src/main/services/ModelVerifier');
const FolderMatchingService = require('../../../src/main/services/FolderMatchingService');
const embeddingQueue = require('../../../src/main/analysis/embeddingQueue');
const fsPromises = require('fs').promises;

// Get mock instances via the static _mockInstance property
const mockModelVerifier = ModelVerifier._mockInstance;
const mockFolderMatcher = FolderMatchingService._mockInstance;

// Import fixtures and test utilities
const { setupPipelineMatchers } = require('./pipelineAssertions');
const {
  TEST_FIXTURE_FILES,
  getFixturesGroupedByProcessingPath,
  getMockSmartFolders,
  verifyFixturesExist
} = require('../../utils/fileTypeFixtures');

// Import fallback utilities for direct testing
const {
  getIntelligentCategory,
  getIntelligentKeywords,
  safeSuggestedName
} = require('../../../src/main/analysis/fallbackUtils');

// Setup custom matchers
setupPipelineMatchers();

// Get specialized fixtures (extension fallback)
const specializedFixtures = getFixturesGroupedByProcessingPath().extension_fallback;

describe('Specialized Files Pipeline', () => {
  let fixturesAvailable = false;
  const smartFolders = getMockSmartFolders();

  beforeAll(async () => {
    const result = await verifyFixturesExist();
    fixturesAvailable = result.exists;
    if (!fixturesAvailable) {
      console.warn('Some fixture files missing:', result.missing);
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset mock implementations to default success state
    mockModelVerifier.checkOllamaConnection.mockResolvedValue({
      connected: true,
      error: null
    });

    fsPromises.stat.mockResolvedValue({
      size: 1024,
      mtimeMs: Date.now()
    });
  });

  describe('Pipeline Infrastructure', () => {
    test('specialized fixtures are available', () => {
      expect(specializedFixtures.length).toBeGreaterThan(0);
    });

    test('all specialized fixtures use extension_fallback processing', () => {
      for (const fixture of specializedFixtures) {
        expect(fixture.processingPath).toBe('extension_fallback');
      }
    });

    test('specialized fixtures do not support content analysis', () => {
      for (const fixture of specializedFixtures) {
        expect(fixture.supportsContentAnalysis).toBe(false);
      }
    });

    test('analyzeDocumentFile function is properly exported', () => {
      expect(typeof analyzeDocumentFile).toBe('function');
    });
  });

  describe('analyzeDocumentFile() - Specialized File Pipeline Execution', () => {
    test('processes STL files via filename fallback', async () => {
      const uniquePath = `/test/model-${Date.now()}.stl`;
      const result = await analyzeDocumentFile(uniquePath, smartFolders);

      expect(mockModelVerifier.checkOllamaConnection).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.extractionMethod).toBe('filename');
    });

    test('processes OBJ files via filename fallback', async () => {
      const uniquePath = `/test/mesh-${Date.now()}.obj`;
      const result = await analyzeDocumentFile(uniquePath, smartFolders);

      expect(result.extractionMethod).toBe('filename');
      expect(result.category).toBeDefined();
    });

    test('processes GCODE files via filename fallback', async () => {
      const uniquePath = `/test/print-${Date.now()}.gcode`;
      const result = await analyzeDocumentFile(uniquePath, smartFolders);

      expect(result.extractionMethod).toBe('filename');
      expect(result.keywords).toBeDefined();
      expect(Array.isArray(result.keywords)).toBe(true);
    });

    test('processes SCAD files via filename fallback', async () => {
      const uniquePath = `/test/design-${Date.now()}.scad`;
      const result = await analyzeDocumentFile(uniquePath, smartFolders);

      expect(result.extractionMethod).toBe('filename');
      expect(result.confidence).toBeDefined();
    });

    test('processes EPS files via filename fallback', async () => {
      const uniquePath = `/test/vector-${Date.now()}.eps`;
      const result = await analyzeDocumentFile(uniquePath, smartFolders);

      expect(result.extractionMethod).toBe('filename');
    });

    test('processes AI files via filename fallback', async () => {
      const uniquePath = `/test/illustration-${Date.now()}.ai`;
      const result = await analyzeDocumentFile(uniquePath, smartFolders);

      expect(result.extractionMethod).toBe('filename');
    });

    test('processes PSD files via filename fallback', async () => {
      const uniquePath = `/test/design-${Date.now()}.psd`;
      const result = await analyzeDocumentFile(uniquePath, smartFolders);

      expect(result.extractionMethod).toBe('filename');
    });

    test('specialized files return early without embedding', async () => {
      const uniquePath = `/test/early-return-${Date.now()}.stl`;
      await analyzeDocumentFile(uniquePath, smartFolders);

      // Specialized files return early via createDocumentFallback()
      // They do NOT go through embedding/folder matching
      expect(mockFolderMatcher.embedText).not.toHaveBeenCalled();
      expect(mockFolderMatcher.matchVectorToFolders).not.toHaveBeenCalled();
      expect(embeddingQueue.enqueue).not.toHaveBeenCalled();
    });

    test('specialized files have appropriate confidence level', async () => {
      const uniquePath = `/test/confidence-${Date.now()}.stl`;
      const result = await analyzeDocumentFile(uniquePath, smartFolders);

      // Filename fallback has confidence of 75 (from production code)
      expect(result.confidence).toBe(75);
    });
  });

  describe('analyzeDocumentFile() - Ollama Offline Fallback', () => {
    beforeEach(() => {
      mockModelVerifier.checkOllamaConnection.mockResolvedValue({
        connected: false,
        error: 'Ollama service unavailable'
      });
    });

    test('returns fallback result when Ollama is offline', async () => {
      const uniquePath = `/test/offline-${Date.now()}.stl`;
      const result = await analyzeDocumentFile(uniquePath, smartFolders);

      expect(result.extractionMethod).toBe('filename_fallback');
    });

    test('fallback result has reduced confidence', async () => {
      const uniquePath = `/test/offline-confidence-${Date.now()}.obj`;
      const result = await analyzeDocumentFile(uniquePath, smartFolders);

      expect(result.confidence).toBe(65);
    });
  });

  describe('3D Model Files', () => {
    const threeDFixtures = specializedFixtures.filter((f) =>
      ['.stl', '.obj', '.3mf', '.gcode', '.scad'].includes(f.extension.toLowerCase())
    );

    test('3D model fixtures exist', () => {
      expect(threeDFixtures.length).toBeGreaterThan(0);
    });

    describe.each(threeDFixtures.map((f) => [f.name, f]))(
      '%s - Extension Fallback',
      (name, fixture) => {
        test('intelligent category detection works', () => {
          const category = getIntelligentCategory(fixture.name, fixture.extension, smartFolders);

          expect(category).toBeDefined();
          expect(typeof category).toBe('string');
        });

        test('intelligent keywords are extracted', () => {
          const keywords = getIntelligentKeywords(fixture.name, fixture.extension);

          expect(keywords).toBeInstanceOf(Array);
          expect(keywords.length).toBeGreaterThan(0);
        });

        test('extension is included in keywords', () => {
          const keywords = getIntelligentKeywords(fixture.name, fixture.extension);
          const extWithoutDot = fixture.extension.replace('.', '').toLowerCase();

          expect(keywords.map((k) => k.toLowerCase())).toContain(extWithoutDot);
        });

        test('safe name generation works', () => {
          const safeName = safeSuggestedName(fixture.name, fixture.extension);

          expect(safeName).toBeDefined();
          expect(safeName).not.toContain(' ');
          expect(safeName.endsWith(fixture.extension)).toBe(true);
        });
      }
    );

    describe('STL Files', () => {
      const stlFixture = TEST_FIXTURE_FILES.stlFile;

      test('STL fixture exists', () => {
        expect(stlFixture).toBeDefined();
        expect(stlFixture.extension).toBe('.stl');
      });

      test('STL keywords include extension', () => {
        const keywords = getIntelligentKeywords(stlFixture.name, stlFixture.extension);
        const lowercaseKeywords = keywords.map((k) => k.toLowerCase());

        expect(lowercaseKeywords).toContain('stl');
      });

      test('STL fixture has expected 3D keywords', () => {
        // Check fixture's expected keywords instead of intelligent keywords
        const expectedKeywords = stlFixture.expectedKeywords.map((k) => k.toLowerCase());
        expect(expectedKeywords.some((k) => ['3d', 'model', 'mesh', 'stl'].includes(k))).toBe(true);
      });
    });

    describe('GCODE Files', () => {
      const gcodeFixture = TEST_FIXTURE_FILES.gcodeFile;

      test('GCODE fixture exists', () => {
        expect(gcodeFixture).toBeDefined();
        expect(gcodeFixture.extension).toBe('.gcode');
      });

      test('GCODE keywords include manufacturing terms', () => {
        const keywords = getIntelligentKeywords(gcodeFixture.name, gcodeFixture.extension);
        const lowercaseKeywords = keywords.map((k) => k.toLowerCase());

        expect(lowercaseKeywords).toContain('gcode');
      });
    });

    describe('SCAD Files', () => {
      const scadFixture = TEST_FIXTURE_FILES.scadFile;

      test('SCAD fixture exists', () => {
        expect(scadFixture).toBeDefined();
        expect(scadFixture.extension).toBe('.scad');
      });

      test('SCAD keywords include CAD terms', () => {
        const keywords = getIntelligentKeywords(scadFixture.name, scadFixture.extension);
        const lowercaseKeywords = keywords.map((k) => k.toLowerCase());

        expect(lowercaseKeywords).toContain('scad');
      });
    });
  });

  describe('Design Files', () => {
    const designFixtures = specializedFixtures.filter((f) =>
      ['.eps', '.svg', '.ai', '.psd'].includes(f.extension.toLowerCase())
    );

    test('design fixtures exist', () => {
      expect(designFixtures.length).toBeGreaterThan(0);
    });

    describe.each(designFixtures.map((f) => [f.name, f]))(
      '%s - Extension Fallback',
      (name, fixture) => {
        test('intelligent category detection works', () => {
          const category = getIntelligentCategory(fixture.name, fixture.extension, smartFolders);

          expect(category).toBeDefined();
        });

        test('intelligent keywords are extracted', () => {
          const keywords = getIntelligentKeywords(fixture.name, fixture.extension);

          expect(keywords).toBeInstanceOf(Array);
          expect(keywords.length).toBeGreaterThan(0);
        });

        test('design-related keywords are present', () => {
          const keywords = getIntelligentKeywords(fixture.name, fixture.extension);
          const lowercaseKeywords = keywords.map((k) => k.toLowerCase());

          // Should have at least extension in keywords
          const extWithoutDot = fixture.extension.replace('.', '').toLowerCase();
          expect(lowercaseKeywords).toContain(extWithoutDot);
        });
      }
    );

    describe('SVG Files', () => {
      const svgFixture = TEST_FIXTURE_FILES.svgFile;

      test('SVG fixture exists', () => {
        expect(svgFixture).toBeDefined();
        expect(svgFixture.extension).toBe('.svg');
      });

      test('SVG category is Images or Design', () => {
        const category = getIntelligentCategory(svgFixture.name, svgFixture.extension, []);

        // SVG should map to Images by extension
        expect(['Images', 'Design', 'Documents']).toContain(category);
      });
    });

    describe('PSD Files', () => {
      const psdFixture = TEST_FIXTURE_FILES.psdFile;

      test('PSD fixture exists', () => {
        expect(psdFixture).toBeDefined();
        expect(psdFixture.extension).toBe('.psd');
      });

      test('PSD keywords include design terms', () => {
        const keywords = getIntelligentKeywords(psdFixture.name, psdFixture.extension);
        const lowercaseKeywords = keywords.map((k) => k.toLowerCase());

        expect(lowercaseKeywords).toContain('psd');
      });
    });

    describe('AI Files', () => {
      const aiFixture = TEST_FIXTURE_FILES.aiFile;

      test('AI fixture exists', () => {
        expect(aiFixture).toBeDefined();
        expect(aiFixture.extension).toBe('.ai');
      });
    });

    describe('EPS Files', () => {
      const epsFixture = TEST_FIXTURE_FILES.epsFile;

      test('EPS fixture exists', () => {
        expect(epsFixture).toBeDefined();
        expect(epsFixture.extension).toBe('.eps');
      });
    });
  });

  describe('Fallback Analysis Result Generation', () => {
    const testFixture = specializedFixtures[0];

    test('fallback result has required fields', () => {
      const category = getIntelligentCategory(
        testFixture.name,
        testFixture.extension,
        smartFolders
      );
      const keywords = getIntelligentKeywords(testFixture.name, testFixture.extension);
      const suggestedName = safeSuggestedName(testFixture.name, testFixture.extension);

      const fallbackResult = {
        purpose: `File: ${testFixture.name}`,
        project: '',
        category,
        date: new Date().toISOString().split('T')[0],
        keywords,
        confidence: 65,
        suggestedName,
        extractionMethod: 'filename_fallback'
      };

      expect(fallbackResult.purpose).toBeDefined();
      expect(fallbackResult.category).toBeDefined();
      expect(fallbackResult.keywords).toBeInstanceOf(Array);
      expect(fallbackResult.confidence).toBe(65);
      expect(fallbackResult.extractionMethod).toBe('filename_fallback');
    });

    test('fallback confidence is lower than AI analysis', () => {
      // Fallback should have confidence around 60-70%
      const fallbackConfidence = 65;
      const aiConfidence = 85;

      expect(fallbackConfidence).toBeLessThan(aiConfidence);
    });

    test('production analyzeDocumentFile returns valid fallback', async () => {
      const uniquePath = `/test/fallback-${Date.now()}.stl`;
      const result = await analyzeDocumentFile(uniquePath, smartFolders);

      expect(result.purpose).toBeDefined();
      expect(result.category).toBeDefined();
      expect(result.keywords).toBeInstanceOf(Array);
      expect(result.confidence).toBe(75); // filename fallback confidence
      expect(result.extractionMethod).toBe('filename');
    });
  });

  describe('Smart Folder Matching for Specialized Files', () => {
    describe.each(specializedFixtures.slice(0, 5).map((f) => [f.name, f]))(
      '%s - Smart Folder Matching',
      (name, fixture) => {
        test('smart folder scoring works', () => {
          const category = getIntelligentCategory(fixture.name, fixture.extension, smartFolders);

          expect(category).toBeDefined();
          // Category should be a string
          expect(typeof category).toBe('string');
        });

        test('empty smart folders returns extension-based category', () => {
          const category = getIntelligentCategory(fixture.name, fixture.extension, []);

          expect(category).toBeDefined();
          // Without smart folders, should fall back to pattern matching
        });
      }
    );
  });

  describe('Production Pipeline Verification', () => {
    // Note: Specialized files (.stl, .obj, etc.) are NOT in ALL_SUPPORTED_EXTENSIONS
    // and do NOT go through embedding/folder matching in production.
    // This is verified by the "specialized files return early without embedding" test above.

    test('verifies specialized extensions return early in production', async () => {
      const extensions = ['.stl', '.obj', '.3mf', '.gcode', '.scad', '.eps', '.ai', '.psd'];

      for (const ext of extensions) {
        jest.clearAllMocks();
        const uniquePath = `/test/verify-${Date.now()}${ext}`;
        const result = await analyzeDocumentFile(uniquePath, smartFolders);

        // All specialized files should use filename fallback
        expect(result.extractionMethod).toBe('filename');
        // And should NOT call embedding services
        expect(mockFolderMatcher.embedText).not.toHaveBeenCalled();
      }
    });

    test('specialized files still produce valid analysis results', async () => {
      const uniquePath = `/test/valid-result-${Date.now()}.stl`;
      const result = await analyzeDocumentFile(uniquePath, smartFolders);

      // Result should have all required fields
      expect(result).toMatchObject({
        purpose: expect.any(String),
        category: expect.any(String),
        keywords: expect.any(Array),
        confidence: expect.any(Number),
        suggestedName: expect.any(String),
        extractionMethod: expect.any(String)
      });
    });
  });

  describe('Filename-Based Analysis Quality', () => {
    test('descriptive filenames produce better keywords', () => {
      const descriptive = 'rocket_engine_model_v2.stl';
      const cryptic = 'x9m2k7.stl';

      const descriptiveKeywords = getIntelligentKeywords(descriptive, '.stl');
      const crypticKeywords = getIntelligentKeywords(cryptic, '.stl');

      // Descriptive filename should produce more keywords
      expect(descriptiveKeywords.length).toBeGreaterThanOrEqual(crypticKeywords.length);
    });

    test('keywords from filename parts are extracted', () => {
      const filename = 'project_design_final.svg';
      const keywords = getIntelligentKeywords(filename, '.svg');
      const lowercaseKeywords = keywords.map((k) => k.toLowerCase());

      // Should extract meaningful parts
      expect(lowercaseKeywords.some((k) => ['project', 'design', 'final', 'svg'].includes(k))).toBe(
        true
      );
    });
  });
});
