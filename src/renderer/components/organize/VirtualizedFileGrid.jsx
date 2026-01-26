import React, { memo, useCallback, useMemo, useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { List } from 'react-window';
import { ErrorBoundaryCore } from '../ErrorBoundary';
import ReadyFileItem from './ReadyFileItem';
import { Text } from '../ui/Typography';
import { joinPath } from '../../utils/platform';
import { UI_VIRTUALIZATION } from '../../../shared/constants';

// FIX L-2: Use centralized constants for virtualization
const DEFAULT_ROW_HEIGHT = UI_VIRTUALIZATION.FILE_GRID_ROW_HEIGHT;
// Use locally defined padding for better visual separation
const MEASUREMENT_PADDING = 32;
const ROW_HEIGHT_TOLERANCE = 12; // avoid reflows for small delta (component-specific)
const VIRTUALIZATION_THRESHOLD = UI_VIRTUALIZATION.THRESHOLD;

// Use dynamic column calculation that matches CSS grid-adaptive-lg behavior
// minmax(min(100%, 320px), 1fr) behavior in JS
const MIN_COLUMN_WIDTH = 320;

/**
 * Calculate how many columns to render based on container width
 * Used only for virtualized mode - non-virtualized uses CSS auto-fit
 */
const getColumnCount = (containerWidth) => {
  // Ensure at least one column, floor division gives us the number of full columns that fit
  const cols = Math.floor(containerWidth / MIN_COLUMN_WIDTH);
  return Math.max(1, cols);
};

/**
 * Virtualized row component that renders multiple file items per row
 */
const VirtualizedFileRow = memo(function VirtualizedFileRow({ index, style, data }) {
  const {
    files,
    columnsPerRow,
    selectedFiles = new Set(),
    toggleFileSelection,
    getFileWithEdits,
    editingFiles = {},
    findSmartFolderForCategory,
    getFileStateDisplay,
    handleEditFile,
    smartFolders = [],
    defaultLocation = '',
    onViewDetails
  } = data || {};
  const startIndex = index * columnsPerRow;
  const rowItems = [];

  if (!files) return null;

  for (let col = 0; col < columnsPerRow; col++) {
    const fileIndex = startIndex + col;
    // FIX: Strict bounds checking
    if (fileIndex >= files.length) break;

    const file = files[fileIndex];
    // FIX: Defensive check for undefined file
    if (!file) continue;

    const fileWithEdits = getFileWithEdits(file, fileIndex);
    const rawCategory = editingFiles[fileIndex]?.category || fileWithEdits.analysis?.category;
    const smartFolder = findSmartFolderForCategory(rawCategory);
    // CRITICAL FIX: Use the matched smart folder's actual name for the Select value
    // This ensures case-insensitive matching between analysis category and dropdown options
    const currentCategory = smartFolder?.name || rawCategory;
    const isSelected = selectedFiles.has(fileIndex);
    const stateDisplay = getFileStateDisplay(file.path, !!file.analysis);
    // FIX: Validate defaultLocation before joinPath to prevent invalid paths
    // An empty defaultLocation would produce paths like '/Finance' instead of 'C:\Users\...\Finance'
    const safeDefaultLocation = defaultLocation && defaultLocation.trim() ? defaultLocation : null;
    const destination = smartFolder
      ? smartFolder.path ||
        (safeDefaultLocation ? joinPath(safeDefaultLocation, smartFolder.name) : smartFolder.name)
      : safeDefaultLocation
        ? joinPath(safeDefaultLocation, rawCategory || 'Uncategorized')
        : rawCategory || 'Uncategorized';

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
    <div style={style} className="flex gap-8 pb-8 box-border">
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
  const safeFiles = useMemo(() => (Array.isArray(files) ? files : []), [files]);
  const safeSelectedFiles = useMemo(
    () => (selectedFiles instanceof Set ? selectedFiles : new Set()),
    [selectedFiles]
  );
  const safeEditingFiles = useMemo(
    () =>
      editingFiles && typeof editingFiles === 'object' && !Array.isArray(editingFiles)
        ? editingFiles
        : {},
    [editingFiles]
  );
  const safeSmartFolders = useMemo(
    () => (Array.isArray(smartFolders) ? smartFolders : []),
    [smartFolders]
  );
  const safeDefaultLocation = useMemo(
    () => (typeof defaultLocation === 'string' ? defaultLocation : ''),
    [defaultLocation]
  );

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
  const rowCount = Math.max(1, Math.ceil(safeFiles.length / columnsPerRow));
  const shouldVirtualize = safeFiles.length > VIRTUALIZATION_THRESHOLD;
  const columnWidthEstimate = useMemo(
    () => Math.max(320, Math.floor(dimensions.width / columnsPerRow) - 32),
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
  const shouldMeasure =
    shouldVirtualize && safeFiles.length > 0 && rowHeight === DEFAULT_ROW_HEIGHT;

  const sampleItem = useMemo(() => {
    if (!shouldVirtualize || safeFiles.length === 0) return null;
    const sampleIndex = 0;
    const file = safeFiles[sampleIndex];
    const fileWithEdits = getFileWithEdits(file, sampleIndex);
    const rawCategory = safeEditingFiles[sampleIndex]?.category || fileWithEdits.analysis?.category;
    const smartFolder = findSmartFolderForCategory(rawCategory);
    const currentCategory = smartFolder?.name || rawCategory;
    const stateDisplay = getFileStateDisplay(file.path, !!file.analysis);
    // FIX: Validate defaultLocation before joinPath to prevent invalid paths
    // An empty defaultLocation would produce paths like '/Finance' instead of 'C:\Users\...\Finance'
    const resolvedDefaultLocation =
      safeDefaultLocation && safeDefaultLocation.trim() ? safeDefaultLocation : null;
    const destination = smartFolder
      ? smartFolder.path ||
        (resolvedDefaultLocation
          ? joinPath(resolvedDefaultLocation, smartFolder.name)
          : smartFolder.name)
      : resolvedDefaultLocation
        ? joinPath(resolvedDefaultLocation, rawCategory || 'Uncategorized')
        : rawCategory || 'Uncategorized';

    return {
      file: fileWithEdits,
      index: sampleIndex,
      isSelected: safeSelectedFiles.has(sampleIndex),
      stateDisplay,
      smartFolder,
      currentCategory,
      destination
    };
  }, [
    shouldVirtualize,
    safeFiles,
    safeEditingFiles,
    findSmartFolderForCategory,
    getFileWithEdits,
    getFileStateDisplay,
    safeDefaultLocation,
    safeSelectedFiles
  ]);

  // react-window List passes shared data via rowProps (consumed by the row renderer).
  const rowProps = useMemo(
    () => ({
      data: {
        files: safeFiles,
        columnsPerRow,
        selectedFiles: safeSelectedFiles,
        toggleFileSelection,
        getFileWithEdits,
        editingFiles: safeEditingFiles,
        findSmartFolderForCategory,
        getFileStateDisplay,
        handleEditFile,
        smartFolders: safeSmartFolders,
        defaultLocation: safeDefaultLocation,
        onViewDetails
      }
    }),
    [
      safeFiles,
      columnsPerRow,
      safeSelectedFiles,
      toggleFileSelection,
      getFileWithEdits,
      safeEditingFiles,
      findSmartFolderForCategory,
      getFileStateDisplay,
      handleEditFile,
      safeSmartFolders,
      safeDefaultLocation,
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
      <div ref={containerRef} className="relative w-full h-full p-8">
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
        <Text
          as="div"
          variant="tiny"
          className="text-system-gray-500 mb-2 absolute top-0 right-0 z-10 bg-white/80 px-2 py-1 rounded backdrop-blur-sm"
        >
          Showing {safeFiles.length} files
        </Text>
        <List
          key={`list-${rowHeight}-${columnsPerRow}-${safeFiles.length}`}
          rowCount={rowCount}
          rowHeight={rowHeight}
          rowComponent={VirtualizedFileRow}
          rowProps={rowProps}
          overscanCount={2}
          className="scrollbar-thin scrollbar-thumb-system-gray-300 scrollbar-track-transparent"
          style={{ height: listHeight, width: dimensions.width }}
        />
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
      className="grid grid-adaptive-lg gap-8 h-full overflow-y-auto modern-scrollbar p-8"
    >
      {safeFiles.map((file, index) => {
        const fileWithEdits = getFileWithEdits(file, index);
        const rawCategory = safeEditingFiles[index]?.category || fileWithEdits.analysis?.category;
        const smartFolder = findSmartFolderForCategory(rawCategory);
        // CRITICAL FIX: Use the matched smart folder's actual name for the Select value
        // This ensures case-insensitive matching between analysis category and dropdown options
        const currentCategory = smartFolder?.name || rawCategory;
        const isSelected = safeSelectedFiles.has(index);
        const stateDisplay = getFileStateDisplay(file.path, !!file.analysis);
        const resolvedDefaultLocation =
          safeDefaultLocation && safeDefaultLocation.trim() ? safeDefaultLocation : null;
        const destination = smartFolder
          ? smartFolder.path ||
            (resolvedDefaultLocation
              ? joinPath(resolvedDefaultLocation, smartFolder.name)
              : smartFolder.name)
          : resolvedDefaultLocation
            ? joinPath(resolvedDefaultLocation, rawCategory || 'Uncategorized')
            : rawCategory || 'Uncategorized';
        return (
          <ReadyFileItem
            key={file.path}
            file={fileWithEdits}
            index={index}
            isSelected={isSelected}
            onToggleSelected={toggleFileSelection}
            stateDisplay={stateDisplay}
            smartFolders={safeSmartFolders}
            editing={safeEditingFiles[index]}
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

const MemoizedVirtualizedFileGrid = memo(VirtualizedFileGrid);

export default function VirtualizedFileGridWithErrorBoundary(props) {
  return (
    <ErrorBoundaryCore contextName="File Grid" variant="simple">
      <MemoizedVirtualizedFileGrid {...props} />
    </ErrorBoundaryCore>
  );
}
