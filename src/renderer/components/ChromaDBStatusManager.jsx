/**
 * ChromaDBStatusManager
 *
 * FIX: Subscribes to ChromaDB status changes and updates Redux store.
 * This enables UI components to show/hide features based on ChromaDB availability.
 */

import { useEffect, useCallback } from 'react';
import { useAppDispatch } from '../store/hooks';
import { updateHealth } from '../store/slices/systemSlice';
import { logger } from '../../shared/logger';

/**
 * Component that manages ChromaDB status subscription.
 * Renders nothing - it's a side-effect only component.
 */
export default function ChromaDBStatusManager() {
  const dispatch = useAppDispatch();

  // Fetch initial status on mount
  const fetchInitialStatus = useCallback(async () => {
    try {
      if (window.electronAPI?.chromadb?.getStatus) {
        const status = await window.electronAPI.chromadb.getStatus();
        if (status && status.success !== undefined) {
          dispatch(
            updateHealth({
              chromadb: status.status || (status.success ? 'online' : 'offline')
            })
          );
          logger.info('ChromaDB initial status:', status.status || status);
        }
      }
    } catch (error) {
      logger.warn('Failed to fetch ChromaDB status:', error.message);
      dispatch(updateHealth({ chromadb: 'offline' }));
    }
  }, [dispatch]);

  // Subscribe to status changes
  useEffect(() => {
    let unsubscribe = null;

    // Fetch initial status
    fetchInitialStatus();

    // Subscribe to status changes
    if (window.electronAPI?.chromadb?.onStatusChanged) {
      try {
        unsubscribe = window.electronAPI.chromadb.onStatusChanged((statusData) => {
          try {
            const status = statusData?.status || statusData;
            if (typeof status === 'string') {
              dispatch(updateHealth({ chromadb: status }));
              logger.debug('ChromaDB status changed:', status);
            } else if (status && typeof status === 'object') {
              dispatch(
                updateHealth({
                  chromadb: status.status || (status.available ? 'online' : 'offline')
                })
              );
            }
          } catch (error) {
            logger.error('Error processing ChromaDB status change:', error);
          }
        });
        logger.debug('Subscribed to ChromaDB status changes');
      } catch (error) {
        logger.error('Failed to subscribe to ChromaDB status:', error);
      }
    }

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
  }, [dispatch, fetchInitialStatus]);

  // This component doesn't render anything
  return null;
}
