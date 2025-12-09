import React, { useEffect, useState, useRef, useCallback } from 'react';
import { logger } from '../../shared/logger';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { updateMetrics } from '../store/slices/systemSlice';
// ComponentErrorBoundary removed as it was unused

logger.setContext('SystemMonitoring');

const SystemMonitoring = React.memo(function SystemMonitoring() {
  const dispatch = useAppDispatch();
  const systemMetrics = useAppSelector((state) => state.system.metrics);

  const [isMonitoring, setIsMonitoring] = useState(false);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);
  const isMountedRef = useRef(true);

  const fetchMetrics = useCallback(async () => {
    if (!isMountedRef.current) return;

    try {
      // Add null check for API availability
      if (!window?.electronAPI?.system?.getMetrics) {
        throw new Error('System metrics API not available');
      }

      const metrics = await window.electronAPI.system.getMetrics();

      // Only update state if component is still mounted
      if (isMountedRef.current && metrics) {
        dispatch(updateMetrics(metrics));
        setError(null);
      }
    } catch (error) {
      logger.warn('Failed to fetch system metrics', {
        error: error.message,
      });
      if (isMountedRef.current) {
        setError(error.message);
      }
    }
  }, [dispatch]);

  useEffect(() => {
    isMountedRef.current = true;
    let timeoutId = null;
    let intervalId = null; // MED-12: Track interval ID locally for reliable cleanup

    const startMonitoring = async () => {
      try {
        // Check API availability before starting
        if (!window?.electronAPI?.system?.getMetrics) {
          throw new Error('System monitoring API not available');
        }

        setIsMonitoring(true);

        // Initial fetch
        await fetchMetrics();

        // PERFORMANCE FIX: Increased interval from 5s to 10s to reduce polling overhead
        // Main process also sends metrics via IPC, so less frequent polling is sufficient
        // FIX: Wrap async fetchMetrics in try/catch to prevent unhandled promise rejections
        intervalId = setInterval(async () => {
          try {
            await fetchMetrics();
          } catch (error) {
            logger.warn('System monitoring fetch failed:', {
              error: error.message,
            });
          }
        }, 10000); // Increased from 5000ms to 10000ms (10 seconds)
        intervalRef.current = intervalId; // Also store in ref for external access
      } catch (error) {
        logger.error('Failed to start system monitoring', {
          error: error.message,
          stack: error.stack,
        });
        if (isMountedRef.current) {
          setIsMonitoring(false);
          setError(error.message);
        }
      }
    };

    // Add slight delay to ensure API is ready
    // Use constant for monitoring start delay (100ms)
    const MONITORING_START_DELAY_MS = 100; // Could be moved to shared constants
    timeoutId = setTimeout(startMonitoring, MONITORING_START_DELAY_MS);

    // MED-12: Enhanced cleanup function with multiple safeguards
    return () => {
      // Clear timeout if it exists (before setting isMounted to false to prevent races)
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      // Clear interval using local variable (primary)
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }

      // Also clear via ref (fallback/safety)
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      // FIX: Set mounted ref to false last, so pending callbacks know not to update state
      // Note: We don't call setIsMonitoring(false) here because component is unmounting
      // and React will unmount the state anyway. Calling setState during cleanup can cause warnings.
      isMountedRef.current = false;
    };
  }, [fetchMetrics]);

  if (!isMonitoring || error) {
    return (
      <div className="text-sm text-system-gray-500">
        {error
          ? `System monitoring error: ${error}`
          : 'System monitoring unavailable'}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h4 className="font-medium text-system-gray-700">📊 System Status</h4>
      <div className="grid grid-cols-2 gap-8 text-sm">
        <div>
          <span className="text-system-gray-600">CPU:</span>
          <span className="ml-2 font-medium">
            {systemMetrics.cpu?.toFixed(1) || 0}%
          </span>
        </div>
        <div>
          <span className="text-system-gray-600">Memory:</span>
          <span className="ml-2 font-medium">
            {systemMetrics.memory?.used || 0} /{' '}
            {systemMetrics.memory?.total || 0} MB
          </span>
        </div>
        <div>
          <span className="text-system-gray-600">Uptime:</span>
          <span className="ml-2 font-medium">
            {Math.floor((systemMetrics.uptime || 0) / 60)}m
          </span>
        </div>
        <div>
          <span className="text-system-gray-600">Disk:</span>
          <span className="ml-2 font-medium">
            {((systemMetrics.disk?.used || 0) / (1024 * 1024 * 1024)).toFixed(
              1,
            )}
            GB used
          </span>
        </div>
      </div>
    </div>
  );
});

export default SystemMonitoring;
