import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { logger } from '../../shared/logger';

/**
 * Hook to safely execute a callback only if the component is still mounted
 * Prevents "Can't perform a React state update on an unmounted component" warnings
 */
export function useSafeState(initialValue) {
  const isMountedRef = useRef(true);
  const [state, setState] = useState(initialValue);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const setSafeState = (newValue) => {
    if (isMountedRef.current) {
      setState(newValue);
    }
  };

  return [state, setSafeState];
}

/**
 * Error Boundary Component for catching rendering errors in sub-trees
 */
export class ComponentErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    logger.error('Component Error Boundary caught error:', {
      error,
      errorInfo,
    });
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="p-4 border border-red-200 bg-red-50 rounded text-red-700">
          <h3 className="font-bold">Something went wrong</h3>
          <p className="text-sm mt-1">{this.state.error?.message}</p>
        </div>
      );
    }

    return this.props.children;
  }
}

ComponentErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
  onError: PropTypes.func,
  fallback: PropTypes.node,
};

/**
 * Debounce utility for expensive operations
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Hook to track component render count (for development debugging)
 * Enable DEBUG_RENDER_TRACKING env var to see logs
 * @param {string} componentName - Name of component for logging
 */
export function useRenderTracker(componentName) {
  const count = useRef(0);
  const { logger } = require('../../shared/logger');

  useEffect(() => {
    count.current++;
    if (process.env.DEBUG_RENDER_TRACKING) {
      logger.debug('Render tracked', {
        component: componentName,
        count: count.current,
      });
    }
  });
}
