import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { CheckCircle2, XCircle, AlertTriangle, Info, X, Bell } from 'lucide-react';
import { logger } from '../../shared/logger';
import { TIMEOUTS } from '../../shared/performanceConstants';

logger.setContext('Toast');

// Simple ID counter - crypto API is overkill for toast IDs
let toastIdCounter = 0;
const generateSecureId = () => Date.now() + ++toastIdCounter;

function Toast({
  message,
  severity = 'info',
  duration = 3000,
  onClose,
  show = true,
  mergeCount = 0
}) {
  const [isVisible, setIsVisible] = useState(show);
  const animationTimerRef = useRef(null);
  // FIX: Use ref for onClose to prevent timer reset when parent re-renders with new callback
  const onCloseRef = useRef(onClose);

  // Keep onClose ref in sync
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setIsVisible(show);
  }, [show]);

  useEffect(() => {
    return () => {
      if (animationTimerRef.current) {
        clearTimeout(animationTimerRef.current);
        animationTimerRef.current = null;
      }
    };
  }, []);

  // FIX: Removed onClose from dependency array - use ref instead
  useEffect(() => {
    if (show && duration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        animationTimerRef.current = setTimeout(
          () => onCloseRef.current?.(),
          TIMEOUTS.ANIMATION_MEDIUM
        );
      }, duration);

      return () => {
        clearTimeout(timer);
        if (animationTimerRef.current) {
          clearTimeout(animationTimerRef.current);
          animationTimerRef.current = null;
        }
      };
    }

    return undefined;
  }, [show, duration]); // FIX: Removed onClose - using ref instead

  const handleClose = () => {
    setIsVisible(false);
    // FIX: Use ref for consistency with other timer callbacks
    animationTimerRef.current = setTimeout(() => onCloseRef.current?.(), TIMEOUTS.ANIMATION_MEDIUM);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      handleClose();
    }
  };

  // Compact, modern severity styling
  const getSeverityClasses = () => {
    switch (severity) {
      case 'success':
        return 'toast-success';
      case 'error':
        return 'toast-error';
      case 'warning':
        return 'toast-warning';
      case 'info':
      default:
        return 'toast-info';
    }
  };

  // Smaller icons for compact design
  const getSeverityIcon = () => {
    const iconClass = 'w-4 h-4 flex-shrink-0';
    switch (severity) {
      case 'success':
        return <CheckCircle2 className={iconClass} />;
      case 'error':
        return <XCircle className={iconClass} />;
      case 'warning':
        return <AlertTriangle className={iconClass} />;
      case 'info':
      default:
        return <Info className={iconClass} />;
    }
  };

  // Comprehensive fallback style that matches the CSS exactly
  const fallbackStyle = {
    transform: isVisible ? 'translateX(0)' : 'translateX(100%)',
    transition: 'all var(--duration-slow) ease-in-out'
  };

  if (!show && !isVisible) return null;

  const renderMessageContent = () => {
    if (React.isValidElement(message)) {
      return message;
    }

    if (message && typeof message === 'object') {
      try {
        const readableType = message.message || message.text || message.title;
        if (typeof readableType === 'string') return readableType;
        return JSON.stringify(message);
      } catch {
        return String(message);
      }
    }

    return message;
  };

  return (
    <div
      className={`toast-compact ${getSeverityClasses()} ${isVisible ? 'show' : ''}`}
      style={fallbackStyle}
      role="alert"
      aria-live="polite"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true">{getSeverityIcon()}</span>
        <span className="flex-1 text-[13px] font-medium leading-snug">
          {renderMessageContent()}
          {mergeCount > 1 && (
            <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-current/15 text-[10px] font-semibold">
              {mergeCount}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={handleClose}
          className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-current/70 hover:text-current hover:bg-current/10 focus-visible:outline-none transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

Toast.propTypes = {
  message: PropTypes.oneOfType([PropTypes.string, PropTypes.node, PropTypes.object]),
  severity: PropTypes.oneOf(['info', 'success', 'error', 'warning']),
  duration: PropTypes.number,
  onClose: PropTypes.func,
  show: PropTypes.bool,
  mergeCount: PropTypes.number
};

// Toast Container for managing multiple toasts - compact design
export function ToastContainer({ toasts = [], onRemoveToast }) {
  const [position] = useState(() => {
    try {
      return localStorage.getItem('toastPosition') || 'bottom-right';
    } catch {
      return 'bottom-right';
    }
  });
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('toastCollapsed') === 'true';
    } catch {
      return false;
    }
  });

  const containerStyle = () => {
    const base = { position: 'fixed', zIndex: 1000 };
    const bottomOffset = 'var(--toast-offset, 72px)';
    switch (position) {
      case 'top-right':
        return { ...base, top: '16px', right: '16px' };
      case 'top-left':
        return { ...base, top: '16px', left: '16px' };
      case 'bottom-left':
        return { ...base, bottom: `calc(${bottomOffset})`, left: '16px' };
      default:
        return { ...base, bottom: `calc(${bottomOffset})`, right: '16px' };
    }
  };

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem('toastCollapsed', String(!prev));
      } catch (error) {
        logger.warn('Failed to save toast collapsed state to localStorage', {
          error: error.message
        });
      }
      return !prev;
    });
  };

  const MAX_VISIBLE_TOASTS = 4;
  const visibleToasts = toasts.slice(-MAX_VISIBLE_TOASTS);
  const hiddenCount = Math.max(0, toasts.length - visibleToasts.length);

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="z-toast pointer-events-none"
      style={containerStyle()}
    >
      {/* Compact toggle button */}
      <div className="pointer-events-auto mb-2 flex items-center justify-end">
        <button
          onClick={toggleCollapsed}
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/95 border border-system-gray-200/80 text-system-gray-600 hover:bg-white hover:text-system-gray-800 shadow-sm backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stratosort-blue/60 transition-all"
          aria-label={collapsed ? 'Show notifications' : 'Hide notifications'}
          aria-expanded={!collapsed}
          aria-controls="toast-panel"
        >
          {collapsed ? (
            <Bell className="w-4 h-4" aria-hidden="true" />
          ) : (
            <X className="w-4 h-4" aria-hidden="true" />
          )}
          {toasts.length > 0 && collapsed && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-stratosort-blue text-white text-[9px] font-medium leading-4 text-center">
              {toasts.length}
            </span>
          )}
        </button>
      </div>

      {/* Toast stack */}
      <div id="toast-panel" aria-hidden={collapsed} className="flex flex-col gap-2">
        {!collapsed &&
          visibleToasts.map((toast) => (
            <div key={toast.id} className="pointer-events-auto">
              <Toast
                message={toast.message}
                severity={toast.severity || toast.type}
                duration={toast.duration}
                show={toast.show !== false}
                onClose={() => onRemoveToast?.(toast.id)}
                mergeCount={toast.mergeCount || 0}
              />
            </div>
          ))}
        {!collapsed && hiddenCount > 0 && (
          <div className="pointer-events-none text-[11px] text-system-gray-400 text-right">
            +{hiddenCount} more
          </div>
        )}
      </div>
    </div>
  );
}

ToastContainer.propTypes = {
  toasts: PropTypes.arrayOf(PropTypes.object),
  onRemoveToast: PropTypes.func
};

// Hook for using toasts (with simple grouping and caps)
export const useToast = () => {
  const [toasts, setToasts] = useState([]);

  const MAX_VISIBLE_TOASTS = 3;
  const GROUP_WINDOW_MS = 2000; // merge toasts with same groupKey within 2s

  const getHighestSeverity = (a, b) => {
    const order = { error: 3, warning: 2, success: 1, info: 0 };
    const aScore = order[a] ?? 0;
    const bScore = order[b] ?? 0;
    return aScore >= bScore ? a : b;
  };

  const addToast = (message, severity = 'info', duration = 3000, groupKey = null) => {
    const id = generateSecureId();
    const now = Date.now();
    let resolvedId = id;

    setToasts((prev) => {
      // If grouping, try to merge with an existing toast
      // FIX: Instead of overwriting messages, show count to preserve awareness
      if (groupKey) {
        const idx = prev.findIndex(
          (t) => t.groupKey === groupKey && now - (t.createdAt || now) <= GROUP_WINDOW_MS
        );
        if (idx !== -1) {
          const existing = prev[idx];
          const mergeCount = (existing.mergeCount || 1) + 1;
          const updated = {
            ...existing,
            id: existing.id, // keep id stable for animation
            // FIX: Preserve first message but add count indicator
            message: existing.originalMessage || existing.message,
            originalMessage: existing.originalMessage || existing.message,
            mergeCount,
            severity: getHighestSeverity(existing.severity || 'info', severity || 'info'),
            duration: duration ?? existing.duration,
            createdAt: existing.createdAt || now
          };
          resolvedId = existing.id;
          const copy = prev.slice();
          copy[idx] = updated;
          return copy;
        }
      }

      const next = [
        ...prev,
        {
          id,
          message,
          severity,
          duration,
          show: true,
          groupKey: groupKey || null,
          createdAt: now
        }
      ];
      // Cap visible toasts
      if (next.length > MAX_VISIBLE_TOASTS) {
        next.shift();
      }
      return next;
    });

    return resolvedId;
  };

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const clearAllToasts = () => {
    setToasts([]);
  };

  return {
    toasts,
    addToast,
    removeToast,
    clearAllToasts,
    // Legacy alias used throughout app
    addNotification: addToast,
    // Convenience methods with shorter defaults for less invasiveness
    showSuccess: (message, duration = 2500) => addToast(message, 'success', duration),
    showError: (message, duration = 4000) => addToast(message, 'error', duration), // Errors stay longer
    showWarning: (message, duration = 3500) => addToast(message, 'warning', duration),
    showInfo: (message, duration = 2000) => addToast(message, 'info', duration) // Info disappears quickly
  };
};

export default Toast;
