import React, { useEffect, useState, useRef } from 'react';
import { logger } from '../../shared/logger';

// Set logger context for this component
logger.setContext('UpdateIndicator');

const UpdateIndicator = React.memo(function UpdateIndicator() {
  const [status, setStatus] = useState('idle');
  const [visible, setVisible] = useState(false);
  const isMountedRef = useRef(true);
  const unsubscribeRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;

    // Check if API is available
    if (!window?.electronAPI?.events?.onAppUpdate) {
      logger.warn('Update API not available');
      return undefined;
    }

    // Listen for update events from main
    try {
      unsubscribeRef.current = window.electronAPI.events.onAppUpdate((payload) => {
        // Check if component is still mounted
        if (!isMountedRef.current) return;

        try {
          if (!payload || !payload.status) {
            logger.warn('Invalid update payload', { payload });
            return;
          }

          // Update state only if mounted
          if (payload.status === 'ready') {
            setStatus('ready');
            setVisible(true);
          } else if (payload.status === 'available') {
            setStatus('downloading');
            setVisible(false);
          } else if (payload.status === 'none') {
            setVisible(false);
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

    // Cleanup function
    return () => {
      isMountedRef.current = false;

      // Safely unsubscribe
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

  return (
    <button
      onClick={async () => {
        // Prevent multiple clicks
        if (status === 'applying') return;

        try {
          // Check if API is available
          if (!window?.electronAPI?.system?.applyUpdate) {
            logger.error('Apply update API not available');
            setStatus('error');
            return;
          }

          setStatus('applying');

          // Add timeout for update operation
          const updatePromise = window.electronAPI.system.applyUpdate();
          // Use constant for timeout (30 seconds)
          const UPDATE_TIMEOUT_MS = 30000; // Could be moved to shared constants
          // FIX: Store timeout ID so we can clear it to prevent memory leak
          let timeoutId;
          const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('Update timeout')), UPDATE_TIMEOUT_MS);
          });

          let res;
          try {
            res = await Promise.race([updatePromise, timeoutPromise]);
          } finally {
            // FIX: Always clear timeout to prevent memory leak
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
      className="
        relative px-4 py-2 h-10
        text-xs font-medium rounded-xl
        bg-gradient-to-r from-emerald-500/10 to-teal-500/10
        border border-emerald-500/20
        text-emerald-700 
        overflow-hidden group
        transition-all duration-200 ease-out
        hover:bg-gradient-to-r hover:from-emerald-500/15 hover:to-teal-500/15
        hover:border-emerald-500/30
        hover:shadow-sm
        active:scale-95
        flex items-center
      "
      title="Apply downloaded update"
      aria-label="Apply update"
    >
      <span className="relative z-10 flex items-center gap-2">
        {(status === 'applying' || status === 'ready') && (
          <span className="w-2 h-2 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full animate-pulse" />
        )}
        <span className="font-medium">
          {status === 'applying' ? 'Updating…' : status === 'ready' ? 'Update Ready' : 'Update'}
        </span>
      </span>
      {/* Shimmer effect */}
      <span
        className="
        absolute inset-0 -translate-x-full
        bg-gradient-to-r from-transparent via-white/10 to-transparent
        group-hover:translate-x-full
        transition-transform duration-500
      "
      />
    </button>
  );
});

export default UpdateIndicator;
