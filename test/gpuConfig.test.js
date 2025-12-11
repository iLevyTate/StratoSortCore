/**
 * Tests for GPU Configuration Module
 * Tests GPU preference settings and hardware acceleration
 */

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock electron app
const mockApp = {
  disableHardwareAcceleration: jest.fn(),
  commandLine: {
    appendSwitch: jest.fn()
  }
};
jest.mock('electron', () => ({
  app: mockApp
}));

describe('GPU Configuration', () => {
  let gpuConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Reset environment variables
    delete process.env.STRATOSORT_FORCE_SOFTWARE_GPU;
    delete process.env.ELECTRON_FORCE_SOFTWARE;
    delete process.env.ANGLE_BACKEND;
    delete process.env.STRATOSORT_GL_IMPLEMENTATION;
  });

  describe('forceSoftwareRenderer', () => {
    test('is false by default', () => {
      gpuConfig = require('../src/main/core/gpuConfig');
      expect(gpuConfig.forceSoftwareRenderer).toBe(false);
    });

    test('is true when STRATOSORT_FORCE_SOFTWARE_GPU=1', () => {
      process.env.STRATOSORT_FORCE_SOFTWARE_GPU = '1';
      gpuConfig = require('../src/main/core/gpuConfig');
      expect(gpuConfig.forceSoftwareRenderer).toBe(true);
    });

    test('is true when ELECTRON_FORCE_SOFTWARE=1', () => {
      process.env.ELECTRON_FORCE_SOFTWARE = '1';
      gpuConfig = require('../src/main/core/gpuConfig');
      expect(gpuConfig.forceSoftwareRenderer).toBe(true);
    });
  });

  describe('initializeGpuConfig', () => {
    test('disables hardware acceleration when forceSoftwareRenderer is true', () => {
      process.env.STRATOSORT_FORCE_SOFTWARE_GPU = '1';
      gpuConfig = require('../src/main/core/gpuConfig');

      gpuConfig.initializeGpuConfig();

      expect(mockApp.disableHardwareAcceleration).toHaveBeenCalled();
    });

    test('sets ANGLE backend when hardware acceleration enabled', () => {
      gpuConfig = require('../src/main/core/gpuConfig');

      gpuConfig.initializeGpuConfig();

      expect(mockApp.commandLine.appendSwitch).toHaveBeenCalledWith('use-angle', 'd3d11');
    });

    test('uses custom ANGLE backend from environment', () => {
      process.env.ANGLE_BACKEND = 'gl';
      gpuConfig = require('../src/main/core/gpuConfig');

      gpuConfig.initializeGpuConfig();

      expect(mockApp.commandLine.appendSwitch).toHaveBeenCalledWith('use-angle', 'gl');
    });

    test('sets custom GL implementation when specified', () => {
      process.env.STRATOSORT_GL_IMPLEMENTATION = 'desktop';
      gpuConfig = require('../src/main/core/gpuConfig');

      gpuConfig.initializeGpuConfig();

      expect(mockApp.commandLine.appendSwitch).toHaveBeenCalledWith('use-gl', 'desktop');
    });

    test('ignores GPU blocklist', () => {
      gpuConfig = require('../src/main/core/gpuConfig');

      gpuConfig.initializeGpuConfig();

      expect(mockApp.commandLine.appendSwitch).toHaveBeenCalledWith('ignore-gpu-blocklist');
    });

    test('handles app.commandLine errors gracefully', () => {
      gpuConfig = require('../src/main/core/gpuConfig');

      // Set up mock to throw after module load
      mockApp.commandLine.appendSwitch.mockImplementation(() => {
        throw new Error('Failed to append switch');
      });

      // Should not throw
      expect(() => gpuConfig.initializeGpuConfig()).not.toThrow();
    });
  });

  describe('handleGpuProcessGone', () => {
    beforeEach(() => {
      gpuConfig = require('../src/main/core/gpuConfig');
    });

    test('ignores non-GPU process exits', () => {
      const { logger } = require('../src/shared/logger');

      gpuConfig.handleGpuProcessGone({}, { type: 'renderer' });

      expect(logger.error).not.toHaveBeenCalled();
    });

    test('logs GPU process exit', () => {
      const { logger } = require('../src/shared/logger');

      gpuConfig.handleGpuProcessGone(
        {},
        {
          type: 'GPU',
          reason: 'crashed',
          exitCode: 1
        }
      );

      expect(logger.error).toHaveBeenCalledWith(
        '[GPU] Process exited',
        expect.objectContaining({
          reason: 'crashed',
          exitCode: 1
        })
      );
    });

    test('warns after repeated GPU failures', () => {
      const { logger } = require('../src/shared/logger');

      gpuConfig.handleGpuProcessGone({}, { type: 'GPU' });
      gpuConfig.handleGpuProcessGone({}, { type: 'GPU' });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Repeated GPU failures'));
    });
  });

  describe('applyProductionOptimizations', () => {
    beforeEach(() => {
      // Reset mock to default implementation
      mockApp.commandLine.appendSwitch.mockReset();
      mockApp.commandLine.appendSwitch.mockImplementation(() => {});
    });

    test('enables GPU rasterization in production', () => {
      gpuConfig = require('../src/main/core/gpuConfig');

      gpuConfig.applyProductionOptimizations(false);

      expect(mockApp.commandLine.appendSwitch).toHaveBeenCalledWith('enable-gpu-rasterization');
      expect(mockApp.commandLine.appendSwitch).toHaveBeenCalledWith('enable-zero-copy');
    });

    test('enables GPU rasterization in development', () => {
      gpuConfig = require('../src/main/core/gpuConfig');

      gpuConfig.applyProductionOptimizations(true);

      expect(mockApp.commandLine.appendSwitch).toHaveBeenCalledWith('enable-gpu-rasterization');
    });

    test('skips GPU optimizations when software rendering forced', () => {
      process.env.STRATOSORT_FORCE_SOFTWARE_GPU = '1';
      gpuConfig = require('../src/main/core/gpuConfig');
      jest.clearAllMocks();

      gpuConfig.applyProductionOptimizations(false);

      expect(mockApp.commandLine.appendSwitch).not.toHaveBeenCalledWith('enable-gpu-rasterization');
    });
  });
});
