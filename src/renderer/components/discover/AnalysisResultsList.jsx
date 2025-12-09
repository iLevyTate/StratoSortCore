import React, { memo, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { FixedSizeList as List } from 'react-window';
import { FileText, Compass } from 'lucide-react';
import { Button, StatusBadge } from '../ui';

// FIX: Implement virtualization for large file lists to prevent UI lag
// Each item is approximately 140px in height
const ITEM_HEIGHT = 140;
const LIST_HEIGHT = 800; // Balanced cap for most screens
const VIRTUALIZATION_THRESHOLD = 50; // Only virtualize when > 50 items

// Normalize confidence values that may arrive as either 0-1 or 0-100 and clamp to 0-100
const formatConfidence = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const normalized = value > 1 ? value : value * 100;
  const clamped = Math.min(100, Math.max(0, normalized));
  return Math.round(clamped);
};

/**
 * Individual row component for virtualized list
 */
const AnalysisResultRow = memo(function AnalysisResultRow({
  index,
  style,
  data,
}) {
  const { items, handleAction, getFileStateDisplay } = data;
  const file = items[index];

  if (!file) return null;

  const stateDisplay = getFileStateDisplay(file.path, !!file.analysis);
  const confidence = formatConfidence(file.analysis?.confidence);
  const tone = stateDisplay.color?.includes('green')
    ? 'success'
    : stateDisplay.color?.includes('amber') ||
        stateDisplay.color?.includes('warning')
      ? 'warning'
      : stateDisplay.color?.includes('red') ||
          stateDisplay.color?.includes('danger')
        ? 'error'
        : 'info';

  return (
    <div style={style} className="px-2 py-1.5">
      <div className="list-row h-full overflow-visible p-4 flex flex-col gap-3">
        <div className="flex items-start gap-4">
          <FileText className="w-6 h-6 text-system-gray-400 flex-shrink-0" />
          <div className="flex-1 min-w-0 overflow-hidden">
            <div
              className="font-medium text-system-gray-900 truncate whitespace-normal break-words"
              title={`${file.name}${file.path ? ` (${file.path})` : ''}`}
            >
              {file.name}
            </div>
            <div className="text-xs text-system-gray-500 truncate whitespace-normal break-words">
              {file.source && file.source !== 'file_selection' && (
                <>
                  {file.source.replace('_', ' ')}
                  {file.size ? ' • ' : ''}
                </>
              )}
              {file.size ? `${Math.round(file.size / 1024)} KB` : ''}
            </div>
            {file.analysis?.category && (
              <div className="text-xs text-system-gray-600 mt-1 truncate whitespace-normal break-words">
                Category:{' '}
                <span className="text-stratosort-blue font-medium">
                  {file.analysis.category}
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <StatusBadge variant={tone}>
              <span className={stateDisplay.spinning ? 'animate-spin' : ''}>
                {stateDisplay.icon}
              </span>
              <span>{stateDisplay.label}</span>
            </StatusBadge>
            {confidence !== null && (
              <span className="text-xs text-system-gray-500">
                Confidence {confidence}%
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-border-soft/70">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleAction('open', file.path)}
            aria-label="Open file"
          >
            Open
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleAction('reveal', file.path)}
            aria-label="Reveal in file explorer"
          >
            Reveal
          </Button>
          <Button
            size="sm"
            variant="subtle"
            onClick={() => handleAction('remove', file.path)}
            aria-label="Remove from queue"
            className="ml-auto"
          >
            Remove
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => handleAction('delete', file.path)}
            aria-label="Delete file permanently"
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
});

AnalysisResultRow.propTypes = {
  index: PropTypes.number.isRequired,
  style: PropTypes.object.isRequired,
  data: PropTypes.shape({
    items: PropTypes.array.isRequired,
    handleAction: PropTypes.func.isRequired,
    getFileStateDisplay: PropTypes.func.isRequired,
  }).isRequired,
};

/**
 * Analysis results list with optional virtualization for large lists
 * FIX: Implements react-window for performance with 100+ items
 */
function AnalysisResultsList({
  results = [],
  onFileAction,
  getFileStateDisplay,
}) {
  const isEmpty = !Array.isArray(results) || results.length === 0;
  const items = useMemo(
    () => (Array.isArray(results) ? results : []),
    [results],
  );
  const handleAction = useCallback(
    (action, path) => onFileAction(action, path),
    [onFileAction],
  );

  // Memoize item data to prevent unnecessary re-renders
  const itemData = useMemo(
    () => ({
      items,
      handleAction,
      getFileStateDisplay,
    }),
    [items, handleAction, getFileStateDisplay],
  );

  // FIX: Use virtualization only for large lists to avoid overhead on small lists
  const shouldVirtualize = items.length > VIRTUALIZATION_THRESHOLD;

  // FIX: Move useMemo before early return to follow React hooks rules
  const computedListHeight = React.useMemo(() => {
    // Keep list from blowing past viewport on shorter screens
    const viewportHeight =
      typeof window !== 'undefined' ? window.innerHeight : 900;
    // Use up to 65% of viewport, but at least 350px
    const maxHeight = Math.min(
      LIST_HEIGHT,
      Math.max(350, Math.round(viewportHeight * 0.65)),
    );
    // Also avoid rendering excessive blank space when fewer rows
    const desired = Math.min(maxHeight, ITEM_HEIGHT * items.length);
    return Math.max(desired, Math.min(ITEM_HEIGHT * 4, maxHeight));
  }, [items.length]);

  // Simple wrapper - inline to avoid component identity issues
  const listContainerClass = `p-4 w-full modern-scrollbar overflow-y-auto flex flex-col gap-3`;

  if (isEmpty) {
    return (
      <div className="empty-state">
        <Compass className="w-8 h-8 text-system-gray-400" />
        <div className="space-y-1">
          <p className="text-system-gray-800 font-semibold">
            No analysis results yet
          </p>
          <p className="text-system-gray-500 text-sm">
            Add files above and start an analysis to see suggestions stream in.
          </p>
        </div>
      </div>
    );
  }

  if (shouldVirtualize) {
    return (
      <div className={listContainerClass}>
        <div className="text-xs text-system-gray-500 mb-2">
          Showing {items.length} files (virtualized for performance)
        </div>
        <List
          height={computedListHeight}
          itemCount={items.length}
          itemSize={ITEM_HEIGHT}
          width="100%"
          itemData={itemData}
          overscanCount={5} // Render 5 extra items above/below viewport
          className="scrollbar-thin scrollbar-thumb-system-gray-300 scrollbar-track-transparent"
        >
          {AnalysisResultRow}
        </List>
      </div>
    );
  }

  // For smaller lists, render normally without virtualization overhead
  return (
    <div className={listContainerClass}>
      {/* FIX: Use more stable key to prevent collisions when file.path is undefined */}
      {items.map((file, index) => {
        const stateDisplay = getFileStateDisplay(file.path, !!file.analysis);
        const confidence = formatConfidence(file.analysis?.confidence);
        const tone = stateDisplay.color?.includes('green')
          ? 'success'
          : stateDisplay.color?.includes('amber') ||
              stateDisplay.color?.includes('warning')
            ? 'warning'
            : stateDisplay.color?.includes('red') ||
                stateDisplay.color?.includes('danger')
              ? 'error'
              : 'info';
        return (
          <div
            key={file.path || file.id || `${file.name}-${file.size || index}`}
            className="list-row p-4 overflow-visible"
          >
            <div className="flex items-start gap-4">
              <FileText className="w-6 h-6 text-system-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0 overflow-hidden">
                <div
                  className="font-medium text-system-gray-900 truncate whitespace-normal break-words"
                  title={`${file.name}${file.path ? ` (${file.path})` : ''}`}
                >
                  {file.name}
                </div>
                <div className="text-xs text-system-gray-500 truncate whitespace-normal break-words">
                  {file.source && file.source !== 'file_selection' && (
                    <>
                      {file.source.replace('_', ' ')}
                      {file.size ? ' • ' : ''}
                    </>
                  )}
                  {file.size ? `${Math.round(file.size / 1024)} KB` : ''}
                </div>
                {file.analysis?.category && (
                  <div className="text-xs text-system-gray-600 mt-1 truncate whitespace-normal break-words">
                    Category:{' '}
                    <span className="text-stratosort-blue font-medium">
                      {file.analysis.category}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <StatusBadge variant={tone}>
                  <span className={stateDisplay.spinning ? 'animate-spin' : ''}>
                    {stateDisplay.icon}
                  </span>
                  <span>{stateDisplay.label}</span>
                </StatusBadge>
                {confidence !== null && (
                  <span className="text-xs text-system-gray-500">
                    Confidence {confidence}%
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3 border-t pt-2 border-border-soft/70">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleAction('open', file.path)}
                aria-label="Open file"
              >
                Open
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleAction('reveal', file.path)}
                aria-label="Reveal in file explorer"
              >
                Reveal
              </Button>
              <Button
                size="sm"
                variant="subtle"
                onClick={() => handleAction('remove', file.path)}
                aria-label="Remove from queue"
                className="ml-auto"
              >
                Remove
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => handleAction('delete', file.path)}
                aria-label="Delete file permanently"
              >
                Delete
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

AnalysisResultsList.propTypes = {
  results: PropTypes.arrayOf(PropTypes.object),
  onFileAction: PropTypes.func.isRequired,
  getFileStateDisplay: PropTypes.func.isRequired,
};

export default memo(AnalysisResultsList);
