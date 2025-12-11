/**
 * Tests for useViewport hook
 * Tests viewport dimension tracking and breakpoint detection
 */

import { renderHook, act } from '@testing-library/react';
import { useViewport } from '../src/renderer/hooks/useViewport';

// Mock performanceConstants
jest.mock('../src/shared/performanceConstants', () => ({
  VIEWPORT: {
    DESKTOP: 1024,
    WIDE_DESKTOP: 1440,
    ULTRA_WIDE: 2560,
    FOUR_K: 3840
  }
}));

describe('useViewport', () => {
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    // Reset window dimensions
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 1920
    });
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      value: 1080
    });
    jest.useFakeTimers();
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: originalInnerWidth
    });
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      value: originalInnerHeight
    });
    jest.useRealTimers();
  });

  test('returns initial viewport dimensions', () => {
    const { result } = renderHook(() => useViewport());

    expect(result.current.width).toBe(1920);
    expect(result.current.height).toBe(1080);
  });

  test('calculates isDesktop correctly', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1200 });
    const { result } = renderHook(() => useViewport());

    expect(result.current.isDesktop).toBe(true);
  });

  test('calculates isDesktop false for small screens', () => {
    Object.defineProperty(window, 'innerWidth', { value: 800 });
    const { result } = renderHook(() => useViewport());

    expect(result.current.isDesktop).toBe(false);
  });

  test('calculates isWideDesktop correctly', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1600 });
    const { result } = renderHook(() => useViewport());

    expect(result.current.isWideDesktop).toBe(true);
  });

  test('calculates isUltraWide correctly', () => {
    Object.defineProperty(window, 'innerWidth', { value: 2800 });
    const { result } = renderHook(() => useViewport());

    expect(result.current.isUltraWide).toBe(true);
  });

  test('calculates is4K correctly', () => {
    Object.defineProperty(window, 'innerWidth', { value: 4096 });
    const { result } = renderHook(() => useViewport());

    expect(result.current.is4K).toBe(true);
  });

  test('updates on window resize', async () => {
    const { result } = renderHook(() => useViewport());

    expect(result.current.width).toBe(1920);

    // Trigger resize
    act(() => {
      Object.defineProperty(window, 'innerWidth', { value: 1280 });
      Object.defineProperty(window, 'innerHeight', { value: 720 });
      window.dispatchEvent(new Event('resize'));
    });

    // Fast-forward debounce timer
    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(result.current.width).toBe(1280);
    expect(result.current.height).toBe(720);
  });

  test('debounces resize events', () => {
    const { result } = renderHook(() => useViewport());

    // Trigger multiple rapid resizes
    act(() => {
      for (let i = 0; i < 5; i++) {
        Object.defineProperty(window, 'innerWidth', { value: 1000 + i * 100 });
        window.dispatchEvent(new Event('resize'));
      }
    });

    // Before debounce completes, should still have original value
    expect(result.current.width).toBe(1920);

    // After debounce
    act(() => {
      jest.advanceTimersByTime(200);
    });

    // Should have final value
    expect(result.current.width).toBe(1400);
  });

  test('cleans up event listener on unmount', () => {
    const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useViewport());
    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));

    removeEventListenerSpy.mockRestore();
  });

  test('clears timeout on unmount', () => {
    const { unmount } = renderHook(() => useViewport());

    // Trigger resize to create pending timeout
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    // Unmount should clear the timeout
    unmount();

    // Advancing timers should not cause errors
    act(() => {
      jest.advanceTimersByTime(200);
    });
  });
});
