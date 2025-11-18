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
          model: 'nomic-embed-text',
        })),
        generateFolderId: jest.fn((f) => f.id || `folder-${f.name}`),
        upsertFolderEmbedding: jest.fn(async (f) => f),
        upsertFileEmbedding: jest.fn(async () => {}),
        initialize: jest.fn(),
      })),
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
      }),
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
        analysisHistory: { getRecentAnalysis: jest.fn(async () => []) },
      }),
      getCustomFolders: () => [
        { id: '1', name: 'Finance', description: 'Invoices' },
      ],
    });

    const handler = ipcMain._handlers.get(
      IPC_CHANNELS.EMBEDDINGS.REBUILD_FOLDERS,
    );
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
          model: 'nomic-embed-text',
        })),
        generateFolderId: jest.fn((f) => f.id || `folder-${f.name}`),
        upsertFolderEmbedding: jest.fn(async () => {}),
        upsertFileEmbedding: jest.fn(async (id, summary) => {
          inserted.push({ id, summary });
        }),
        initialize: jest.fn(),
      })),
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
      }),
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
            extractedText: 'numbers',
          },
        },
      ]),
    };

    registerAllIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      systemAnalytics: { collectMetrics: jest.fn(async () => ({})) },
      getServiceIntegration: () => ({ analysisHistory: mockHistory }),
      getCustomFolders: () => [
        { id: '1', name: 'Finance', description: 'Finance folder' },
      ],
    });

    const handler = ipcMain._handlers.get(
      IPC_CHANNELS.EMBEDDINGS.REBUILD_FILES,
    );
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
      }),
    }));
    const { registerAllIpc } = require('../src/main/ipc');
    const { IPC_CHANNELS } = require('../src/shared/constants');
    registerAllIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      systemAnalytics: { collectMetrics: jest.fn(async () => ({})) },
      getServiceIntegration: () => ({
        analysisHistory: { getRecentAnalysis: jest.fn(async () => []) },
      }),
      getCustomFolders: () => [],
    });

    const handler = ipcMain._handlers.get(IPC_CHANNELS.EMBEDDINGS.CLEAR_STORE);
    const result = await handler();
    expect(result.success).toBe(true);
    expect(resetAllCalls.length).toBe(1);
  });
});
