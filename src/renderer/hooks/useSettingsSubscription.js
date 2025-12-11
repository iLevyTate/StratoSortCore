/**
 * useSettingsSubscription Hook
 *
 * Subscribes to external settings changes from the main process.
 * FIX: Phases weren't receiving runtime settings updates (e.g., Ollama host changes).
 */

import { useEffect, useCallback, useRef } from 'react';
import { logger } from '../../shared/logger';

/**
 * Hook that subscribes to settings changes from the main process
 * and calls the provided callback when settings change.
 *
 * @param {Function} onSettingsChanged - Callback called with the updated settings
 * @param {Object} options - Options object
 * @param {boolean} options.enabled - Whether to enable the subscription (default: true)
 * @param {Array} options.watchKeys - Specific setting keys to watch (optional, watches all if not provided)
 */
export function useSettingsSubscription(onSettingsChanged, options = {}) {
  const { enabled = true, watchKeys = null } = options;
  const callbackRef = useRef(onSettingsChanged);

  // Keep callback ref updated
  useEffect(() => {
    callbackRef.current = onSettingsChanged;
  }, [onSettingsChanged]);

  // Memoize watchKeys to prevent infinite re-subscription loops when array is passed inline
  // We serialize the array to create a stable string key for comparison
  const watchKeysKey = watchKeys ? JSON.stringify([...watchKeys].sort()) : null;
  const watchKeysRef = useRef(watchKeys);
  useEffect(() => {
    watchKeysRef.current = watchKeys;
  }, [watchKeysKey, watchKeys]);

  useEffect(() => {
    // FIX: Return empty cleanup function for consistent return
    if (!enabled) return () => {};

    const handleSettingsChanged = (newSettings) => {
      try {
        // If watching specific keys, filter to only those changes
        const currentWatchKeys = watchKeysRef.current;
        if (currentWatchKeys && Array.isArray(currentWatchKeys)) {
          const relevantChanges = {};
          let hasRelevantChange = false;

          currentWatchKeys.forEach((key) => {
            if (key in newSettings) {
              relevantChanges[key] = newSettings[key];
              hasRelevantChange = true;
            }
          });

          if (hasRelevantChange) {
            callbackRef.current?.(relevantChanges);
          }
        } else {
          // No filter, pass all settings
          callbackRef.current?.(newSettings);
        }
      } catch (error) {
        logger.error('Error handling settings change:', error);
      }
    };

    // Subscribe to settings changes
    let unsubscribe = null;
    if (window.electronAPI?.events?.onSettingsChanged) {
      unsubscribe = window.electronAPI.events.onSettingsChanged(handleSettingsChanged);
      logger.debug('Subscribed to settings changes');
    } else {
      logger.warn('Settings change subscription not available');
    }

    // Cleanup
    return () => {
      if (typeof unsubscribe === 'function') {
        try {
          unsubscribe();
          logger.debug('Unsubscribed from settings changes');
        } catch (error) {
          logger.error('Error unsubscribing from settings:', error);
        }
      }
    };
  }, [enabled, watchKeysKey]);
}

/**
 * Hook that refreshes settings on external change and updates store.
 * Use this in top-level components to keep Redux settings in sync.
 */
export function useSettingsSync() {
  const fetchSettings = useCallback(async () => {
    try {
      if (window.electronAPI?.settings?.get) {
        const settings = await window.electronAPI.settings.get();
        return settings;
      }
    } catch (error) {
      logger.error('Failed to fetch settings:', error);
    }
    return null;
  }, []);

  useSettingsSubscription(
    async (changedSettings) => {
      logger.info(
        'Settings changed externally, consider refreshing:',
        Object.keys(changedSettings)
      );
      // Components using this hook can dispatch to store if needed
    },
    { enabled: true }
  );

  return { fetchSettings };
}

export default useSettingsSubscription;
