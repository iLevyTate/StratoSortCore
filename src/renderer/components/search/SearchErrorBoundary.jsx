import React from 'react';
import PropTypes from 'prop-types';
import { logger } from '../../../shared/logger';
import Button from '../ui/Button';
import { Heading, Text } from '../ui/Typography';

/**
 * Error boundary specifically for the search modal
 * FIX: Prevents unhandled exceptions from crashing the entire search functionality
 *
 * When an error occurs, displays a fallback UI with recovery options
 * instead of unmounting the entire search modal.
 */
class SearchErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render shows the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error for debugging
    logger.error('[SearchErrorBoundary] Caught error in search modal', {
      error: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack
    });

    // Optionally report to error tracking service
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleClose = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onClose) {
      this.props.onClose();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-system-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex flex-col items-center text-center">
              {/* Error icon */}
              <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
                <svg
                  className="w-6 h-6 text-red-600 dark:text-red-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>

              <Heading as="h2" variant="h5" className="dark:text-white mb-2">
                Search encountered an error
              </Heading>

              <Text variant="small" className="text-system-gray-600 dark:text-system-gray-300 mb-4">
                Something went wrong while loading the search. You can try again or close the search
                modal.
              </Text>

              {/* Show error details in development */}
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <div className="w-full mb-4 p-3 bg-system-gray-100 dark:bg-system-gray-700 rounded text-left">
                  <p className="text-xs font-mono text-red-600 dark:text-red-400 break-all">
                    {this.state.error.message || 'Unknown error'}
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <Button variant="secondary" onClick={this.handleClose} size="sm">
                  Close
                </Button>
                <Button variant="primary" onClick={this.handleRetry} size="sm">
                  Try Again
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

SearchErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
  onClose: PropTypes.func,
  onError: PropTypes.func
};

SearchErrorBoundary.defaultProps = {
  onClose: null,
  onError: null
};

export default SearchErrorBoundary;
