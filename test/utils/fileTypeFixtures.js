/**
 * File Type Test Fixtures
 *
 * Reusable utilities for testing file type processing.
 * Uses real test files from test/test-files/ directory.
 *
 * @module test/utils/fileTypeFixtures
 */

const path = require('path');
const fs = require('fs').promises;

// Path to test fixture files
const FIXTURE_DIR = path.resolve(__dirname, '../test-files');

/**
 * Test fixture file definitions with expected outcomes
 */
const TEST_FIXTURE_FILES = {
  // ==========================================================================
  // DOCUMENTS - PDF
  // ==========================================================================
  financialPdf: {
    name: 'Annual_Financial_Statement_2024.pdf',
    path: path.join(FIXTURE_DIR, 'Annual_Financial_Statement_2024.pdf'),
    extension: '.pdf',
    category: 'documents',
    expectedCategory: 'financial',
    expectedKeywords: ['financial', 'statement', 'annual'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'PDF document with financial content'
  },

  // ==========================================================================
  // TEXT FILES
  // ==========================================================================
  sampleTxt: {
    name: 'sample_document.txt',
    path: path.join(FIXTURE_DIR, 'sample_document.txt'),
    extension: '.txt',
    category: 'text',
    expectedCategory: 'Documents',
    expectedKeywords: ['document', 'file', 'text', 'txt'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'Plain text document'
  },
  markdownFile: {
    name: 'project_readme.md',
    path: path.join(FIXTURE_DIR, 'project_readme.md'),
    extension: '.md',
    category: 'text',
    expectedCategory: 'Documents',
    expectedKeywords: ['document', 'file', 'text', 'md'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'Markdown documentation file'
  },
  jsonFile: {
    name: 'config_data.json',
    path: path.join(FIXTURE_DIR, 'config_data.json'),
    extension: '.json',
    category: 'data',
    expectedCategory: 'Data',
    expectedKeywords: ['data', 'information', 'records', 'json'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'JSON configuration file'
  },
  csvFile: {
    name: 'sales_data.csv',
    path: path.join(FIXTURE_DIR, 'sales_data.csv'),
    extension: '.csv',
    category: 'data',
    expectedCategory: 'Data',
    expectedKeywords: ['data', 'information', 'records', 'csv'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'CSV data file with sales records'
  },
  xmlFile: {
    name: 'data_export.xml',
    path: path.join(FIXTURE_DIR, 'data_export.xml'),
    extension: '.xml',
    category: 'data',
    expectedCategory: 'Data',
    expectedKeywords: ['data', 'information', 'records', 'xml'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'XML data export file'
  },
  htmlFile: {
    name: 'webpage_template.html',
    path: path.join(FIXTURE_DIR, 'webpage_template.html'),
    extension: '.html',
    category: 'web',
    expectedCategory: 'Documents',
    expectedKeywords: ['document', 'file', 'text', 'html'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'HTML webpage template'
  },
  rtfFile: {
    name: 'rich_text_doc.rtf',
    path: path.join(FIXTURE_DIR, 'rich_text_doc.rtf'),
    extension: '.rtf',
    category: 'text',
    expectedCategory: 'Documents',
    expectedKeywords: ['document', 'file', 'text', 'rtf'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'Rich text format document'
  },

  // ==========================================================================
  // CODE FILES
  // ==========================================================================
  jsFile: {
    name: 'utility_module.js',
    path: path.join(FIXTURE_DIR, 'utility_module.js'),
    extension: '.js',
    category: 'code',
    expectedCategory: 'Documents',
    expectedKeywords: ['document', 'file', 'text', 'js'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'JavaScript module file'
  },
  pythonFile: {
    name: 'data_processor.py',
    path: path.join(FIXTURE_DIR, 'data_processor.py'),
    extension: '.py',
    category: 'code',
    expectedCategory: 'Documents',
    expectedKeywords: ['document', 'file', 'text', 'py'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'Python script file'
  },
  cssFile: {
    name: 'styles_theme.css',
    path: path.join(FIXTURE_DIR, 'styles_theme.css'),
    extension: '.css',
    category: 'code',
    expectedCategory: 'Documents',
    expectedKeywords: ['document', 'file', 'text', 'css'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'CSS stylesheet file'
  },
  sqlFile: {
    name: 'database_queries.sql',
    path: path.join(FIXTURE_DIR, 'database_queries.sql'),
    extension: '.sql',
    category: 'code',
    expectedCategory: 'Documents',
    expectedKeywords: ['document', 'file', 'text', 'sql'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'SQL database queries file'
  },

  // ==========================================================================
  // CONFIG FILES
  // ==========================================================================
  yamlFile: {
    name: 'app_config.yaml',
    path: path.join(FIXTURE_DIR, 'app_config.yaml'),
    extension: '.yaml',
    category: 'config',
    expectedCategory: 'Documents',
    expectedKeywords: ['document', 'file', 'text', 'yaml'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'YAML configuration file'
  },
  iniFile: {
    name: 'settings.ini',
    path: path.join(FIXTURE_DIR, 'settings.ini'),
    extension: '.ini',
    category: 'config',
    expectedCategory: 'Documents',
    expectedKeywords: ['document', 'file', 'text', 'ini'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'INI settings file'
  },
  logFile: {
    name: 'application.log',
    path: path.join(FIXTURE_DIR, 'application.log'),
    extension: '.log',
    category: 'logs',
    expectedCategory: 'Documents',
    expectedKeywords: ['document', 'file', 'text', 'log'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'Application log file'
  },

  // ==========================================================================
  // OFFICE DOCUMENTS
  // ==========================================================================
  docxFile: {
    name: 'quarterly_report.docx',
    path: path.join(FIXTURE_DIR, 'quarterly_report.docx'),
    extension: '.docx',
    category: 'office',
    expectedCategory: 'Documents',
    expectedKeywords: ['document', 'report', 'text', 'docx'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'Word document with quarterly report'
  },
  xlsxFile: {
    name: 'budget_spreadsheet.xlsx',
    path: path.join(FIXTURE_DIR, 'budget_spreadsheet.xlsx'),
    extension: '.xlsx',
    category: 'office',
    expectedCategory: 'Spreadsheets',
    expectedKeywords: ['spreadsheet', 'data', 'table', 'xlsx'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'Excel spreadsheet with budget data'
  },
  pptxFile: {
    name: 'sales_presentation.pptx',
    path: path.join(FIXTURE_DIR, 'sales_presentation.pptx'),
    extension: '.pptx',
    category: 'office',
    expectedCategory: 'Presentations',
    expectedKeywords: ['presentation', 'slides', 'deck', 'pptx'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'PowerPoint sales presentation'
  },

  // ==========================================================================
  // EMAIL FILES
  // ==========================================================================
  emlFile: {
    name: 'meeting_invite.eml',
    path: path.join(FIXTURE_DIR, 'meeting_invite.eml'),
    extension: '.eml',
    category: 'email',
    expectedCategory: 'Documents',
    expectedKeywords: ['document', 'file', 'text', 'eml'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'Email meeting invitation'
  },

  // ==========================================================================
  // GEOSPATIAL FILES
  // ==========================================================================
  kmlFile: {
    name: 'location_data.kml',
    path: path.join(FIXTURE_DIR, 'location_data.kml'),
    extension: '.kml',
    category: 'geospatial',
    expectedCategory: 'Documents',
    expectedKeywords: ['document', 'file', 'text', 'kml'],
    processingPath: 'document_extraction',
    supportsContentAnalysis: true,
    description: 'KML geospatial location file'
  },

  // ==========================================================================
  // IMAGES - Standard formats
  // ==========================================================================
  financialImage: {
    name: '20250911_1017_Imposter Financial Document_simple_compose_01k4wj305neqr9pjgx4m1b9mdr.png',
    path: path.join(
      FIXTURE_DIR,
      '20250911_1017_Imposter Financial Document_simple_compose_01k4wj305neqr9pjgx4m1b9mdr.png'
    ),
    extension: '.png',
    category: 'images',
    expectedCategory: 'Images',
    expectedKeywords: ['image', 'visual', 'graphic'],
    processingPath: 'image_analysis',
    supportsContentAnalysis: true,
    description: 'PNG image with financial document appearance'
  },
  simplePng: {
    name: 't2v7h5.png',
    path: path.join(FIXTURE_DIR, 't2v7h5.png'),
    extension: '.png',
    category: 'images',
    expectedCategory: 'Images',
    expectedKeywords: ['image', 'visual', 'graphic', 'png'],
    processingPath: 'image_analysis',
    supportsContentAnalysis: true,
    description: 'Simple PNG image'
  },
  jpgFile: {
    name: 'sample_photo.jpg',
    path: path.join(FIXTURE_DIR, 'sample_photo.jpg'),
    extension: '.jpg',
    category: 'images',
    expectedCategory: 'Images',
    expectedKeywords: ['image', 'visual', 'graphic', 'jpg'],
    processingPath: 'image_analysis',
    supportsContentAnalysis: true,
    description: 'JPEG photograph'
  },
  gifFile: {
    name: 'animated_icon.gif',
    path: path.join(FIXTURE_DIR, 'animated_icon.gif'),
    extension: '.gif',
    category: 'images',
    expectedCategory: 'Images',
    expectedKeywords: ['image', 'visual', 'graphic', 'gif'],
    processingPath: 'image_analysis',
    supportsContentAnalysis: true,
    description: 'GIF animated image'
  },
  bmpFile: {
    name: 'legacy_image.bmp',
    path: path.join(FIXTURE_DIR, 'legacy_image.bmp'),
    extension: '.bmp',
    category: 'images',
    expectedCategory: 'Images',
    expectedKeywords: ['image', 'visual', 'graphic', 'bmp'],
    processingPath: 'image_analysis',
    supportsContentAnalysis: true,
    description: 'BMP bitmap image'
  },
  webpFile: {
    name: 'web_graphic.webp',
    path: path.join(FIXTURE_DIR, 'web_graphic.webp'),
    extension: '.webp',
    category: 'images',
    expectedCategory: 'Images',
    expectedKeywords: ['image', 'visual', 'graphic', 'webp'],
    processingPath: 'image_analysis',
    supportsContentAnalysis: true,
    description: 'WebP web image'
  },
  tiffFile: {
    name: 'scan_document.tiff',
    path: path.join(FIXTURE_DIR, 'scan_document.tiff'),
    extension: '.tiff',
    category: 'images',
    expectedCategory: 'Images',
    expectedKeywords: ['image', 'visual', 'graphic', 'tiff'],
    processingPath: 'image_analysis',
    supportsContentAnalysis: true,
    description: 'TIFF scanned document'
  },

  // ==========================================================================
  // DESIGN FILES - Vector
  // ==========================================================================
  epsFile: {
    name: 'd4s1k7.eps',
    path: path.join(FIXTURE_DIR, 'd4s1k7.eps'),
    extension: '.eps',
    category: 'design',
    expectedCategory: 'Documents',
    expectedKeywords: ['file', 'document', 'eps'],
    processingPath: 'extension_fallback',
    supportsContentAnalysis: false,
    description: 'Encapsulated PostScript vector graphic'
  },
  svgFile: {
    name: 'j7k2m9.svg',
    path: path.join(FIXTURE_DIR, 'j7k2m9.svg'),
    extension: '.svg',
    category: 'design',
    expectedCategory: 'Images',
    expectedKeywords: ['image', 'visual', 'graphic', 'svg'],
    processingPath: 'extension_fallback',
    supportsContentAnalysis: false,
    description: 'Scalable Vector Graphics file'
  },
  aiFile: {
    name: 'p8n4w3.ai',
    path: path.join(FIXTURE_DIR, 'p8n4w3.ai'),
    extension: '.ai',
    category: 'design',
    expectedCategory: 'Documents',
    expectedKeywords: ['file', 'document', 'ai'],
    processingPath: 'extension_fallback',
    supportsContentAnalysis: false,
    description: 'Adobe Illustrator file'
  },
  psdFile: {
    name: 'm6q9r8.psd',
    path: path.join(FIXTURE_DIR, 'm6q9r8.psd'),
    extension: '.psd',
    category: 'design',
    expectedCategory: 'Documents',
    expectedKeywords: ['file', 'document', 'psd'],
    processingPath: 'extension_fallback',
    supportsContentAnalysis: false,
    description: 'Adobe Photoshop file'
  },

  // ==========================================================================
  // 3D FILES - Printing
  // ==========================================================================
  stlFile: {
    name: 'x9m2k7.stl',
    path: path.join(FIXTURE_DIR, 'x9m2k7.stl'),
    extension: '.stl',
    category: '3d_models',
    expectedCategory: 'Documents',
    expectedKeywords: ['file', 'document', 'stl'],
    processingPath: 'extension_fallback',
    supportsContentAnalysis: false,
    description: 'STL 3D model file for printing'
  },
  objFile: {
    name: 'v7n4q2.obj',
    path: path.join(FIXTURE_DIR, 'v7n4q2.obj'),
    extension: '.obj',
    category: '3d_models',
    expectedCategory: 'Documents',
    expectedKeywords: ['file', 'document', 'obj'],
    processingPath: 'extension_fallback',
    supportsContentAnalysis: false,
    description: 'Wavefront OBJ 3D model file'
  },
  threeMfFile: {
    name: 'r5b9j3.3mf',
    path: path.join(FIXTURE_DIR, 'r5b9j3.3mf'),
    extension: '.3mf',
    category: '3d_models',
    expectedCategory: 'Documents',
    expectedKeywords: ['file', 'document', '3mf'],
    processingPath: 'extension_fallback',
    supportsContentAnalysis: false,
    description: '3D Manufacturing Format file'
  },
  gcodeFile: {
    name: 'h3p8w5.gcode',
    path: path.join(FIXTURE_DIR, 'h3p8w5.gcode'),
    extension: '.gcode',
    category: '3d_printing',
    expectedCategory: 'Documents',
    expectedKeywords: ['file', 'document', 'gcode'],
    processingPath: 'extension_fallback',
    supportsContentAnalysis: false,
    description: 'G-code file for 3D printing/CNC'
  },

  // ==========================================================================
  // 3D FILES - Modeling
  // ==========================================================================
  scadFile: {
    name: 'k6t8m1.scad',
    path: path.join(FIXTURE_DIR, 'k6t8m1.scad'),
    extension: '.scad',
    category: '3d_modeling',
    expectedCategory: 'Documents',
    expectedKeywords: ['file', 'document', 'scad'],
    processingPath: 'extension_fallback',
    supportsContentAnalysis: false,
    description: 'OpenSCAD parametric modeling file'
  },

  // ==========================================================================
  // ARCHIVES
  // ==========================================================================
  zipFile: {
    name: 'project_backup.zip',
    path: path.join(FIXTURE_DIR, 'project_backup.zip'),
    extension: '.zip',
    category: 'archives',
    expectedCategory: 'Archives',
    expectedKeywords: ['archive', 'compressed', 'backup', 'zip'],
    processingPath: 'archive_extraction',
    supportsContentAnalysis: true,
    description: 'ZIP archive with project backup'
  }
};

/**
 * Categories for grouping test fixtures
 */
const FIXTURE_CATEGORIES = {
  documents: ['financialPdf'],
  text: ['sampleTxt', 'markdownFile', 'rtfFile'],
  data: ['jsonFile', 'csvFile', 'xmlFile'],
  web: ['htmlFile'],
  code: ['jsFile', 'pythonFile', 'cssFile', 'sqlFile'],
  config: ['yamlFile', 'iniFile', 'logFile'],
  office: ['docxFile', 'xlsxFile', 'pptxFile'],
  email: ['emlFile'],
  geospatial: ['kmlFile'],
  images: ['financialImage', 'simplePng', 'jpgFile', 'gifFile', 'bmpFile', 'webpFile', 'tiffFile'],
  design: ['epsFile', 'svgFile', 'aiFile', 'psdFile'],
  '3d_models': ['stlFile', 'objFile', 'threeMfFile'],
  '3d_printing': ['gcodeFile'],
  '3d_modeling': ['scadFile'],
  archives: ['zipFile']
};

/**
 * Get all available fixture keys
 * @returns {string[]} Array of fixture keys
 */
function getAllFixtureKeys() {
  return Object.keys(TEST_FIXTURE_FILES);
}

/**
 * Get fixture by key
 * @param {string} key - Fixture key
 * @returns {Object|null} Fixture data or null if not found
 */
function getFixtureFile(key) {
  return TEST_FIXTURE_FILES[key] || null;
}

/**
 * Get all fixtures in a category
 * @param {string} category - Category name
 * @returns {Object[]} Array of fixture objects
 */
function getFixturesByCategory(category) {
  const keys = FIXTURE_CATEGORIES[category] || [];
  return keys.map((key) => TEST_FIXTURE_FILES[key]).filter(Boolean);
}

/**
 * Get fixtures that support content analysis
 * @returns {Object[]} Array of fixture objects with content analysis support
 */
function getContentAnalysisFixtures() {
  return Object.values(TEST_FIXTURE_FILES).filter((f) => f.supportsContentAnalysis);
}

/**
 * Get fixtures that use extension-based fallback
 * @returns {Object[]} Array of fixture objects using fallback
 */
function getExtensionFallbackFixtures() {
  return Object.values(TEST_FIXTURE_FILES).filter((f) => f.processingPath === 'extension_fallback');
}

/**
 * Get fixtures by processing path
 * @param {string} processingPath - Processing path type
 * @returns {Object[]} Array of fixture objects
 */
function getFixturesByProcessingPath(processingPath) {
  return Object.values(TEST_FIXTURE_FILES).filter((f) => f.processingPath === processingPath);
}

/**
 * Create a test file object suitable for processing functions
 * @param {string} fixtureKey - Key of the fixture to use
 * @returns {Promise<Object>} File object with path, name, extension, size, mtime
 */
async function createTestFileObject(fixtureKey) {
  const fixture = TEST_FIXTURE_FILES[fixtureKey];
  if (!fixture) {
    throw new Error(`Unknown fixture key: ${fixtureKey}`);
  }

  try {
    const stats = await fs.stat(fixture.path);
    return {
      name: fixture.name,
      path: fixture.path,
      extension: fixture.extension,
      size: stats.size,
      mtime: stats.mtime,
      fixture // Include fixture metadata for reference
    };
  } catch (error) {
    throw new Error(`Failed to read fixture file ${fixture.name}: ${error.message}`);
  }
}

/**
 * Create multiple test file objects
 * @param {string[]} fixtureKeys - Array of fixture keys
 * @returns {Promise<Object[]>} Array of file objects
 */
async function createTestFileObjects(fixtureKeys) {
  return Promise.all(fixtureKeys.map((key) => createTestFileObject(key)));
}

/**
 * Check if all fixture files exist
 * @returns {Promise<Object>} Object with exists flag and missing files
 */
async function verifyFixturesExist() {
  const results = { exists: true, missing: [], found: [] };

  for (const [key, fixture] of Object.entries(TEST_FIXTURE_FILES)) {
    try {
      await fs.access(fixture.path);
      results.found.push(key);
    } catch {
      results.exists = false;
      results.missing.push({ key, path: fixture.path });
    }
  }

  return results;
}

/**
 * Get mock smart folders for testing folder matching
 * @returns {Object[]} Array of smart folder configurations
 */
function getMockSmartFolders() {
  return [
    {
      id: 'folder-1',
      name: 'Financial',
      path: '/test/folders/Financial',
      description: 'Financial documents including invoices, receipts, statements, and tax records',
      keywords: ['invoice', 'receipt', 'tax', 'statement', 'budget'],
      semanticTags: ['money', 'accounting', 'business']
    },
    {
      id: 'folder-2',
      name: 'Design',
      path: '/test/folders/Design',
      description: 'Design files including graphics, vectors, and creative assets',
      keywords: ['design', 'graphic', 'vector', 'creative', 'art'],
      semanticTags: ['visual', 'illustration', 'artwork']
    },
    {
      id: 'folder-3',
      name: '3D Models',
      path: '/test/folders/3D Models',
      description: '3D model files for printing, rendering, and CAD work',
      keywords: ['3d', 'model', 'print', 'cad', 'mesh'],
      semanticTags: ['printing', 'manufacturing', 'modeling']
    },
    {
      id: 'folder-4',
      name: 'Images',
      path: '/test/folders/Images',
      description: 'Photos, screenshots, and other image files',
      keywords: ['photo', 'image', 'picture', 'screenshot', 'visual'],
      semanticTags: ['photography', 'visual', 'graphic']
    },
    {
      id: 'folder-5',
      name: 'Documents',
      path: '/test/folders/Documents',
      description: 'General documents, reports, and text files',
      keywords: ['document', 'report', 'text', 'file', 'paper'],
      semanticTags: ['text', 'office', 'work']
    },
    {
      id: 'folder-6',
      name: 'Code',
      path: '/test/folders/Code',
      description: 'Source code, scripts, and programming files',
      keywords: ['code', 'script', 'programming', 'source', 'development'],
      semanticTags: ['programming', 'development', 'software']
    },
    {
      id: 'folder-7',
      name: 'Data',
      path: '/test/folders/Data',
      description: 'Data files, exports, and datasets',
      keywords: ['data', 'export', 'dataset', 'csv', 'json'],
      semanticTags: ['data', 'analytics', 'records']
    },
    {
      id: 'folder-8',
      name: 'Archives',
      path: '/test/folders/Archives',
      description: 'Compressed files and backups',
      keywords: ['archive', 'backup', 'compressed', 'zip', 'package'],
      semanticTags: ['backup', 'storage', 'compressed']
    }
  ];
}

/**
 * Create a mock analysis result for testing
 * @param {Object} fixture - Fixture object
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock analysis result
 */
function createMockAnalysisResult(fixture, overrides = {}) {
  return {
    purpose: `${fixture.description}`,
    project: fixture.name.replace(fixture.extension, ''),
    category: fixture.expectedCategory,
    date: new Date().toISOString().split('T')[0],
    keywords: fixture.expectedKeywords || [],
    confidence: 85,
    suggestedName: fixture.name,
    extractionMethod: fixture.processingPath,
    ...overrides
  };
}

/**
 * Create mock Llama response for document analysis
 * @param {Object} fixture - Fixture object
 * @returns {Object} Mock Llama response
 */
function createMockLlamaDocumentResponse(fixture) {
  return {
    response: JSON.stringify({
      purpose: fixture.description,
      project: fixture.name.replace(fixture.extension, ''),
      category: fixture.expectedCategory,
      date: new Date().toISOString().split('T')[0],
      keywords: fixture.expectedKeywords,
      confidence: 85,
      suggestedName: fixture.name.replace(fixture.extension, '')
    })
  };
}

/**
 * Create mock Llama response for image analysis
 * @param {Object} fixture - Fixture object
 * @returns {Object} Mock Llama response
 */
function createMockLlamaImageResponse(fixture) {
  return {
    response: JSON.stringify({
      purpose: fixture.description,
      project: fixture.name.replace(fixture.extension, ''),
      category: fixture.expectedCategory,
      date: new Date().toISOString().split('T')[0],
      keywords: fixture.expectedKeywords,
      confidence: 80,
      content_type: 'image',
      has_text: false,
      colors: ['gray', 'white'],
      suggestedName: fixture.name.replace(fixture.extension, '')
    })
  };
}

/**
 * Get statistics about available fixtures
 * @returns {Object} Stats about fixtures
 */
function getFixtureStats() {
  const all = Object.values(TEST_FIXTURE_FILES);
  return {
    total: all.length,
    byCategory: Object.fromEntries(
      Object.entries(FIXTURE_CATEGORIES).map(([cat, keys]) => [cat, keys.length])
    ),
    supportsContentAnalysis: all.filter((f) => f.supportsContentAnalysis).length,
    extensionFallback: all.filter((f) => f.processingPath === 'extension_fallback').length,
    documentExtraction: all.filter((f) => f.processingPath === 'document_extraction').length,
    imageAnalysis: all.filter((f) => f.processingPath === 'image_analysis').length
  };
}

// ==========================================================================
// PIPELINE TESTING HELPERS
// ==========================================================================

const EMBEDDING_DIMENSION = 1024;

/**
 * Create a mock embedding vector for testing
 * @param {number} dimension - Vector dimension (default 1024)
 * @param {number} seed - Seed value for elements
 * @returns {number[]} Mock embedding vector
 */
function createMockEmbeddingVector(dimension = EMBEDDING_DIMENSION, seed = 0.1) {
  return new Array(dimension).fill(seed);
}

/**
 * Create mock folder match result for a fixture
 * @param {Object} fixture - Fixture definition
 * @param {number} score - Match score (0-1)
 * @returns {Object} Mock folder match
 */
function createMockFolderMatch(fixture, score = 0.85) {
  const category = fixture.expectedCategory || 'Documents';
  return {
    name: category,
    path: `/test/folders/${category}`,
    score,
    id: `folder:${category.toLowerCase().replace(/\s+/g, '-')}`
  };
}

/**
 * Create complete pipeline result mock for a fixture
 * @param {Object} fixture - Fixture definition
 * @returns {Object} Complete pipeline result
 */
function createMockPipelineResult(fixture) {
  return {
    analysis: createMockAnalysisResult(fixture),
    embedding: {
      vector: createMockEmbeddingVector(),
      model: 'mxbai-embed-large',
      id: `file:${fixture.path}`
    },
    folderMatches: [
      createMockFolderMatch(fixture, 0.85),
      { name: 'Documents', path: '/test/folders/Documents', score: 0.65, id: 'folder:documents' }
    ],
    queueStatus: {
      success: true,
      queueLength: 0,
      id: `file:${fixture.path}`
    }
  };
}

/**
 * Create mock extracted content for document fixtures
 * @param {Object} fixture - Fixture definition
 * @returns {string} Mock extracted text content
 */
function createMockExtractedContent(fixture) {
  const baseContent = `This is sample extracted content from ${fixture.name}.`;

  const contentByCategory = {
    documents: `${baseContent} This document contains important information about ${fixture.expectedCategory || 'general topics'}.`,
    text: `${baseContent} Plain text content with various details and notes.`,
    data: `${baseContent} Data file containing structured information for analysis.`,
    code: `${baseContent} Source code file with programming logic and functions.`,
    config: `${baseContent} Configuration settings and application parameters.`,
    office: `${baseContent} Office document with formatted content and data tables.`,
    email: `${baseContent} Email message with correspondence details.`,
    geospatial: `${baseContent} Geographic data with location coordinates.`
  };

  return contentByCategory[fixture.category] || baseContent;
}

/**
 * Get fixtures grouped by processing path
 * @returns {Object} Fixtures grouped by processing path
 */
function getFixturesGroupedByProcessingPath() {
  const all = Object.values(TEST_FIXTURE_FILES);

  return {
    document_extraction: all.filter((f) => f.processingPath === 'document_extraction'),
    image_analysis: all.filter((f) => f.processingPath === 'image_analysis'),
    extension_fallback: all.filter((f) => f.processingPath === 'extension_fallback'),
    archive_extraction: all.filter((f) => f.processingPath === 'archive_extraction')
  };
}

/**
 * Get fixtures that support the full AI pipeline
 * @returns {Object[]} Fixtures that use Llama for analysis
 */
function getLlamaPipelineFixtures() {
  return Object.values(TEST_FIXTURE_FILES).filter(
    (f) => f.processingPath === 'document_extraction' || f.processingPath === 'image_analysis'
  );
}

/**
 * Create expected pipeline call order for a fixture
 * @param {Object} fixture - Fixture definition
 * @returns {string[]} Expected call order
 */
function getExpectedPipelineOrder(fixture) {
  if (fixture.processingPath === 'image_analysis') {
    return ['preprocessImage', 'analyzeImage', 'embedText', 'matchVectorToFolders', 'enqueue'];
  }

  if (fixture.processingPath === 'document_extraction') {
    return ['extractText', 'analyzeText', 'embedText', 'matchVectorToFolders', 'enqueue'];
  }

  // Extension fallback - no AI analysis
  return ['getIntelligentCategory', 'getIntelligentKeywords'];
}

module.exports = {
  // Constants
  FIXTURE_DIR,
  TEST_FIXTURE_FILES,
  FIXTURE_CATEGORIES,
  EMBEDDING_DIMENSION,

  // Getters
  getAllFixtureKeys,
  getFixtureFile,
  getFixturesByCategory,
  getContentAnalysisFixtures,
  getExtensionFallbackFixtures,
  getFixturesByProcessingPath,
  getFixtureStats,
  getFixturesGroupedByProcessingPath,
  getLlamaPipelineFixtures,
  getExpectedPipelineOrder,

  // File object creation
  createTestFileObject,
  createTestFileObjects,
  verifyFixturesExist,

  // Mock data
  getMockSmartFolders,
  createMockAnalysisResult,
  createMockLlamaDocumentResponse,
  createMockLlamaImageResponse,

  // Pipeline testing helpers
  createMockEmbeddingVector,
  createMockFolderMatch,
  createMockPipelineResult,
  createMockExtractedContent
};
