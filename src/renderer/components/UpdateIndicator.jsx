import React, { useEffect, useState, useRef } from 'react';
import { logger } from '../../shared/logger';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from './ui';

logger.setContext('UpdateIndicator');

const UpdateIndicator = React.memo(function UpdateIndicator() {
  const [status, setStatus] = useState('idle');
  const [visible, setVisible] = useState(false);
  const isMountedRef = useRef(true);
  const unsubscribeRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;

    if (!window?.electronAPI?.events?.onAppUpdate) {
      logger.warn('Update API not available');
      return undefined;
    }

    try {
      unsubscribeRef.current = window.electronAPI.events.onAppUpdate((payload) => {
        if (!isMountedRef.current) return;

        try {
          if (!payload || !payload.status) {
            logger.warn('Invalid update payload', { payload });
            return;
          }

          if (payload.status === 'ready' || payload.status === 'downloaded') {
            setStatus('ready');
            setVisible(true);
          } else if (payload.status === 'available') {
            setStatus('downloading');
            setVisible(false);
          } else if (payload.status === 'downloading') {
            setStatus('downloading');
            setVisible(false);
          } else if (payload.status === 'none' || payload.status === 'not-available') {
            setVisible(false);
          } else if (payload.status === 'error') {
            setStatus('error');
            setVisible(true);
          }
        } catch (error) {
          logger.error('Error handling update event', {
            error: error.message,
            stack: error.stack
          });
        }
      });
    } catch (error) {
      logger.error('Failed to set up update listener', {
        error: error.message,
        stack: error.stack
      });
    }

    return () => {
      isMountedRef.current = false;
      if (unsubscribeRef.current && typeof unsubscribeRef.current === 'function') {
        try {
          unsubscribeRef.current();
        } catch (error) {
          logger.error('Error during cleanup', {
            error: error.message,
            stack: error.stack
          });
        }
      }
      unsubscribeRef.current = null;
    };
  }, []);

  if (!visible) return null;

  const isApplying = status === 'applying';
  const isError = status === 'error';
  const label =
    status === 'applying'
      ? 'Updating…'
      : status === 'ready'
        ? 'Update Ready'
        : status === 'error'
          ? 'Retry Update'
          : 'Update';
  const toneClass = isError
    ? 'bg-stratosort-danger/10 text-stratosort-danger border-stratosort-danger/30 hover:bg-stratosort-danger/20'
    : 'bg-stratosort-success/10 text-stratosort-success border-stratosort-success/30 hover:bg-stratosort-success/20';

  return (
    <Button
      onClick={async () => {
        if (isApplying) return;

        try {
          if (!window?.electronAPI?.system?.applyUpdate) {
            logger.error('Apply update API not available');
            setStatus('error');
            return;
          }

          setStatus('applying');

          const updatePromise = window.electronAPI.system.applyUpdate();
          const UPDATE_TIMEOUT_MS = 30000;
          let timeoutId;
          const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('Update timeout')), UPDATE_TIMEOUT_MS);
          });

          let res;
          try {
            res = await Promise.race([updatePromise, timeoutPromise]);
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }

          if (!res?.success) {
            setStatus('error');
            logger.error('Failed to apply update');
          }
        } catch (error) {
          setStatus('error');
          logger.error('Error applying update', {
            error: error.message,
            stack: error.stack
          });
        }
      }}
      variant="subtle"
      size="sm"
      isLoading={isApplying}
      disabled={isApplying}
      leftIcon={
        isApplying ? null : isError ? (
          <AlertCircle className="w-4 h-4" />
        ) : (
          <CheckCircle2 className="w-4 h-4" />
        )
      }
      className={`border shadow-sm hover:shadow ${toneClass}`}
      title={status === 'error' ? 'Update failed' : 'Apply downloaded update'}
      aria-label="Apply update"
    >
      {label}
    </Button>
  );
});

export default UpdateIndicator;
