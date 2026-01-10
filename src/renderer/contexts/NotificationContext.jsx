import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import PropTypes from 'prop-types';
import { useDispatch } from 'react-redux';
import { logger } from '../../shared/logger';
import { ToastContainer, useToast } from '../components/Toast';
import { markNotificationDismissed, clearNotifications } from '../store/slices/systemSlice';

logger.setContext('NotificationContext');

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const dispatch = useDispatch();
  const {
    toasts,
    addToast,
    removeToast,
    clearAllToasts,
    showSuccess,
    showError,
    showWarning,
    showInfo
  } = useToast();

  const addNotification = useCallback(
    (message, severity = 'info', duration = 3000, groupKey = null) => {
      return addToast(message, severity, duration, groupKey);
    },
    [addToast]
  );

  const removeNotification = useCallback(
    (id) => {
      removeToast(id);
      // Sync dismissal to Redux to keep notification state consistent
      // This updates unreadNotificationCount and marks the notification as dismissed
      dispatch(markNotificationDismissed(id));
    },
    [removeToast, dispatch]
  );

  // Wrapper for clearAllToasts that also syncs to Redux
  const handleClearAll = useCallback(() => {
    clearAllToasts();
    // Clear notifications from Redux as well
    dispatch(clearNotifications());
  }, [clearAllToasts, dispatch]);

  // Bridge main-process errors into our styled UI (toast/modal), avoiding OS dialogs
  useEffect(() => {
    const api = window?.electronAPI?.events;
    // FIX: Return empty cleanup function for consistent return
    if (!api || typeof api.onAppError !== 'function') return () => {};

    const cleanup = api.onAppError((payload) => {
      try {
        const { message, type } = payload || {};
        if (!message) return;
        // FIX: Add null checks before calling notification functions
        if (type === 'error' && typeof showError === 'function') {
          showError(message, 5000);
        } else if (type === 'warning' && typeof showWarning === 'function') {
          showWarning(message, 4000);
        } else if (typeof showInfo === 'function') {
          showInfo(message, 3000);
        }
      } catch (e) {
        logger.error('Failed to display app:error', {
          error: e.message,
          stack: e.stack
        });
      }
    });

    // FIX: Ensure cleanup is a function before returning
    return typeof cleanup === 'function' ? cleanup : () => {};
  }, [showError, showWarning, showInfo]);

  // Listen for notifications via custom event (dispatched by ipcMiddleware)
  // This avoids duplicate IPC listeners - the middleware handles IPC and emits this event
  useEffect(() => {
    const handleNotification = (event) => {
      try {
        // Uses unified schema with 'severity' field (not 'variant')
        const { message, severity, duration = 4000 } = event.detail || {};
        if (!message) return;

        // Map severity to toast function
        switch (severity) {
          case 'success':
            if (typeof showSuccess === 'function') showSuccess(message, duration);
            break;
          case 'error':
            if (typeof showError === 'function') showError(message, duration);
            break;
          case 'warning':
            if (typeof showWarning === 'function') showWarning(message, duration);
            break;
          default:
            if (typeof showInfo === 'function') showInfo(message, duration);
        }
      } catch (e) {
        logger.error('Failed to display notification', {
          error: e.message,
          stack: e.stack
        });
      }
    };

    window.addEventListener('app:notification', handleNotification);
    return () => window.removeEventListener('app:notification', handleNotification);
  }, [showSuccess, showError, showWarning, showInfo]);

  // Memoize the context value to prevent unnecessary re-renders
  const contextValue = useMemo(
    () => ({
      notifications: toasts,
      addNotification,
      removeNotification,
      clearAllNotifications: handleClearAll,
      showSuccess,
      showError,
      showWarning,
      showInfo
    }),
    [
      toasts,
      addNotification,
      removeNotification,
      handleClearAll,
      showSuccess,
      showError,
      showWarning,
      showInfo
    ]
  );

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
      <ToastContainer
        toasts={toasts}
        onRemoveToast={removeNotification}
        onClearAll={handleClearAll}
      />
    </NotificationContext.Provider>
  );
}

NotificationProvider.propTypes = {
  children: PropTypes.node.isRequired
};

export function useNotification() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotification must be used within NotificationProvider');
  return context;
}
