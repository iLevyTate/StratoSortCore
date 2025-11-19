import React, { useEffect, useState, useRef, useCallback } from 'react';
import { logger } from '../../shared/logger';

logger.setContext('SystemMonitoring');

const SystemMonitoring = React.memo(function SystemMonitoring() {
  const [systemMetrics, setSystemMetrics] = useState({
    uptime: 0,
    cpu: 0,
    memory: { used: 0, total: 0 },
    disk: { used: 0, total: 0 },
  });
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
      if (isMountedRef.current) {
        setSystemMetrics(
          metrics || {
            uptime: 0,
            cpu: 0,
            memory: { used: 0, total: 0 },
            disk: { used: 0, total: 0 },
          },
        );
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
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    let timeoutId = null;

    const startMonitoring = async () => {
      try {
        // Check API availability before starting
        if (!window?.electronAPI?.system?.getMetrics) {
          throw new Error('System monitoring API not available');
        }

        setIsMonitoring(true);

        // Initial fetch
        await fetchMetrics();

        // Set up interval for updates - store in ref to ensure cleanup
        intervalRef.current = setInterval(() => {
          fetchMetrics();
        }, 5000);
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

    // Cleanup function
    return () => {
      isMountedRef.current = false;

      // Clear timeout if it exists
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Clear interval if it exists
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      setIsMonitoring(false);
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
