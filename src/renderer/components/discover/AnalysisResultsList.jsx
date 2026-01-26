import React, { memo, useMemo, useCallback, useState, useEffect, Component } from 'react';
import PropTypes from 'prop-types';
import { useSelector } from 'react-redux';
import { List } from 'react-window';
import { FileText, Compass, AlertTriangle, Eye, FolderOpen, Trash2 } from 'lucide-react';
import { Button, StatusBadge, Card, IconButton } from '../ui';
import { logger } from '../../../shared/logger';
import { UI_VIRTUALIZATION } from '../../../shared/constants';
import { formatDisplayPath } from '../../utils/pathDisplay';
import { Text } from '../ui/Typography';

class AnalysisResultsErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    logger.error('AnalysisResultsList error boundary caught error', {
      error: error?.message || String(error),
      componentStack: errorInfo?.componentStack
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-stratosort-danger/10 border border-stratosort-danger/30 rounded-lg">
          <div className="flex items-center gap-2 text-stratosort-danger">
            <AlertTriangle className="w-5 h-5" />
            <span className="font-medium">Failed to render analysis results</span>
          </div>
          <p className="mt-2 text-sm text-stratosort-danger">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try Again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

AnalysisResultsErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired
};

const ITEM_HEIGHT = UI_VIRTUALIZATION.ANALYSIS_RESULTS_ITEM_HEIGHT;
const VIRTUALIZATION_THRESHOLD = UI_VIRTUALIZATION.THRESHOLD;

const formatConfidence = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const normalized = value < 1 ? value * 100 : value;
  const clamped = Math.min(100, Math.max(0, normalized));
  return Math.round(clamped);
};

const AnalysisResultRow = memo(function AnalysisResultRow({ index, style, data }) {
  if (!data || !data.items) return null;
  const { items, handleAction, getFileStateDisplay, redactPaths } = data;

  if (!Array.isArray(items) || index < 0 || index >= items.length) return null;

  const file = items[index];
  if (!file) return null;
  const displayPath = formatDisplayPath(file.path || '', {
    redact: Boolean(redactPaths),
    segments: 2
  });

  let stateDisplay = { label: 'Unknown', icon: null, color: '', spinning: false };
  try {
    stateDisplay = getFileStateDisplay
      ? getFileStateDisplay(file.path, !!file.analysis)
      : stateDisplay;
  } catch (err) {
    stateDisplay = { label: 'Error', icon: null, color: 'text-stratosort-danger', spinning: false };
  }

  const displayColor = stateDisplay?.color || '';

  const confidence = formatConfidence(file.analysis?.confidence);
  const tone = displayColor.includes('green')
    ? 'success'
    : displayColor.includes('amber') || displayColor.includes('warning')
      ? 'warning'
      : displayColor.includes('red') || displayColor.includes('danger')
        ? 'error'
        : 'info';

  const keywords = file.analysis?.keywords || [];

  return (
    <div style={style} className="px-2 py-2">
      <Card
        variant="interactive"
        className="flex items-center p-3 gap-3 h-full group transition-all duration-200 hover:border-stratosort-blue/30"
        onClick={() => handleAction && handleAction('open', file.path)}
      >
        {/* Icon */}
        <div className="p-2 bg-system-gray-50 rounded-lg shrink-0 text-system-gray-500 group-hover:bg-stratosort-blue/5 group-hover:text-stratosort-blue transition-colors">
          <FileText className="w-5 h-5" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
          <div className="flex items-center gap-2">
            <Text variant="body" className="font-medium text-system-gray-900 truncate">
              {file.name || 'Unknown File'}
            </Text>
            <StatusBadge
              variant={tone}
              size="sm"
              className="px-1.5 py-0.5 text-[10px] h-5 border-0 bg-opacity-50"
            >
              <span className={stateDisplay?.spinning ? 'animate-spin mr-1' : 'mr-1'}>
                {stateDisplay?.icon}
              </span>
              {stateDisplay?.label || 'Status'}
            </StatusBadge>
            {confidence !== null && (
              <Text variant="tiny" className="text-system-gray-400">
                {confidence}%
              </Text>
            )}
          </div>

          <div className="flex items-center gap-2 text-system-gray-500">
            <Text variant="tiny" className="truncate max-w-[300px]" title={displayPath}>
              {displayPath}
            </Text>
            {file.analysis?.category && (
              <>
                <span className="w-1 h-1 rounded-full bg-system-gray-300" />
                <span className="text-[10px] px-1.5 py-0.5 bg-system-gray-100 rounded-md text-system-gray-600 font-medium border border-system-gray-200">
                  {file.analysis.category}
                </span>
              </>
            )}
            {keywords.length > 0 && (
              <span className="text-[10px] text-system-gray-400 truncate max-w-[150px]">
                {keywords.join(', ')}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          <IconButton
            icon={<Eye className="w-4 h-4" />}
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              handleAction && handleAction('open', file.path);
            }}
            title="Open File"
          />
          <IconButton
            icon={<FolderOpen className="w-4 h-4" />}
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              handleAction && handleAction('reveal', file.path);
            }}
            title="Reveal in Folder"
          />
          <IconButton
            icon={<Trash2 className="w-4 h-4" />}
            size="sm"
            variant="ghost"
            className="text-stratosort-danger hover:bg-stratosort-danger/10 hover:text-stratosort-danger"
            onClick={(e) => {
              e.stopPropagation();
              handleAction && handleAction('remove', file.path);
            }}
            title="Remove from List"
          />
        </div>
      </Card>
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
    redactPaths: PropTypes.bool
  }).isRequired
};

function AnalysisResultsList({ results = [], onFileAction, getFileStateDisplay }) {
  const redactPaths = useSelector((state) => Boolean(state?.system?.redactPaths));
  const safeResults = useMemo(() => {
    if (!Array.isArray(results)) return [];
    return results.filter((r) => r && typeof r === 'object' && (r.path || r.name));
  }, [results]);

  const isEmpty = safeResults.length === 0;
  const items = safeResults;
  const handleAction = useCallback((action, path) => onFileAction(action, path), [onFileAction]);

  const [containerNode, setContainerNode] = useState(null);
  const containerRef = useCallback((node) => {
    setContainerNode(node);
  }, []);
  const [dimensions, setDimensions] = useState({ width: 0, height: 600 });

  useEffect(() => {
    if (!containerNode) return undefined;

    const ResizeObserverCtor =
      typeof ResizeObserver !== 'undefined'
        ? ResizeObserver
        : typeof window !== 'undefined'
          ? window.ResizeObserver
          : undefined;

    if (!ResizeObserverCtor) {
      const updateDimensions = () => {
        setDimensions({
          width: containerNode.offsetWidth || 0,
          height:
            containerNode.offsetHeight ||
            (typeof window !== 'undefined' ? window.innerHeight * 0.6 : 600)
        });
      };
      updateDimensions();
      if (typeof window !== 'undefined') {
        window.addEventListener('resize', updateDimensions);
        return () => {
          window.removeEventListener('resize', updateDimensions);
        };
      }
      return undefined;
    }

    const observer = new ResizeObserverCtor((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setDimensions({
          width: width || 0,
          height: height || (typeof window !== 'undefined' ? window.innerHeight * 0.6 : 600)
        });
      }
    });

    observer.observe(containerNode);
    return () => observer.disconnect();
  }, [containerNode]);

  const rowProps = useMemo(
    () => ({
      data: {
        items,
        handleAction,
        getFileStateDisplay,
        redactPaths
      }
    }),
    [items, handleAction, getFileStateDisplay, redactPaths]
  );
  const safeRowProps = rowProps ?? {};
  const listItemData = safeRowProps.data || {
    items: [],
    handleAction,
    getFileStateDisplay,
    redactPaths
  };

  const shouldVirtualize = items.length > VIRTUALIZATION_THRESHOLD;
  const listContainerClass = `w-full h-full modern-scrollbar overflow-y-auto flex flex-col gap-4`;

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center p-8">
        <div className="w-16 h-16 bg-system-gray-100 rounded-full flex items-center justify-center mb-4">
          <Compass className="w-8 h-8 text-system-gray-400" />
        </div>
        <Text variant="body" className="font-medium text-system-gray-900">
          No analysis results yet
        </Text>
        <Text variant="small" className="text-system-gray-500 max-w-sm mt-1">
          Add files above and start an analysis to see suggestions stream in.
        </Text>
      </div>
    );
  }

  if (shouldVirtualize) {
    return (
      <div ref={containerRef} className="relative w-full h-full">
        <Text
          as="div"
          variant="tiny"
          className="absolute top-2 right-4 z-10 bg-white/90 px-2 py-1 rounded text-system-gray-500 border border-border-soft backdrop-blur-sm shadow-sm"
        >
          Showing {items.length} files
        </Text>
        <List
          key={`list-${items.length}`}
          rowCount={items.length}
          rowHeight={ITEM_HEIGHT}
          rowComponent={AnalysisResultRow}
          rowProps={rowProps}
          overscanCount={5}
          className="scrollbar-thin scrollbar-thumb-system-gray-300 scrollbar-track-transparent"
          style={{ height: dimensions.height, width: '100%' }}
        />
      </div>
    );
  }

  return (
    <div className={`${listContainerClass} p-4`}>
      {items.map((file, index) => (
        <AnalysisResultRow
          key={file.path || file.id || index}
          index={index}
          style={{}}
          data={listItemData}
        />
      ))}
    </div>
  );
}

AnalysisResultsList.propTypes = {
  results: PropTypes.arrayOf(PropTypes.object),
  onFileAction: PropTypes.func.isRequired,
  getFileStateDisplay: PropTypes.func.isRequired
};

const MemoizedAnalysisResultsList = memo(AnalysisResultsList);

function AnalysisResultsListWithErrorBoundary(props) {
  return (
    <AnalysisResultsErrorBoundary>
      <MemoizedAnalysisResultsList {...props} />
    </AnalysisResultsErrorBoundary>
  );
}

AnalysisResultsListWithErrorBoundary.propTypes = AnalysisResultsList.propTypes;

export default AnalysisResultsListWithErrorBoundary;
