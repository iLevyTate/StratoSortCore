/**
 * Tests for IPC Channel Registry
 * Tests targeted IPC channel registration and cleanup
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

describe('ipcRegistry', () => {
  let ipcRegistry;
  let mockIpcMain;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    mockIpcMain = {
      handle: jest.fn(),
      on: jest.fn(),
      removeHandler: jest.fn(),
      removeListener: jest.fn()
    };

    ipcRegistry = require('../src/main/core/ipcRegistry');
  });

  describe('registerHandler', () => {
    test('registers handler with ipcMain', () => {
      const handler = jest.fn();

      ipcRegistry.registerHandler(mockIpcMain, 'test-channel', handler);

      expect(mockIpcMain.handle).toHaveBeenCalledWith('test-channel', handler);
    });

    test('tracks registered handler', () => {
      const handler = jest.fn();

      ipcRegistry.registerHandler(mockIpcMain, 'test-channel', handler);

      expect(ipcRegistry.hasHandler('test-channel')).toBe(true);
    });

    test('throws error for empty channel', () => {
      expect(() => {
        ipcRegistry.registerHandler(mockIpcMain, '', jest.fn());
      }).toThrow('Channel must be a non-empty string');
    });

    test('throws error for null channel', () => {
      expect(() => {
        ipcRegistry.registerHandler(mockIpcMain, null, jest.fn());
      }).toThrow('Channel must be a non-empty string');
    });

    test('throws error for non-function handler', () => {
      expect(() => {
        ipcRegistry.registerHandler(mockIpcMain, 'channel', 'not a function');
      }).toThrow('Handler must be a function');
    });

    test('throws error for null handler', () => {
      expect(() => {
        ipcRegistry.registerHandler(mockIpcMain, 'channel', null);
      }).toThrow('Handler must be a function');
    });

    test('removes old handler on duplicate registration', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      ipcRegistry.registerHandler(mockIpcMain, 'dup-channel', handler1);
      ipcRegistry.registerHandler(mockIpcMain, 'dup-channel', handler2);

      expect(mockIpcMain.removeHandler).toHaveBeenCalledWith('dup-channel');
      expect(mockIpcMain.handle).toHaveBeenCalledTimes(2);
    });
  });

  describe('registerListener', () => {
    test('registers listener with ipcMain', () => {
      const listener = jest.fn();

      ipcRegistry.registerListener(mockIpcMain, 'test-channel', listener);

      expect(mockIpcMain.on).toHaveBeenCalledWith('test-channel', listener);
    });

    test('tracks registered listener', () => {
      const listener = jest.fn();

      ipcRegistry.registerListener(mockIpcMain, 'test-channel', listener);

      expect(ipcRegistry.hasListeners('test-channel')).toBe(true);
    });

    test('throws error for empty channel', () => {
      expect(() => {
        ipcRegistry.registerListener(mockIpcMain, '', jest.fn());
      }).toThrow('Channel must be a non-empty string');
    });

    test('throws error for non-function listener', () => {
      expect(() => {
        ipcRegistry.registerListener(mockIpcMain, 'channel', 'not a function');
      }).toThrow('Listener must be a function');
    });

    test('allows multiple listeners on same channel', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      ipcRegistry.registerListener(mockIpcMain, 'channel', listener1);
      ipcRegistry.registerListener(mockIpcMain, 'channel', listener2);

      expect(mockIpcMain.on).toHaveBeenCalledTimes(2);
      expect(ipcRegistry.hasListeners('channel')).toBe(true);
    });
  });

  describe('removeHandler', () => {
    test('removes registered handler', () => {
      ipcRegistry.registerHandler(mockIpcMain, 'test-channel', jest.fn());

      const result = ipcRegistry.removeHandler(mockIpcMain, 'test-channel');

      expect(result).toBe(true);
      expect(mockIpcMain.removeHandler).toHaveBeenCalledWith('test-channel');
      expect(ipcRegistry.hasHandler('test-channel')).toBe(false);
    });

    test('returns false for unregistered handler', () => {
      const result = ipcRegistry.removeHandler(mockIpcMain, 'nonexistent');

      expect(result).toBe(false);
    });

    test('returns false on removeHandler error', () => {
      ipcRegistry.registerHandler(mockIpcMain, 'test-channel', jest.fn());
      mockIpcMain.removeHandler.mockImplementation(() => {
        throw new Error('Remove failed');
      });

      const result = ipcRegistry.removeHandler(mockIpcMain, 'test-channel');

      expect(result).toBe(false);
    });
  });

  describe('removeListener', () => {
    test('removes registered listener', () => {
      const listener = jest.fn();
      ipcRegistry.registerListener(mockIpcMain, 'test-channel', listener);

      const result = ipcRegistry.removeListener(mockIpcMain, 'test-channel', listener);

      expect(result).toBe(true);
      expect(mockIpcMain.removeListener).toHaveBeenCalledWith('test-channel', listener);
    });

    test('returns false for unregistered channel', () => {
      const result = ipcRegistry.removeListener(mockIpcMain, 'nonexistent', jest.fn());

      expect(result).toBe(false);
    });

    test('returns false for unregistered listener', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      ipcRegistry.registerListener(mockIpcMain, 'channel', listener1);

      const result = ipcRegistry.removeListener(mockIpcMain, 'channel', listener2);

      expect(result).toBe(false);
    });

    test('cleans up channel when last listener removed', () => {
      const listener = jest.fn();
      ipcRegistry.registerListener(mockIpcMain, 'channel', listener);

      ipcRegistry.removeListener(mockIpcMain, 'channel', listener);

      expect(ipcRegistry.hasListeners('channel')).toBe(false);
    });

    test('returns false on removeListener error', () => {
      const listener = jest.fn();
      ipcRegistry.registerListener(mockIpcMain, 'channel', listener);
      mockIpcMain.removeListener.mockImplementation(() => {
        throw new Error('Remove failed');
      });

      const result = ipcRegistry.removeListener(mockIpcMain, 'channel', listener);

      expect(result).toBe(false);
    });
  });

  describe('removeAllRegistered', () => {
    test('removes all handlers and listeners', () => {
      ipcRegistry.registerHandler(mockIpcMain, 'handler1', jest.fn());
      ipcRegistry.registerHandler(mockIpcMain, 'handler2', jest.fn());
      ipcRegistry.registerListener(mockIpcMain, 'listener1', jest.fn());

      const result = ipcRegistry.removeAllRegistered(mockIpcMain);

      expect(result.handlers).toBe(2);
      expect(result.listeners).toBe(1);
    });

    test('clears registry after removal', () => {
      ipcRegistry.registerHandler(mockIpcMain, 'handler', jest.fn());
      ipcRegistry.registerListener(mockIpcMain, 'listener', jest.fn());

      ipcRegistry.removeAllRegistered(mockIpcMain);

      expect(ipcRegistry.hasHandler('handler')).toBe(false);
      expect(ipcRegistry.hasListeners('listener')).toBe(false);
    });

    test('handles errors during cleanup', () => {
      ipcRegistry.registerHandler(mockIpcMain, 'handler', jest.fn());
      mockIpcMain.removeHandler.mockImplementation(() => {
        throw new Error('Cleanup error');
      });

      // Should not throw
      expect(() => {
        ipcRegistry.removeAllRegistered(mockIpcMain);
      }).not.toThrow();
    });

    test('returns zero counts for empty registry', () => {
      const result = ipcRegistry.removeAllRegistered(mockIpcMain);

      expect(result.handlers).toBe(0);
      expect(result.listeners).toBe(0);
    });
  });

  describe('getStats', () => {
    test('returns handler count', () => {
      ipcRegistry.registerHandler(mockIpcMain, 'handler1', jest.fn());
      ipcRegistry.registerHandler(mockIpcMain, 'handler2', jest.fn());

      const stats = ipcRegistry.getStats();

      expect(stats.handlers).toBe(2);
    });

    test('returns listener count', () => {
      ipcRegistry.registerListener(mockIpcMain, 'listener1', jest.fn());
      ipcRegistry.registerListener(mockIpcMain, 'listener1', jest.fn());
      ipcRegistry.registerListener(mockIpcMain, 'listener2', jest.fn());

      const stats = ipcRegistry.getStats();

      expect(stats.listeners).toBe(3);
    });

    test('returns sorted channel list', () => {
      ipcRegistry.registerHandler(mockIpcMain, 'zebra', jest.fn());
      ipcRegistry.registerHandler(mockIpcMain, 'alpha', jest.fn());
      ipcRegistry.registerListener(mockIpcMain, 'beta', jest.fn());

      const stats = ipcRegistry.getStats();

      expect(stats.channels).toEqual(['alpha', 'beta', 'zebra']);
    });

    test('returns empty stats for empty registry', () => {
      const stats = ipcRegistry.getStats();

      expect(stats.handlers).toBe(0);
      expect(stats.listeners).toBe(0);
      expect(stats.channels).toEqual([]);
    });
  });

  describe('hasHandler', () => {
    test('returns true for registered handler', () => {
      ipcRegistry.registerHandler(mockIpcMain, 'channel', jest.fn());

      expect(ipcRegistry.hasHandler('channel')).toBe(true);
    });

    test('returns false for unregistered handler', () => {
      expect(ipcRegistry.hasHandler('nonexistent')).toBe(false);
    });
  });

  describe('hasListeners', () => {
    test('returns true for channel with listeners', () => {
      ipcRegistry.registerListener(mockIpcMain, 'channel', jest.fn());

      expect(ipcRegistry.hasListeners('channel')).toBe(true);
    });

    test('returns false for channel without listeners', () => {
      expect(ipcRegistry.hasListeners('nonexistent')).toBe(false);
    });

    test('returns false for channel with empty listener set', () => {
      const listener = jest.fn();
      ipcRegistry.registerListener(mockIpcMain, 'channel', listener);
      ipcRegistry.removeListener(mockIpcMain, 'channel', listener);

      expect(ipcRegistry.hasListeners('channel')).toBe(false);
    });
  });
});
