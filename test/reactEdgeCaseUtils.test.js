/**
 * Tests for React Edge Case Utilities
 * Tests safe React patterns and hooks
 */

import { renderHook, act } from '@testing-library/react';

describe('reactEdgeCaseUtils', () => {
  let reactEdgeCaseUtils;

  beforeEach(() => {
    // jest.resetModules(); // Removed - breaks React hooks context
    reactEdgeCaseUtils = require('../src/renderer/utils/reactEdgeCaseUtils');
  });

  describe('useSafeState', () => {
    test('initializes with initial value', () => {
      const { result } = renderHook(() => reactEdgeCaseUtils.useSafeState('initial'));

      expect(result.current[0]).toBe('initial');
    });

    test('updates state when mounted', () => {
      const { result } = renderHook(() => reactEdgeCaseUtils.useSafeState('initial'));

      act(() => {
        result.current[1]('updated');
      });

      expect(result.current[0]).toBe('updated');
    });

    test('does not update state after unmount', () => {
      const { result, unmount } = renderHook(() => reactEdgeCaseUtils.useSafeState('initial'));

      const setter = result.current[1];
      unmount();

      // This should not throw or cause warnings
      act(() => {
        setter('should not update');
      });

      // State cannot be checked after unmount, but no error should occur
    });

    test('initializes with null', () => {
      const { result } = renderHook(() => reactEdgeCaseUtils.useSafeState(null));

      expect(result.current[0]).toBe(null);
    });

    test('initializes with undefined', () => {
      const { result } = renderHook(() => reactEdgeCaseUtils.useSafeState(undefined));

      expect(result.current[0]).toBe(undefined);
    });

    test('initializes with object', () => {
      const initialValue = { key: 'value' };
      const { result } = renderHook(() => reactEdgeCaseUtils.useSafeState(initialValue));

      expect(result.current[0]).toEqual({ key: 'value' });
    });

    test('initializes with array', () => {
      const initialValue = [1, 2, 3];
      const { result } = renderHook(() => reactEdgeCaseUtils.useSafeState(initialValue));

      expect(result.current[0]).toEqual([1, 2, 3]);
    });

    test('handles multiple updates', () => {
      const { result } = renderHook(() => reactEdgeCaseUtils.useSafeState(0));

      act(() => {
        result.current[1](1);
      });
      expect(result.current[0]).toBe(1);

      act(() => {
        result.current[1](2);
      });
      expect(result.current[0]).toBe(2);

      act(() => {
        result.current[1](3);
      });
      expect(result.current[0]).toBe(3);
    });
  });

  describe('debounce export', () => {
    test('exports debounce function', () => {
      expect(typeof reactEdgeCaseUtils.debounce).toBe('function');
    });

    test('debounce delays function execution', () => {
      jest.useFakeTimers();
      const fn = jest.fn();
      const debouncedFn = reactEdgeCaseUtils.debounce(fn, 100);

      debouncedFn();
      expect(fn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    test('debounce coalesces multiple calls', () => {
      jest.useFakeTimers();
      const fn = jest.fn();
      const debouncedFn = reactEdgeCaseUtils.debounce(fn, 100);

      debouncedFn();
      debouncedFn();
      debouncedFn();

      jest.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });
  });
});
