import { useEffect, useCallback, useMemo, useRef } from 'react';
import { logger } from '../../shared/logger';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { toggleSettings, setPhase } from '../store/slices/uiSlice';
import { useNotification } from '../contexts/NotificationContext';
import { PHASES, PHASE_TRANSITIONS, PHASE_METADATA } from '../../shared/constants';

logger.setContext('useKeyboardShortcuts');

export function useKeyboardShortcuts() {
  const dispatch = useAppDispatch();
  const currentPhase = useAppSelector((state) => state.ui.currentPhase);
  const showSettings = useAppSelector((state) => state.ui.showSettings);
  const { addNotification } = useNotification();

  // Use refs to avoid re-attaching event listeners when these values change
  const showSettingsRef = useRef(showSettings);
  const currentPhaseRef = useRef(currentPhase);

  // Keep refs in sync
  useEffect(() => {
    showSettingsRef.current = showSettings;
  }, [showSettings]);
  useEffect(() => {
    currentPhaseRef.current = currentPhase;
  }, [currentPhase]);

  // CRITICAL FIX: Memoize actions to prevent event listener re-attachment on every render
  const handleToggleSettings = useCallback(() => dispatch(toggleSettings()), [dispatch]);
  const handleAdvancePhase = useCallback((phase) => dispatch(setPhase(phase)), [dispatch]);

  // CRITICAL FIX: Use useMemo for stable actions object reference
  const actions = useMemo(
    () => ({
      toggleSettings: handleToggleSettings,
      advancePhase: handleAdvancePhase
    }),
    [handleToggleSettings, handleAdvancePhase]
  );

  useEffect(() => {
    // MEDIUM FIX: Make handler async to properly await IPC calls
    const handleKeyDown = async (event) => {
      // Ctrl/Cmd + Z for Undo
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        try {
          await window.electronAPI?.undoRedo?.undo?.();
        } catch (error) {
          logger.error('Undo shortcut failed', {
            error: error.message,
            stack: error.stack
          });
        }
      }

      // Ctrl/Cmd + Shift + Z for Redo (also support Ctrl+Y on Windows)
      if (
        (event.ctrlKey || event.metaKey) &&
        ((event.key.toLowerCase() === 'z' && event.shiftKey) || event.key.toLowerCase() === 'y')
      ) {
        event.preventDefault();
        try {
          await window.electronAPI?.undoRedo?.redo?.();
        } catch (error) {
          logger.error('Redo shortcut failed', {
            error: error.message,
            stack: error.stack
          });
        }
      }

      // Ctrl/Cmd + , for Settings
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        actions.toggleSettings();
      }

      // Escape to close settings if open (use ref for current value)
      if (event.key === 'Escape' && showSettingsRef.current) {
        actions.toggleSettings();
      }

      // Alt + Arrow keys for phase navigation (use ref for current phase)
      if (event.altKey) {
        const phase = currentPhaseRef.current;
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          const phases = Object.values(PHASES);
          const currentIndex = phases.indexOf(phase);
          if (currentIndex > 0) {
            const previousPhase = phases[currentIndex - 1];
            const allowedTransitions = PHASE_TRANSITIONS[phase] || [];
            if (allowedTransitions.includes(previousPhase)) {
              actions.advancePhase(previousPhase);
              addNotification(`Navigated to ${PHASE_METADATA[previousPhase].title}`, 'info', 2000);
            }
          }
        }

        if (event.key === 'ArrowRight') {
          event.preventDefault();
          const phases = Object.values(PHASES);
          const currentIndex = phases.indexOf(phase);
          if (currentIndex < phases.length - 1) {
            const nextPhase = phases[currentIndex + 1];
            const allowedTransitions = PHASE_TRANSITIONS[phase] || [];
            if (allowedTransitions.includes(nextPhase)) {
              actions.advancePhase(nextPhase);
              addNotification(`Navigated to ${PHASE_METADATA[nextPhase].title}`, 'info', 2000);
            }
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // Only re-attach when actions or addNotification change (both are memoized/stable)
  }, [actions, addNotification]);
}
