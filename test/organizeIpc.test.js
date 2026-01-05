/**
 * Tests for Organize IPC Handlers
 * Tests file organization operations including auto-organize and batch organize
 */

// Mock fs promises
jest.mock('fs', () => ({
  promises: {
    stat: jest.fn()
  }
}));

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

// Mock ipcWrappers - mirrors actual createHandler behavior
jest.mock('../src/main/ipc/ipcWrappers', () => ({
  createHandler: jest.fn(({ handler, fallbackResponse, getService }) => {
    // Return a handler function that will be called by ipcMain.handle
    // The real createHandler appends service as last arg: handler(...args, service)
    return async (...args) => {
      try {
        const service = getService?.();
        if (!service && fallbackResponse) {
          return fallbackResponse;
        }
        // Append service as last argument like the real implementation
        const result = await handler(...args, service);
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    };
  }),
  createErrorResponse: jest.fn((error, defaults = {}) => ({
    success: false,
    error: error.message,
    ...defaults
  })),
  safeHandle: (ipcMain, channel, handler) => {
    ipcMain.handle(channel, handler);
  }
}));

// Mock validationSchemas
jest.mock('../src/main/ipc/validationSchemas', () => ({
  schemas: {
    autoOrganize: {},
    thresholds: {}
  }
}));

describe('Organize IPC Handlers', () => {
  let registerOrganizeIpc;
  let mockIpcMain;
  let handlers;
  let mockOrganizeService;
  let mockCustomFolders;
  let fs;

  const IPC_CHANNELS = {
    ORGANIZE: {
      AUTO: 'organize:auto',
      BATCH: 'organize:batch',
      PROCESS_NEW: 'organize:process-new',
      GET_STATS: 'organize:get-stats',
      UPDATE_THRESHOLDS: 'organize:update-thresholds',
      CLUSTER_BATCH: 'organize:cluster-batch',
      IDENTIFY_OUTLIERS: 'organize:identify-outliers',
      GET_CLUSTER_SUGGESTIONS: 'organize:get-cluster-suggestions'
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    handlers = {};
    mockCustomFolders = [
      { id: '1', name: 'Documents', path: '/path/to/documents' },
      { id: '2', name: 'Projects', path: '/path/to/projects' }
    ];

    mockOrganizeService = {
      organizeFiles: jest.fn().mockResolvedValue({
        organized: [{ file: { path: '/test.pdf' }, targetFolder: 'Documents' }],
        needsReview: [],
        failed: []
      }),
      batchOrganize: jest.fn().mockResolvedValue({
        operations: [{ source: '/test.pdf', target: '/documents/test.pdf' }],
        groups: [{ folder: 'Documents', files: 1 }]
      }),
      processNewFile: jest.fn().mockResolvedValue({
        moved: true,
        targetFolder: 'Documents'
      }),
      getStatistics: jest.fn().mockResolvedValue({
        userPatterns: 10,
        feedbackHistory: 5,
        folderUsageStats: [],
        thresholds: { autoApprove: 0.9 }
      }),
      updateThresholds: jest.fn(),
      suggestionService: {
        getClusterBatchSuggestions: jest.fn().mockResolvedValue({
          success: true,
          groups: [{ folder: 'Documents', files: 2 }],
          outliers: []
        }),
        identifyOutliers: jest.fn().mockResolvedValue({
          success: true,
          outliers: [{ path: '/weird.bin' }],
          wellClustered: [{ path: '/ok.pdf' }],
          outlierCount: 1,
          clusteredCount: 1
        }),
        getClusterBasedSuggestions: jest
          .fn()
          .mockResolvedValue([{ folderId: '1', clusterLabel: 'Docs', clusterSize: 10, score: 0.9 }])
      }
    };

    mockIpcMain = {
      handle: jest.fn((channel, handler) => {
        handlers[channel] = handler;
      })
    };

    fs = require('fs').promises;
    fs.stat.mockResolvedValue({ isFile: () => true });

    const module = require('../src/main/ipc/organize');
    registerOrganizeIpc = module.registerOrganizeIpc;
  });

  describe('registerOrganizeIpc', () => {
    test('registers all organize handlers', () => {
      registerOrganizeIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        getServiceIntegration: () => ({ autoOrganizeService: mockOrganizeService }),
        getCustomFolders: () => mockCustomFolders
      });

      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.ORGANIZE.AUTO,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.ORGANIZE.BATCH,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.ORGANIZE.PROCESS_NEW,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.ORGANIZE.GET_STATS,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.ORGANIZE.UPDATE_THRESHOLDS,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.ORGANIZE.CLUSTER_BATCH,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.ORGANIZE.IDENTIFY_OUTLIERS,
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        IPC_CHANNELS.ORGANIZE.GET_CLUSTER_SUGGESTIONS,
        expect.any(Function)
      );
    });
  });

  describe('Cluster-based handlers', () => {
    beforeEach(() => {
      registerOrganizeIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        getServiceIntegration: () => ({ autoOrganizeService: mockOrganizeService }),
        getCustomFolders: () => mockCustomFolders
      });
    });

    test('CLUSTER_BATCH returns error when suggestionService missing', async () => {
      mockOrganizeService.suggestionService = null;
      const handler = handlers[IPC_CHANNELS.ORGANIZE.CLUSTER_BATCH];
      const res = await handler(
        {},
        { files: [{ path: '/a.pdf' }], smartFolders: mockCustomFolders }
      );
      expect(res.success).toBe(false);
      expect(String(res.error)).toContain('Suggestion service');
    });

    test('CLUSTER_BATCH returns failed when all files invalid', async () => {
      fs.stat.mockRejectedValue({ code: 'ENOENT' });
      const handler = handlers[IPC_CHANNELS.ORGANIZE.CLUSTER_BATCH];
      const res = await handler(
        {},
        { files: [{ path: '/missing.pdf' }], smartFolders: mockCustomFolders }
      );
      expect(res.success).toBe(false);
      expect(res.groups).toEqual([]);
    });

    test('CLUSTER_BATCH uses suggestionService.getClusterBatchSuggestions', async () => {
      const handler = handlers[IPC_CHANNELS.ORGANIZE.CLUSTER_BATCH];
      const res = await handler(
        {},
        { files: [{ path: '/a.pdf' }], smartFolders: mockCustomFolders }
      );
      expect(res.success).toBe(true);
      expect(mockOrganizeService.suggestionService.getClusterBatchSuggestions).toHaveBeenCalled();
    });

    test('IDENTIFY_OUTLIERS uses suggestionService.identifyOutliers', async () => {
      const handler = handlers[IPC_CHANNELS.ORGANIZE.IDENTIFY_OUTLIERS];
      const res = await handler({}, { files: [{ path: '/a.pdf' }] });
      expect(res.success).toBe(true);
      expect(mockOrganizeService.suggestionService.identifyOutliers).toHaveBeenCalled();
    });

    test('GET_CLUSTER_SUGGESTIONS validates input and calls suggestionService', async () => {
      const handler = handlers[IPC_CHANNELS.ORGANIZE.GET_CLUSTER_SUGGESTIONS];

      const missing = await handler({}, { file: null });
      expect(missing.success).toBe(false);

      const ok = await handler({}, { file: { path: '/a.pdf' }, smartFolders: mockCustomFolders });
      expect(ok.success).toBe(true);
      expect(ok.clusterInfo).toMatchObject({ clusterLabel: 'Docs', clusterSize: 10 });
    });
  });

  describe('ORGANIZE.AUTO handler', () => {
    beforeEach(() => {
      registerOrganizeIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        getServiceIntegration: () => ({ autoOrganizeService: mockOrganizeService }),
        getCustomFolders: () => mockCustomFolders
      });
    });

    test('organizes valid files', async () => {
      const files = [
        { path: '/path/to/file1.pdf', name: 'file1.pdf' },
        { path: '/path/to/file2.docx', name: 'file2.docx' }
      ];

      const handler = handlers[IPC_CHANNELS.ORGANIZE.AUTO];
      const result = await handler({}, { files, smartFolders: mockCustomFolders });

      expect(mockOrganizeService.organizeFiles).toHaveBeenCalled();
      expect(result.organized).toBeDefined();
    });

    test('validates source files before processing', async () => {
      fs.stat.mockRejectedValueOnce({ code: 'ENOENT' });
      fs.stat.mockResolvedValueOnce({ isFile: () => true });

      const files = [
        { path: '/nonexistent.pdf', name: 'nonexistent.pdf' },
        { path: '/exists.pdf', name: 'exists.pdf' }
      ];

      const handler = handlers[IPC_CHANNELS.ORGANIZE.AUTO];
      await handler({}, { files, smartFolders: mockCustomFolders });

      // Should skip invalid file and process valid one
      expect(mockOrganizeService.organizeFiles).toHaveBeenCalled();
      const calledWith = mockOrganizeService.organizeFiles.mock.calls[0][0];
      expect(calledWith).toHaveLength(1);
    });

    test('returns error when all files are invalid', async () => {
      fs.stat.mockRejectedValue({ code: 'ENOENT' });

      const files = [
        { path: '/nonexistent1.pdf', name: 'nonexistent1.pdf' },
        { path: '/nonexistent2.pdf', name: 'nonexistent2.pdf' }
      ];

      const handler = handlers[IPC_CHANNELS.ORGANIZE.AUTO];
      const result = await handler({}, { files, smartFolders: mockCustomFolders });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No valid files');
      expect(mockOrganizeService.organizeFiles).not.toHaveBeenCalled();
    });

    test('adds extension to files missing it', async () => {
      const files = [
        { path: '/path/to/file.pdf', name: 'file.pdf' } // No extension property
      ];

      const handler = handlers[IPC_CHANNELS.ORGANIZE.AUTO];
      await handler({}, { files, smartFolders: mockCustomFolders });

      const calledWith = mockOrganizeService.organizeFiles.mock.calls[0][0];
      expect(calledWith[0].extension).toBe('.pdf');
    });

    test('uses provided smart folders', async () => {
      const customFolders = [{ id: 'custom', name: 'Custom' }];
      const files = [{ path: '/file.pdf', name: 'file.pdf' }];

      const handler = handlers[IPC_CHANNELS.ORGANIZE.AUTO];
      await handler({}, { files, smartFolders: customFolders });

      const calledFolders = mockOrganizeService.organizeFiles.mock.calls[0][1];
      expect(calledFolders).toEqual(customFolders);
    });

    test('falls back to default folders when none provided', async () => {
      const files = [{ path: '/file.pdf', name: 'file.pdf' }];

      const handler = handlers[IPC_CHANNELS.ORGANIZE.AUTO];
      await handler({}, { files });

      const calledFolders = mockOrganizeService.organizeFiles.mock.calls[0][1];
      expect(calledFolders).toEqual(mockCustomFolders);
    });

    test('returns fallback response when service unavailable', async () => {
      registerOrganizeIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        getServiceIntegration: () => null,
        getCustomFolders: () => mockCustomFolders
      });

      const handler = handlers[IPC_CHANNELS.ORGANIZE.AUTO];
      const result = await handler({}, { files: [], smartFolders: [] });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
    });
  });

  describe('ORGANIZE.BATCH handler', () => {
    beforeEach(() => {
      registerOrganizeIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        getServiceIntegration: () => ({ autoOrganizeService: mockOrganizeService }),
        getCustomFolders: () => mockCustomFolders
      });
    });

    test('performs batch organization', async () => {
      const files = [
        { path: '/file1.pdf', name: 'file1.pdf' },
        { path: '/file2.pdf', name: 'file2.pdf' }
      ];

      const handler = handlers[IPC_CHANNELS.ORGANIZE.BATCH];
      const result = await handler({}, { files, smartFolders: mockCustomFolders });

      expect(mockOrganizeService.batchOrganize).toHaveBeenCalled();
      expect(result.operations).toBeDefined();
      expect(result.groups).toBeDefined();
    });

    test('validates files before batch processing', async () => {
      fs.stat.mockRejectedValueOnce({ code: 'ENOENT' });
      fs.stat.mockResolvedValueOnce({ isFile: () => true });

      const files = [{ path: '/missing.pdf' }, { path: '/exists.pdf' }];

      const handler = handlers[IPC_CHANNELS.ORGANIZE.BATCH];
      await handler({}, { files, smartFolders: mockCustomFolders });

      const calledFiles = mockOrganizeService.batchOrganize.mock.calls[0][0];
      expect(calledFiles).toHaveLength(1);
    });

    test('returns error when all files invalid', async () => {
      fs.stat.mockRejectedValue({ code: 'ENOENT' });

      const files = [{ path: '/missing.pdf' }];

      const handler = handlers[IPC_CHANNELS.ORGANIZE.BATCH];
      const result = await handler({}, { files, smartFolders: mockCustomFolders });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No valid files');
    });
  });

  describe('ORGANIZE.PROCESS_NEW handler', () => {
    beforeEach(() => {
      registerOrganizeIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        getServiceIntegration: () => ({ autoOrganizeService: mockOrganizeService }),
        getCustomFolders: () => mockCustomFolders
      });
    });

    test('processes new file for auto-organize', async () => {
      const handler = handlers[IPC_CHANNELS.ORGANIZE.PROCESS_NEW];
      const result = await handler({}, { filePath: '/new/file.pdf' });

      expect(mockOrganizeService.processNewFile).toHaveBeenCalledWith(
        '/new/file.pdf',
        mockCustomFolders,
        {}
      );
      expect(result.moved).toBe(true);
    });

    test('passes options to service', async () => {
      const options = { autoApprove: true };

      const handler = handlers[IPC_CHANNELS.ORGANIZE.PROCESS_NEW];
      await handler({}, { filePath: '/file.pdf', options });

      const calledOptions = mockOrganizeService.processNewFile.mock.calls[0][2];
      expect(calledOptions).toEqual(options);
    });

    test('handles null result from service', async () => {
      mockOrganizeService.processNewFile.mockResolvedValue(null);

      const handler = handlers[IPC_CHANNELS.ORGANIZE.PROCESS_NEW];
      const result = await handler({}, { filePath: '/file.pdf' });

      expect(result).toBeNull();
    });
  });

  describe('ORGANIZE.GET_STATS handler', () => {
    beforeEach(() => {
      registerOrganizeIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        getServiceIntegration: () => ({ autoOrganizeService: mockOrganizeService }),
        getCustomFolders: () => mockCustomFolders
      });
    });

    test('returns organization statistics', async () => {
      const handler = handlers[IPC_CHANNELS.ORGANIZE.GET_STATS];
      const result = await handler({});

      expect(mockOrganizeService.getStatistics).toHaveBeenCalled();
      expect(result.userPatterns).toBe(10);
      expect(result.feedbackHistory).toBe(5);
    });

    test('returns defaults on service error', async () => {
      mockOrganizeService.getStatistics.mockRejectedValue(new Error('Service error'));

      const handler = handlers[IPC_CHANNELS.ORGANIZE.GET_STATS];
      const result = await handler({});

      expect(result.userPatterns).toBe(0);
      expect(result.feedbackHistory).toBe(0);
    });
  });

  describe('ORGANIZE.UPDATE_THRESHOLDS handler', () => {
    beforeEach(() => {
      registerOrganizeIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        getServiceIntegration: () => ({ autoOrganizeService: mockOrganizeService }),
        getCustomFolders: () => mockCustomFolders
      });
    });

    test('updates confidence thresholds', async () => {
      const thresholds = { autoApprove: 0.95 };

      const handler = handlers[IPC_CHANNELS.ORGANIZE.UPDATE_THRESHOLDS];
      const result = await handler({}, { thresholds });

      expect(mockOrganizeService.updateThresholds).toHaveBeenCalledWith(thresholds);
      expect(result.success).toBe(true);
      expect(result.thresholds).toEqual(thresholds);
    });

    test('handles update errors', async () => {
      mockOrganizeService.updateThresholds.mockImplementation(() => {
        throw new Error('Update failed');
      });

      const handler = handlers[IPC_CHANNELS.ORGANIZE.UPDATE_THRESHOLDS];
      const result = await handler({}, { thresholds: {} });

      expect(result.success).toBe(false);
    });
  });

  describe('source file validation', () => {
    beforeEach(() => {
      registerOrganizeIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        getServiceIntegration: () => ({ autoOrganizeService: mockOrganizeService }),
        getCustomFolders: () => mockCustomFolders
      });
    });

    test('rejects files that are not files', async () => {
      fs.stat.mockResolvedValue({ isFile: () => false });

      const files = [{ path: '/directory', name: 'directory' }];

      const handler = handlers[IPC_CHANNELS.ORGANIZE.AUTO];
      const result = await handler({}, { files, smartFolders: mockCustomFolders });

      expect(result.success).toBe(false);
    });

    test('handles files with source property instead of path', async () => {
      const files = [{ source: '/file.pdf', name: 'file.pdf' }];

      const handler = handlers[IPC_CHANNELS.ORGANIZE.AUTO];
      await handler({}, { files, smartFolders: mockCustomFolders });

      // Should use source property
      expect(fs.stat).toHaveBeenCalledWith('/file.pdf');
    });

    test('rejects files missing both path and source', async () => {
      const files = [{ name: 'file.pdf' }]; // No path or source

      const handler = handlers[IPC_CHANNELS.ORGANIZE.AUTO];
      const result = await handler({}, { files, smartFolders: mockCustomFolders });

      expect(result.success).toBe(false);
      expect(result.failed).toBeDefined();
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      registerOrganizeIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        getServiceIntegration: () => ({ autoOrganizeService: mockOrganizeService }),
        getCustomFolders: () => mockCustomFolders
      });
    });

    test('handles service errors in auto organize', async () => {
      mockOrganizeService.organizeFiles.mockRejectedValue(new Error('Service failed'));

      const files = [{ path: '/file.pdf', name: 'file.pdf' }];
      const handler = handlers[IPC_CHANNELS.ORGANIZE.AUTO];
      const result = await handler({}, { files, smartFolders: mockCustomFolders });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Service failed');
    });

    test('handles service errors in batch organize', async () => {
      mockOrganizeService.batchOrganize.mockRejectedValue(new Error('Batch failed'));

      const files = [{ path: '/file.pdf', name: 'file.pdf' }];
      const handler = handlers[IPC_CHANNELS.ORGANIZE.BATCH];
      const result = await handler({}, { files, smartFolders: mockCustomFolders });

      expect(result.success).toBe(false);
    });

    test('handles service errors in process new', async () => {
      mockOrganizeService.processNewFile.mockRejectedValue(new Error('Process failed'));

      const handler = handlers[IPC_CHANNELS.ORGANIZE.PROCESS_NEW];
      const result = await handler({}, { filePath: '/file.pdf' });

      expect(result.success).toBe(false);
    });
  });
});
