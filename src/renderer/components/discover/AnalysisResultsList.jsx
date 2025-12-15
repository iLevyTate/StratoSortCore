import React, { memo, useMemo, useCallback, useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { List } from 'react-window';
import { FileText, Compass } from 'lucide-react';
import { Button, StatusBadge } from '../ui';

// FIX: Implement virtualization for large file lists to prevent UI lag
// Each item is approximately 176px in height (fits 2-line titles without overlap)
const ITEM_HEIGHT = 176;
const VIRTUALIZATION_THRESHOLD = 30; // Only virtualize when > 30 items

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
  items,
  handleAction,
  getFileStateDisplay
}) {
  const file = items[index];

  if (!file) return null;

  const stateDisplay = getFileStateDisplay(file.path, !!file.analysis);
  const confidence = formatConfidence(file.analysis?.confidence);
  const tone = stateDisplay.color?.includes('green')
    ? 'success'
    : stateDisplay.color?.includes('amber') || stateDisplay.color?.includes('warning')
      ? 'warning'
      : stateDisplay.color?.includes('red') || stateDisplay.color?.includes('danger')
        ? 'error'
        : 'info';

  return (
    <div style={style} className="px-2 py-1.5">
      <div className="list-row h-full overflow-hidden p-4 flex flex-col gap-2">
        <div className="flex items-start gap-4">
          <FileText className="w-6 h-6 text-system-gray-400 flex-shrink-0" />
          <div className="flex-1 min-w-0 overflow-hidden">
            <div
              className="font-medium text-system-gray-900 clamp-2 break-words leading-snug"
              title={`${file.name}${file.path ? ` (${file.path})` : ''}`}
            >
              {file.name}
            </div>
            <div className="text-xs text-system-gray-500 clamp-1 break-words">
              {file.source && file.source !== 'file_selection' && (
                <>
                  {file.source.replace('_', ' ')}
                  {file.size ? ' • ' : ''}
                </>
              )}
              {file.size ? `${Math.round(file.size / 1024)} KB` : ''}
            </div>
            {file.analysis?.category && (
              <div className="text-xs text-system-gray-600 mt-1 clamp-1 break-words">
                Category:{' '}
                <span className="text-stratosort-blue font-medium">{file.analysis.category}</span>
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
              <span className="text-xs text-system-gray-500">Confidence {confidence}%</span>
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
  items: PropTypes.array.isRequired,
  handleAction: PropTypes.func.isRequired,
  getFileStateDisplay: PropTypes.func.isRequired
};

/**
 * Analysis results list with optional virtualization for large lists
 * FIX: Implements react-window for performance with 100+ items
 */
function AnalysisResultsList({ results = [], onFileAction, getFileStateDisplay }) {
  const isEmpty = !Array.isArray(results) || results.length === 0;
  const items = useMemo(() => (Array.isArray(results) ? results : []), [results]);
  const handleAction = useCallback((action, path) => onFileAction(action, path), [onFileAction]);

  // Fix: Use ref to measure actual container dimensions like VirtualizedFileGrid
  const containerRef = React.useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 600 });

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setDimensions({
          width: width || 0,
          height: height || (typeof window !== 'undefined' ? window.innerHeight * 0.6 : 600)
        });
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // react-window v2 expects rowProps (not itemData).
  // Keep a stable object so the list can memoize rows efficiently.
  const rowProps = useMemo(
    () => ({
      items,
      handleAction,
      getFileStateDisplay
    }),
    [items, handleAction, getFileStateDisplay]
  );

  // FIX: Use virtualization only for large lists to avoid overhead on small lists
  const shouldVirtualize = items.length > VIRTUALIZATION_THRESHOLD;

  // Simple wrapper - inline to avoid component identity issues
  const listContainerClass = `w-full h-full modern-scrollbar overflow-y-auto flex flex-col gap-3`;

  if (isEmpty) {
    return (
      <div className="empty-state p-4">
        <Compass className="w-8 h-8 text-system-gray-400" />
        <div className="space-y-1">
          <p className="text-system-gray-800 font-semibold">No analysis results yet</p>
          <p className="text-system-gray-500 text-sm">
            Add files above and start an analysis to see suggestions stream in.
          </p>
        </div>
      </div>
    );
  }

  if (shouldVirtualize) {
    return (
      <div
        ref={containerRef}
        className="relative w-full h-full px-4 py-2" // Add padding to container not list
      >
        <div className="text-xs text-system-gray-500 mb-2 absolute top-0 right-4 z-10 bg-white/80 px-2 py-1 rounded backdrop-blur-sm">
          Showing {items.length} files (virtualized)
        </div>
        <List
          rowComponent={AnalysisResultRow}
          rowCount={items.length}
          rowHeight={ITEM_HEIGHT}
          rowProps={rowProps}
          overscanCount={5}
          className="scrollbar-thin scrollbar-thumb-system-gray-300 scrollbar-track-transparent"
          style={{ height: dimensions.height, width: '100%' }}
        />
      </div>
    );
  }

  // For smaller lists, render normally without virtualization overhead
  return (
    <div className={`${listContainerClass} p-4`}>
      {/* FIX: Use stable composite key that doesn't rely on array index
          Priority: path > id > name+size+lastModified (all stable file properties) */}
      {items.map((file) => {
        const stateDisplay = getFileStateDisplay(file.path, !!file.analysis);
        const confidence = formatConfidence(file.analysis?.confidence);
        const tone = stateDisplay.color?.includes('green')
          ? 'success'
          : stateDisplay.color?.includes('amber') || stateDisplay.color?.includes('warning')
            ? 'warning'
            : stateDisplay.color?.includes('red') || stateDisplay.color?.includes('danger')
              ? 'error'
              : 'info';
        // Generate stable key from file properties (avoid index which breaks on reorder)
        const stableKey =
          file.path || file.id || `${file.name}-${file.size || 0}-${file.lastModified || 'nomod'}`;
        return (
          <div key={stableKey} className="list-row p-4 overflow-hidden flex flex-col gap-2">
            <div className="flex items-start gap-4">
              <FileText className="w-6 h-6 text-system-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0 overflow-hidden">
                <div
                  className="font-medium text-system-gray-900 clamp-2 break-words leading-snug"
                  title={`${file.name}${file.path ? ` (${file.path})` : ''}`}
                >
                  {file.name}
                </div>
                <div className="text-xs text-system-gray-500 clamp-1 break-words">
                  {file.source && file.source !== 'file_selection' && (
                    <>
                      {file.source.replace('_', ' ')}
                      {file.size ? ' • ' : ''}
                    </>
                  )}
                  {file.size ? `${Math.round(file.size / 1024)} KB` : ''}
                </div>
                {file.analysis?.category && (
                  <div className="text-xs text-system-gray-600 mt-1 clamp-1 break-words">
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
                  <span className="text-xs text-system-gray-500">Confidence {confidence}%</span>
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
  getFileStateDisplay: PropTypes.func.isRequired
};

export default memo(AnalysisResultsList);
