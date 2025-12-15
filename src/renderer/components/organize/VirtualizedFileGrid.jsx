import React, { memo, useCallback, useMemo, useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { List } from 'react-window';
import ReadyFileItem from './ReadyFileItem';

// FIX: Implement virtualization for large file lists to prevent UI lag
// Height calculations for responsive grid layout
// Slightly taller default rows to prevent cutting off multi-line text in review cards
const DEFAULT_ROW_HEIGHT = 400;
const MEASUREMENT_PADDING = 24; // breathing room so measured height has slack
const VIRTUALIZATION_THRESHOLD = 30; // Only virtualize when > 30 files

/**
 * Calculate how many columns to render based on container width
 * Used only for virtualized mode - non-virtualized uses CSS auto-fit
 */
const getColumnCount = (containerWidth) => {
  if (containerWidth >= 1280) return 3; // xl breakpoint
  if (containerWidth >= 1024) return 2; // lg breakpoint
  return 1; // default
};

/**
 * Virtualized row component that renders multiple file items per row
 */
const VirtualizedFileRow = memo(function VirtualizedFileRow({
  index,
  style,
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
}) {
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
  // Fix: Use ref to measure actual container dimensions
  const containerRef = React.useRef(null);
  const [dimensions, setDimensions] = useState({ width: containerWidth, height: 600 });
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setDimensions({
          width: width || containerWidth,
          height: height || (typeof window !== 'undefined' ? window.innerHeight * 0.6 : 600)
        });
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [containerWidth]);

  const columnsPerRow = getColumnCount(dimensions.width);
  const rowCount = Math.max(1, Math.ceil(files.length / columnsPerRow));
  const shouldVirtualize = files.length > VIRTUALIZATION_THRESHOLD;
  const columnWidthEstimate = useMemo(
    () => Math.max(320, Math.floor(dimensions.width / columnsPerRow) - 16),
    [dimensions.width, columnsPerRow]
  );

  const measureRef = useCallback((node) => {
    if (!node) return;
    const measured = Math.ceil(node.getBoundingClientRect().height);
    const paddedHeight = Math.max(DEFAULT_ROW_HEIGHT, measured + MEASUREMENT_PADDING);
    setRowHeight((prev) => (Math.abs(prev - paddedHeight) > 4 ? paddedHeight : prev));
  }, []);

  const sampleItem = useMemo(() => {
    if (!shouldVirtualize || files.length === 0) return null;
    const sampleIndex = 0;
    const file = files[sampleIndex];
    const fileWithEdits = getFileWithEdits(file, sampleIndex);
    const rawCategory = editingFiles[sampleIndex]?.category || fileWithEdits.analysis?.category;
    const smartFolder = findSmartFolderForCategory(rawCategory);
    const currentCategory = smartFolder?.name || rawCategory;
    const stateDisplay = getFileStateDisplay(file.path, !!file.analysis);
    const destination = smartFolder
      ? smartFolder.path || `${defaultLocation}/${smartFolder.name}`
      : `${defaultLocation}/${rawCategory || 'Uncategorized'}`;

    return {
      file: fileWithEdits,
      index: sampleIndex,
      isSelected: selectedFiles.has(sampleIndex),
      stateDisplay,
      smartFolder,
      currentCategory,
      destination
    };
  }, [
    shouldVirtualize,
    files,
    editingFiles,
    findSmartFolderForCategory,
    getFileWithEdits,
    getFileStateDisplay,
    defaultLocation,
    selectedFiles
  ]);

  // react-window v2 expects rowProps (not itemData).
  const rowProps = useMemo(
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
    // Use measured height or fallback to viewport calculation
    // FIX: Use full available height instead of fractional calculation
    const availableHeight =
      dimensions.height || (typeof window !== 'undefined' ? window.innerHeight : 900);
    return availableHeight;
  }, [dimensions.height]);

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
      <div ref={containerRef} className="relative w-full h-full">
        {/* Helper for measurement only */}
        <div
          style={{
            height: '100%',
            width: '100%',
            position: 'absolute',
            top: 0,
            left: 0,
            pointerEvents: 'none',
            visibility: 'hidden'
          }}
        />

        {sampleItem && (
          <div
            aria-hidden
            ref={measureRef}
            className="absolute opacity-0 pointer-events-none"
            style={{ width: `${columnWidthEstimate}px`, maxWidth: '100%' }}
          >
            <ReadyFileItem
              file={sampleItem.file}
              index={sampleItem.index}
              isSelected={sampleItem.isSelected}
              onToggleSelected={toggleFileSelection}
              stateDisplay={sampleItem.stateDisplay}
              smartFolders={smartFolders}
              editing={editingFiles[sampleItem.index]}
              onEdit={handleEditFile}
              destination={sampleItem.destination}
              category={sampleItem.currentCategory}
              onViewDetails={onViewDetails}
            />
          </div>
        )}
        <div className="text-xs text-system-gray-500 mb-2 absolute top-0 right-0 z-10 bg-white/80 px-2 py-1 rounded backdrop-blur-sm">
          Showing {files.length} files
        </div>
        <List
          rowComponent={VirtualizedFileRow}
          rowCount={rowCount}
          rowHeight={rowHeight}
          rowProps={rowProps}
          overscanCount={2}
          className="scrollbar-thin scrollbar-thumb-system-gray-300 scrollbar-track-transparent"
          style={{ height: listHeight, width: '100%' }}
        />
      </div>
    );
  }

  // For smaller lists, render normally without virtualization overhead
  // Use auto-fit grid that adapts to content amount
  // Center content when sparse data (≤5 files) for better visual balance
  const isSparse = files.length <= 5;
  return (
    <div
      ref={containerRef}
      className={`grid grid-adaptive-lg gap-4 h-full overflow-y-auto modern-scrollbar ${isSparse ? 'place-content-center' : ''}`}
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
