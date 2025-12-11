/**
 * Tests for Undo/Redo IPC Handlers
 * Tests undo, redo, and action history operations
 */

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

// Mock errorHandlingUtils
jest.mock('../src/shared/errorHandlingUtils', () => ({
  createSuccessResponse: jest.fn((data) => ({ success: true, data })),
  ERROR_CODES: {
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE'
  }
}));

// Mock ipcRegistry
jest.mock('../src/main/core/ipcRegistry', () => ({
  registerHandler: jest.fn()
}));

describe('Undo/Redo IPC Handlers', () => {
  let registerUndoRedoIpc;
  let mockIpcMain;
  let mockLogger;
  let handlers;
  let mockUndoRedoService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    mockIpcMain = {
      handle: jest.fn()
    };

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockUndoRedoService = {
      undo: jest.fn(),
      redo: jest.fn(),
      getHistory: jest.fn(),
      clearHistory: jest.fn(),
      canUndo: jest.fn(),
      canRedo: jest.fn()
    };

    handlers = {};

    // Capture registered handlers
    mockIpcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    registerUndoRedoIpc = require('../src/main/ipc/undoRedo');
  });

  const setupHandlers = (serviceAvailable = true) => {
    registerUndoRedoIpc({
      ipcMain: mockIpcMain,
      IPC_CHANNELS: {
        UNDO_REDO: {
          UNDO: 'undo-redo:undo',
          REDO: 'undo-redo:redo',
          GET_HISTORY: 'undo-redo:get-history',
          CLEAR_HISTORY: 'undo-redo:clear-history',
          CAN_UNDO: 'undo-redo:can-undo',
          CAN_REDO: 'undo-redo:can-redo'
        }
      },
      logger: mockLogger,
      getServiceIntegration: () => (serviceAvailable ? { undoRedo: mockUndoRedoService } : null)
    });
  };

  describe('registerUndoRedoIpc', () => {
    test('registers all handlers', () => {
      setupHandlers();

      expect(mockIpcMain.handle).toHaveBeenCalledTimes(6);
      expect(handlers['undo-redo:undo']).toBeDefined();
      expect(handlers['undo-redo:redo']).toBeDefined();
      expect(handlers['undo-redo:get-history']).toBeDefined();
      expect(handlers['undo-redo:clear-history']).toBeDefined();
      expect(handlers['undo-redo:can-undo']).toBeDefined();
      expect(handlers['undo-redo:can-redo']).toBeDefined();
    });
  });

  describe('undo handler', () => {
    test('executes undo successfully', async () => {
      setupHandlers();
      mockUndoRedoService.undo.mockResolvedValue({
        success: true,
        action: { type: 'move' }
      });

      const handler = handlers['undo-redo:undo'];
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(mockUndoRedoService.undo).toHaveBeenCalled();
    });

    test('returns message when nothing to undo', async () => {
      setupHandlers();
      mockUndoRedoService.undo.mockResolvedValue(null);

      const handler = handlers['undo-redo:undo'];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.message).toBe('Nothing to undo');
    });

    test('returns fallback when service unavailable', async () => {
      setupHandlers(false);

      const handler = handlers['undo-redo:undo'];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.message).toBe('Undo service unavailable');
    });

    test('handles undo error', async () => {
      setupHandlers();
      mockUndoRedoService.undo.mockRejectedValue(new Error('Undo failed'));

      const handler = handlers['undo-redo:undo'];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.message).toBe('Undo failed');
    });
  });

  describe('redo handler', () => {
    test('executes redo successfully', async () => {
      setupHandlers();
      mockUndoRedoService.redo.mockResolvedValue({
        success: true,
        action: { type: 'move' }
      });

      const handler = handlers['undo-redo:redo'];
      const result = await handler({});

      expect(result.success).toBe(true);
    });

    test('returns message when nothing to redo', async () => {
      setupHandlers();
      mockUndoRedoService.redo.mockResolvedValue(null);

      const handler = handlers['undo-redo:redo'];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.message).toBe('Nothing to redo');
    });
  });

  describe('getHistory handler', () => {
    test('returns action history', async () => {
      setupHandlers();
      const history = [
        { id: 1, type: 'move' },
        { id: 2, type: 'copy' }
      ];
      mockUndoRedoService.getHistory.mockResolvedValue(history);

      const handler = handlers['undo-redo:get-history'];
      const result = await handler({}, 50);

      expect(result).toEqual(history);
      expect(mockUndoRedoService.getHistory).toHaveBeenCalledWith(50);
    });

    test('returns empty array when service unavailable', async () => {
      setupHandlers(false);

      const handler = handlers['undo-redo:get-history'];
      const result = await handler({});

      expect(result).toEqual([]);
    });

    test('returns empty array on error', async () => {
      setupHandlers();
      mockUndoRedoService.getHistory.mockRejectedValue(new Error('DB error'));

      const handler = handlers['undo-redo:get-history'];
      const result = await handler({});

      expect(result).toEqual([]);
    });
  });

  describe('clearHistory handler', () => {
    test('clears action history', async () => {
      setupHandlers();
      mockUndoRedoService.clearHistory.mockResolvedValue({ success: true });

      const handler = handlers['undo-redo:clear-history'];
      const result = await handler({});

      expect(result.success).toBe(true);
    });

    test('returns success true when service returns null', async () => {
      setupHandlers();
      mockUndoRedoService.clearHistory.mockResolvedValue(null);

      const handler = handlers['undo-redo:clear-history'];
      const result = await handler({});

      expect(result.success).toBe(true);
    });
  });

  describe('canUndo handler', () => {
    test('returns true when undo available', async () => {
      setupHandlers();
      mockUndoRedoService.canUndo.mockResolvedValue(true);

      const handler = handlers['undo-redo:can-undo'];
      const result = await handler({});

      expect(result).toBe(true);
    });

    test('returns false when undo not available', async () => {
      setupHandlers();
      mockUndoRedoService.canUndo.mockResolvedValue(false);

      const handler = handlers['undo-redo:can-undo'];
      const result = await handler({});

      expect(result).toBe(false);
    });

    test('returns false when service unavailable', async () => {
      setupHandlers(false);

      const handler = handlers['undo-redo:can-undo'];
      const result = await handler({});

      expect(result).toBe(false);
    });
  });

  describe('canRedo handler', () => {
    test('returns true when redo available', async () => {
      setupHandlers();
      mockUndoRedoService.canRedo.mockResolvedValue(true);

      const handler = handlers['undo-redo:can-redo'];
      const result = await handler({});

      expect(result).toBe(true);
    });

    test('returns false when service unavailable', async () => {
      setupHandlers(false);

      const handler = handlers['undo-redo:can-redo'];
      const result = await handler({});

      expect(result).toBe(false);
    });
  });
});
