import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook for fetching data asynchronously with built-in state management and leak prevention
 *
 * @param {Function} fetcher - Async function to execute.
 *   **IMPORTANT**: The fetcher function MUST be memoized (wrapped in useCallback) if it
 *   references props or state that could change. If an unstable fetcher reference is passed
 *   (e.g., an inline arrow function), the execute callback will be recreated on every render,
 *   causing the auto-execute effect to re-run repeatedly and potentially causing infinite loops.
 *
 *   Example (WRONG - causes infinite re-execution):
 *     useAsyncData(() => fetchData(someId), [someId])
 *
 *   Example (CORRECT - fetcher is memoized):
 *     const fetcher = useCallback(() => fetchData(someId), [someId]);
 *     useAsyncData(fetcher, [])
 *
 * @param {Array} dependencies - Dependency array for useEffect (in addition to fetcher)
 * @param {Object} options - Configuration options
 * @param {*} options.initialData - Initial data value (default: null)
 * @param {boolean} options.skip - If true, fetcher won't run automatically (default: false)
 * @param {Function} options.onSuccess - Callback on successful fetch (should also be memoized)
 * @param {Function} options.onError - Callback on error (should also be memoized)
 *
 * @returns {Object} { data, loading, error, execute, setData }
 */
export function useAsyncData(fetcher, dependencies = [], options = {}) {
  const { initialData = null, skip = false, onSuccess, onError } = options;

  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(!skip);
  const [error, setError] = useState(null);

  // Ref to track component mount state to prevent memory leaks
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const execute = useCallback(
    async (...args) => {
      if (!fetcher) return null;

      setLoading(true);
      setError(null);

      try {
        const result = await fetcher(...args);

        if (isMountedRef.current) {
          setData(result);
          setLoading(false);
          if (onSuccess) onSuccess(result);
        }
        return result;
      } catch (err) {
        if (isMountedRef.current) {
          setError(err);
          setLoading(false);
          if (onError) onError(err);
        }
        // We don't re-throw here to avoid unhandled promise rejections in the UI,
        // as the error state is available. If the caller needs to catch it,
        // they should wrap the fetcher or use the onError callback.
        return null;
      }
    },
    [fetcher, onSuccess, onError]
  ); // fetcher should be memoized by caller if it depends on props

  // Auto-execute effect
  useEffect(() => {
    if (!skip) {
      execute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip, execute, ...dependencies]);

  return {
    data,
    loading,
    error,
    execute, // Manual trigger
    setData // Manual update
  };
}
