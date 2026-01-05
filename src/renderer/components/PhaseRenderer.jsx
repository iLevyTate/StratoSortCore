import React, { Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useKeyboardShortcuts } from '../hooks';
import { useAppSelector } from '../store/hooks';
import PhaseErrorBoundary from './PhaseErrorBoundary';
import { LazyLoadingSpinner, ModalLoadingOverlay } from './LoadingSkeleton';
import { logger } from '../../shared/logger';
import { PHASES } from '../../shared/constants';

const WelcomePhase = lazy(() => import('../phases/WelcomePhase'));
const SetupPhase = lazy(() => import('../phases/SetupPhase'));
const DiscoverPhase = lazy(() => import('../phases/DiscoverPhase'));
const OrganizePhase = lazy(() => import('../phases/OrganizePhase'));
const CompletePhase = lazy(() => import('../phases/CompletePhase'));
const SettingsPanel = lazy(() => import('./SettingsPanel'));

// Optimized page transitions with GPU acceleration
// Using simpler opacity-only transitions for smoother performance
const pageVariants = {
  initial: {
    opacity: 0
  },
  in: {
    opacity: 1
  },
  out: {
    opacity: 0
  }
};

const pageTransition = {
  type: 'tween',
  ease: 'easeInOut',
  duration: 0.2 // Fast, smooth fade
};

function PhaseRenderer() {
  const currentPhase = useAppSelector((state) => state.ui.currentPhase);
  const showSettings = useAppSelector((state) => state.ui.showSettings);
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
    <>
      <div className="flex flex-col w-full min-h-full">
        <Suspense fallback={<LazyLoadingSpinner message="Loading phase..." />}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={currentPhase}
              initial="initial"
              animate="in"
              exit="out"
              variants={pageVariants}
              transition={pageTransition}
              className="w-full flex-1 flex flex-col"
              style={{
                willChange: 'opacity',
                backfaceVisibility: 'hidden',
                transform: 'translate3d(0, 0, 0)'
              }}
            >
              {renderCurrentPhase()}
            </motion.div>
          </AnimatePresence>
        </Suspense>
      </div>
      {showSettings && (
        <Suspense fallback={<ModalLoadingOverlay message="Loading Settings..." />}>
          <PhaseErrorBoundary phaseName="Settings">
            <SettingsPanel />
          </PhaseErrorBoundary>
        </Suspense>
      )}
    </>
  );
}

export default PhaseRenderer;
