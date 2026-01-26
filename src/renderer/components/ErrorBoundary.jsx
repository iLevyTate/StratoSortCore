import React from 'react';
import PropTypes from 'prop-types';
import { AlertTriangle } from 'lucide-react';
import { logger } from '../../shared/logger';
import Button from './ui/Button';
import Card from './ui/Card';
import { Heading, Text } from './ui/Typography';

logger.setContext('ErrorBoundary');

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

    logger.error(`[ErrorBoundary] Error in ${context}:`, {
      error: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
      timestamp: new Date().toISOString()
    });

    this.setState(
      (prevState) => ({
        errorInfo,
        errorCount: prevState.errorCount + 1
      }),
      () => {
        if (enableAutoReset && this.state.errorCount < 3) {
          this.scheduleReset(autoResetDelay);
        }
      }
    );

    if (enableChunkRecovery) {
      this.handleChunkLoadError(error, context);
    }

    this.reportErrorToMain(error, errorInfo);

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

  renderErrorDetails() {
    const { error, errorInfo } = this.state;
    return (
      <div className="bg-system-gray-50 rounded-lg p-4 mb-6">
        <Text variant="tiny" className="font-mono text-system-gray-700 break-words">
          {error?.message || 'Unknown error occurred'}
        </Text>
        {process.env.NODE_ENV === 'development' && error?.stack && (
          <details className="mt-3">
            <Text
              as="summary"
              variant="tiny"
              className="cursor-pointer text-system-gray-500 hover:text-system-gray-700"
            >
              Show stack trace
            </Text>
            <pre className="mt-2 text-xs text-system-gray-600 overflow-auto max-h-40 p-2 bg-white rounded border border-border-soft">
              {error.stack}
              {errorInfo?.componentStack}
            </pre>
          </details>
        )}
      </div>
    );
  }

  renderGlobalFallback() {
    const { errorCount } = this.state;
    const isChunk = this.isChunkLoadError();

    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-surface-primary to-surface-muted p-8">
        <Card variant="elevated" className="max-w-lg w-full p-8 animate-slide-up">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-stratosort-danger/10 rounded-full mb-4">
              <AlertTriangle className="w-8 h-8 text-stratosort-danger" aria-hidden="true" />
            </div>
            <Heading as="h1" variant="h3" className="mb-2">
              Oops! Something went wrong
            </Heading>
            <Text variant="body" className="text-system-gray-600">
              {isChunk
                ? 'App assets failed to load. This usually happens after an update.'
                : 'The application encountered an unexpected error.'}
            </Text>
          </div>

          {errorCount > 2 && (
            <div className="mb-4 p-3 bg-stratosort-warning/10 border border-stratosort-warning/20 rounded">
              <Text variant="small" className="text-stratosort-warning">
                Multiple errors detected. Consider reloading the application.
              </Text>
            </div>
          )}

          {this.renderErrorDetails()}

          <div className="flex gap-3">
            {isChunk ? (
              <>
                <Button onClick={this.handleReload} variant="primary" className="flex-1">
                  Reload App
                </Button>
                <Button onClick={this.handleReset} variant="secondary" className="flex-1">
                  Try Again
                </Button>
              </>
            ) : (
              <>
                <Button onClick={this.handleReset} variant="primary" className="flex-1">
                  Try Again
                </Button>
                <Button onClick={this.handleReload} variant="secondary" className="flex-1">
                  Reload App
                </Button>
              </>
            )}
          </div>

          <Text variant="tiny" className="text-center text-system-gray-500 mt-4">
            If this problem persists, please check your settings or contact support.
          </Text>
        </Card>
      </div>
    );
  }

  renderPhaseFallback() {
    const { contextName, showNavigateHome } = this.props;
    const isChunk = this.isChunkLoadError();

    return (
      <div className="container-responsive py-8">
        <div className="max-w-2xl mx-auto">
          <Card variant="default" className="p-8">
            <div className="flex items-start gap-4 mb-6">
              <div className="flex-shrink-0">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-stratosort-danger/10 rounded-lg">
                  <AlertTriangle className="w-6 h-6 text-stratosort-danger" aria-hidden="true" />
                </div>
              </div>
              <div className="flex-1">
                <Heading as="h2" variant="h4" className="mb-2">
                  {contextName ? `${contextName} Error` : 'Error'}
                </Heading>
                <Text variant="body" className="text-system-gray-600">
                  {contextName
                    ? `An error occurred in the ${contextName.toLowerCase()} phase. Your progress in other areas is safe.`
                    : 'An unexpected error occurred.'}
                </Text>
                {isChunk && (
                  <Text variant="small" className="text-system-gray-600 mt-2">
                    This looks like an app asset mismatch. Reloading usually fixes it after an
                    update.
                  </Text>
                )}
              </div>
            </div>

            {this.renderErrorDetails()}

            <div className="flex gap-3">
              {isChunk && (
                <Button onClick={this.handleReload} variant="primary" className="flex-1">
                  Reload App
                </Button>
              )}
              <Button
                onClick={this.handleReset}
                variant={isChunk ? 'secondary' : 'primary'}
                className="flex-1"
              >
                Try Again
              </Button>
              {showNavigateHome && (
                <Button onClick={this.handleNavigateHome} variant="secondary" className="flex-1">
                  Go to Home
                </Button>
              )}
            </div>

            <Text variant="tiny" className="text-center text-system-gray-500 mt-4">
              If this problem persists, try restarting the application.
            </Text>
          </Card>
        </div>
      </div>
    );
  }

  renderSimpleFallback() {
    return (
      <Card variant="error" className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="w-6 h-6 text-stratosort-danger" aria-hidden="true" />
          <Heading as="h3" variant="h5">
            Something went wrong
          </Heading>
        </div>

        {this.renderErrorDetails()}

        <div className="flex gap-3">
          <Button onClick={this.handleReset} variant="primary">
            Try Again
          </Button>
          <Button onClick={this.handleReload} variant="secondary">
            Reload
          </Button>
        </div>
      </Card>
    );
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.state.errorInfo, this.handleReset);
      }

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

export default ErrorBoundaryCore;

export { ErrorBoundaryCore };

export function GlobalErrorBoundary({ children, onReset, fallback }) {
  return (
    <ErrorBoundaryCore
      variant="global"
      enableAutoReset
      autoResetDelay={30000}
      enableChunkRecovery
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
