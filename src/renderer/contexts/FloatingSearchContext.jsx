import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo
} from 'react';
import PropTypes from 'prop-types';
import FloatingSearchWidget from '../components/search/FloatingSearchWidget';
import UnifiedSearchModal from '../components/search/UnifiedSearchModal';
import SearchErrorBoundary from '../components/search/SearchErrorBoundary';
import { TIMEOUTS } from '../../shared/performanceConstants';
import { logger } from '../../shared/logger';

const FloatingSearchContext = createContext(null);

// Session storage key to track if widget was auto-shown this session
const WIDGET_AUTO_SHOWN_KEY = 'floatingSearchWidgetAutoShown';
// Local storage key to persist modal open state
const MODAL_OPEN_STATE_KEY = 'unifiedSearchModalOpen';

export function FloatingSearchProvider({ children }) {
  const [isWidgetOpen, setIsWidgetOpen] = useState(false);
  // Initialize from localStorage to restore state after restart
  const [isModalOpen, setIsModalOpen] = useState(() => {
    try {
      return localStorage.getItem(MODAL_OPEN_STATE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [modalInitialTab, setModalInitialTab] = useState('search');
  const autoShowChecked = useRef(false);

  // Persist modal state changes
  useEffect(() => {
    try {
      localStorage.setItem(MODAL_OPEN_STATE_KEY, String(isModalOpen));
    } catch {
      // Ignore storage errors
    }
  }, [isModalOpen]);

  const openWidget = useCallback(() => {
    setIsWidgetOpen(true);
  }, []);

  // Auto-show widget once per session when files are indexed
  useEffect(() => {
    if (autoShowChecked.current) {
      return undefined;
    }
    autoShowChecked.current = true;

    // Check if already shown this session
    // FIX: Use localStorage instead of sessionStorage to prevent widget from popping up
    // every time the app restarts (better user experience)
    let alreadyShown = false;
    try {
      alreadyShown = Boolean(localStorage.getItem(WIDGET_AUTO_SHOWN_KEY));
    } catch {
      // localStorage not available, proceed with check
    }

    if (alreadyShown) {
      return undefined;
    }

    // Track mounted state to prevent setState after unmount
    let isMounted = true;

    // Check if there are indexed files
    const checkAndShow = async () => {
      try {
        const stats = await window.electronAPI?.embeddings?.getStats?.();
        // Only update state if component is still mounted
        if (isMounted && stats?.success && stats.files > 0) {
          // Files are indexed, show the widget to help users discover semantic search
          setIsWidgetOpen(true);
          try {
            localStorage.setItem(WIDGET_AUTO_SHOWN_KEY, 'true');
          } catch {
            // localStorage write failed, widget will show again next session
          }
        }
      } catch {
        // Stats check failed, don't show widget
      }
    };

    // FIX: Use centralized timeout constant
    const timer = setTimeout(checkAndShow, TIMEOUTS.WIDGET_AUTO_SHOW);
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, []);

  // Listen for global shortcut / tray trigger to open semantic search
  useEffect(() => {
    const api = window.electronAPI?.system?.onOpenSemanticSearch;
    if (!api) return undefined;

    const cleanup = api(() => {
      setModalInitialTab('search');
      setIsModalOpen(true);
      setIsWidgetOpen(false);
    });

    return () => {
      if (typeof cleanup === 'function') {
        cleanup();
      }
    };
  }, []);

  // Keyboard shortcut: Ctrl+K / Cmd+K to open search modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setModalInitialTab('search');
        setIsModalOpen(true);
        setIsWidgetOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const closeWidget = useCallback(() => {
    setIsWidgetOpen(false);
  }, []);

  const openSearchModal = useCallback((tab = 'search') => {
    setModalInitialTab(tab);
    setIsModalOpen(true);
    // Optionally close widget when opening modal
    setIsWidgetOpen(false);
  }, []);

  const closeSearchModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  // FIX M-2: Memoize context value to prevent unnecessary re-renders in consumers
  const contextValue = useMemo(
    () => ({
      isWidgetOpen,
      openWidget,
      closeWidget,
      openSearchModal,
      closeSearchModal
    }),
    [isWidgetOpen, openWidget, closeWidget, openSearchModal, closeSearchModal]
  );

  // FIX: Handle errors from the search modal to prevent crashes
  const handleSearchError = useCallback((error, errorInfo) => {
    logger.error('[FloatingSearchProvider] Search modal error caught by boundary', {
      error: error?.message,
      componentStack: errorInfo?.componentStack
    });
  }, []);

  return (
    <FloatingSearchContext.Provider value={contextValue}>
      {children}
      <FloatingSearchWidget
        isOpen={isWidgetOpen}
        onClose={closeWidget}
        onOpenSearch={() => openSearchModal('search')}
      />
      {/* FIX: Wrap search modal in error boundary to prevent crash on unhandled errors */}
      <SearchErrorBoundary onClose={closeSearchModal} onError={handleSearchError}>
        <UnifiedSearchModal
          isOpen={isModalOpen}
          onClose={closeSearchModal}
          defaultTopK={20}
          initialTab={modalInitialTab}
        />
      </SearchErrorBoundary>
    </FloatingSearchContext.Provider>
  );
}

FloatingSearchProvider.propTypes = {
  children: PropTypes.node.isRequired
};

export function useFloatingSearch() {
  const context = useContext(FloatingSearchContext);
  if (!context) {
    throw new Error('useFloatingSearch must be used within FloatingSearchProvider');
  }
  return context;
}
