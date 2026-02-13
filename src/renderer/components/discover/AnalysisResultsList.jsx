import React, {
  memo,
  useMemo,
  useCallback,
  useState,
  useEffect,
  useRef,
  useLayoutEffect,
  Component
} from 'react';
import { createPortal } from 'react-dom';
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
  RefreshCw,
  MoreVertical
} from 'lucide-react';
import { Button, StatusBadge, Card, IconButton, StateMessage } from '../ui';
import { logger } from '../../../shared/logger';
import { UI_VIRTUALIZATION } from '../../../shared/constants';
import { formatDisplayPath } from '../../utils/pathDisplay';
import { Text } from '../ui/Typography';
import { selectRedactPaths, selectDefaultEmbeddingPolicy } from '../../store/selectors';
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
      if (typeof this.props.fallbackRender === 'function') {
        const fallbackNode = this.props.fallbackRender(this.state.error);
        if (fallbackNode) return fallbackNode;
      }
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
  children: PropTypes.node.isRequired,
  fallbackRender: PropTypes.func
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
  const actionButtonRef = useRef(null);
  const menuRef = useRef(null);
  const lastFocusedElementRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  const updateMenuPosition = useCallback(() => {
    if (!actionButtonRef.current) return;
    const rect = actionButtonRef.current.getBoundingClientRect();
    setMenuPosition({ top: rect.bottom + 4, left: rect.right - 160 });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    updateMenuPosition();
    let rafId = null;
    const scheduleUpdate = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateMenuPosition();
      });
    };
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);
    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
    };
  }, [menuOpen, updateMenuPosition]);

  useEffect(() => {
    if (!menuOpen) return;
    const actionButtonElement = actionButtonRef.current;
    lastFocusedElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusMenuRaf = requestAnimationFrame(() => {
      const firstMenuItem = menuRef.current?.querySelector('[role="menuitem"]');
      firstMenuItem?.focus();
    });
    const handleClickOutside = (e) => {
      const target = e.target;
      if (
        actionButtonRef.current &&
        !actionButtonRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setMenuOpen(false);
      }
    };
    const handleEscape = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('keydown', handleEscape);
    return () => {
      cancelAnimationFrame(focusMenuRaf);
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('keydown', handleEscape);
      const triggerButton = actionButtonElement?.querySelector('button');
      if (triggerButton instanceof HTMLElement) {
        triggerButton.focus();
      } else if (lastFocusedElementRef.current instanceof HTMLElement) {
        lastFocusedElementRef.current.focus();
      }
    };
  }, [menuOpen]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const stopPropAnd = useCallback(
    (fn) => (e) => {
      e.stopPropagation();
      fn?.();
      closeMenu();
    },
    [closeMenu]
  );

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
  const pathTooltip = redactPaths ? displayPath : file.path || '';

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

  const menuContent =
    menuOpen &&
    typeof document !== 'undefined' &&
    document.body &&
    createPortal(
      <div
        ref={menuRef}
        role="menu"
        className="fixed z-overlay bg-white border border-border-soft rounded-lg shadow-lg min-w-[160px] py-1 animate-dropdown-enter"
        style={{
          top: `${menuPosition.top}px`,
          left: `${menuPosition.left}px`
        }}
      >
        <button
          type="button"
          role="menuitem"
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-system-gray-700 hover:bg-system-gray-50 disabled:opacity-50"
          onClick={stopPropAnd(() => handleAction?.('reanalyze', file.path))}
          disabled={!file.path}
        >
          <RefreshCw className="w-4 h-4 shrink-0" />
          Reanalyze File
        </button>
        <button
          type="button"
          role="menuitem"
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-system-gray-700 hover:bg-system-gray-50"
          onClick={stopPropAnd(() =>
            dispatch(setEmbeddingPolicyForFile(file.path, nextEmbeddingPolicy))
          )}
        >
          <PolicyIcon className="w-4 h-4 shrink-0" />
          {policyLabel === 'Embed locally'
            ? 'Set: Web-only'
            : policyLabel === 'Web-only'
              ? 'Set: Skip'
              : 'Set: Embed locally'}
        </button>
        <button
          type="button"
          role="menuitem"
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-system-gray-700 hover:bg-system-gray-50"
          onClick={stopPropAnd(() => handleAction?.('open', file.path))}
        >
          <Eye className="w-4 h-4 shrink-0" />
          Open File
        </button>
        <button
          type="button"
          role="menuitem"
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-system-gray-700 hover:bg-system-gray-50"
          onClick={stopPropAnd(() => handleAction?.('reveal', file.path))}
        >
          <FolderOpen className="w-4 h-4 shrink-0" />
          Reveal in Folder
        </button>
        <button
          type="button"
          role="menuitem"
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-stratosort-danger hover:bg-stratosort-danger/10"
          onClick={stopPropAnd(() => handleAction?.('remove', file.path))}
        >
          <Trash2 className="w-4 h-4 shrink-0" />
          Remove from List
        </button>
      </div>,
      document.body
    );

  return (
    <div style={rowStyle} className="px-cozy">
      <Card
        variant="interactive"
        className="flex items-start p-3 gap-3 h-full group transition-all duration-200 hover:border-stratosort-blue/30 overflow-visible hover:scale-100"
        onClick={() => {
          const selectedText =
            typeof window !== 'undefined' ? window.getSelection?.()?.toString() : '';
          if (selectedText && selectedText.trim().length > 0) return;
          handleAction?.('open', file.path);
        }}
      >
        {/* Icon */}
        <div className="p-2 bg-system-gray-50 rounded-lg shrink-0 text-system-gray-500 group-hover:bg-stratosort-blue/5 group-hover:text-stratosort-blue transition-colors">
          <FileText className="w-5 h-5" />
        </div>

        {/* Content - flex-1 min-w-0 allows shrinking, more room for path/keywords */}
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5 overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Text variant="body" className="font-medium text-system-gray-900 truncate min-w-0">
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
                className="text-system-gray-400 font-medium whitespace-nowrap hidden sm:inline"
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

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-system-gray-500 min-w-0">
            <Text variant="tiny" className="truncate min-w-0 flex-1 basis-0" title={pathTooltip}>
              {displayPath}
            </Text>
            {file.analysis?.category && (
              <>
                <span className="w-1 h-1 rounded-full bg-system-gray-300 flex-shrink-0" />
                <span
                  className="text-[10px] px-1.5 py-0.5 bg-system-gray-100 rounded-md text-system-gray-600 font-medium border border-system-gray-200 whitespace-nowrap flex-shrink-0"
                  title={`Category: ${file.analysis.category}`}
                >
                  Category: {file.analysis.category}
                </span>
              </>
            )}
            {keywords.length > 0 && (
              <span
                className="text-[10px] text-system-gray-400 truncate min-w-0 max-w-full"
                title={`Keywords: ${fullKeywords}`}
              >
                Keywords: {displayKeywords}
              </span>
            )}
          </div>
        </div>

        {/* Actions - single overflow menu, no layout shift */}
        <div ref={actionButtonRef} className="shrink-0 pl-1">
          <IconButton
            icon={<MoreVertical className="w-4 h-4" />}
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((prev) => {
                const next = !prev;
                if (next) {
                  updateMenuPosition();
                }
                return next;
              });
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMenuOpen(true);
              }
            }}
            title="Actions"
            aria-label="File actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          />
        </div>
      </Card>
      {menuContent}
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

function AnalysisResultsList({
  results = [],
  onFileAction,
  getFileStateDisplay,
  forceDisableVirtualization = false
}) {
  // PERF: Use memoized selector instead of inline Boolean coercion
  const redactPaths = useSelector(selectRedactPaths);
  const defaultEmbeddingPolicy = useSelector(selectDefaultEmbeddingPolicy);
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

  const shouldVirtualize = !forceDisableVirtualization && items.length > VIRTUALIZATION_THRESHOLD;

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
          rowCount={items.length}
          rowHeight={ITEM_HEIGHT + ITEM_GAP}
          rowComponent={AnalysisResultRow}
          rowProps={safeRowProps}
          overscanCount={5}
          style={{ height: dimensions.height || 600, width: '100%' }}
          className="scrollbar-thin scrollbar-thumb-system-gray-300 scrollbar-track-transparent"
        />
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
  getFileStateDisplay: PropTypes.func.isRequired,
  forceDisableVirtualization: PropTypes.bool
};

const MemoizedAnalysisResultsList = memo(AnalysisResultsList);

function AnalysisResultsListWithErrorBoundary(props) {
  return (
    <AnalysisResultsErrorBoundary
      fallbackRender={(error) => (
        <div className="space-y-default">
          <StateMessage
            icon={AlertTriangle}
            tone="warning"
            variant="card"
            align="left"
            size="sm"
            title="Virtualized list failed, switched to compatibility mode"
            description={error?.message || 'Using non-virtualized rendering for this session.'}
            className="p-4"
            role="alert"
          />
          <MemoizedAnalysisResultsList {...props} forceDisableVirtualization />
        </div>
      )}
    >
      <MemoizedAnalysisResultsList {...props} />
    </AnalysisResultsErrorBoundary>
  );
}

AnalysisResultsListWithErrorBoundary.propTypes = AnalysisResultsList.propTypes;

export default AnalysisResultsListWithErrorBoundary;
