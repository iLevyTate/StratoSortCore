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

// Preload all phases to avoid loading delays during navigation
const preloadPhases = () => {
  const load = (fn) => {
    fn();
  };
  load(() => import('../phases/WelcomePhase'));
  load(() => import('../phases/SetupPhase'));
  load(() => import('../phases/DiscoverPhase'));
  load(() => import('../phases/OrganizePhase'));
  load(() => import('../phases/CompletePhase'));
  load(() => import('./SettingsPanel'));
};

// Optimized page transitions with GPU acceleration
// Using simpler opacity-only transitions for smoother performance
const pageVariants = {
  initial: {
    opacity: 0
  },
  in: {
    opacity: 1,
    transition: {
      duration: 0.15, // Snappy entry
      ease: 'easeOut'
    }
  },
  out: {
    opacity: 0,
    transition: {
      duration: 0.05, // Almost instant exit to reduce "dead time" between tabs
      ease: 'easeIn'
    }
  }
};

const pageTransition = {
  type: 'tween',
  ease: 'easeOut',
  duration: 0.15
};

function PhaseRenderer() {
  const currentPhase = useAppSelector((state) => state.ui.currentPhase);
  const showSettings = useAppSelector((state) => state.ui.showSettings);
  useKeyboardShortcuts();

  // Preload phases on mount
  React.useEffect(() => {
    // Small delay to let initial render complete first
    const timer = setTimeout(() => {
      preloadPhases();
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // Debug logging to track phase rendering
  React.useEffect(() => {
    logger.debug('[PhaseRenderer] Rendering phase:', currentPhase);
  }, [currentPhase]);

  // Fixed: Wrap each phase with PhaseErrorBoundary for isolated error handling
  // FIX: Add null checks for PHASES to prevent crash if undefined
  const renderCurrentPhase = () => {
    switch (currentPhase) {
      case PHASES?.WELCOME ?? 'welcome':
        return (
          <PhaseErrorBoundary phaseName="Welcome">
            <WelcomePhase />
          </PhaseErrorBoundary>
        );
      case PHASES?.SETUP ?? 'setup':
        return (
          <PhaseErrorBoundary phaseName="Setup">
            <SetupPhase />
          </PhaseErrorBoundary>
        );
      case PHASES?.DISCOVER ?? 'discover':
        return (
          <PhaseErrorBoundary phaseName="Discover">
            <DiscoverPhase />
          </PhaseErrorBoundary>
        );
      case PHASES?.ORGANIZE ?? 'organize':
        return (
          <PhaseErrorBoundary phaseName="Organize">
            <OrganizePhase />
          </PhaseErrorBoundary>
        );
      case PHASES?.COMPLETE ?? 'complete':
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
