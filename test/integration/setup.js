/**
 * Setup file for Integration Tests
 *
 * Configures the test environment for service integration testing.
 */

// Increase default timeout for integration tests
jest.setTimeout(30000);

// Mock console to suppress noise while allowing test logging
const originalConsole = global.console;
global.console = {
  ...originalConsole,
  log: jest.fn((...args) => {
    const message = args[0];
    if (
      typeof message === 'string' &&
      (message.includes('[TEST]') || message.includes('[INTEGRATION]'))
    ) {
      originalConsole.log(...args);
    }
  }),
  warn: jest.fn(),
  error: jest.fn((...args) => {
    originalConsole.error(...args);
  }),
  debug: jest.fn(),
  info: jest.fn()
};

// Integration test utilities
global.integrationTestUtils = {
  // Wait for service to be ready
  waitForService: async (checkFn, timeoutMs = 5000) => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        if (await checkFn()) {
          return true;
        }
      } catch (e) {
        // Continue waiting
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  },

  // Log integration test metric
  logMetric: (name, value, unit = '') => {
    originalConsole.log(`[INTEGRATION] ${name}: ${value}${unit}`);
  }
};

// Cleanup after each test
afterEach(() => {
  jest.clearAllTimers();
});

// Log test suite start
beforeAll(() => {
  originalConsole.log('\n========================================');
  originalConsole.log('      INTEGRATION TESTS STARTING');
  originalConsole.log('========================================\n');
});

// Log test suite completion
afterAll(() => {
  originalConsole.log('\n========================================');
  originalConsole.log('      INTEGRATION TESTS COMPLETE');
  originalConsole.log('========================================\n');
});
