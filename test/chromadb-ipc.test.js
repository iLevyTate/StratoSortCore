/**
 * Tests for ChromaDB IPC handlers (src/main/ipc/chromadb.js)
 */

jest.mock('../src/main/ipc/ipcWrappers', () => ({
  withErrorLogging: (_logger, handler) => handler,
  safeHandle: (ipcMain, channel, handler) => {
    ipcMain.handle(channel, handler);
  },
  // FIX: Add safeSend mock - pass through to webContents.send
  safeSend: (webContents, channel, data) => {
    webContents.send(channel, data);
  }
}));

describe('ChromaDB IPC', () => {
  let handlers;
  let ipcMain;
  let logger;
  let mockWin;
  let chromaService;
  let IPC_CHANNELS;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    IPC_CHANNELS = require('../src/shared/constants').IPC_CHANNELS;

    handlers = {};
    ipcMain = {
      handle: jest.fn((channel, handler) => {
        handlers[channel] = handler;
      })
    };
    logger = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };

    mockWin = {
      isDestroyed: () => false,
      webContents: { send: jest.fn() }
    };

    chromaService = {
      isOnline: true,
      initialized: true,
      serverUrl: 'http://localhost:8000',
      getCircuitState: jest.fn(() => 'CLOSED'),
      isServiceAvailable: jest.fn(() => true),
      getCircuitStats: jest.fn(() => ({ failures: 0 })),
      getQueueStats: jest.fn(() => ({ queueSize: 0 })),
      checkHealth: jest.fn(async () => true),
      forceRecovery: jest.fn(),
      offlineQueue: { size: () => 0 },
      on: jest.fn(),
      off: jest.fn()
    };

    jest.doMock('../src/main/services/chromadb', () => ({
      getInstance: () => chromaService
    }));
  });

  test('registers handlers and returns status/circuit/queue responses', async () => {
    const { registerChromaDBIpc } = require('../src/main/ipc/chromadb');

    registerChromaDBIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      getMainWindow: () => mockWin
    });

    expect(typeof handlers[IPC_CHANNELS.CHROMADB.GET_STATUS]).toBe('function');

    const status = await handlers[IPC_CHANNELS.CHROMADB.GET_STATUS]();
    expect(status).toMatchObject({
      isOnline: true,
      isInitialized: true,
      circuitState: 'CLOSED',
      isServiceAvailable: true,
      serverUrl: 'http://localhost:8000'
    });

    const circuitStats = await handlers[IPC_CHANNELS.CHROMADB.GET_CIRCUIT_STATS]();
    expect(circuitStats).toEqual({ failures: 0 });

    const queueStats = await handlers[IPC_CHANNELS.CHROMADB.GET_QUEUE_STATS]();
    expect(queueStats).toEqual({ queueSize: 0 });
  });

  test('FORCE_RECOVERY triggers forceRecovery + health check', async () => {
    const { registerChromaDBIpc } = require('../src/main/ipc/chromadb');

    registerChromaDBIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      getMainWindow: () => mockWin
    });

    const res = await handlers[IPC_CHANNELS.CHROMADB.FORCE_RECOVERY]();
    expect(res.success).toBe(true);
    expect(chromaService.forceRecovery).toHaveBeenCalled();
    expect(chromaService.checkHealth).toHaveBeenCalled();
  });

  test('event forwarding sends STATUS_CHANGED to renderer (and warns on send errors)', () => {
    const { registerChromaDBIpc } = require('../src/main/ipc/chromadb');

    registerChromaDBIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      getMainWindow: () => mockWin
    });

    // Capture handlers registered via chromaService.on
    const onCalls = chromaService.on.mock.calls;
    const handlersByEvent = new Map(onCalls.map(([evt, fn]) => [evt, fn]));

    handlersByEvent.get('online')?.({ reason: 'startup' });
    handlersByEvent.get('offline')?.({ reason: 'circuit_open', failureCount: 3 });
    handlersByEvent.get('recovering')?.({ reason: 'half_open' });
    handlersByEvent.get('operationQueued')?.({ type: 'UPSERT_FILE', queueSize: 2 });
    handlersByEvent.get('queueFlushed')?.({ processed: 1, failed: 0, remaining: 0 });

    expect(mockWin.webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.CHROMADB.STATUS_CHANGED,
      expect.objectContaining({ status: expect.any(String), timestamp: expect.any(Number) })
    );

    // Send error path
    const badWin = {
      isDestroyed: () => false,
      webContents: {
        send: jest.fn(() => {
          throw new Error('send failed');
        })
      }
    };
    registerChromaDBIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      getMainWindow: () => badWin
    });
    const badHandlersByEvent = new Map(chromaService.on.mock.calls.map(([evt, fn]) => [evt, fn]));
    badHandlersByEvent.get('online')?.({ reason: 'startup' });
    expect(logger.warn).toHaveBeenCalled();
  });

  test('cleanupEventListeners detaches handlers', () => {
    const { registerChromaDBIpc, cleanupEventListeners } = require('../src/main/ipc/chromadb');

    registerChromaDBIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      getMainWindow: () => mockWin
    });

    cleanupEventListeners();
    expect(chromaService.off).toHaveBeenCalled();
  });

  test('getStatusSummary reflects circuit state and queued operations', () => {
    const { getStatusSummary } = require('../src/main/ipc/chromadb');

    const s1 = getStatusSummary({
      isOnline: true,
      getCircuitState: () => 'OPEN',
      getQueueStats: () => ({ queueSize: 2 })
    });
    expect(s1.level).toBe('error');
    expect(s1.message).toContain('2 operations queued');

    const s2 = getStatusSummary({
      isOnline: false,
      getCircuitState: () => 'CLOSED',
      getQueueStats: () => ({ queueSize: 0 })
    });
    expect(s2.level).toBe('warning');
  });
});
