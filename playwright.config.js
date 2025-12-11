/**
 * Playwright Configuration for StratoSort Electron E2E Testing
 *
 * This configuration sets up Playwright to test the Electron application.
 * It uses the _electron fixture to launch and control the app.
 *
 * Prerequisites:
 * - Run `npm run build:dev` before running tests to ensure the renderer is built
 * - Ollama should be running for AI-related tests (optional, tests handle missing Ollama)
 *
 * Running tests:
 * - `npm run test:e2e` - Run all E2E tests in headless mode
 * - `npm run test:e2e:headed` - Run tests with visible Electron window
 * - `npm run test:e2e:debug` - Run tests in debug mode with Playwright Inspector
 */

const { defineConfig } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  // Directory containing E2E test files
  testDir: './test/e2e',

  // Test file pattern
  testMatch: '**/*.spec.js',

  // Maximum time one test can run (3 minutes for analysis tests)
  timeout: 180000,

  // Maximum time for expect() assertions (30 seconds)
  expect: {
    timeout: 30000
  },

  // Fail the build on CI if test.only is accidentally left in source code
  forbidOnly: !!process.env.CI,

  // Retry failed tests (more retries on CI)
  retries: process.env.CI ? 2 : 1,

  // Run tests serially in Electron - parallel execution can cause issues
  workers: 1,

  // Shared settings for all projects
  use: {
    // Trace on first retry for better debugging
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video recording on retry
    video: 'on-first-retry',

    // Timeout for actions like click, fill, etc.
    actionTimeout: 15000,

    // Navigation timeout
    navigationTimeout: 30000
  },

  // Output folder for test artifacts (screenshots, videos, traces)
  outputDir: './test-results/e2e',

  // Reporter configuration
  reporter: [
    ['list'],
    ['html', { outputFolder: './test-results/e2e-report', open: 'never' }],
    ...(process.env.CI ? [['github']] : [])
  ],

  // Global setup/teardown
  globalSetup: path.join(__dirname, 'test/e2e/helpers/globalSetup.js'),
  globalTeardown: path.join(__dirname, 'test/e2e/helpers/globalTeardown.js'),

  // Projects configuration - Electron doesn't use browser projects
  // but we define one for consistency with Playwright conventions
  projects: [
    {
      name: 'electron',
      use: {
        // No browser launch options needed - we launch Electron directly
      }
    }
  ]
});
