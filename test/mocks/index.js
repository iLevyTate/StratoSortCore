/**
 * Centralized Test Mocks
 *
 * This module exports all centralized mock implementations.
 * Use these mocks to reduce duplication across test files.
 *
 * @example
 * // Import specific mock
 * const { logger, createLoggerMock } = require('./mocks/logger');
 *
 * // Or import from index
 * const mocks = require('./mocks');
 * jest.mock('../src/shared/logger', () => mocks.logger);
 *
 * Migration Guide:
 * ----------------
 * To migrate an existing test file to use centralized mocks:
 *
 * BEFORE (inline mock):
 * ```
 * jest.mock('../src/shared/logger', () => ({
 *   logger: {
 *     setContext: jest.fn(),
 *     info: jest.fn(),
 *     debug: jest.fn(),
 *     warn: jest.fn(),
 *     error: jest.fn()
 *   }
 * }));
 * ```
 *
 * AFTER (centralized mock):
 * ```
 * jest.mock('../src/shared/logger', () => require('./mocks/logger'));
 * ```
 */

const loggerMocks = require('./logger');
const electronMocks = require('./electron');
const fsMocks = require('./fs');

module.exports = {
  // Logger mocks
  logger: loggerMocks,
  createLoggerMock: loggerMocks.createLoggerMock,

  // Electron mocks
  electron: electronMocks,

  // File system mocks
  fs: fsMocks.fs,
  fsPromises: fsMocks.promises,
  createFsMock: fsMocks.createFsMock,
  createFsPromisesMock: fsMocks.createFsPromisesMock
};
