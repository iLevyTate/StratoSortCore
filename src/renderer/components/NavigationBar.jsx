import React, { useState, useEffect, memo, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import {
  Home,
  Settings,
  Search,
  FolderOpen,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import {
  PHASES,
  PHASE_TRANSITIONS,
  PHASE_METADATA,
} from '../../shared/constants';
import { logger } from '../../shared/logger';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { setPhase, toggleSettings } from '../store/slices/uiSlice';
import UpdateIndicator from './UpdateIndicator';

logger.setContext('NavigationBar');

// =============================================================================
// Icon Components - Using Lucide React for premium icons
// =============================================================================

const HomeIcon = memo(function HomeIcon({ className = '' }) {
  return <Home className={className} aria-hidden="true" />;
});
HomeIcon.propTypes = { className: PropTypes.string };

const CogIcon = memo(function CogIcon({ className = '' }) {
  return <Settings className={className} aria-hidden="true" />;
});
CogIcon.propTypes = { className: PropTypes.string };

const SearchIcon = memo(function SearchIcon({ className = '' }) {
  return <Search className={className} aria-hidden="true" />;
});
SearchIcon.propTypes = { className: PropTypes.string };

const FolderIcon = memo(function FolderIcon({ className = '' }) {
  return <FolderOpen className={className} aria-hidden="true" />;
});
FolderIcon.propTypes = { className: PropTypes.string };

const CheckCircleIcon = memo(function CheckCircleIcon({ className = '' }) {
  return <CheckCircle2 className={className} aria-hidden="true" />;
});
CheckCircleIcon.propTypes = { className: PropTypes.string };

const SettingsIcon = memo(function SettingsIcon({ className = '' }) {
  return <Settings className={className} aria-hidden="true" />;
});
SettingsIcon.propTypes = { className: PropTypes.string };

const SpinnerIcon = memo(function SpinnerIcon({ className = '' }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden="true" />;
});
SpinnerIcon.propTypes = { className: PropTypes.string };

// Phase to icon mapping
const PHASE_ICONS = {
  [PHASES.WELCOME]: HomeIcon,
  [PHASES.SETUP]: CogIcon,
  [PHASES.DISCOVER]: SearchIcon,
  [PHASES.ORGANIZE]: FolderIcon,
  [PHASES.COMPLETE]: CheckCircleIcon,
};

const PHASE_ORDER = [
  PHASES.WELCOME,
  PHASES.SETUP,
  PHASES.DISCOVER,
  PHASES.ORGANIZE,
  PHASES.COMPLETE,
];

// =============================================================================
// Sub-Components
// =============================================================================

/**
 * Connection status indicator - subtle dot with tooltip
 */
const ConnectionIndicator = memo(function ConnectionIndicator({ isConnected = true }) {
  return (
    <div
      className="relative flex items-center justify-center"
      title={isConnected ? 'Services connected' : 'Services disconnected'}
      aria-label={isConnected ? 'Connected' : 'Disconnected'}
    >
      <span
        className={`
          h-2 w-2 rounded-full
          ${isConnected ? 'bg-stratosort-success' : 'bg-stratosort-danger'}
        `}
      />
      {isConnected && (
        <span className="absolute inset-0 h-2 w-2 rounded-full bg-stratosort-success animate-ping opacity-75" />
      )}
    </div>
  );
});
ConnectionIndicator.propTypes = { isConnected: PropTypes.bool };

/**
 * Brand logo and name
 */
const Brand = memo(function Brand({ isConnected }) {
  return (
    <div className="flex items-center gap-3 select-none">
      <div className="relative">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-gradient-primary-start to-gradient-primary-end text-white font-semibold text-sm flex items-center justify-center shadow-md">
          S
        </div>
        {/* Connection indicator overlaid on logo */}
        <div className="absolute -bottom-0.5 -right-0.5 p-0.5 bg-white rounded-full shadow-sm">
          <ConnectionIndicator isConnected={isConnected} />
        </div>
      </div>
      <div className="hidden sm:block leading-tight">
        <p className="text-sm font-semibold text-system-gray-900">StratoSort</p>
        <p className="text-xs text-system-gray-500">Cognitive file flow</p>
      </div>
    </div>
  );
});
Brand.propTypes = { isConnected: PropTypes.bool };

/**
 * Navigation tab button
 */
const NavTab = memo(function NavTab({
  phase,
  isActive,
  canNavigate,
  isLoading,
  onClick,
  onHover,
  isHovered,
}) {
  const metadata = PHASE_METADATA[phase];
  const IconComponent = PHASE_ICONS[phase];

  // Get short label for nav
  const label = useMemo(() => {
    const navLabel = metadata?.navLabel;
    if (navLabel) return navLabel;

    const title = metadata?.title || '';
    const words = title
      .replace(/&/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .filter((w) => !/^to|and|of|the|for|a|an$/i.test(w));
    return words.slice(0, 2).join(' ');
  }, [metadata]);

  const showSpinner = isActive && isLoading;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => onHover(phase)}
      onMouseLeave={() => onHover(null)}
      disabled={!canNavigate}
      className={`
        relative flex items-center gap-2 rounded-full
        px-3 py-1.5 text-sm font-medium whitespace-nowrap
        transition-all duration-200 ease-out
        focus:outline-none focus-visible:ring-2 focus-visible:ring-stratosort-blue focus-visible:ring-offset-2
        ${isActive
          ? 'bg-white text-stratosort-blue shadow-sm border border-system-gray-200'
          : canNavigate
            ? 'text-system-gray-600 hover:text-system-gray-900 hover:bg-white/60 border border-transparent'
            : 'text-system-gray-400 cursor-not-allowed border border-transparent'
        }
      `}
      aria-label={metadata?.title}
      aria-current={isActive ? 'page' : undefined}
      aria-busy={showSpinner}
      title={
        !canNavigate && !isActive
          ? 'Navigation disabled during operation'
          : metadata?.description || metadata?.title
      }
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      {showSpinner ? (
        <SpinnerIcon className="h-4 w-4 text-stratosort-blue" />
      ) : (
        IconComponent && (
          <IconComponent
            className={`h-4 w-4 transition-colors duration-200
              ${isActive || isHovered ? 'text-stratosort-blue' : 'text-current opacity-70'}
            `}
          />
        )
      )}
      <span>{label}</span>

      {/* Active indicator */}
      {isActive && !showSpinner && (
        <span className="absolute -bottom-px left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-stratosort-blue" />
      )}
    </button>
  );
});

NavTab.propTypes = {
  phase: PropTypes.string.isRequired,
  isActive: PropTypes.bool.isRequired,
  canNavigate: PropTypes.bool.isRequired,
  isLoading: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
  onHover: PropTypes.func.isRequired,
  isHovered: PropTypes.bool.isRequired,
};

/**
 * Action buttons (settings, update indicator)
 */
const NavActions = memo(function NavActions({ onSettingsClick }) {
  return (
    <div
      className="flex items-center gap-2"
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      <UpdateIndicator />
      <button
        type="button"
        onClick={onSettingsClick}
        className="
          h-9 w-9 rounded-lg flex items-center justify-center
          text-system-gray-500 hover:text-stratosort-blue
          bg-white/80 hover:bg-white border border-system-gray-200 hover:border-stratosort-blue/30
          shadow-sm hover:shadow-md
          transition-all duration-200 ease-out
          focus:outline-none focus-visible:ring-2 focus-visible:ring-stratosort-blue focus-visible:ring-offset-2
        "
        aria-label="Open Settings"
        title="Settings"
      >
        <SettingsIcon className="h-5 w-5" />
      </button>
    </div>
  );
});
NavActions.propTypes = { onSettingsClick: PropTypes.func.isRequired };

// =============================================================================
// Main Component
// =============================================================================

function NavigationBar() {
  const dispatch = useAppDispatch();
  const currentPhase = useAppSelector((state) => state.ui.currentPhase);
  const isOrganizing = useAppSelector((state) => state.ui.isOrganizing);
  const isAnalyzing = useAppSelector((state) => state.ui.isAnalyzing);
  const isLoading = useAppSelector((state) => state.ui.isLoading);

  const [isScrolled, setIsScrolled] = useState(false);
  const [hoveredTab, setHoveredTab] = useState(null);

  // Memoized action creators
  const actions = useMemo(
    () => ({
      advancePhase: (phase) => dispatch(setPhase(phase)),
      toggleSettings: () => dispatch(toggleSettings()),
    }),
    [dispatch],
  );

  // Scroll effect for glass morphism
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Phase navigation handler
  const handlePhaseChange = useCallback(
    (newPhase) => {
      if (!newPhase || typeof newPhase !== 'string') return;

      const allowedTransitions = PHASE_TRANSITIONS[currentPhase] || [];
      if (allowedTransitions.includes(newPhase) || newPhase === currentPhase) {
        actions.advancePhase(newPhase);
      }
    },
    [currentPhase, actions],
  );

  // Settings handler
  const handleSettingsClick = useCallback(() => {
    actions.toggleSettings();
  }, [actions]);

  // Check if navigation should be blocked
  const isBlockedByOperation = isOrganizing || isAnalyzing || isLoading;

  return (
    <header
      className={`
        fixed inset-x-0 top-0 z-[100]
        border-b backdrop-blur-xl backdrop-saturate-150
        transition-all duration-300 ease-out
        ${isScrolled
          ? 'bg-white/95 border-system-gray-200/60 shadow-md'
          : 'bg-white/85 border-white/60 shadow-sm'
        }
      `}
      style={{ WebkitAppRegion: 'drag' }}
    >
      {/* Top highlight line */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gradient-primary-start/20 to-transparent" />

      <div className="relative flex h-14 items-center justify-between px-4 lg:px-6">
        {/* Left: Brand */}
        <div style={{ WebkitAppRegion: 'no-drag' }}>
          <Brand isConnected={true} />
        </div>

        {/* Center: Phase Navigation */}
        <nav
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' }}
          aria-label="Phase navigation"
        >
          {PHASE_ORDER.map((phase) => {
            const allowedTransitions = PHASE_TRANSITIONS[currentPhase] || [];
            const isActive = phase === currentPhase;
            const canNavigate =
              (allowedTransitions.includes(phase) || isActive) &&
              !isBlockedByOperation;

            return (
              <NavTab
                key={phase}
                phase={phase}
                isActive={isActive}
                canNavigate={canNavigate}
                isLoading={isActive && isBlockedByOperation}
                onClick={() => canNavigate && handlePhaseChange(phase)}
                onHover={setHoveredTab}
                isHovered={hoveredTab === phase}
              />
            );
          })}
        </nav>

        {/* Right: Actions */}
        <NavActions onSettingsClick={handleSettingsClick} />
      </div>
    </header>
  );
}

export default memo(NavigationBar);
