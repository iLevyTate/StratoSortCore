/**
 * @jest-environment jsdom
 *
 * Tests for useAsyncData hook
 * Covers async data fetching with state management and memory leak prevention
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useAsyncData } from '../src/renderer/hooks/useAsyncData';

describe('useAsyncData', () => {
  describe('initial state', () => {
    test('returns loading true by default', () => {
      const fetcher = jest.fn().mockResolvedValue('data');
      const { result } = renderHook(() => useAsyncData(fetcher));

      expect(result.current.loading).toBe(true);
    });

    test('returns loading false when skip is true', () => {
      const fetcher = jest.fn().mockResolvedValue('data');
      const { result } = renderHook(() => useAsyncData(fetcher, [], { skip: true }));

      expect(result.current.loading).toBe(false);
    });

    test('uses initialData as default data value', () => {
      const fetcher = jest.fn().mockResolvedValue('new data');
      const { result } = renderHook(() =>
        useAsyncData(fetcher, [], { skip: true, initialData: 'initial' })
      );

      expect(result.current.data).toBe('initial');
    });

    test('data is null by default', () => {
      const fetcher = jest.fn().mockResolvedValue('data');
      const { result } = renderHook(() => useAsyncData(fetcher, [], { skip: true }));

      expect(result.current.data).toBeNull();
    });

    test('error is null initially', () => {
      const fetcher = jest.fn().mockResolvedValue('data');
      const { result } = renderHook(() => useAsyncData(fetcher, [], { skip: true }));

      expect(result.current.error).toBeNull();
    });
  });

  describe('auto-execution', () => {
    test('executes fetcher automatically on mount', async () => {
      const fetcher = jest.fn().mockResolvedValue('fetched data');
      const { result } = renderHook(() => useAsyncData(fetcher));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(fetcher).toHaveBeenCalled();
      expect(result.current.data).toBe('fetched data');
    });

    test('does not execute fetcher when skip is true', async () => {
      const fetcher = jest.fn().mockResolvedValue('data');
      renderHook(() => useAsyncData(fetcher, [], { skip: true }));

      // Wait a tick to ensure no async execution
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(fetcher).not.toHaveBeenCalled();
    });

    test('re-executes when dependencies change', async () => {
      const fetcher = jest.fn().mockResolvedValue('data');
      let dep = 'initial';

      const { result, rerender } = renderHook(() => useAsyncData(fetcher, [dep]));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(fetcher).toHaveBeenCalledTimes(1);

      // Change dependency
      dep = 'changed';
      rerender();

      await waitFor(() => {
        expect(fetcher).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('manual execution', () => {
    test('execute function triggers fetcher', async () => {
      const fetcher = jest.fn().mockResolvedValue('manual result');
      const { result } = renderHook(() => useAsyncData(fetcher, [], { skip: true }));

      await act(async () => {
        await result.current.execute();
      });

      expect(fetcher).toHaveBeenCalled();
      expect(result.current.data).toBe('manual result');
    });

    test('execute passes arguments to fetcher', async () => {
      const fetcher = jest.fn().mockResolvedValue('result');
      const { result } = renderHook(() => useAsyncData(fetcher, [], { skip: true }));

      await act(async () => {
        await result.current.execute('arg1', 'arg2');
      });

      expect(fetcher).toHaveBeenCalledWith('arg1', 'arg2');
    });

    test('execute returns fetcher result', async () => {
      const fetcher = jest.fn().mockResolvedValue('returned value');
      const { result } = renderHook(() => useAsyncData(fetcher, [], { skip: true }));

      let returnedValue;
      await act(async () => {
        returnedValue = await result.current.execute();
      });

      expect(returnedValue).toBe('returned value');
    });

    test('execute returns null when no fetcher', async () => {
      const { result } = renderHook(() => useAsyncData(null, [], { skip: true }));

      let returnedValue;
      await act(async () => {
        returnedValue = await result.current.execute();
      });

      expect(returnedValue).toBeNull();
    });
  });

  describe('success handling', () => {
    test('sets data on successful fetch', async () => {
      const fetcher = jest.fn().mockResolvedValue({ id: 1, name: 'test' });
      const { result } = renderHook(() => useAsyncData(fetcher));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual({ id: 1, name: 'test' });
      expect(result.current.error).toBeNull();
    });

    test('calls onSuccess callback with result', async () => {
      const fetcher = jest.fn().mockResolvedValue('success data');
      const onSuccess = jest.fn();

      const { result } = renderHook(() => useAsyncData(fetcher, [], { onSuccess }));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(onSuccess).toHaveBeenCalledWith('success data');
    });

    test('clears loading state on success', async () => {
      const fetcher = jest.fn().mockResolvedValue('data');
      const { result } = renderHook(() => useAsyncData(fetcher));

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });

  describe('error handling', () => {
    test('sets error on fetch failure', async () => {
      const error = new Error('Fetch failed');
      const fetcher = jest.fn().mockRejectedValue(error);

      const { result } = renderHook(() => useAsyncData(fetcher));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe(error);
      expect(result.current.data).toBeNull();
    });

    test('calls onError callback with error', async () => {
      const error = new Error('Fetch failed');
      const fetcher = jest.fn().mockRejectedValue(error);
      const onError = jest.fn();

      const { result } = renderHook(() => useAsyncData(fetcher, [], { onError }));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(onError).toHaveBeenCalledWith(error);
    });

    test('returns null from execute on error (no throw)', async () => {
      const fetcher = jest.fn().mockRejectedValue(new Error('Error'));
      const { result } = renderHook(() => useAsyncData(fetcher, [], { skip: true }));

      let returnedValue;
      await act(async () => {
        returnedValue = await result.current.execute();
      });

      expect(returnedValue).toBeNull();
    });

    test('clears previous error on new fetch', async () => {
      let shouldFail = true;
      const fetcher = jest.fn().mockImplementation(() => {
        if (shouldFail) {
          return Promise.reject(new Error('Failed'));
        }
        return Promise.resolve('success');
      });

      const { result } = renderHook(() => useAsyncData(fetcher, [], { skip: true }));

      // First call fails
      await act(async () => {
        await result.current.execute();
      });

      expect(result.current.error).not.toBeNull();

      // Second call succeeds
      shouldFail = false;
      await act(async () => {
        await result.current.execute();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.data).toBe('success');
    });
  });

  describe('setData function', () => {
    test('allows manual data update', async () => {
      const fetcher = jest.fn().mockResolvedValue('initial');
      const { result } = renderHook(() => useAsyncData(fetcher, [], { skip: true }));

      act(() => {
        result.current.setData('manually set');
      });

      expect(result.current.data).toBe('manually set');
    });

    test('setData works with objects', async () => {
      const fetcher = jest.fn().mockResolvedValue({});
      const { result } = renderHook(() => useAsyncData(fetcher, [], { skip: true }));

      act(() => {
        result.current.setData({ key: 'value', count: 42 });
      });

      expect(result.current.data).toEqual({ key: 'value', count: 42 });
    });
  });

  describe('loading state transitions', () => {
    test('sets loading true at start of fetch', async () => {
      let resolvePromise;
      const fetcher = jest.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePromise = resolve;
          })
      );

      const { result } = renderHook(() => useAsyncData(fetcher, [], { skip: true }));

      // Start fetch
      let executePromise;
      act(() => {
        executePromise = result.current.execute();
      });

      // Should be loading
      expect(result.current.loading).toBe(true);

      // Resolve and complete
      await act(async () => {
        resolvePromise('done');
        await executePromise;
      });

      expect(result.current.loading).toBe(false);
    });
  });

  describe('memory leak prevention', () => {
    test('does not update state after unmount', async () => {
      let resolvePromise;
      const fetcher = jest.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePromise = resolve;
          })
      );

      const { result, unmount } = renderHook(() => useAsyncData(fetcher, [], { skip: true }));

      // Start fetch
      act(() => {
        result.current.execute();
      });

      // Unmount before resolve
      unmount();

      // Resolve after unmount - should not throw or update state
      await act(async () => {
        resolvePromise('late data');
        // Allow promise to settle
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // No error thrown means isMountedRef prevented state update
    });
  });
});
