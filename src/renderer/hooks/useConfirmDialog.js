import React from 'react';
import { logger } from '../../shared/logger';
import { ConfirmModal } from '../components/Modal';

logger.setContext('useConfirmDialog');

export function useConfirmDialog() {
  const [confirmState, setConfirmState] = React.useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    variant: 'default',
    fileName: null,
    onConfirm: null,
  });
  const resolverRef = React.useRef(null);

  const showConfirm = React.useCallback(
    ({
      title = 'Confirm Action',
      message,
      confirmText = 'Confirm',
      cancelText = 'Cancel',
      variant = 'default',
      fileName = null,
    }) => {
      return new Promise((resolve) => {
        resolverRef.current = resolve;
        setConfirmState({
          isOpen: true,
          title,
          message,
          confirmText,
          cancelText,
          variant,
          fileName,
          onConfirm: () => {
            resolve(true);
            resolverRef.current = null;
            setConfirmState((prev) => ({ ...prev, isOpen: false }));
          },
        });
      });
    },
    [],
  );

  const hideConfirm = React.useCallback(() => {
    if (typeof resolverRef.current === 'function') {
      try {
        resolverRef.current(false);
      } catch (error) {
        // Fixed: Log resolver errors instead of silently swallowing
        logger.warn('Error calling resolver', {
          error: error.message,
          stack: error.stack,
        });
      }
      resolverRef.current = null;
    }
    setConfirmState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const ConfirmDialog = React.useCallback(() => {
    if (!confirmState.isOpen) return null;
    return (
      <ConfirmModal
        isOpen={confirmState.isOpen}
        onClose={hideConfirm}
        onConfirm={confirmState.onConfirm}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        cancelText={confirmState.cancelText}
        variant={confirmState.variant}
        fileName={confirmState.fileName}
      />
    );
  }, [confirmState, hideConfirm]);

  return { showConfirm, ConfirmDialog };
}
