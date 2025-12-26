import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';
import FloatingSearchWidget from '../components/search/FloatingSearchWidget';
import UnifiedSearchModal from '../components/search/UnifiedSearchModal';

const FloatingSearchContext = createContext(null);

export function FloatingSearchProvider({ children }) {
  const [isWidgetOpen, setIsWidgetOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInitialTab, setModalInitialTab] = useState('search');

  const openWidget = useCallback(() => {
    setIsWidgetOpen(true);
  }, []);

  // Listen for global shortcut / tray trigger to open semantic search
  useEffect(() => {
    const cleanup = window.electronAPI?.system?.onOpenSemanticSearch?.(() => {
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

  const contextValue = {
    isWidgetOpen,
    openWidget,
    closeWidget,
    openSearchModal,
    closeSearchModal
  };

  return (
    <FloatingSearchContext.Provider value={contextValue}>
      {children}
      <FloatingSearchWidget
        isOpen={isWidgetOpen}
        onClose={closeWidget}
        onOpenSearch={() => openSearchModal('search')}
        onOpenGraph={() => openSearchModal('graph')}
      />
      <UnifiedSearchModal
        isOpen={isModalOpen}
        onClose={closeSearchModal}
        defaultTopK={20}
        initialTab={modalInitialTab}
      />
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
