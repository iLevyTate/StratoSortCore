import React, { useState, useRef } from 'react';
import { createLogger } from '../../shared/logger';
import { PHASES, PHASE_METADATA, PHASE_ORDER } from '../../shared/constants';
import { useAppSelector } from '../store/hooks';
import { Heading, Text } from './ui/Typography';
import { Button, IconButton } from './ui';
import { ChevronDown } from 'lucide-react';

const logger = createLogger('ProgressIndicator');
function ProgressIndicator() {
  const currentPhase = useAppSelector((state) => state.ui.currentPhase);
  const [showPhaseMenu, setShowPhaseMenu] = useState(false);
  const firstMenuItemRef = useRef(null);
  const secondMenuItemRef = useRef(null);
  const phaseMenuRef = useRef(null);
  const phaseMenuTriggerRef = useRef(null);
  const metadata = PHASE_METADATA[currentPhase] || {
    title: 'Unknown',
    icon: '?',
    progress: 0
  };
  const phases = PHASE_ORDER || (PHASES ? Object.values(PHASES) : []);
  const currentIndex = phases.indexOf(currentPhase);

  const getPersistKeysForPhase = () => {
    switch (currentPhase) {
      case PHASES?.SETUP ?? 'setup':
        return ['setup-current-folders', 'setup-add-folder'];
      case PHASES?.DISCOVER ?? 'discover':
        return ['discover-naming', 'discover-selection', 'discover-dnd', 'discover-results'];
      case PHASES?.ORGANIZE ?? 'organize':
        return [
          'organize-target-folders',
          'organize-status',
          'organize-bulk',
          'organize-ready-list',
          'organize-history',
          'organize-action'
        ];
      case PHASES?.COMPLETE ?? 'complete':
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
        window.localStorage.setItem(`collapsible:${k}`, expand ? 'true' : 'false')
      );
      window.dispatchEvent(new Event('storage'));
    } catch (error) {
      logger.error('Failed to toggle collapsible sections', {
        error: error.message
      });
    }
  };

  return (
    <div className="bg-white/80 border-b border-border-soft py-4 backdrop-blur-sm sticky top-[var(--app-nav-height)] z-10">
      <div className="container-responsive">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-2xl text-system-gray-700">{metadata.icon}</span>
            <div>
              <Heading as="h2" variant="h5" className="text-system-gray-900">
                {metadata.title}
              </Heading>
              <Text variant="tiny" className="text-system-gray-500">
                Step {currentIndex >= 0 ? currentIndex + 1 : '-'} of {phases.length}
              </Text>
            </div>
            {getPersistKeysForPhase().length > 0 && (
              <div
                className="relative"
                ref={phaseMenuRef}
                onBlur={(e) => {
                  const nextFocused = e.relatedTarget;
                  if (nextFocused && e.currentTarget.contains(nextFocused)) {
                    return;
                  }
                  setShowPhaseMenu(false);
                }}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setShowPhaseMenu(false);
                    const triggerButton = phaseMenuTriggerRef.current?.querySelector('button');
                    triggerButton?.focus();
                    return;
                  }
                  if (e.key === 'ArrowDown' && showPhaseMenu) {
                    e.preventDefault();
                    firstMenuItemRef.current?.focus();
                  }
                  if (e.key === 'ArrowUp' && showPhaseMenu) {
                    e.preventDefault();
                    secondMenuItemRef.current?.focus();
                  }
                }}
              >
                <span ref={phaseMenuTriggerRef}>
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-haspopup="menu"
                    aria-expanded={showPhaseMenu}
                    title="Phase sections"
                    aria-label="Open phase menu"
                    onClick={() => setShowPhaseMenu((prev) => !prev)}
                    icon={<ChevronDown className="w-4 h-4" />}
                  />
                </span>

                {showPhaseMenu && (
                  <div className="absolute left-0 mt-2 bg-white border border-border-soft rounded-lg shadow-lg z-overlay min-w-[140px] py-1 overflow-hidden">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start px-4 py-2 text-system-gray-700 hover:bg-system-gray-50 rounded-none"
                      ref={firstMenuItemRef}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          secondMenuItemRef.current?.focus();
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setShowPhaseMenu(false);
                          const triggerButton =
                            phaseMenuTriggerRef.current?.querySelector('button');
                          triggerButton?.focus();
                        }
                      }}
                      onClick={() => {
                        applyPhaseExpandCollapse(true);
                        setShowPhaseMenu(false);
                      }}
                    >
                      Expand all
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start px-4 py-2 text-system-gray-700 hover:bg-system-gray-50 rounded-none"
                      ref={secondMenuItemRef}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          firstMenuItemRef.current?.focus();
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setShowPhaseMenu(false);
                          const triggerButton =
                            phaseMenuTriggerRef.current?.querySelector('button');
                          triggerButton?.focus();
                        }
                      }}
                      onClick={() => {
                        applyPhaseExpandCollapse(false);
                        setShowPhaseMenu(false);
                      }}
                    >
                      Collapse all
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3">
              <Text variant="small" className="text-system-gray-500 font-medium">
                {metadata.progress}%
              </Text>
              <div
                className="w-32 h-2 bg-system-gray-100 rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={metadata.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${metadata.title || 'Progress'}: ${metadata.progress}%`}
              >
                <div
                  className="h-full bg-stratosort-blue transition-all duration-500 ease-out"
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
