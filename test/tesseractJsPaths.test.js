/**
 * Tests for tesseractJsPaths utility
 * Validates Tesseract.js asset path resolution for main/renderer processes
 */

const path = require('path');

describe('resolveTesseractJsOptions', () => {
  const originalProcessType = process.type;
  let mockLogger;

  beforeEach(() => {
    jest.resetModules();
    mockLogger = {
      warn: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn()
    };
    // Default to main process
    Object.defineProperty(process, 'type', { value: 'browser', configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, 'type', {
      value: originalProcessType,
      configurable: true
    });
  });

  test('returns workerPath, corePath, and workerBlobURL:false for main process', () => {
    const { resolveTesseractJsOptions } = require('../src/main/utils/tesseractJsPaths');
    const result = resolveTesseractJsOptions(mockLogger);

    // If tesseract.js is installed, should return valid paths
    if (result === null) {
      // tesseract.js not installed in test environment - that's fine
      expect(mockLogger.warn).toHaveBeenCalled();
      return;
    }

    expect(result).toHaveProperty('workerPath');
    expect(result).toHaveProperty('corePath');
    expect(result.workerBlobURL).toBe(false);
    expect(typeof result.workerPath).toBe('string');
    expect(typeof result.corePath).toBe('string');
  });

  test('returns workerPath and corePath (no workerBlobURL) for renderer process', () => {
    Object.defineProperty(process, 'type', { value: 'renderer', configurable: true });

    const { resolveTesseractJsOptions } = require('../src/main/utils/tesseractJsPaths');
    const result = resolveTesseractJsOptions(mockLogger);

    if (result === null) {
      expect(mockLogger.warn).toHaveBeenCalled();
      return;
    }

    expect(result).toHaveProperty('workerPath');
    expect(result).toHaveProperty('corePath');
    // Renderer should NOT have workerBlobURL: false
    expect(result.workerBlobURL).toBeUndefined();
  });

  test('returns null and logs warning when assets cannot be resolved', () => {
    jest.resetModules();

    // Create a version of the module that will fail require.resolve internally
    // by mocking the path module to return an invalid path for dirname
    jest.doMock('path', () => {
      const realPath = jest.requireActual('path');
      return {
        ...realPath,
        dirname: jest.fn(() => {
          throw new Error('Simulated resolution failure');
        })
      };
    });

    const { resolveTesseractJsOptions } = require('../src/main/utils/tesseractJsPaths');
    const result = resolveTesseractJsOptions(mockLogger);

    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      '[OCR] Failed to resolve tesseract.js assets',
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  test('handles null logger gracefully when resolution fails', () => {
    jest.resetModules();

    jest.doMock('path', () => {
      const realPath = jest.requireActual('path');
      return {
        ...realPath,
        dirname: jest.fn(() => {
          throw new Error('Simulated failure');
        })
      };
    });

    const { resolveTesseractJsOptions } = require('../src/main/utils/tesseractJsPaths');
    // Should not throw even with null logger
    expect(() => resolveTesseractJsOptions(null)).not.toThrow();
    expect(resolveTesseractJsOptions(null)).toBeNull();
  });

  test('handles undefined logger gracefully when resolution fails', () => {
    jest.resetModules();

    jest.doMock('path', () => {
      const realPath = jest.requireActual('path');
      return {
        ...realPath,
        dirname: jest.fn(() => {
          throw new Error('Simulated failure');
        })
      };
    });

    const { resolveTesseractJsOptions } = require('../src/main/utils/tesseractJsPaths');
    expect(() => resolveTesseractJsOptions(undefined)).not.toThrow();
    expect(resolveTesseractJsOptions(undefined)).toBeNull();
  });
});
