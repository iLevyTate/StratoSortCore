/**
 * ChromaDBStatusManager
 *
 * FIX: Subscribes to ChromaDB status changes and updates Redux store.
 * This enables UI components to show/hide features based on ChromaDB availability.
 * Now also provides user-facing notifications when status changes.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useAppDispatch } from '../store/hooks';
import { updateHealth } from '../store/slices/systemSlice';
import { useNotification } from '../contexts/NotificationContext';
import { logger } from '../../shared/logger';

/**
 * Component that manages ChromaDB status subscription.
 * Renders nothing - it's a side-effect only component.
 */
export default function ChromaDBStatusManager() {
  const dispatch = useAppDispatch();
  const { showSuccess, showWarning, showInfo } = useNotification();

  // Track previous status to detect changes and avoid duplicate notifications
  const previousStatusRef = useRef(null);
  const hasShownInitialRef = useRef(false);
  const hasReceivedUpdateRef = useRef(false);

  // Fetch initial status on mount
  const fetchInitialStatus = useCallback(async () => {
    try {
      if (window.electronAPI?.chromadb?.getStatus) {
        if (hasReceivedUpdateRef.current) {
          return;
        }
        const status = await window.electronAPI.chromadb.getStatus();
        if (status) {
          const chromaStatus =
            status.status ||
            (typeof status.isOnline === 'boolean'
              ? status.isOnline
                ? 'online'
                : 'offline'
              : null);
          if (!chromaStatus) return;
          dispatch(updateHealth({ chromadb: chromaStatus }));
          previousStatusRef.current = chromaStatus;
          logger.info('ChromaDB initial status:', chromaStatus);
        }
      }
    } catch (error) {
      logger.warn('Failed to fetch ChromaDB status:', error.message);
      dispatch(updateHealth({ chromadb: 'offline' }));
      previousStatusRef.current = 'offline';
      // FIX: Show notification when initial status fetch fails
      // This helps users understand why Knowledge OS may be unavailable
      showWarning('Could not connect to Knowledge OS service');
    }
  }, [dispatch, showWarning]);

  // Subscribe to status changes
  // FIX Issue 6: Subscribe FIRST, then fetch initial status to prevent race condition
  useEffect(() => {
    let unsubscribe = null;

    // Subscribe to status changes FIRST to catch any updates during initial fetch
    if (window.electronAPI?.chromadb?.onStatusChanged) {
      try {
        unsubscribe = window.electronAPI.chromadb.onStatusChanged((statusData) => {
          try {
            // FIX Issue 6: Mark that we received an update from subscription
            hasReceivedUpdateRef.current = true;

            const status = statusData?.status || statusData;
            let chromaStatus;

            if (typeof status === 'string') {
              chromaStatus = status;
            } else if (status && typeof status === 'object') {
              chromaStatus = status.status || (status.available ? 'online' : 'offline');
            } else {
              return;
            }

            // Update Redux store
            dispatch(updateHealth({ chromadb: chromaStatus }));

            // Show notification only if status actually changed (not on initial load)
            const prevStatus = previousStatusRef.current;
            if (prevStatus !== null && prevStatus !== chromaStatus && hasShownInitialRef.current) {
              if (chromaStatus === 'online') {
                showSuccess('Knowledge OS is now available');
              } else if (chromaStatus === 'offline') {
                showWarning('Knowledge OS is temporarily unavailable');
              } else if (chromaStatus === 'initializing') {
                showInfo('Initializing Knowledge OS...');
              }
            }

            previousStatusRef.current = chromaStatus;
            hasShownInitialRef.current = true;
            logger.debug('ChromaDB status changed:', chromaStatus);
          } catch (error) {
            logger.error('Error processing ChromaDB status change:', error);
          }
        });
        logger.debug('Subscribed to ChromaDB status changes');
      } catch (error) {
        logger.error('Failed to subscribe to ChromaDB status:', error);
      }
    }

    // FIX Issue 6: Fetch initial status AFTER subscribing
    // Only update if subscription hasn't already provided a status
    fetchInitialStatus();

    // Cleanup subscription
    return () => {
      if (typeof unsubscribe === 'function') {
        try {
          unsubscribe();
          logger.debug('Unsubscribed from ChromaDB status changes');
        } catch (error) {
          logger.error('Error unsubscribing from ChromaDB status:', error);
        }
      }
    };
  }, [dispatch, fetchInitialStatus, showSuccess, showWarning, showInfo]);

  // This component doesn't render anything
  return null;
}
