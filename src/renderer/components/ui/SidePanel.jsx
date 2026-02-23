import React, { useEffect, useId, useRef, memo, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { X } from 'lucide-react';
import IconButton from './IconButton';
import { Heading, Text } from './Typography';

// Animation durations in ms
const ANIMATION = {
  // Keep in sync with motion tokens used by CSS animation classes.
  ENTER: 220,
  EXIT: 140
};

const SidePanel = memo(function SidePanel({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  width = 460,
  position = 'right',
  closeOnEsc = true,
  showOverlay = false,
  closeOnOverlayClick = true,
  closeDisabled = false,
  className = ''
}) {
  const panelRef = useRef(null);
  const closingTimerRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

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

  useEffect(() => {
    if (!isVisible || !closeOnEsc || closeDisabled) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, closeOnEsc, closeDisabled, onClose]);

  if (!isVisible) return null;

  const panelWidth = typeof width === 'number' ? `${width}px` : width;
  const edgeClass = position === 'left' ? 'left-0' : 'right-0';

  // Determine animation class based on position and closing state
  const getAnimationClass = () => {
    if (position === 'left') {
      return isClosing ? 'animate-sidepanel-exit-left' : 'animate-sidepanel-enter-left';
    }
    return isClosing ? 'animate-sidepanel-exit-right' : 'animate-sidepanel-enter-right';
  };

  const overlayAnimation = isClosing ? 'animate-modal-backdrop-exit' : 'animate-modal-backdrop';

  const content = (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 'var(--z-modal)' }}>
      {showOverlay && (
        <div
          className={`absolute inset-0 bg-black/25 backdrop-blur-[1px] ${closeOnOverlayClick && !isClosing && !closeDisabled ? 'pointer-events-auto' : 'pointer-events-none'} ${overlayAnimation}`}
          onClick={closeOnOverlayClick && !isClosing && !closeDisabled ? onClose : undefined}
          aria-hidden="true"
        />
      )}
      <aside
        ref={panelRef}
        className={`fixed ${edgeClass} pointer-events-auto bg-white shadow-2xl border border-border-soft rounded-2xl flex flex-col overflow-hidden ${getAnimationClass()} ${className}`.trim()}
        style={{
          width: panelWidth,
          top: 'calc(var(--app-nav-height) + 0.75rem)',
          bottom: '0.75rem'
        }}
        role="complementary"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-system-gray-100">
          <div className="min-w-0">
            <Heading as="h3" variant="h5" id={titleId} className="text-system-gray-900">
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
            aria-label="Close panel"
            className="text-system-gray-400 hover:text-system-gray-600 -mr-2"
            icon={<X className="w-5 h-5" />}
            disabled={closeDisabled || isClosing}
          />
        </div>
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 min-h-0">{children}</div>
        {footer && (
          <div className="px-6 py-4 bg-system-gray-50 border-t border-system-gray-100 flex justify-end gap-cozy">
            {footer}
          </div>
        )}
      </aside>
    </div>
  );

  return createPortal(content, document.body);
});

SidePanel.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.node.isRequired,
  description: PropTypes.string,
  children: PropTypes.node.isRequired,
  footer: PropTypes.node,
  width: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  position: PropTypes.oneOf(['left', 'right']),
  closeOnEsc: PropTypes.bool,
  showOverlay: PropTypes.bool,
  closeOnOverlayClick: PropTypes.bool,
  closeDisabled: PropTypes.bool,
  className: PropTypes.string
};

export default SidePanel;
