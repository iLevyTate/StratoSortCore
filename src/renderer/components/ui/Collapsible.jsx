import React, {
  useEffect,
  useId,
  useState,
  useCallback,
  useMemo,
  memo,
} from 'react';
import PropTypes from 'prop-types';
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
          error: error.message,
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
            error: error.message,
          });
        }
      }
      return next;
    });
  }, [storageKey]);

  // React to external expand/collapse broadcasts via storage events
  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return;
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
          error: error.message,
        });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);

  const sectionClasses = `glass-panel space-y-5 ${className}`.trim();
  // Add padding to header to prevent content clipping from rounded corners
  const headerPadding = 'px-6 pt-6';
  // Content padding: use contentClassName if provided, otherwise add default padding
  // Check for any padding class (p-, px-, py-, pt-, pb-, pl-, pr-)
  const hasPadding =
    contentClassName && /p[xytblr]?-\d+|p-\d+/.test(contentClassName);
  const defaultContentPadding = hasPadding ? '' : 'px-6 pb-6';

  return (
    <section className={`${sectionClasses} flex flex-col min-h-0`}>
      <div
        className={`flex items-center justify-between gap-4 ${headerPadding} flex-shrink-0`}
      >
        <h3 className="heading-tertiary m-0">{title}</h3>
        <div className="flex items-center gap-3 text-xs text-system-gray-500">
          {persistKey && (
            <button
              type="button"
              className="underline hover:text-system-gray-800"
              onClick={toggle}
              aria-label={isOpen ? 'Collapse section' : 'Expand section'}
            >
              {isOpen ? 'Collapse' : 'Expand'}
            </button>
          )}
          {actions ? (
            <div className="flex items-center gap-3">{actions}</div>
          ) : null}
        </div>
      </div>

      <div
        id={contentId}
        className={`transition-all duration-300 ease-smooth ${
          isOpen ? 'mt-4' : 'max-h-0 overflow-hidden opacity-0'
        } ${isOpen ? contentClassName || defaultContentPadding : ''}`.trim()}
      >
        {isOpen ? children : null}
      </div>
    </section>
  );
});

Collapsible.propTypes = {
  title: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
  actions: PropTypes.node,
  defaultOpen: PropTypes.bool,
  className: PropTypes.string,
  contentClassName: PropTypes.string,
  persistKey: PropTypes.string,
};

export default Collapsible;
