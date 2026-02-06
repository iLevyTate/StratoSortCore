import { renderHook, act } from '@testing-library/react';
import { useViewport } from '../src/renderer/hooks/useViewport';
import { VIEWPORT } from '../src/shared/performanceConstants';

describe('useViewport', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function setWindowSize(width, height) {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: width
    });
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: height
    });
  }

  test('returns initial viewport state', () => {
    setWindowSize(VIEWPORT.DESKTOP + 10, 900);

    const { result } = renderHook(() => useViewport());

    expect(result.current.width).toBe(VIEWPORT.DESKTOP + 10);
    expect(result.current.height).toBe(900);
    expect(result.current.isDesktop).toBe(true);
    expect(result.current.isWideDesktop).toBe(false);
  });

  test('updates viewport on resize after debounce', () => {
    setWindowSize(VIEWPORT.DESKTOP, 800);

    const { result } = renderHook(() => useViewport());

    act(() => {
      setWindowSize(VIEWPORT.ULTRA_WIDE + 100, 1000);
      window.dispatchEvent(new Event('resize'));
      jest.advanceTimersByTime(150);
    });

    expect(result.current.width).toBe(VIEWPORT.ULTRA_WIDE + 100);
    expect(result.current.height).toBe(1000);
    expect(result.current.isUltraWide).toBe(true);
  });

  test('cleans up resize listener on unmount', () => {
    const removeListener = jest.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useViewport());
    unmount();

    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
    removeListener.mockRestore();
  });
});
