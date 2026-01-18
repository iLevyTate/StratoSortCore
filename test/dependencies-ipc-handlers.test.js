// Mock dependencies
const mockIpcWrappers = {
  createHandler: jest.fn(({ handler }) => handler),
  safeHandle: jest.fn(),
  // FIX: Add safeSend mock to forward to webContents.send
  safeSend: jest.fn((webContents, channel, data) => {
    if (webContents && typeof webContents.send === 'function') {
      webContents.send(channel, data);
    }
    return true;
  })
};
jest.mock('../src/main/ipc/ipcWrappers', () => mockIpcWrappers);

const mockDependencyManager = {
  getStatus: jest.fn(),
  installOllama: jest.fn(),
  updateOllama: jest.fn(),
  installChromaDb: jest.fn(),
  updateChromaDb: jest.fn()
};

jest.mock('../src/main/services/DependencyManagerService', () => ({
  getInstance: jest.fn().mockReturnValue(mockDependencyManager)
}));

const mockStartupManager = {
  startOllama: jest.fn(),
  startChromaDB: jest.fn(),
  setChromadbDependencyMissing: jest.fn()
};

jest.mock('../src/main/services/startup', () => ({
  getStartupManager: jest.fn().mockReturnValue(mockStartupManager)
}));

const {
  registerDependenciesIpc,
  emitServiceStatusChange
} = require('../src/main/ipc/dependencies');

describe('Dependencies IPC Handlers', () => {
  let mockIpcMain;
  let mockLogger;
  let mockGetMainWindow;
  let mockWebContents;
  let registeredHandlers = {};

  const IPC_CHANNELS = {
    DEPENDENCIES: {
      GET_STATUS: 'dependencies:get-status',
      INSTALL_OLLAMA: 'dependencies:install-ollama',
      UPDATE_OLLAMA: 'dependencies:update-ollama',
      INSTALL_CHROMADB: 'dependencies:install-chromadb',
      UPDATE_CHROMADB: 'dependencies:update-chromadb',
      SERVICE_STATUS_CHANGED: 'dependencies:service-status-changed'
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    registeredHandlers = {};

    mockWebContents = {
      send: jest.fn()
    };

    mockGetMainWindow = jest.fn().mockReturnValue({
      webContents: mockWebContents,
      isDestroyed: jest.fn().mockReturnValue(false)
    });

    mockIpcMain = {
      handle: jest.fn((channel, handler) => {
        registeredHandlers[channel] = handler;
      })
    };

    mockIpcWrappers.safeHandle.mockImplementation((ipc, channel, handler) => {
      registeredHandlers[channel] = handler;
    });

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
  });

  describe('Registration', () => {
    test('registers all handlers', () => {
      registerDependenciesIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getMainWindow: mockGetMainWindow
      });

      expect(registeredHandlers[IPC_CHANNELS.DEPENDENCIES.GET_STATUS]).toBeDefined();
      expect(registeredHandlers[IPC_CHANNELS.DEPENDENCIES.INSTALL_OLLAMA]).toBeDefined();
      expect(registeredHandlers[IPC_CHANNELS.DEPENDENCIES.UPDATE_OLLAMA]).toBeDefined();
      expect(registeredHandlers[IPC_CHANNELS.DEPENDENCIES.INSTALL_CHROMADB]).toBeDefined();
      expect(registeredHandlers[IPC_CHANNELS.DEPENDENCIES.UPDATE_CHROMADB]).toBeDefined();
    });
  });

  describe('Handlers', () => {
    beforeEach(() => {
      registerDependenciesIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getMainWindow: mockGetMainWindow
      });
    });

    test('GET_STATUS returns status', async () => {
      const status = { ollama: 'installed', chromadb: 'missing' };
      mockDependencyManager.getStatus.mockResolvedValue(status);

      const handler = registeredHandlers[IPC_CHANNELS.DEPENDENCIES.GET_STATUS];
      const result = await handler();

      expect(result).toEqual({ success: true, status });
    });

    describe('INSTALL_OLLAMA', () => {
      test('successfully installs and starts ollama', async () => {
        mockDependencyManager.installOllama.mockResolvedValue({ success: true });
        mockStartupManager.startOllama.mockResolvedValue();

        const handler = registeredHandlers[IPC_CHANNELS.DEPENDENCIES.INSTALL_OLLAMA];
        const result = await handler();

        expect(result.success).toBe(true);
        expect(mockWebContents.send).toHaveBeenCalledWith(
          'operation-progress',
          expect.objectContaining({
            type: 'dependency',
            message: 'Starting Ollama installation…'
          })
        );
        expect(mockStartupManager.startOllama).toHaveBeenCalled();
        expect(mockWebContents.send).toHaveBeenCalledWith(
          'operation-progress',
          expect.objectContaining({
            type: 'dependency',
            stage: 'done'
          })
        );
      });

      test('handles install failure', async () => {
        mockDependencyManager.installOllama.mockResolvedValue({
          success: false,
          error: 'Install failed'
        });

        const handler = registeredHandlers[IPC_CHANNELS.DEPENDENCIES.INSTALL_OLLAMA];
        const result = await handler();

        expect(result.success).toBe(false);
        expect(mockStartupManager.startOllama).not.toHaveBeenCalled();
        expect(mockWebContents.send).toHaveBeenCalledWith(
          'operation-progress',
          expect.objectContaining({
            type: 'dependency',
            stage: 'error',
            message: expect.stringContaining('Install failed')
          })
        );
      });

      test('handles startup failure gracefully', async () => {
        mockDependencyManager.installOllama.mockResolvedValue({ success: true });
        mockStartupManager.startOllama.mockRejectedValue(new Error('Startup failed'));

        const handler = registeredHandlers[IPC_CHANNELS.DEPENDENCIES.INSTALL_OLLAMA];
        const result = await handler();

        expect(result.success).toBe(true); // Install was still successful
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Failed to start'),
          expect.any(Object)
        );
      });
    });

    describe('INSTALL_CHROMADB', () => {
      test('successfully installs and starts chromadb', async () => {
        mockDependencyManager.installChromaDb.mockResolvedValue({ success: true });
        mockStartupManager.startChromaDB.mockResolvedValue();

        const handler = registeredHandlers[IPC_CHANNELS.DEPENDENCIES.INSTALL_CHROMADB];
        const result = await handler();

        expect(result.success).toBe(true);
        expect(mockStartupManager.setChromadbDependencyMissing).toHaveBeenCalledWith(false);
        expect(mockStartupManager.startChromaDB).toHaveBeenCalled();
        expect(mockWebContents.send).toHaveBeenCalledWith(
          'operation-progress',
          expect.objectContaining({
            stage: 'start'
          })
        );
      });

      test('handles install failure', async () => {
        mockDependencyManager.installChromaDb.mockResolvedValue({
          success: false,
          error: 'Install failed'
        });

        const handler = registeredHandlers[IPC_CHANNELS.DEPENDENCIES.INSTALL_CHROMADB];
        const result = await handler();

        expect(result.success).toBe(false);
        expect(mockStartupManager.startChromaDB).not.toHaveBeenCalled();
        expect(mockWebContents.send).toHaveBeenCalledWith(
          'operation-progress',
          expect.objectContaining({
            stage: 'error'
          })
        );
      });

      test('reports startup error as warning', async () => {
        mockDependencyManager.installChromaDb.mockResolvedValue({ success: true });
        mockStartupManager.startChromaDB.mockRejectedValue(new Error('Startup failed'));

        const handler = registeredHandlers[IPC_CHANNELS.DEPENDENCIES.INSTALL_CHROMADB];
        const result = await handler();

        expect(result.success).toBe(true);
        expect(result.startupError).toBe('Startup failed');
        expect(mockWebContents.send).toHaveBeenCalledWith(
          'operation-progress',
          expect.objectContaining({
            stage: 'warning',
            message: expect.stringContaining('Startup failed')
          })
        );
      });
    });

    describe('Updates', () => {
      test('UPDATE_OLLAMA calls manager', async () => {
        mockDependencyManager.updateOllama.mockResolvedValue({ success: true });

        const handler = registeredHandlers[IPC_CHANNELS.DEPENDENCIES.UPDATE_OLLAMA];
        const result = await handler();

        expect(mockDependencyManager.updateOllama).toHaveBeenCalled();
        expect(result.success).toBe(true);
      });

      test('UPDATE_CHROMADB calls manager', async () => {
        mockDependencyManager.updateChromaDb.mockResolvedValue({ success: true });

        const handler = registeredHandlers[IPC_CHANNELS.DEPENDENCIES.UPDATE_CHROMADB];
        const result = await handler();

        expect(mockDependencyManager.updateChromaDb).toHaveBeenCalled();
        expect(result.success).toBe(true);
      });
    });
  });

  describe('emitServiceStatusChange', () => {
    beforeEach(() => {
      // Must register to set module-level variables
      registerDependenciesIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getMainWindow: mockGetMainWindow
      });
    });

    test('sends status change event', () => {
      const payload = {
        service: 'ollama',
        status: 'running',
        health: 'healthy'
      };

      emitServiceStatusChange(payload);

      expect(mockWebContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.DEPENDENCIES.SERVICE_STATUS_CHANGED,
        expect.objectContaining({
          ...payload,
          timestamp: expect.any(Number)
        })
      );
    });

    test('handles missing window gracefully', () => {
      mockGetMainWindow.mockReturnValue(null);
      emitServiceStatusChange({ service: 'ollama' });
      // Should not throw
      expect(mockLogger.debug).not.toHaveBeenCalledWith(
        expect.stringContaining('Failed'),
        expect.any(Object)
      );
    });

    test('logs error on send failure', () => {
      mockWebContents.send.mockImplementation(() => {
        throw new Error('Send failed');
      });
      emitServiceStatusChange({ service: 'ollama' });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Failed to emit'),
        expect.any(Object)
      );
    });
  });
});
