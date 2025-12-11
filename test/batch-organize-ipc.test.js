// This test needs real filesystem operations for batch organize
jest.unmock('fs');
jest.unmock('fs/promises');

const { ipcMain, dialog, shell } = require('./mocks/electron');

// Mock ChromaDBService with full interface
const mockUpdateFilePaths = jest.fn().mockResolvedValue(0);
const mockEventListeners = new Map();
jest.mock('../src/main/services/ChromaDBService', () => ({
  getInstance: () => ({
    updateFilePaths: mockUpdateFilePaths,
    // Event emitter methods
    on: jest.fn((event, callback) => {
      if (!mockEventListeners.has(event)) {
        mockEventListeners.set(event, []);
      }
      mockEventListeners.get(event).push(callback);
    }),
    off: jest.fn(),
    emit: jest.fn(),
    // Status methods
    isOnline: true,
    initialized: true,
    isServiceAvailable: jest.fn(() => true),
    getCircuitState: jest.fn(() => 'CLOSED'),
    getCircuitStats: jest.fn(() => ({})),
    getQueueStats: jest.fn(() => ({ queueSize: 0 })),
    offlineQueue: { size: () => 0 },
    serverUrl: 'http://localhost:8000',
    checkHealth: jest.fn().mockResolvedValue(true),
    forceRecovery: jest.fn()
  })
}));

describe('Files IPC - batch organize', () => {
  beforeEach(() => {
    ipcMain._handlers.clear();
    ipcMain.handle.mockClear();
    mockUpdateFilePaths.mockClear();
  });

  function register() {
    const { IPC_CHANNELS, ACTION_TYPES } = require('../src/shared/constants');
    const registerAllIpc = require('../src/main/ipc').registerAllIpc;
    const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const getMainWindow = () => ({
      isDestroyed: () => false,
      webContents: { send: jest.fn() }
    });
    const serviceIntegration = {
      undoRedo: { recordAction: jest.fn(async () => {}) },
      processingState: {
        createOrLoadOrganizeBatch: jest.fn(async (_id, ops) => ({
          id: 'batch_test',
          operations: ops
        })),
        markOrganizeOpStarted: jest.fn(async () => {}),
        markOrganizeOpDone: jest.fn(async () => {}),
        markOrganizeOpError: jest.fn(async () => {}),
        completeOrganizeBatch: jest.fn(async () => {})
      }
    };

    registerAllIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      dialog,
      shell,
      systemAnalytics: { collectMetrics: jest.fn(async () => ({})) },
      getMainWindow,
      getServiceIntegration: () => serviceIntegration,
      getCustomFolders: () => [],
      setCustomFolders: () => {},
      saveCustomFolders: async () => {},
      analyzeDocumentFile: async () => ({ success: true }),
      analyzeImageFile: async () => ({ success: true }),
      tesseract: { recognize: async () => 'text' },
      getOllama: () => ({ list: async () => ({ models: [] }) }),
      getOllamaModel: () => 'llama3.2:latest',
      getOllamaVisionModel: () => null,
      buildOllamaOptions: async () => ({})
    });
    return { IPC_CHANNELS, ACTION_TYPES, serviceIntegration };
  }

  test('performs batch organize and records undo batch', async () => {
    // expect.assertions(5); // Removed explicit assertion count to avoid maintenance burden
    const { IPC_CHANNELS, serviceIntegration } = register();
    const handler = ipcMain._handlers.get(IPC_CHANNELS.FILES.PERFORM_OPERATION);

    const os = require('os');
    const path = require('path');
    const fs = require('fs').promises;
    // Ensure a real temp directory exists (Windows runners can have non-existent tmp paths)
    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-organize-'));
    const sourceA = path.join(tmpBase, `src_A_${Date.now()}.txt`);
    const destA = path.join(tmpBase, `dest_A_${Date.now()}.txt`);
    const sourceB = path.join(tmpBase, `src_B_${Date.now()}.txt`);
    const destB = path.join(tmpBase, `dest_B_${Date.now()}.txt`);
    await fs.writeFile(sourceA, 'A');
    await fs.writeFile(sourceB, 'B');

    const { success, results, successCount, failCount } = await handler(null, {
      type: 'batch_organize',
      operations: [
        { source: sourceA, destination: destA },
        { source: sourceB, destination: destB }
      ]
    });

    expect(success).toBe(true);
    expect(successCount).toBe(2);
    expect(failCount).toBe(0);
    expect(Array.isArray(results)).toBe(true);
    expect(serviceIntegration.processingState.completeOrganizeBatch).toHaveBeenCalled();

    // Verify database update was called
    expect(mockUpdateFilePaths).toHaveBeenCalled();
    const updateCalls = mockUpdateFilePaths.mock.calls[0][0];
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0].oldId).toContain('src_A');
    expect(updateCalls[0].newId).toContain('dest_A');
  });
});
