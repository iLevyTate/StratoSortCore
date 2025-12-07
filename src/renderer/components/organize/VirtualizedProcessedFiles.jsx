import React, { memo, useMemo } from 'react';
import PropTypes from 'prop-types';
import { FixedSizeList as List } from 'react-window';

// FIX: Implement virtualization for large processed file lists to prevent UI lag
const ITEM_HEIGHT = 80; // Height of each processed file item
const LIST_HEIGHT = 400; // Max visible area height (soft cap)
const VIRTUALIZATION_THRESHOLD = 30; // Only virtualize when > 30 files

/**
 * Individual processed file row component
 */
const ProcessedFileRow = memo(function ProcessedFileRow({
  index,
  style,
  data,
}) {
  const { files } = data;
  const file = files[index];

  if (!file) return null;

  return (
    <div style={style} className="px-2 py-1">
      <div className="list-row flex items-center justify-between p-4 h-full">
        <div className="flex items-center gap-4">
          <span className="status-chip success">OK</span>
          <div>
            <div className="text-sm font-medium text-system-gray-900">
              {file.originalName} -&gt; {file.newName}
            </div>
            <div className="text-xs text-system-gray-500">
              Moved to {file.smartFolder} |{' '}
              {new Date(file.organizedAt).toLocaleDateString()}
            </div>
          </div>
        </div>
        <div className="text-xs text-stratosort-success font-semibold">
          Organized
        </div>
      </div>
    </div>
  );
});

ProcessedFileRow.propTypes = {
  index: PropTypes.number.isRequired,
  style: PropTypes.object.isRequired,
  data: PropTypes.shape({
    files: PropTypes.array.isRequired,
  }).isRequired,
};

/**
 * VirtualizedProcessedFiles - Renders a virtualized list of organized files
 * Uses react-window FixedSizeList for efficient rendering of large file lists
 */
function VirtualizedProcessedFiles({ files }) {
  const shouldVirtualize = files.length > VIRTUALIZATION_THRESHOLD;

  // Memoize item data to prevent unnecessary re-renders
  const itemData = useMemo(
    () => ({
      files,
    }),
    [files],
  );

  // Calculate optimal list height
  const listHeight = useMemo(() => {
    const viewportHeight =
      typeof window !== 'undefined' ? window.innerHeight : 900;
    const maxHeight = Math.min(
      LIST_HEIGHT,
      Math.max(260, Math.round(viewportHeight * 0.5)),
    );
    const calculatedHeight = Math.min(files.length * ITEM_HEIGHT, maxHeight);
    return Math.max(calculatedHeight, ITEM_HEIGHT);
  }, [files.length]);

  if (shouldVirtualize) {
    return (
      <div className="w-full max-h-[55vh] overflow-hidden">
        <div className="text-xs text-system-gray-500 mb-2">
          Showing {files.length} organized files (virtualized for performance)
        </div>
        <List
          height={listHeight}
          itemCount={files.length}
          itemSize={ITEM_HEIGHT}
          width="100%"
          itemData={itemData}
          overscanCount={5}
          className="scrollbar-thin scrollbar-thumb-system-gray-300 scrollbar-track-transparent"
        >
          {ProcessedFileRow}
        </List>
      </div>
    );
  }

  // For smaller lists, render normally without virtualization overhead
  return (
    <div className="space-y-3">
      {files.map((file) => (
        <div
          key={file.originalPath || `${file.originalName}-${file.organizedAt}`}
          className="list-row flex items-center justify-between p-4"
        >
          <div className="flex items-center gap-4">
            <span className="status-chip success">OK</span>
            <div>
              <div className="text-sm font-medium text-system-gray-900">
                {file.originalName} -&gt; {file.newName}
              </div>
              <div className="text-xs text-system-gray-500">
                Moved to {file.smartFolder} |{' '}
                {new Date(file.organizedAt).toLocaleDateString()}
              </div>
            </div>
          </div>
          <div className="text-xs text-stratosort-success font-semibold">
            Organized
          </div>
        </div>
      ))}
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
      organizedAt: PropTypes.string,
    }),
  ).isRequired,
};

export default memo(VirtualizedProcessedFiles);
