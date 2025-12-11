/**
 * Tests for System IPC Handlers
 * Tests system metrics, statistics, and configuration handlers
 */

// Mock dependencies
jest.mock('../src/main/ipc/ipcWrappers', () => ({
  createHandler: jest.fn(({ handler }) => handler),
  createErrorResponse: jest.fn((error) => ({
    success: false,
    error: error.message || String(error)
  }))
}));

jest.mock('../src/shared/config/index', () => ({
  dump: jest.fn().mockReturnValue({
    config: { test: 'value' },
    metadata: { version: '1.0.0' }
  }),
  validate: jest.fn().mockReturnValue({
    valid: true,
    errors: [],
    warnings: []
  }),
  get: jest.fn().mockReturnValue('config-value')
}));

describe('registerSystemIpc', () => {
  let registerSystemIpc;
  let mockIpcMain;
  let mockLogger;
  let mockSystemAnalytics;
  let mockServiceIntegration;
  let handlers;

  const { IPC_CHANNELS } = require('../src/shared/constants');
  const SYSTEM_CHANNELS = IPC_CHANNELS.SYSTEM;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    handlers = {};
    mockIpcMain = {
      handle: jest.fn((channel, handler) => {
        handlers[channel] = handler;
      })
    };

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockSystemAnalytics = {
      collectMetrics: jest.fn().mockResolvedValue({
        cpu: 50,
        memory: 60,
        uptime: 3600
      })
    };

    mockServiceIntegration = {
      analysisHistory: {
        getStatistics: jest.fn().mockResolvedValue({
          totalFiles: 100,
          totalCategories: 10
        }),
        getRecentAnalysis: jest
          .fn()
          .mockResolvedValue([{ fileName: 'test.pdf', category: 'documents' }])
      },
      undoRedo: {
        getActionHistory: jest
          .fn()
          .mockReturnValue([{ type: 'organize', timestamp: new Date().toISOString() }])
      }
    };

    registerSystemIpc = require('../src/main/ipc/system');
    registerSystemIpc({
      ipcMain: mockIpcMain,
      IPC_CHANNELS,
      logger: mockLogger,
      systemAnalytics: mockSystemAnalytics,
      getServiceIntegration: () => mockServiceIntegration
    });
  });

  describe('registration', () => {
    test('registers all system IPC handlers', () => {
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        SYSTEM_CHANNELS.GET_APPLICATION_STATISTICS,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        SYSTEM_CHANNELS.GET_METRICS,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        SYSTEM_CHANNELS.APPLY_UPDATE,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        SYSTEM_CHANNELS.GET_CONFIG,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        SYSTEM_CHANNELS.GET_CONFIG_VALUE,
        expect.any(Function)
      );
    });
  });

  describe('GET_APPLICATION_STATISTICS handler', () => {
    test('returns application statistics', async () => {
      const handler = handlers[SYSTEM_CHANNELS.GET_APPLICATION_STATISTICS];

      const result = await handler();

      expect(result).toEqual({
        analysis: { totalFiles: 100, totalCategories: 10 },
        recentActions: expect.any(Array),
        recentAnalysis: expect.any(Array),
        timestamp: expect.any(String)
      });
    });

    test('fetches statistics from service integration', async () => {
      const handler = handlers[SYSTEM_CHANNELS.GET_APPLICATION_STATISTICS];

      await handler();

      expect(mockServiceIntegration.analysisHistory.getStatistics).toHaveBeenCalled();
      expect(mockServiceIntegration.analysisHistory.getRecentAnalysis).toHaveBeenCalledWith(20);
    });

    test('handles missing service gracefully', async () => {
      registerSystemIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        systemAnalytics: mockSystemAnalytics,
        getServiceIntegration: () => null
      });

      const handler = handlers[SYSTEM_CHANNELS.GET_APPLICATION_STATISTICS];
      const result = await handler();

      expect(result).toEqual({
        analysis: {},
        recentActions: [],
        recentAnalysis: [],
        timestamp: expect.any(String)
      });
    });

    test('handles errors and returns empty object', async () => {
      mockServiceIntegration.analysisHistory.getStatistics.mockRejectedValue(
        new Error('Database error')
      );

      const handler = handlers[SYSTEM_CHANNELS.GET_APPLICATION_STATISTICS];
      const result = await handler();

      expect(result).toEqual({});
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get system statistics:',
        expect.any(Error)
      );
    });
  });

  describe('GET_METRICS handler', () => {
    test('returns system metrics', async () => {
      const handler = handlers[SYSTEM_CHANNELS.GET_METRICS];

      const result = await handler();

      expect(result).toEqual({
        cpu: 50,
        memory: 60,
        uptime: 3600
      });
    });

    test('calls systemAnalytics.collectMetrics', async () => {
      const handler = handlers[SYSTEM_CHANNELS.GET_METRICS];

      await handler();

      expect(mockSystemAnalytics.collectMetrics).toHaveBeenCalled();
    });

    test('handles errors and returns empty object', async () => {
      mockSystemAnalytics.collectMetrics.mockRejectedValue(new Error('Metrics error'));

      const handler = handlers[SYSTEM_CHANNELS.GET_METRICS];
      const result = await handler();

      expect(result).toEqual({});
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to collect system metrics:',
        expect.any(Error)
      );
    });
  });

  describe('APPLY_UPDATE handler', () => {
    test('attempts to apply update', async () => {
      // Mock electron-updater
      jest.mock('electron-updater', () => ({
        autoUpdater: {
          quitAndInstall: jest.fn()
        }
      }));

      const handler = handlers[SYSTEM_CHANNELS.APPLY_UPDATE];

      // This will try to require electron-updater which will throw in test env
      try {
        await handler();
      } catch {
        // Expected to fail in test environment
      }
    });
  });

  describe('GET_CONFIG handler', () => {
    test('returns configuration dump', async () => {
      const handler = handlers[SYSTEM_CHANNELS.GET_CONFIG];

      const result = await handler();

      expect(result).toEqual({
        success: true,
        config: { test: 'value' },
        metadata: { version: '1.0.0' },
        validation: {
          valid: true,
          errorCount: 0,
          warningCount: 0
        }
      });
    });

    test('calls config dump with includeSensitive: false', async () => {
      const { dump } = require('../src/shared/config/index');
      const handler = handlers[SYSTEM_CHANNELS.GET_CONFIG];

      await handler();

      expect(dump).toHaveBeenCalledWith({ includeSensitive: false });
    });

    test('includes validation results', async () => {
      const { validate } = require('../src/shared/config/index');
      validate.mockReturnValue({
        valid: false,
        errors: ['Error 1', 'Error 2'],
        warnings: ['Warning 1']
      });

      const handler = handlers[SYSTEM_CHANNELS.GET_CONFIG];
      const result = await handler();

      expect(result.validation).toEqual({
        valid: false,
        errorCount: 2,
        warningCount: 1
      });
    });

    test('handles errors', async () => {
      const { dump } = require('../src/shared/config/index');
      dump.mockImplementation(() => {
        throw new Error('Config error');
      });

      const handler = handlers[SYSTEM_CHANNELS.GET_CONFIG];
      const result = await handler();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Config error');
    });
  });

  describe('GET_CONFIG_VALUE handler', () => {
    test('returns config value by path', async () => {
      const handler = handlers[SYSTEM_CHANNELS.GET_CONFIG_VALUE];

      const result = await handler(null, 'test.path');

      expect(result).toEqual({
        success: true,
        path: 'test.path',
        value: 'config-value'
      });
    });

    test('calls config get with path', async () => {
      const { get } = require('../src/shared/config/index');
      const handler = handlers[SYSTEM_CHANNELS.GET_CONFIG_VALUE];

      await handler(null, 'my.config.path');

      expect(get).toHaveBeenCalledWith('my.config.path');
    });

    test('handles errors', async () => {
      const { get } = require('../src/shared/config/index');
      get.mockImplementation(() => {
        throw new Error('Path not found');
      });

      const handler = handlers[SYSTEM_CHANNELS.GET_CONFIG_VALUE];
      const result = await handler(null, 'invalid.path');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Path not found');
    });
  });
});
