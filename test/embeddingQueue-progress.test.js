/**
 * Tests for Embedding Queue Progress Module
 * Tests progress callback registration and notification
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

describe('Embedding Queue Progress', () => {
  let createProgressTracker;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    const module = require('../src/main/analysis/embeddingQueue/progress');
    createProgressTracker = module.createProgressTracker;
  });

  describe('createProgressTracker', () => {
    test('creates a progress tracker instance', () => {
      const tracker = createProgressTracker();

      expect(tracker).toBeDefined();
      expect(typeof tracker.onProgress).toBe('function');
      expect(typeof tracker.notify).toBe('function');
      expect(typeof tracker.clear).toBe('function');
    });
  });

  describe('onProgress', () => {
    test('registers a progress callback', () => {
      const tracker = createProgressTracker();
      const callback = jest.fn();

      const unsubscribe = tracker.onProgress(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    test('returns unsubscribe function', () => {
      const tracker = createProgressTracker();
      const callback = jest.fn();

      const unsubscribe = tracker.onProgress(callback);

      tracker.notify({ progress: 50 });
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();
      tracker.notify({ progress: 75 });
      expect(callback).toHaveBeenCalledTimes(1);
    });

    test('allows multiple callbacks', () => {
      const tracker = createProgressTracker();
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      tracker.onProgress(callback1);
      tracker.onProgress(callback2);

      tracker.notify({ progress: 50 });

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });
  });

  describe('notify', () => {
    test('calls all registered callbacks with progress data', () => {
      const tracker = createProgressTracker();
      const callback = jest.fn();
      const progress = { phase: 'processing', completed: 5, total: 10 };

      tracker.onProgress(callback);
      tracker.notify(progress);

      expect(callback).toHaveBeenCalledWith(progress);
    });

    test('handles callback errors gracefully', () => {
      const { logger } = require('../src/shared/logger');
      const tracker = createProgressTracker();
      const errorCallback = jest.fn(() => {
        throw new Error('Callback error');
      });
      const goodCallback = jest.fn();

      tracker.onProgress(errorCallback);
      tracker.onProgress(goodCallback);

      // Should not throw
      expect(() => tracker.notify({ progress: 50 })).not.toThrow();

      // Error callback threw, good callback still called
      expect(errorCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    test('does nothing with no callbacks', () => {
      const tracker = createProgressTracker();

      // Should not throw
      expect(() => tracker.notify({ progress: 50 })).not.toThrow();
    });
  });

  describe('clear', () => {
    test('removes all callbacks', () => {
      const tracker = createProgressTracker();
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      tracker.onProgress(callback1);
      tracker.onProgress(callback2);

      tracker.clear();
      tracker.notify({ progress: 50 });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });
  });
});
