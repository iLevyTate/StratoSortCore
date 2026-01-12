import React, { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { X, AlertTriangle, Info, HelpCircle, FileText } from 'lucide-react';
import { logger } from '../../shared/logger';

function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'medium',
  closeOnOverlayClick = true,
  showCloseButton = true,
  className = ''
}) {
  const modalRef = useRef(null);
  const contentRef = useRef(null);
  const previousFocusRef = useRef(null);

  // Store the previously focused element when modal opens
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement;
      // FIX: Reset scroll position when modal opens
      if (contentRef.current) {
        contentRef.current.scrollTop = 0;
      }
    }
  }, [isOpen]);

  // Handle ESC key press
  const handleKeyDown = useCallback(
    (event) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape' && isOpen) {
        event.preventDefault();
        onClose();
      }
    },
    [isOpen, onClose]
  );

  // Focus management
  useEffect(() => {
    if (isOpen && modalRef.current) {
      // Focus the modal container
      modalRef.current.focus();

      // Add event listener for ESC key
      document.addEventListener('keydown', handleKeyDown);

      // Prevent body scroll
      document.body.style.overflow = 'hidden';

      return () => {
        // Cleanup
        document.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = 'unset';

        // Restore focus to previously focused element (with safety checks)
        if (previousFocusRef.current) {
          try {
            // Check if element is still in DOM and focusable
            if (
              document.body.contains(previousFocusRef.current) &&
              typeof previousFocusRef.current.focus === 'function'
            ) {
              previousFocusRef.current.focus();
            }
          } catch {
            // Element may have been removed from DOM, ignore
          }
        }
      };
    }

    return undefined;
  }, [isOpen, handleKeyDown]);

  // Handle overlay click
  const handleOverlayClick = (event) => {
    if (closeOnOverlayClick && event.target === event.currentTarget) {
      onClose();
    }
  };

  // Focus trap within modal
  const handleTabKey = (event) => {
    if (!modalRef.current) return;

    const focusableElements = modalRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    // FIX #18: Guard against empty focusable elements to prevent crash
    if (focusableElements.length === 0) {
      modalRef.current.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    // FIX #18: Extra null check before calling focus()
    if (!firstElement || !lastElement) return;

    if (event.shiftKey) {
      // Shift + Tab
      if (document.activeElement === firstElement) {
        lastElement.focus();
        event.preventDefault();
      }
    } else {
      // Tab
      if (document.activeElement === lastElement) {
        firstElement.focus();
        event.preventDefault();
      }
    }
  };

  const handleModalKeyDown = (event) => {
    if (event.key === 'Escape') {
      // Prevent the document-level ESC listener from also firing (avoids double-close).
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Tab') {
      handleTabKey(event);
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'small':
        return 'max-w-md';
      case 'large':
        return 'max-w-4xl';
      case 'full':
        return 'max-w-7xl';
      case 'medium':
      default:
        return 'max-w-2xl';
    }
  };

  const portalTarget = typeof document !== 'undefined' ? document.body : null;

  if (!isOpen || !portalTarget) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center p-4"
      onClick={handleOverlayClick}
    >
      {/* Unified backdrop: solid overlay (blur disabled to avoid native dropdown flicker) */}
      <div className="absolute inset-0 bg-black/40 animate-modal-backdrop" aria-hidden="true" />

      {/* Modal */}
      <div
        ref={modalRef}
        className={`
          relative surface-panel !p-0 w-full ${getSizeClasses()}
          max-h-[90vh] overflow-hidden animate-modal-enter will-change-transform ${className}
        `}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        tabIndex={-1}
        onKeyDown={handleModalKeyDown}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between border-b border-border-soft/70 px-5 py-4 bg-white rounded-t-2xl">
            {title && (
              <h2 id="modal-title" className="text-lg font-semibold text-system-gray-900">
                {title}
              </h2>
            )}
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-system-gray-500 hover:text-system-gray-700 hover:bg-system-gray-100 rounded-lg transition-colors"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div
          ref={contentRef}
          className="modern-scrollbar max-h-[calc(90vh-8rem)] overflow-y-auto px-5 py-4 bg-white rounded-b-2xl"
        >
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, portalTarget);
}

// Enhanced Confirmation Modal with modern design
export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default', // default, danger, warning, info
  fileName = null // For file operations
}) {
  // FIX: Add loading state to prevent race condition with async onConfirm handlers
  const [isConfirming, setIsConfirming] = useState(false);
  // FIX: Track mounted state to prevent setState after unmount
  const isMountedRef = useRef(true);

  // FIX: Track mounted state for async operations
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // FIX: Reset loading state when modal closes/opens
  useEffect(() => {
    if (!isOpen) {
      setIsConfirming(false);
    }
  }, [isOpen]);

  // FIX: Handle async onConfirm properly - wait for completion before closing
  const handleConfirm = useCallback(async () => {
    if (isConfirming) return; // Prevent double-clicks

    setIsConfirming(true);
    try {
      // Await onConfirm in case it's async
      await onConfirm();
      if (isMountedRef.current) {
        onClose();
      }
    } catch (error) {
      // If onConfirm throws, still allow closing but log the error
      logger.error('[ConfirmModal] onConfirm failed', { error });
      if (isMountedRef.current) {
        onClose();
      }
    } finally {
      if (isMountedRef.current) {
        setIsConfirming(false);
      }
    }
  }, [isConfirming, onConfirm, onClose]);

  const getConfirmButtonClass = () => {
    const baseClass =
      'px-[var(--panel-padding)] py-[var(--spacing-cozy)] rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 transform hover:scale-105 active:scale-95';

    switch (variant) {
      case 'danger':
        return `${baseClass} bg-stratosort-danger hover:bg-stratosort-danger/90 text-white focus:ring-stratosort-danger/80 hover:shadow-lg shadow-stratosort-danger/25`;
      case 'warning':
        return `${baseClass} bg-stratosort-warning hover:bg-stratosort-warning/90 text-white focus:ring-stratosort-warning/80 hover:shadow-lg shadow-stratosort-warning/25`;
      case 'info':
        return `${baseClass} bg-stratosort-blue hover:bg-stratosort-blue/90 text-white focus:ring-stratosort-blue/80 hover:shadow-lg shadow-stratosort-blue/25`;
      default:
        return `${baseClass} bg-system-gray-600 hover:bg-system-gray-700 text-white focus:ring-system-gray-500/80 hover:shadow-lg shadow-system-gray-500/25`;
    }
  };

  const getCancelButtonClass = () => {
    return 'bg-system-gray-100 hover:bg-system-gray-200 text-system-gray-700 px-[var(--panel-padding)] py-[var(--spacing-cozy)] rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-system-gray-500/80 focus:ring-offset-2 transform hover:scale-105 active:scale-95 hover:shadow-sm';
  };

  const getIcon = () => {
    switch (variant) {
      case 'danger':
        return (
          <div className="w-12 h-12 bg-stratosort-danger/10 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-stratosort-danger" />
          </div>
        );
      case 'warning':
        return (
          <div className="w-12 h-12 bg-stratosort-warning/10 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-stratosort-warning" />
          </div>
        );
      case 'info':
        return (
          <div className="w-12 h-12 bg-stratosort-blue/10 rounded-full flex items-center justify-center">
            <Info className="w-6 h-6 text-stratosort-blue" />
          </div>
        );
      default:
        return (
          <div className="w-12 h-12 bg-system-gray-100 rounded-full flex items-center justify-center">
            <HelpCircle className="w-6 h-6 text-system-gray-600" />
          </div>
        );
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="small"
      closeOnOverlayClick={false}
      showCloseButton={false}
      className="rounded-2xl border border-border-soft shadow-xl bg-white/95"
    >
      <div className="p-[var(--spacing-relaxed)]">
        {/* Icon and Content */}
        <div className="flex items-start gap-[var(--spacing-default)] mb-[var(--panel-padding)]">
          <div className={variant === 'danger' ? 'animate-confirm-bounce' : ''}>{getIcon()}</div>
          <div className="flex-1 pt-1">
            <h3 className="text-lg font-semibold text-system-gray-900 mb-2 leading-tight">
              {title}
            </h3>
            <div className="text-system-gray-600 leading-relaxed break-words">
              {message}
              {fileName && (
                <div className="mt-[var(--spacing-cozy)] p-[var(--spacing-cozy)] bg-system-gray-50 rounded-lg border border-border-soft">
                  <div className="flex items-center gap-[var(--spacing-compact)] text-sm">
                    <FileText className="w-4 h-4 text-system-gray-400" />
                    <span className="font-medium text-system-gray-700">{fileName}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-[var(--spacing-cozy)] justify-end pt-[var(--spacing-default)] border-t border-border-soft/70">
          <button onClick={onClose} className={getCancelButtonClass()} disabled={isConfirming}>
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            className={getConfirmButtonClass()}
            disabled={isConfirming}
            autoFocus
          >
            {isConfirming ? 'Processing...' : confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}

Modal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string,
  children: PropTypes.node,
  size: PropTypes.oneOf(['small', 'medium', 'large', 'full']),
  closeOnOverlayClick: PropTypes.bool,
  showCloseButton: PropTypes.bool,
  className: PropTypes.string
};

ConfirmModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
  title: PropTypes.string,
  // FIX: Changed from string to node to support JSX content (e.g., UndoRedoSystem)
  message: PropTypes.node,
  confirmText: PropTypes.string,
  cancelText: PropTypes.string,
  variant: PropTypes.oneOf(['default', 'danger', 'warning', 'info']),
  fileName: PropTypes.string
};

export default Modal;
