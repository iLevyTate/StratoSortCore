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
        <div className="page-shell app-surface flex h-screen flex-col overflow-hidden">
          <NavigationBar />
          <main
            id="main-content"
            className="flex-1 flex flex-col min-h-0 pt-[var(--app-nav-height)] overflow-y-auto overflow-x-hidden modern-scrollbar"
            tabIndex={-1}
          >
            <PhaseRenderer />
          </main>
        </div>
        <TooltipManager />
      </AppProviders>
    </ErrorBoundary>
  );
}

export default App;
