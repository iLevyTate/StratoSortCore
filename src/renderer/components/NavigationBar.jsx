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
import { PHASES, PHASE_METADATA, PHASE_ORDER } from '../../shared/constants';
import { createLogger } from '../../shared/logger';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { setPhase, toggleSettings, canTransitionTo } from '../store/slices/uiSlice';
import { updateHealth } from '../store/slices/systemSlice';
import { useFloatingSearch } from '../contexts/FloatingSearchContext';
import UpdateIndicator from './UpdateIndicator';
import { Button, IconButton } from './ui';
import { Text } from './ui/Typography';
import { isMac } from '../utils/platform';

const logger = createLogger('NavigationBar');
// =============================================================================
// Icon Components - Using Lucide React for premium icons
// =============================================================================

const HomeIcon = memo(function HomeIcon({ className = '' }) {
  return <Home className={className} aria-hidden="true" />;
});
HomeIcon.propTypes = { className: PropTypes.string };

const SettingsIcon = memo(function SettingsIcon({ className = '' }) {
  return <Settings className={className} aria-hidden="true" />;
});
SettingsIcon.propTypes = { className: PropTypes.string };

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

const SpinnerIcon = memo(function SpinnerIcon({ className = '' }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden="true" />;
});
SpinnerIcon.propTypes = { className: PropTypes.string };

const PHASE_ICONS = PHASES
  ? {
      [PHASES.WELCOME]: HomeIcon,
      [PHASES.SETUP]: SettingsIcon,
      [PHASES.DISCOVER]: SearchIcon,
      [PHASES.ORGANIZE]: FolderIcon,
      [PHASES.COMPLETE]: CheckCircleIcon
    }
  : {
      welcome: HomeIcon,
      setup: SettingsIcon,
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
    ? 'AI Engine Ready'
    : isOffline
      ? 'AI Engine Offline'
      : isConnecting
        ? 'Initializing...'
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
        <div className="absolute -bottom-0.5 -right-0.5 p-0.5 bg-white/90 rounded-full shadow-sm">
          <ConnectionIndicator status={status} />
        </div>
      </div>
      <div className="hidden sm:flex sm:items-center sm:gap-3 leading-tight">
        <div>
          <Text as="span" variant="small" className="block font-semibold text-system-gray-900">
            StratoSort
          </Text>
          <Text as="span" variant="tiny" className="block">
            Cognitive file flow
          </Text>
        </div>
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
  onPhaseChange,
  onHover,
  isHovered
}) {
  const metadata = PHASE_METADATA[phase];
  const IconComponent = PHASE_ICONS[phase];

  // Stable click handler - avoids inline arrow in parent's render loop
  const handleClick = useCallback(() => {
    if (canNavigate) onPhaseChange(phase);
  }, [canNavigate, onPhaseChange, phase]);

  const handleMouseEnter = useCallback(() => onHover(phase), [onHover, phase]);
  const handleMouseLeave = useCallback(() => onHover(null), [onHover]);

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
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      disabled={!canNavigate}
      className={`
        phase-nav-tab
        focus:outline-none focus-visible:ring-2 focus-visible:ring-stratosort-blue focus-visible:ring-offset-2
        ${
          isActive
            ? 'phase-nav-tab-active'
            : canNavigate
              ? 'phase-nav-tab-interactive'
              : 'phase-nav-tab-disabled'
        }
      `}
      aria-label={metadata?.title}
      aria-current={isActive ? 'page' : undefined}
      aria-busy={showSpinner}
      aria-disabled={!canNavigate}
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
            className={`phase-nav-icon flex-shrink-0 ${isActive || isHovered ? 'text-stratosort-blue' : 'text-current opacity-70'}`}
          />
        )
      )}
      {/* FIX: Always show label, with clear size/line-height for visibility */}
      <span className="phase-nav-label">{label}</span>

      {/* Active state is conveyed via phase-nav-tab-active (bg, border, text color) */}
    </button>
  );
});

NavTab.propTypes = {
  phase: PropTypes.string.isRequired,
  isActive: PropTypes.bool.isRequired,
  canNavigate: PropTypes.bool.isRequired,
  isLoading: PropTypes.bool.isRequired,
  onPhaseChange: PropTypes.func.isRequired,
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
      <Button
        onClick={isWidgetOpen ? closeWidget : openWidget}
        variant="secondary"
        size="sm"
        leftIcon={<SearchIcon className="h-4 w-4" />}
        className={
          isWidgetOpen
            ? 'bg-stratosort-blue/10 border-stratosort-blue/30 text-stratosort-blue hover:bg-stratosort-blue/15'
            : ''
        }
        aria-label={isWidgetOpen ? 'Close Search Widget' : 'Open Search Widget (Ctrl+K)'}
        title={isWidgetOpen ? 'Close Search Widget' : 'Search files (Ctrl+K)'}
      >
        <span className="hidden sm:inline">Search</span>
      </Button>
      <IconButton
        icon={<SettingsIcon className="h-4 w-4" />}
        size="sm"
        variant="secondary"
        onClick={onSettingsClick}
        aria-label="Open Settings"
        title="Settings"
      />
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
      className="flex items-center overflow-hidden rounded-full border border-white/50 bg-white/75 shadow-sm backdrop-blur-sm"
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      <IconButton
        icon={<Minus className="h-4 w-4" />}
        size="sm"
        variant="ghost"
        onClick={handleMinimize}
        className="h-9 w-11 rounded-none rounded-l-full text-system-gray-500 hover:text-system-gray-900 hover:bg-white/70 [transition-duration:var(--duration-normal)]"
        aria-label="Minimize window"
        title="Minimize"
      />
      <IconButton
        icon={
          isMaximized ? (
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path d="M3,1v2H1v6h6V7h2V1H3z M2,8V4h4v4H2z M8,6h-1V3H4V2h4V6z" />
            </svg>
          ) : (
            <Square className="h-3.5 w-3.5" />
          )
        }
        size="sm"
        variant="ghost"
        onClick={handleToggleMaximize}
        className="h-9 w-11 rounded-none text-system-gray-500 hover:text-system-gray-900 hover:bg-white/70 [transition-duration:var(--duration-normal)]"
        aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
        title={isMaximized ? 'Restore' : 'Maximize'}
      />
      <IconButton
        icon={<X className="h-4 w-4" />}
        size="sm"
        variant="ghost"
        onClick={handleClose}
        className="h-9 w-11 rounded-none rounded-r-full text-system-gray-500 hover:text-white hover:bg-stratosort-danger [transition-duration:var(--duration-normal)]"
        aria-label="Close window"
        title="Close"
      />
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

    // Llama and VectorDB are in-process, always online after initialization
    const statuses = [health?.llama, health?.vectorDb].map(normalizeStatus);
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
      // LlamaService is in-process - use testConnection to verify model loaded
      if (window.electronAPI?.llama?.testConnection) {
        try {
          const res = await window.electronAPI.llama.testConnection();
          const rawStatus = res?.status;
          const mappedStatus =
            rawStatus === 'healthy' ? 'online' : rawStatus === 'unhealthy' ? 'offline' : 'online';
          dispatch(updateHealth({ llama: mappedStatus }));
        } catch (error) {
          logger.debug('[NavigationBar] Llama health probe failed', {
            error: error?.message || String(error)
          });
          dispatch(updateHealth({ llama: 'offline' }));
        }
      } else {
        dispatch(updateHealth({ llama: 'offline' }));
      }

      // Check VectorDB status
      if (window.electronAPI?.vectorDb?.healthCheck) {
        try {
          const res = await window.electronAPI.vectorDb.healthCheck();
          const status = res?.healthy ? 'online' : 'offline';
          dispatch(updateHealth({ vectorDb: status }));
        } catch (error) {
          logger.debug('[NavigationBar] Vector DB health check failed', {
            error: error?.message || String(error)
          });
          dispatch(updateHealth({ vectorDb: 'offline' }));
        }
      } else {
        dispatch(updateHealth({ vectorDb: 'offline' }));
      }
    };

    probeHealth();
  }, [dispatch]);

  // Scroll effect for glass morphism - throttled to prevent excessive re-renders
  useEffect(() => {
    let scrollRafId = null;
    let isMounted = true;
    const scrollTarget = document.getElementById('main-content') || window;

    const getScrollTop = () => {
      if (scrollTarget === window) {
        return window.scrollY || 0;
      }
      return scrollTarget?.scrollTop || 0;
    };

    const handleScroll = () => {
      if (scrollRafId) {
        return; // Skip if already scheduled
      }
      scrollRafId = requestAnimationFrame(() => {
        scrollRafId = null;
        if (isMounted) {
          setIsScrolled(getScrollTop() > 10);
        }
      });
    };

    handleScroll();
    scrollTarget.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      isMounted = false;
      if (scrollRafId) {
        cancelAnimationFrame(scrollRafId);
      }
      scrollTarget.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Phase navigation handler
  const handlePhaseChange = useCallback(
    (newPhase) => {
      if (!newPhase || typeof newPhase !== 'string') return;

      if (newPhase === currentPhase || canTransitionTo(currentPhase, newPhase)) {
        actions.advancePhase(newPhase);
      }
    },
    [currentPhase, actions]
  );

  // Settings handler
  const handleSettingsClick = useCallback(() => {
    actions.toggleSettings();
  }, [actions]);

  // Keep top-level navigation responsive; analysis state can become stale.
  const isBlockedByOperation = isOrganizing || isLoading;
  // Only show a nav spinner for loading states other than analysis to avoid duplicate indicators
  const navSpinnerActive = isOrganizing || isLoading;

  return (
    <header
      className={`
        fixed inset-x-0 top-0 z-[100]
        border-b border-border-soft/60
        backdrop-blur-xl backdrop-saturate-150
        transition-all duration-300 ease-out
        ${isScrolled ? 'bg-white/95 shadow-md' : 'bg-white/85 shadow-sm'}
      `}
      style={{
        WebkitAppRegion: 'drag',
        zIndex: 'var(--z-header)',
        isolation: 'isolate',
        willChange: 'auto'
      }}
    >
      <div className="relative flex h-[var(--app-nav-height)] items-center px-4 lg:px-6">
        {/* Left: Brand */}
        <div
          className={`flex-shrink-0 z-20 ${isMac ? 'ml-[78px] lg:ml-[84px]' : ''}`}
          style={{ WebkitAppRegion: 'no-drag' }}
        >
          <Brand status={connectionStatus} />
        </div>

        {/* Center: Phase Navigation - layered center; nav gets pointer-events-auto so it receives clicks */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <nav
            className="phase-nav max-w-[64vw] xl:max-w-[44rem] pointer-events-auto"
            style={{ WebkitAppRegion: 'no-drag' }}
            aria-label="Phase navigation"
          >
            {(PHASE_ORDER || ['welcome', 'setup', 'discover', 'organize', 'complete']).map(
              (phase) => {
                const isActive = phase === currentPhase;

                const canNavigate =
                  (isActive || canTransitionTo(currentPhase, phase)) && !isBlockedByOperation;

                return (
                  <NavTab
                    key={phase}
                    phase={phase}
                    isActive={isActive}
                    canNavigate={canNavigate}
                    isLoading={isActive && navSpinnerActive}
                    onPhaseChange={handlePhaseChange}
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
