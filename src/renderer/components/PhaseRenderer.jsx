import React, { Suspense, lazy } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useKeyboardShortcuts } from '../hooks';
import { useAppSelector } from '../store/hooks';
import PhaseErrorBoundary from './PhaseErrorBoundary';
import { LazyLoadingSpinner, ModalLoadingOverlay } from './ui/LoadingSkeleton';
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
// Subtle slide + opacity for refined phase transitions (no slide when reduced motion preferred)
const pageVariants = (reducedMotion) => ({
  initial: {
    opacity: 0,
    y: reducedMotion ? 0 : 6
  },
  in: {
    opacity: 1,
    y: 0,
    transition: {
      duration: reducedMotion ? 0.1 : 0.22,
      ease: [0.16, 1, 0.3, 1]
    }
  },
  out: {
    opacity: 0,
    y: reducedMotion ? 0 : -4,
    transition: {
      duration: reducedMotion ? 0.08 : 0.15,
      ease: [0.4, 0, 0.2, 1]
    }
  }
});

const pageTransition = {
  type: 'tween',
  ease: [0.16, 1, 0.3, 1],
  duration: 0.2
};

function PhaseRenderer() {
  const currentPhase = useAppSelector((state) => state.ui.currentPhase);
  const showSettings = useAppSelector((state) => state.ui.showSettings);
  const shouldReduceMotion = useReducedMotion();
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
      <div className="flex flex-col w-full h-full">
        <Suspense fallback={<LazyLoadingSpinner message="Loading phase..." />}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={currentPhase}
              initial="initial"
              animate="in"
              exit="out"
              variants={pageVariants(Boolean(shouldReduceMotion))}
              transition={pageTransition}
              className="w-full flex-1 flex flex-col"
              style={{
                willChange: 'opacity, transform',
                backfaceVisibility: 'hidden'
              }}
            >
              {renderCurrentPhase()}
            </motion.div>
          </AnimatePresence>
        </Suspense>
      </div>
      <AnimatePresence>
        {showSettings && (
          <Suspense fallback={<ModalLoadingOverlay message="Loading Settings..." />}>
            <PhaseErrorBoundary phaseName="Settings">
              <motion.div
                key="settings-panel"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
              >
                <SettingsPanel />
              </motion.div>
            </PhaseErrorBoundary>
          </Suspense>
        )}
      </AnimatePresence>
    </>
  );
}

export default PhaseRenderer;
