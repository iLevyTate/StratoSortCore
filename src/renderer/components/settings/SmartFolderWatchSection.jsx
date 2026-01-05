import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import { Eye, RefreshCw, FolderSearch, AlertCircle } from 'lucide-react';
import { Button } from '../ui';

/**
 * SmartFolderWatchSection - Settings section for smart folder watching feature
 * Enables auto-analysis of files added or modified in smart folders
 *
 * SIMPLIFIED FLOW:
 * 1. Toggle updates local setting state
 * 2. Setting is auto-saved via SettingsPanel's debounced auto-save
 * 3. When settings save, onSettingsChanged triggers in main process
 * 4. Main process handleSettingsChanged starts/stops watcher automatically
 * 5. For immediate feedback, we also call the IPC directly
 */
function SmartFolderWatchSection({ settings, setSettings, addNotification }) {
  const [watcherStatus, setWatcherStatus] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [toggleError, setToggleError] = useState(null);

  // Fetch watcher status
  const fetchStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI.smartFolders.watcherStatus();
      if (result.success) {
        setWatcherStatus(result.status);
      }
    } catch (error) {
      console.error('Failed to fetch watcher status:', error);
    }
  }, []);

  // Fetch status on mount and when setting changes
  useEffect(() => {
    fetchStatus();
    // Poll for status updates every 5 seconds when enabled
    let interval;
    if (settings.smartFolderWatchEnabled) {
      interval = setInterval(fetchStatus, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [fetchStatus, settings.smartFolderWatchEnabled]);

  // Handle toggle change with optimistic UI and rollback on failure
  const handleToggle = async (enabled) => {
    setIsLoading(true);
    setToggleError(null);

    try {
      const previousEnabled = settings.smartFolderWatchEnabled;
      const nextSettings = { ...settings, smartFolderWatchEnabled: enabled };

      // Optimistically update UI state so the checkbox reflects the user's action immediately
      setSettings(nextSettings);

      if (enabled) {
        const result = await window.electronAPI.smartFolders.watcherStart();
        if (result.success) {
          // Persist immediately to avoid debounce overwriting the toggle
          await window.electronAPI.settings.save(nextSettings);
          addNotification?.('Smart folder watching enabled', 'success');
        } else {
          // Show error and revert
          const errorMsg =
            result.status?.lastStartError || result.error || 'Failed to start watcher';
          addNotification?.(errorMsg, 'error', 8000);
          setToggleError(errorMsg);
          // Revert local state so the checkbox reflects the failure
          setSettings((prev) => ({
            ...prev,
            smartFolderWatchEnabled: previousEnabled
          }));
          await fetchStatus();
          return;
        }
      } else {
        await window.electronAPI.smartFolders.watcherStop();
        // Persist immediately to avoid debounce overwriting the toggle
        await window.electronAPI.settings.save(nextSettings);
        addNotification?.('Smart folder watching disabled', 'info');
      }

      // 4. Refresh status
      await fetchStatus();
    } catch (error) {
      console.error('Failed to toggle watcher:', error);
      const errorMsg = 'Failed to toggle watcher';
      setToggleError(errorMsg);
      addNotification?.(errorMsg, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle manual scan for unanalyzed files
  const handleScan = async () => {
    setIsScanning(true);
    try {
      const result = await window.electronAPI.smartFolders.watcherScan();
      if (result.success) {
        addNotification?.(
          `Scanned ${result.scanned} files, queued ${result.queued} for analysis`,
          result.queued > 0 ? 'success' : 'info'
        );
      } else {
        addNotification?.(result.error || 'Scan failed', 'error');
      }
      await fetchStatus();
    } catch (error) {
      console.error('Failed to scan:', error);
      addNotification?.('Failed to scan folders', 'error');
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Smart folder watch toggle */}
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={settings.smartFolderWatchEnabled || false}
          onChange={(e) => handleToggle(e.target.checked)}
          disabled={isLoading}
          className="form-checkbox accent-stratosort-blue"
        />
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-stratosort-blue" />
          <span className="text-sm text-system-gray-700">
            Watch smart folders for new/modified files
          </span>
        </div>
      </label>

      {/* Description */}
      <p className="text-xs text-system-gray-500 ml-6">
        Automatically analyze files when they are added to or modified in your smart folders. Files
        are analyzed after they finish saving (no active editing).
      </p>

      {toggleError && (
        <p className="text-xs text-amber-600 ml-6 flex items-center gap-1" role="status">
          <AlertCircle className="w-3 h-3" />
          {toggleError}
        </p>
      )}

      {/* Status and controls when enabled */}
      {settings.smartFolderWatchEnabled && (
        <div className="ml-6 space-y-3 p-3 bg-system-gray-50 rounded-lg">
          {/* Status indicator */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  isLoading
                    ? 'bg-yellow-500 animate-pulse'
                    : watcherStatus?.isRunning
                      ? 'bg-green-500 animate-pulse'
                      : watcherStatus?.isStarting
                        ? 'bg-yellow-500 animate-pulse'
                        : 'bg-gray-400'
                }`}
              />
              <span className="text-sm text-system-gray-700">
                {isLoading
                  ? 'Starting...'
                  : watcherStatus?.isRunning
                    ? 'Watching'
                    : watcherStatus?.isStarting
                      ? 'Starting...'
                      : 'Not running'}
              </span>
            </div>
            {watcherStatus?.watchedCount > 0 && (
              <span className="text-xs text-system-gray-500">
                {watcherStatus.watchedCount} folder{watcherStatus.watchedCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Stats */}
          {watcherStatus?.stats && (
            <div className="flex gap-4 text-xs text-system-gray-500">
              <span>Analyzed: {watcherStatus.stats.filesAnalyzed}</span>
              <span>Re-analyzed: {watcherStatus.stats.filesReanalyzed}</span>
              {watcherStatus.stats.errors > 0 && (
                <span className="text-amber-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Errors: {watcherStatus.stats.errors}
                </span>
              )}
            </div>
          )}

          {/* Queue status */}
          {watcherStatus?.queueLength > 0 && (
            <div className="flex items-center gap-2 text-xs text-stratosort-blue">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>Processing {watcherStatus.queueLength} files...</span>
            </div>
          )}

          {/* Manual scan button */}
          <div className="pt-2 border-t border-system-gray-200">
            <Button
              onClick={handleScan}
              variant="secondary"
              size="sm"
              disabled={isScanning || !watcherStatus?.isRunning}
              leftIcon={
                isScanning ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <FolderSearch className="w-4 h-4" />
                )
              }
            >
              {isScanning ? 'Scanning...' : 'Scan for Unanalyzed Files'}
            </Button>
            <p className="text-xs text-system-gray-500 mt-1">
              Manually scan all smart folders for files that haven't been analyzed yet.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

SmartFolderWatchSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired,
  addNotification: PropTypes.func
};

export default SmartFolderWatchSection;
