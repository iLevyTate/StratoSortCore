import React, { useEffect, useState, useRef } from 'react';

const UpdateIndicator = React.memo(function UpdateIndicator() {
  const [status, setStatus] = useState('idle');
  const [visible, setVisible] = useState(false);
  const isMountedRef = useRef(true);
  const unsubscribeRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;

    // Check if API is available
    if (!window?.electronAPI?.events?.onAppUpdate) {
      console.warn('[UpdateIndicator] Update API not available');
      return;
    }

    // Listen for update events from main
    try {
      unsubscribeRef.current = window.electronAPI.events.onAppUpdate(
        (payload) => {
          // Check if component is still mounted
          if (!isMountedRef.current) return;

          try {
            if (!payload || !payload.status) {
              console.warn(
                '[UpdateIndicator] Invalid update payload:',
                payload,
              );
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
            console.error(
              '[UpdateIndicator] Error handling update event:',
              error,
            );
          }
        },
      );
    } catch (error) {
      console.error(
        '[UpdateIndicator] Failed to set up update listener:',
        error,
      );
    }

    // Cleanup function
    return () => {
      isMountedRef.current = false;

      // Safely unsubscribe
      if (
        unsubscribeRef.current &&
        typeof unsubscribeRef.current === 'function'
      ) {
        try {
          unsubscribeRef.current();
        } catch (error) {
          console.error('[UpdateIndicator] Error during cleanup:', error);
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
            console.error('[UpdateIndicator] Apply update API not available');
            setStatus('error');
            return;
          }

          setStatus('applying');

          // Add timeout for update operation
          const updatePromise = window.electronAPI.system.applyUpdate();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Update timeout')), 30000),
          );

          const res = await Promise.race([updatePromise, timeoutPromise]);

          if (!res?.success) {
            setStatus('error');
            console.error('[UpdateIndicator] Failed to apply update');
          }
        } catch (error) {
          setStatus('error');
          console.error('[UpdateIndicator] Error applying update:', error);
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
          {status === 'applying'
            ? 'Updating…'
            : status === 'ready'
              ? 'Update Ready'
              : 'Update'}
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
