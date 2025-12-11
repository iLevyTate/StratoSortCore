/**
 * Jest configuration for Performance Tests
 *
 * These tests measure batch processing, memory usage, and throughput.
 * They have longer timeouts and run sequentially for accurate measurements.
 */

module.exports = {
  displayName: 'Performance Tests',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.perf.test.js'],
  transform: {
    '^.+\\.(js|jsx)$': [
      'babel-jest',
      {
        presets: [['@babel/preset-env', { targets: { node: 'current' } }]]
      }
    ]
  },

  // Performance tests need more time
  testTimeout: 60000,

  // Run sequentially for accurate measurements
  maxWorkers: 1,

  // Module resolution
  moduleNameMapper: {
    '^electron$': '<rootDir>/../mocks/electron.js',
    '^ollama$': '<rootDir>/../mocks/ollama.js'
  },

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/setup.js'],

  // Coverage disabled for performance tests
  collectCoverage: false,

  // Verbose output for performance metrics
  verbose: true
};
