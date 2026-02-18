import React, { useEffect, useRef, memo, useState, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { X, AlertTriangle, Info, HelpCircle, FileText } from 'lucide-react';
import IconButton from './IconButton';
import Button from './Button';
import { Heading, Text } from './Typography';
import { logger } from '../../../shared/logger';
import { lockAppScroll, unlockAppScroll } from '../../utils/scrollLock';

// Animation durations in ms
const ANIMATION = {
  // Keep in sync with motion tokens used by CSS animation classes.
  ENTER: 220,
  EXIT: 140
};

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[95vw]'
};

const VARIANTS = {
  default: {
    header: 'border-b border-system-gray-100',
    title: 'text-system-gray-900',
    icon: null
  },
  destructive: {
    header: 'bg-stratosort-danger/10 border-b border-stratosort-danger/20',
    title: 'text-stratosort-danger',
    icon: null
  }
};

const Modal = memo(function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  variant = 'default',
  closeOnOverlayClick = true,
  closeOnEsc = true,
  initialFocusRef,
  closeDisabled = false
}) {
  const modalRef = useRef(null);
  const previousFocusRef = useRef(null);
  const focusTimerRef = useRef(null);
  const closingTimerRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const instanceId = useId();
  const titleId = `modal-title-${instanceId}`;
  const descriptionId = `modal-description-${instanceId}`;

  // Handle open/close with animation
  // Timer is stored in a ref to avoid being canceled by effect cleanup
  // when setIsClosing(true) triggers a dependency-driven re-run.
  useEffect(() => {
    if (isOpen && !isVisible && !isClosing) {
      if (closingTimerRef.current) {
        clearTimeout(closingTimerRef.current);
        closingTimerRef.current = null;
      }
      setIsVisible(true);
    } else if (isOpen && isClosing) {
      // Re-opened while closing - cancel close animation
      if (closingTimerRef.current) {
        clearTimeout(closingTimerRef.current);
        closingTimerRef.current = null;
      }
      setIsClosing(false);
    } else if (!isOpen && isVisible && !isClosing) {
      // Start closing animation
      setIsClosing(true);
      closingTimerRef.current = setTimeout(() => {
        closingTimerRef.current = null;
        setIsVisible(false);
        setIsClosing(false);
      }, ANIMATION.EXIT);
    }
  }, [isOpen, isVisible, isClosing]);

  // Clean up closing timer on unmount
  useEffect(() => {
    return () => {
      if (closingTimerRef.current) {
        clearTimeout(closingTimerRef.current);
      }
    };
  }, []);

  // Handle ESC key
  useEffect(() => {
    if (!isVisible || !closeOnEsc || closeDisabled) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, closeOnEsc, closeDisabled, onClose]);

  // Keep keyboard focus trapped inside the open modal.
  useEffect(() => {
    if (!isVisible || isClosing) return undefined;

    const handleTabKey = (e) => {
      if (e.key !== 'Tab') return;

      const root = modalRef.current;
      if (!root) return;

      const focusable = Array.from(
        root.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
        )
      );

      if (focusable.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const activeInside = root.contains(active);

      if (e.shiftKey) {
        if (!activeInside || active === first || active === root) {
          e.preventDefault();
          last.focus();
        }
      } else if (!activeInside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleTabKey);
    return () => {
      document.removeEventListener('keydown', handleTabKey);
    };
  }, [isVisible, isClosing]);

  // Focus management
  useEffect(() => {
    if (isVisible && !isClosing) {
      previousFocusRef.current = document.activeElement;
      // Small timeout to ensure render is complete - store ref for cleanup
      focusTimerRef.current = setTimeout(() => {
        if (initialFocusRef?.current) {
          initialFocusRef.current.focus();
        } else if (modalRef.current) {
          const focusable = modalRef.current.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
          );
          if (focusable.length > 0) {
            focusable[0].focus();
          } else {
            modalRef.current.focus();
          }
        }
      }, 50);
    } else if (!isVisible) {
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
      }
    }
    return () => {
      if (focusTimerRef.current) {
        clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
    };
  }, [isVisible, isClosing, initialFocusRef]);

  // Lock scroll on the actual app scroller (main-content) and body as fallback
  useEffect(() => {
    if (!isVisible) return undefined;

    const lockId = `modal-${instanceId}`;
    lockAppScroll(lockId);

    return () => {
      unlockAppScroll(lockId);
    };
  }, [isVisible, instanceId]);

  if (!isVisible) return null;

  const variantStyles = VARIANTS[variant] || VARIANTS.default;
  const sizeClass = SIZES[size] || SIZES.md;
  const panelMaxHeight =
    size === 'full'
      ? 'max-h-[calc(100vh-var(--app-nav-height)-1rem)]'
      : 'max-h-[calc(100vh-var(--app-nav-height)-2rem)]';
  const overlayPaddingTop = 'calc(var(--app-nav-height) + 1rem)';
  const overlayPaddingBottom = '1.5rem';

  const backdropAnimation = isClosing ? 'animate-modal-backdrop-exit' : 'animate-modal-backdrop';
  const panelAnimation = isClosing ? 'animate-modal-exit' : 'animate-modal-enter';

  const content = (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center p-4 sm:p-6"
      style={{ paddingTop: overlayPaddingTop, paddingBottom: overlayPaddingBottom }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm ${closeOnOverlayClick && !isClosing && !closeDisabled ? 'pointer-events-auto' : 'pointer-events-none'} ${backdropAnimation}`}
        onClick={closeOnOverlayClick && !isClosing && !closeDisabled ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Modal Panel */}
      <div
        ref={modalRef}
        className={`
          relative w-full ${sizeClass} ${panelMaxHeight} ${
            size === 'full' ? 'h-[calc(100vh-var(--app-nav-height)-1rem)]' : ''
          } bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden
          ${panelAnimation}
        `}
        tabIndex={-1}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-6 py-4 ${variantStyles.header} shrink-0`}
        >
          <div>
            <Heading as="h3" variant="h4" id={titleId} className={variantStyles.title}>
              {title}
            </Heading>
            {description && (
              <Text id={descriptionId} variant="small" className="mt-1 text-system-gray-500">
                {description}
              </Text>
            )}
          </div>
          <IconButton
            onClick={onClose}
            variant="ghost"
            size="sm"
            aria-label="Close modal"
            className="text-system-gray-400 hover:text-system-gray-600 -mr-2"
            icon={<X className="w-5 h-5" />}
            disabled={closeDisabled || isClosing}
          />
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 min-h-0">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="px-6 py-4 bg-system-gray-50 border-t border-system-gray-100 flex justify-end gap-cozy shrink-0 rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
});

Modal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.node.isRequired,
  description: PropTypes.string,
  children: PropTypes.node.isRequired,
  footer: PropTypes.node,
  size: PropTypes.oneOf(['sm', 'md', 'lg', 'xl', 'full']),
  variant: PropTypes.oneOf(['default', 'destructive']),
  closeOnOverlayClick: PropTypes.bool,
  closeOnEsc: PropTypes.bool,
  initialFocusRef: PropTypes.object,
  closeDisabled: PropTypes.bool
};

export const ConfirmModal = memo(function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default', // default, danger, warning, info
  fileName = null
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setIsConfirming(false);
    }
  }, [isOpen]);

  const handleConfirm = useCallback(async () => {
    if (isConfirming) return;

    setIsConfirming(true);
    try {
      await onConfirm();
      if (isMountedRef.current) {
        onClose();
      }
    } catch (error) {
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
          <div className="w-12 h-12 bg-stratosort-danger/10 rounded-full flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6 text-stratosort-danger" />
          </div>
        );
      case 'warning':
        return (
          <div className="w-12 h-12 bg-stratosort-warning/10 rounded-full flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6 text-stratosort-warning" />
          </div>
        );
      case 'info':
        return (
          <div className="w-12 h-12 bg-stratosort-blue/10 rounded-full flex items-center justify-center shrink-0">
            <Info className="w-6 h-6 text-stratosort-blue" />
          </div>
        );
      default:
        return (
          <div className="w-12 h-12 bg-system-gray-100 rounded-full flex items-center justify-center shrink-0">
            <HelpCircle className="w-6 h-6 text-system-gray-600" />
          </div>
        );
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="sm"
      title={title}
      closeOnOverlayClick={false}
      closeDisabled={isConfirming}
      variant={variant === 'danger' ? 'destructive' : 'default'}
      footer={
        <>
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
        </>
      }
    >
      <div className="flex items-start gap-4">
        <div className={variant === 'danger' ? 'animate-confirm-bounce' : ''}>{getIcon()}</div>
        <div className="flex-1 pt-1">
          <div className="text-system-gray-600 leading-relaxed break-words">
            {message}
            {fileName && (
              <div className="mt-3 p-3 bg-system-gray-50 rounded-lg border border-border-soft">
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="w-4 h-4 text-system-gray-400" />
                  <span className="font-medium text-system-gray-700">{fileName}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
});

ConfirmModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
  title: PropTypes.string,
  message: PropTypes.node,
  confirmText: PropTypes.string,
  cancelText: PropTypes.string,
  variant: PropTypes.oneOf(['default', 'danger', 'warning', 'info']),
  fileName: PropTypes.string
};

export default Modal;
