/**
 * Integration Tests for Complete File Processing Pipeline
 *
 * Tests the full workflow from file input through analysis,
 * naming, and folder suggestion using real test fixtures.
 *
 * This test validates the entire processing chain works together.
 *
 * Uses real test files from test/test-files/
 */

const {
  TEST_FIXTURE_FILES,
  getAllFixtureKeys,
  getContentAnalysisFixtures,
  getExtensionFallbackFixtures,
  verifyFixturesExist,
  getMockSmartFolders,
  createMockAnalysisResult,
  createTestFileObject
} = require('../utils/fileTypeFixtures');

const {
  getIntelligentCategory,
  getIntelligentKeywords,
  safeSuggestedName
} = require('../../src/main/analysis/fallbackUtils');

const {
  generateSuggestedNameFromAnalysis,
  extractExtension
} = require('../../src/renderer/phases/discover/namingUtils');

describe('File Processing Pipeline - Complete Workflow', () => {
  let fixturesAvailable = false;
  const smartFolders = getMockSmartFolders();

  beforeAll(async () => {
    const result = await verifyFixturesExist();
    fixturesAvailable = result.exists;
    if (!fixturesAvailable) {
      console.warn('Some fixture files are missing:', result.missing);
    }
  });

  describe('Pipeline Stage Verification', () => {
    test('all pipeline stages are available', () => {
      // Verify all required functions exist
      expect(typeof getIntelligentCategory).toBe('function');
      expect(typeof getIntelligentKeywords).toBe('function');
      expect(typeof safeSuggestedName).toBe('function');
      expect(typeof generateSuggestedNameFromAnalysis).toBe('function');
      expect(typeof extractExtension).toBe('function');
    });
  });

  describe('Full Pipeline - Financial PDF', () => {
    const fixture = TEST_FIXTURE_FILES.financialPdf;

    test('complete pipeline produces valid output', () => {
      // Stage 1: Input file
      const fileName = fixture.name;
      const extension = fixture.extension;

      // Stage 2: Category detection
      const category = getIntelligentCategory(fileName, extension, smartFolders);
      expect(category).toBe('Financial');

      // Stage 3: Keyword extraction
      const keywords = getIntelligentKeywords(fileName, extension);
      expect(Array.isArray(keywords)).toBe(true);
      expect(keywords.length).toBeGreaterThan(0);

      // Stage 4: Create mock analysis (simulates AI analysis)
      const analysis = createMockAnalysisResult(fixture, {
        category,
        keywords,
        date: '2024-01-15',
        suggestedName: 'Annual_Financial_Statement'
      });

      // Stage 5: Generate suggested name
      const namingSettings = {
        convention: 'subject-date',
        separator: '-',
        dateFormat: 'YYYY-MM-DD',
        caseConvention: 'kebab-case'
      };

      const suggestedName = generateSuggestedNameFromAnalysis({
        originalFileName: fileName,
        analysis,
        settings: namingSettings
      });

      // Verify final output
      expect(suggestedName).toBeDefined();
      expect(suggestedName.endsWith('.pdf')).toBe(true);
      expect(suggestedName).toContain('2024-01-15');
      expect(suggestedName).toMatch(/annual-financial-statement/i);
    });

    test('pipeline with different naming conventions', () => {
      const analysis = createMockAnalysisResult(fixture, {
        date: '2024-06-20',
        suggestedName: 'Q2_Financial_Report'
      });

      const conventions = [
        { convention: 'subject-date', expected: /report.*2024-06-20/i },
        { convention: 'date-subject', expected: /20240620.*report/i },
        { convention: 'keep-original', expected: /Annual_Financial_Statement_2024/ }
      ];

      for (const { convention, expected } of conventions) {
        const result = generateSuggestedNameFromAnalysis({
          originalFileName: fixture.name,
          analysis,
          settings: {
            convention,
            separator: convention === 'date-subject' ? '_' : '-',
            dateFormat: convention === 'date-subject' ? 'YYYYMMDD' : 'YYYY-MM-DD',
            caseConvention: convention === 'keep-original' ? undefined : 'kebab-case'
          }
        });

        expect(result).toMatch(expected);
        expect(result.endsWith('.pdf')).toBe(true);
      }
    });
  });

  describe('Full Pipeline - Image File', () => {
    const fixture = TEST_FIXTURE_FILES.simplePng;

    test('complete pipeline for image file', () => {
      // Stage 1 & 2: Input and category
      const category = getIntelligentCategory(fixture.name, fixture.extension, smartFolders);
      expect(category).toBe('Images');

      // Stage 3: Keywords
      const keywords = getIntelligentKeywords(fixture.name, fixture.extension);
      expect(keywords).toContain('image');
      expect(keywords).toContain('png');

      // Stage 4 & 5: Analysis and naming
      const analysis = createMockAnalysisResult(fixture, {
        category,
        keywords,
        suggestedName: 'test_image'
      });

      const result = generateSuggestedNameFromAnalysis({
        originalFileName: fixture.name,
        analysis,
        settings: {
          convention: 'subject-date',
          separator: '_',
          dateFormat: 'YYYYMMDD',
          caseConvention: 'snake_case'
        }
      });

      expect(result.endsWith('.png')).toBe(true);
    });
  });

  describe('Full Pipeline - 3D Model File', () => {
    const fixture = TEST_FIXTURE_FILES.stlFile;

    test('complete pipeline for STL file', () => {
      // Stage 1 & 2: Input and category
      const category = getIntelligentCategory(fixture.name, fixture.extension, smartFolders);
      // Without keywords, falls back to Documents
      expect(category).toBeDefined();

      // Stage 3: Keywords
      const keywords = getIntelligentKeywords(fixture.name, fixture.extension);
      expect(keywords).toContain('stl');

      // Stage 4 & 5: Analysis and naming
      const analysis = createMockAnalysisResult(fixture, {
        category,
        keywords,
        suggestedName: 'bracket_model'
      });

      const result = generateSuggestedNameFromAnalysis({
        originalFileName: fixture.name,
        analysis,
        settings: {
          convention: 'subject-date',
          separator: '_',
          dateFormat: 'YYYYMMDD'
        }
      });

      expect(result.endsWith('.stl')).toBe(true);
    });

    test('pipeline with 3D model keyword matching', () => {
      // Create a filename with 3D keywords
      const modelFileName = 'my_3d_model_v2.stl';
      const category = getIntelligentCategory(modelFileName, '.stl', smartFolders);
      expect(category).toBe('3D Models');
    });
  });
});

describe('File Processing Pipeline - Batch Processing', () => {
  const smartFolders = getMockSmartFolders();

  test('processes all fixtures through pipeline', () => {
    const results = [];

    for (const key of getAllFixtureKeys()) {
      const fixture = TEST_FIXTURE_FILES[key];

      // Run through pipeline stages
      const category = getIntelligentCategory(fixture.name, fixture.extension, smartFolders);
      const keywords = getIntelligentKeywords(fixture.name, fixture.extension);
      const analysis = createMockAnalysisResult(fixture, { category, keywords });

      const suggestedName = generateSuggestedNameFromAnalysis({
        originalFileName: fixture.name,
        analysis,
        settings: {
          convention: 'subject-date',
          separator: '-',
          dateFormat: 'YYYY-MM-DD'
        }
      });

      results.push({
        fixture: key,
        originalName: fixture.name,
        category,
        keywords: keywords.length,
        suggestedName
      });
    }

    // Verify all fixtures processed successfully
    expect(results.length).toBe(getAllFixtureKeys().length);

    for (const result of results) {
      expect(result.category).toBeDefined();
      expect(result.keywords).toBeGreaterThan(0);
      expect(result.suggestedName).toBeDefined();
      expect(result.suggestedName.length).toBeGreaterThan(0);
    }
  });

  test('categorizes fixtures correctly', () => {
    const categoryCounts = {};

    for (const key of getAllFixtureKeys()) {
      const fixture = TEST_FIXTURE_FILES[key];
      const category = getIntelligentCategory(fixture.name, fixture.extension, smartFolders);

      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    }

    // Should have multiple categories
    expect(Object.keys(categoryCounts).length).toBeGreaterThan(1);
  });
});

describe('File Processing Pipeline - Extension Fallback Files', () => {
  const smartFolders = getMockSmartFolders();
  const fallbackFixtures = getExtensionFallbackFixtures();

  test('all fallback fixtures use extension-based processing', () => {
    for (const fixture of fallbackFixtures) {
      expect(fixture.supportsContentAnalysis).toBe(false);
      expect(fixture.processingPath).toBe('extension_fallback');
    }
  });

  test('fallback fixtures still produce valid pipeline output', () => {
    for (const fixture of fallbackFixtures) {
      const category = getIntelligentCategory(fixture.name, fixture.extension, smartFolders);
      const keywords = getIntelligentKeywords(fixture.name, fixture.extension);
      const safeName = safeSuggestedName(fixture.name, fixture.extension);

      expect(category).toBeDefined();
      expect(Array.isArray(keywords)).toBe(true);
      expect(safeName.endsWith(fixture.extension)).toBe(true);
    }
  });
});

describe('File Processing Pipeline - Content Analysis Files', () => {
  const contentFixtures = getContentAnalysisFixtures();
  const VALID_PROCESSING_PATHS = ['document_extraction', 'image_analysis', 'archive_extraction'];

  test('content analysis fixtures are correctly identified', () => {
    expect(contentFixtures.length).toBeGreaterThan(0);

    for (const fixture of contentFixtures) {
      expect(fixture.supportsContentAnalysis).toBe(true);
      expect(VALID_PROCESSING_PATHS).toContain(fixture.processingPath);
    }
  });
});

describe('File Processing Pipeline - Output Validation', () => {
  describe.each(getAllFixtureKeys())('%s - complete validation', (fixtureKey) => {
    const fixture = TEST_FIXTURE_FILES[fixtureKey];
    const smartFolders = getMockSmartFolders();

    test('generates valid suggested name', () => {
      const analysis = createMockAnalysisResult(fixture);
      const result = generateSuggestedNameFromAnalysis({
        originalFileName: fixture.name,
        analysis,
        settings: {
          convention: 'subject-date',
          separator: '-',
          dateFormat: 'YYYY-MM-DD'
        }
      });

      // Must have correct extension
      expect(result.endsWith(fixture.extension)).toBe(true);

      // Must not be empty
      expect(result.length).toBeGreaterThan(fixture.extension.length);

      // Must not contain invalid characters
      expect(result).not.toContain('/');
      expect(result).not.toContain('\\');
      expect(result).not.toContain(':');
      expect(result).not.toContain('*');
      expect(result).not.toContain('?');
      expect(result).not.toContain('"');
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).not.toContain('|');
    });

    test('generates valid safe name', () => {
      const safeName = safeSuggestedName(fixture.name, fixture.extension);

      expect(safeName.endsWith(fixture.extension)).toBe(true);
      expect(safeName.length).toBeLessThanOrEqual(205);
    });

    test('assigns a category', () => {
      const category = getIntelligentCategory(fixture.name, fixture.extension, smartFolders);
      expect(category).toBeDefined();
      expect(typeof category).toBe('string');
    });

    test('generates keywords', () => {
      const keywords = getIntelligentKeywords(fixture.name, fixture.extension);
      expect(Array.isArray(keywords)).toBe(true);
      expect(keywords.length).toBeLessThanOrEqual(7);
    });
  });
});

describe('File Processing Pipeline - Error Handling', () => {
  test('handles missing analysis gracefully', () => {
    const result = generateSuggestedNameFromAnalysis({
      originalFileName: 'test.pdf',
      analysis: null,
      settings: {
        convention: 'keep-original'
      }
    });

    expect(result).toBe('test.pdf');
  });

  test('handles empty filename', () => {
    const result = generateSuggestedNameFromAnalysis({
      originalFileName: '',
      analysis: {},
      settings: {
        convention: 'keep-original'
      }
    });

    expect(result).toBe('');
  });

  test('handles undefined settings', () => {
    const result = generateSuggestedNameFromAnalysis({
      originalFileName: 'test.pdf',
      analysis: createMockAnalysisResult(TEST_FIXTURE_FILES.financialPdf),
      settings: undefined
    });

    // Should use defaults
    expect(result.endsWith('.pdf')).toBe(true);
  });
});

describe('File Processing Pipeline - Real File Objects', () => {
  test('creates file object for existing fixture', async () => {
    const fixturesResult = await verifyFixturesExist();

    if (!fixturesResult.exists) {
      console.warn('Skipping test: not all fixtures available');
      return;
    }

    const fileObject = await createTestFileObject('financialPdf');

    expect(fileObject.name).toBe(TEST_FIXTURE_FILES.financialPdf.name);
    expect(fileObject.path).toBeDefined();
    expect(fileObject.extension).toBe('.pdf');
    expect(typeof fileObject.size).toBe('number');
    expect(fileObject.size).toBeGreaterThan(0);
  });

  test('file object includes fixture reference', async () => {
    const fixturesResult = await verifyFixturesExist();

    if (!fixturesResult.exists) {
      console.warn('Skipping test: not all fixtures available');
      return;
    }

    const fileObject = await createTestFileObject('stlFile');

    expect(fileObject.fixture).toBeDefined();
    expect(fileObject.fixture.category).toBe('3d_models');
  });
});
