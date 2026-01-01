/**
 * React-specific edge case utilities.
 * Provides hooks and components for safe React patterns.
 *
 * Core debounce is imported from the consolidated promiseUtils module.
 *
 * @module renderer/utils/reactEdgeCaseUtils
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { debounce } from '../../shared/promiseUtils';

/**
 * Hook to safely execute a callback only if the component is still mounted
 * Prevents "Can't perform a React state update on an unmounted component" warnings
 *
 * @param {*} initialValue - Initial state value
 * @returns {[*, Function]} State and safe setter
 */
function useSafeState(initialValue) {
  const isMountedRef = useRef(true);
  const [state, setState] = useState(initialValue);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const setSafeState = useCallback((newValue) => {
    if (isMountedRef.current) {
      setState(newValue);
    }
  }, []);

  return [state, setSafeState];
}

export { useSafeState, debounce };
export default {
  useSafeState,
  debounce
};
