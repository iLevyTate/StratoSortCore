import React, { memo, useMemo, useCallback, useState, useEffect, Component } from 'react';
import PropTypes from 'prop-types';
import { useDispatch, useSelector } from 'react-redux';
import { List } from 'react-window';
import {
  FileText,
  Compass,
  AlertTriangle,
  Eye,
  FolderOpen,
  Trash2,
  Database,
  Globe,
  Ban,
  RefreshCw
} from 'lucide-react';
import { Button, StatusBadge, Card, IconButton, StateMessage } from '../ui';
import { logger } from '../../../shared/logger';
import { UI_VIRTUALIZATION } from '../../../shared/constants';
import { formatDisplayPath } from '../../utils/pathDisplay';
import { Text } from '../ui/Typography';
import { selectRedactPaths } from '../../store/selectors';
import { setEmbeddingPolicyForFile } from '../../store/thunks/fileThunks';

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
        <StateMessage
          icon={AlertTriangle}
          tone="error"
          variant="card"
          align="left"
          size="sm"
          title="Failed to render analysis results"
          description={this.state.error?.message || 'An unexpected error occurred'}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Try Again
            </Button>
          }
          className="p-4"
          role="alert"
        />
      );
    }
    return this.props.children;
  }
}

AnalysisResultsErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired
};

const ITEM_HEIGHT = UI_VIRTUALIZATION.ANALYSIS_RESULTS_ITEM_HEIGHT;
const ITEM_GAP = UI_VIRTUALIZATION.ANALYSIS_RESULTS_ITEM_GAP ?? 16;
const VIRTUALIZATION_THRESHOLD = UI_VIRTUALIZATION.THRESHOLD;

const formatConfidence = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const normalized = value < 1 ? value * 100 : value;
  const clamped = Math.min(100, Math.max(0, normalized));
  return Math.round(clamped);
};

const AnalysisResultRow = memo(function AnalysisResultRow({ index, style, data }) {
  const dispatch = useDispatch();
  if (!data || !data.items) return null;
  const {
    items,
    handleAction,
    getFileStateDisplay,
    redactPaths,
    isVirtualized,
    defaultEmbeddingPolicy
  } = data;

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
  } catch {
    stateDisplay = { label: 'Error', icon: null, color: 'text-stratosort-danger', spinning: false };
  }

  const displayColor = stateDisplay?.color || '';

  const confidence = formatConfidence(file.analysis?.confidence);
  const embeddingPolicy =
    file.embeddingPolicy || file.analysis?.embeddingPolicy || defaultEmbeddingPolicy || 'embed';
  const nextEmbeddingPolicy =
    embeddingPolicy === 'embed' ? 'web_only' : embeddingPolicy === 'web_only' ? 'skip' : 'embed';
  const policyLabel =
    embeddingPolicy === 'embed'
      ? 'Embed locally'
      : embeddingPolicy === 'web_only'
        ? 'Web-only'
        : 'Skip embedding';
  const PolicyIcon =
    embeddingPolicy === 'embed' ? Database : embeddingPolicy === 'web_only' ? Globe : Ban;
  const tone = displayColor.includes('green')
    ? 'success'
    : displayColor.includes('amber') || displayColor.includes('warning')
      ? 'warning'
      : displayColor.includes('red') || displayColor.includes('danger')
        ? 'error'
        : 'info';

  const keywords = file.analysis?.keywords || [];
  const displayKeywords =
    keywords.slice(0, 10).join(', ') +
    (keywords.length > 10 ? ` (+${keywords.length - 10} more)` : '');
  const fullKeywords = keywords.slice(0, 50).join(', ') + (keywords.length > 50 ? '...' : '');

  const rowStyle =
    isVirtualized && style
      ? {
          ...style,
          paddingBottom: ITEM_GAP,
          boxSizing: 'border-box'
        }
      : style;

  return (
    <div style={rowStyle} className="px-cozy">
      <Card
        variant="interactive"
        className="flex items-start p-3 gap-3 h-full group transition-all duration-200 hover:border-stratosort-blue/30 overflow-hidden"
        onClick={() => handleAction && handleAction('open', file.path)}
      >
        {/* Icon */}
        <div className="p-2 bg-system-gray-50 rounded-lg shrink-0 text-system-gray-500 group-hover:bg-stratosort-blue/5 group-hover:text-stratosort-blue transition-colors">
          <FileText className="w-5 h-5" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
          <div className="flex flex-wrap items-start gap-2 sm:gap-3">
            <Text
              variant="body"
              className="font-medium text-system-gray-900 truncate flex-1 min-w-[180px]"
            >
              {file.name || 'Unknown File'}
            </Text>
            <div className="flex items-center gap-2 flex-shrink-0 whitespace-nowrap">
              <StatusBadge
                variant={tone}
                size="sm"
                title={stateDisplay?.label || 'Status'}
                className="px-1.5 py-0.5 text-[10px] h-5 border-0 bg-opacity-50 inline-flex items-center gap-1 whitespace-nowrap"
              >
                <span className={stateDisplay?.spinning ? 'animate-spin' : ''}>
                  {stateDisplay?.icon}
                </span>
                {stateDisplay?.label || 'Status'}
              </StatusBadge>
              {confidence !== null && (
                <Text
                  variant="tiny"
                  className="text-system-gray-500 font-medium whitespace-nowrap"
                  title={`Confidence ${confidence}%`}
                >
                  Conf. {confidence}%
                </Text>
              )}
              <Text
                variant="tiny"
                className="text-system-gray-400 font-medium whitespace-nowrap"
                title={`Embedding policy: ${policyLabel}`}
              >
                {embeddingPolicy === 'embed'
                  ? 'Embed: Local'
                  : embeddingPolicy === 'web_only'
                    ? 'Embed: Web-only'
                    : 'Embed: Off'}
              </Text>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-system-gray-500">
            <Text variant="tiny" className="truncate flex-[2_1_240px] min-w-0" title={displayPath}>
              {displayPath}
            </Text>
            {file.analysis?.category && (
              <>
                <span className="w-1 h-1 rounded-full bg-system-gray-300" />
                <span
                  className="text-[10px] px-1.5 py-0.5 bg-system-gray-100 rounded-md text-system-gray-600 font-medium border border-system-gray-200 whitespace-nowrap"
                  title={`Category: ${file.analysis.category}`}
                >
                  Category: {file.analysis.category}
                </span>
              </>
            )}
            {keywords.length > 0 && (
              <span
                className="text-[10px] text-system-gray-400 truncate flex-1 min-w-[120px] max-w-full sm:max-w-[200px]"
                title={`Keywords: ${fullKeywords}`}
              >
                Keywords: {displayKeywords}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          <IconButton
            icon={<RefreshCw className="w-4 h-4" />}
            size="sm"
            variant="ghost"
            disabled={!file.path}
            onClick={(e) => {
              e.stopPropagation();
              handleAction && handleAction('reanalyze', file.path);
            }}
            title={file.path ? 'Reanalyze File' : 'Reanalyze unavailable'}
            aria-label="Reanalyze file"
          />
          <IconButton
            icon={<PolicyIcon className="w-4 h-4" />}
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              dispatch(setEmbeddingPolicyForFile(file.path, nextEmbeddingPolicy));
            }}
            title={`Embedding policy: ${policyLabel}. Click to set: ${
              nextEmbeddingPolicy === 'embed'
                ? 'Embed locally'
                : nextEmbeddingPolicy === 'web_only'
                  ? 'Web-only'
                  : 'Skip'
            }`}
            aria-label="Change embedding policy"
          />
          <IconButton
            icon={<Eye className="w-4 h-4" />}
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              handleAction && handleAction('open', file.path);
            }}
            title="Open File"
            aria-label="Open file"
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
            aria-label="Reveal in folder"
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
            aria-label="Remove from list"
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
    redactPaths: PropTypes.bool,
    isVirtualized: PropTypes.bool,
    defaultEmbeddingPolicy: PropTypes.string
  }).isRequired
};

function AnalysisResultsList({ results = [], onFileAction, getFileStateDisplay }) {
  // PERF: Use memoized selector instead of inline Boolean coercion
  const redactPaths = useSelector(selectRedactPaths);
  const settings = useSelector((state) => state.ui?.settings);
  const defaultEmbeddingPolicy = useMemo(() => {
    const candidate = settings?.defaultEmbeddingPolicy;
    return candidate === 'embed' || candidate === 'skip' || candidate === 'web_only'
      ? candidate
      : 'embed';
  }, [settings]);
  const safeResults = useMemo(() => {
    if (!Array.isArray(results)) return [];
    return results.filter((r) => r && typeof r === 'object' && (r.path || r.name));
  }, [results]);

  const isEmpty = safeResults.length === 0;
  const items = safeResults;
  const handleAction = onFileAction;

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

    let rafId = null;
    const observer = new ResizeObserverCtor((entries) => {
      const entry = entries[0];
      if (entry) {
        // Defer state update to avoid 'ResizeObserver loop limit exceeded' errors
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          const { width, height } = entry.contentRect;
          setDimensions({
            width: width || 0,
            height: height || (typeof window !== 'undefined' ? window.innerHeight * 0.6 : 600)
          });
        });
      }
    });

    observer.observe(containerNode);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [containerNode]);

  const shouldVirtualize = items.length > VIRTUALIZATION_THRESHOLD;

  const rowProps = useMemo(
    () => ({
      data: {
        items,
        handleAction,
        getFileStateDisplay,
        redactPaths,
        isVirtualized: shouldVirtualize,
        defaultEmbeddingPolicy
      }
    }),
    [
      items,
      handleAction,
      getFileStateDisplay,
      redactPaths,
      shouldVirtualize,
      defaultEmbeddingPolicy
    ]
  );
  const safeRowProps = rowProps ?? {};
  const listItemData = safeRowProps.data || {
    items: [],
    handleAction,
    getFileStateDisplay,
    redactPaths,
    defaultEmbeddingPolicy
  };

  const listContainerClass = `w-full h-full modern-scrollbar overflow-y-auto overflow-x-hidden flex flex-col gap-default`;

  if (isEmpty) {
    return (
      <StateMessage
        icon={Compass}
        title="No analysis results yet"
        description="Add files above and start an analysis to see suggestions stream in."
        size="lg"
        className="h-64 flex items-center justify-center px-relaxed"
        contentClassName="max-w-sm"
      />
    );
  }

  if (shouldVirtualize) {
    return (
      <div ref={containerRef} className="relative w-full h-full overflow-x-hidden">
        <Text
          as="div"
          variant="tiny"
          className="absolute top-2 right-4 z-10 bg-white/90 px-2 py-1 rounded text-system-gray-500 border border-border-soft backdrop-blur-sm shadow-sm"
        >
          Showing {items.length} files
        </Text>
        <List
          itemCount={items.length}
          itemSize={ITEM_HEIGHT + ITEM_GAP}
          itemData={listItemData}
          overscanCount={5}
          height={dimensions.height || 600}
          width="100%"
          className="scrollbar-thin scrollbar-thumb-system-gray-300 scrollbar-track-transparent"
        >
          {AnalysisResultRow}
        </List>
      </div>
    );
  }

  return (
    <div className={`${listContainerClass} p-default`}>
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
