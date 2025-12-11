/**
 * Jest configuration for Stress Tests
 *
 * These tests simulate high-load scenarios, queue overflow, and rapid events.
 * They have longer timeouts and may use fake timers.
 */

module.exports = {
  displayName: 'Stress Tests',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.js'],
  transform: {
    '^.+\\.(js|jsx)$': [
      'babel-jest',
      {
        presets: [['@babel/preset-env', { targets: { node: 'current' } }]]
      }
    ]
  },

  // Stress tests need more time
  testTimeout: 120000,

  // Run sequentially for accurate measurements
  maxWorkers: 1,

  // Module resolution
  moduleNameMapper: {
    '^electron$': '<rootDir>/../mocks/electron.js',
    '^ollama$': '<rootDir>/../mocks/ollama.js',
    '^chokidar$': '<rootDir>/../mocks/chokidar.js'
  },

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/setup.js'],

  // Coverage disabled for stress tests
  collectCoverage: false,

  // Verbose output
  verbose: true
};
