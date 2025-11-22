/**
 * React Edge Case Utilities
 * Provides hooks and utilities for handling common React edge cases
 */

const { useEffect, useRef, useCallback, useState, useMemo } = require('react');
const { logger } = require('../../shared/logger');

logger.setContext('ReactEdgeCaseUtils');

/**
 * CATEGORY 1: STALE STATE PREVENTION
 */

/**
 * Hook to get latest value without causing re-renders
 * Prevents stale closure issues in event handlers and callbacks
 * @param {*} value - Value to track
 * @returns {Object} Ref containing latest value
 */
function useLatest(value) {
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}

/**
 * Hook for stable callback that always uses latest props/state
 * Prevents stale closures in async operations and event handlers
 * @param {Function} callback - Callback function
 * @returns {Function} Stable callback with latest values
 */
function useStableCallback(callback) {
  const callbackRef = useLatest(callback);

  return useCallback((...args) => {
    return callbackRef.current?.(...args);
  }, []);
}

/**
 * Hook for previous value tracking
 * Useful for detecting changes and handling transitions
 * @param {*} value - Value to track
 * @returns {*} Previous value
 */
function usePrevious(value) {
  const ref = useRef();

  useEffect(() => {
    ref.current = value;
  });

  return ref.current;
}

/**
 * Hook for safe async state updates (prevents updates after unmount)
 * @param {*} initialValue - Initial state value
 * @returns {Array} [state, setState] - Safe state tuple
 */
function useSafeState(initialValue) {
  const [state, setState] = useState(initialValue);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSetState = useCallback((value) => {
    if (mountedRef.current) {
      setState(value);
    }
  }, []);

  return [state, safeSetState];
}

/**
 * CATEGORY 2: EVENT LISTENER CLEANUP
 */

/**
 * Hook for safe event listener with automatic cleanup
 * @param {string} eventName - Event name
 * @param {Function} handler - Event handler
 * @param {Object} target - Event target (default: window)
 * @param {Object} options - Event listener options
 */
function useEventListener(eventName, handler, target = null, options = {}) {
  const savedHandler = useLatest(handler);

  useEffect(() => {
    const eventTarget =
      target || (typeof window !== 'undefined' ? window : null);

    if (!eventTarget || !eventTarget.addEventListener) {
      return;
    }

    const eventListener = (event) => savedHandler.current?.(event);

    eventTarget.addEventListener(eventName, eventListener, options);

    return () => {
      eventTarget.removeEventListener(eventName, eventListener, options);
    };
  }, [eventName, target, options.capture, options.passive, options.once]);
}

/**
 * Hook for window resize listener with debouncing
 * @param {Function} callback - Callback to run on resize
 * @param {number} delay - Debounce delay in ms (default: 200)
 */
function useWindowResize(callback, delay = 200) {
  const savedCallback = useLatest(callback);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleResize = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        savedCallback.current?.();
      }, delay);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [delay]);
}

/**
 * Hook for click outside detection
 * @param {Object} ref - Ref to element
 * @param {Function} callback - Callback when clicked outside
 */
function useClickOutside(ref, callback) {
  const savedCallback = useLatest(callback);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const handleClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        savedCallback.current?.(event);
      }
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick);

    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
    };
  }, [ref]);
}

/**
 * CATEGORY 3: DEBOUNCE/THROTTLE
 */

/**
 * Hook for debounced value
 * @param {*} value - Value to debounce
 * @param {number} delay - Debounce delay in ms
 * @returns {*} Debounced value
 */
function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Hook for debounced callback
 * @param {Function} callback - Callback to debounce
 * @param {number} delay - Debounce delay in ms
 * @returns {Function} Debounced callback
 */
function useDebouncedCallback(callback, delay) {
  const savedCallback = useLatest(callback);
  const timeoutRef = useRef(null);

  const debouncedCallback = useCallback(
    (...args) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        savedCallback.current?.(...args);
      }, delay);
    },
    [delay],
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
}

/**
 * Hook for throttled callback
 * @param {Function} callback - Callback to throttle
 * @param {number} limit - Throttle limit in ms
 * @returns {Function} Throttled callback
 */
function useThrottledCallback(callback, limit) {
  const savedCallback = useLatest(callback);
  const inThrottleRef = useRef(false);

  const throttledCallback = useCallback(
    (...args) => {
      if (!inThrottleRef.current) {
        savedCallback.current?.(...args);
        inThrottleRef.current = true;

        setTimeout(() => {
          inThrottleRef.current = false;
        }, limit);
      }
    },
    [limit],
  );

  return throttledCallback;
}

/**
 * CATEGORY 4: ASYNC OPERATION HELPERS
 */

/**
 * Hook for async operation with loading/error states
 * @param {Function} asyncFn - Async function to execute
 * @param {Array} deps - Dependencies array
 * @returns {Object} { data, loading, error, refetch }
 */
function useAsync(asyncFn, deps = []) {
  const [state, setState] = useSafeState({
    data: null,
    loading: true,
    error: null,
  });

  const execute = useCallback(async () => {
    setState({ data: null, loading: true, error: null });

    try {
      const data = await asyncFn();
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState({ data: null, loading: false, error });
    }
  }, deps);

  useEffect(() => {
    execute();
  }, deps);

  return {
    ...state,
    refetch: execute,
  };
}

/**
 * Hook for cancellable async operation
 * @returns {Object} { makeCancellable, cancelAll }
 */
function useCancellablePromises() {
  const pendingPromises = useRef(new Set());

  useEffect(() => {
    return () => {
      // Cancel all pending promises on unmount
      pendingPromises.current.forEach((cancel) => cancel());
      pendingPromises.current.clear();
    };
  }, []);

  const makeCancellable = useCallback((promise) => {
    let cancelled = false;

    const wrappedPromise = new Promise((resolve, reject) => {
      promise
        .then((value) => {
          if (!cancelled) {
            resolve(value);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            reject(error);
          }
        });
    });

    const cancel = () => {
      cancelled = true;
      pendingPromises.current.delete(cancel);
    };

    pendingPromises.current.add(cancel);

    return {
      promise: wrappedPromise,
      cancel,
    };
  }, []);

  const cancelAll = useCallback(() => {
    pendingPromises.current.forEach((cancel) => cancel());
    pendingPromises.current.clear();
  }, []);

  return {
    makeCancellable,
    cancelAll,
  };
}

/**
 * CATEGORY 5: PERFORMANCE OPTIMIZATION
 */

/**
 * Hook for component mount/unmount tracking
 * Useful for debugging and preventing memory leaks
 * @param {string} componentName - Component name for logging
 */
function useMountTracking(componentName) {
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      logger.debug('Component mounted', { componentName });
    }

    return () => {
      if (process.env.NODE_ENV === 'development') {
        logger.debug('Component unmounted', { componentName });
      }
    };
  }, [componentName]);
}

/**
 * Hook to force component re-render
 * Use sparingly - usually indicates a design issue
 * @returns {Function} Function to force update
 */
function useForceUpdate() {
  const [, setValue] = useState(0);
  return useCallback(() => setValue((value) => value + 1), []);
}

/**
 * Hook for interval with automatic cleanup
 * @param {Function} callback - Callback to run at interval
 * @param {number} delay - Interval delay in ms (null to pause)
 */
function useInterval(callback, delay) {
  const savedCallback = useLatest(callback);

  useEffect(() => {
    if (delay === null) {
      return;
    }

    const id = setInterval(() => {
      savedCallback.current?.();
    }, delay);

    return () => clearInterval(id);
  }, [delay]);
}

/**
 * Hook for timeout with automatic cleanup
 * @param {Function} callback - Callback to run after timeout
 * @param {number} delay - Timeout delay in ms (null to cancel)
 */
function useTimeout(callback, delay) {
  const savedCallback = useLatest(callback);

  useEffect(() => {
    if (delay === null) {
      return;
    }

    const id = setTimeout(() => {
      savedCallback.current?.();
    }, delay);

    return () => clearTimeout(id);
  }, [delay]);
}

/**
 * CATEGORY 6: DATA VALIDATION HOOKS
 */

/**
 * Hook for validated prop with fallback
 * @param {*} prop - Prop value
 * @param {Function} validator - Validation function
 * @param {*} fallback - Fallback value if validation fails
 * @returns {*} Validated value or fallback
 */
function useValidatedProp(prop, validator, fallback) {
  return useMemo(() => {
    if (typeof validator !== 'function') {
      return prop !== undefined ? prop : fallback;
    }

    try {
      return validator(prop) ? prop : fallback;
    } catch {
      return fallback;
    }
  }, [prop, validator, fallback]);
}

/**
 * Hook for non-empty array prop
 * @param {Array} arr - Array prop
 * @param {Array} fallback - Fallback array
 * @returns {Array} Valid non-empty array
 */
function useNonEmptyArray(arr, fallback = []) {
  return useMemo(() => {
    if (Array.isArray(arr) && arr.length > 0) {
      return arr;
    }
    return fallback;
  }, [arr, fallback]);
}

/**
 * Hook for non-empty string prop
 * @param {string} str - String prop
 * @param {string} fallback - Fallback string
 * @returns {string} Valid non-empty string
 */
function useNonEmptyString(str, fallback = '') {
  return useMemo(() => {
    if (typeof str === 'string' && str.trim().length > 0) {
      return str;
    }
    return fallback;
  }, [str, fallback]);
}

/**
 * CATEGORY 7: MISC UTILITIES
 */

/**
 * Hook to detect if component is mounted
 * @returns {Object} Ref with current mount status
 */
function useIsMounted() {
  const isMounted = useRef(false);

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
    };
  }, []);

  return isMounted;
}

/**
 * Hook for window focus detection
 * @returns {boolean} True if window is focused
 */
function useWindowFocus() {
  const [focused, setFocused] = useState(
    typeof document !== 'undefined' ? document.hasFocus() : true,
  );

  useEventListener(
    'focus',
    () => setFocused(true),
    typeof window !== 'undefined' ? window : null,
  );
  useEventListener(
    'blur',
    () => setFocused(false),
    typeof window !== 'undefined' ? window : null,
  );

  return focused;
}

/**
 * Hook for online/offline detection
 * @returns {boolean} True if online
 */
function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEventListener(
    'online',
    () => setOnline(true),
    typeof window !== 'undefined' ? window : null,
  );
  useEventListener(
    'offline',
    () => setOnline(false),
    typeof window !== 'undefined' ? window : null,
  );

  return online;
}

module.exports = {
  useLatest,
  useStableCallback,
  usePrevious,
  useSafeState,
  useEventListener,
  useWindowResize,
  useClickOutside,
  useDebounce,
  useDebouncedCallback,
  useThrottledCallback,
  useAsync,
  useCancellablePromises,
  useMountTracking,
  useForceUpdate,
  useInterval,
  useTimeout,
  useValidatedProp,
  useNonEmptyArray,
  useNonEmptyString,
  useIsMounted,
  useWindowFocus,
  useOnlineStatus,
};
