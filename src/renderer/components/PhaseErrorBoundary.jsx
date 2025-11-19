import React from 'react';
import PropTypes from 'prop-types';
import { logger } from '../../shared/logger';
import { usePhase } from '../contexts/PhaseContext';

logger.setContext('PhaseErrorBoundary');

/**
 * Phase-specific error boundary that provides graceful error handling
 * for individual phases without crashing the entire application.
 */
class PhaseErrorBoundaryClass extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
    this.handleReset = this.handleReset.bind(this);
    this.handleNavigateHome = this.handleNavigateHome.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    logger.error(`Error in ${this.props.phaseName} phase`, {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo?.componentStack,
    });

    this.setState({ errorInfo });

    // Report error to any configured error tracking service
    if (this.props.onError) {
      this.props.onError(error, errorInfo, this.props.phaseName);
    }
  }

  handleReset() {
    this.setState({ hasError: false, error: null, errorInfo: null });
  }

  handleNavigateHome() {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onNavigateHome) {
      this.props.onNavigateHome();
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="container-responsive py-12">
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-xl shadow-lg border border-border-light p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0">
                  <div className="inline-flex items-center justify-center w-12 h-12 bg-system-red/10 rounded-lg">
                    <svg
                      className="w-6 h-6 text-system-red"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
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
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-system-gray-900 mb-2">
                    {this.props.phaseName} Error
                  </h2>
                  <p className="text-system-gray-600">
                    An error occurred in the{' '}
                    {this.props.phaseName.toLowerCase()} phase. Your progress in
                    other phases is safe.
                  </p>
                </div>
              </div>

              <div className="bg-system-gray-50 rounded-lg p-4 mb-6">
                <p className="text-sm font-medium text-system-gray-700 mb-2">
                  Error Details:
                </p>
                <p className="text-sm font-mono text-system-gray-600 break-words">
                  {this.state.error?.message || 'Unknown error occurred'}
                </p>
                {process.env.NODE_ENV === 'development' &&
                  this.state.error?.stack && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-system-gray-500 hover:text-system-gray-700">
                        Show stack trace
                      </summary>
                      <pre className="mt-2 text-xs text-system-gray-600 overflow-auto max-h-60 p-2 bg-white rounded border border-border-light">
                        {this.state.error.stack}
                      </pre>
                    </details>
                  )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={this.handleReset}
                  className="flex-1 btn-primary"
                  aria-label="Try again"
                >
                  Try Again
                </button>
                <button
                  onClick={this.handleNavigateHome}
                  className="flex-1 btn-secondary"
                  aria-label="Go to home"
                >
                  Go to Home
                </button>
              </div>

              <p className="text-xs text-center text-system-gray-500 mt-4">
                If this problem persists, try restarting the application or
                check your settings.
              </p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

PhaseErrorBoundaryClass.propTypes = {
  children: PropTypes.node.isRequired,
  phaseName: PropTypes.string.isRequired,
  onError: PropTypes.func,
  onNavigateHome: PropTypes.func,
};

/**
 * Wrapper component that provides access to phase navigation
 */
function PhaseErrorBoundary({ children, phaseName }) {
  const { actions } = usePhase();

  const handleNavigateHome = () => {
    // Fixed: Use resetWorkflow instead of non-existent goToPhase
    // This resets all state and returns to WELCOME phase
    actions.resetWorkflow();
  };

  const handleError = (error, errorInfo, phase) => {
    // Optional: Send error to analytics/monitoring service
    logger.error(`Phase error: ${phase}`, {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  };

  return (
    <PhaseErrorBoundaryClass
      phaseName={phaseName}
      onNavigateHome={handleNavigateHome}
      onError={handleError}
    >
      {children}
    </PhaseErrorBoundaryClass>
  );
}

PhaseErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
  phaseName: PropTypes.string.isRequired,
};

export default PhaseErrorBoundary;
