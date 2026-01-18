// Mock dependencies
const mockIpcWrappers = {
  withErrorLogging: jest.fn((logger, handler) => handler),
  safeHandle: jest.fn(),
  // FIX: Add safeSend mock - pass through to webContents.send
  safeSend: jest.fn((webContents, channel, data) => {
    webContents.send(channel, data);
  })
};
jest.mock('../src/main/ipc/ipcWrappers', () => mockIpcWrappers);

jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  }
}));

// Mock ChromaDB service instance
const mockChromaDbService = {
  isOnline: true,
  initialized: true,
  serverUrl: 'http://localhost:8000',
  offlineQueue: {
    size: jest.fn().mockReturnValue(5)
  },
  getCircuitState: jest.fn().mockReturnValue('CLOSED'),
  getCircuitStats: jest.fn().mockReturnValue({ failures: 0 }),
  getQueueStats: jest.fn().mockReturnValue({ queueSize: 5 }),
  isServiceAvailable: jest.fn().mockReturnValue(true),
  checkHealth: jest.fn().mockResolvedValue(true),
  forceRecovery: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
  removeAllListeners: jest.fn()
};

jest.mock('../src/main/services/chromadb', () => ({
  getInstance: jest.fn().mockReturnValue(mockChromaDbService)
}));

jest.mock('../src/main/utils/CircuitBreaker', () => ({
  CircuitState: {
    OPEN: 'OPEN',
    CLOSED: 'CLOSED',
    HALF_OPEN: 'HALF_OPEN'
  }
}));

const {
  registerChromaDBIpc,
  getStatusSummary,
  cleanupEventListeners
} = require('../src/main/ipc/chromadb');

describe('ChromaDB IPC Handlers', () => {
  let mockIpcMain;
  let mockLogger;
  let mockGetMainWindow;
  let mockWebContents;
  let registeredHandlers = {};

  const IPC_CHANNELS = {
    CHROMADB: {
      GET_STATUS: 'chromadb:get-status',
      GET_CIRCUIT_STATS: 'chromadb:get-circuit-stats',
      GET_QUEUE_STATS: 'chromadb:get-queue-stats',
      FORCE_RECOVERY: 'chromadb:force-recovery',
      HEALTH_CHECK: 'chromadb:health-check',
      STATUS_CHANGED: 'chromadb:status-changed'
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    registeredHandlers = {};
    cleanupEventListeners(); // Clean up from previous tests

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

    mockLogger = require('../src/shared/logger').logger;

    // Reset service mock state
    mockChromaDbService.isOnline = true;
    mockChromaDbService.initialized = true;
    mockChromaDbService.getCircuitState.mockReturnValue('CLOSED');
  });

  describe('Registration', () => {
    test('registers all handlers', () => {
      registerChromaDBIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getMainWindow: mockGetMainWindow
      });

      expect(registeredHandlers[IPC_CHANNELS.CHROMADB.GET_STATUS]).toBeDefined();
      expect(registeredHandlers[IPC_CHANNELS.CHROMADB.GET_CIRCUIT_STATS]).toBeDefined();
      expect(registeredHandlers[IPC_CHANNELS.CHROMADB.GET_QUEUE_STATS]).toBeDefined();
      expect(registeredHandlers[IPC_CHANNELS.CHROMADB.FORCE_RECOVERY]).toBeDefined();
      expect(registeredHandlers[IPC_CHANNELS.CHROMADB.HEALTH_CHECK]).toBeDefined();
    });

    test('sets up event forwarding', () => {
      registerChromaDBIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getMainWindow: mockGetMainWindow
      });

      expect(mockChromaDbService.on).toHaveBeenCalledWith('online', expect.any(Function));
      expect(mockChromaDbService.on).toHaveBeenCalledWith('offline', expect.any(Function));
      expect(mockChromaDbService.on).toHaveBeenCalledWith('recovering', expect.any(Function));
      expect(mockChromaDbService.on).toHaveBeenCalledWith(
        'circuitStateChange',
        expect.any(Function)
      );
      expect(mockChromaDbService.on).toHaveBeenCalledWith('operationQueued', expect.any(Function));
      expect(mockChromaDbService.on).toHaveBeenCalledWith('queueFlushed', expect.any(Function));
    });
  });

  describe('Handlers', () => {
    beforeEach(() => {
      registerChromaDBIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getMainWindow: mockGetMainWindow
      });
    });

    test('GET_STATUS returns correct status', async () => {
      const handler = registeredHandlers[IPC_CHANNELS.CHROMADB.GET_STATUS];
      const result = await handler({});

      expect(result).toEqual({
        isOnline: true,
        isInitialized: true,
        circuitState: 'CLOSED',
        isServiceAvailable: true,
        queueSize: 5,
        serverUrl: 'http://localhost:8000'
      });
    });

    test('GET_CIRCUIT_STATS returns stats', async () => {
      const handler = registeredHandlers[IPC_CHANNELS.CHROMADB.GET_CIRCUIT_STATS];
      const result = await handler({});
      expect(result).toEqual({ failures: 0 });
    });

    test('GET_QUEUE_STATS returns stats', async () => {
      const handler = registeredHandlers[IPC_CHANNELS.CHROMADB.GET_QUEUE_STATS];
      const result = await handler({});
      expect(result).toEqual({ queueSize: 5 });
    });

    test('FORCE_RECOVERY triggers recovery and health check', async () => {
      const handler = registeredHandlers[IPC_CHANNELS.CHROMADB.FORCE_RECOVERY];
      const result = await handler({});

      expect(mockChromaDbService.forceRecovery).toHaveBeenCalled();
      expect(mockChromaDbService.checkHealth).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        isHealthy: true,
        circuitState: 'CLOSED'
      });
    });

    test('HEALTH_CHECK performs check and returns status', async () => {
      const handler = registeredHandlers[IPC_CHANNELS.CHROMADB.HEALTH_CHECK];
      const result = await handler({});

      expect(mockChromaDbService.checkHealth).toHaveBeenCalled();
      expect(result).toEqual({
        isHealthy: true,
        isOnline: true,
        circuitState: 'CLOSED',
        queueSize: 5
      });
    });
  });

  describe('Event Forwarding', () => {
    let eventHandlers = {};

    beforeEach(() => {
      mockChromaDbService.on.mockImplementation((event, handler) => {
        eventHandlers[event] = handler;
      });

      registerChromaDBIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getMainWindow: mockGetMainWindow
      });
    });

    test('forwards online event', () => {
      eventHandlers['online']({ reason: 'connected' });
      expect(mockWebContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.CHROMADB.STATUS_CHANGED,
        expect.objectContaining({
          status: 'online',
          reason: 'connected',
          circuitState: 'CLOSED'
        })
      );
    });

    test('forwards offline event', () => {
      eventHandlers['offline']({ reason: 'timeout', failureCount: 3 });
      expect(mockWebContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.CHROMADB.STATUS_CHANGED,
        expect.objectContaining({
          status: 'offline',
          reason: 'timeout',
          failureCount: 3
        })
      );
    });

    test('forwards recovering event', () => {
      eventHandlers['recovering']({ reason: 'testing' });
      expect(mockWebContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.CHROMADB.STATUS_CHANGED,
        expect.objectContaining({
          status: 'recovering',
          reason: 'testing'
        })
      );
    });

    test('forwards circuitStateChange event', () => {
      eventHandlers['circuitStateChange']({ previousState: 'CLOSED', currentState: 'OPEN' });
      expect(mockWebContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.CHROMADB.STATUS_CHANGED,
        expect.objectContaining({
          status: 'circuit_changed',
          previousState: 'CLOSED',
          currentState: 'OPEN'
        })
      );
    });

    test('forwards operationQueued event', () => {
      eventHandlers['operationQueued']({ type: 'upsert', queueSize: 5 });
      expect(mockWebContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.CHROMADB.STATUS_CHANGED,
        expect.objectContaining({
          status: 'operation_queued',
          operationType: 'upsert',
          queueSize: 5
        })
      );
    });

    test('forwards queueFlushed event', () => {
      eventHandlers['queueFlushed']({ processed: 10, failed: 0, remaining: 0 });
      expect(mockWebContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.CHROMADB.STATUS_CHANGED,
        expect.objectContaining({
          status: 'queue_flushed',
          processed: 10,
          failed: 0,
          remaining: 0
        })
      );
    });

    test('handles missing main window gracefully', () => {
      mockGetMainWindow.mockReturnValue(null);
      eventHandlers['online']({ reason: 'connected' });
      expect(mockLogger.warn).not.toHaveBeenCalled(); // Should assume window closed is normal, logs debug or nothing if handled
    });

    test('logs error if send fails', () => {
      mockWebContents.send.mockImplementation(() => {
        throw new Error('IPC failed');
      });
      eventHandlers['online']({ reason: 'connected' });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send'),
        expect.any(Object)
      );
    });
  });

  describe('getStatusSummary', () => {
    test('returns healthy status when closed and online', () => {
      mockChromaDbService.getCircuitState.mockReturnValue('CLOSED');
      mockChromaDbService.isOnline = true;

      const summary = getStatusSummary(mockChromaDbService);
      expect(summary.level).toBe('healthy');
      expect(summary.message).toContain('operational');
    });

    test('returns error status when circuit open', () => {
      mockChromaDbService.getCircuitState.mockReturnValue('OPEN');

      const summary = getStatusSummary(mockChromaDbService);
      expect(summary.level).toBe('error');
      expect(summary.message).toContain('offline');
    });

    test('returns warning status when recovering', () => {
      mockChromaDbService.getCircuitState.mockReturnValue('HALF_OPEN');

      const summary = getStatusSummary(mockChromaDbService);
      expect(summary.level).toBe('warning');
      expect(summary.message).toContain('reconnect');
    });

    test('returns warning status when unstable (online=false but circuit=closed)', () => {
      mockChromaDbService.getCircuitState.mockReturnValue('CLOSED');
      mockChromaDbService.isOnline = false;

      const summary = getStatusSummary(mockChromaDbService);
      expect(summary.level).toBe('warning');
      expect(summary.message).toContain('unstable');
    });

    test('appends queue info if items queued', () => {
      mockChromaDbService.getQueueStats.mockReturnValue({ queueSize: 10 });

      const summary = getStatusSummary(mockChromaDbService);
      expect(summary.message).toContain('(10 operations queued)');
    });
  });

  describe('cleanupEventListeners', () => {
    test('removes listeners from service', () => {
      // Setup
      registerChromaDBIpc({
        ipcMain: mockIpcMain,
        IPC_CHANNELS,
        logger: mockLogger,
        getMainWindow: mockGetMainWindow
      });

      // Cleanup
      cleanupEventListeners();

      // Verify off called for each event
      expect(mockChromaDbService.off).toHaveBeenCalledTimes(6);
      expect(mockChromaDbService.off).toHaveBeenCalledWith('online', expect.any(Function));
    });
  });
});
