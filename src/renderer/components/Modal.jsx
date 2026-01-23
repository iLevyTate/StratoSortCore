import React, { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { X, AlertTriangle, Info, HelpCircle, FileText } from 'lucide-react';
import { logger } from '../../shared/logger';
import Button from './ui/Button';
import IconButton from './ui/IconButton';

function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'medium',
  closeOnOverlayClick = true,
  showCloseButton = true,
  footer = null,
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
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 modal-overlay"
      onClick={handleOverlayClick}
    >
      {/* Unified backdrop: solid overlay (blur disabled to avoid native dropdown flicker) */}
      <div
        className="absolute inset-0 bg-black/40 animate-modal-backdrop gpu-accelerate"
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className={`
          relative surface-panel !p-0 w-full ${getSizeClasses()}
          max-h-[86vh] flex flex-col animate-modal-enter gpu-accelerate shadow-2xl ${className}
        `}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        tabIndex={-1}
        onKeyDown={handleModalKeyDown}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex-shrink-0 flex items-center justify-between border-b border-border-soft/70 px-[var(--panel-padding)] py-[calc(var(--panel-padding)*0.75)] bg-white rounded-t-2xl">
            {title && (
              <h2 id="modal-title" className="heading-secondary">
                {title}
              </h2>
            )}
            {showCloseButton && (
              <IconButton
                type="button"
                onClick={onClose}
                variant="ghost"
                size="sm"
                aria-label="Close modal"
                icon={<X className="w-5 h-5" />}
              />
            )}
          </div>
        )}

        {/* Content */}
        <div
          ref={contentRef}
          className={`flex-1 min-h-0 modern-scrollbar overflow-y-auto px-[var(--panel-padding)] py-[var(--panel-padding)] bg-white ${
            footer ? '' : 'rounded-b-2xl'
          }`}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex-shrink-0 border-t border-border-soft/70 px-[var(--panel-padding)] py-[calc(var(--panel-padding)*0.75)] bg-white rounded-b-2xl">
            {footer}
          </div>
        )}
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

  const confirmVariant =
    variant === 'danger'
      ? 'danger'
      : variant === 'warning'
        ? 'warning'
        : variant === 'info'
          ? 'info'
          : 'primary';

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
      <div className="px-[var(--panel-padding)] py-[var(--panel-padding)]">
        {/* Icon and Content */}
        <div className="flex items-start gap-[var(--spacing-default)] mb-[var(--spacing-relaxed)]">
          <div className={variant === 'danger' ? 'animate-confirm-bounce' : ''}>{getIcon()}</div>
          <div className="flex-1 pt-1">
            <h3 className="heading-tertiary mb-2 leading-tight">{title}</h3>
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
          <Button onClick={onClose} variant="secondary" size="sm" disabled={isConfirming}>
            {cancelText}
          </Button>
          <Button
            onClick={handleConfirm}
            variant={confirmVariant}
            size="sm"
            isLoading={isConfirming}
            disabled={isConfirming}
            autoFocus
          >
            {isConfirming ? 'Processing...' : confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

Modal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.node,
  children: PropTypes.node,
  size: PropTypes.oneOf(['small', 'medium', 'large', 'full']),
  closeOnOverlayClick: PropTypes.bool,
  showCloseButton: PropTypes.bool,
  footer: PropTypes.node,
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
