import React, { memo, useMemo, useCallback, useState, useEffect, Component } from 'react';
import PropTypes from 'prop-types';
import { useSelector } from 'react-redux';
import { List } from 'react-window';
import { FileText, Compass, AlertTriangle } from 'lucide-react';
import { Button, StatusBadge } from '../ui';
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
      <div className="bg-white rounded-lg border border-border-soft p-4 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-start gap-4">
          <div className="p-2 bg-system-gray-50 rounded-lg shrink-0">
            <FileText className="w-5 h-5 text-system-gray-500" />
          </div>
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center justify-between gap-4 mb-1">
              <Text
                variant="small"
                className="font-medium text-system-gray-900 truncate"
                title={file.name}
              >
                {file.name || 'Unknown File'}
              </Text>
              <div className="flex items-center gap-2 shrink-0">
                {confidence !== null && (
                  <Text variant="tiny" className="text-system-gray-500">
                    {confidence}%
                  </Text>
                )}
                <StatusBadge variant={tone} size="sm">
                  <span className={stateDisplay?.spinning ? 'animate-spin mr-1' : 'mr-1'}>
                    {stateDisplay?.icon}
                  </span>
                  {stateDisplay?.label || 'Status'}
                </StatusBadge>
              </div>
            </div>

            <Text variant="tiny" className="text-system-gray-500 truncate mb-2" title={displayPath}>
              {displayPath}
            </Text>

            {file.analysis?.category && (
              <div className="flex items-center gap-2 mb-2">
                <Text variant="tiny" className="text-system-gray-500">
                  Category:
                </Text>
                <Text
                  as="span"
                  variant="tiny"
                  className="font-medium text-stratosort-blue bg-stratosort-blue/5 px-1.5 py-0.5 rounded"
                >
                  {file.analysis.category}
                </Text>
              </div>
            )}

            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {keywords.slice(0, 5).map((tag, i) => (
                  <Text
                    as="span"
                    variant="tiny"
                    key={i}
                    className="px-1.5 py-0.5 bg-system-gray-50 text-system-gray-600 rounded border border-system-gray-100"
                  >
                    {tag}
                  </Text>
                ))}
                {keywords.length > 5 && (
                  <Text as="span" variant="tiny" className="px-1.5 py-0.5 text-system-gray-400">
                    +{keywords.length - 5}
                  </Text>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-soft/50">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleAction && handleAction('open', file.path)}
          >
            Open
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleAction && handleAction('reveal', file.path)}
          >
            Reveal
          </Button>
          <div className="w-px h-4 bg-border-soft mx-1" />
          <Button
            size="sm"
            variant="ghost"
            className="text-stratosort-danger hover:text-stratosort-danger hover:bg-stratosort-danger/10"
            onClick={() => handleAction && handleAction('remove', file.path)}
          >
            Remove
          </Button>
        </div>
      </div>
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
  const listContainerClass = `w-full h-full modern-scrollbar overflow-y-auto flex flex-col gap-2`;

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
