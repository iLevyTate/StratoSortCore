import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import { useDispatch } from 'react-redux';
import { createLogger } from '../../shared/logger';
import { ToastContainer, useToast } from '../components/Toast';
import {
  addNotification as addSystemNotification,
  markNotificationDismissed,
  clearNotifications
} from '../store/slices/systemSlice';

const logger = createLogger('NotificationContext');
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
    showInfo,
    drainEvictedIds
  } = useToast();
  // Map toast IDs to notification IDs for consistent Redux dismissal
  const toastToNotificationIdRef = useRef(new Map());

  const addNotification = useCallback(
    (message, severity = 'info', duration = 3000, groupKey = null) => {
      const toastId = addToast(message, severity, duration, groupKey);
      const notificationId = String(toastId);
      dispatch(
        addSystemNotification({
          id: notificationId,
          message,
          severity,
          duration,
          source: 'ui',
          type: 'ui'
        })
      );
      toastToNotificationIdRef.current.set(toastId, notificationId);

      // Clean up mappings for any toasts evicted by the cap
      for (const evictedId of drainEvictedIds()) {
        const evictedNotifId = toastToNotificationIdRef.current.get(evictedId);
        if (evictedNotifId) {
          toastToNotificationIdRef.current.delete(evictedId);
          dispatch(markNotificationDismissed(evictedNotifId));
        }
      }

      return toastId;
    },
    [addToast, drainEvictedIds, dispatch]
  );

  const removeNotification = useCallback(
    (id) => {
      removeToast(id);
      const notificationId = toastToNotificationIdRef.current.get(id);
      if (notificationId) {
        toastToNotificationIdRef.current.delete(id);
        // Sync dismissal to Redux to keep notification state consistent
        // This updates unreadNotificationCount and marks the notification as dismissed
        dispatch(markNotificationDismissed(notificationId));
      }
    },
    [removeToast, dispatch]
  );

  // Wrapper for clearAllToasts that also syncs to Redux
  const handleClearAll = useCallback(() => {
    clearAllToasts();
    toastToNotificationIdRef.current.clear();
    // Clear notifications from Redux as well
    dispatch(clearNotifications());
  }, [clearAllToasts, dispatch]);

  // NOTE: onAppError is handled by ipcMiddleware (dispatches addNotification to Redux
  // and emits 'app:notification' custom event). No duplicate listener needed here.

  // Listen for notifications via custom event (dispatched by ipcMiddleware)
  // This avoids duplicate IPC listeners - the middleware handles IPC and emits this event
  useEffect(() => {
    const handleNotification = (event) => {
      try {
        // Uses unified schema with 'severity' field (not 'variant')
        const { id: notificationId, message, severity, duration = 4000 } = event.detail || {};
        if (!message) return;

        // Map severity to toast function
        switch (severity) {
          case 'success':
            if (typeof showSuccess === 'function') {
              const toastId = showSuccess(message, duration);
              if (notificationId && toastId != null) {
                toastToNotificationIdRef.current.set(toastId, notificationId);
              }
            }
            break;
          case 'error':
            if (typeof showError === 'function') {
              const toastId = showError(message, duration);
              if (notificationId && toastId != null) {
                toastToNotificationIdRef.current.set(toastId, notificationId);
              }
            }
            break;
          case 'warning':
            if (typeof showWarning === 'function') {
              const toastId = showWarning(message, duration);
              if (notificationId && toastId != null) {
                toastToNotificationIdRef.current.set(toastId, notificationId);
              }
            }
            break;
          default:
            if (typeof showInfo === 'function') {
              const toastId = showInfo(message, duration);
              if (notificationId && toastId != null) {
                toastToNotificationIdRef.current.set(toastId, notificationId);
              }
            }
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

  // FIX H15: Memoize the context value WITHOUT toasts in the dependency array.
  // All consumers only use action functions (addNotification, showSuccess, etc.)
  // and never read `notifications` directly. The ToastContainer receives `toasts`
  // as a direct prop below, so toast rendering is unaffected. By excluding `toasts`
  // from the context value and its dependencies, we prevent all 12+ consumers from
  // re-rendering every time a toast is added or removed.
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;

  const contextValue = useMemo(
    () => ({
      // Expose toasts via getter backed by ref so the context value object
      // does not change when toasts change. Components that truly need the
      // live toast list should read from ToastContainer (rendered below) or
      // subscribe to Redux notification state instead.
      get notifications() {
        return toastsRef.current;
      },
      addNotification,
      removeNotification,
      clearAllNotifications: handleClearAll,
      showSuccess,
      showError,
      showWarning,
      showInfo
    }),
    [
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
