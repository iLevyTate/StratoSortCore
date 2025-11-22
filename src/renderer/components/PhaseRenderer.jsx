import React, { Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useKeyboardShortcuts } from '../hooks';
import { usePhase } from '../contexts/PhaseContext';
import PhaseErrorBoundary from './PhaseErrorBoundary';
import { LazyLoadingSpinner, ModalLoadingOverlay } from './LoadingSkeleton';
import { logger } from '../../shared/logger';

const WelcomePhase = lazy(() => import('../phases/WelcomePhase'));
const SetupPhase = lazy(() => import('../phases/SetupPhase'));
const DiscoverPhase = lazy(() => import('../phases/DiscoverPhase'));
const OrganizePhase = lazy(() => import('../phases/OrganizePhase'));
const CompletePhase = lazy(() => import('../phases/CompletePhase'));
const SettingsPanel = lazy(() => import('./SettingsPanel'));
import { PHASES } from '../../shared/constants';

const pageVariants = {
  initial: {
    opacity: 0,
    y: 20,
  },
  in: {
    opacity: 1,
    y: 0,
  },
  out: {
    opacity: 0,
    y: -20,
  },
};

const pageTransition = {
  type: 'tween',
  ease: 'anticipate',
  duration: 0.5,
};

function PhaseRenderer() {
  const { currentPhase, showSettings } = usePhase();
  useKeyboardShortcuts();

  // Debug logging to track phase rendering
  React.useEffect(() => {
    logger.debug('[PhaseRenderer] Rendering phase:', currentPhase);
  }, [currentPhase]);

  // Fixed: Wrap each phase with PhaseErrorBoundary for isolated error handling
  const renderCurrentPhase = () => {
    switch (currentPhase) {
      case PHASES.WELCOME:
        return (
          <PhaseErrorBoundary phaseName="Welcome">
            <WelcomePhase />
          </PhaseErrorBoundary>
        );
      case PHASES.SETUP:
        return (
          <PhaseErrorBoundary phaseName="Setup">
            <SetupPhase />
          </PhaseErrorBoundary>
        );
      case PHASES.DISCOVER:
        return (
          <PhaseErrorBoundary phaseName="Discover">
            <DiscoverPhase />
          </PhaseErrorBoundary>
        );
      case PHASES.ORGANIZE:
        return (
          <PhaseErrorBoundary phaseName="Organize">
            <OrganizePhase />
          </PhaseErrorBoundary>
        );
      case PHASES.COMPLETE:
        return (
          <PhaseErrorBoundary phaseName="Complete">
            <CompletePhase />
          </PhaseErrorBoundary>
        );
      default:
        return (
          <PhaseErrorBoundary phaseName="Welcome">
            <WelcomePhase />
          </PhaseErrorBoundary>
        );
    }
  };

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <Suspense fallback={<LazyLoadingSpinner message="Loading phase..." />}>
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPhase}
            initial="initial"
            animate="in"
            exit="out"
            variants={pageVariants}
            transition={pageTransition}
            className="w-full h-full flex flex-col overflow-hidden"
          >
            {renderCurrentPhase()}
          </motion.div>
        </AnimatePresence>
      </Suspense>
      {showSettings && (
        <Suspense
          fallback={<ModalLoadingOverlay message="Loading Settings..." />}
        >
          <PhaseErrorBoundary phaseName="Settings">
            <SettingsPanel />
          </PhaseErrorBoundary>
        </Suspense>
      )}
    </div>
  );
}

export default PhaseRenderer;
