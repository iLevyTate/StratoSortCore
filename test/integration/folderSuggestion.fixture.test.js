/**
 * Integration Tests for Folder Suggestion
 *
 * Tests folder matching and suggestion logic using real test fixtures
 * with mocked ChromaDB and embedding services.
 *
 * Uses real test files from test/StratoSortOfTestFiles/
 */

const {
  TEST_FIXTURE_FILES,
  getAllFixtureKeys,
  verifyFixturesExist,
  getMockSmartFolders,
  createMockAnalysisResult
} = require('../utils/fileTypeFixtures');

const { getIntelligentCategory } = require('../../src/main/analysis/fallbackUtils');

describe('Folder Suggestion - Fixture Integration', () => {
  const smartFolders = getMockSmartFolders();

  beforeAll(async () => {
    await verifyFixturesExist();
  });

  describe('Smart Folder Configuration', () => {
    test('has all required folders', () => {
      const folderNames = smartFolders.map((f) => f.name);
      expect(folderNames).toContain('Financial');
      expect(folderNames).toContain('Design');
      expect(folderNames).toContain('3D Models');
      expect(folderNames).toContain('Images');
      expect(folderNames).toContain('Documents');
    });

    test('each folder has required properties', () => {
      for (const folder of smartFolders) {
        expect(folder.id).toBeDefined();
        expect(folder.name).toBeDefined();
        expect(folder.path).toBeDefined();
        expect(folder.description).toBeDefined();
        expect(Array.isArray(folder.keywords)).toBe(true);
        expect(folder.keywords.length).toBeGreaterThan(0);
      }
    });

    test('Financial folder has relevant keywords', () => {
      const financial = smartFolders.find((f) => f.name === 'Financial');
      expect(financial.keywords).toContain('invoice');
      expect(financial.keywords).toContain('statement');
    });

    test('3D Models folder has relevant keywords', () => {
      const models = smartFolders.find((f) => f.name === '3D Models');
      expect(models.keywords).toContain('3d');
      expect(models.keywords).toContain('model');
      expect(models.keywords).toContain('print');
    });
  });

  describe('Financial PDF -> Financial Folder', () => {
    const fixture = TEST_FIXTURE_FILES.financialPdf;

    test('matches Financial folder by filename keywords', () => {
      const category = getIntelligentCategory(fixture.name, fixture.extension, smartFolders);
      // "financial" and "statement" in filename should match Financial folder
      expect(category).toBe('Financial');
    });

    test('matches with description keywords or pattern', () => {
      // Create a filename that matches description keywords
      const category = getIntelligentCategory('budget_planning_2024.pdf', '.pdf', smartFolders);
      // "budget" is in Financial folder keywords and "budget" is also in financial pattern
      // Function may return: Financial (folder), financial (pattern), or project (pattern for "planning")
      expect(['Financial', 'financial', 'project']).toContain(category);
    });
  });

  describe('Image Files -> Images Folder', () => {
    test('PNG files match Images folder', () => {
      const fixture = TEST_FIXTURE_FILES.simplePng;
      const category = getIntelligentCategory(fixture.name, fixture.extension, smartFolders);
      expect(category).toBe('Images');
    });

    test('screenshot matches Images folder', () => {
      const category = getIntelligentCategory('screenshot_2024.png', '.png', smartFolders);
      expect(category).toBe('Images');
    });

    test('vacation photo may match personal pattern', () => {
      const category = getIntelligentCategory('vacation_photo.jpg', '.jpg', smartFolders);
      // "vacation" matches personal pattern (vacation, travel, family)
      // "photo" is in Images folder keywords
      // Pattern matching may win if score is higher
      expect(['Images', 'personal']).toContain(category);
    });
  });

  describe('Design Files -> Design Folder', () => {
    test('design keyword matches Design folder', () => {
      const category = getIntelligentCategory('logo_design_v2.ai', '.ai', smartFolders);
      // "design" matches Design folder
      expect(category).toBe('Design');
    });

    test('graphic keyword matches Design folder', () => {
      const category = getIntelligentCategory('vector_graphic.svg', '.svg', smartFolders);
      // "graphic" matches Design folder keywords
      expect(category).toBe('Design');
    });

    test('creative keyword matches Design folder', () => {
      const category = getIntelligentCategory('creative_assets.psd', '.psd', smartFolders);
      // "creative" matches Design folder keywords
      expect(category).toBe('Design');
    });
  });

  describe('3D Model Files -> 3D Models Folder', () => {
    test('3d and model keywords together match 3D Models folder', () => {
      // Need multiple keywords to score >= 5 for smart folder match
      const category = getIntelligentCategory('my_3d_model_file.stl', '.stl', smartFolders);
      expect(category).toBe('3D Models');
    });

    test('model keyword matches 3D Models folder', () => {
      const category = getIntelligentCategory('character_model.obj', '.obj', smartFolders);
      expect(category).toBe('3D Models');
    });

    test('print and 3d keywords together match 3D Models folder', () => {
      // Single keyword may not score high enough; combine keywords
      const category = getIntelligentCategory('3d_print_ready.3mf', '.3mf', smartFolders);
      expect(category).toBe('3D Models');
    });
  });

  describe('Fallback to Extension Category', () => {
    test('unknown filename falls back to extension-based category', () => {
      const category = getIntelligentCategory('xyz123.pdf', '.pdf', smartFolders);
      // No keyword match, falls back to Documents
      expect(category).toBe('Documents');
    });

    test('random STL filename matches 3D Models via semantic extension mapping', () => {
      const category = getIntelligentCategory('x9m2k7.stl', '.stl', smartFolders);
      // With semantic extension mapping, .stl files match "3D Models" folder
      // because semantic keywords like "3d" and "model" are added from the extension
      expect(category).toBe('3D Models');
    });
  });

  describe('Keyword Scoring', () => {
    test('folder name match scores higher than keyword match', () => {
      // "financial" is both a folder name and appears in filename
      const category = getIntelligentCategory('financial_report.pdf', '.pdf', smartFolders);
      expect(category).toBe('Financial');
    });

    test('multiple keyword matches increase score', () => {
      // Multiple keywords should still match the right folder
      const category = getIntelligentCategory('invoice_receipt_tax.pdf', '.pdf', smartFolders);
      // All three are Financial keywords
      expect(category).toBe('Financial');
    });

    test('statement keyword matches financial pattern or Financial folder', () => {
      // "statement" is both in Financial folder keywords AND in financial pattern keywords
      // Pattern matching may return lowercase "financial" if it scores higher
      const category = getIntelligentCategory('annual_statement.pdf', '.pdf', smartFolders);
      expect(['Financial', 'financial']).toContain(category);
    });
  });
});

describe('Folder Suggestion - All Fixtures', () => {
  const smartFolders = getMockSmartFolders();

  describe.each(getAllFixtureKeys())('%s fixture', (fixtureKey) => {
    const fixture = TEST_FIXTURE_FILES[fixtureKey];

    test('returns a valid category', () => {
      const category = getIntelligentCategory(fixture.name, fixture.extension, smartFolders);
      expect(category).toBeDefined();
      expect(typeof category).toBe('string');
      expect(category.length).toBeGreaterThan(0);
    });

    test('category exists in smart folders or is valid fallback', () => {
      const category = getIntelligentCategory(fixture.name, fixture.extension, smartFolders);
      const folderNames = smartFolders.map((f) => f.name);
      const validCategories = [
        ...folderNames,
        'Documents',
        'Images',
        'Videos',
        'Music',
        'Archives',
        'Data',
        'Spreadsheets',
        'Presentations',
        // Pattern-based categories
        'financial',
        'legal',
        'project',
        'personal',
        'technical',
        'research',
        'marketing',
        'hr'
      ];

      expect(validCategories).toContain(category);
    });
  });
});

describe('Folder Suggestion - Edge Cases', () => {
  const smartFolders = getMockSmartFolders();

  describe('Empty and Null Inputs', () => {
    test('handles empty folder list', () => {
      const category = getIntelligentCategory('test.pdf', '.pdf', []);
      expect(category).toBeDefined();
      expect(category).toBe('Documents');
    });

    test('handles null folder list', () => {
      const category = getIntelligentCategory('test.pdf', '.pdf', null);
      expect(category).toBeDefined();
    });

    test('handles undefined folder list', () => {
      const category = getIntelligentCategory('test.pdf', '.pdf', undefined);
      expect(category).toBeDefined();
    });
  });

  describe('Invalid Folder Entries', () => {
    test('handles folders without names', () => {
      const foldersWithInvalid = [
        ...smartFolders,
        { id: 'bad1', path: '/test' }, // No name
        { id: 'bad2', name: '', path: '/test' }, // Empty name
        { id: 'bad3', name: null, path: '/test' } // Null name
      ];

      const category = getIntelligentCategory('financial_report.pdf', '.pdf', foldersWithInvalid);
      expect(category).toBe('Financial');
    });

    test('handles null folder entries', () => {
      const foldersWithNull = [...smartFolders, null, undefined];
      const category = getIntelligentCategory('test.pdf', '.pdf', foldersWithNull);
      expect(category).toBeDefined();
    });
  });

  describe('Case Sensitivity', () => {
    test('matches case-insensitively', () => {
      const category1 = getIntelligentCategory('FINANCIAL_REPORT.pdf', '.pdf', smartFolders);
      const category2 = getIntelligentCategory('financial_report.pdf', '.pdf', smartFolders);
      expect(category1).toBe(category2);
    });

    test('returns folder name with original case', () => {
      const category = getIntelligentCategory('financial_doc.pdf', '.pdf', smartFolders);
      // Should return "Financial" not "financial"
      expect(category).toBe('Financial');
    });
  });

  describe('Special Characters', () => {
    test('handles filenames with special characters', () => {
      const category = getIntelligentCategory('financial-report_v2 (1).pdf', '.pdf', smartFolders);
      expect(category).toBe('Financial');
    });

    test('handles filenames with numbers', () => {
      const category = getIntelligentCategory('invoice_12345.pdf', '.pdf', smartFolders);
      // "invoice" matches Financial folder keyword AND financial pattern
      // May return either capitalized folder name or lowercase pattern name
      expect(['Financial', 'financial']).toContain(category);
    });
  });
});

describe('Folder Suggestion - Confidence Scoring Simulation', () => {
  const smartFolders = getMockSmartFolders();

  test('high confidence for exact folder name match', () => {
    // When filename contains exact folder name, confidence should be high
    const category = getIntelligentCategory('financial_document.pdf', '.pdf', smartFolders);
    expect(category).toBe('Financial');
  });

  test('medium confidence for keyword match', () => {
    // When filename contains folder keywords AND pattern keywords
    // May return either capitalized folder name or lowercase pattern name
    const category = getIntelligentCategory('invoice_2024.pdf', '.pdf', smartFolders);
    expect(['Financial', 'financial']).toContain(category);
  });

  test('low confidence for extension-only match', () => {
    // When no keywords match, only extension-based
    const category = getIntelligentCategory('xyz123.pdf', '.pdf', smartFolders);
    expect(category).toBe('Documents');
  });
});

describe('Folder Suggestion - Analysis Integration', () => {
  test('mock analysis result includes category', () => {
    const fixture = TEST_FIXTURE_FILES.financialPdf;
    const analysis = createMockAnalysisResult(fixture);

    expect(analysis.category).toBe(fixture.expectedCategory);
  });

  test('mock analysis result for 3D file', () => {
    const fixture = TEST_FIXTURE_FILES.stlFile;
    const analysis = createMockAnalysisResult(fixture);

    expect(analysis.category).toBe(fixture.expectedCategory);
    expect(analysis.extractionMethod).toBe('extension_fallback');
  });
});
