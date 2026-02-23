/**
 * Extended IPC Middleware coverage tests.
 * Targets: all event listeners, queue overflow, normalizeServiceHealth,
 *          validation failures, error handling in queue flush.
 */

// Mock dependencies
jest.mock('../src/renderer/store/slices/analysisSlice', () => ({
  updateProgress: jest.fn((data) => ({ type: 'analysis/updateProgress', payload: data }))
}));

jest.mock('../src/renderer/store/slices/systemSlice', () => ({
  updateMetrics: jest.fn((data) => ({ type: 'system/updateMetrics', payload: data })),
  updateHealth: jest.fn((data) => ({ type: 'system/updateHealth', payload: data })),
  addNotification: jest.fn((data) => ({ type: 'system/addNotification', payload: data }))
}));

jest.mock('../src/renderer/store/slices/filesSlice', () => ({
  atomicUpdateFilePathsAfterMove: jest.fn((data) => ({
    type: 'files/atomicUpdatePaths',
    payload: data
  })),
  atomicRemoveFilesWithCleanup: jest.fn((data) => ({
    type: 'files/atomicRemoveFiles',
    payload: data
  }))
}));

jest.mock('../src/shared/ipcEventSchemas', () => ({
  hasEventSchema: jest.fn(() => true),
  validateEventPayload: jest.fn((_, data) => ({ valid: true, data }))
}));

jest.mock('../src/shared/constants', () => ({
  IPC_CHANNELS: {
    VECTOR_DB: { STATUS_CHANGED: 'vdb:status-changed' }
  }
}));

jest.mock('../src/shared/logger', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

describe('ipcMiddleware extended coverage', () => {
  let ipcMiddleware;
  let cleanupIpcListeners;
  let markStoreReady;
  let recoverPersistedCriticalEvents;
  let mockStore;
  let mockDispatch;
  let mockNext;
  let storedLocalStorage;
  let handlers;

  beforeEach(() => {
    jest.resetModules();

    handlers = {};
    const createMockListener = (name) =>
      jest.fn((handler) => {
        handlers[name] = handler;
        return jest.fn(); // cleanup function
      });

    const mockElectronAPI = {
      events: {
        onOperationProgress: createMockListener('operationProgress'),
        onSystemMetrics: createMockListener('systemMetrics'),
        onFileOperationComplete: createMockListener('fileOperationComplete'),
        onNotification: createMockListener('notification'),
        onBatchResultsChunk: createMockListener('batchResultsChunk'),
        onAppError: createMockListener('appError')
      },
      vectorDb: {
        onStatusChanged: createMockListener('vectorStatusChanged')
      }
    };

    storedLocalStorage = (() => {
      let storage = {};
      return {
        getItem: jest.fn((key) => (key in storage ? storage[key] : null)),
        setItem: jest.fn((key, value) => {
          storage[key] = String(value);
        }),
        removeItem: jest.fn((key) => {
          delete storage[key];
        }),
        clear: jest.fn(() => {
          storage = {};
        })
      };
    })();

    global.window = global.window || {};
    global.window.electronAPI = mockElectronAPI;
    global.window.addEventListener = jest.fn();
    global.window.removeEventListener = jest.fn();
    global.window.localStorage = storedLocalStorage;
    global.window.dispatchEvent = jest.fn();
    global.window.CustomEvent =
      global.CustomEvent ||
      function (name, opts) {
        return { type: name, detail: opts?.detail };
      };
    Object.defineProperty(global, 'localStorage', { value: storedLocalStorage, writable: true });

    global.module = { hot: null };

    const ipcModule = require('../src/renderer/store/middleware/ipcMiddleware');
    ipcMiddleware = ipcModule.default;
    cleanupIpcListeners = ipcModule.cleanupIpcListeners;
    markStoreReady = ipcModule.markStoreReady;
    recoverPersistedCriticalEvents = ipcModule.recoverPersistedCriticalEvents;

    mockDispatch = jest.fn();
    mockStore = {
      dispatch: mockDispatch,
      getState: jest.fn().mockReturnValue({})
    };
    mockNext = jest.fn((action) => action);
  });

  afterEach(() => {
    if (cleanupIpcListeners) cleanupIpcListeners(true);
  });

  test('sets up all event listeners', () => {
    ipcMiddleware(mockStore);

    expect(handlers.operationProgress).toBeDefined();
    expect(handlers.systemMetrics).toBeDefined();
    expect(handlers.fileOperationComplete).toBeDefined();
    expect(handlers.notification).toBeDefined();
    expect(handlers.batchResultsChunk).toBeDefined();
    expect(handlers.appError).toBeDefined();
    expect(handlers.vectorStatusChanged).toBeDefined();
  });

  describe('operation progress normalization', () => {
    test('maps batch analysis completed -> current', () => {
      ipcMiddleware(mockStore);
      markStoreReady();

      handlers.operationProgress({
        type: 'batch_analyze',
        completed: 7,
        total: 20,
        percentage: 35
      });

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'analysis/updateProgress',
          payload: expect.objectContaining({
            type: 'batch_analyze',
            completed: 7,
            current: 7,
            total: 20,
            percentage: 35
          })
        })
      );
    });

    test('re-dispatches progress as DOM CustomEvent for useAnalysis listener', () => {
      ipcMiddleware(mockStore);
      markStoreReady();

      const progressPayload = {
        type: 'batch_analyze',
        completed: 3,
        total: 10,
        currentFile: '/path/to/file.pdf'
      };

      handlers.operationProgress(progressPayload);

      expect(global.window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'operation-progress',
          detail: expect.objectContaining({
            type: 'batch_analyze',
            completed: 3,
            total: 10,
            currentFile: '/path/to/file.pdf'
          })
        })
      );
    });

    test('does not map non-analysis progress payloads', () => {
      ipcMiddleware(mockStore);
      markStoreReady();

      handlers.operationProgress({
        type: 'model-download',
        completed: 512,
        total: 1024
      });

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'analysis/updateProgress',
          payload: expect.objectContaining({
            type: 'model-download',
            completed: 512,
            total: 1024
          })
        })
      );

      const call = mockDispatch.mock.calls.find(
        (entry) => entry[0]?.type === 'analysis/updateProgress'
      );
      expect(call[0].payload.current).toBeUndefined();
    });
  });

  describe('onFileOperationComplete handler', () => {
    test('dispatches atomic path update for move operations', () => {
      ipcMiddleware(mockStore);
      markStoreReady();

      handlers.fileOperationComplete({
        operation: 'move',
        files: ['/old/path.pdf'],
        destinations: ['/new/path.pdf']
      });

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'files/atomicUpdatePaths',
          payload: { oldPaths: ['/old/path.pdf'], newPaths: ['/new/path.pdf'] }
        })
      );
    });

    test('dispatches atomic remove for delete operations', () => {
      ipcMiddleware(mockStore);
      markStoreReady();

      handlers.fileOperationComplete({
        operation: 'delete',
        files: ['/path/deleted.pdf']
      });

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'files/atomicRemoveFiles',
          payload: ['/path/deleted.pdf']
        })
      );
    });

    test('normalizes single-file move payload (oldPath/newPath)', () => {
      ipcMiddleware(mockStore);
      markStoreReady();

      handlers.fileOperationComplete({
        operation: 'move',
        oldPath: '/old/single.pdf',
        newPath: '/new/single.pdf'
      });

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'files/atomicUpdatePaths',
          payload: { oldPaths: ['/old/single.pdf'], newPaths: ['/new/single.pdf'] }
        })
      );
    });

    test('normalizes single-file delete payload (oldPath)', () => {
      ipcMiddleware(mockStore);
      markStoreReady();

      handlers.fileOperationComplete({
        operation: 'delete',
        oldPath: '/single/deleted.pdf'
      });

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'files/atomicRemoveFiles',
          payload: ['/single/deleted.pdf']
        })
      );
    });

    test('dispatches DOM event for file operations', () => {
      ipcMiddleware(mockStore);
      markStoreReady();

      handlers.fileOperationComplete({ operation: 'move', files: [], destinations: [] });

      expect(global.window.dispatchEvent).toHaveBeenCalled();
    });
  });

  describe('onNotification handler', () => {
    test('dispatches notification to Redux', () => {
      ipcMiddleware(mockStore);
      markStoreReady();

      handlers.notification({ message: 'Watcher detected files', severity: 'info' });

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'system/addNotification',
          payload: expect.objectContaining({ message: 'Watcher detected files' })
        })
      );
    });
  });

  describe('onBatchResultsChunk handler', () => {
    test('dispatches custom DOM event', () => {
      ipcMiddleware(mockStore);
      markStoreReady();

      handlers.batchResultsChunk({ chunk: 1, total: 3, results: [] });

      expect(global.window.dispatchEvent).toHaveBeenCalled();
    });
  });

  describe('onAppError handler', () => {
    test('dispatches error notification', () => {
      ipcMiddleware(mockStore);
      markStoreReady();

      handlers.appError({ message: 'Unexpected crash' });

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'system/addNotification',
          payload: expect.objectContaining({
            message: 'Unexpected crash',
            severity: 'error'
          })
        })
      );
    });
  });

  describe('vectorDb.onStatusChanged handler', () => {
    test('normalizes healthy status to online', () => {
      ipcMiddleware(mockStore);
      markStoreReady();

      handlers.vectorStatusChanged({ status: 'connected', health: 'healthy' });

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'system/updateHealth',
          payload: { vectorDb: 'online' }
        })
      );
    });

    test('normalizes offline status', () => {
      ipcMiddleware(mockStore);
      markStoreReady();

      handlers.vectorStatusChanged({ status: 'disconnected' });

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'system/updateHealth',
          payload: { vectorDb: 'offline' }
        })
      );
    });

    test('normalizes connecting status', () => {
      ipcMiddleware(mockStore);
      markStoreReady();

      handlers.vectorStatusChanged({ status: 'initializing' });

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'system/updateHealth',
          payload: { vectorDb: 'connecting' }
        })
      );
    });

    test('returns unknown for unrecognized status', () => {
      ipcMiddleware(mockStore);
      markStoreReady();

      handlers.vectorStatusChanged({ status: 'something_new' });

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'system/updateHealth',
          payload: { vectorDb: 'unknown' }
        })
      );
    });
  });

  describe('validation failure', () => {
    test('drops events with invalid payloads', () => {
      const { validateEventPayload } = require('../src/shared/ipcEventSchemas');
      validateEventPayload.mockReturnValueOnce({ valid: false, error: 'bad schema' });

      ipcMiddleware(mockStore);
      markStoreReady();
      mockDispatch.mockClear();

      handlers.operationProgress({ invalid: 'data' });

      // Should not dispatch updateProgress for invalid data
      const progressCalls = mockDispatch.mock.calls.filter(
        (c) => c[0]?.type === 'analysis/updateProgress'
      );
      expect(progressCalls).toHaveLength(0);
    });
  });

  describe('markStoreReady idempotency', () => {
    test('does nothing when called multiple times', () => {
      ipcMiddleware(mockStore);

      handlers.operationProgress({ percent: 10 });
      markStoreReady();

      const firstDispatchCount = mockDispatch.mock.calls.length;

      markStoreReady(); // Second call should be no-op

      expect(mockDispatch.mock.calls.length).toBe(firstDispatchCount);
    });
  });

  describe('recoverPersistedCriticalEvents', () => {
    test('does nothing when no dropped critical events', () => {
      ipcMiddleware(mockStore);
      markStoreReady();
      mockDispatch.mockClear();

      recoverPersistedCriticalEvents();

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    test('dispatches warning when critical events are dropped under queue pressure', () => {
      ipcMiddleware(mockStore);
      // operationProgress maps to updateProgress (critical action).
      for (let i = 0; i < 350; i += 1) {
        handlers.operationProgress({ type: 'batch_analyze', completed: i, total: 400 });
      }
      markStoreReady();

      const warningCalls = mockDispatch.mock.calls.filter(
        (entry) =>
          entry[0]?.type === 'system/addNotification' &&
          String(entry[0]?.payload?.message || '').includes('critical updates were dropped')
      );
      expect(warningCalls.length).toBeGreaterThan(0);
    });
  });
});
