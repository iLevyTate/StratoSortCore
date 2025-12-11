/**
 * Tests for usePerformance hooks
 * Tests debounce, throttle, and LRU cache hooks
 */

import { renderHook, act } from '@testing-library/react';

// Mock the performance utilities
jest.mock('../src/renderer/utils/performance', () => ({
  debounce: (fn, delay) => {
    let timeoutId;
    const debounced = (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), delay);
    };
    debounced.cancel = () => clearTimeout(timeoutId);
    return debounced;
  },
  throttle: (fn, delay) => {
    let lastCall = 0;
    let timeoutId;
    const throttled = (...args) => {
      const now = Date.now();
      if (now - lastCall >= delay) {
        lastCall = now;
        fn(...args);
      } else {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(
          () => {
            lastCall = Date.now();
            fn(...args);
          },
          delay - (now - lastCall)
        );
      }
    };
    throttled.cancel = () => clearTimeout(timeoutId);
    return throttled;
  },
  createLRUCache: (maxSize) => {
    const cache = new Map();
    return {
      get: (key) => cache.get(key),
      set: (key, value) => {
        if (cache.size >= maxSize && !cache.has(key)) {
          const firstKey = cache.keys().next().value;
          cache.delete(firstKey);
        }
        cache.set(key, value);
      },
      has: (key) => cache.has(key),
      delete: (key) => cache.delete(key),
      clear: () => cache.clear(),
      size: () => cache.size
    };
  }
}));

import {
  useDebounce,
  useDebouncedCallback,
  useThrottledCallback,
  useLRUCache
} from '../src/renderer/hooks/usePerformance';

describe('usePerformance hooks', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('useDebounce', () => {
    test('returns initial value immediately', () => {
      const { result } = renderHook(() => useDebounce('initial', 500));

      expect(result.current).toBe('initial');
    });

    test('updates value after delay', () => {
      const { result, rerender } = renderHook(({ value }) => useDebounce(value, 500), {
        initialProps: { value: 'initial' }
      });

      expect(result.current).toBe('initial');

      rerender({ value: 'updated' });

      // Value should still be initial before delay
      expect(result.current).toBe('initial');

      // Advance timer
      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(result.current).toBe('updated');
    });

    test('resets timer on rapid changes', () => {
      const { result, rerender } = renderHook(({ value }) => useDebounce(value, 500), {
        initialProps: { value: 'initial' }
      });

      rerender({ value: 'first' });
      act(() => {
        jest.advanceTimersByTime(200);
      });

      rerender({ value: 'second' });
      act(() => {
        jest.advanceTimersByTime(200);
      });

      rerender({ value: 'third' });
      act(() => {
        jest.advanceTimersByTime(200);
      });

      // Should still be initial
      expect(result.current).toBe('initial');

      // Complete the debounce
      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(result.current).toBe('third');
    });

    test('clears timeout on unmount', () => {
      const { unmount } = renderHook(() => useDebounce('value', 500));

      unmount();

      // Should not throw
      act(() => {
        jest.advanceTimersByTime(500);
      });
    });

    test('updates immediately when delay changes', () => {
      const { result, rerender } = renderHook(({ value, delay }) => useDebounce(value, delay), {
        initialProps: { value: 'initial', delay: 500 }
      });

      rerender({ value: 'updated', delay: 100 });

      act(() => {
        jest.advanceTimersByTime(100);
      });

      expect(result.current).toBe('updated');
    });
  });

  describe('useDebouncedCallback', () => {
    test('returns a function', () => {
      const callback = jest.fn();
      const { result } = renderHook(() => useDebouncedCallback(callback, 500));

      expect(typeof result.current).toBe('function');
    });

    test('debounces the callback', () => {
      const callback = jest.fn();
      const { result } = renderHook(() => useDebouncedCallback(callback, 500));

      act(() => {
        result.current('arg1');
        result.current('arg2');
        result.current('arg3');
      });

      expect(callback).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('arg3');
    });

    test('passes arguments to callback', () => {
      const callback = jest.fn();
      const { result } = renderHook(() => useDebouncedCallback(callback, 500));

      act(() => {
        result.current('arg1', 'arg2', { key: 'value' });
      });

      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(callback).toHaveBeenCalledWith('arg1', 'arg2', { key: 'value' });
    });

    test('cancels on unmount', () => {
      const callback = jest.fn();
      const { result, unmount } = renderHook(() => useDebouncedCallback(callback, 500));

      act(() => {
        result.current('arg1');
      });

      unmount();

      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(callback).not.toHaveBeenCalled();
    });

    test('uses latest callback via ref', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      const { result, rerender } = renderHook(({ cb }) => useDebouncedCallback(cb, 500), {
        initialProps: { cb: callback1 }
      });

      act(() => {
        result.current('first call');
      });

      // Update callback
      rerender({ cb: callback2 });

      act(() => {
        jest.advanceTimersByTime(500);
      });

      // Should call the updated callback
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith('first call');
    });
  });

  describe('useThrottledCallback', () => {
    test('returns a function', () => {
      const callback = jest.fn();
      const { result } = renderHook(() => useThrottledCallback(callback, 500));

      expect(typeof result.current).toBe('function');
    });

    test('calls callback immediately on first call', () => {
      const callback = jest.fn();
      const { result } = renderHook(() => useThrottledCallback(callback, 500));

      act(() => {
        result.current('arg1');
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('arg1');
    });

    test('throttles subsequent calls', () => {
      const callback = jest.fn();
      const { result } = renderHook(() => useThrottledCallback(callback, 500));

      act(() => {
        result.current('call1');
        result.current('call2');
        result.current('call3');
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('call1');

      // After throttle period
      act(() => {
        jest.advanceTimersByTime(500);
      });

      // Should call with last queued args
      expect(callback).toHaveBeenCalledTimes(2);
    });

    test('cancels on unmount', () => {
      const callback = jest.fn();
      const { result, unmount } = renderHook(() => useThrottledCallback(callback, 500));

      act(() => {
        result.current('arg1');
        result.current('arg2');
      });

      expect(callback).toHaveBeenCalledTimes(1);

      unmount();

      act(() => {
        jest.advanceTimersByTime(500);
      });

      // Should not have called again after unmount
      expect(callback).toHaveBeenCalledTimes(1);
    });

    test('uses latest callback via ref', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      const { result, rerender } = renderHook(({ cb }) => useThrottledCallback(cb, 500), {
        initialProps: { cb: callback1 }
      });

      // First call goes through
      act(() => {
        result.current('first');
      });

      expect(callback1).toHaveBeenCalledWith('first');

      // Update callback and make another call
      rerender({ cb: callback2 });

      act(() => {
        result.current('second');
      });

      // Wait for throttle to allow next call
      act(() => {
        jest.advanceTimersByTime(500);
      });

      // Second callback should be called
      expect(callback2).toHaveBeenCalled();
    });
  });

  describe('useLRUCache', () => {
    test('returns cache instance', () => {
      const { result } = renderHook(() => useLRUCache(100));

      expect(result.current).toBeDefined();
      expect(typeof result.current.get).toBe('function');
      expect(typeof result.current.set).toBe('function');
      expect(typeof result.current.has).toBe('function');
      expect(typeof result.current.delete).toBe('function');
      expect(typeof result.current.clear).toBe('function');
    });

    test('stores and retrieves values', () => {
      const { result } = renderHook(() => useLRUCache(100));

      act(() => {
        result.current.set('key1', 'value1');
        result.current.set('key2', 'value2');
      });

      expect(result.current.get('key1')).toBe('value1');
      expect(result.current.get('key2')).toBe('value2');
    });

    test('checks if key exists', () => {
      const { result } = renderHook(() => useLRUCache(100));

      act(() => {
        result.current.set('key1', 'value1');
      });

      expect(result.current.has('key1')).toBe(true);
      expect(result.current.has('key2')).toBe(false);
    });

    test('deletes keys', () => {
      const { result } = renderHook(() => useLRUCache(100));

      act(() => {
        result.current.set('key1', 'value1');
        result.current.delete('key1');
      });

      expect(result.current.has('key1')).toBe(false);
    });

    test('clears all entries', () => {
      const { result } = renderHook(() => useLRUCache(100));

      act(() => {
        result.current.set('key1', 'value1');
        result.current.set('key2', 'value2');
        result.current.clear();
      });

      expect(result.current.has('key1')).toBe(false);
      expect(result.current.has('key2')).toBe(false);
    });

    test('maintains same instance across re-renders', () => {
      const { result, rerender } = renderHook(() => useLRUCache(100));

      const cache1 = result.current;

      act(() => {
        cache1.set('key1', 'value1');
      });

      rerender();

      expect(result.current).toBe(cache1);
      expect(result.current.get('key1')).toBe('value1');
    });

    test('uses default size of 100', () => {
      const { result } = renderHook(() => useLRUCache());

      // Should not throw with default size
      act(() => {
        result.current.set('key', 'value');
      });

      expect(result.current.get('key')).toBe('value');
    });

    test('evicts oldest entry when capacity exceeded', () => {
      const { result } = renderHook(() => useLRUCache(2));

      act(() => {
        result.current.set('key1', 'value1');
        result.current.set('key2', 'value2');
        result.current.set('key3', 'value3');
      });

      // First entry should be evicted
      expect(result.current.has('key1')).toBe(false);
      expect(result.current.has('key2')).toBe(true);
      expect(result.current.has('key3')).toBe(true);
    });
  });
});
