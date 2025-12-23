/**
 * Real File Loader Utility
 *
 * Provides helpers to load REAL fixture files from disk into memfs
 * for integration testing. This bypasses Jest's global fs mock to
 * read actual file content, then writes it to memfs so production
 * code (which uses the mocked fs) can access it.
 *
 * Usage:
 *   const { loadTextFixture, loadBinaryFixture, loadAllFixtures } = require('../../utils/realFileLoader');
 *
 *   beforeAll(() => {
 *     loadAllFixtures(['jsonFile', 'csvFile', 'pdfFile']);
 *   });
 *
 *   beforeEach(() => {
 *     // Re-load after vol.reset() clears memfs
 *     loadAllFixtures(['jsonFile', 'csvFile', 'pdfFile']);
 *   });
 *
 * @module test/utils/realFileLoader
 */

const path = require('path');
const realFs = jest.requireActual('fs'); // REAL filesystem, bypasses jest.mock
const { vol } = require('memfs'); // For pre-populating test filesystem

const { TEST_FIXTURE_FILES } = require('./fileTypeFixtures');

/**
 * Load a text file from disk into memfs
 * @param {string} fixturePath - Path to the fixture file
 * @returns {string|null} - File content as string, or null on error
 */
function loadTextFixture(fixturePath) {
  try {
    const content = realFs.readFileSync(fixturePath, 'utf8');
    const normalizedPath = fixturePath.replace(/\\/g, '/');
    const dir = path.dirname(normalizedPath).replace(/\\/g, '/');
    vol.mkdirSync(dir, { recursive: true });
    vol.writeFileSync(normalizedPath, content);
    return content;
  } catch (err) {
    console.error(`Failed to load text fixture: ${fixturePath}`, err.message);
    return null;
  }
}

/**
 * Load a binary file from disk into memfs
 * @param {string} fixturePath - Path to the fixture file
 * @returns {Buffer|null} - File content as Buffer, or null on error
 */
function loadBinaryFixture(fixturePath) {
  try {
    const content = realFs.readFileSync(fixturePath); // No encoding = binary
    const normalizedPath = fixturePath.replace(/\\/g, '/');
    const dir = path.dirname(normalizedPath).replace(/\\/g, '/');
    vol.mkdirSync(dir, { recursive: true });
    vol.writeFileSync(normalizedPath, content);
    return content;
  } catch (err) {
    console.error(`Failed to load binary fixture: ${fixturePath}`, err.message);
    return null;
  }
}

/**
 * Load a fixture by its key from TEST_FIXTURE_FILES
 * Automatically determines text vs binary based on file type
 * @param {string} fixtureKey - Key from TEST_FIXTURE_FILES (e.g., 'jsonFile', 'pdfFile')
 * @returns {string|Buffer|null} - File content, or null on error
 */
function loadFixtureByKey(fixtureKey) {
  const fixture = TEST_FIXTURE_FILES[fixtureKey];
  if (!fixture) {
    console.error(`Unknown fixture key: ${fixtureKey}`);
    return null;
  }

  // Binary file extensions
  const binaryExtensions = [
    '.pdf',
    '.docx',
    '.xlsx',
    '.pptx',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.bmp',
    '.webp',
    '.tiff',
    '.zip',
    '.rar',
    '.7z',
    '.tar',
    '.gz',
    '.mp3',
    '.wav',
    '.mp4',
    '.avi',
    '.exe',
    '.dll',
    '.so'
  ];

  const isBinary = binaryExtensions.includes(fixture.extension.toLowerCase());
  return isBinary ? loadBinaryFixture(fixture.path) : loadTextFixture(fixture.path);
}

/**
 * Load multiple fixtures by their keys
 * @param {string[]} fixtureKeys - Array of fixture keys
 * @returns {Object} - Map of fixtureKey -> content
 */
function loadAllFixtures(fixtureKeys) {
  const results = {};
  for (const key of fixtureKeys) {
    results[key] = loadFixtureByKey(key);
  }
  return results;
}

/**
 * Load fixtures by category
 * @param {string} category - Category like 'documents', 'images', 'data', 'code', 'archives'
 * @returns {Object} - Map of fixtureKey -> content
 */
function loadFixturesByCategory(category) {
  const categoryMap = {
    documents: [
      'sampleTxt',
      'markdownFile',
      'htmlFile',
      'rtfFile',
      'financialPdf',
      'docxFile',
      'emlFile'
    ],
    images: [
      'simplePng',
      'jpgFile',
      'gifFile',
      'bmpFile',
      'webpFile',
      'tiffFile',
      'financialImage'
    ],
    data: ['jsonFile', 'csvFile', 'xmlFile', 'yamlFile'],
    code: ['jsFile', 'pythonFile', 'cssFile', 'sqlFile'],
    office: ['xlsxFile', 'pptxFile', 'docxFile'],
    archives: ['zipFile'],
    config: ['yamlFile', 'iniFile', 'logFile']
  };

  const keys = categoryMap[category] || [];
  return loadAllFixtures(keys);
}

/**
 * Get the real content of a fixture file without loading into memfs
 * Useful for assertions
 * @param {string} fixtureKey - Key from TEST_FIXTURE_FILES
 * @returns {string|Buffer|null} - File content
 */
function getRealFixtureContent(fixtureKey) {
  const fixture = TEST_FIXTURE_FILES[fixtureKey];
  if (!fixture) {
    return null;
  }

  const binaryExtensions = [
    '.pdf',
    '.docx',
    '.xlsx',
    '.pptx',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.bmp',
    '.webp',
    '.tiff',
    '.zip'
  ];

  try {
    const isBinary = binaryExtensions.includes(fixture.extension.toLowerCase());
    return isBinary ? realFs.readFileSync(fixture.path) : realFs.readFileSync(fixture.path, 'utf8');
  } catch (err) {
    console.error(`Failed to read fixture: ${fixtureKey}`, err.message);
    return null;
  }
}

/**
 * Check if a fixture file exists on the real filesystem
 * @param {string} fixtureKey - Key from TEST_FIXTURE_FILES
 * @returns {boolean}
 */
function fixtureExists(fixtureKey) {
  const fixture = TEST_FIXTURE_FILES[fixtureKey];
  if (!fixture) {
    return false;
  }
  return realFs.existsSync(fixture.path);
}

/**
 * Get fixture metadata
 * @param {string} fixtureKey - Key from TEST_FIXTURE_FILES
 * @returns {Object|null} - Fixture definition or null
 */
function getFixtureInfo(fixtureKey) {
  return TEST_FIXTURE_FILES[fixtureKey] || null;
}

module.exports = {
  loadTextFixture,
  loadBinaryFixture,
  loadFixtureByKey,
  loadAllFixtures,
  loadFixturesByCategory,
  getRealFixtureContent,
  fixtureExists,
  getFixtureInfo
};
