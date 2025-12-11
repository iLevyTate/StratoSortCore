/**
 * E2E Test Helpers - Main Export
 *
 * This file exports all helper modules for convenient importing in tests.
 *
 * Usage:
 *   const { launchApp, closeApp, PHASES, NavigationPage } = require('./helpers');
 */

// Electron app control utilities
const electronApp = require('./electronApp');

// Test fixtures and data
const testFixtures = require('./testFixtures');

// Page object models
const pageObjects = require('./pageObjects');

module.exports = {
  // Electron App Helpers
  ...electronApp,

  // Test Fixtures
  ...testFixtures,

  // Page Objects
  ...pageObjects
};
