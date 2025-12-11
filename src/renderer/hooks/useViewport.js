import { useState, useEffect } from 'react';
import { VIEWPORT } from '../../shared/performanceConstants';

/**
 * Custom hook to detect and track viewport dimensions
 * Provides responsive breakpoint detection for desktop optimization
 */
export function useViewport() {
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
    isDesktop: window.innerWidth >= VIEWPORT.DESKTOP,
    isWideDesktop: window.innerWidth >= VIEWPORT.WIDE_DESKTOP,
    isUltraWide: window.innerWidth >= VIEWPORT.ULTRA_WIDE,
    is4K: window.innerWidth >= VIEWPORT.FOUR_K
  });

  useEffect(() => {
    let timeoutId = null;

    const handleResize = () => {
      // Debounce resize events for better performance
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        setViewport({
          width: window.innerWidth,
          height: window.innerHeight,
          isDesktop: window.innerWidth >= VIEWPORT.DESKTOP,
          isWideDesktop: window.innerWidth >= VIEWPORT.WIDE_DESKTOP,
          isUltraWide: window.innerWidth >= VIEWPORT.ULTRA_WIDE,
          is4K: window.innerWidth >= VIEWPORT.FOUR_K
        });
      }, 150);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return viewport;
}
