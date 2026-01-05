import React, { useEffect, useId, useState, useCallback, useMemo, memo } from 'react';
import PropTypes from 'prop-types';
import { ChevronRight } from 'lucide-react';
import { logger } from '../../../shared/logger';

logger.setContext('Collapsible');

const Collapsible = memo(function Collapsible({
  title,
  children,
  actions = null,
  defaultOpen = true,
  className = '',
  contentClassName = '',
  persistKey,
  collapsedPreview = null
}) {
  const contentId = useId();
  const storageKey = persistKey ? `collapsible:${persistKey}` : null;
  const initialOpen = useMemo(() => {
    if (storageKey && typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved === 'true' || saved === 'false') return saved === 'true';
      } catch (error) {
        logger.error('Failed to load collapsible state', {
          error: error.message
        });
      }
    }
    return Boolean(defaultOpen);
  }, [storageKey, defaultOpen]);

  const [isOpen, setIsOpen] = useState(initialOpen);

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      if (storageKey && typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(storageKey, String(next));
        } catch (error) {
          logger.error('Failed to persist collapsible state', {
            error: error.message
          });
        }
      }
      return next;
    });
  }, [storageKey]);

  // React to external expand/collapse broadcasts via storage events
  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return undefined;
    const onStorage = (e) => {
      // If key provided and doesn't match ours, ignore. If generic event, still check our key.
      if (e && e.key && e.key !== storageKey) return;
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved === 'true' || saved === 'false') {
          setIsOpen(saved === 'true');
        }
      } catch (error) {
        logger.error('Failed to sync collapsible state', {
          error: error.message
        });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);

  // Prefer explicit styling from callers; fall back to a lightweight card surface.
  // Settings renders many sections; avoid nested heavy blur/padding for better proportions.
  const baseSectionClass = className && className.trim().length > 0 ? className.trim() : 'list-row';
  const sectionClasses = `${baseSectionClass} space-y-3`.trim();
  // Header padding: slightly tighter than a full panel
  const headerPadding = 'px-[var(--panel-padding)] pt-[calc(var(--panel-padding)*0.65)]';
  // Content padding: use contentClassName if provided, otherwise add default padding
  // Check for any padding class (p-, px-, py-, pt-, pb-, pl-, pr-)
  const hasPadding =
    contentClassName && /(p[xytblr]?-(\d+|\[.+\])|p-(\d+|\[.+\]))/.test(contentClassName);
  const defaultContentPadding = hasPadding
    ? ''
    : 'px-[var(--panel-padding)] pb-[calc(var(--panel-padding)*0.75)]';

  return (
    <section className={`${sectionClasses} flex flex-col flex-shrink-0`}>
      <div className={`flex items-center justify-between gap-4 ${headerPadding} flex-shrink-0`}>
        <h3 className="heading-tertiary m-0 leading-tight">{title}</h3>
        <div className="flex items-center gap-3 text-xs text-system-gray-500">
          <button
            type="button"
            className="p-1.5 rounded-md border border-border-soft bg-white/80 hover:bg-system-gray-100 hover:border-system-gray-300 text-system-gray-600 hover:text-system-gray-800 transition-all flex items-center justify-center"
            style={{ transitionDuration: 'var(--duration-fast)' }}
            onClick={toggle}
            aria-expanded={isOpen}
            aria-controls={contentId}
            aria-label={isOpen ? 'Collapse section' : 'Expand section'}
            title={isOpen ? 'Collapse section' : 'Expand section'}
          >
            <ChevronRight
              className="w-4 h-4 transition-transform"
              style={{
                transitionDuration: 'var(--duration-normal)',
                transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)'
              }}
            />
          </button>
          {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
        </div>
      </div>

      {isOpen ? (
        <div
          id={contentId}
          role="region"
          className={`mt-3 ${contentClassName || defaultContentPadding}`.trim()}
        >
          {children}
        </div>
      ) : (
        <div
          id={contentId}
          role="region"
          aria-hidden="true"
          className="mt-3 px-[var(--panel-padding)] pb-[calc(var(--panel-padding)*0.5)] text-sm text-system-gray-500"
        >
          {collapsedPreview || (
            <div className="flex items-center gap-2 py-2 border-t border-border-soft/50">
              <ChevronRight className="w-3 h-3 text-system-gray-500" />
              <span className="italic">Click Expand to view content</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
});

Collapsible.propTypes = {
  title: PropTypes.node.isRequired,
  children: PropTypes.node.isRequired,
  actions: PropTypes.node,
  defaultOpen: PropTypes.bool,
  className: PropTypes.string,
  contentClassName: PropTypes.string,
  persistKey: PropTypes.string,
  collapsedPreview: PropTypes.node
};

export default Collapsible;
