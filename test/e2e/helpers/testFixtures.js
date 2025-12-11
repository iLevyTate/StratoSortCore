/**
 * Test Fixtures for E2E Testing
 *
 * Provides common test data, mock files, and fixtures for E2E tests.
 * These fixtures help create consistent and reproducible test scenarios.
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// Test data directory (using existing test files)
const TEST_FILES_DIR = path.resolve(__dirname, '../../test-files');
const APP_ROOT = path.resolve(__dirname, '../../..');

/**
 * Available test files from the test/test-files directory
 */
const TEST_FILES = {
  contract: {
    name: 'contract.txt',
    path: path.join(TEST_FILES_DIR, 'contract.txt'),
    type: 'text',
    expectedCategory: 'Legal'
  },
  projectReport: {
    name: 'project-report.md',
    path: path.join(TEST_FILES_DIR, 'project-report.md'),
    type: 'markdown',
    expectedCategory: 'Project'
  },
  samplePdf: {
    name: 'sample.pdf',
    path: path.join(TEST_FILES_DIR, 'sample.pdf'),
    type: 'pdf',
    expectedCategory: 'Document'
  },
  sampleTxt: {
    name: 'sample.txt',
    path: path.join(TEST_FILES_DIR, 'sample.txt'),
    type: 'text',
    expectedCategory: 'Document'
  },
  sampleMp3: {
    name: 'sample.mp3',
    path: path.join(TEST_FILES_DIR, 'sample.mp3'),
    type: 'audio',
    expectedCategory: 'Media'
  }
};

/**
 * Phase identifiers matching PHASES from shared/constants
 */
const PHASES = {
  WELCOME: 'welcome',
  SETUP: 'setup',
  DISCOVER: 'discover',
  ORGANIZE: 'organize',
  COMPLETE: 'complete'
};

/**
 * Navigation button labels for each phase
 */
const PHASE_NAV_LABELS = {
  [PHASES.WELCOME]: 'Welcome',
  [PHASES.SETUP]: 'Smart Folders',
  [PHASES.DISCOVER]: 'Discover Files',
  [PHASES.ORGANIZE]: 'Review Organize',
  [PHASES.COMPLETE]: 'Complete'
};

/**
 * Common UI selectors used across tests
 */
const SELECTORS = {
  // Navigation
  navBar: 'nav[aria-label="Phase navigation"]',
  phaseButton: (label) => `button[aria-label*="${label}"]`,
  settingsButton: 'button[aria-label="Open Settings"]',
  connectionStatus: '.text-stratosort-success',

  // Welcome Phase
  welcomeGetStarted: 'button:has-text("Get Started")',
  welcomeQuickStart: 'button:has-text("Quick Start")',

  // Setup Phase
  addFolderButton: 'button:has-text("Add Folder")',
  folderList: '[data-testid="folder-list"]',
  folderItem: '[data-testid="folder-item"]',
  continueToDiscover: 'button:has-text("Continue")',

  // Discover Phase
  dragDropZone: '[data-testid="drag-drop-zone"]',
  fileList: '[data-testid="file-list"]',
  fileItem: '[data-testid="file-item"]',
  analyzeButton: 'button:has-text("Analyze")',
  analysisProgress: '[data-testid="analysis-progress"]',

  // Organize Phase
  organizationPreview: '[data-testid="organization-preview"]',
  approveButton: 'button:has-text("Approve")',
  organizeButton: 'button:has-text("Organize")',

  // Complete Phase
  completionSummary: '[data-testid="completion-summary"]',
  startOverButton: 'button:has-text("Start Over")',

  // Settings Panel
  settingsPanel: '[data-testid="settings-panel"]',
  closeSettings: 'button[aria-label="Close Settings"]',

  // Generic
  loadingSpinner: '.animate-spin',
  errorMessage: '[role="alert"]',
  toast: '[data-testid="toast"]',
  modal: '[role="dialog"]',
  modalClose: '[aria-label="Close"]'
};

/**
 * Create a temporary test directory
 *
 * @param {string} prefix - Directory name prefix
 * @returns {Promise<string>} Path to temporary directory
 */
async function createTempDir(prefix = 'stratosort-e2e-') {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  console.log(`[E2E] Created temp directory: ${tempDir}`);
  return tempDir;
}

/**
 * Copy test files to a temporary directory for testing
 *
 * @param {string[]} fileKeys - Keys from TEST_FILES to copy
 * @returns {Promise<{tempDir: string, files: Object[]}>}
 */
async function setupTestFiles(fileKeys = ['sampleTxt', 'contract']) {
  const tempDir = await createTempDir();
  const files = [];

  for (const key of fileKeys) {
    const testFile = TEST_FILES[key];
    if (!testFile) {
      console.warn(`[E2E] Unknown test file key: ${key}`);
      continue;
    }

    try {
      const destPath = path.join(tempDir, testFile.name);
      await fs.copyFile(testFile.path, destPath);
      files.push({
        ...testFile,
        tempPath: destPath
      });
      console.log(`[E2E] Copied test file: ${testFile.name}`);
    } catch (error) {
      console.warn(`[E2E] Could not copy test file ${testFile.name}:`, error.message);
    }
  }

  return { tempDir, files };
}

/**
 * Clean up a temporary directory
 *
 * @param {string} tempDir - Path to temporary directory
 */
async function cleanupTempDir(tempDir) {
  if (!tempDir || !tempDir.includes('stratosort-e2e-')) {
    console.warn('[E2E] Refusing to delete non-test directory:', tempDir);
    return;
  }

  try {
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(`[E2E] Cleaned up temp directory: ${tempDir}`);
  } catch (error) {
    console.warn(`[E2E] Could not clean up temp directory:`, error.message);
  }
}

/**
 * Generate mock analysis result
 *
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock analysis result
 */
function mockAnalysisResult(overrides = {}) {
  return {
    category: 'Document',
    purpose: 'General document for testing',
    keywords: ['test', 'document', 'sample'],
    confidence: 0.85,
    suggestedFolder: 'Documents/Test',
    suggestedName: 'Test_Document.txt',
    extractedDate: new Date().toISOString().split('T')[0],
    ...overrides
  };
}

/**
 * Generate mock folder configuration
 *
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock folder configuration
 */
function mockFolder(overrides = {}) {
  return {
    id: `test-folder-${Date.now()}`,
    name: 'Test Folder',
    path: path.join(os.homedir(), 'Documents', 'StratoSort', 'Test'),
    description: 'A test folder for E2E testing',
    keywords: ['test', 'sample'],
    rules: [],
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

/**
 * Wait utilities for common async operations
 */
const wait = {
  /**
   * Wait for a specified amount of time
   * @param {number} ms - Milliseconds to wait
   */
  ms: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

  /**
   * Wait for a condition to be true
   * @param {Function} condition - Async function returning boolean
   * @param {number} timeout - Maximum wait time in ms
   * @param {number} interval - Check interval in ms
   */
  forCondition: async (condition, timeout = 10000, interval = 100) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await condition()) {
        return true;
      }
      await wait.ms(interval);
    }
    throw new Error(`Condition not met within ${timeout}ms`);
  }
};

/**
 * Test timeouts for different operations
 */
const TIMEOUTS = {
  SHORT: 5000, // Quick UI interactions
  MEDIUM: 15000, // Page loads, navigation
  LONG: 60000, // Analysis operations
  VERY_LONG: 180000 // Full workflow tests
};

module.exports = {
  TEST_FILES,
  TEST_FILES_DIR,
  APP_ROOT,
  PHASES,
  PHASE_NAV_LABELS,
  SELECTORS,
  createTempDir,
  setupTestFiles,
  cleanupTempDir,
  mockAnalysisResult,
  mockFolder,
  wait,
  TIMEOUTS
};
