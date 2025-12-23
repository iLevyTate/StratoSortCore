import React from 'react';
import PropTypes from 'prop-types';
import { AlertTriangle } from 'lucide-react';
import { logger } from '../../shared/logger';

logger.setContext('ErrorBoundary');

/**
 * Unified Error Boundary Component
 *
 * Configurable error boundary that consolidates functionality from:
 * - Basic error catching and logging
 * - Error count tracking with auto-reset
 * - Chunk load error detection with auto-reload
 * - Custom fallback support
 * - IPC error reporting to main process
 *
 * Variants:
 * - 'global': Full-screen error UI with auto-reset timer
 * - 'phase': Inline error UI with context name and home navigation
 * - 'simple': Basic inline error UI (default)
 */
class ErrorBoundaryCore extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0,
      resetKey: 0
    };
    this.resetTimeoutId = null;
    this.handleReset = this.handleReset.bind(this);
    this.handleNavigateHome = this.handleNavigateHome.bind(this);
    this.handleReload = this.handleReload.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    const { contextName, onError, enableAutoReset, autoResetDelay, enableChunkRecovery } =
      this.props;
    const context = contextName || 'Application';

    // Log the error
    logger.error(`[ErrorBoundary] Error in ${context}:`, {
      error: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
      timestamp: new Date().toISOString()
    });

    // Update error state
    this.setState(
      (prevState) => ({
        errorInfo,
        errorCount: prevState.errorCount + 1
      }),
      () => {
        // Schedule auto-reset if enabled and not too many errors
        if (enableAutoReset && this.state.errorCount < 3) {
          this.scheduleReset(autoResetDelay);
        }
      }
    );

    // Handle chunk load errors with auto-reload
    if (enableChunkRecovery) {
      this.handleChunkLoadError(error, context);
    }

    // Report to main process if available
    this.reportErrorToMain(error, errorInfo);

    // Call optional error callback
    if (onError) {
      onError(error, errorInfo, context);
    }
  }

  componentWillUnmount() {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
      this.resetTimeoutId = null;
    }
  }

  /**
   * Detect and handle webpack chunk load failures
   */
  handleChunkLoadError(error, context) {
    const errName = String(error?.name || '');
    const errMsg = String(error?.message || '');
    const isChunkLoadError =
      errName === 'ChunkLoadError' ||
      /Loading chunk \d+ failed/i.test(errMsg) ||
      /ChunkLoadError/i.test(errMsg) ||
      /Failed to fetch dynamically imported module/i.test(errMsg);

    if (!isChunkLoadError) return;

    try {
      const key = 'stratosort:chunk-reload-at';
      const now = Date.now();
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(key) || 0);
      } catch {
        last = 0;
      }

      // Avoid infinite loops: allow at most 1 auto-reload per minute
      if (!Number.isFinite(last) || now - last >= 60_000) {
        try {
          sessionStorage.setItem(key, String(now));
        } catch {
          // ignore
        }
        logger.warn('[ChunkLoadRecovery] Caught chunk load failure; reloading window', {
          context,
          message: errMsg,
          name: errName
        });
        setTimeout(() => window.location.reload(), 0);
      } else {
        logger.warn('[ChunkLoadRecovery] Chunk load failure caught again within 60s; skipping', {
          context,
          message: errMsg,
          name: errName
        });
      }
    } catch {
      // ignore
    }
  }

  /**
   * Report error to main process via IPC
   */
  reportErrorToMain(error, errorInfo) {
    try {
      if (window?.electronAPI?.events?.sendError) {
        window.electronAPI.events.sendError({
          message: error?.message || 'Unknown error',
          stack: error?.stack,
          componentStack: errorInfo?.componentStack,
          type: 'react-error-boundary'
        });
      }
    } catch (reportError) {
      logger.error('[ErrorBoundary] Failed to report error to main:', reportError);
    }
  }

  scheduleReset(delay = 30000) {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
    }
    this.resetTimeoutId = setTimeout(() => {
      this.handleReset();
    }, delay);
  }

  handleReset() {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
      this.resetTimeoutId = null;
    }

    // Increment resetKey to force remount of children
    this.setState((prevState) => ({
      hasError: false,
      error: null,
      errorInfo: null,
      resetKey: prevState.resetKey + 1
    }));

    if (this.props.onReset) {
      this.props.onReset();
    }
  }

  handleNavigateHome() {
    this.setState((prevState) => ({
      hasError: false,
      error: null,
      errorInfo: null,
      resetKey: prevState.resetKey + 1
    }));

    if (this.props.onNavigateHome) {
      this.props.onNavigateHome();
    }
  }

  handleReload() {
    window.location.reload();
  }

  /**
   * Check if error is a chunk load error
   */
  isChunkLoadError() {
    const err = this.state.error;
    if (!err) return false;
    const errName = String(err?.name || '');
    const errMsg = String(err?.message || '');
    return (
      errName === 'ChunkLoadError' ||
      /Loading chunk \d+ failed/i.test(errMsg) ||
      /ChunkLoadError/i.test(errMsg) ||
      /Failed to fetch dynamically imported module/i.test(errMsg)
    );
  }

  /**
   * Render error details section
   */
  renderErrorDetails() {
    const { error, errorInfo } = this.state;
    return (
      <div className="bg-system-gray-50 rounded-lg p-4 mb-6">
        <p className="text-sm font-mono text-system-gray-700 break-words">
          {error?.message || 'Unknown error occurred'}
        </p>
        {process.env.NODE_ENV === 'development' && error?.stack && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-system-gray-500 hover:text-system-gray-700">
              Show stack trace
            </summary>
            <pre className="mt-2 text-xs text-system-gray-600 overflow-auto max-h-40 p-2 bg-white rounded border border-border-soft">
              {error.stack}
              {errorInfo?.componentStack}
            </pre>
          </details>
        )}
      </div>
    );
  }

  /**
   * Render global/full-screen variant
   */
  renderGlobalFallback() {
    const { errorCount } = this.state;
    const isChunk = this.isChunkLoadError();

    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-surface-primary to-surface-muted p-8">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl border border-border-soft p-8 animate-slide-up">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-system-red/10 rounded-full mb-4">
              <AlertTriangle className="w-8 h-8 text-system-red" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold text-system-gray-900 mb-2">
              Oops! Something went wrong
            </h1>
            <p className="text-system-gray-600">
              {isChunk
                ? 'App assets failed to load. This usually happens after an update.'
                : 'The application encountered an unexpected error.'}
            </p>
          </div>

          {errorCount > 2 && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
              <p className="text-sm text-yellow-800">
                Multiple errors detected. Consider reloading the application.
              </p>
            </div>
          )}

          {this.renderErrorDetails()}

          <div className="flex gap-3">
            {isChunk ? (
              <>
                <button onClick={this.handleReload} className="flex-1 btn-primary">
                  Reload App
                </button>
                <button onClick={this.handleReset} className="flex-1 btn-secondary">
                  Try Again
                </button>
              </>
            ) : (
              <>
                <button onClick={this.handleReset} className="flex-1 btn-primary">
                  Try Again
                </button>
                <button onClick={this.handleReload} className="flex-1 btn-secondary">
                  Reload App
                </button>
              </>
            )}
          </div>

          <p className="text-xs text-center text-system-gray-500 mt-4">
            If this problem persists, please check your settings or contact support.
          </p>
        </div>
      </div>
    );
  }

  /**
   * Render phase/inline variant with context
   */
  renderPhaseFallback() {
    const { contextName, showNavigateHome } = this.props;
    const isChunk = this.isChunkLoadError();

    return (
      <div className="container-responsive py-12">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-xl shadow-lg border border-border-soft p-8">
            <div className="flex items-start gap-4 mb-6">
              <div className="flex-shrink-0">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-system-red/10 rounded-lg">
                  <AlertTriangle className="w-6 h-6 text-system-red" aria-hidden="true" />
                </div>
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-system-gray-900 mb-2">
                  {contextName ? `${contextName} Error` : 'Error'}
                </h2>
                <p className="text-system-gray-600">
                  {contextName
                    ? `An error occurred in the ${contextName.toLowerCase()} phase. Your progress in other areas is safe.`
                    : 'An unexpected error occurred.'}
                </p>
                {isChunk && (
                  <p className="text-system-gray-600 mt-2">
                    This looks like an app asset mismatch. Reloading usually fixes it after an
                    update.
                  </p>
                )}
              </div>
            </div>

            {this.renderErrorDetails()}

            <div className="flex gap-3">
              {isChunk && (
                <button onClick={this.handleReload} className="flex-1 btn-primary">
                  Reload App
                </button>
              )}
              <button
                onClick={this.handleReset}
                className={`flex-1 ${isChunk ? 'btn-secondary' : 'btn-primary'}`}
              >
                Try Again
              </button>
              {showNavigateHome && (
                <button onClick={this.handleNavigateHome} className="flex-1 btn-secondary">
                  Go to Home
                </button>
              )}
            </div>

            <p className="text-xs text-center text-system-gray-500 mt-4">
              If this problem persists, try restarting the application.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /**
   * Render simple/minimal variant
   */
  renderSimpleFallback() {
    return (
      <div className="p-6 bg-white rounded-lg border border-system-red/20 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="w-6 h-6 text-system-red" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-system-gray-900">Something went wrong</h3>
        </div>

        {this.renderErrorDetails()}

        <div className="flex gap-3">
          <button onClick={this.handleReset} className="btn-primary">
            Try Again
          </button>
          <button onClick={this.handleReload} className="btn-secondary">
            Reload
          </button>
        </div>
      </div>
    );
  }

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.state.errorInfo, this.handleReset);
      }

      // Render variant-specific UI
      switch (this.props.variant) {
        case 'global':
          return this.renderGlobalFallback();
        case 'phase':
          return this.renderPhaseFallback();
        case 'simple':
        default:
          return this.renderSimpleFallback();
      }
    }

    // Use resetKey to force remount of children when recovering
    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}

ErrorBoundaryCore.propTypes = {
  children: PropTypes.node.isRequired,
  variant: PropTypes.oneOf(['global', 'phase', 'simple']),
  contextName: PropTypes.string,
  fallback: PropTypes.func,
  onReset: PropTypes.func,
  onError: PropTypes.func,
  onNavigateHome: PropTypes.func,
  showNavigateHome: PropTypes.bool,
  enableAutoReset: PropTypes.bool,
  autoResetDelay: PropTypes.number,
  enableChunkRecovery: PropTypes.bool
};

ErrorBoundaryCore.defaultProps = {
  variant: 'simple',
  contextName: null,
  fallback: null,
  onReset: null,
  onError: null,
  onNavigateHome: null,
  showNavigateHome: false,
  enableAutoReset: false,
  autoResetDelay: 30000,
  enableChunkRecovery: true
};

// Default export - simple error boundary for backward compatibility
export default ErrorBoundaryCore;

// Named exports for specific use cases
export { ErrorBoundaryCore };

// Convenience wrapper for global usage
export function GlobalErrorBoundary({ children, onReset, fallback }) {
  return (
    <ErrorBoundaryCore
      variant="global"
      enableAutoReset={true}
      autoResetDelay={30000}
      enableChunkRecovery={true}
      onReset={onReset}
      fallback={fallback}
    >
      {children}
    </ErrorBoundaryCore>
  );
}

GlobalErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
  onReset: PropTypes.func,
  fallback: PropTypes.func
};
