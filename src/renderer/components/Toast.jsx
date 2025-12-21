import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { CheckCircle2, XCircle, AlertTriangle, Info, X, Bell } from 'lucide-react';
import { logger } from '../../shared/logger';
import { TIMEOUTS } from '../../shared/performanceConstants';

logger.setContext('Toast');

// Simple ID counter - crypto API is overkill for toast IDs
let toastIdCounter = 0;
const generateSecureId = () => Date.now() + ++toastIdCounter;

const Toast = ({
  message,
  severity = 'info',
  duration = 3000, // Reduced from 5000ms to 3000ms for less invasiveness
  onClose,
  show = true,
  mergeCount = 0 // FIX: Show count when messages are grouped
}) => {
  const [isVisible, setIsVisible] = useState(show);
  // CRITICAL FIX: Use ref to track animation timer so cleanup can always access current value
  const animationTimerRef = useRef(null);

  // Sync show prop changes to isVisible state
  useEffect(() => {
    setIsVisible(show);
  }, [show]);

  // FIX: Explicit cleanup on unmount for animation timer from manual close
  useEffect(() => {
    return () => {
      if (animationTimerRef.current) {
        clearTimeout(animationTimerRef.current);
        animationTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (show && duration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        // Schedule onClose after animation completes
        animationTimerRef.current = setTimeout(() => onClose?.(), TIMEOUTS.ANIMATION_MEDIUM);
      }, duration);

      return () => {
        clearTimeout(timer);
        // Clean up nested animation timeout using ref (always has current value)
        if (animationTimerRef.current) {
          clearTimeout(animationTimerRef.current);
          animationTimerRef.current = null;
        }
      };
    }

    return undefined;
  }, [show, duration, onClose]);

  const handleClose = () => {
    setIsVisible(false);
    // FIX: Store timeout in ref for proper cleanup on unmount
    animationTimerRef.current = setTimeout(() => onClose?.(), TIMEOUTS.ANIMATION_MEDIUM);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      handleClose();
    }
  };

  const getSeverityClasses = () => {
    switch (severity) {
      case 'success':
        return 'border-stratosort-success/50 bg-stratosort-success/10 text-stratosort-success';
      case 'error':
        return 'border-stratosort-danger/50 bg-stratosort-danger/10 text-stratosort-danger';
      case 'warning':
        return 'border-stratosort-warning/50 bg-stratosort-warning/10 text-stratosort-warning';
      case 'info':
      default:
        return 'border-stratosort-blue/45 bg-stratosort-blue/10 text-stratosort-blue';
    }
  };

  const getSeverityIcon = () => {
    const iconClass = 'w-5 h-5';
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
      className={`toast-enhanced ${getSeverityClasses()} ${isVisible ? 'show' : ''}`}
      style={fallbackStyle}
      role="alert"
      aria-live="polite"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="flex-shrink-0" aria-hidden="true">
            {getSeverityIcon()}
          </span>
          <div className="flex-1">
            <div className="text-xs md:text-sm font-normal leading-tight opacity-90">
              {renderMessageContent()}
              {/* FIX: Show count indicator when messages are grouped */}
              {mergeCount > 1 && (
                <span className="ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-current/20 text-[10px] font-medium">
                  ×{mergeCount}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="ml-5 inline-flex h-9 w-9 md:h-10 md:w-10 items-center justify-center rounded-md text-current opacity-80 hover:opacity-100 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stratosort-blue/80 transition-colors"
          aria-label="Close notification"
          title="Close"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

Toast.propTypes = {
  message: PropTypes.oneOfType([PropTypes.string, PropTypes.node, PropTypes.object]),
  severity: PropTypes.oneOf(['info', 'success', 'error', 'warning']),
  duration: PropTypes.number,
  onClose: PropTypes.func,
  show: PropTypes.bool,
  mergeCount: PropTypes.number
};

// Toast Container for managing multiple toasts
export const ToastContainer = ({ toasts = [], onRemoveToast }) => {
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
    // Account for footer height plus safe spacing (customizable via CSS var)
    const bottomOffset = 'var(--toast-offset, 80px)';
    switch (position) {
      case 'top-right':
        return { ...base, top: '21px', right: '21px' };
      case 'top-left':
        return { ...base, top: '21px', left: '21px' };
      case 'bottom-left':
        return { ...base, bottom: `calc(${bottomOffset})`, left: '21px' };
      default:
        return { ...base, bottom: `calc(${bottomOffset})`, right: '21px' };
    }
  };

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem('toastCollapsed', String(!prev));
      } catch (error) {
        // Fixed: Log localStorage errors instead of silently swallowing
        logger.warn('Failed to save toast collapsed state to localStorage', {
          error: error.message
        });
      }
      return !prev;
    });
  };

  const MAX_VISIBLE_TOASTS = 3;
  const visibleToasts = toasts.slice(-MAX_VISIBLE_TOASTS);
  const hiddenCount = Math.max(0, toasts.length - visibleToasts.length);

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="z-toast pointer-events-none"
      style={containerStyle()}
    >
      {/* Toggle Icon */}
      <div className="pointer-events-auto mb-4 flex items-center justify-end">
        <button
          onClick={toggleCollapsed}
          className="relative inline-flex h-10 w-10 md:h-11 md:w-11 items-center justify-center rounded-full bg-white/90 border border-system-gray-200 text-system-gray-700 hover:bg-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stratosort-blue/80"
          aria-label={collapsed ? 'Open notifications' : 'Close notifications'}
          aria-expanded={!collapsed}
          aria-controls="toast-panel"
          title={collapsed ? 'Open notifications' : 'Close notifications'}
        >
          {collapsed ? (
            <Bell className="w-5 h-5" aria-hidden="true" />
          ) : (
            <X className="w-5 h-5" aria-hidden="true" />
          )}
          {toasts.length > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-5 px-1 rounded-full bg-stratosort-blue text-white text-[10px] leading-5 text-center">
              {toasts.length}
            </span>
          )}
        </button>
      </div>

      {/* Toasts */}
      <div id="toast-panel" aria-hidden={collapsed}>
        {!collapsed &&
          visibleToasts.map((toast) => (
            <div key={toast.id} className="pointer-events-auto mb-5">
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
          <div className="pointer-events-none text-xs text-system-gray-500 text-right pr-1">
            +{hiddenCount} more notifications
          </div>
        )}
      </div>
    </div>
  );
};

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

    return id;
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
