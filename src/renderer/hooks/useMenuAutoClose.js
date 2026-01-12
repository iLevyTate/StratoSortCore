import { useEffect, useRef } from 'react';

/**
 * Hook to automatically close a menu when clicking outside or pressing Escape
 *
 * Uses a ref for the onClose callback to prevent event listener re-subscription
 * when the parent component recreates the callback on each render.
 *
 * @param {Object} menuRef - Ref to the menu container
 * @param {boolean} isOpen - Whether the menu is currently open
 * @param {Function} onClose - Callback to close the menu
 */
export function useMenuAutoClose(menuRef, isOpen, onClose) {
  // Store latest onClose in ref to avoid re-subscribing on callback changes
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onCloseRef.current?.();
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onCloseRef.current?.();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, menuRef]);
}
