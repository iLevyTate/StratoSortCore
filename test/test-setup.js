/**
 * Test Setup for Stratosort Document Processing Tests
 * Initializes mocks, global variables, and test utilities
 */

// Import jest-dom for React Testing Library matchers (toBeInTheDocument, etc.)
require('@testing-library/jest-dom');

const { vol, fs: memfs } = require('memfs');
const path = require('path');
const { EventEmitter } = require('events');
const { clearTimeout: nodeClearTimeout, clearInterval: nodeClearInterval } = require('timers');

// Avoid noisy MaxListeners warnings in Jest runs
EventEmitter.defaultMaxListeners = 50;
process.setMaxListeners(50);

// Use platform-appropriate temp directory for memfs
// On Windows, use /tmp as a virtual Unix-style path that memfs understands
const MOCK_TMP_DIR = '/tmp';

// Apply wrappers to memfs before mocking
const originalWriteFile = memfs.promises.writeFile.bind(memfs.promises);
memfs.promises.writeFile = async (filePath, data, options) => {
  // Normalize path to Unix-style for memfs
  const normalizedPath = filePath.replace(/\\/g, '/');
  await memfs.promises.mkdir(path.dirname(normalizedPath).replace(/\\/g, '/'), {
    recursive: true
  });
  return originalWriteFile(normalizedPath, data, options);
};

const originalRename = memfs.promises.rename.bind(memfs.promises);
memfs.promises.rename = async (oldPath, newPath) => {
  // Normalize paths to Unix-style for memfs
  const normalizedOld = oldPath.replace(/\\/g, '/');
  const normalizedNew = newPath.replace(/\\/g, '/');
  await memfs.promises.mkdir(path.dirname(normalizedNew).replace(/\\/g, '/'), {
    recursive: true
  });
  return originalRename(normalizedOld, normalizedNew);
};

const originalMkdir = memfs.promises.mkdir.bind(memfs.promises);
memfs.promises.mkdir = async (dirPath, options) => {
  // Normalize path to Unix-style for memfs
  const normalizedPath = dirPath.replace(/\\/g, '/');
  return originalMkdir(normalizedPath, options);
};

const originalReadFile = memfs.promises.readFile.bind(memfs.promises);
memfs.promises.readFile = async (filePath, options) => {
  // Normalize path to Unix-style for memfs
  const normalizedPath = filePath.replace(/\\/g, '/');
  return originalReadFile(normalizedPath, options);
};

// Polyfill mkdtemp for memfs
if (!memfs.promises.mkdtemp) {
  memfs.promises.mkdtemp = async (prefix) => {
    const normalizedPrefix = prefix.replace(/\\/g, '/');
    const tempDir = normalizedPrefix + Date.now() + Math.random().toString(36).substring(2, 8);
    await memfs.promises.mkdir(tempDir, { recursive: true });
    return tempDir;
  };
}

jest.mock('fs', () => require('memfs').fs);
jest.mock('fs/promises', () => require('memfs').fs.promises);
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  tmpdir: () => MOCK_TMP_DIR
}));

function shouldSuppressKnownNetworkNoise(args) {
  // Jest/jsdom VirtualConsole sometimes emits noisy XHR errors when optional services
  // (e.g., local ChromaDB) are not running. These are not actionable for unit tests.
  const joined = args
    .map((a) => {
      if (!a) return '';
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.message || '';
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');

  return (
    joined.includes('ECONNREFUSED 127.0.0.1:8000') ||
    joined.includes('ECONNREFUSED ::1:8000') ||
    joined.includes('connect ECONNREFUSED 127.0.0.1:8000') ||
    joined.includes('connect ECONNREFUSED ::1:8000')
  );
}

// Global test utilities (keep logs quiet, but don't hide real errors)
global.console = {
  ...global.console,
  log: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn((...args) => {
    // Suppress known noisy network warnings (e.g., optional local services not running)
    if (shouldSuppressKnownNetworkNoise(args)) return;
  }),
  error: jest.fn((...args) => {
    // Suppress known noisy network errors (e.g., optional local services not running)
    if (shouldSuppressKnownNetworkNoise(args)) return;
  })
};

// Mock DOM environment for Electron
global.document = {
  querySelector: jest.fn(),
  querySelectorAll: jest.fn(() => []),
  createElement: jest.fn(() => ({
    click: jest.fn(),
    addEventListener: jest.fn()
  }))
};

global.window = {
  location: { href: 'http://localhost' },
  addEventListener: jest.fn(),
  removeEventListener: jest.fn()
};

// Initialize test state
global.documentStore = [];
global.processingQueue = [];
global.stateListeners = [];
global.progressListeners = [];
global.aiConfig = {
  confidenceThreshold: 0.7,
  folderNamingPattern: '{category}/{type}',
  enableDateExtraction: true,
  categories: ['Financial', 'Legal', 'Project', 'Personal', 'Technical']
};

// Clear the in-memory file system before each test
beforeEach(() => {
  vol.reset();
  vol.mkdirSync(MOCK_TMP_DIR, { recursive: true });
});

// Mock performance monitoring
global.performance = {
  mark: jest.fn(),
  measure: jest.fn(),
  now: jest.fn(() => Date.now())
};

// Test utilities for document processing
global.testUtils = {
  createMockDocument: (overrides = {}) => ({
    id: `test-doc-${Date.now()}`,
    name: 'test-document.pdf',
    type: 'application/pdf',
    size: 1024,
    content: 'Mock document content for testing',
    ...overrides
  }),

  createMockAnalysisResult: (overrides = {}) => ({
    category: 'Test',
    purpose: 'Testing document analysis',
    keywords: ['test', 'mock', 'document'],
    confidence: 0.85,
    suggestedFolder: 'Test/Documents',
    extractedDate: '2024',
    ...overrides
  }),

  waitForAsync: (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms)),

  generateLargeContent: (sizeKB = 100) => {
    const chunks = sizeKB;
    return Array.from({ length: chunks }, (_, i) => `Mock content chunk ${i + 1} `.repeat(50)).join(
      '\n'
    );
  }
};

// Performance testing utilities
global.performanceUtils = {
  startTimer: () => {
    const start = process.hrtime.bigint();
    return () => {
      const end = process.hrtime.bigint();
      return Number(end - start) / 1000000; // Convert to milliseconds
    };
  },

  measureMemory: () => process.memoryUsage(),

  trackResourceUsage: () => {
    const startMemory = process.memoryUsage();
    const startTime = process.hrtime.bigint();

    return () => {
      const endMemory = process.memoryUsage();
      const endTime = process.hrtime.bigint();

      return {
        memoryDelta: {
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          heapTotal: endMemory.heapTotal - startMemory.heapTotal,
          external: endMemory.external - startMemory.external
        },
        timeElapsed: Number(endTime - startTime) / 1000000 // milliseconds
      };
    };
  }
};

// Test data generators
global.testDataGenerators = {
  invoice: () => ({
    content: `
      INVOICE #${Math.floor(Math.random() * 10000)}
      Date: ${new Date().toISOString().split('T')[0]}
      Amount: $${(Math.random() * 5000 + 100).toFixed(2)}
      Due Date: ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
      Payment Terms: Net 30
    `,
    expectedCategory: 'Financial',
    expectedFolder: 'Financial/Invoices'
  }),

  contract: () => ({
    content: `
      SERVICE AGREEMENT
      Date: ${new Date().toISOString().split('T')[0]}
      Between: Company A and Company B
      Terms: Software development services
      Duration: 12 months
      Value: $${(Math.random() * 50000 + 10000).toFixed(2)}
    `,
    expectedCategory: 'Legal',
    expectedFolder: 'Legal/Contracts'
  }),

  report: () => ({
    content: `
      PROJECT STATUS REPORT
      Date: ${new Date().toISOString().split('T')[0]}
      Project: Test Project ${Math.floor(Math.random() * 100)}
      Progress: ${Math.floor(Math.random() * 100)}% complete
      Budget: On track
      Timeline: Meeting milestones
    `,
    expectedCategory: 'Project',
    expectedFolder: 'Projects/Reports'
  })
};

// Import and setup mock services
const { mockOllamaService } = require('./mocks/ollama');

// Make mock services globally available
global.mockOllamaService = mockOllamaService;

// Cleanup between tests
beforeEach(() => {
  jest.clearAllMocks();
  vol.reset(); // Reset the in-memory file system
  vol.mkdirSync(MOCK_TMP_DIR, { recursive: true });
  global.documentStore = [];
  global.processingQueue = [];
  global.stateListeners = [];
  global.progressListeners = [];

  // Reset mock services to default behavior
  mockOllamaService.analyze.mockResolvedValue({
    status: 'success',
    analysis: {
      category: 'Financial',
      purpose: 'Invoice processing',
      keywords: ['invoice', 'payment', 'financial'],
      confidence: 0.92,
      suggestedFolder: 'Financial/Invoices',
      suggestedName: 'Invoice_Test_2024-06-04.pdf'
    }
  });

  mockOllamaService.isConnected.mockReturnValue(true);
});

afterEach(() => {
  const registry = global.__testTimerRegistry;
  if (!registry) return;
  const timeouts = Array.from(registry.timeouts);
  const intervals = Array.from(registry.intervals);
  const clearTimeoutSafe =
    typeof global.clearTimeout === 'function' ? global.clearTimeout : nodeClearTimeout;
  const clearIntervalSafe =
    typeof global.clearInterval === 'function' ? global.clearInterval : nodeClearInterval;
  timeouts.forEach((timer) => clearTimeoutSafe(timer));
  intervals.forEach((timer) => clearIntervalSafe(timer));
  registry.timeouts.clear();
  registry.intervals.clear();
  jest.useRealTimers();
});

// Test environment validation
beforeAll(() => {
  console.log('🧪 Stratosort Test Environment Initialized');
  console.log('📋 Test utilities available:', Object.keys(global.testUtils));
  console.log('⚡ Performance monitoring enabled');
  console.log('🎯 Mock services configured');
});

afterAll(async () => {
  // FIX: Clean up HTTP agents from ollamaUtils to prevent open handles
  // The ollamaUtils module creates keep-alive HTTP agents that hold Jest open
  // Only attempt cleanup if the module was actually loaded during tests
  const ollamaUtilsPath = require.resolve('../src/main/ollamaUtils');
  if (require.cache[ollamaUtilsPath]) {
    try {
      const { cleanupOllamaAgent } = require('../src/main/ollamaUtils');
      if (typeof cleanupOllamaAgent === 'function') {
        cleanupOllamaAgent();
      }
    } catch {
      // Safe to ignore cleanup errors
    }
  }

  // FIX: Shutdown ServiceContainer to clean up all registered services
  // Services like SmartFolderWatcher, ChromaDB, etc. have intervals/connections
  const containerPath = require.resolve('../src/main/services/ServiceContainer');
  if (require.cache[containerPath]) {
    try {
      const { container, SHUTDOWN_ORDER } = require('../src/main/services/ServiceContainer');
      if (container && typeof container.shutdown === 'function') {
        await container.shutdown(SHUTDOWN_ORDER);
      }
    } catch {
      // Safe to ignore cleanup errors
    }
  }

  // FIX: Clean up any OllamaClient instances that might have health check timers
  try {
    const ollamaClientPath = require.resolve('../src/main/services/OllamaClient');
    if (require.cache[ollamaClientPath]) {
      const OllamaClient = require('../src/main/services/OllamaClient');
      // Check for singleton instance
      if (OllamaClient._instance && typeof OllamaClient._instance.shutdown === 'function') {
        await OllamaClient._instance.shutdown();
      }
    }
  } catch {
    // Safe to ignore
  }

  console.log('✅ All Stratosort tests completed');
  console.log('🧹 Test environment cleaned up');
});
