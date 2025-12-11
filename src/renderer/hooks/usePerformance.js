/**
 * React performance optimization hooks
 * Provides custom hooks for common performance patterns
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { debounce, throttle, createLRUCache } from '../utils/performance';

/**
 * Hook for debounced values
 *
 * @param {*} value - The value to debounce
 * @param {number} delay - Debounce delay in milliseconds
 * @returns {*} The debounced value
 */
export function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Hook for debounced callbacks
 *
 * @param {Function} callback - The callback to debounce
 * @param {number} delay - Debounce delay in milliseconds
 * @param {Array} deps - Dependencies array
 * @returns {Function} The debounced callback
 */
export function useDebouncedCallback(callback, delay) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Since we use callbackRef, deps parameter is unnecessary - callback updates are tracked via ref
  const debouncedCallback = useMemo(
    () => debounce((...args) => callbackRef.current(...args), delay),
    [delay]
  );

  useEffect(() => {
    return () => {
      debouncedCallback.cancel();
    };
  }, [debouncedCallback]);

  return debouncedCallback;
}

/**
 * Hook for throttled callbacks
 *
 * @param {Function} callback - The callback to throttle
 * @param {number} delay - Throttle delay in milliseconds
 * @param {Array} deps - Dependencies array
 * @returns {Function} The throttled callback
 */
export function useThrottledCallback(callback, delay) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Since we use callbackRef, deps parameter is unnecessary - callback updates are tracked via ref
  const throttledCallback = useMemo(
    () => throttle((...args) => callbackRef.current(...args), delay),
    [delay]
  );

  useEffect(() => {
    return () => {
      throttledCallback.cancel();
    };
  }, [throttledCallback]);

  return throttledCallback;
}

/**
 * Hook for LRU cache
 *
 * @param {number} maxSize - Maximum cache size
 * @returns {Object} LRU cache instance
 */
export function useLRUCache(maxSize = 100) {
  const cacheRef = useRef(null);

  if (!cacheRef.current) {
    cacheRef.current = createLRUCache(maxSize);
  }

  return cacheRef.current;
}

export default {
  useDebounce,
  useDebouncedCallback,
  useThrottledCallback,
  useLRUCache
};
