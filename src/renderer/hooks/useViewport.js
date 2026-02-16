import { useState, useEffect, useRef } from 'react';
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

  const timeoutRef = useRef(null);

  useEffect(() => {
    const handleResize = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
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
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return viewport;
}
