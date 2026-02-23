import { useState, useEffect, useCallback, useRef } from 'react';
import { logger } from '../../shared/logger';

/**
 * Hook for fetching data asynchronously with built-in state management and leak prevention
 *
 * @param {Function} fetcher - Async function to execute.
 *   The fetcher function is stored in a ref, so it always uses the latest version
 *   without needing to be memoized. This prevents stale closure issues.
 *
 *   Example (NOW WORKS - no memoization needed):
 *     useAsyncData(() => fetchData(someId), [someId])
 *
 *   Example (ALSO WORKS - memoized):
 *     const fetcher = useCallback(() => fetchData(someId), [someId]);
 *     useAsyncData(fetcher, [someId])
 *
 * @param {Array} dependencies - Dependency array for useEffect that triggers auto-execution
 * @param {Object} options - Configuration options
 * @param {*} options.initialData - Initial data value (default: null)
 * @param {boolean} options.skip - If true, fetcher won't run automatically (default: false)
 * @param {Function} options.onSuccess - Callback on successful fetch
 * @param {Function} options.onError - Callback on error
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

  // This ensures execute() always uses the CURRENT fetcher, not the one from
  // when execute was memoized. This fixes the bug where dependencies change
  // but execute still references the old fetcher from its closure.
  const fetcherRef = useRef(fetcher);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);

  // Keep refs in sync with latest values
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // execute is now stable (no dependencies that change) but always uses latest fetcher
  const execute = useCallback(async (...args) => {
    const currentFetcher = fetcherRef.current;
    if (!currentFetcher) return null;

    setLoading(true);
    setError(null);

    try {
      const result = await currentFetcher(...args);

      if (isMountedRef.current) {
        setData(result);
        setLoading(false);
        if (onSuccessRef.current) onSuccessRef.current(result);
      }
      return result;
    } catch (err) {
      if (isMountedRef.current) {
        setError(err);
        setLoading(false);
        // from leaving the hook in an inconsistent state
        if (onErrorRef.current) {
          try {
            onErrorRef.current(err);
          } catch (callbackErr) {
            // Log but don't propagate - the original error is already in state
            logger.error('[useAsyncData] onError callback threw:', { error: callbackErr.message });
          }
        }
      }
      // We don't re-throw here to avoid unhandled promise rejections in the UI,
      // as the error state is available. If the caller needs to catch it,
      // they should wrap the fetcher or use the onError callback.
      return null;
    }
  }, []); // Now stable - uses refs for all dynamic values

  // Auto-execute effect - now only depends on skip and dependencies
  // execute is stable so won't cause re-runs
  useEffect(() => {
    if (!skip) {
      execute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip, ...dependencies]);

  return {
    data,
    loading,
    error,
    execute, // Manual trigger
    setData // Manual update
  };
}
