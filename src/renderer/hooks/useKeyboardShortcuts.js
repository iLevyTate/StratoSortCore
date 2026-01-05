import { useEffect, useCallback, useMemo, useRef } from 'react';
import { logger } from '../../shared/logger';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { toggleSettings, setPhase } from '../store/slices/uiSlice';
import { useNotification } from '../contexts/NotificationContext';
import { useUndoRedo } from '../components/UndoRedoSystem';
import { PHASES, PHASE_TRANSITIONS, PHASE_METADATA } from '../../shared/constants';

logger.setContext('useKeyboardShortcuts');

export function useKeyboardShortcuts() {
  const dispatch = useAppDispatch();
  const currentPhase = useAppSelector((state) => state.ui.currentPhase);
  const showSettings = useAppSelector((state) => state.ui.showSettings);
  const { addNotification } = useNotification();
  // FIX: Use the React UndoRedo system instead of direct IPC calls
  // This ensures state callbacks (onUndo/onRedo) are invoked, updating UI properly
  const { undo: undoAction, redo: redoAction, canUndo, canRedo } = useUndoRedo();

  // Use refs to avoid re-attaching event listeners when these values change
  const showSettingsRef = useRef(showSettings);
  const currentPhaseRef = useRef(currentPhase);
  // FIX: Use refs for undo/redo to prevent event listener re-attachment
  const undoActionRef = useRef(undoAction);
  const redoActionRef = useRef(redoAction);
  const canUndoRef = useRef(canUndo);
  const canRedoRef = useRef(canRedo);

  // Keep refs in sync
  useEffect(() => {
    showSettingsRef.current = showSettings;
  }, [showSettings]);
  useEffect(() => {
    currentPhaseRef.current = currentPhase;
  }, [currentPhase]);
  useEffect(() => {
    undoActionRef.current = undoAction;
  }, [undoAction]);
  useEffect(() => {
    redoActionRef.current = redoAction;
  }, [redoAction]);
  useEffect(() => {
    canUndoRef.current = canUndo;
  }, [canUndo]);
  useEffect(() => {
    canRedoRef.current = canRedo;
  }, [canRedo]);

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
    // MEDIUM FIX: Make handler async to properly await undo/redo calls
    const handleKeyDown = async (event) => {
      // Ctrl/Cmd + Z for Undo
      // FIX: Use React UndoRedo system instead of direct IPC to ensure UI state updates
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        try {
          // Use the React UndoRedo system which invokes stateCallbacks (onUndo)
          // This ensures the UI state is properly updated after the operation
          if (canUndoRef.current && undoActionRef.current) {
            await undoActionRef.current();
          } else {
            logger.debug('Undo shortcut: nothing to undo');
          }
        } catch (error) {
          logger.error('Undo shortcut failed', {
            error: error.message,
            stack: error.stack
          });
        }
      }

      // Ctrl/Cmd + Shift + Z for Redo (also support Ctrl+Y on Windows)
      // FIX: Use React UndoRedo system instead of direct IPC to ensure UI state updates
      if (
        (event.ctrlKey || event.metaKey) &&
        ((event.key.toLowerCase() === 'z' && event.shiftKey) || event.key.toLowerCase() === 'y')
      ) {
        event.preventDefault();
        try {
          // Use the React UndoRedo system which invokes stateCallbacks (onRedo)
          // This ensures the UI state is properly updated after the operation
          if (canRedoRef.current && redoActionRef.current) {
            await redoActionRef.current();
          } else {
            logger.debug('Redo shortcut: nothing to redo');
          }
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

  // Handle menu actions from main process (File menu shortcuts)
  useEffect(() => {
    const cleanup = window.electronAPI?.events?.onMenuAction?.((action) => {
      switch (action) {
        case 'open-settings':
          actions.toggleSettings();
          break;
        case 'select-files':
          // Dispatch custom event for DiscoverPhase to handle
          window.dispatchEvent(new CustomEvent('app:select-files'));
          break;
        case 'select-folder':
          // Dispatch custom event for DiscoverPhase to handle
          window.dispatchEvent(new CustomEvent('app:select-folder'));
          break;
        default:
          logger.debug('Unknown menu action:', action);
      }
    });
    return cleanup;
  }, [actions]);

  // Listen for undo/redo state changes from main process and dispatch DOM event
  // NOTE: Since we now use the React UndoRedo system for keyboard shortcuts,
  // the stateCallbacks (onUndo/onRedo) handle UI updates and notifications.
  // This listener is kept for external triggers (e.g., if undo/redo is called
  // from main process menu) but doesn't show notifications to avoid duplicates.
  useEffect(() => {
    const cleanup = window.electronAPI?.undoRedo?.onStateChanged?.((data) => {
      logger.debug('Undo/redo state changed (from main process):', data);
      // Dispatch custom event for any components that need to know about state changes
      window.dispatchEvent(new CustomEvent('app:undo-redo-state-changed', { detail: data }));
      // NOTE: Notifications are handled by the React UndoRedo system's undo/redo methods
      // to avoid duplicate notifications
    });
    return cleanup;
  }, []);
}
