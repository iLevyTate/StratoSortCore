/**
 * Integration Tests for Specialized File Types
 *
 * Tests file type processing for 3D models, design files, and other
 * specialized formats that use extension-based fallback categorization.
 *
 * Uses real test files from test/StratoSortOfTestFiles/
 */

const {
  TEST_FIXTURE_FILES,
  getFixturesByCategory,
  getExtensionFallbackFixtures,
  createTestFileObject,
  verifyFixturesExist,
  getMockSmartFolders
} = require('../utils/fileTypeFixtures');

const {
  getIntelligentCategory,
  getIntelligentKeywords,
  safeSuggestedName
} = require('../../src/main/analysis/fallbackUtils');

describe('Specialized File Types - Extension-based Processing', () => {
  let fixturesAvailable = false;

  beforeAll(async () => {
    const result = await verifyFixturesExist();
    fixturesAvailable = result.exists;
    if (!fixturesAvailable) {
      console.warn('Some fixture files are missing:', result.missing);
    }
  });

  describe('3D Model Files', () => {
    const fixtures3D = ['stlFile', 'objFile', 'threeMfFile'];

    describe.each(fixtures3D)('%s', (fixtureKey) => {
      const fixture = TEST_FIXTURE_FILES[fixtureKey];

      test('has correct extension mapping', () => {
        expect(fixture.extension).toBeDefined();
        expect(fixture.processingPath).toBe('extension_fallback');
      });

      test('generates category from extension', () => {
        const category = getIntelligentCategory(fixture.name, fixture.extension, []);
        expect(category).toBeDefined();
        expect(typeof category).toBe('string');
      });

      test('generates keywords including extension', () => {
        const keywords = getIntelligentKeywords(fixture.name, fixture.extension);
        expect(Array.isArray(keywords)).toBe(true);
        expect(keywords.length).toBeGreaterThan(0);
        expect(keywords).toContain(fixture.extension.replace('.', ''));
      });

      test('generates safe filename', () => {
        const safeName = safeSuggestedName(fixture.name, fixture.extension);
        expect(safeName).toBeDefined();
        expect(safeName.endsWith(fixture.extension)).toBe(true);
        expect(safeName).not.toContain('\\');
        expect(safeName).not.toContain('/');
        expect(safeName).not.toContain(':');
      });

      test('matches 3D Models folder when available', () => {
        const smartFolders = getMockSmartFolders();
        const category = getIntelligentCategory(fixture.name, fixture.extension, smartFolders);
        // Without keyword matches in filename, falls back to extension category
        expect(category).toBeDefined();
      });
    });

    test('all 3D fixtures use extension fallback', () => {
      for (const key of fixtures3D) {
        const fixture = TEST_FIXTURE_FILES[key];
        expect(fixture.supportsContentAnalysis).toBe(false);
        expect(fixture.processingPath).toBe('extension_fallback');
      }
    });
  });

  describe('Design Files (Vector Graphics)', () => {
    const designFixtures = ['epsFile', 'svgFile', 'aiFile', 'psdFile'];

    describe.each(designFixtures)('%s', (fixtureKey) => {
      const fixture = TEST_FIXTURE_FILES[fixtureKey];

      test('has correct extension mapping', () => {
        expect(fixture.extension).toBeDefined();
        expect(fixture.category).toBe('design');
      });

      test('generates category from extension', () => {
        const category = getIntelligentCategory(fixture.name, fixture.extension, []);
        expect(category).toBeDefined();
        // SVG maps to Images, others to Documents
        if (fixture.extension === '.svg') {
          expect(category).toBe('Images');
        } else {
          expect(category).toBe('Documents');
        }
      });

      test('generates keywords including extension', () => {
        const keywords = getIntelligentKeywords(fixture.name, fixture.extension);
        expect(Array.isArray(keywords)).toBe(true);
        expect(keywords.length).toBeGreaterThan(0);
        // Extension should be in keywords
        expect(keywords).toContain(fixture.extension.replace('.', ''));
      });

      test('generates safe filename', () => {
        const safeName = safeSuggestedName(fixture.name, fixture.extension);
        expect(safeName).toBeDefined();
        expect(safeName.endsWith(fixture.extension)).toBe(true);
      });
    });

    test('SVG files map to Images category', () => {
      const svgFixture = TEST_FIXTURE_FILES.svgFile;
      const category = getIntelligentCategory(svgFixture.name, svgFixture.extension, []);
      expect(category).toBe('Images');
    });
  });

  describe('3D Printing Files', () => {
    describe('gcodeFile', () => {
      const fixture = TEST_FIXTURE_FILES.gcodeFile;

      test('has correct extension mapping', () => {
        expect(fixture.extension).toBe('.gcode');
        expect(fixture.category).toBe('3d_printing');
      });

      test('generates category from extension or pattern', () => {
        const category = getIntelligentCategory(fixture.name, fixture.extension, []);
        expect(category).toBeDefined();
        // GCODE filename may match patterns, otherwise falls to Documents
        expect(['Documents', 'technical']).toContain(category);
      });

      test('generates keywords including gcode', () => {
        const keywords = getIntelligentKeywords(fixture.name, fixture.extension);
        expect(Array.isArray(keywords)).toBe(true);
        expect(keywords).toContain('gcode');
      });
    });
  });

  describe('3D Modeling Files', () => {
    describe('scadFile', () => {
      const fixture = TEST_FIXTURE_FILES.scadFile;

      test('has correct extension mapping', () => {
        expect(fixture.extension).toBe('.scad');
        expect(fixture.category).toBe('3d_modeling');
      });

      test('generates category from extension', () => {
        const category = getIntelligentCategory(fixture.name, fixture.extension, []);
        expect(category).toBeDefined();
      });

      test('generates keywords including scad', () => {
        const keywords = getIntelligentKeywords(fixture.name, fixture.extension);
        expect(Array.isArray(keywords)).toBe(true);
        expect(keywords).toContain('scad');
      });
    });
  });

  describe('Smart Folder Matching', () => {
    const smartFolders = getMockSmartFolders();

    test('matches Design folder for design files with matching keywords', () => {
      // Create a filename that should match Design folder
      const designFileName = 'my_design_graphic.eps';
      const category = getIntelligentCategory(designFileName, '.eps', smartFolders);
      // The filename contains "design" which matches the Design folder
      expect(category).toBe('Design');
    });

    test('matches 3D Models folder for 3D files with matching keywords', () => {
      // Create a filename that should match 3D Models folder
      const modelFileName = 'my_3d_model.stl';
      const category = getIntelligentCategory(modelFileName, '.stl', smartFolders);
      // The filename contains "3d" and "model" which should match
      expect(category).toBe('3D Models');
    });

    test('matches 3D folder via semantic extension mapping even without filename keywords', () => {
      // Filenames with no matching keywords in the name itself
      const randomFileName = 'x9m2k7.stl';
      const category = getIntelligentCategory(randomFileName, '.stl', smartFolders);
      // With semantic extension mapping, .stl files match "3D Models" folder
      // because the folder name contains "3d" and "model" which are semantic
      // concepts associated with .stl files
      expect(category).toBe('3D Models');
    });
  });

  describe('Safe Filename Generation', () => {
    test('handles special characters in filenames', () => {
      const unsafeName = 'file<>:"/\\|?*name.stl';
      const safeName = safeSuggestedName(unsafeName, '.stl');
      expect(safeName).not.toContain('<');
      expect(safeName).not.toContain('>');
      expect(safeName).not.toContain(':');
      expect(safeName).not.toContain('"');
      expect(safeName).not.toContain('/');
      expect(safeName).not.toContain('\\');
      expect(safeName).not.toContain('|');
      expect(safeName).not.toContain('?');
      expect(safeName).not.toContain('*');
      expect(safeName.endsWith('.stl')).toBe(true);
    });

    test('handles reserved Windows names', () => {
      const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT1'];
      for (const name of reservedNames) {
        const safeName = safeSuggestedName(`${name}.stl`, '.stl');
        // Should append _file to avoid reserved name
        expect(safeName).not.toBe(`${name}.stl`);
        expect(safeName.endsWith('.stl')).toBe(true);
      }
    });

    test('handles empty filenames', () => {
      const safeName = safeSuggestedName('.stl', '.stl');
      expect(safeName).toBeDefined();
      expect(safeName.length).toBeGreaterThan(4); // More than just ".stl"
      expect(safeName.endsWith('.stl')).toBe(true);
    });

    test('handles very long filenames', () => {
      const longName = 'a'.repeat(300) + '.stl';
      const safeName = safeSuggestedName(longName, '.stl');
      expect(safeName.length).toBeLessThanOrEqual(205); // 200 + extension
      expect(safeName.endsWith('.stl')).toBe(true);
    });

    test('handles filenames with spaces', () => {
      const spacedName = 'my file name with spaces.obj';
      const safeName = safeSuggestedName(spacedName, '.obj');
      expect(safeName).not.toContain(' ');
      expect(safeName).toContain('_');
      expect(safeName.endsWith('.obj')).toBe(true);
    });
  });

  describe('Extension Fallback Fixtures Collection', () => {
    test('getExtensionFallbackFixtures returns correct fixtures', () => {
      const fallbackFixtures = getExtensionFallbackFixtures();
      expect(Array.isArray(fallbackFixtures)).toBe(true);
      expect(fallbackFixtures.length).toBeGreaterThan(0);

      for (const fixture of fallbackFixtures) {
        expect(fixture.processingPath).toBe('extension_fallback');
        expect(fixture.supportsContentAnalysis).toBe(false);
      }
    });

    test('getFixturesByCategory returns correct 3d_models fixtures', () => {
      const fixtures = getFixturesByCategory('3d_models');
      expect(Array.isArray(fixtures)).toBe(true);
      expect(fixtures.length).toBe(3); // stl, obj, 3mf

      const extensions = fixtures.map((f) => f.extension);
      expect(extensions).toContain('.stl');
      expect(extensions).toContain('.obj');
      expect(extensions).toContain('.3mf');
    });

    test('getFixturesByCategory returns correct design fixtures', () => {
      const fixtures = getFixturesByCategory('design');
      expect(Array.isArray(fixtures)).toBe(true);
      expect(fixtures.length).toBe(4); // eps, svg, ai, psd

      const extensions = fixtures.map((f) => f.extension);
      expect(extensions).toContain('.eps');
      expect(extensions).toContain('.svg');
      expect(extensions).toContain('.ai');
      expect(extensions).toContain('.psd');
    });
  });

  describe('File Object Creation', () => {
    test('creates file object for stlFile', async () => {
      if (!fixturesAvailable) {
        console.warn('Skipping test: fixture files not available');
        return;
      }

      const fileObject = await createTestFileObject('stlFile');
      expect(fileObject).toBeDefined();
      expect(fileObject.name).toBe(TEST_FIXTURE_FILES.stlFile.name);
      expect(fileObject.extension).toBe('.stl');
      expect(typeof fileObject.size).toBe('number');
      expect(fileObject.mtime).toBeDefined();
    });

    test('throws error for unknown fixture key', async () => {
      await expect(createTestFileObject('unknownKey')).rejects.toThrow('Unknown fixture key');
    });
  });
});
