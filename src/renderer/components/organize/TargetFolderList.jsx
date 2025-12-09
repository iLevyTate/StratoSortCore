import React, { memo, useMemo } from 'react';
import PropTypes from 'prop-types';
import { FixedSizeList as List } from 'react-window';
import { Folder } from 'lucide-react';

// FIX: Implement virtualization for large folder lists to prevent UI lag
const ITEM_HEIGHT = 100; // Compact folder cards for better space utilization
const VIRTUALIZATION_THRESHOLD = 20; // Only virtualize when > 20 folders

/**
 * Calculate optimal list height based on folder count and viewport
 * Adapts to data volume for proportional space usage
 */
const getListHeight = (folderCount, viewportHeight) => {
  // Folders list rarely has many items, optimize for readability
  const maxFraction = folderCount <= 10 ? 0.35 : 0.45;
  const contentHeight = folderCount * ITEM_HEIGHT;
  const maxHeight = Math.round(viewportHeight * maxFraction);
  return Math.max(ITEM_HEIGHT * 2, Math.min(contentHeight, maxHeight));
};

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
        <div className="text-sm text-system-gray-700 leading-relaxed break-words flex items-center gap-1.5">
          <Folder className="w-4 h-4 text-stratosort-blue flex-shrink-0" />
          <span>{fullPath}</span>
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
  isLoading = false,
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

  // Calculate optimal list height based on folder count (data-aware sizing)
  const listHeight = useMemo(() => {
    const viewportHeight =
      typeof window !== 'undefined' ? window.innerHeight : 900;
    return getListHeight(folders.length, viewportHeight);
  }, [folders.length]);

  if (isLoading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading folders">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-20 rounded-xl border border-border-soft bg-system-gray-100 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (shouldVirtualize) {
    return (
      <div className="w-full">
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
  // Use auto-fit grid that adapts to content amount
  return (
    <div className="grid grid-cols-auto-fit-md gap-4">
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
  isLoading: PropTypes.bool,
};

export default TargetFolderList;
