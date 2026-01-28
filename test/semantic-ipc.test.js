const { ipcMain } = require('./mocks/electron');

describe('Embeddings/Semantic IPC', () => {
  beforeEach(() => {
    ipcMain._handlers.clear();
    ipcMain.handle.mockClear();
    jest.resetModules();
  });

  test('returns unavailable when ChromaDB dependency is missing', async () => {
    jest.resetModules();
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };

    jest.doMock('../src/main/services/startup', () => ({
      getStartupManager: () => ({ chromadbDependencyMissing: true })
    }));

    // Minimal mocks for module initialization
    jest.doMock('../src/main/ollamaUtils', () => ({
      getOllama: jest.fn(() => ({
        list: jest.fn().mockResolvedValue({
          models: [{ name: 'embeddinggemma:latest' }]
        })
      })),
      getOllamaEmbeddingModel: jest.fn(() => 'embeddinggemma')
    }));

    jest.doMock('../src/main/services/FolderMatchingService', () => ({
      getInstance: () => ({
        initialize: jest.fn(),
        embedText: jest.fn(),
        generateFolderId: jest.fn()
      })
    }));

    jest.doMock('../src/main/services/ChromaDBService', () => ({
      getInstance: () => ({
        initialize: jest.fn(async () => {}),
        migrateFromJsonl: jest.fn(async () => 0),
        cleanup: jest.fn(async () => {}),
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
        isOnline: true,
        initialized: false,
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
      getCustomFolders: () => [{ id: '1', name: 'Finance', description: 'Invoices' }]
    });

    const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.REBUILD_FOLDERS);
    const result = await handler();

    expect(result.success).toBe(false);
    expect(result.unavailable).toBe(true);
    expect(result.pending).not.toBe(true);
  });

  test('retries initialization after failure cooldown', async () => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    let chromaMissing = true;

    jest.doMock('../src/main/services/startup', () => ({
      getStartupManager: () => ({ chromadbDependencyMissing: chromaMissing })
    }));

    jest.doMock('../src/main/ollamaUtils', () => ({
      getOllama: jest.fn(() => ({
        list: jest.fn().mockResolvedValue({
          models: [{ name: 'embeddinggemma:latest' }]
        })
      })),
      getOllamaEmbeddingModel: jest.fn(() => 'embeddinggemma')
    }));

    const mockChromaService = {
      initialize: jest.fn(async () => {}),
      migrateFromJsonl: jest.fn(async () => 0),
      cleanup: jest.fn(async () => {}),
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
      isOnline: true,
      initialized: false,
      isServiceAvailable: jest.fn(() => true),
      isServerAvailable: jest.fn(async () => true),
      getCircuitState: jest.fn(() => 'CLOSED'),
      getCircuitStats: jest.fn(() => ({})),
      getQueueStats: jest.fn(() => ({ queueSize: 0 })),
      offlineQueue: { size: () => 0 },
      serverUrl: 'http://localhost:8000',
      checkHealth: jest.fn().mockResolvedValue(true),
      forceRecovery: jest.fn(),
      getStats: jest.fn().mockResolvedValue({ files: 0, folders: 0 })
    };

    jest.doMock('../src/main/services/ChromaDBService', () => ({
      getInstance: () => mockChromaService
    }));

    jest.doMock('../src/main/services/FolderMatchingService', () => ({
      getInstance: () => ({
        initialize: jest.fn(),
        embedText: jest.fn(),
        generateFolderId: jest.fn()
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
      getCustomFolders: () => [{ id: '1', name: 'Finance', description: 'Invoices' }]
    });

    const statsHandler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.GET_STATS);

    const first = await statsHandler();
    expect(first.success).toBe(false);
    expect(first.unavailable).toBe(true);
    expect(mockChromaService.initialize).not.toHaveBeenCalled();

    jest.advanceTimersByTime(5000);
    const second = await statsHandler();
    expect(second.success).toBe(false);
    expect(second.unavailable).toBe(true);
    expect(mockChromaService.initialize).not.toHaveBeenCalled();

    chromaMissing = false;
    jest.advanceTimersByTime(10001);
    const third = await statsHandler();
    expect(third.success).toBe(true);
    expect(mockChromaService.initialize).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  test('REBUILD_FOLDERS calls embedding upsert for custom folders', async () => {
    jest.resetModules();
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    // IMPROVED BEHAVIOR: Now uses batch operations for better performance
    // Track batch upserts instead of individual upsertFolderEmbedding calls
    const batchUpserts = [];

    // FIX: Mock Ollama utilities for model verification
    jest.doMock('../src/main/ollamaUtils', () => ({
      getOllama: jest.fn(() => ({
        list: jest.fn().mockResolvedValue({
          models: [{ name: 'embeddinggemma:latest' }]
        })
      })),
      getOllamaEmbeddingModel: jest.fn(() => 'embeddinggemma')
    }));

    const mockFolderMatcher = {
      // New batch processing requires embedText method
      embedText: jest.fn(async (_text) => ({
        vector: [0.1, 0.2, 0.3],
        model: 'mxbai-embed-large'
      })),
      generateFolderId: jest.fn((f) => f.id || `folder-${f.name}`),
      upsertFolderEmbedding: jest.fn(async (f) => f),
      upsertFileEmbedding: jest.fn(async () => {}),
      initialize: jest.fn()
    };
    jest.doMock('../src/main/services/FolderMatchingService', () => ({
      getInstance: () => mockFolderMatcher
    }));
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
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    // IMPROVED BEHAVIOR: Now uses batch operations for better performance
    const inserted = [];
    const insertedChunks = [];

    // FIX: Mock Ollama utilities for model verification
    jest.doMock('../src/main/ollamaUtils', () => ({
      getOllama: jest.fn(() => ({
        list: jest.fn().mockResolvedValue({
          models: [{ name: 'embeddinggemma:latest' }]
        })
      })),
      getOllamaEmbeddingModel: jest.fn(() => 'embeddinggemma')
    }));

    // Chunk embeddings use ParallelEmbeddingService (not FolderMatchingService).
    jest.doMock('../src/main/services/ParallelEmbeddingService', () => ({
      getInstance: () => ({
        embedText: jest.fn(async () => ({ vector: [0.5, 0.25, 0.125], model: 'embeddinggemma' }))
      })
    }));

    const mockFolderMatcher = {
      // New batch processing requires embedText method
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
    };
    jest.doMock('../src/main/services/FolderMatchingService', () => ({
      getInstance: () => mockFolderMatcher
    }));
    jest.doMock('../src/main/services/ChromaDBService', () => ({
      getInstance: () => ({
        initialize: jest.fn(async () => {}),
        resetFolders: jest.fn(async () => {}),
        resetFiles: jest.fn(async () => {}),
        resetFileChunks: jest.fn(async () => {}),
        migrateFromJsonl: jest.fn(async () => 0),
        cleanup: jest.fn(async () => {}),
        resetAll: jest.fn(async () => {}),
        // IMPROVED: Batch operations for better performance
        batchUpsertFolders: jest.fn(async (payloads) => payloads.length),
        batchUpsertFiles: jest.fn(async (payloads) => {
          payloads.forEach((p) => inserted.push(p));
          return payloads.length;
        }),
        batchUpsertFileChunks: jest.fn(async (payloads) => {
          payloads.forEach((p) => insertedChunks.push(p));
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
            // MIN_TEXT_LENGTH is 200, so provide sufficient text for chunking
            extractedText:
              'This is a quarterly financial report containing important budget figures and revenue projections. ' +
              'The document includes detailed analysis of Q1 performance metrics across all business units. ' +
              'Revenue grew significantly compared to previous quarters due to strong market conditions.'
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
    const fs = require('fs');
    const accessSpy = jest.spyOn(fs.promises, 'access').mockResolvedValue();
    try {
      const result = await handler();
      // IMPROVED: Now validates batch file operations work correctly
      expect(result.success).toBe(true);
      expect(result.files).toBe(1);
      expect(inserted.length).toBe(1); // Only file entries tracked (folders processed separately)
      expect(result.fileChunks).toBeGreaterThan(0);
      expect(insertedChunks.length).toBeGreaterThan(0);
      expect(insertedChunks[0].id).toContain('chunk:');
      // The file entry should have the correct ID format
      expect(inserted[0].id).toContain('file:');
    } finally {
      accessSpy.mockRestore();
    }
  });

  test('CLEAR_STORE calls resetAll successfully', async () => {
    jest.resetModules();
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
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
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
      jest.doMock('../src/main/services/FolderMatchingService', () => ({
        getInstance: () => ({
          initialize: jest.fn(async () => {})
        })
      }));
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
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
      jest.doMock('../src/main/services/FolderMatchingService', () => ({
        getInstance: () => ({
          initialize: jest.fn(async () => {})
        })
      }));
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
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
      jest.doMock('../src/main/services/FolderMatchingService', () => ({
        getInstance: () => ({
          initialize: jest.fn(async () => {})
        })
      }));
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
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
      jest.doMock('../src/main/services/FolderMatchingService', () => ({
        getInstance: () => ({
          initialize: jest.fn(async () => {})
        })
      }));
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
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
      jest.doMock('../src/main/services/FolderMatchingService', () => ({
        getInstance: () => ({
          initialize: jest.fn(async () => {})
        })
      }));
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
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
      const resetFoldersCalls = [];
      const fsOperations = [];

      // FIX: Mock Ollama utilities for model verification
      jest.doMock('../src/main/ollamaUtils', () => ({
        getOllama: jest.fn(() => ({
          list: jest.fn().mockResolvedValue({
            models: [{ name: 'embeddinggemma:latest' }]
          })
        })),
        getOllamaEmbeddingModel: jest.fn(() => 'embeddinggemma')
      }));

      jest.doMock('../src/main/services/FolderMatchingService', () => ({
        getInstance: () => ({
          embedText: jest.fn(async () => ({
            vector: [0.1, 0.2, 0.3],
            model: 'mxbai-embed-large'
          })),
          generateFolderId: jest.fn((f) => f.id || `folder-${f.name}`),
          initialize: jest.fn()
        })
      }));

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
          return originalRename ? originalRename.apply(this, args) : undefined;
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

    test('REBUILD_FILES only resets collections (files + chunks), not DB directory operations', async () => {
      jest.resetModules();
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
      const resetFilesCalls = [];
      const fsOperations = [];

      // FIX: Mock Ollama utilities for model verification
      jest.doMock('../src/main/ollamaUtils', () => ({
        getOllama: jest.fn(() => ({
          list: jest.fn().mockResolvedValue({
            models: [{ name: 'embeddinggemma:latest' }]
          })
        })),
        getOllamaEmbeddingModel: jest.fn(() => 'embeddinggemma')
      }));

      jest.doMock('../src/main/services/FolderMatchingService', () => ({
        getInstance: () => ({
          embedText: jest.fn(async () => ({
            vector: [0.1, 0.2, 0.3],
            model: 'mxbai-embed-large'
          })),
          generateFolderId: jest.fn((f) => f.id || `folder-${f.name}`),
          initialize: jest.fn()
        })
      }));

      jest.doMock('../src/main/services/ChromaDBService', () => ({
        getInstance: () => ({
          initialize: jest.fn(async () => {}),
          resetFolders: jest.fn(async () => {}),
          resetFiles: jest.fn(async () => {
            resetFilesCalls.push('resetFiles');
          }),
          resetFileChunks: jest.fn(async () => {
            resetFilesCalls.push('resetFileChunks');
          }),
          batchUpsertFiles: jest.fn(async () => 1),
          batchUpsertFileChunks: jest.fn(async () => 1),
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
          return originalRename ? originalRename.apply(this, args) : undefined;
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
      const accessSpy = jest.spyOn(fs.promises, 'access').mockResolvedValue();
      try {
        const result = await handler();

        expect(result.success).toBe(true);
        expect(resetFilesCalls).toContain('resetFiles');
        expect(resetFilesCalls).toContain('resetFileChunks');
        // Should NOT perform any file system rename operations (DB directory reset)
        expect(fsOperations.filter((op) => op.op === 'rename')).toHaveLength(0);
      } finally {
        accessSpy.mockRestore();
      }
    }, 10000);
  });

  describe('SEARCH handler', () => {
    test('validates query and topK', async () => {
      jest.resetModules();
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };

      // Minimal mocks to allow semantic IPC registration
      jest.doMock('../src/main/services/FolderMatchingService', () => ({
        getInstance: () => ({ initialize: jest.fn(async () => {}) })
      }));
      jest.doMock('../src/main/services/ParallelEmbeddingService', () => ({
        getInstance: () => ({ embedText: jest.fn(async () => ({ vector: [1, 0] })) })
      }));
      jest.doMock('../src/main/services/chromadb', () => ({
        getInstance: () => ({
          initialize: jest.fn(async () => {}),
          isServerAvailable: jest.fn(async () => true),
          migrateFromJsonl: jest.fn(async () => 0),
          // Event emitter methods used by other handlers
          on: jest.fn(),
          off: jest.fn(),
          emit: jest.fn()
        })
      }));

      const hybridSearch = jest.fn().mockResolvedValue({
        success: true,
        results: [{ id: 'doc1', score: 0.9, metadata: { name: 'doc1' } }],
        mode: 'hybrid',
        meta: { vectorCount: 1, bm25Count: 1 }
      });
      jest.doMock('../src/main/services/SearchService', () => ({
        SearchService: jest.fn().mockImplementation(() => ({ hybridSearch }))
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

      const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.SEARCH);

      // Missing query
      expect(await handler({}, {})).toMatchObject({ success: false });

      // Invalid topK
      const badTopK = await handler({}, { query: 'ok', topK: 999999 });
      expect(badTopK.success).toBe(false);
      expect(String(badTopK.error)).toContain('topK');

      // Valid request calls SearchService.hybridSearch
      const ok = await handler({}, { query: 'quarterly', topK: 5, mode: 'hybrid', minScore: 0.5 });
      expect(ok.success).toBe(true);
      expect(ok.mode).toBe('hybrid');
      expect(hybridSearch).toHaveBeenCalledWith('quarterly', expect.objectContaining({ topK: 5 }));
    });
  });

  describe('SCORE_FILES handler', () => {
    test('returns validation errors for bad inputs', async () => {
      jest.resetModules();
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };

      const mockEmbedding = { embedText: jest.fn(async () => ({ vector: [1, 0] })) };
      const mockChroma = {
        initialize: jest.fn(async () => {}),
        isServerAvailable: jest.fn(async () => true),
        migrateFromJsonl: jest.fn(async () => 0),
        fileCollection: { get: jest.fn(async () => ({ ids: [], embeddings: [] })) },
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn()
      };

      jest.doMock('../src/main/services/FolderMatchingService', () => ({
        getInstance: () => ({ initialize: jest.fn(async () => {}) })
      }));
      jest.doMock('../src/main/services/ParallelEmbeddingService', () => ({
        getInstance: () => mockEmbedding
      }));
      jest.doMock('../src/main/services/chromadb', () => ({
        getInstance: () => mockChroma
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

      const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.SCORE_FILES);

      expect((await handler({}, {})).success).toBe(false);
      expect((await handler({}, { query: 'a', fileIds: ['x'] })).success).toBe(false);
      expect((await handler({}, { query: 'ok', fileIds: [] })).success).toBe(false);
    });

    test('scores ids using cosine similarity and sorts descending', async () => {
      jest.resetModules();
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };

      const mockEmbedding = { embedText: jest.fn(async () => ({ vector: [1, 0] })) };
      const mockChroma = {
        initialize: jest.fn(async () => {}),
        isServerAvailable: jest.fn(async () => true),
        migrateFromJsonl: jest.fn(async () => 0),
        getCollectionDimension: jest.fn(async () => 2),
        fileCollection: {
          get: jest.fn(async () => ({
            ids: ['a', 'b'],
            embeddings: [
              [1, 0],
              [0, 1]
            ]
          }))
        },
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn()
      };

      jest.doMock('../src/main/services/FolderMatchingService', () => ({
        getInstance: () => ({ initialize: jest.fn(async () => {}) })
      }));
      jest.doMock('../src/main/services/ParallelEmbeddingService', () => ({
        getInstance: () => mockEmbedding
      }));
      jest.doMock('../src/main/services/chromadb', () => ({
        getInstance: () => mockChroma
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

      const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.SCORE_FILES);
      const res = await handler({}, { query: 'ok', fileIds: ['a', 'b'] });

      expect(res.success).toBe(true);
      expect(res.scores).toHaveLength(2);
      expect(res.scores[0].id).toBe('a');
      expect(res.scores[0].score).toBeGreaterThan(res.scores[1].score);
    });
  });

  describe('FIND_SIMILAR handler', () => {
    test('returns error on invalid topK and succeeds on valid request', async () => {
      jest.resetModules();
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };

      const mockFolderMatcher = {
        initialize: jest.fn(async () => {}),
        findSimilarFiles: jest.fn(async () => [{ id: 'doc2', score: 0.9 }])
      };
      jest.doMock('../src/main/services/FolderMatchingService', () => ({
        getInstance: () => mockFolderMatcher
      }));
      jest.doMock('../src/main/services/ParallelEmbeddingService', () => ({
        getInstance: () => ({ embedText: jest.fn(async () => ({ vector: [1, 0] })) })
      }));
      jest.doMock('../src/main/services/chromadb', () => ({
        getInstance: () => ({
          initialize: jest.fn(async () => {}),
          isServerAvailable: jest.fn(async () => true),
          migrateFromJsonl: jest.fn(async () => 0),
          on: jest.fn(),
          off: jest.fn(),
          emit: jest.fn()
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

      const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.FIND_SIMILAR);

      const bad = await handler({}, { fileId: 'file:1', topK: 0 });
      expect(bad.success).toBe(false);

      const ok = await handler({}, { fileId: 'file:1', topK: 5 });
      expect(ok.success).toBe(true);
      expect(mockFolderMatcher.findSimilarFiles).toHaveBeenCalledWith('file:1', 5);
    });
  });

  describe('Additional semantic IPC handlers', () => {
    test('REBUILD_BM25_INDEX and GET_SEARCH_STATUS delegate to SearchService', async () => {
      jest.resetModules();
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };

      // Minimal service mocks for initialization
      jest.doMock('../src/main/services/FolderMatchingService', () => ({
        getInstance: () => ({ initialize: jest.fn(async () => {}) })
      }));
      jest.doMock('../src/main/services/ParallelEmbeddingService', () => ({
        getInstance: () => ({ embedText: jest.fn(async () => ({ vector: [1, 0] })) })
      }));
      jest.doMock('../src/main/services/chromadb', () => ({
        getInstance: () => ({
          initialize: jest.fn(async () => {}),
          isServerAvailable: jest.fn(async () => true),
          migrateFromJsonl: jest.fn(async () => 0),
          cleanup: jest.fn(async () => {}),
          on: jest.fn(),
          off: jest.fn(),
          emit: jest.fn(),
          isOnline: true,
          fileCollection: { get: jest.fn() }
        })
      }));

      const rebuildIndex = jest.fn(async () => ({ success: true, indexed: 1 }));
      const getIndexStatus = jest.fn(() => ({ hasIndex: true, documentCount: 1, isStale: false }));
      jest.doMock('../src/main/services/SearchService', () => ({
        SearchService: jest.fn().mockImplementation(() => ({ rebuildIndex, getIndexStatus }))
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
        getCustomFolders: () => []
      });

      const rebuildHandler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.REBUILD_BM25_INDEX);
      const statusHandler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.GET_SEARCH_STATUS);

      const rebuildRes = await rebuildHandler();
      expect(rebuildRes.success).toBe(true);
      expect(rebuildIndex).toHaveBeenCalled();

      const statusRes = await statusHandler();
      expect(statusRes.success).toBe(true);
      expect(getIndexStatus).toHaveBeenCalled();
    });

    test('multi-hop, clustering, metadata, and duplicates handlers validate inputs and call services', async () => {
      jest.resetModules();
      const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };

      const folderMatcher = {
        initialize: jest.fn(async () => {}),
        findMultiHopNeighbors: jest.fn(async () => [{ id: 'docA', score: 0.9 }])
      };
      jest.doMock('../src/main/services/FolderMatchingService', () => ({
        getInstance: () => folderMatcher
      }));

      jest.doMock('../src/main/services/ParallelEmbeddingService', () => ({
        getInstance: () => ({ embedText: jest.fn(async () => ({ vector: [1, 0] })) })
      }));

      const fileCollectionGet = jest.fn(async () => ({
        ids: ['file:1', 'file:2'],
        metadatas: [{ path: '/a' }, { path: '/b' }]
      }));
      const chromaDb = {
        initialize: jest.fn(async () => {}),
        isServerAvailable: jest.fn(async () => true),
        migrateFromJsonl: jest.fn(async () => 0),
        cleanup: jest.fn(async () => {}),
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
        isOnline: true,
        fileCollection: { get: fileCollectionGet }
      };
      jest.doMock('../src/main/services/chromadb', () => ({
        getInstance: () => chromaDb
      }));

      const clustering = {
        computeClusters: jest.fn(async () => ({ success: true, clusters: [{ id: 1 }] })),
        generateClusterLabels: jest.fn(async () => {}),
        getClustersForGraph: jest.fn(() => [{ id: 1, label: 'Cluster' }]),
        findCrossClusterEdges: jest.fn(() => [{ from: 1, to: 2 }]),
        isClustersStale: jest.fn(() => false),
        getClusterMembers: jest.fn(async () => [{ id: 'file:1' }]),
        findFileSimilarityEdges: jest.fn(async () => [
          { from: 'file:1', to: 'file:2', score: 0.9 }
        ]),
        findNearDuplicates: jest.fn(async () => ({ success: true, groups: [], totalDuplicates: 0 }))
      };
      jest.doMock('../src/main/services/ClusteringService', () => ({
        ClusteringService: jest.fn().mockImplementation(() => clustering)
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
        getCustomFolders: () => []
      });

      const multiHop = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.FIND_MULTI_HOP);
      const computeClusters = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.COMPUTE_CLUSTERS);
      const getClusters = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.GET_CLUSTERS);
      const getMembers = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.GET_CLUSTER_MEMBERS);
      const getEdges = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.GET_SIMILARITY_EDGES);
      const getMeta = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.GET_FILE_METADATA);
      const findDupes = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.FIND_DUPLICATES);

      expect((await multiHop({}, { seedIds: [] })).success).toBe(false);
      const mhOk = await multiHop({}, { seedIds: ['file:1'], options: { hops: 2 } });
      expect(mhOk.success).toBe(true);
      expect(folderMatcher.findMultiHopNeighbors).toHaveBeenCalled();

      const badK = await computeClusters({}, { k: 0 });
      expect(badK.success).toBe(false);
      const clOk = await computeClusters({}, { k: 'auto', generateLabels: true });
      expect(clOk.success).toBe(true);
      expect(clustering.generateClusterLabels).toHaveBeenCalled();

      const clGet = await getClusters();
      expect(clGet.success).toBe(true);
      expect(clustering.getClustersForGraph).toHaveBeenCalled();

      const memBad = await getMembers({}, { clusterId: 'x' });
      expect(memBad.success).toBe(false);
      const memOk = await getMembers({}, { clusterId: 1 });
      expect(memOk.success).toBe(true);

      const edgesBad = await getEdges(
        {},
        { fileIds: ['a', 'b'], threshold: 2, maxEdgesPerNode: 3 }
      );
      expect(edgesBad.success).toBe(false);
      const edgesEmpty = await getEdges({}, { fileIds: ['a'], threshold: 0.8, maxEdgesPerNode: 3 });
      expect(edgesEmpty.success).toBe(true);
      expect(edgesEmpty.edges).toEqual([]);

      const metaEmpty = await getMeta({}, { fileIds: [] });
      expect(metaEmpty.success).toBe(true);
      const metaOk = await getMeta({}, { fileIds: ['file:1', 'file:2'] });
      expect(metaOk.success).toBe(true);
      expect(metaOk.metadata['file:1']).toEqual({ path: '/a' });

      const dupBad = await findDupes({}, { threshold: 0.5 });
      expect(dupBad.success).toBe(false);
      const dupOk = await findDupes({}, { threshold: 0.9, maxResults: 10 });
      expect(dupOk.success).toBe(true);
      expect(clustering.findNearDuplicates).toHaveBeenCalled();
    });
  });
});
