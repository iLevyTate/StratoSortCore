import React, { memo, useMemo } from 'react';
import PropTypes from 'prop-types';
import { FixedSizeList as List } from 'react-window';

// FIX: Implement virtualization for large folder lists to prevent UI lag
const ITEM_HEIGHT = 140; // Slightly taller to fit wrapped text comfortably
const LIST_HEIGHT = 520; // Taller viewport for readability
const VIRTUALIZATION_THRESHOLD = 20; // Only virtualize when > 20 folders

// Memoized FolderItem to prevent re-renders when folder data hasn't changed
// FIX: Added proper text overflow handling for long paths with title tooltips
const FolderItem = memo(function FolderItem({
  folder,
  defaultLocation,
  style,
}) {
  const fullPath = folder.path || `${defaultLocation}/${folder.name}`;

  return (
    <div style={style} className="p-2">
      <div className="p-4 bg-white rounded-xl border border-border-soft shadow-sm min-w-0 h-full overflow-hidden space-y-2">
        <div className="font-semibold text-system-gray-900 text-base leading-snug break-words">
          {folder.name}
        </div>
        <div className="text-sm text-system-gray-700 leading-relaxed break-words">
          📂 {fullPath}
        </div>
        {folder.description && (
          <div className="text-sm text-system-gray-600 bg-stratosort-blue/5 p-3 rounded-lg italic leading-relaxed break-words">
            &ldquo;{folder.description}&rdquo;
          </div>
        )}
      </div>
    </div>
  );
});

FolderItem.propTypes = {
  folder: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    name: PropTypes.string.isRequired,
    path: PropTypes.string,
    description: PropTypes.string,
  }).isRequired,
  defaultLocation: PropTypes.string.isRequired,
  style: PropTypes.object,
};

/**
 * Virtualized row component for rendering folder items
 */
const VirtualizedFolderRow = memo(function VirtualizedFolderRow({
  index,
  style,
  data,
}) {
  const { folders, defaultLocation } = data;
  const folder = folders[index];

  if (!folder) return null;

  return (
    <FolderItem
      folder={folder}
      defaultLocation={defaultLocation}
      style={style}
    />
  );
});

VirtualizedFolderRow.propTypes = {
  index: PropTypes.number.isRequired,
  style: PropTypes.object.isRequired,
  data: PropTypes.shape({
    folders: PropTypes.array.isRequired,
    defaultLocation: PropTypes.string.isRequired,
  }).isRequired,
};

const TargetFolderList = memo(function TargetFolderList({
  folders = [],
  defaultLocation = 'Documents',
}) {
  const shouldVirtualize = folders.length > VIRTUALIZATION_THRESHOLD;

  // Memoize item data to prevent unnecessary re-renders
  const itemData = useMemo(
    () => ({
      folders,
      defaultLocation,
    }),
    [folders, defaultLocation],
  );

  // Calculate optimal list height based on number of items
  const listHeight = useMemo(() => {
    const viewportHeight =
      typeof window !== 'undefined' ? window.innerHeight : 900;
    const maxHeight = Math.min(
      LIST_HEIGHT,
      Math.max(260, Math.round(viewportHeight * 0.5)),
    );
    const calculatedHeight = Math.min(folders.length * ITEM_HEIGHT, maxHeight);
    return Math.max(calculatedHeight, ITEM_HEIGHT); // At least show one item
  }, [folders.length]);

  if (shouldVirtualize) {
    return (
      <div className="w-full max-h-[60vh] overflow-y-auto modern-scrollbar">
        <div className="text-xs text-system-gray-500 mb-3">
          Showing {folders.length} folders (virtualized for performance)
        </div>
        <List
          height={listHeight}
          itemCount={folders.length}
          itemSize={ITEM_HEIGHT}
          width="100%"
          itemData={itemData}
          overscanCount={4}
          className="scrollbar-thin scrollbar-thumb-system-gray-300 scrollbar-track-transparent"
        >
          {VirtualizedFolderRow}
        </List>
      </div>
    );
  }

  // For smaller lists, render normally without virtualization overhead
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {folders.map((folder) => (
        <FolderItem
          key={folder.id}
          folder={folder}
          defaultLocation={defaultLocation}
        />
      ))}
    </div>
  );
});

TargetFolderList.propTypes = {
  folders: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
      name: PropTypes.string.isRequired,
      path: PropTypes.string,
      description: PropTypes.string,
    }),
  ),
  defaultLocation: PropTypes.string,
};

export default TargetFolderList;
