const { ipcMain } = require('./mocks/electron');

describe('Embeddings/Semantic IPC', () => {
  beforeEach(() => {
    ipcMain._handlers.clear();
    ipcMain.handle.mockClear();
    jest.resetModules();
  });

  test('REBUILD_FOLDERS calls embedding upsert for custom folders', async () => {
    jest.resetModules();
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
    // IMPROVED BEHAVIOR: Now uses batch operations for better performance
    // Track batch upserts instead of individual upsertFolderEmbedding calls
    const batchUpserts = [];
    jest.doMock('../src/main/services/FolderMatchingService', () =>
      jest.fn().mockImplementation(() => ({
        // New batch processing requires embedText method
        // eslint-disable-next-line no-unused-vars
        embedText: jest.fn(async (_text) => ({
          vector: [0.1, 0.2, 0.3],
          model: 'mxbai-embed-large'
        })),
        generateFolderId: jest.fn((f) => f.id || `folder-${f.name}`),
        upsertFolderEmbedding: jest.fn(async (f) => f),
        upsertFileEmbedding: jest.fn(async () => {}),
        initialize: jest.fn()
      }))
    );
    jest.doMock('../src/main/services/ChromaDBService', () => ({
      getInstance: () => ({
        initialize: jest.fn(async () => {}),
        resetFolders: jest.fn(async () => {}),
        resetFiles: jest.fn(async () => {}),
        migrateFromJsonl: jest.fn(async () => 0),
        cleanup: jest.fn(async () => {}),
        resetAll: jest.fn(async () => {}),
        // IMPROVED: Batch operations for better performance
        batchUpsertFolders: jest.fn(async (payloads) => {
          batchUpserts.push(...payloads);
          return payloads.length;
        }),
        // Event emitter methods required for chromadb IPC
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
        isOnline: true,
        initialized: true,
        isServiceAvailable: jest.fn(() => true),
        isServerAvailable: jest.fn(async () => true),
        getCircuitState: jest.fn(() => 'CLOSED'),
        getCircuitStats: jest.fn(() => ({})),
        getQueueStats: jest.fn(() => ({ queueSize: 0 })),
        offlineQueue: { size: () => 0 },
        serverUrl: 'http://localhost:8000',
        checkHealth: jest.fn().mockResolvedValue(true),
        forceRecovery: jest.fn()
      })
    }));
    const { registerAllIpc } = require('../src/main/ipc');
    const { IPC_CHANNELS } = require('../src/shared/constants');
    const electron = require('./mocks/electron');
    electron.app.getPath.mockReturnValue(require('os').tmpdir());

    registerAllIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      systemAnalytics: { collectMetrics: jest.fn(async () => ({})) },
      getServiceIntegration: () => ({
        analysisHistory: { getRecentAnalysis: jest.fn(async () => []) }
      }),
      getCustomFolders: () => [{ id: '1', name: 'Finance', description: 'Invoices' }]
    });

    const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.REBUILD_FOLDERS);
    const result = await handler();

    // IMPROVED: Now validates batch operations instead of individual calls
    expect(result).toMatchObject({ success: true, folders: 1 });
    expect(batchUpserts.length).toBe(1);
    expect(batchUpserts[0].name).toBe('Finance');
  });

  test('REBUILD_FILES rebuilds vectors from analysis history', async () => {
    jest.resetModules();
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
    // IMPROVED BEHAVIOR: Now uses batch operations for better performance
    const inserted = [];
    jest.doMock('../src/main/services/FolderMatchingService', () =>
      jest.fn().mockImplementation(() => ({
        // New batch processing requires embedText method
        // eslint-disable-next-line no-unused-vars
        embedText: jest.fn(async (_text) => ({
          vector: [0.1, 0.2, 0.3],
          model: 'mxbai-embed-large'
        })),
        generateFolderId: jest.fn((f) => f.id || `folder-${f.name}`),
        upsertFolderEmbedding: jest.fn(async () => {}),
        upsertFileEmbedding: jest.fn(async (id, summary) => {
          inserted.push({ id, summary });
        }),
        initialize: jest.fn()
      }))
    );
    jest.doMock('../src/main/services/ChromaDBService', () => ({
      getInstance: () => ({
        initialize: jest.fn(async () => {}),
        resetFolders: jest.fn(async () => {}),
        resetFiles: jest.fn(async () => {}),
        migrateFromJsonl: jest.fn(async () => 0),
        cleanup: jest.fn(async () => {}),
        resetAll: jest.fn(async () => {}),
        // IMPROVED: Batch operations for better performance
        batchUpsertFolders: jest.fn(async (payloads) => payloads.length),
        batchUpsertFiles: jest.fn(async (payloads) => {
          payloads.forEach((p) => inserted.push(p));
          return payloads.length;
        }),
        // Event emitter methods required for chromadb IPC
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
        isOnline: true,
        initialized: true,
        isServiceAvailable: jest.fn(() => true),
        isServerAvailable: jest.fn(async () => true),
        getCircuitState: jest.fn(() => 'CLOSED'),
        getCircuitStats: jest.fn(() => ({})),
        getQueueStats: jest.fn(() => ({ queueSize: 0 })),
        offlineQueue: { size: () => 0 },
        serverUrl: 'http://localhost:8000',
        checkHealth: jest.fn().mockResolvedValue(true),
        forceRecovery: jest.fn()
      })
    }));
    const { registerAllIpc } = require('../src/main/ipc');
    const { IPC_CHANNELS } = require('../src/shared/constants');
    const mockHistory = {
      getRecentAnalysis: jest.fn(async () => [
        {
          originalPath: 'C:/docs/report.pdf',
          analysis: {
            subject: 'Q1',
            summary: 'Quarterly report',
            tags: ['finance'],
            extractedText: 'numbers'
          }
        }
      ])
    };

    registerAllIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      systemAnalytics: { collectMetrics: jest.fn(async () => ({})) },
      getServiceIntegration: () => ({ analysisHistory: mockHistory }),
      getCustomFolders: () => [{ id: '1', name: 'Finance', description: 'Finance folder' }]
    });

    const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.REBUILD_FILES);
    const result = await handler();
    // IMPROVED: Now validates batch file operations work correctly
    expect(result.success).toBe(true);
    expect(result.files).toBe(1);
    expect(inserted.length).toBe(1); // Only file entries tracked (folders processed separately)
    // The file entry should have the correct ID format
    expect(inserted[0].id).toContain('file:');
  });

  test('CLEAR_STORE calls resetAll successfully', async () => {
    jest.resetModules();
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
    // Mock ChromaDBService to ensure resetAll is called
    const resetAllCalls = [];
    jest.doMock('../src/main/services/ChromaDBService', () => ({
      getInstance: () => ({
        initialize: jest.fn(async () => {}),
        resetAll: jest.fn(async () => {
          resetAllCalls.push(1);
        }),
        migrateFromJsonl: jest.fn(async () => 0),
        cleanup: jest.fn(async () => {}),
        // Event emitter methods required for chromadb IPC
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
        isOnline: true,
        initialized: true,
        isServiceAvailable: jest.fn(() => true),
        isServerAvailable: jest.fn(async () => true),
        getCircuitState: jest.fn(() => 'CLOSED'),
        getCircuitStats: jest.fn(() => ({})),
        getQueueStats: jest.fn(() => ({ queueSize: 0 })),
        offlineQueue: { size: () => 0 },
        serverUrl: 'http://localhost:8000',
        checkHealth: jest.fn().mockResolvedValue(true),
        forceRecovery: jest.fn()
      })
    }));
    const { registerAllIpc } = require('../src/main/ipc');
    const { IPC_CHANNELS } = require('../src/shared/constants');
    registerAllIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      systemAnalytics: { collectMetrics: jest.fn(async () => ({})) },
      getServiceIntegration: () => ({
        analysisHistory: { getRecentAnalysis: jest.fn(async () => []) }
      }),
      getCustomFolders: () => []
    });

    const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.CLEAR_STORE);
    const result = await handler();
    expect(result.success).toBe(true);
    expect(resetAllCalls.length).toBe(1);
  });

  describe('GET_STATS handler', () => {
    test('returns stats with needsFileEmbeddingRebuild flag when files=0 and history>0', async () => {
      jest.resetModules();
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
      jest.doMock('../src/main/services/FolderMatchingService', () =>
        jest.fn().mockImplementation(() => ({
          initialize: jest.fn(async () => {})
        }))
      );
      jest.doMock('../src/main/services/ChromaDBService', () => ({
        getInstance: () => ({
          initialize: jest.fn(async () => {}),
          getStats: jest.fn(async () => ({
            files: 0,
            folders: 5,
            dbPath: '/mock/path',
            serverUrl: 'http://localhost:8000',
            initialized: true,
            queryCache: { hits: 0, misses: 0 }
          })),
          migrateFromJsonl: jest.fn(async () => 0),
          // Event emitter methods required for chromadb IPC
          on: jest.fn(),
          off: jest.fn(),
          emit: jest.fn(),
          isOnline: true,
          initialized: true,
          isServiceAvailable: jest.fn(() => true),
          isServerAvailable: jest.fn(async () => true),
          getCircuitState: jest.fn(() => 'CLOSED'),
          getCircuitStats: jest.fn(() => ({})),
          getQueueStats: jest.fn(() => ({ queueSize: 0 })),
          offlineQueue: { size: () => 0 },
          serverUrl: 'http://localhost:8000',
          checkHealth: jest.fn().mockResolvedValue(true),
          forceRecovery: jest.fn()
        })
      }));
      const { registerAllIpc } = require('../src/main/ipc');
      const { IPC_CHANNELS } = require('../src/shared/constants');
      const electron = require('./mocks/electron');
      electron.app.getPath.mockReturnValue(require('os').tmpdir());

      const mockHistory = {
        getQuickStats: jest.fn(async () => ({
          totalFiles: 10
        }))
      };

      registerAllIpc({
        ipcMain,
        IPC_CHANNELS,
        logger,
        systemAnalytics: { collectMetrics: jest.fn(async () => ({})) },
        getServiceIntegration: () => ({ analysisHistory: mockHistory }),
        getCustomFolders: () => []
      });

      // Wait for background initialization to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.GET_STATS);
      const result = await handler();

      expect(result.success).toBe(true);
      expect(result.files).toBe(0);
      expect(result.analysisHistory).toEqual({ totalFiles: 10 });
      expect(result.needsFileEmbeddingRebuild).toBe(true);
    }, 10000);

    test('returns needsFileEmbeddingRebuild=false when files exist', async () => {
      jest.resetModules();
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
      jest.doMock('../src/main/services/FolderMatchingService', () =>
        jest.fn().mockImplementation(() => ({
          initialize: jest.fn(async () => {})
        }))
      );
      jest.doMock('../src/main/services/ChromaDBService', () => ({
        getInstance: () => ({
          initialize: jest.fn(async () => {}),
          getStats: jest.fn(async () => ({
            files: 5,
            folders: 3,
            dbPath: '/mock/path',
            serverUrl: 'http://localhost:8000',
            initialized: true,
            queryCache: { hits: 0, misses: 0 }
          })),
          migrateFromJsonl: jest.fn(async () => 0),
          // Event emitter methods required for chromadb IPC
          on: jest.fn(),
          off: jest.fn(),
          emit: jest.fn(),
          isOnline: true,
          initialized: true,
          isServiceAvailable: jest.fn(() => true),
          isServerAvailable: jest.fn(async () => true),
          getCircuitState: jest.fn(() => 'CLOSED'),
          getCircuitStats: jest.fn(() => ({})),
          getQueueStats: jest.fn(() => ({ queueSize: 0 })),
          offlineQueue: { size: () => 0 },
          serverUrl: 'http://localhost:8000',
          checkHealth: jest.fn().mockResolvedValue(true),
          forceRecovery: jest.fn()
        })
      }));
      const { registerAllIpc } = require('../src/main/ipc');
      const { IPC_CHANNELS } = require('../src/shared/constants');
      const electron = require('./mocks/electron');
      electron.app.getPath.mockReturnValue(require('os').tmpdir());

      const mockHistory = {
        getQuickStats: jest.fn(async () => ({
          totalFiles: 10
        }))
      };

      registerAllIpc({
        ipcMain,
        IPC_CHANNELS,
        logger,
        systemAnalytics: { collectMetrics: jest.fn(async () => ({})) },
        getServiceIntegration: () => ({ analysisHistory: mockHistory }),
        getCustomFolders: () => []
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.GET_STATS);
      const result = await handler();

      expect(result.success).toBe(true);
      expect(result.files).toBe(5);
      expect(result.needsFileEmbeddingRebuild).toBe(false);
    }, 10000);

    test('returns needsFileEmbeddingRebuild=false when no analysis history', async () => {
      jest.resetModules();
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
      jest.doMock('../src/main/services/FolderMatchingService', () =>
        jest.fn().mockImplementation(() => ({
          initialize: jest.fn(async () => {})
        }))
      );
      jest.doMock('../src/main/services/ChromaDBService', () => ({
        getInstance: () => ({
          initialize: jest.fn(async () => {}),
          getStats: jest.fn(async () => ({
            files: 0,
            folders: 0,
            dbPath: '/mock/path',
            serverUrl: 'http://localhost:8000',
            initialized: true,
            queryCache: { hits: 0, misses: 0 }
          })),
          migrateFromJsonl: jest.fn(async () => 0),
          // Event emitter methods required for chromadb IPC
          on: jest.fn(),
          off: jest.fn(),
          emit: jest.fn(),
          isOnline: true,
          initialized: true,
          isServiceAvailable: jest.fn(() => true),
          isServerAvailable: jest.fn(async () => true),
          getCircuitState: jest.fn(() => 'CLOSED'),
          getCircuitStats: jest.fn(() => ({})),
          getQueueStats: jest.fn(() => ({ queueSize: 0 })),
          offlineQueue: { size: () => 0 },
          serverUrl: 'http://localhost:8000',
          checkHealth: jest.fn().mockResolvedValue(true),
          forceRecovery: jest.fn()
        })
      }));
      const { registerAllIpc } = require('../src/main/ipc');
      const { IPC_CHANNELS } = require('../src/shared/constants');
      const electron = require('./mocks/electron');
      electron.app.getPath.mockReturnValue(require('os').tmpdir());

      registerAllIpc({
        ipcMain,
        IPC_CHANNELS,
        logger,
        systemAnalytics: { collectMetrics: jest.fn(async () => ({})) },
        getServiceIntegration: () => ({ analysisHistory: null }),
        getCustomFolders: () => []
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.GET_STATS);
      const result = await handler();

      expect(result.success).toBe(true);
      expect(result.files).toBe(0);
      expect(result.needsFileEmbeddingRebuild).toBe(false);
    }, 10000);

    test('handles analysisHistory.getStatistics fallback', async () => {
      jest.resetModules();
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
      jest.doMock('../src/main/services/FolderMatchingService', () =>
        jest.fn().mockImplementation(() => ({
          initialize: jest.fn(async () => {})
        }))
      );
      jest.doMock('../src/main/services/ChromaDBService', () => ({
        getInstance: () => ({
          initialize: jest.fn(async () => {}),
          getStats: jest.fn(async () => ({
            files: 0,
            folders: 0,
            dbPath: '/mock/path',
            serverUrl: 'http://localhost:8000',
            initialized: true,
            queryCache: { hits: 0, misses: 0 }
          })),
          migrateFromJsonl: jest.fn(async () => 0),
          // Event emitter methods required for chromadb IPC
          on: jest.fn(),
          off: jest.fn(),
          emit: jest.fn(),
          isOnline: true,
          initialized: true,
          isServiceAvailable: jest.fn(() => true),
          isServerAvailable: jest.fn(async () => true),
          getCircuitState: jest.fn(() => 'CLOSED'),
          getCircuitStats: jest.fn(() => ({})),
          getQueueStats: jest.fn(() => ({ queueSize: 0 })),
          offlineQueue: { size: () => 0 },
          serverUrl: 'http://localhost:8000',
          checkHealth: jest.fn().mockResolvedValue(true),
          forceRecovery: jest.fn()
        })
      }));
      const { registerAllIpc } = require('../src/main/ipc');
      const { IPC_CHANNELS } = require('../src/shared/constants');
      const electron = require('./mocks/electron');
      electron.app.getPath.mockReturnValue(require('os').tmpdir());

      const mockHistory = {
        getStatistics: jest.fn(async () => ({
          totalFiles: 8
        }))
        // Note: no getQuickStats method
      };

      registerAllIpc({
        ipcMain,
        IPC_CHANNELS,
        logger,
        systemAnalytics: { collectMetrics: jest.fn(async () => ({})) },
        getServiceIntegration: () => ({ analysisHistory: mockHistory }),
        getCustomFolders: () => []
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.GET_STATS);
      const result = await handler();

      expect(result.success).toBe(true);
      expect(result.analysisHistory).toEqual({ totalFiles: 8 });
      expect(result.needsFileEmbeddingRebuild).toBe(true);
    }, 10000);

    test('handles analysisHistory errors gracefully', async () => {
      jest.resetModules();
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
      jest.doMock('../src/main/services/FolderMatchingService', () =>
        jest.fn().mockImplementation(() => ({
          initialize: jest.fn(async () => {})
        }))
      );
      jest.doMock('../src/main/services/ChromaDBService', () => ({
        getInstance: () => ({
          initialize: jest.fn(async () => {}),
          getStats: jest.fn(async () => ({
            files: 0,
            folders: 0,
            dbPath: '/mock/path',
            serverUrl: 'http://localhost:8000',
            initialized: true,
            queryCache: { hits: 0, misses: 0 }
          })),
          migrateFromJsonl: jest.fn(async () => 0),
          // Event emitter methods required for chromadb IPC
          on: jest.fn(),
          off: jest.fn(),
          emit: jest.fn(),
          isOnline: true,
          initialized: true,
          isServiceAvailable: jest.fn(() => true),
          isServerAvailable: jest.fn(async () => true),
          getCircuitState: jest.fn(() => 'CLOSED'),
          getCircuitStats: jest.fn(() => ({})),
          getQueueStats: jest.fn(() => ({ queueSize: 0 })),
          offlineQueue: { size: () => 0 },
          serverUrl: 'http://localhost:8000',
          checkHealth: jest.fn().mockResolvedValue(true),
          forceRecovery: jest.fn()
        })
      }));
      const { registerAllIpc } = require('../src/main/ipc');
      const { IPC_CHANNELS } = require('../src/shared/constants');
      const electron = require('./mocks/electron');
      electron.app.getPath.mockReturnValue(require('os').tmpdir());

      const mockHistory = {
        getQuickStats: jest.fn(async () => {
          throw new Error('History service error');
        })
      };

      registerAllIpc({
        ipcMain,
        IPC_CHANNELS,
        logger,
        systemAnalytics: { collectMetrics: jest.fn(async () => ({})) },
        getServiceIntegration: () => ({ analysisHistory: mockHistory }),
        getCustomFolders: () => []
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.GET_STATS);
      const result = await handler();

      // Should still return stats even if history fails
      expect(result.success).toBe(true);
      expect(result.files).toBe(0);
      expect(result.needsFileEmbeddingRebuild).toBe(false); // No history, so no rebuild needed
    }, 10000);
  });

  describe('REBUILD_FOLDERS and REBUILD_FILES safety', () => {
    test('REBUILD_FOLDERS only calls resetFolders (collection reset), not DB directory operations', async () => {
      jest.resetModules();
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
      const resetFoldersCalls = [];
      const fsOperations = [];

      jest.doMock('../src/main/services/FolderMatchingService', () =>
        jest.fn().mockImplementation(() => ({
          embedText: jest.fn(async () => ({
            vector: [0.1, 0.2, 0.3],
            model: 'mxbai-embed-large'
          })),
          generateFolderId: jest.fn((f) => f.id || `folder-${f.name}`),
          initialize: jest.fn()
        }))
      );

      jest.doMock('../src/main/services/ChromaDBService', () => ({
        getInstance: () => ({
          initialize: jest.fn(async () => {}),
          resetFolders: jest.fn(async () => {
            resetFoldersCalls.push('resetFolders');
          }),
          resetFiles: jest.fn(async () => {}),
          batchUpsertFolders: jest.fn(async () => 1),
          migrateFromJsonl: jest.fn(async () => 0),
          // Event emitter methods required for chromadb IPC
          on: jest.fn(),
          off: jest.fn(),
          emit: jest.fn(),
          isOnline: true,
          initialized: true,
          isServiceAvailable: jest.fn(() => true),
          isServerAvailable: jest.fn(async () => true),
          getCircuitState: jest.fn(() => 'CLOSED'),
          getCircuitStats: jest.fn(() => ({})),
          getQueueStats: jest.fn(() => ({ queueSize: 0 })),
          offlineQueue: { size: () => 0 },
          serverUrl: 'http://localhost:8000',
          checkHealth: jest.fn().mockResolvedValue(true),
          forceRecovery: jest.fn()
        })
      }));

      // Mock fs to track any file system operations
      const fs = require('fs');
      const originalRename = fs.promises?.rename;
      if (fs.promises) {
        fs.promises.rename = jest.fn(async (...args) => {
          fsOperations.push({ op: 'rename', args });
          if (originalRename) return originalRename.apply(this, args);
        });
      }

      const { registerAllIpc } = require('../src/main/ipc');
      const { IPC_CHANNELS } = require('../src/shared/constants');
      const electron = require('./mocks/electron');
      electron.app.getPath.mockReturnValue(require('os').tmpdir());

      registerAllIpc({
        ipcMain,
        IPC_CHANNELS,
        logger,
        systemAnalytics: { collectMetrics: jest.fn(async () => ({})) },
        getServiceIntegration: () => ({
          analysisHistory: { getRecentAnalysis: jest.fn(async () => []) }
        }),
        getCustomFolders: () => [{ id: '1', name: 'Finance', description: 'Invoices' }]
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.REBUILD_FOLDERS);
      const result = await handler();

      expect(result.success).toBe(true);
      expect(resetFoldersCalls).toContain('resetFolders');
      // Should NOT perform any file system rename operations (DB directory reset)
      expect(fsOperations.filter((op) => op.op === 'rename')).toHaveLength(0);
    }, 10000);

    test('REBUILD_FILES only calls resetFiles (collection reset), not DB directory operations', async () => {
      jest.resetModules();
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
      const resetFilesCalls = [];
      const fsOperations = [];

      jest.doMock('../src/main/services/FolderMatchingService', () =>
        jest.fn().mockImplementation(() => ({
          embedText: jest.fn(async () => ({
            vector: [0.1, 0.2, 0.3],
            model: 'mxbai-embed-large'
          })),
          generateFolderId: jest.fn((f) => f.id || `folder-${f.name}`),
          initialize: jest.fn()
        }))
      );

      jest.doMock('../src/main/services/ChromaDBService', () => ({
        getInstance: () => ({
          initialize: jest.fn(async () => {}),
          resetFolders: jest.fn(async () => {}),
          resetFiles: jest.fn(async () => {
            resetFilesCalls.push('resetFiles');
          }),
          batchUpsertFiles: jest.fn(async () => 1),
          migrateFromJsonl: jest.fn(async () => 0),
          // Event emitter methods required for chromadb IPC
          on: jest.fn(),
          off: jest.fn(),
          emit: jest.fn(),
          isOnline: true,
          initialized: true,
          isServiceAvailable: jest.fn(() => true),
          isServerAvailable: jest.fn(async () => true),
          getCircuitState: jest.fn(() => 'CLOSED'),
          getCircuitStats: jest.fn(() => ({})),
          getQueueStats: jest.fn(() => ({ queueSize: 0 })),
          offlineQueue: { size: () => 0 },
          serverUrl: 'http://localhost:8000',
          checkHealth: jest.fn().mockResolvedValue(true),
          forceRecovery: jest.fn()
        })
      }));

      // Mock fs to track any file system operations
      const fs = require('fs');
      const originalRename = fs.promises?.rename;
      if (fs.promises) {
        fs.promises.rename = jest.fn(async (...args) => {
          fsOperations.push({ op: 'rename', args });
          if (originalRename) return originalRename.apply(this, args);
        });
      }

      const { registerAllIpc } = require('../src/main/ipc');
      const { IPC_CHANNELS } = require('../src/shared/constants');
      const electron = require('./mocks/electron');
      electron.app.getPath.mockReturnValue(require('os').tmpdir());
      const mockHistory = {
        getRecentAnalysis: jest.fn(async () => [
          {
            originalPath: 'C:/docs/report.pdf',
            analysis: {
              subject: 'Q1',
              summary: 'Quarterly report',
              tags: ['finance'],
              extractedText: 'numbers'
            }
          }
        ])
      };

      registerAllIpc({
        ipcMain,
        IPC_CHANNELS,
        logger,
        systemAnalytics: { collectMetrics: jest.fn(async () => ({})) },
        getServiceIntegration: () => ({ analysisHistory: mockHistory }),
        getCustomFolders: () => []
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.REBUILD_FILES);
      const result = await handler();

      expect(result.success).toBe(true);
      expect(resetFilesCalls).toContain('resetFiles');
      // Should NOT perform any file system rename operations (DB directory reset)
      expect(fsOperations.filter((op) => op.op === 'rename')).toHaveLength(0);
    }, 10000);
  });
});
