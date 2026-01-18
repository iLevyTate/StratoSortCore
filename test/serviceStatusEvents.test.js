/**
 * Tests for serviceStatusEvents.js
 * Tests the service status event emitter functionality
 */

// FIX: Mock ipcWrappers to pass through safeSend calls to webContents.send
jest.mock('../src/main/ipc/ipcWrappers', () => ({
  safeSend: (webContents, channel, data) => {
    webContents.send(channel, data);
  }
}));

const {
  configureServiceStatusEmitter,
  emitServiceStatusChange
} = require('../src/main/ipc/serviceStatusEvents');

describe('Service Status Events', () => {
  let mockWindow;
  let mockLogger;
  let mockIPC_CHANNELS;

  beforeEach(() => {
    // Reset modules to clear state between tests
    jest.resetModules();

    // Mock window with webContents
    mockWindow = {
      isDestroyed: jest.fn().mockReturnValue(false),
      webContents: {
        send: jest.fn()
      }
    };

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    // Mock IPC channels
    mockIPC_CHANNELS = {
      DEPENDENCIES: {
        SERVICE_STATUS_CHANGED: 'dependencies-service-status-changed'
      }
    };
  });

  describe('configureServiceStatusEmitter', () => {
    it('should configure with valid parameters', () => {
      expect(() =>
        configureServiceStatusEmitter({
          getMainWindow: () => mockWindow,
          IPC_CHANNELS: mockIPC_CHANNELS,
          logger: mockLogger
        })
      ).not.toThrow();
    });

    it('should handle null getMainWindow gracefully', () => {
      expect(() =>
        configureServiceStatusEmitter({
          getMainWindow: null,
          IPC_CHANNELS: mockIPC_CHANNELS,
          logger: mockLogger
        })
      ).not.toThrow();
    });

    it('should handle missing logger gracefully', () => {
      expect(() =>
        configureServiceStatusEmitter({
          getMainWindow: () => mockWindow,
          IPC_CHANNELS: mockIPC_CHANNELS,
          logger: null
        })
      ).not.toThrow();
    });

    it('should handle missing IPC_CHANNELS gracefully', () => {
      expect(() =>
        configureServiceStatusEmitter({
          getMainWindow: () => mockWindow,
          IPC_CHANNELS: null,
          logger: mockLogger
        })
      ).not.toThrow();
    });
  });

  describe('emitServiceStatusChange', () => {
    beforeEach(() => {
      // Configure the emitter before each test
      configureServiceStatusEmitter({
        getMainWindow: () => mockWindow,
        IPC_CHANNELS: mockIPC_CHANNELS,
        logger: mockLogger
      });
    });

    it('should emit service status change to renderer', () => {
      const payload = {
        service: 'ollama',
        status: 'running',
        health: 'healthy',
        details: { version: '0.1.0' }
      };

      emitServiceStatusChange(payload);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'dependencies-service-status-changed',
        expect.objectContaining({
          service: 'ollama',
          status: 'running',
          health: 'healthy',
          details: { version: '0.1.0' },
          timestamp: expect.any(Number)
        })
      );
    });

    it('should add timestamp to payload', () => {
      const beforeTime = Date.now();

      emitServiceStatusChange({
        service: 'chromadb',
        status: 'starting',
        health: 'unknown'
      });

      const afterTime = Date.now();
      const sentPayload = mockWindow.webContents.send.mock.calls[0][1];

      expect(sentPayload.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(sentPayload.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should log debug message on successful emit', () => {
      emitServiceStatusChange({
        service: 'ollama',
        status: 'stopped',
        health: 'unhealthy'
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[ServiceStatusEvents] Emitted service status change',
        expect.objectContaining({
          service: 'ollama',
          status: 'stopped'
        })
      );
    });

    it('should not emit if window is destroyed', () => {
      mockWindow.isDestroyed.mockReturnValue(true);

      emitServiceStatusChange({
        service: 'ollama',
        status: 'running',
        health: 'healthy'
      });

      expect(mockWindow.webContents.send).not.toHaveBeenCalled();
    });

    it('should not emit if window is null', () => {
      configureServiceStatusEmitter({
        getMainWindow: () => null,
        IPC_CHANNELS: mockIPC_CHANNELS,
        logger: mockLogger
      });

      emitServiceStatusChange({
        service: 'ollama',
        status: 'running',
        health: 'healthy'
      });

      expect(mockWindow.webContents.send).not.toHaveBeenCalled();
    });

    it('should handle emit errors gracefully', () => {
      mockWindow.webContents.send.mockImplementation(() => {
        throw new Error('Send failed');
      });

      // Should not throw
      expect(() =>
        emitServiceStatusChange({
          service: 'ollama',
          status: 'running',
          health: 'healthy'
        })
      ).not.toThrow();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[ServiceStatusEvents] Failed to emit service status',
        expect.objectContaining({
          error: 'Send failed'
        })
      );
    });

    it('should handle chromadb service status', () => {
      emitServiceStatusChange({
        service: 'chromadb',
        status: 'failed',
        health: 'permanently_failed',
        details: { error: 'Connection refused' }
      });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'dependencies-service-status-changed',
        expect.objectContaining({
          service: 'chromadb',
          status: 'failed',
          health: 'permanently_failed'
        })
      );
    });

    it('should not emit if IPC_CHANNELS not configured', () => {
      configureServiceStatusEmitter({
        getMainWindow: () => mockWindow,
        IPC_CHANNELS: null,
        logger: mockLogger
      });

      emitServiceStatusChange({
        service: 'ollama',
        status: 'running',
        health: 'healthy'
      });

      expect(mockWindow.webContents.send).not.toHaveBeenCalled();
    });

    it('should not emit if DEPENDENCIES channel missing', () => {
      configureServiceStatusEmitter({
        getMainWindow: () => mockWindow,
        IPC_CHANNELS: {},
        logger: mockLogger
      });

      emitServiceStatusChange({
        service: 'ollama',
        status: 'running',
        health: 'healthy'
      });

      expect(mockWindow.webContents.send).not.toHaveBeenCalled();
    });
  });
});
