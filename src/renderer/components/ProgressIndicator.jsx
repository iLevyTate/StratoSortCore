import React, { useState, useRef } from 'react';
import { logger } from '../../shared/logger';
import { PHASES, PHASE_METADATA } from '../../shared/constants';
import { useAppSelector } from '../store/hooks';

logger.setContext('ProgressIndicator');

function ProgressIndicator() {
  const currentPhase = useAppSelector((state) => state.ui.currentPhase);
  const [showPhaseMenu, setShowPhaseMenu] = useState(false);
  const firstMenuItemRef = useRef(null);
  const metadata = PHASE_METADATA[currentPhase] || {
    title: 'Unknown',
    icon: '?',
    progress: 0,
  };
  const phases = Object.values(PHASES);
  const currentIndex = phases.indexOf(currentPhase);

  const getPersistKeysForPhase = () => {
    switch (currentPhase) {
      case PHASES.SETUP:
        return ['setup-current-folders', 'setup-add-folder'];
      case PHASES.DISCOVER:
        return [
          'discover-naming',
          'discover-selection',
          'discover-dnd',
          'discover-results',
        ];
      case PHASES.ORGANIZE:
        return [
          'organize-target-folders',
          'organize-status',
          'organize-bulk',
          'organize-ready-list',
          'organize-history',
          'organize-action',
        ];
      case PHASES.COMPLETE:
        return ['complete-summary', 'complete-next-steps'];
      default:
        return [];
    }
  };

  const applyPhaseExpandCollapse = (expand) => {
    try {
      const keys = getPersistKeysForPhase();
      if (!keys.length) return;
      keys.forEach((k) =>
        window.localStorage.setItem(
          `collapsible:${k}`,
          expand ? 'true' : 'false',
        ),
      );
      window.dispatchEvent(new Event('storage'));
    } catch (error) {
      logger.error('Failed to toggle collapsible sections', {
        error: error.message,
      });
    }
  };

  return (
    <div className="bg-surface-muted/70 border-b border-border-soft py-[var(--section-gap)] backdrop-blur-sm">
      <div className="container-enhanced">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-[var(--section-gap)]">
            <span className="text-2xl">{metadata.icon}</span>
            <div>
              <div className="heading-tertiary">
                {metadata.title}
              </div>
              <div className="text-sm text-system-gray-600">
                Step {currentIndex + 1} of {phases.length}
              </div>
            </div>
            {getPersistKeysForPhase().length > 0 && (
              <div
                className="relative"
                onBlur={() => setTimeout(() => setShowPhaseMenu(false), 100)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setShowPhaseMenu(false);
                    return;
                  }
                  if (e.key === 'ArrowDown' && showPhaseMenu) {
                    e.preventDefault();
                    firstMenuItemRef.current?.focus();
                  }
                }}
              >
                <button
                  type="button"
                  className="p-[var(--spacing-default)] text-system-gray-500 hover:text-system-gray-700 rounded-[var(--radius-sm)]"
                  aria-haspopup="menu"
                  aria-expanded={showPhaseMenu}
                  title="Phase sections"
                  aria-label="Open phase menu"
                  onClick={() => setShowPhaseMenu((prev) => !prev)}
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 011.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
                {showPhaseMenu && (
                  <div className="absolute right-0 mt-2 bg-white border border-system-gray-200 rounded-[var(--radius-sm)] shadow-lg z-overlay min-w-36">
                    <button
                      className="nav-item"
                      ref={firstMenuItemRef}
                      onClick={() => {
                        applyPhaseExpandCollapse(true);
                        setShowPhaseMenu(false);
                      }}
                    >
                      Expand all
                    </button>
                    <button
                      className="nav-item"
                      onClick={() => {
                        applyPhaseExpandCollapse(false);
                        setShowPhaseMenu(false);
                      }}
                    >
                      Collapse all
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-[var(--section-gap)]">
              <div className="text-sm text-system-gray-600">
                {metadata.progress}%
              </div>
              <div className="w-32 h-2 bg-system-gray-200 rounded-[var(--radius-full)] overflow-hidden">
                <div
                  className="h-full bg-stratosort-blue transition-all [transition-duration:var(--duration-slow)]"
                  style={{ width: `${metadata.progress}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProgressIndicator;
