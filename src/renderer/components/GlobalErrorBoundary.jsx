import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { logger } from '../../shared/logger';
logger.setContext('GlobalErrorBoundary');

/**
 * Global Error Boundary Component
 * Catches JavaScript errors anywhere in the child component tree,
 * logs errors, and displays a fallback UI
 */
class GlobalErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0,
    };
    this.resetTimeoutId = null;
  }

  // eslint-disable-next-line no-unused-vars
  static getDerivedStateFromError(_error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error to error reporting service
    logger.error('[GlobalErrorBoundary] Component error caught:', {
      error: error?.toString(),
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
      timestamp: new Date().toISOString(),
    });

    // Update error count for tracking repeated errors
    this.setState((prevState) => ({
      error,
      errorInfo,
      errorCount: prevState.errorCount + 1,
    }));

    // Report to main process if available
    try {
      if (window?.electronAPI?.events?.sendError) {
        window.electronAPI.events.sendError({
          message: error?.message || 'Unknown error',
          stack: error?.stack,
          componentStack: errorInfo?.componentStack,
          type: 'react-error-boundary',
        });
      }
    } catch (reportError) {
      logger.error(
        '[GlobalErrorBoundary] Failed to report error to main:',
        reportError,
      );
    }

    // Auto-reset after 30 seconds if not too many errors
    if (this.state.errorCount < 3) {
      this.scheduleReset();
    }
  }

  componentWillUnmount() {
    // Clean up timeout on unmount
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
      this.resetTimeoutId = null;
    }
  }

  scheduleReset = () => {
    // Clear any existing timeout
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
    }

    // Schedule auto-reset after 30 seconds
    this.resetTimeoutId = setTimeout(() => {
      this.resetErrorBoundary();
    }, 30000);
  };

  resetErrorBoundary = () => {
    // Clear timeout if it exists
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
      this.resetTimeoutId = null;
    }

    // Reset state
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    // Call optional reset callback
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Check if custom fallback provided
      if (this.props.fallback) {
        return this.props.fallback(
          this.state.error,
          this.state.errorInfo,
          this.resetErrorBoundary,
        );
      }

      // Default fallback UI
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center mb-4">
              <svg
                className="w-8 h-8 text-red-500 mr-3"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h2 className="text-xl font-semibold text-gray-800">
                Something went wrong
              </h2>
            </div>

            <p className="text-gray-600 mb-4">
              An unexpected error occurred. The application has recovered
              automatically, or you can try the options below.
            </p>

            {this.state.errorCount > 2 && (
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                <p className="text-sm text-yellow-800">
                  Multiple errors detected. Consider reloading the application.
                </p>
              </div>
            )}

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mb-4">
                <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                  Error Details (Development Only)
                </summary>
                <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-auto max-h-40">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}

            <div className="flex gap-3">
              <button
                onClick={this.resetErrorBoundary}
                className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={this.handleReload}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
              >
                Reload App
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

GlobalErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
  fallback: PropTypes.func,
  onReset: PropTypes.func,
};

export default GlobalErrorBoundary;
