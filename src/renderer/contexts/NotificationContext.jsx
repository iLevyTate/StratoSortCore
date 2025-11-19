import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from 'react';
import PropTypes from 'prop-types';
import { logger } from '../shared/logger';
import { ToastContainer, useToast } from '../components/Toast';

logger.setContext('NotificationContext');

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const {
    toasts,
    addToast,
    removeToast,
    clearAllToasts,
    showSuccess,
    showError,
    showWarning,
    showInfo,
  } = useToast();

  const addNotification = useCallback(
    (message, severity = 'info', duration = 3000, groupKey = null) => {
      return addToast(message, severity, duration, groupKey);
    },
    [addToast],
  );

  const removeNotification = useCallback(
    (id) => {
      removeToast(id);
    },
    [removeToast],
  );

  // Bridge main-process errors into our styled UI (toast/modal), avoiding OS dialogs
  useEffect(() => {
    const api = window?.electronAPI?.events;
    if (!api || typeof api.onAppError !== 'function') return;

    const cleanup = api.onAppError((payload) => {
      try {
        const { message, type } = payload || {};
        if (!message) return;
        if (type === 'error') showError(message, 5000);
        else if (type === 'warning') showWarning(message, 4000);
        else showInfo(message, 3000);
      } catch (e) {
        logger.error('Failed to display app:error', {
          error: e.message,
          stack: e.stack,
        });
      }
    });

    return cleanup;
  }, [showError, showWarning, showInfo]);

  // Memoize the context value to prevent unnecessary re-renders
  const contextValue = useMemo(
    () => ({
      notifications: toasts,
      addNotification,
      removeNotification,
      clearAllNotifications: clearAllToasts,
      showSuccess,
      showError,
      showWarning,
      showInfo,
    }),
    [
      toasts,
      addNotification,
      removeNotification,
      clearAllToasts,
      showSuccess,
      showError,
      showWarning,
      showInfo,
    ],
  );

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
      <ToastContainer
        toasts={toasts}
        onRemoveToast={removeToast}
        onClearAll={clearAllToasts}
      />
    </NotificationContext.Provider>
  );
}

NotificationProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export function useNotification() {
  const context = useContext(NotificationContext);
  if (!context)
    throw new Error('useNotification must be used within NotificationProvider');
  return context;
}
