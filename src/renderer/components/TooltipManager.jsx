import { useEffect, useRef } from 'react';

/**
 * Tooltip layout constants
 */
const TOOLTIP_CONFIG = {
  ARROW_SIZE: 8, // Arrow width/height in pixels
  TARGET_MARGIN: 10, // Distance from target element
  VIEWPORT_PADDING: 8, // Minimum distance from viewport edges
  DEBOUNCE_DELAY: 300 // Delay before showing tooltip (ms)
};

/**
 * Convert a single element's `title` → `data-tooltip`.
 * This prevents the browser engine from ever rendering a native tooltip.
 */
function stripNativeTitle(el) {
  if (!(el instanceof HTMLElement)) return;
  const title = el.getAttribute('title');
  if (!title) return;
  // Preserve existing data-tooltip (explicitly set by components)
  if (!el.hasAttribute('data-tooltip')) {
    el.setAttribute('data-tooltip', title);
  }
  el.removeAttribute('title');
}

/**
 * Sweep all elements with a title attribute in a subtree and convert them.
 */
function sweepTitles(root) {
  if (root instanceof HTMLElement && root.hasAttribute('title')) {
    stripNativeTitle(root);
  }
  const els = (root.querySelectorAll ? root : document).querySelectorAll('[title]');
  for (let i = 0; i < els.length; i++) {
    stripNativeTitle(els[i]);
  }
}

/**
 * TooltipManager
 * - Uses a MutationObserver to proactively strip native title attributes
 *   from the DOM, preventing the OS-native tooltip from ever appearing.
 * - Replaces them with themed, GPU-accelerated custom tooltips.
 * - Uses event delegation for performance.
 * - No API change: developers keep using the title attribute; it gets
 *   converted to data-tooltip automatically.
 */
export default function TooltipManager() {
  const tooltipRef = useRef(null);
  const arrowRef = useRef(null);
  const currentTargetRef = useRef(null);
  const rafRef = useRef(0);
  const debounceTimerRef = useRef(null);

  useEffect(() => {
    // --- 0. Patch title writes to prevent native tooltip races ---
    // MutationObserver is async (microtask). To eliminate any race where native
    // tooltips might still appear, redirect title writes synchronously.
    const originalSetAttribute = Element.prototype.setAttribute;
    const originalRemoveAttribute = Element.prototype.removeAttribute;
    const titleDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'title');

    Element.prototype.setAttribute = function patchedSetAttribute(name, value) {
      if (this instanceof HTMLElement && String(name).toLowerCase() === 'title') {
        const text = value == null ? '' : String(value);
        if (text) {
          originalSetAttribute.call(this, 'data-tooltip', text);
        } else {
          originalRemoveAttribute.call(this, 'data-tooltip');
        }
        originalRemoveAttribute.call(this, 'title');
        return;
      }
      return originalSetAttribute.call(this, name, value);
    };

    const canPatchTitleProperty =
      Boolean(titleDescriptor?.configurable) &&
      typeof titleDescriptor?.get === 'function' &&
      typeof titleDescriptor?.set === 'function';

    if (canPatchTitleProperty) {
      Object.defineProperty(HTMLElement.prototype, 'title', {
        configurable: true,
        enumerable: titleDescriptor.enumerable,
        get() {
          return this.getAttribute('data-tooltip') || '';
        },
        set(value) {
          const text = value == null ? '' : String(value);
          if (text) {
            originalSetAttribute.call(this, 'data-tooltip', text);
          } else {
            originalRemoveAttribute.call(this, 'data-tooltip');
          }
          originalRemoveAttribute.call(this, 'title');
        }
      });
    }

    // --- 1. Proactively strip all native title attributes ---
    // Initial sweep for any titles already in the DOM
    sweepTitles(document);

    // Watch for new elements or attribute changes that add title
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              sweepTitles(node);
            }
          }
        } else if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'title' &&
          mutation.target instanceof HTMLElement &&
          mutation.target.hasAttribute('title')
        ) {
          stripNativeTitle(mutation.target);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['title']
    });

    // --- 2. Create custom tooltip element ---
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip-enhanced';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.style.top = '0px';
    tooltip.style.left = '0px';
    tooltip.style.transform = 'translate3d(-10000px, -10000px, 0)';

    const arrow = document.createElement('div');
    arrow.className = 'tooltip-arrow';
    arrow.style.position = 'absolute';
    arrow.style.width = `${TOOLTIP_CONFIG.ARROW_SIZE}px`;
    arrow.style.height = `${TOOLTIP_CONFIG.ARROW_SIZE}px`;
    tooltip.appendChild(arrow);

    document.body.appendChild(tooltip);
    tooltipRef.current = tooltip;
    arrowRef.current = arrow;

    // Hide tooltip when window is hidden/minimized
    const handleVisibilityChange = () => {
      if (document.hidden && currentTargetRef.current) {
        if (tooltipRef.current) {
          tooltipRef.current.classList.remove('show');
          tooltipRef.current.style.opacity = '0';
          tooltipRef.current.style.transform = 'translate3d(-10000px, -10000px, 0)';
        }
        currentTargetRef.current = null;
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // --- 3. Tooltip display helpers ---
    const schedule = (cb) => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(cb);
    };

    const showTooltip = (target) => {
      if (!tooltipRef.current) return;
      const text = target.getAttribute('data-tooltip');
      if (!text) return;

      tooltipRef.current.textContent = text;
      tooltipRef.current.appendChild(arrowRef.current);
      tooltipRef.current.classList.add('show');
      tooltipRef.current.style.opacity = '1';

      positionTooltip(target);
    };

    const hideTooltip = () => {
      if (!tooltipRef.current) return;
      tooltipRef.current.classList.remove('show');
      tooltipRef.current.style.opacity = '0';
      tooltipRef.current.style.transform = 'translate3d(-10000px, -10000px, 0)';
    };

    const positionTooltip = (target) => {
      schedule(() => {
        if (!tooltipRef.current || !arrowRef.current) return;
        const rect = target.getBoundingClientRect();
        const tp = tooltipRef.current;
        const ar = arrowRef.current;

        // Measure tooltip size off-screen first
        tp.style.top = '0px';
        tp.style.left = '0px';
        tp.style.transform = 'translate3d(-10000px, -10000px, 0)';

        const { width: tw, height: th } = tp.getBoundingClientRect();

        const margin = TOOLTIP_CONFIG.TARGET_MARGIN;
        let top = rect.top - th - margin;
        let left = rect.left + rect.width / 2 - tw / 2;
        let placement = 'top';

        // Flip to bottom if not enough space on top
        if (top < TOOLTIP_CONFIG.VIEWPORT_PADDING) {
          top = rect.bottom + margin;
          placement = 'bottom';
        }

        // Constrain horizontally within viewport
        const vw = window.innerWidth;
        if (left < TOOLTIP_CONFIG.VIEWPORT_PADDING) left = TOOLTIP_CONFIG.VIEWPORT_PADDING;
        if (left + tw > vw - TOOLTIP_CONFIG.VIEWPORT_PADDING)
          left = vw - TOOLTIP_CONFIG.VIEWPORT_PADDING - tw;

        tp.style.left = `${Math.round(left)}px`;
        tp.style.top = `${Math.round(top)}px`;
        tp.style.transform = 'translate3d(0, 0, 0)';

        // Arrow positioning
        const arrowSize = TOOLTIP_CONFIG.ARROW_SIZE;
        const arrowOffset = rect.left + rect.width / 2 - left - arrowSize / 2;
        ar.style.left = `${Math.max(arrowSize, Math.min(tw - arrowSize * 2, arrowOffset))}px`;
        ar.style.top = placement === 'top' ? `${th - arrowSize / 2}px` : `-${arrowSize / 2}px`;
      });
    };

    // --- 4. Event delegation ---
    const delegatedMouseOver = (e) => {
      if (!tooltipRef.current) return;
      const target = e.target.closest('[data-tooltip]');
      if (!target || !(target instanceof HTMLElement)) return;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        currentTargetRef.current = target;
        showTooltip(target);
      }, TOOLTIP_CONFIG.DEBOUNCE_DELAY);
    };

    const delegatedMouseOut = (e) => {
      if (!tooltipRef.current) return;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      const target = currentTargetRef.current;
      if (!target) return;
      if (!target.contains(e.relatedTarget)) {
        hideTooltip();
        currentTargetRef.current = null;
      }
    };

    const delegatedFocus = (e) => {
      if (!tooltipRef.current) return;
      const target = e.target.closest('[data-tooltip]');
      if (!target || !(target instanceof HTMLElement)) return;
      currentTargetRef.current = target;
      showTooltip(target);
    };

    const delegatedBlur = () => {
      if (!tooltipRef.current) return;
      if (currentTargetRef.current) {
        hideTooltip();
        currentTargetRef.current = null;
      }
    };

    document.addEventListener('mouseover', delegatedMouseOver, true);
    document.addEventListener('mouseout', delegatedMouseOut, true);
    document.addEventListener('focusin', delegatedFocus);
    document.addEventListener('focusout', delegatedBlur);

    const handleViewportChange = () => {
      if (currentTargetRef.current) positionTooltip(currentTargetRef.current);
    };
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);

    // --- 5. Cleanup ---
    return () => {
      observer.disconnect();

      Element.prototype.setAttribute = originalSetAttribute;
      if (canPatchTitleProperty && titleDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'title', titleDescriptor);
      }

      document.removeEventListener('mouseover', delegatedMouseOver, true);
      document.removeEventListener('mouseout', delegatedMouseOut, true);
      document.removeEventListener('focusin', delegatedFocus);
      document.removeEventListener('focusout', delegatedBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;

      if (currentTargetRef.current) {
        hideTooltip();
      }

      currentTargetRef.current = null;

      if (tooltipRef.current && tooltipRef.current.parentNode) {
        tooltipRef.current.parentNode.removeChild(tooltipRef.current);
      }

      tooltipRef.current = null;
      arrowRef.current = null;
    };
  }, []);

  return null;
}
