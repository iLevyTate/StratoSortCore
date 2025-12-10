import React, { memo, useMemo } from 'react';
import PropTypes from 'prop-types';
import { List } from 'react-window';
import ReadyFileItem from './ReadyFileItem';

// FIX: Implement virtualization for large file lists to prevent UI lag
// Height calculations for responsive grid layout
// Slightly taller rows to prevent cutting off multi-line text in review cards
const ITEM_HEIGHT = 320;
const VIRTUALIZATION_THRESHOLD = 30; // Only virtualize when > 30 files

/**
 * Calculate optimal list height based on file count and viewport
 * Adapts to data volume: sparse data gets compact height, dense data gets more space
 */
const getListHeight = (itemCount, viewportHeight) => {
  // Sparse: 35vh, Moderate: 45vh, Dense: 55vh
  const maxFraction = itemCount <= 10 ? 0.35 : itemCount <= 30 ? 0.45 : 0.55;
  const contentMinHeight = 300;
  const maxHeight = Math.round(viewportHeight * maxFraction);
  return Math.min(Math.max(contentMinHeight, itemCount * 80), maxHeight);
};

/**
 * Calculate how many columns to render based on container width
 * Used only for virtualized mode - non-virtualized uses CSS auto-fit
 */
const getColumnCount = (containerWidth) => {
  if (containerWidth >= 1280) return 3; // xl breakpoint
  if (containerWidth >= 1024) return 2; // lg breakpoint
  return 1; // default
};

// Stable key generator to prevent row/content mismatches during reorders
const itemKeyForRow = (index, data) => {
  const startIndex = index * data.columnsPerRow;
  const file = data.files[startIndex];
  return file?.path || `row-${index}`;
};

/**
 * Virtualized row component that renders multiple file items per row
 */
const VirtualizedFileRow = memo(function VirtualizedFileRow({ index, style, data }) {
  const {
    files,
    columnsPerRow,
    selectedFiles,
    toggleFileSelection,
    getFileWithEdits,
    editingFiles,
    findSmartFolderForCategory,
    getFileStateDisplay,
    handleEditFile,
    smartFolders,
    defaultLocation,
    onViewDetails
  } = data;

  const startIndex = index * columnsPerRow;
  const rowItems = [];

  for (let col = 0; col < columnsPerRow; col++) {
    const fileIndex = startIndex + col;
    if (fileIndex >= files.length) break;

    const file = files[fileIndex];
    const fileWithEdits = getFileWithEdits(file, fileIndex);
    const rawCategory = editingFiles[fileIndex]?.category || fileWithEdits.analysis?.category;
    const smartFolder = findSmartFolderForCategory(rawCategory);
    // CRITICAL FIX: Use the matched smart folder's actual name for the Select value
    // This ensures case-insensitive matching between analysis category and dropdown options
    const currentCategory = smartFolder?.name || rawCategory;
    const isSelected = selectedFiles.has(fileIndex);
    const stateDisplay = getFileStateDisplay(file.path, !!file.analysis);
    const destination = smartFolder
      ? smartFolder.path || `${defaultLocation}/${smartFolder.name}`
      : `${defaultLocation}/${rawCategory || 'Uncategorized'}`;

    rowItems.push(
      <div key={file.path} className="flex-1 min-w-0">
        <ReadyFileItem
          file={fileWithEdits}
          index={fileIndex}
          isSelected={isSelected}
          onToggleSelected={toggleFileSelection}
          stateDisplay={stateDisplay}
          smartFolders={smartFolders}
          editing={editingFiles[fileIndex]}
          onEdit={handleEditFile}
          destination={destination}
          category={currentCategory}
          onViewDetails={onViewDetails}
        />
      </div>
    );
  }

  // Fill remaining space if row is incomplete
  while (rowItems.length < columnsPerRow) {
    rowItems.push(<div key={`empty-${rowItems.length}`} className="flex-1 min-w-0" />);
  }

  return (
    <div style={style} className="flex gap-2">
      {rowItems}
    </div>
  );
});

VirtualizedFileRow.propTypes = {
  index: PropTypes.number.isRequired,
  style: PropTypes.object.isRequired,
  data: PropTypes.shape({
    files: PropTypes.array.isRequired,
    columnsPerRow: PropTypes.number.isRequired,
    selectedFiles: PropTypes.instanceOf(Set).isRequired,
    toggleFileSelection: PropTypes.func.isRequired,
    getFileWithEdits: PropTypes.func.isRequired,
    editingFiles: PropTypes.object.isRequired,
    findSmartFolderForCategory: PropTypes.func.isRequired,
    getFileStateDisplay: PropTypes.func.isRequired,
    handleEditFile: PropTypes.func.isRequired,
    smartFolders: PropTypes.array.isRequired,
    defaultLocation: PropTypes.string.isRequired,
    onViewDetails: PropTypes.func.isRequired
  }).isRequired
};

/**
 * VirtualizedFileGrid - Renders a virtualized grid of file items
 * Uses react-window FixedSizeList for efficient rendering of large file lists
 */
function VirtualizedFileGrid({
  files,
  isLoading = false,
  selectedFiles,
  toggleFileSelection,
  getFileWithEdits,
  editingFiles,
  findSmartFolderForCategory,
  getFileStateDisplay,
  handleEditFile,
  smartFolders,
  defaultLocation,
  containerWidth = 1200, // Default to xl breakpoint width
  onViewDetails
}) {
  const columnsPerRow = getColumnCount(containerWidth);
  const rowCount = Math.ceil(files.length / columnsPerRow);
  const shouldVirtualize = files.length > VIRTUALIZATION_THRESHOLD;

  // Memoize item data to prevent unnecessary re-renders
  const itemData = useMemo(
    () => ({
      files,
      columnsPerRow,
      selectedFiles,
      toggleFileSelection,
      getFileWithEdits,
      editingFiles,
      findSmartFolderForCategory,
      getFileStateDisplay,
      handleEditFile,
      smartFolders,
      defaultLocation,
      onViewDetails
    }),
    [
      files,
      columnsPerRow,
      selectedFiles,
      toggleFileSelection,
      getFileWithEdits,
      editingFiles,
      findSmartFolderForCategory,
      getFileStateDisplay,
      handleEditFile,
      smartFolders,
      defaultLocation,
      onViewDetails
    ]
  );

  // Calculate optimal list height based on file count (data-aware sizing)
  const listHeight = useMemo(() => {
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900;
    return getListHeight(files.length, viewportHeight);
  }, [files.length]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-auto-fit-md gap-4" role="status" aria-label="Loading files">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-64 rounded-xl bg-system-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (shouldVirtualize) {
    return (
      <div className="w-full max-h-viewport-lg overflow-y-auto modern-scrollbar">
        <div className="text-xs text-system-gray-500 mb-2">
          Showing {files.length} files (virtualized for performance)
        </div>
        <List
          height={listHeight}
          itemCount={rowCount}
          itemSize={ITEM_HEIGHT}
          width="100%"
          itemData={itemData}
          itemKey={itemKeyForRow}
          overscanCount={2}
          className="scrollbar-thin scrollbar-thumb-system-gray-300 scrollbar-track-transparent"
        >
          {VirtualizedFileRow}
        </List>
      </div>
    );
  }

  // For smaller lists, render normally without virtualization overhead
  // Use auto-fit grid that adapts to content amount
  // Center content when sparse data (≤5 files) for better visual balance
  const isSparse = files.length <= 5;
  return (
    <div
      className={`grid grid-adaptive-lg gap-4 ${isSparse ? 'place-content-center min-h-[300px]' : ''}`}
    >
      {files.map((file, index) => {
        const fileWithEdits = getFileWithEdits(file, index);
        const rawCategory = editingFiles[index]?.category || fileWithEdits.analysis?.category;
        const smartFolder = findSmartFolderForCategory(rawCategory);
        // CRITICAL FIX: Use the matched smart folder's actual name for the Select value
        // This ensures case-insensitive matching between analysis category and dropdown options
        const currentCategory = smartFolder?.name || rawCategory;
        const isSelected = selectedFiles.has(index);
        const stateDisplay = getFileStateDisplay(file.path, !!file.analysis);
        const destination = smartFolder
          ? smartFolder.path || `${defaultLocation}/${smartFolder.name}`
          : `${defaultLocation}/${rawCategory || 'Uncategorized'}`;
        return (
          <ReadyFileItem
            key={file.path}
            file={fileWithEdits}
            index={index}
            isSelected={isSelected}
            onToggleSelected={toggleFileSelection}
            stateDisplay={stateDisplay}
            smartFolders={smartFolders}
            editing={editingFiles[index]}
            onEdit={handleEditFile}
            destination={destination}
            category={currentCategory}
            onViewDetails={onViewDetails}
          />
        );
      })}
    </div>
  );
}

VirtualizedFileGrid.propTypes = {
  files: PropTypes.array.isRequired,
  isLoading: PropTypes.bool,
  selectedFiles: PropTypes.instanceOf(Set).isRequired,
  toggleFileSelection: PropTypes.func.isRequired,
  getFileWithEdits: PropTypes.func.isRequired,
  editingFiles: PropTypes.object.isRequired,
  findSmartFolderForCategory: PropTypes.func.isRequired,
  getFileStateDisplay: PropTypes.func.isRequired,
  handleEditFile: PropTypes.func.isRequired,
  smartFolders: PropTypes.array.isRequired,
  defaultLocation: PropTypes.string.isRequired,
  containerWidth: PropTypes.number,
  onViewDetails: PropTypes.func.isRequired
};

export default memo(VirtualizedFileGrid);
