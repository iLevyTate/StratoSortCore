import React, { memo, useCallback, useMemo, useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { List } from 'react-window';
import ReadyFileItem from './ReadyFileItem';
import { joinPath } from '../../utils/platform';
import { UI_VIRTUALIZATION } from '../../../shared/constants';

// FIX L-2: Use centralized constants for virtualization
const DEFAULT_ROW_HEIGHT = UI_VIRTUALIZATION.FILE_GRID_ROW_HEIGHT;
const MEASUREMENT_PADDING = UI_VIRTUALIZATION.MEASUREMENT_PADDING;
const ROW_HEIGHT_TOLERANCE = 12; // avoid reflows for small delta (component-specific)
const VIRTUALIZATION_THRESHOLD = UI_VIRTUALIZATION.THRESHOLD;

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
      ? smartFolder.path || joinPath(defaultLocation, smartFolder.name)
      : joinPath(defaultLocation, rawCategory || 'Uncategorized');

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
    rowItems.push(
      <div key={`empty-${rowItems.length}`} className="flex-1 min-w-0" aria-hidden="true" />
    );
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
  // Fix: Use ref to measure actual container dimensions
  const containerRef = React.useRef(null);
  const [dimensions, setDimensions] = useState({ width: containerWidth, height: 600 });
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    let isActive = true;
    let rafId = null;

    // FIX: Use requestAnimationFrame to debounce resize callbacks
    // This prevents state updates from firing during the resize observer callback
    // which can cause "ResizeObserver loop limit exceeded" errors and memory leaks
    const observer = new ResizeObserver((entries) => {
      if (!isActive) return;

      // Cancel any pending RAF to debounce rapid resize events
      if (rafId) {
        cancelAnimationFrame(rafId);
      }

      rafId = requestAnimationFrame(() => {
        if (!isActive) return;
        const entry = entries[0];
        if (entry) {
          const { width, height } = entry.contentRect;
          const nextWidth = width || containerWidth;
          const nextHeight =
            height || (typeof window !== 'undefined' ? window.innerHeight * 0.6 : 600);
          setDimensions((prev) => {
            if (Math.abs(prev.width - nextWidth) < 1 && Math.abs(prev.height - nextHeight) < 1) {
              return prev;
            }
            return { width: nextWidth, height: nextHeight };
          });
        }
      });
    });

    observer.observe(containerRef.current);
    return () => {
      isActive = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      observer.disconnect();
    };
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
    setRowHeight((prev) =>
      Math.abs(prev - paddedHeight) > ROW_HEIGHT_TOLERANCE ? paddedHeight : prev
    );
  }, []);
  const shouldMeasure = shouldVirtualize && files.length > 0 && rowHeight === DEFAULT_ROW_HEIGHT;

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
      ? smartFolder.path || joinPath(defaultLocation, smartFolder.name)
      : joinPath(defaultLocation, rawCategory || 'Uncategorized');

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

  // react-window List passes shared data via itemData (consumed by the row renderer).
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
  const safeRowProps = rowProps ?? {};

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

        {sampleItem && shouldMeasure && (
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
          key={`list-${rowHeight}-${columnsPerRow}`}
          itemCount={rowCount}
          itemSize={rowHeight}
          itemData={safeRowProps}
          overscanCount={2}
          className="scrollbar-thin scrollbar-thumb-system-gray-300 scrollbar-track-transparent"
          style={{ height: listHeight, width: dimensions.width }}
        >
          {VirtualizedFileRow}
        </List>
      </div>
    );
  }

  // For smaller lists, render normally without virtualization overhead
  // Use auto-fit grid that adapts to content amount
  // FIX: Remove place-content-center to prevent cutoff on small screens/tall content
  // Added p-6 (padding all around) to ensure shadows are not cut off and provide breathing room
  return (
    <div
      ref={containerRef}
      className="grid grid-adaptive-lg gap-4 h-full overflow-y-auto modern-scrollbar p-6"
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
          ? smartFolder.path || joinPath(defaultLocation, smartFolder.name)
          : joinPath(defaultLocation, rawCategory || 'Uncategorized');
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
