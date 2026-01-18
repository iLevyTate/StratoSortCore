const { ipcMain, dialog, shell } = require('./mocks/electron');
const { registerAllIpc } = require('../src/main/ipc');

describe('IPC registration', () => {
  beforeEach(() => {
    ipcMain._handlers.clear();
    ipcMain.handle.mockClear();
  });

  test('registerAllIpc registers core channels', () => {
    const IPC_CHANNELS = require('../src/shared/constants').IPC_CHANNELS;
    registerAllIpc({
      ipcMain,
      IPC_CHANNELS,
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
      dialog,
      shell,
      systemAnalytics: { collectMetrics: jest.fn(async () => ({})) },
      getMainWindow: () => null,
      getServiceIntegration: () => ({
        undoRedo: {},
        analysisHistory: {},
        processingState: {}
      }),
      getCustomFolders: () => [],
      setCustomFolders: () => {},
      saveCustomFolders: async () => {},
      analyzeDocumentFile: async () => ({ success: true }),
      analyzeImageFile: async () => ({ success: true }),
      tesseract: { recognize: async () => 'text' },
      getOllama: () => ({ list: async () => ({ models: [] }) }),
      getOllamaModel: () => 'llama3.2:latest',
      getOllamaVisionModel: () => null,
      buildOllamaOptions: async () => ({}),
      scanDirectory: async () => []
    });

    // Channels that are events (main -> renderer via send) or use ipcMain.on() instead of handle()
    const eventOnlyChannels = [
      IPC_CHANNELS.UNDO_REDO.STATE_CHANGED,
      IPC_CHANNELS.SYSTEM.RENDERER_ERROR_REPORT // Uses ipcMain.on(), not handle()
    ];

    const expectedChannels = [
      // Files (all implemented)
      ...Object.values(IPC_CHANNELS.FILES),
      // Smart folders
      ...Object.values(IPC_CHANNELS.SMART_FOLDERS),
      // Undo/redo (excluding event-only channels)
      ...Object.values(IPC_CHANNELS.UNDO_REDO).filter((ch) => !eventOnlyChannels.includes(ch)),
      // Analysis
      ...Object.values(IPC_CHANNELS.ANALYSIS),
      // Settings
      ...Object.values(IPC_CHANNELS.SETTINGS),
      // System (excluding event-only channels)
      ...Object.values(IPC_CHANNELS.SYSTEM).filter((ch) => !eventOnlyChannels.includes(ch)),
      // Analysis history
      ...Object.values(IPC_CHANNELS.ANALYSIS_HISTORY),
      // Ollama
      ...Object.values(IPC_CHANNELS.OLLAMA)
    ];

    // Check that handlers are registered for expected channels
    const missing = expectedChannels.filter((ch) => !ipcMain._handlers.has(ch));
    expect(missing).toEqual([]);
  });
});
