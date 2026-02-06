import { renderHook, act } from '@testing-library/react';

jest.mock('../src/shared/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

import { useSettingsSubscription } from '../src/renderer/hooks/useSettingsSubscription';
import { logger } from '../src/shared/logger';

describe('useSettingsSubscription', () => {
  let handlerRef;
  let unsubscribe;

  beforeEach(() => {
    handlerRef = { handler: null };
    unsubscribe = jest.fn();
    window.electronAPI = {
      events: {
        onSettingsChanged: jest.fn((handler) => {
          handlerRef.handler = handler;
          return unsubscribe;
        })
      }
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('subscribes and passes normalized settings payload', () => {
    const callback = jest.fn();

    renderHook(() => useSettingsSubscription(callback, { enabled: true }));

    expect(window.electronAPI.events.onSettingsChanged).toHaveBeenCalled();
    act(() => {
      handlerRef.handler({ settings: { theme: 'dark' } });
    });

    expect(callback).toHaveBeenCalledWith({ theme: 'dark' });
  });

  test('filters settings to watchKeys', () => {
    const callback = jest.fn();

    renderHook(() => useSettingsSubscription(callback, { watchKeys: ['a', 'c'] }));

    act(() => {
      handlerRef.handler({ a: 1, b: 2 });
    });

    expect(callback).toHaveBeenCalledWith({ a: 1 });
  });

  test('does not call callback when no relevant keys changed', () => {
    const callback = jest.fn();

    renderHook(() => useSettingsSubscription(callback, { watchKeys: ['x'] }));

    act(() => {
      handlerRef.handler({ a: 1 });
    });

    expect(callback).not.toHaveBeenCalled();
  });

  test('unsubscribes on unmount', () => {
    const callback = jest.fn();

    const { unmount } = renderHook(() => useSettingsSubscription(callback));
    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  test('logs errors thrown by callback', () => {
    const error = new Error('boom');
    const callback = jest.fn(() => {
      throw error;
    });

    renderHook(() => useSettingsSubscription(callback));

    act(() => {
      handlerRef.handler({ settings: { a: 1 } });
    });

    expect(logger.error).toHaveBeenCalledWith('Error handling settings change:', error);
  });

  test('does not subscribe when disabled', () => {
    const callback = jest.fn();

    renderHook(() => useSettingsSubscription(callback, { enabled: false }));

    expect(window.electronAPI.events.onSettingsChanged).not.toHaveBeenCalled();
  });
});
