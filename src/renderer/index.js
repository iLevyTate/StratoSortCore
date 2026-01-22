import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { logger } from '../shared/logger';
import store from './store';
import { fetchDocumentsPath } from './store/slices/systemSlice';
import { fetchSmartFolders } from './store/slices/filesSlice';
import { fetchSettings } from './store/slices/uiSlice';
import App from './App.js';
import { applyPlatformClass } from './utils/platform';
import { GlobalErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

// Fetch commonly-used data early so it's cached before components need it
store.dispatch(fetchDocumentsPath());
// FIX: Force refresh on startup to ensure we have latest data from disk
// This overrides potentially stale data from localStorage
store.dispatch(fetchSmartFolders(true));
store.dispatch(fetchSettings(true));

// Add platform class to body for OS-specific styling hooks
applyPlatformClass();

// Set logger context for renderer entry point
logger.setContext('Renderer');

// FIX: Use named functions and track handler references for proper HMR cleanup
// Store handlers in a module-level object for reliable cleanup
const eventHandlers = {
  click: null,
  visibilitychange: null,
  beforeunload: null,
  unhandledrejection: null,
  error: null
};

// Remove any previously registered handlers (important for HMR)
function cleanupEventHandlers() {
  if (eventHandlers.click) {
    document.removeEventListener('click', eventHandlers.click);
  }
  if (eventHandlers.visibilitychange) {
    document.removeEventListener('visibilitychange', eventHandlers.visibilitychange);
  }
  if (eventHandlers.beforeunload) {
    window.removeEventListener('beforeunload', eventHandlers.beforeunload);
  }
  if (eventHandlers.unhandledrejection) {
    window.removeEventListener('unhandledrejection', eventHandlers.unhandledrejection);
  }
  if (eventHandlers.error) {
    window.removeEventListener('error', eventHandlers.error);
  }
}

function isChunkLoadFailure(err) {
  const name = String(err?.name || '');
  const message = String(err?.message || '');
  // Common signatures across webpack + browsers
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk \d+ failed/i.test(message) ||
    /ChunkLoadError/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message)
  );
}

function maybeRecoverFromChunkLoadFailure(err) {
  if (!isChunkLoadFailure(err)) return false;

  // Avoid infinite reload loops. Allow at most 1 auto-reload per minute.
  const key = 'stratosort:chunk-reload-at';
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(key) || 0);
  } catch {
    last = 0;
  }

  const now = Date.now();
  if (Number.isFinite(last) && now - last < 60_000) {
    logger.warn('[ChunkLoadRecovery] Chunk load failed again within 60s; not auto-reloading', {
      message: err?.message,
      name: err?.name
    });
    return true; // handled (we intentionally didn't reload)
  }

  try {
    sessionStorage.setItem(key, String(now));
  } catch {
    // ignore
  }

  logger.warn('[ChunkLoadRecovery] Chunk load failed; reloading window to resync assets', {
    message: err?.message,
    name: err?.name
  });

  // A hard reload typically resolves mismatched dist chunks after rebuild/update.
  window.location.reload();
  return true;
}

// Enable smooth scrolling globally
if (typeof window !== 'undefined') {
  // Set smooth scroll on document
  document.documentElement.style.scrollBehavior = 'smooth';
  document.body.style.scrollBehavior = 'smooth';

  // Clean up any existing handlers first
  cleanupEventHandlers();

  // Add smooth scroll behavior to all internal links with proper cleanup
  eventHandlers.click = function handleSmoothScrollClick(e) {
    const link = e.target.closest('a');
    if (link && link.getAttribute('href')?.startsWith('#')) {
      e.preventDefault();
      const targetId = link.getAttribute('href').slice(1);
      const target = document.getElementById(targetId);
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest'
        });
      }
    }
  };

  document.addEventListener('click', eventHandlers.click);

  // Handle visibility changes - simplified, removed ineffective animation frame cleanup
  eventHandlers.visibilitychange = function handleVisibilityChange() {
    // Visibility changes are handled - no action needed currently
    // The previous animation frame cancellation loop was ineffective
    // as it only cancelled frames that hadn't started yet
  };
  document.addEventListener('visibilitychange', eventHandlers.visibilitychange);

  // Add cleanup on page unload to prevent dangling references
  eventHandlers.beforeunload = function handleBeforeUnload() {
    cleanupEventHandlers();
  };
  window.addEventListener('beforeunload', eventHandlers.beforeunload);

  // Recover from webpack chunk load errors (often caused by stale/mismatched dist assets)
  eventHandlers.unhandledrejection = function handleUnhandledRejection(e) {
    const reason = e?.reason;
    if (maybeRecoverFromChunkLoadFailure(reason)) {
      try {
        e.preventDefault?.();
      } catch {
        // ignore
      }
    }
  };
  window.addEventListener('unhandledrejection', eventHandlers.unhandledrejection);

  eventHandlers.error = function handleWindowError(e) {
    // Some chunk load failures surface as generic error events.
    // Prefer the Error instance if present.
    const err = e?.error || e;
    void maybeRecoverFromChunkLoadFailure(err);
  };
  window.addEventListener('error', eventHandlers.error);

  // Support HMR cleanup if module.hot is available
  if (typeof module !== 'undefined' && module.hot) {
    module.hot.dispose(() => {
      cleanupEventHandlers();
    });
  }
}

// Helper to update splash screen status
function updateSplashStatus(message) {
  const statusEl = document.getElementById('splash-status');
  if (statusEl) {
    statusEl.textContent = message;
  }
}

// FIX: Guard against multiple initializations (prevents double splash screen)
// These flags prevent race conditions during HMR, StrictMode double-render, and rapid reloads
let isAppInitialized = false;
let splashRemovalInProgress = false;
let reactRoot = null;

/**
 * Safely remove the splash screen with proper guards against double removal
 * FIX: Prevents the "double splash" visual bug by ensuring removal only happens once
 */
function removeSplashScreen() {
  // Guard: Don't start removal if already in progress or completed
  if (splashRemovalInProgress) {
    logger.debug('[Splash] Removal already in progress, skipping duplicate call');
    return;
  }

  const initialLoading = document.getElementById('initial-loading');
  if (!initialLoading) {
    // Already removed or never existed
    return;
  }

  splashRemovalInProgress = true;

  // Add fade-out animation
  initialLoading.style.transition = 'opacity 0.3s ease-out';
  initialLoading.style.opacity = '0';

  // Remove after animation completes
  setTimeout(() => {
    // Double-check element still exists before removing
    const element = document.getElementById('initial-loading');
    if (element) {
      element.remove();
      logger.debug('[Splash] Splash screen removed successfully');
    }
  }, 300);
}

// Wait for DOM to be ready before initializing React
function initializeApp() {
  // FIX: Prevent multiple initializations which can cause double splash screens
  if (isAppInitialized) {
    logger.debug('[initializeApp] Already initialized, skipping duplicate call');
    return;
  }
  isAppInitialized = true;

  try {
    updateSplashStatus('Loading dependencies...');

    // Debug logging in development mode
    if (process.env.NODE_ENV === 'development') {
      logger.debug('Initializing React application');
    }

    // Find the root container
    const container = document.getElementById('root');
    if (!container) {
      throw new Error(
        'Root container not found! Make sure there is a div with id="root" in the HTML.'
      );
    }

    updateSplashStatus('Preparing interface...');

    // Debug logging in development mode
    if (process.env.NODE_ENV === 'development') {
      logger.debug('Root container found, creating React root');
    }

    // FIX: Reuse existing root during HMR to prevent duplicate renders
    if (!reactRoot) {
      reactRoot = createRoot(container);
    }

    updateSplashStatus('Starting application...');

    // Render the React app with global error boundary
    reactRoot.render(
      <React.StrictMode>
        <GlobalErrorBoundary>
          <Provider store={store}>
            <App />
          </Provider>
        </GlobalErrorBoundary>
      </React.StrictMode>
    );

    // FIX: Remove initial loading after first paint with proper guards
    // Using requestAnimationFrame ensures we wait for the first paint
    // FIX: Increased delay from 50ms to 150ms to prevent double splash screen effect (Issue 3.1)
    requestAnimationFrame(() => {
      // Add delay to ensure React has fully rendered
      // This prevents flash-of-content issues on slower machines
      setTimeout(removeSplashScreen, 150);
    });

    // Debug logging in development mode
    if (process.env.NODE_ENV === 'development') {
      logger.debug('React application initialized successfully');
    }
  } catch (error) {
    logger.error('Failed to initialize React application', {
      error: error.message,
      stack: error.stack
    });

    // Show error message in the initial loading screen with polished styling
    // Security: Use textContent for error message to prevent XSS
    const initialLoading = document.getElementById('initial-loading');
    if (initialLoading) {
      const errorSection = document.createElement('section');
      errorSection.className = 'splash-error';

      const icon = document.createElement('div');
      icon.className = 'splash-error-icon';
      icon.textContent = '⚠️';
      icon.setAttribute('aria-hidden', 'true');

      const heading = document.createElement('h1');
      heading.className = 'splash-error-title';
      heading.textContent = 'Failed to Load';

      const description = document.createElement('p');
      description.className = 'splash-error-message';
      description.textContent =
        'The application encountered an error during startup. Please try reloading.';

      const details = document.createElement('details');
      details.className = 'splash-error-details';

      const summary = document.createElement('summary');
      summary.textContent = 'View error details';

      const pre = document.createElement('pre');
      pre.textContent = error.message; // Safe: textContent escapes HTML

      details.appendChild(summary);
      details.appendChild(pre);
      errorSection.appendChild(icon);
      errorSection.appendChild(heading);
      errorSection.appendChild(description);
      errorSection.appendChild(details);

      // Clear existing content and show error
      while (initialLoading.firstChild) {
        initialLoading.removeChild(initialLoading.firstChild);
      }

      // Keep the background
      const bg = document.createElement('div');
      bg.className = 'splash-background';
      initialLoading.appendChild(bg);
      initialLoading.appendChild(errorSection);
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  // DOM is already ready
  initializeApp();
}
