import React from 'react';
import PropTypes from 'prop-types';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '../ui';
import { logger } from '../../../shared/logger';

/**
 * Error boundary specifically for the graph visualization.
 * Catches errors from ReactFlow and its child components,
 * providing a graceful fallback UI with recovery options.
 */
class GraphErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    logger.error('[GraphErrorBoundary] Graph visualization error:', {
      error: error?.message || error,
      componentStack: errorInfo?.componentStack
    });
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  handleClearGraph = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onClearGraph?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-system-gray-50">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-amber-600" />
          </div>

          <h3 className="heading-tertiary mb-2">Graph Visualization Error</h3>

          <p className="text-sm text-system-gray-500 max-w-md mb-6">
            Something went wrong while rendering the graph. This might be caused by invalid data or
            a temporary issue.
          </p>

          <div className="flex gap-3">
            <Button variant="secondary" size="sm" onClick={this.handleReset}>
              <RefreshCw className="w-4 h-4" />
              <span>Try Again</span>
            </Button>
            <Button variant="primary" size="sm" onClick={this.handleClearGraph}>
              Clear & Restart
            </Button>
          </div>

          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details className="mt-6 text-left max-w-lg w-full">
              <summary className="text-xs text-system-gray-500 cursor-pointer hover:text-system-gray-700">
                Show error details (dev only)
              </summary>
              <pre className="mt-2 p-3 bg-system-gray-900 text-red-400 text-xs rounded-lg overflow-auto max-h-48">
                {this.state.error?.message}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

GraphErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
  onReset: PropTypes.func,
  onClearGraph: PropTypes.func
};

GraphErrorBoundary.defaultProps = {
  onReset: null,
  onClearGraph: null
};

export default GraphErrorBoundary;
