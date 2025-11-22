import React, { useState, useEffect, memo, useCallback } from 'react';
import PropTypes from 'prop-types';
import {
  PHASES,
  PHASE_TRANSITIONS,
  PHASE_METADATA,
} from '../../shared/constants';
import { logger } from '../../shared/logger';
import { usePhase } from '../contexts/PhaseContext';
import UpdateIndicator from './UpdateIndicator';

// Set logger context for this component
logger.setContext('NavigationBar');

// Phase Icons - Memoized to prevent unnecessary re-renders
const HomeIcon = memo(function HomeIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
    </svg>
  );
});
HomeIcon.propTypes = {
  className: PropTypes.string,
};

const CogIcon = memo(function CogIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
        clipRule="evenodd"
      />
    </svg>
  );
});
CogIcon.propTypes = {
  className: PropTypes.string,
};

const SearchIcon = memo(function SearchIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
        clipRule="evenodd"
      />
    </svg>
  );
});
SearchIcon.propTypes = {
  className: PropTypes.string,
};

const FolderIcon = memo(function FolderIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  );
});
FolderIcon.propTypes = {
  className: PropTypes.string,
};

const CheckCircleIcon = memo(function CheckCircleIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
        clipRule="evenodd"
      />
    </svg>
  );
});
CheckCircleIcon.propTypes = {
  className: PropTypes.string,
};

// Map phases to their icons
const phaseIcons = {
  [PHASES.WELCOME]: HomeIcon,
  [PHASES.SETUP]: CogIcon,
  [PHASES.DISCOVER]: SearchIcon,
  [PHASES.ORGANIZE]: FolderIcon,
  [PHASES.COMPLETE]: CheckCircleIcon,
};

// Settings Icon SVG Component - Memoized
const SettingsIcon = memo(function SettingsIcon({ className = '' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12A3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5a3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97c0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.08-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1c0 .33.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66Z" />
    </svg>
  );
});
SettingsIcon.propTypes = {
  className: PropTypes.string,
};

function NavigationBar() {
  const { currentPhase, actions } = usePhase();
  const [isScrolled, setIsScrolled] = useState(false);
  const [hoveredTab, setHoveredTab] = useState(null);

  useEffect(() => {
    const handleScroll = () => {
      try {
        // Add null check for window object
        if (typeof window !== 'undefined' && window.scrollY !== undefined) {
          setIsScrolled(window.scrollY > 10);
        }
      } catch (error) {
        logger.error('Error in scroll handler', {
          error: error.message,
          stack: error.stack,
        });
      }
    };

    // Initial check
    handleScroll();

    // Add event listener with error handling
    try {
      window.addEventListener('scroll', handleScroll, { passive: true });
    } catch (error) {
      logger.error('Failed to add scroll listener', {
        error: error.message,
      });
    }

    // Cleanup function
    return () => {
      try {
        window.removeEventListener('scroll', handleScroll);
      } catch (error) {
        logger.error('Failed to remove scroll listener', {
          error: error.message,
        });
      }
    };
  }, []);

  const handlePhaseChange = useCallback(
    (newPhase) => {
      try {
        // Validate inputs
        if (!newPhase || typeof newPhase !== 'string') {
          logger.warn('Invalid phase', { phase: newPhase });
          return;
        }

        const allowedTransitions = PHASE_TRANSITIONS[currentPhase] || [];
        if (
          allowedTransitions.includes(newPhase) ||
          newPhase === currentPhase
        ) {
          // Check if actions and advancePhase exist
          if (actions && typeof actions.advancePhase === 'function') {
            actions.advancePhase(newPhase);
          } else {
            logger.error('advancePhase function not available');
          }
        }
      } catch (error) {
        logger.error('Error changing phase', {
          error: error.message,
          stack: error.stack,
        });
      }
    },
    [currentPhase, actions],
  );

  const phaseOrder = [
    PHASES.WELCOME,
    PHASES.SETUP,
    PHASES.DISCOVER,
    PHASES.ORGANIZE,
    PHASES.COMPLETE,
  ];

  const getTwoWordLabel = (title, navLabel) => {
    if (navLabel && typeof navLabel === 'string') return navLabel;
    if (!title) return '';
    const filtered = title
      .replace(/&/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .filter((w) => !/^to|and|of|the|for|a|an$/i.test(w));
    return filtered.slice(0, 2).join(' ');
  };

  const navShellClasses = [
    'fixed inset-x-0 top-0 z-[100] border-b border-white/60',
    'backdrop-blur-xl backdrop-saturate-150 transition-all duration-300',
    isScrolled ? 'bg-white/95 shadow-glass' : 'bg-white/85 shadow-md',
  ].join(' ');

  return (
    <div className={navShellClasses} style={{ WebkitAppRegion: 'drag' }}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gradient-primary-start/30 to-transparent" />
      <div className="relative flex h-[var(--app-nav-height)] items-center justify-between px-5 md:px-8 lg:px-10 xl:px-12">
        <div
          className="flex items-center gap-3 select-none"
          style={{ WebkitAppRegion: 'no-drag' }}
        >
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-gradient-primary-start to-gradient-primary-end text-white font-semibold flex items-center justify-center shadow-glow">
            S
          </div>
          <div className="leading-tight">
            <p className="text-base font-semibold text-system-gray-900">
              StratoSort
            </p>
            <p className="text-xs text-system-gray-500">Cognitive file flow</p>
          </div>
        </div>

        <div
          className="flex items-center gap-3 lg:gap-4 xl:gap-5"
          style={{ WebkitAppRegion: 'no-drag' }}
        >
          {phaseOrder.map((phase) => {
            const metadata = PHASE_METADATA[phase];
            const allowedTransitions = PHASE_TRANSITIONS[currentPhase] || [];
            const canNavigate =
              allowedTransitions.includes(phase) || phase === currentPhase;
            const label = getTwoWordLabel(metadata.title, metadata.navLabel);
            const isActive = phase === currentPhase;
            const IconComponent = phaseIcons[phase];

            return (
              <button
                key={phase}
                onClick={() => canNavigate && handlePhaseChange(phase)}
                onMouseEnter={() => setHoveredTab(phase)}
                onMouseLeave={() => setHoveredTab(null)}
                disabled={!canNavigate}
                className={[
                  'relative flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-all duration-200',
                  isActive
                    ? 'bg-white text-stratosort-blue border-border-soft shadow-sm'
                    : canNavigate
                      ? 'text-system-gray-500 border-transparent hover:border-border-soft hover:text-system-gray-900 hover:bg-white/80'
                      : 'text-system-gray-400/70 border-transparent cursor-not-allowed',
                ].join(' ')}
                aria-label={metadata.title}
                aria-current={isActive ? 'page' : undefined}
                title={metadata.description || metadata.title}
                style={{ WebkitAppRegion: 'no-drag' }}
              >
                {IconComponent && (
                  <IconComponent
                    className={`h-4 w-4 ${
                      isActive || hoveredTab === phase
                        ? 'text-stratosort-blue'
                        : 'text-current opacity-70'
                    }`}
                  />
                )}
                <span className="font-medium">{label}</span>
                {isActive && (
                  <span className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-gradient-primary-start" />
                )}
              </button>
            );
          })}
        </div>

        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' }}
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-stratosort-success/30 bg-stratosort-success/10 px-3 py-1 text-xs font-medium text-stratosort-success">
            <span className="h-2 w-2 rounded-full bg-stratosort-success animate-pulse" />
            Connected
          </div>
          <UpdateIndicator />
          <button
            onClick={() => {
              try {
                if (actions && typeof actions.toggleSettings === 'function') {
                  actions.toggleSettings();
                } else {
                  logger.error('toggleSettings function not available');
                }
              } catch (error) {
                logger.error('Error toggling settings', {
                  error: error.message,
                  stack: error.stack,
                });
              }
            }}
            className="btn h-10 w-10 rounded-2xl border border-system-gray-200 bg-white text-system-gray-600 hover:text-stratosort-blue hover:border-stratosort-blue hover:shadow-md transition-all duration-200 flex items-center justify-center"
            aria-label="Open Settings"
            title="Settings"
          >
            <SettingsIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default NavigationBar;
