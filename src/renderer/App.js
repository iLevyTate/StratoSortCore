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

  // Determine max width based on phase
  const maxWidth = useMemo(() => {
    switch (currentPhase) {
      case PHASES?.WELCOME:
      case 'welcome':
        return 'max-w-5xl';
      case PHASES?.SETUP:
      case 'setup':
        return 'max-w-5xl';
      case PHASES?.DISCOVER:
      case 'discover':
        return 'max-w-screen-2xl';
      case PHASES?.ORGANIZE:
      case 'organize':
        return 'max-w-full px-0 sm:px-0 lg:px-0'; // Full width for organize phase
      case PHASES?.COMPLETE:
      case 'complete':
        return 'max-w-5xl';
      default:
        return 'max-w-screen-2xl';
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

      <AppShell header={<NavigationBar />} maxWidth={maxWidth}>
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
