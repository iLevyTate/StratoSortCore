// This test needs real filesystem operations for batch organize
jest.unmock('fs');
jest.unmock('fs/promises');

// Inline Electron mock to avoid recursion issues
const _ipcHandlers = new Map();
const mockIpcMain = {
  _handlers: _ipcHandlers,
  handle: jest.fn((channel, handler) => {
    _ipcHandlers.set(channel, handler);
  }),
  on: jest.fn(),
  removeHandler: jest.fn((channel) => {
    _ipcHandlers.delete(channel);
  }),
  removeAllListeners: jest.fn()
};

const mockApp = {
  getPath: jest.fn((name) => {
    const paths = {
      userData: '/mock/userData',
      appData: '/mock/appData',
      temp: '/mock/temp',
      home: '/mock/home',
      documents: '/mock/documents',
      downloads: '/mock/downloads'
    };
    return paths[name] || `/mock/${name}`;
  }),
  once: jest.fn()
};

const mockDialog = {
  showOpenDialog: jest.fn().mockResolvedValue({ canceled: false, filePaths: [] }),
  showSaveDialog: jest.fn().mockResolvedValue({ canceled: false, filePath: '' }),
  showMessageBox: jest.fn().mockResolvedValue({ response: 0 }),
  showErrorBox: jest.fn()
};

const mockShell = {
  openPath: jest.fn().mockResolvedValue(''),
  openExternal: jest.fn().mockResolvedValue(),
  showItemInFolder: jest.fn(),
  trashItem: jest.fn().mockResolvedValue()
};

jest.mock('electron', () => ({
  ipcMain: mockIpcMain,
  app: mockApp,
  dialog: mockDialog,
  shell: mockShell
}));

// Mock path validation to allow temp paths (hoisted)
jest.mock('../src/shared/pathSanitization', () => ({
  validateFileOperationPath: jest.fn().mockImplementation((filePath) =>
    Promise.resolve({
      valid: true,
      normalizedPath: filePath
    })
  ),
  normalizePathForIndex: jest.fn((filePath) => filePath)
}));

// Use the mocked versions for the test
const { ipcMain, dialog, shell } = require('electron');

// Mock ChromaDB services with full interface
const mockUpdateFilePaths = jest.fn().mockResolvedValue(0);
const mockEventListeners = new Map();
const mockChromaInstance = {
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
};

jest.mock('../src/main/services/ChromaDBService', () => ({
  getInstance: () => mockChromaInstance
}));

jest.mock('../src/main/services/chromadb', () => ({
  getInstance: () => mockChromaInstance
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
    const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
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
    let tmpBase;
    try {
      const osTmp = os.tmpdir();
      // mkdtemp() does not create parent directories.
      await fs.mkdir(osTmp, { recursive: true });
      tmpBase = await fs.mkdtemp(path.join(osTmp, 'batch-organize-'));
    } catch {
      // Fallback: use a repo-local temp directory (always exists / creatable in CI)
      const fallbackRoot = path.join(process.cwd(), 'tmpUserData', 'tmp');
      await fs.mkdir(fallbackRoot, { recursive: true });
      tmpBase = await fs.mkdtemp(path.join(fallbackRoot, 'batch-organize-'));
    }
    try {
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

      // Verify database update was called with both file: and image: prefixes
      expect(mockUpdateFilePaths).toHaveBeenCalled();
      const updateCalls = mockUpdateFilePaths.mock.calls[0][0];
      // Expect 4 entries: file: and image: prefix for each of the 2 files
      expect(updateCalls).toHaveLength(4);
      // Check file: prefixes are present for both source files
      const fileUpdates = updateCalls.filter((u) => u.oldId.startsWith('file:'));
      const imageUpdates = updateCalls.filter((u) => u.oldId.startsWith('image:'));
      expect(fileUpdates).toHaveLength(2);
      expect(imageUpdates).toHaveLength(2);
      // Parallel processing means order is not guaranteed - check both files exist
      expect(fileUpdates.some((u) => u.oldId.includes('src_A'))).toBe(true);
      expect(fileUpdates.some((u) => u.oldId.includes('src_B'))).toBe(true);
      expect(fileUpdates.some((u) => u.newId.includes('dest_A'))).toBe(true);
      expect(fileUpdates.some((u) => u.newId.includes('dest_B'))).toBe(true);
    } finally {
      if (tmpBase) await fs.rm(tmpBase, { recursive: true, force: true });
    }
  }, 60_000);
});
