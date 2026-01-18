import React, { memo, useMemo } from 'react';
import PropTypes from 'prop-types';
import { List } from 'react-window';
import { StatusBadge } from '../ui';
import { UI_VIRTUALIZATION } from '../../../shared/constants';

// FIX L-2: Use centralized constants for virtualization
const ITEM_HEIGHT = UI_VIRTUALIZATION.PROCESSED_FILES_ITEM_HEIGHT;
const VIRTUALIZATION_THRESHOLD = UI_VIRTUALIZATION.THRESHOLD;

/**
 * Calculate optimal list height based on file count and viewport
 * Adapts to data volume for proportional space usage
 */
const getListHeight = (itemCount, viewportHeight) => {
  // Processed files: show up to 8 without scroll, 40vh max
  const targetItems = Math.min(itemCount, 8);
  const contentHeight = targetItems * ITEM_HEIGHT;
  const maxHeight = Math.round(viewportHeight * 0.4);
  return Math.max(ITEM_HEIGHT * 2, Math.min(contentHeight, maxHeight));
};

/**
 * Individual processed file row component
 */
/**
 * Format date safely with fallback
 */
const formatDate = (dateString) => {
  if (!dateString) return 'Unknown date';
  try {
    return new Date(dateString).toLocaleDateString();
  } catch {
    return 'Unknown date';
  }
};

const ProcessedFileRow = memo(function ProcessedFileRow({ index, style, data }) {
  const { files } = data || {};
  const file = files && files[index];

  if (!file) return null;

  // FIX L-1: Add null checks for optional file properties
  const originalName = file.originalName || 'Unknown';
  const newName = file.newName || 'Unknown';
  const smartFolder = file.smartFolder || 'Unknown folder';
  const organizedDate = formatDate(file.organizedAt);

  return (
    <div style={style} className="px-2 py-1">
      <div className="list-row flex items-center justify-between p-4 h-full">
        <div className="flex items-center gap-4">
          <StatusBadge variant="success">OK</StatusBadge>
          <div>
            <div className="text-sm font-medium text-system-gray-900">
              {originalName} -&gt; {newName}
            </div>
            <div className="text-xs text-system-gray-500">
              Moved to {smartFolder} | {organizedDate}
            </div>
          </div>
        </div>
        <div className="text-xs text-stratosort-success font-semibold">Organized</div>
      </div>
    </div>
  );
});

ProcessedFileRow.propTypes = {
  index: PropTypes.number.isRequired,
  style: PropTypes.object.isRequired,
  data: PropTypes.shape({
    files: PropTypes.array.isRequired
  }).isRequired
};

/**
 * VirtualizedProcessedFiles - Renders a virtualized list of organized files
 * Uses react-window FixedSizeList for efficient rendering of large file lists
 */
function VirtualizedProcessedFiles({ files, isLoading = false }) {
  const shouldVirtualize = files.length > VIRTUALIZATION_THRESHOLD;

  const itemData = useMemo(
    () => ({
      files
    }),
    [files]
  );
  const safeItemData = itemData ?? {};

  // Calculate optimal list height based on file count (data-aware sizing)
  const listHeight = useMemo(() => {
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900;
    return getListHeight(files.length, viewportHeight);
  }, [files.length]);

  if (isLoading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading organized files">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-xl border border-border-soft bg-system-gray-100 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (shouldVirtualize) {
    return (
      <div className="w-full max-h-[55vh] min-h-[200px] overflow-hidden">
        <div className="text-xs text-system-gray-500 mb-2">
          Showing {files.length} organized files (virtualized for performance)
        </div>
        <List
          itemCount={files.length}
          itemSize={ITEM_HEIGHT}
          itemData={safeItemData}
          overscanCount={5}
          style={{ height: listHeight, width: '100%' }}
          className="scrollbar-thin scrollbar-thumb-system-gray-300 scrollbar-track-transparent"
        >
          {ProcessedFileRow}
        </List>
      </div>
    );
  }

  // For smaller lists, render normally without virtualization overhead
  // Add max-height constraint to prevent unbounded growth
  return (
    <div className="space-y-3 max-h-viewport-sm overflow-y-auto modern-scrollbar">
      {files.map((file) => {
        // FIX L-1: Add null checks for optional file properties
        const originalName = file.originalName || 'Unknown';
        const newName = file.newName || 'Unknown';
        const smartFolder = file.smartFolder || 'Unknown folder';
        const organizedDate = formatDate(file.organizedAt);

        return (
          <div
            key={file.originalPath || `${originalName}-${file.organizedAt}`}
            className="list-row flex items-center justify-between p-4"
          >
            <div className="flex items-center gap-4">
              <StatusBadge variant="success">OK</StatusBadge>
              <div>
                <div className="text-sm font-medium text-system-gray-900">
                  {originalName} -&gt; {newName}
                </div>
                <div className="text-xs text-system-gray-500">
                  Moved to {smartFolder} | {organizedDate}
                </div>
              </div>
            </div>
            <div className="text-xs text-stratosort-success font-semibold">Organized</div>
          </div>
        );
      })}
    </div>
  );
}

VirtualizedProcessedFiles.propTypes = {
  files: PropTypes.arrayOf(
    PropTypes.shape({
      originalPath: PropTypes.string,
      originalName: PropTypes.string,
      newName: PropTypes.string,
      smartFolder: PropTypes.string,
      organizedAt: PropTypes.string
    })
  ).isRequired,
  isLoading: PropTypes.bool
};

export default memo(VirtualizedProcessedFiles);
