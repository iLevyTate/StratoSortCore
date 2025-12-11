/**
 * Setup file for Stress Tests
 *
 * Configures the test environment for high-load scenario testing.
 */

// Increase default timeout for stress tests
jest.setTimeout(120000);

// Mock console to allow stress test logging while suppressing noise
const originalConsole = global.console;
global.console = {
  ...originalConsole,
  log: jest.fn((...args) => {
    // Allow [STRESS] and [TEST] prefixed logs
    const message = args[0];
    if (
      typeof message === 'string' &&
      (message.includes('[STRESS]') || message.includes('[TEST]'))
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

// Stress test utilities
global.stressTestUtils = {
  // Create N items rapidly
  createRapidItems: (count, factory) => {
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push(factory(i));
    }
    return items;
  },

  // Run operation N times and track results
  runMultiple: async (count, operation) => {
    const results = [];
    for (let i = 0; i < count; i++) {
      try {
        const result = await operation(i);
        results.push({ success: true, result });
      } catch (error) {
        results.push({ success: false, error });
      }
    }
    return {
      total: count,
      successes: results.filter((r) => r.success).length,
      failures: results.filter((r) => !r.success).length,
      results
    };
  },

  // Log stress test metric
  logMetric: (name, value, unit = '') => {
    originalConsole.log(`[STRESS] ${name}: ${value}${unit}`);
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
  originalConsole.log('         STRESS TESTS STARTING');
  originalConsole.log('========================================\n');
});

// Log test suite completion
afterAll(() => {
  originalConsole.log('\n========================================');
  originalConsole.log('         STRESS TESTS COMPLETE');
  originalConsole.log('========================================\n');
});
