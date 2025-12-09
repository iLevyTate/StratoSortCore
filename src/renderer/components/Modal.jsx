import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';

// Inline SVG Icons
const XIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const AlertTriangleIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

const InfoIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const HelpCircleIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const FileTextIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'medium',
  closeOnOverlayClick = true,
  showCloseButton = true,
  className = '',
}) => {
  const modalRef = useRef(null);
  const previousFocusRef = useRef(null);

  // Store the previously focused element when modal opens
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement;
    }
  }, [isOpen]);

  // Handle ESC key press
  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    },
    [isOpen, onClose],
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
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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
      onClose();
      event.preventDefault();
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

  const portalTarget =
    typeof document !== 'undefined' ? document.body : null;

  if (!isOpen || !portalTarget) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center p-[var(--panel-padding)] bg-black/55 backdrop-blur-md animate-modal-backdrop"
      onClick={handleOverlayClick}
    >
      {/* Modal */}
      <div
        ref={modalRef}
        className={`
          relative surface-panel w-full ${getSizeClasses()}
          max-h-[90vh] overflow-hidden animate-modal-enter ${className}
        `}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        tabIndex={-1}
        onKeyDown={handleModalKeyDown}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between border-b border-border-soft/70 p-[var(--panel-padding)] bg-white/90 rounded-t-2xl">
            {title && (
              <h2
                id="modal-title"
                className="text-xl font-semibold text-system-gray-900"
              >
                {title}
              </h2>
            )}
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="p-2 text-system-gray-500 hover:text-system-gray-700 hover:bg-system-gray-100 rounded-lg transition-colors"
                aria-label="Close modal"
              >
                <XIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div className="modern-scrollbar max-h-[calc(90vh-8rem)] overflow-y-auto p-[var(--panel-padding)] bg-white/85 rounded-b-2xl">
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, portalTarget);
};

// Enhanced Confirmation Modal with modern design
export const ConfirmModal = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default', // default, danger, warning, info
  fileName = null, // For file operations
}) => {
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
            <AlertTriangleIcon className="w-6 h-6 text-stratosort-danger" />
          </div>
        );
      case 'warning':
        return (
          <div className="w-12 h-12 bg-stratosort-warning/10 rounded-full flex items-center justify-center">
            <AlertTriangleIcon className="w-6 h-6 text-stratosort-warning" />
          </div>
        );
      case 'info':
        return (
          <div className="w-12 h-12 bg-stratosort-blue/10 rounded-full flex items-center justify-center">
            <InfoIcon className="w-6 h-6 text-stratosort-blue" />
          </div>
        );
      default:
        return (
          <div className="w-12 h-12 bg-system-gray-100 rounded-full flex items-center justify-center">
            <HelpCircleIcon className="w-6 h-6 text-system-gray-600" />
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
          <div className={variant === 'danger' ? 'animate-confirm-bounce' : ''}>
            {getIcon()}
          </div>
          <div className="flex-1 pt-1">
              <h3 className="text-lg font-semibold text-system-gray-900 mb-2 leading-tight">
              {title}
            </h3>
              <div className="text-system-gray-600 leading-relaxed break-words">
              {message}
              {fileName && (
                <div className="mt-[var(--spacing-cozy)] p-[var(--spacing-cozy)] bg-system-gray-50 rounded-lg border border-border-soft">
                  <div className="flex items-center gap-[var(--spacing-compact)] text-sm">
                    <FileTextIcon className="w-4 h-4 text-system-gray-400" />
                    <span className="font-medium text-system-gray-700">
                      {fileName}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-[var(--spacing-cozy)] justify-end pt-[var(--spacing-default)] border-t border-border-soft/70">
          <button onClick={onClose} className={getCancelButtonClass()}>
            {cancelText}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={getConfirmButtonClass()}
            autoFocus
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
};

Modal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string,
  children: PropTypes.node,
  size: PropTypes.oneOf(['small', 'medium', 'large', 'full']),
  closeOnOverlayClick: PropTypes.bool,
  showCloseButton: PropTypes.bool,
  className: PropTypes.string,
};

ConfirmModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
  title: PropTypes.string,
  message: PropTypes.string,
  confirmText: PropTypes.string,
  cancelText: PropTypes.string,
  variant: PropTypes.oneOf(['default', 'danger', 'warning', 'info']),
  fileName: PropTypes.string,
};

export default Modal;
