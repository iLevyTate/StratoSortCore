import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { logger } from '../shared/logger';
import store from './store';
import { fetchDocumentsPath } from './store/slices/systemSlice';
import { fetchSmartFolders } from './store/slices/filesSlice';
import { fetchSettings } from './store/slices/uiSlice';
import App from './App.js';
import GlobalErrorBoundary from './components/GlobalErrorBoundary.jsx';
import './tailwind.css';

// Fetch commonly-used data early so it's cached before components need it
store.dispatch(fetchDocumentsPath());
store.dispatch(fetchSmartFolders());
store.dispatch(fetchSettings());

// Set logger context for renderer entry point
logger.setContext('Renderer');

// Enable smooth scrolling globally
if (typeof window !== 'undefined') {
  // Set smooth scroll on document
  document.documentElement.style.scrollBehavior = 'smooth';
  document.body.style.scrollBehavior = 'smooth';

  // Add smooth scroll behavior to all internal links with proper cleanup
  const clickHandler = (e) => {
    const link = e.target.closest('a');
    if (link && link.getAttribute('href')?.startsWith('#')) {
      e.preventDefault();
      const targetId = link.getAttribute('href').slice(1);
      const target = document.getElementById(targetId);
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest',
        });
      }
    }
  };

  document.addEventListener('click', clickHandler);

  // Handle visibility changes to clean up references during minimize/restore
  const visibilityHandler = () => {
    if (document.hidden) {
      // Clear any pending animations or timers when window is hidden
      if (typeof cancelAnimationFrame !== 'undefined') {
        // Cancel any pending animation frames to prevent dangling callbacks
        let id = requestAnimationFrame(() => {});
        while (id > 0) {
          cancelAnimationFrame(id--);
        }
      }
    }
  };
  document.addEventListener('visibilitychange', visibilityHandler);

  // Add cleanup on page unload to prevent dangling references
  window.addEventListener('beforeunload', () => {
    document.removeEventListener('click', clickHandler);
    document.removeEventListener('visibilitychange', visibilityHandler);
  });
}

// Wait for DOM to be ready before initializing React
function initializeApp() {
  try {
    // Debug logging in development mode
    if (process.env.NODE_ENV === 'development') {
      logger.debug('Initializing React application');
    }

    // Find the root container
    const container = document.getElementById('root');
    if (!container) {
      throw new Error(
        'Root container not found! Make sure there is a div with id="root" in the HTML.',
      );
    }

    // Debug logging in development mode
    if (process.env.NODE_ENV === 'development') {
      logger.debug('Root container found, creating React root');
    }

    // Create React root
    const root = createRoot(container);

    // Render the React app with global error boundary
    root.render(
      <React.StrictMode>
        <GlobalErrorBoundary>
          <Provider store={store}>
            <App />
          </Provider>
        </GlobalErrorBoundary>
      </React.StrictMode>,
    );

    // Remove initial loading after first paint
    requestAnimationFrame(() => {
      const initialLoading = document.getElementById('initial-loading');
      if (initialLoading) initialLoading.remove();
    });

    // Debug logging in development mode
    if (process.env.NODE_ENV === 'development') {
      logger.debug('React application initialized successfully');
    }
  } catch (error) {
    logger.error('Failed to initialize React application', {
      error: error.message,
      stack: error.stack,
    });

    // Show error message in the initial loading screen
    // Security: Use textContent for error message to prevent XSS
    const initialLoading = document.getElementById('initial-loading');
    if (initialLoading) {
      const section = document.createElement('section');
      section.className =
        'mx-auto max-w-md text-center text-stratosort-danger';

      const icon = document.createElement('div');
      icon.className = 'text-4xl mb-4';
      icon.textContent = '⚠️';

      const heading = document.createElement('h1');
      heading.className = 'm-0 text-2xl font-semibold text-stratosort-danger';
      heading.textContent = 'Failed to Load';

      const description = document.createElement('p');
      description.className = 'mt-2 text-sm text-system-gray-500';
      description.textContent = 'React application failed to initialize';

      const details = document.createElement('details');
      details.className = 'mt-4 text-left';

      const summary = document.createElement('summary');
      summary.className =
        'cursor-pointer text-system-gray-500 hover:text-system-gray-700 transition-colors';
      summary.textContent = 'Error Details';

      const pre = document.createElement('pre');
      pre.className =
        'mt-2 overflow-auto rounded-lg border border-border-soft bg-surface-muted p-3 text-xs text-system-gray-800 font-mono';
      pre.textContent = error.message; // Safe: textContent escapes HTML

      details.appendChild(summary);
      details.appendChild(pre);
      section.appendChild(icon);
      section.appendChild(heading);
      section.appendChild(description);
      section.appendChild(details);

      initialLoading.innerHTML = '';
      initialLoading.appendChild(section);
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
