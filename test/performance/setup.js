/**
 * Setup file for Performance Tests
 *
 * Configures the test environment for performance measurements.
 */

// Increase default timeout for performance tests
jest.setTimeout(60000);

// Mock console to allow performance logging while suppressing noise
const originalConsole = global.console;
global.console = {
  ...originalConsole,
  log: jest.fn((...args) => {
    // Allow [PERF] and [STRESS] prefixed logs
    const message = args[0];
    if (
      typeof message === 'string' &&
      (message.includes('[PERF]') || message.includes('[STRESS]'))
    ) {
      originalConsole.log(...args);
    }
  }),
  warn: jest.fn(),
  error: jest.fn((...args) => {
    // Still show actual errors
    originalConsole.error(...args);
  }),
  debug: jest.fn(),
  info: jest.fn()
};

// Performance test utilities
global.performanceTestUtils = {
  // Helper to format bytes
  formatBytes: (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  },

  // Helper to format duration
  formatDuration: (ms) => {
    if (ms < 1000) return `${ms.toFixed(2)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  },

  // Log performance metric
  logMetric: (name, value, unit = '') => {
    originalConsole.log(`[PERF] ${name}: ${value}${unit}`);
  }
};

// Cleanup after each test
afterEach(() => {
  // Clear any timers
  jest.clearAllTimers();
});

// Log test suite start
beforeAll(() => {
  originalConsole.log('\n========================================');
  originalConsole.log('       PERFORMANCE TESTS STARTING');
  originalConsole.log('========================================\n');
});

// Log test suite completion
afterAll(() => {
  originalConsole.log('\n========================================');
  originalConsole.log('       PERFORMANCE TESTS COMPLETE');
  originalConsole.log('========================================\n');
});
