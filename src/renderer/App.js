import React, { useMemo } from 'react';
import { useAppSelector } from './store/hooks';
import { PHASES } from '../shared/constants';

import PhaseRenderer from './components/PhaseRenderer';
import NavigationBar from './components/NavigationBar';
import TooltipManager from './components/TooltipManager';
// FIX: ChromaDB status subscription - keeps Redux store in sync with service status
import ChromaDBStatusManager from './components/ChromaDBStatusManager';
import AiDependenciesModalManager from './components/AiDependenciesModalManager';

import AppProviders from './components/AppProviders';
import ErrorBoundary from './components/ErrorBoundary';
import AppShell from './components/layout/AppShell';

function AppContent() {
  const currentPhase = useAppSelector((state) => state.ui.currentPhase);

  // Determine content container classes based on phase
  const contentClassName = useMemo(() => {
    const baseClasses = 'flex-1 w-full mx-auto';

    switch (currentPhase) {
      case PHASES?.WELCOME:
      case 'welcome':
        // Welcome phase handles its own vertical padding/centering
        return `${baseClasses} px-4 sm:px-6 lg:px-8 py-0 max-w-5xl`;

      case PHASES?.SETUP:
      case 'setup':
        return `${baseClasses} px-4 sm:px-6 lg:px-8 py-6 max-w-screen-2xl`;

      case PHASES?.DISCOVER:
      case 'discover':
        return `${baseClasses} px-4 sm:px-6 lg:px-8 py-6 max-w-screen-2xl`;

      case PHASES?.ORGANIZE:
      case 'organize':
        return `${baseClasses} px-4 sm:px-6 lg:px-8 py-6 max-w-screen-2xl`;

      case PHASES?.COMPLETE:
      case 'complete':
        return `${baseClasses} px-4 sm:px-6 lg:px-8 py-6 max-w-screen-2xl`;

      default:
        return `${baseClasses} px-4 sm:px-6 lg:px-8 py-6 max-w-screen-2xl`;
    }
  }, [currentPhase]);

  return (
    <>
      {/* FIX: Subscribe to ChromaDB status changes and update Redux store */}
      <ChromaDBStatusManager />
      <AiDependenciesModalManager />
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <AppShell header={<NavigationBar />} contentClassName={contentClassName}>
        <PhaseRenderer />
      </AppShell>

      <TooltipManager />
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <AppContent />
      </AppProviders>
    </ErrorBoundary>
  );
}

export default App;
