/**
 * Tests for Dependencies IPC Handlers
 * Tests install/update operations exposed via IPC
 */

// Mock electron before any imports
const mockWebContentsSend = jest.fn();
const mockGetMainWindow = jest.fn().mockReturnValue({
  isDestroyed: () => false,
  webContents: {
    send: mockWebContentsSend
  }
});

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/tmp/test-app'),
    getVersion: jest.fn().mockReturnValue('1.0.0')
  },
  ipcMain: {
    handle: jest.fn()
  },
  BrowserWindow: {
    getAllWindows: jest.fn().mockReturnValue([])
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

// Mock IPC wrappers - createHandler passes through the handler function
jest.mock('../src/main/ipc/ipcWrappers', () => ({
  createHandler: ({ handler }) => handler
}));

// Mock DependencyManagerService
const mockGetStatus = jest.fn();
const mockInstallOllama = jest.fn();
const mockInstallChromaDb = jest.fn();
const mockUpdateOllama = jest.fn();
const mockUpdateChromaDb = jest.fn();
const mockAddProgressCallback = jest.fn();

jest.mock('../src/main/services/DependencyManagerService', () => ({
  getInstance: jest.fn().mockReturnValue({
    getStatus: mockGetStatus,
    installOllama: mockInstallOllama,
    installChromaDb: mockInstallChromaDb,
    updateOllama: mockUpdateOllama,
    updateChromaDb: mockUpdateChromaDb,
    addProgressCallback: mockAddProgressCallback
  })
}));

// Mock StartupManager
const mockStartOllama = jest.fn();
const mockStartChromaDB = jest.fn();
const mockSetChromadbDependencyMissing = jest.fn();

jest.mock('../src/main/services/startup', () => ({
  getStartupManager: jest.fn().mockReturnValue({
    startOllama: mockStartOllama,
    startChromaDB: mockStartChromaDB,
    setChromadbDependencyMissing: mockSetChromadbDependencyMissing
  })
}));

describe('Dependencies IPC Handlers', () => {
  let handlers;
  const IPC_CHANNELS = {
    DEPENDENCIES: {
      GET_STATUS: 'dependencies-get-status',
      INSTALL_OLLAMA: 'dependencies-install-ollama',
      INSTALL_CHROMADB: 'dependencies-install-chromadb',
      UPDATE_OLLAMA: 'dependencies-update-ollama',
      UPDATE_CHROMADB: 'dependencies-update-chromadb',
      SERVICE_STATUS_CHANGED: 'dependencies-service-status-changed'
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Capture handlers registered with ipcMain.handle
    handlers = {};
    const { ipcMain } = require('electron');
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    // Reset mock return values
    mockGetMainWindow.mockReturnValue({
      isDestroyed: () => false,
      webContents: {
        send: mockWebContentsSend
      }
    });

    // Register handlers
    const { registerDependenciesIpc } = require('../src/main/ipc/dependencies');
    registerDependenciesIpc({
      ipcMain,
      IPC_CHANNELS,
      logger: require('../src/shared/logger').logger,
      getMainWindow: mockGetMainWindow
    });
  });

  describe('GET_STATUS handler', () => {
    test('returns status from DependencyManagerService', async () => {
      const mockStatus = {
        python: { installed: true, version: '3.12' },
        ollama: { installed: true, running: true },
        chromadb: { pythonModuleInstalled: true, running: false }
      };
      mockGetStatus.mockResolvedValue(mockStatus);

      const handler = handlers['dependencies-get-status'];
      expect(handler).toBeDefined();

      const result = await handler({}, {});
      expect(result.status).toEqual(mockStatus);
      expect(result.success).toBe(true);
    });

    test('handles DependencyManagerService errors', async () => {
      mockGetStatus.mockRejectedValue(new Error('Service unavailable'));

      const handler = handlers['dependencies-get-status'];

      // createHandler would normally wrap this, but we mocked it to pass through
      await expect(handler({}, {})).rejects.toThrow('Service unavailable');
    });
  });

  describe('INSTALL_OLLAMA handler', () => {
    test('calls manager.installOllama and returns result', async () => {
      mockInstallOllama.mockResolvedValue({ success: true });
      mockStartOllama.mockResolvedValue({ success: true });

      const handler = handlers['dependencies-install-ollama'];
      const result = await handler({}, {});

      expect(mockInstallOllama).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    test('sends progress events during installation', async () => {
      mockInstallOllama.mockResolvedValue({ success: true });
      mockStartOllama.mockResolvedValue({ success: true });

      const handler = handlers['dependencies-install-ollama'];
      await handler({}, {});

      // Should have sent progress messages
      expect(mockWebContentsSend).toHaveBeenCalledWith(
        'operation-progress',
        expect.objectContaining({
          type: 'dependency',
          dependency: 'ollama'
        })
      );
    });

    test('attempts to start Ollama after successful install', async () => {
      mockInstallOllama.mockResolvedValue({ success: true });
      mockStartOllama.mockResolvedValue({ success: true });

      const handler = handlers['dependencies-install-ollama'];
      await handler({}, {});

      expect(mockStartOllama).toHaveBeenCalled();
    });

    test('returns error when installation fails', async () => {
      mockInstallOllama.mockResolvedValue({ success: false, error: 'Download failed' });

      const handler = handlers['dependencies-install-ollama'];
      const result = await handler({}, {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Download failed');
    });

    test('handles startup failure gracefully', async () => {
      mockInstallOllama.mockResolvedValue({ success: true });
      mockStartOllama.mockRejectedValue(new Error('Port in use'));

      const handler = handlers['dependencies-install-ollama'];
      const result = await handler({}, {});

      // Install should still succeed even if startup fails
      expect(result.success).toBe(true);
    });

    test('sends error progress when installation fails', async () => {
      mockInstallOllama.mockResolvedValue({ success: false, error: 'Network error' });

      const handler = handlers['dependencies-install-ollama'];
      await handler({}, {});

      expect(mockWebContentsSend).toHaveBeenCalledWith(
        'operation-progress',
        expect.objectContaining({
          type: 'dependency',
          dependency: 'ollama',
          stage: 'error'
        })
      );
    });
  });

  describe('INSTALL_CHROMADB handler', () => {
    test('calls manager.installChromaDb with correct options', async () => {
      mockInstallChromaDb.mockResolvedValue({ success: true });
      mockStartChromaDB.mockResolvedValue({ success: true });

      const handler = handlers['dependencies-install-chromadb'];
      await handler({}, {});

      expect(mockInstallChromaDb).toHaveBeenCalledWith(
        expect.objectContaining({
          upgrade: false,
          userInstall: true
        })
      );
    });

    test('clears dependency missing flag before starting', async () => {
      mockInstallChromaDb.mockResolvedValue({ success: true });
      mockStartChromaDB.mockResolvedValue({ success: true });

      const handler = handlers['dependencies-install-chromadb'];
      await handler({}, {});

      expect(mockSetChromadbDependencyMissing).toHaveBeenCalledWith(false);
    });

    test('returns startupError when service fails to start', async () => {
      mockInstallChromaDb.mockResolvedValue({ success: true });
      mockStartChromaDB.mockRejectedValue(new Error('Port 8000 in use'));

      const handler = handlers['dependencies-install-chromadb'];
      const result = await handler({}, {});

      expect(result.success).toBe(true);
      expect(result.startupError).toBe('Port 8000 in use');
    });

    test('returns error when installation fails', async () => {
      mockInstallChromaDb.mockResolvedValue({ success: false, error: 'pip not found' });

      const handler = handlers['dependencies-install-chromadb'];
      const result = await handler({}, {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('pip not found');
    });

    test('sends warning progress when startup fails', async () => {
      mockInstallChromaDb.mockResolvedValue({ success: true });
      mockStartChromaDB.mockRejectedValue(new Error('Module not found'));

      const handler = handlers['dependencies-install-chromadb'];
      await handler({}, {});

      expect(mockWebContentsSend).toHaveBeenCalledWith(
        'operation-progress',
        expect.objectContaining({
          type: 'dependency',
          dependency: 'chromadb',
          stage: 'warning'
        })
      );
    });
  });

  describe('UPDATE_OLLAMA handler', () => {
    test('calls manager.updateOllama', async () => {
      mockUpdateOllama.mockResolvedValue({ success: true, updated: true });

      const handler = handlers['dependencies-update-ollama'];
      const result = await handler({}, {});

      expect(mockUpdateOllama).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    test('sends progress event', async () => {
      mockUpdateOllama.mockResolvedValue({ success: true });

      const handler = handlers['dependencies-update-ollama'];
      await handler({}, {});

      expect(mockWebContentsSend).toHaveBeenCalledWith(
        'operation-progress',
        expect.objectContaining({
          type: 'dependency',
          dependency: 'ollama',
          message: 'Updating Ollama…'
        })
      );
    });
  });

  describe('UPDATE_CHROMADB handler', () => {
    test('calls manager.updateChromaDb', async () => {
      mockUpdateChromaDb.mockResolvedValue({ success: true, updated: true });

      const handler = handlers['dependencies-update-chromadb'];
      const result = await handler({}, {});

      expect(mockUpdateChromaDb).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    test('sends progress event', async () => {
      mockUpdateChromaDb.mockResolvedValue({ success: true });

      const handler = handlers['dependencies-update-chromadb'];
      await handler({}, {});

      expect(mockWebContentsSend).toHaveBeenCalledWith(
        'operation-progress',
        expect.objectContaining({
          type: 'dependency',
          dependency: 'chromadb',
          message: 'Updating ChromaDB…'
        })
      );
    });
  });

  describe('Progress event emission', () => {
    test('does not throw when window is destroyed', async () => {
      mockGetMainWindow.mockReturnValue({
        isDestroyed: () => true,
        webContents: { send: jest.fn() }
      });
      mockInstallOllama.mockResolvedValue({ success: true });
      mockStartOllama.mockResolvedValue({ success: true });

      const handler = handlers['dependencies-install-ollama'];

      // Should not throw
      await expect(handler({}, {})).resolves.toBeDefined();
    });

    test('does not throw when getMainWindow returns null', async () => {
      mockGetMainWindow.mockReturnValue(null);
      mockInstallOllama.mockResolvedValue({ success: true });

      const handler = handlers['dependencies-install-ollama'];

      // Should not throw
      await expect(handler({}, {})).resolves.toBeDefined();
    });
  });
});
