/**
 * Centralized Logger Mock
 *
 * Provides a standardized mock for the logger module.
 * Import this in test files instead of defining the mock inline.
 *
 * @example
 * // In your test file:
 * jest.mock('../src/shared/logger', () => require('./mocks/logger'));
 *
 * // Or with custom path adjustment:
 * jest.mock('../../src/shared/logger', () => require('../mocks/logger'));
 */

const createLoggerMock = () => ({
  setContext: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  verbose: jest.fn()
});

const logger = createLoggerMock();

module.exports = {
  logger,
  createLoggerMock
};
