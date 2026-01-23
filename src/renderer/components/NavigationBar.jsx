import React, { useState, useEffect, useRef, memo, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import {
  Home,
  Settings,
  Search,
  FolderOpen,
  CheckCircle2,
  Loader2,
  Minus,
  Square,
  X
} from 'lucide-react';
import { PHASES, PHASE_TRANSITIONS, PHASE_METADATA, PHASE_ORDER } from '../../shared/constants';
import { logger } from '../../shared/logger';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { setPhase, toggleSettings } from '../store/slices/uiSlice';
import { updateHealth } from '../store/slices/systemSlice';
import { useFloatingSearch } from '../contexts/FloatingSearchContext';
import UpdateIndicator from './UpdateIndicator';
import { isMac } from '../utils/platform';

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

// FIX: Add null check for PHASES to prevent crash during module initialization
const PHASE_ICONS = PHASES
  ? {
      [PHASES.WELCOME]: HomeIcon,
      [PHASES.SETUP]: CogIcon,
      [PHASES.DISCOVER]: SearchIcon,
      [PHASES.ORGANIZE]: FolderIcon,
      [PHASES.COMPLETE]: CheckCircleIcon
    }
  : {
      welcome: HomeIcon,
      setup: CogIcon,
      discover: SearchIcon,
      organize: FolderIcon,
      complete: CheckCircleIcon
    };

// =============================================================================
// Sub-Components
// =============================================================================

/**
 * Connection status indicator - subtle dot with tooltip
 */
const ConnectionIndicator = memo(function ConnectionIndicator({ status = 'unknown' }) {
  const isOnline = status === 'online';
  const isOffline = status === 'offline';
  const isConnecting = status === 'connecting';
  const label = isOnline
    ? 'Connected'
    : isOffline
      ? 'Disconnected'
      : isConnecting
        ? 'Connecting'
        : 'Status unknown';
  return (
    <div className="relative flex items-center justify-center" title={label} aria-label={label}>
      <span
        className={`
          h-2 w-2 rounded-full
          ${
            isOnline
              ? 'bg-stratosort-success'
              : isOffline
                ? 'bg-stratosort-danger'
                : isConnecting
                  ? 'bg-stratosort-warning animate-pulse'
                  : 'bg-system-gray-400'
          }
        `}
      />
      {isOnline && (
        <span className="absolute inset-0 h-2 w-2 rounded-full bg-stratosort-success animate-ping opacity-75" />
      )}
    </div>
  );
});
ConnectionIndicator.propTypes = {
  status: PropTypes.oneOf(['online', 'offline', 'connecting', 'unknown'])
};

/**
 * Brand logo and name
 */
const Brand = memo(function Brand({ status }) {
  return (
    <div className="flex items-center gap-3 select-none">
      <div className="relative">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-gradient-primary-start to-gradient-primary-end text-white font-semibold text-sm flex items-center justify-center shadow-md">
          S
        </div>
        {/* Connection indicator overlaid on logo */}
        <div className="absolute -bottom-0.5 -right-0.5 p-0.5 bg-white rounded-full shadow-sm">
          <ConnectionIndicator status={status} />
        </div>
      </div>
      <div className="hidden sm:block leading-tight">
        <p className="text-sm font-semibold text-system-gray-900">StratoSort</p>
        <p className="text-xs text-system-gray-500">Cognitive file flow</p>
      </div>
    </div>
  );
});
Brand.propTypes = {
  status: PropTypes.oneOf(['online', 'offline', 'connecting', 'unknown'])
};

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
  isHovered
}) {
  const metadata = PHASE_METADATA[phase];
  const IconComponent = PHASE_ICONS[phase];

  // Get short label for nav
  const label = useMemo(() => {
    const navLabel = metadata?.navLabel;
    if (navLabel) return navLabel;

    const title = metadata?.title || metadata?.label || '';
    const words = title
      .replace(/&/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .filter((w) => !/^to|and|of|the|for|a|an$/i.test(w));
    if (words.length > 0) {
      return words.slice(0, 2).join(' ');
    }
    // Fallback to phase name if metadata is missing
    return String(phase)
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }, [metadata, phase]);

  const showSpinner = isActive && isLoading;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => onHover(phase)}
      onMouseLeave={() => onHover(null)}
      disabled={!canNavigate}
      className={`
        phase-nav-tab
        focus:outline-none focus-visible:ring-2 focus-visible:ring-stratosort-blue focus-visible:ring-offset-2
        ${
          isActive
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
        <SpinnerIcon className="phase-nav-icon text-stratosort-blue flex-shrink-0" />
      ) : (
        IconComponent && (
          <IconComponent
            className={`phase-nav-icon flex-shrink-0 transition-colors duration-200
              ${isActive || isHovered ? 'text-stratosort-blue' : 'text-current opacity-70'}
            `}
          />
        )
      )}
      {/* FIX: Always show label, with clear size/line-height for visibility */}
      <span className="phase-nav-label">{label}</span>

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
  isHovered: PropTypes.bool.isRequired
};

/**
 * Action buttons (settings, update indicator, floating search)
 */
const NavActions = memo(function NavActions({ onSettingsClick }) {
  const { isWidgetOpen, openWidget, closeWidget } = useFloatingSearch();

  return (
    <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' }}>
      <UpdateIndicator />
      <button
        type="button"
        onClick={isWidgetOpen ? closeWidget : openWidget}
        className={`
          h-9 px-2 sm:px-3 rounded-lg flex items-center justify-center gap-2
          text-system-gray-500 hover:text-stratosort-blue
          bg-white/80 hover:bg-white border border-system-gray-200 hover:border-stratosort-blue/30
          shadow-sm hover:shadow-md
          transition-all duration-200 ease-out
          focus:outline-none focus-visible:ring-2 focus-visible:ring-stratosort-blue focus-visible:ring-offset-2
          ${isWidgetOpen ? 'bg-stratosort-blue/10 border-stratosort-blue/50 text-stratosort-blue' : ''}
        `}
        aria-label={isWidgetOpen ? 'Close Search Widget' : 'Open Search Widget (Ctrl+K)'}
        title={isWidgetOpen ? 'Close Search Widget' : 'Search files (Ctrl+K)'}
      >
        <SearchIcon className="h-4 w-4" />
        <span className="text-xs font-medium hidden sm:inline">Search</span>
      </button>
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

/**
 * Custom window controls for Windows/Linux (macOS uses native traffic lights)
 */
const WindowControls = memo(function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  const refreshMaximizedState = useCallback(async () => {
    if (!window?.electronAPI?.window?.isMaximized) return;
    try {
      const maximized = await window.electronAPI.window.isMaximized();
      setIsMaximized(Boolean(maximized));
    } catch (error) {
      logger.error('Failed to read window maximize state', error);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    let resizeTimeout = null;

    const updateState = async () => {
      if (!isMounted) return;
      await refreshMaximizedState();
    };

    // Debounced resize handler to prevent excessive IPC calls
    const handleResize = () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeTimeout = setTimeout(() => {
        if (isMounted) {
          updateState();
        }
      }, 150); // 150ms debounce
    };

    // Initial state check
    updateState();
    window.addEventListener('resize', handleResize, { passive: true });

    return () => {
      isMounted = false;
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      window.removeEventListener('resize', handleResize);
    };
  }, [refreshMaximizedState]);

  const handleMinimize = useCallback(async () => {
    try {
      await window.electronAPI?.window?.minimize?.();
    } catch (error) {
      logger.error('Failed to minimize window', error);
    }
  }, []);

  const handleToggleMaximize = useCallback(async () => {
    try {
      const toggled = await window.electronAPI?.window?.toggleMaximize?.();
      if (typeof toggled === 'boolean') {
        setIsMaximized(toggled);
      } else {
        refreshMaximizedState();
      }
    } catch (error) {
      logger.error('Failed to toggle maximize state', error);
    }
  }, [refreshMaximizedState]);

  const handleClose = useCallback(async () => {
    try {
      await window.electronAPI?.window?.close?.();
    } catch (error) {
      logger.error('Failed to close window', error);
    }
  }, []);

  // macOS uses the native traffic lights
  if (isMac) return null;

  return (
    <div
      className="flex items-center overflow-hidden rounded-xl border border-white/50 bg-white/75 shadow-sm backdrop-blur-sm"
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      <button
        type="button"
        onClick={handleMinimize}
        className="h-9 w-11 flex items-center justify-center text-system-gray-500 hover:text-system-gray-900 hover:bg-white/70 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stratosort-blue/70"
        aria-label="Minimize window"
        title="Minimize"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={handleToggleMaximize}
        className="h-9 w-11 flex items-center justify-center text-system-gray-500 hover:text-system-gray-900 hover:bg-white/70 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stratosort-blue/70"
        aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? (
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path d="M3,1v2H1v6h6V7h2V1H3z M2,8V4h4v4H2z M8,6h-1V3H4V2h4V6z" />
          </svg>
        ) : (
          <Square className="h-3.5 w-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={handleClose}
        className="h-9 w-11 flex items-center justify-center text-system-gray-500 hover:text-white hover:bg-stratosort-danger transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stratosort-blue/70"
        aria-label="Close window"
        title="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
});

// =============================================================================
// Main Component
// =============================================================================

function NavigationBar() {
  const dispatch = useAppDispatch();
  const currentPhase = useAppSelector((state) => state.ui.currentPhase);
  const isOrganizing = useAppSelector((state) => state.ui.isOrganizing);
  // FIX: Use analysis slice as single source of truth for isAnalyzing
  const isAnalyzing = useAppSelector((state) => state.analysis.isAnalyzing);
  const isLoading = useAppSelector((state) => state.ui.isLoading);
  const health = useAppSelector((state) => state.system.health);
  const connectionStatus = useMemo(() => {
    const normalizeStatus = (value) => {
      if (!value) return 'unknown';
      const normalized = String(value).toLowerCase();
      if (['online', 'healthy', 'ready', 'ok', 'running', 'available'].includes(normalized)) {
        return 'online';
      }
      if (['offline', 'unhealthy', 'down', 'error', 'stopped'].includes(normalized)) {
        return 'offline';
      }
      if (
        ['connecting', 'initializing', 'starting', 'booting', 'unknown', 'pending'].includes(
          normalized
        )
      ) {
        return 'connecting';
      }
      return 'unknown';
    };

    const statuses = [health?.ollama, health?.chromadb].map(normalizeStatus);
    if (statuses.every((s) => s === 'online')) return 'online';
    if (statuses.some((s) => s === 'offline')) return 'offline';
    if (statuses.some((s) => s === 'connecting' || s === 'unknown')) return 'connecting';
    return 'unknown';
  }, [health]);

  const [isScrolled, setIsScrolled] = useState(false);
  const [hoveredTab, setHoveredTab] = useState(null);

  // Memoized action creators
  const actions = useMemo(
    () => ({
      advancePhase: (phase) => dispatch(setPhase(phase)),
      toggleSettings: () => dispatch(toggleSettings())
    }),
    [dispatch]
  );

  const didProbeHealth = useRef(false);

  useEffect(() => {
    if (didProbeHealth.current) return;
    didProbeHealth.current = true;

    const probeHealth = async () => {
      try {
        const settings = await window.electronAPI?.settings?.get?.();
        const host = settings?.ollamaHost;
        if (window.electronAPI?.ollama?.testConnection) {
          const res = await window.electronAPI.ollama.testConnection(host);
          const rawStatus = res?.ollamaHealth?.status;
          const mappedStatus =
            rawStatus === 'healthy' ? 'online' : rawStatus === 'unhealthy' ? 'offline' : null;
          if (mappedStatus) {
            dispatch(updateHealth({ ollama: mappedStatus }));
          }
        }
      } catch (error) {
        logger.debug('[NavigationBar] Ollama health probe failed', {
          error: error?.message || String(error)
        });
      }
    };

    probeHealth();
  }, [dispatch]);

  // Scroll effect for glass morphism - throttled to prevent excessive re-renders
  useEffect(() => {
    let scrollRafId = null;
    let isMounted = true;

    const handleScroll = () => {
      if (scrollRafId) {
        return; // Skip if already scheduled
      }
      scrollRafId = requestAnimationFrame(() => {
        scrollRafId = null;
        if (isMounted) {
          setIsScrolled(window.scrollY > 10);
        }
      });
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      isMounted = false;
      if (scrollRafId) {
        cancelAnimationFrame(scrollRafId);
      }
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Phase navigation handler
  const handlePhaseChange = useCallback(
    (newPhase) => {
      if (!newPhase || typeof newPhase !== 'string') return;

      const order = PHASE_ORDER || ['welcome', 'setup', 'discover', 'organize', 'complete'];
      const currentIndex = order.indexOf(currentPhase);
      const newPhaseIndex = order.indexOf(newPhase);

      // Allow navigation if:
      // 1. It's the current phase (no-op but allowed)
      // 2. It's a previous phase (backward navigation)
      // 3. It's the immediate next phase (forward progress)
      // 4. Or if it's explicitly in the allowed transitions list (legacy/graph support)

      const allowedTransitions = PHASE_TRANSITIONS[currentPhase];
      const isExplicitlyAllowed = allowedTransitions && allowedTransitions.includes(newPhase);
      const isSequential = newPhaseIndex === currentIndex + 1;
      const isBackward = newPhaseIndex < currentIndex;

      if (newPhase === currentPhase || isBackward || isSequential || isExplicitlyAllowed) {
        actions.advancePhase(newPhase);
      }
    },
    [currentPhase, actions]
  );

  // Settings handler
  const handleSettingsClick = useCallback(() => {
    actions.toggleSettings();
  }, [actions]);

  // Check if navigation should be blocked
  const isBlockedByOperation = isOrganizing || isAnalyzing || isLoading;
  // Only show a nav spinner for loading states other than analysis to avoid duplicate indicators
  const navSpinnerActive = isOrganizing || isLoading;

  return (
    <header
      className={`
        fixed inset-x-0 top-0 z-[100]
        backdrop-blur-xl backdrop-saturate-150
        transition-all duration-300 ease-out
        ${isScrolled ? 'bg-white/95 shadow-md' : 'bg-white/85 shadow-sm'}
      `}
      style={{
        WebkitAppRegion: 'drag',
        isolation: 'isolate',
        borderBottom: '1px solid rgba(226, 232, 240, 0.6)',
        willChange: 'auto'
      }}
    >
      <div className="relative flex h-[var(--app-nav-height)] items-center px-4 lg:px-6">
        {/* Left: Brand */}
        <div className="flex-shrink-0 z-20" style={{ WebkitAppRegion: 'no-drag' }}>
          <Brand status={connectionStatus} />
        </div>

        {/* Center: Phase Navigation - Absolute center relative to viewport width */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <nav
            className="phase-nav max-w-[60vw]"
            style={{ WebkitAppRegion: 'no-drag' }}
            aria-label="Phase navigation"
          >
            {(PHASE_ORDER || ['welcome', 'setup', 'discover', 'organize', 'complete']).map(
              (phase) => {
                const order = PHASE_ORDER || [
                  'welcome',
                  'setup',
                  'discover',
                  'organize',
                  'complete'
                ];
                const currentIndex = order.indexOf(currentPhase);
                const phaseIndex = order.indexOf(phase);
                const isActive = phase === currentPhase;

                // Calculate navigation permissions
                const allowedTransitions = PHASE_TRANSITIONS[currentPhase];
                const isExplicitlyAllowed =
                  allowedTransitions && allowedTransitions.includes(phase);
                const isBackward = phaseIndex < currentIndex;
                const isSequential = phaseIndex === currentIndex + 1;

                const canNavigate =
                  (isActive || isBackward || isSequential || isExplicitlyAllowed) &&
                  !isBlockedByOperation;

                return (
                  <NavTab
                    key={phase}
                    phase={phase}
                    isActive={isActive}
                    canNavigate={canNavigate}
                    isLoading={isActive && navSpinnerActive}
                    onClick={() => canNavigate && handlePhaseChange(phase)}
                    onHover={setHoveredTab}
                    isHovered={hoveredTab === phase}
                  />
                );
              }
            )}
          </nav>
        </div>

        {/* Right: Actions + Window Controls */}
        <div
          className="ml-auto flex items-center gap-2 z-20"
          style={{ WebkitAppRegion: 'no-drag' }}
        >
          <NavActions onSettingsClick={handleSettingsClick} />
          <WindowControls />
        </div>
      </div>
    </header>
  );
}

export default memo(NavigationBar);
