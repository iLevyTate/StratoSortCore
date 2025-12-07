import React from 'react';

import PhaseRenderer from './components/PhaseRenderer';
import NavigationBar from './components/NavigationBar';
import TooltipManager from './components/TooltipManager';
// FIX: ChromaDB status subscription - keeps Redux store in sync with service status
import ChromaDBStatusManager from './components/ChromaDBStatusManager';

import AppProviders from './components/AppProviders';
import ErrorBoundary from './components/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        {/* FIX: Subscribe to ChromaDB status changes and update Redux store */}
        <ChromaDBStatusManager />
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <div className="page-shell app-surface flex min-h-screen min-h-0 flex-col overflow-hidden">
          <NavigationBar />
          <main
            id="main-content"
            className="flex flex-1 min-h-0 flex-col pt-[var(--app-nav-height)] overflow-auto modern-scrollbar"
            tabIndex={-1}
          >
            <div className="flex-1 min-h-0 overflow-y-auto relative">
              <PhaseRenderer />
            </div>
          </main>
        </div>
        <TooltipManager />
      </AppProviders>
    </ErrorBoundary>
  );
}

export default App;
