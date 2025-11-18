/**
 * React performance optimization hooks
 * Provides custom hooks for common performance patterns
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  debounce,
  throttle,
  createLRUCache,
  rafThrottle,
} from '../utils/performance';

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
export function useDebouncedCallback(callback, delay, deps = []) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const debouncedCallback = useMemo(
    () => debounce((...args) => callbackRef.current(...args), delay),
    [delay, ...deps],
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
export function useThrottledCallback(callback, delay, deps = []) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const throttledCallback = useMemo(
    () => throttle((...args) => callbackRef.current(...args), delay),
    [delay, ...deps],
  );

  useEffect(() => {
    return () => {
      throttledCallback.cancel();
    };
  }, [throttledCallback]);

  return throttledCallback;
}

/**
 * Hook for RAF (RequestAnimationFrame) throttled callbacks
 *
 * @param {Function} callback - The callback to throttle
 * @returns {Function} The RAF throttled callback
 */
export function useRAFCallback(callback) {
  const callbackRef = useRef(callback);
  const rafCallback = useRef(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    rafCallback.current = rafThrottle((...args) =>
      callbackRef.current(...args),
    );

    return () => {
      if (rafCallback.current) {
        rafCallback.current.cancel();
      }
    };
  }, []);

  return rafCallback.current;
}

/**
 * Hook for memoized async values with caching
 *
 * @param {Function} asyncFn - Async function to call
 * @param {Array} deps - Dependencies array
 * @param {Object} options - Options for caching
 * @returns {Object} Object with data, loading, error, and refetch
 */
export function useAsyncMemo(asyncFn, deps = [], options = {}) {
  const {
    cacheKey = null,
    cacheTime = 5 * 60 * 1000, // 5 minutes default
    initialData = undefined,
    onSuccess = null,
    onError = null,
  } = options;

  const [state, setState] = useState({
    data: initialData,
    loading: !initialData,
    error: null,
  });

  const cacheRef = useRef(new Map());

  const fetchData = useCallback(async () => {
    const key = cacheKey || JSON.stringify(deps);

    // Check cache
    if (cacheRef.current.has(key)) {
      const cached = cacheRef.current.get(key);
      if (Date.now() - cached.timestamp < cacheTime) {
        setState({ data: cached.data, loading: false, error: null });
        return cached.data;
      }
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const data = await asyncFn();

      // Update cache
      cacheRef.current.set(key, {
        data,
        timestamp: Date.now(),
      });

      setState({ data, loading: false, error: null });

      if (onSuccess) {
        onSuccess(data);
      }

      return data;
    } catch (error) {
      setState({ data: null, loading: false, error });

      if (onError) {
        onError(error);
      }

      throw error;
    }
  }, [asyncFn, cacheKey, cacheTime, onSuccess, onError, ...deps]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    ...state,
    refetch: fetchData,
    clearCache: () => cacheRef.current.clear(),
  };
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

/**
 * Hook for intersection observer with performance optimization
 *
 * @param {Object} options - Intersection observer options
 * @returns {Array} [ref, isIntersecting, entry]
 */
export function useIntersectionObserver(options = {}) {
  const [isIntersecting, setIsIntersecting] = useState(false);
  const [entry, setEntry] = useState(null);
  const elementRef = useRef(null);
  const observerRef = useRef(null);

  const callback = useCallback(([entry]) => {
    setIsIntersecting(entry.isIntersecting);
    setEntry(entry);
  }, []);

  useEffect(() => {
    if (!elementRef.current) return;

    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(callback, options);
    observerRef.current.observe(elementRef.current);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [callback, options.threshold, options.root, options.rootMargin]);

  return [elementRef, isIntersecting, entry];
}

/**
 * Hook for lazy loading with intersection observer
 *
 * @param {Function} onVisible - Callback when element becomes visible
 * @param {Object} options - Intersection observer options
 * @returns {Object} Object with ref and loading state
 */
export function useLazyLoad(onVisible, options = {}) {
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [ref, isIntersecting] = useIntersectionObserver(options);

  useEffect(() => {
    if (isIntersecting && !hasLoaded && !isLoading) {
      setIsLoading(true);

      Promise.resolve(onVisible())
        .then(() => {
          setHasLoaded(true);
          setIsLoading(false);
        })
        .catch(() => {
          setIsLoading(false);
        });
    }
  }, [isIntersecting, hasLoaded, isLoading, onVisible]);

  return {
    ref,
    isLoading,
    hasLoaded,
  };
}

/**
 * Hook for virtualized lists
 *
 * @param {Array} items - Array of items to virtualize
 * @param {Object} options - Virtualization options
 * @returns {Object} Virtualization state and helpers
 */
export function useVirtualList(items, options = {}) {
  const {
    itemHeight = 50,
    containerHeight = 500,
    overscan = 3,
    getItemHeight = null,
  } = options;

  const [scrollTop, setScrollTop] = useState(0);
  const scrollElementRef = useRef(null);

  const handleScroll = useThrottledCallback((e) => {
    setScrollTop(e.target.scrollTop);
  }, 16); // ~60fps

  const { visibleRange, totalHeight, offsetY } = useMemo(() => {
    let accumulatedHeight = 0;
    let startIndex = 0;
    let endIndex = items.length - 1;
    let offsetY = 0;

    // Find start index
    for (let i = 0; i < items.length; i++) {
      const height = getItemHeight ? getItemHeight(i) : itemHeight;

      if (accumulatedHeight + height > scrollTop) {
        startIndex = Math.max(0, i - overscan);
        offsetY = accumulatedHeight;
        break;
      }

      accumulatedHeight += height;
    }

    // Find end index
    accumulatedHeight = offsetY;
    for (let i = startIndex; i < items.length; i++) {
      const height = getItemHeight ? getItemHeight(i) : itemHeight;
      accumulatedHeight += height;

      if (accumulatedHeight > scrollTop + containerHeight) {
        endIndex = Math.min(items.length - 1, i + overscan);
        break;
      }
    }

    // Calculate total height
    const totalHeight = getItemHeight
      ? items.reduce((sum, _, i) => sum + getItemHeight(i), 0)
      : items.length * itemHeight;

    return {
      visibleRange: [startIndex, endIndex],
      totalHeight,
      offsetY,
    };
  }, [
    items.length,
    scrollTop,
    itemHeight,
    containerHeight,
    overscan,
    getItemHeight,
  ]);

  const visibleItems = items.slice(visibleRange[0], visibleRange[1] + 1);

  return {
    scrollElementRef,
    visibleItems,
    totalHeight,
    offsetY,
    handleScroll,
    visibleRange,
  };
}

/**
 * Hook for optimized event handlers with cleanup
 *
 * @param {string} eventName - Event name
 * @param {Function} handler - Event handler
 * @param {Element} element - Target element (default: window)
 * @param {Object} options - AddEventListener options
 */
export function useEventListener(
  eventName,
  handler,
  element = window,
  options = {},
) {
  const savedHandler = useRef();

  useEffect(() => {
    savedHandler.current = handler;
  }, [handler]);

  useEffect(() => {
    const isSupported = element && element.addEventListener;
    if (!isSupported) return;

    const eventListener = (event) => savedHandler.current(event);

    element.addEventListener(eventName, eventListener, options);

    return () => {
      element.removeEventListener(eventName, eventListener, options);
    };
  }, [eventName, element, options.capture, options.once, options.passive]);
}

export default {
  useDebounce,
  useDebouncedCallback,
  useThrottledCallback,
  useRAFCallback,
  useAsyncMemo,
  useLRUCache,
  useIntersectionObserver,
  useLazyLoad,
  useVirtualList,
  useEventListener,
};
