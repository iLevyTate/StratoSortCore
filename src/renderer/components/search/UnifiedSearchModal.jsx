import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import 'reactflow/dist/style.css';
import {
  AlertTriangle,
  ExternalLink,
  FolderOpen,
  FolderInput,
  RefreshCw,
  Search as SearchIcon,
  Copy,
  Network,
  List,
  FileText,
  LayoutGrid,
  CheckSquare,
  Square,
  MessageSquare,
  Sparkles,
  Layers,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  Maximize2,
  Minimize2,
  HelpCircle
} from 'lucide-react';

import Modal, { ConfirmModal } from '../Modal';
import { ModalLoadingOverlay } from '../LoadingSkeleton';
import { Button, Input, StateMessage } from '../ui';
import HighlightedText from '../ui/HighlightedText';
import { getFileCategory } from '../ui/FileIcon';
import { TIMEOUTS } from '../../../shared/performanceConstants';
import { logger } from '../../../shared/logger';
import { GRAPH_FEATURE_FLAGS } from '../../../shared/featureFlags';
import { safeBasename } from '../../utils/pathUtils';
import { formatDisplayPath } from '../../utils/pathDisplay';
import { scoreToOpacity, clamp01 } from '../../utils/scoreUtils';
import { makeQueryNodeId, defaultNodePosition } from '../../utils/graphUtils';
import {
  elkLayout,
  debouncedElkLayout,
  cancelPendingLayout,
  smartLayout,
  clusterRadialLayout,
  clusterExpansionLayout,
  LARGE_GRAPH_THRESHOLD
} from '../../utils/elkLayout';
import ClusterNode from './ClusterNode';
import FileNode from './nodes/FileNode';
import FolderNode from './nodes/FolderNode';
import QueryNode from './nodes/QueryNode';
import { useGraphState, useGraphKeyboardNav, useFileActions } from '../../hooks';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { toggleSettings } from '../../store/slices/uiSlice';
import SimilarityEdge from './SimilarityEdge';
import QueryMatchEdge from './QueryMatchEdge';
import SmartStepEdge from './SmartStepEdge';
import SearchAutocomplete from './SearchAutocomplete';
import ClusterLegend from './ClusterLegend';
import EmptySearchState from './EmptySearchState';
import GraphTour from './GraphTour';
import GraphErrorBoundary from './GraphErrorBoundary';
import ChatPanel from './ChatPanel';

logger.setContext('UnifiedSearchModal');

// Maximum nodes allowed in graph to prevent memory exhaustion
const MAX_GRAPH_NODES = 300;
const GRAPH_LAYOUT_SPACING = 300; // Increased from 180 to reduce clutter
const GRAPH_LAYER_SPACING = 400; // Increased from 280 to reduce clutter

// React Flow node/edge types defined outside component for stable references
// See: https://reactflow.dev/error#002
const NODE_TYPES = {
  fileNode: FileNode,
  folderNode: FolderNode,
  queryNode: QueryNode,
  clusterNode: ClusterNode
};

const EDGE_TYPES = {
  similarity: SimilarityEdge,
  queryMatch: QueryMatchEdge,
  smartStep: SmartStepEdge
};

/**
 * Format error messages to be more user-friendly and actionable
 */
const getErrorMessage = (error, context = 'Operation') => {
  const msg = error?.message || '';

  // Connection errors - service unavailable
  if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
    return `${context} failed: Embedding service unavailable. Is Ollama running?`;
  }

  // Timeout errors
  if (msg.includes('timeout') || msg.includes('Timeout')) {
    return `${context} timed out. Try a shorter query or fewer files.`;
  }

  // ChromaDB not available
  if (msg.includes('ChromaDB') || msg.includes('not available yet')) {
    return `${context} failed: Knowledge OS is initializing. Please wait a moment and try again.`;
  }

  // FIX C-1: Embedding dimension mismatch (model changed)
  if (msg.includes('Embedding model changed') || msg.includes('dimension mismatch')) {
    return 'Embedding model changed. Please rebuild your index in Settings > Embeddings maintenance to use the new model.';
  }

  // Generic fallback with original message
  return msg || `${context} failed`;
};

/**
 * FIX: Validate search response structure before rendering
 * Prevents crashes when API returns malformed data
 *
 * @param {Object} response - API response to validate
 * @param {string} context - Context for error messages
 * @returns {{ valid: boolean, error?: string, results?: Array }}
 */
const validateSearchResponse = (response, context = 'Search') => {
  // Check for null/undefined response
  if (!response) {
    return { valid: false, error: `${context} returned no data` };
  }

  // Check success flag
  if (response.success !== true) {
    return { valid: false, error: response.error || `${context} failed` };
  }

  // Check if results exists and is an array
  if (!Array.isArray(response.results)) {
    logger.warn('[UnifiedSearchModal] Response missing results array', { response });
    // Allow empty results but ensure it's an array
    return { valid: true, results: [] };
  }

  // Filter and validate individual results
  // Each result should have at minimum an id
  const validResults = response.results.filter((result) => {
    if (!result) {
      logger.debug('[UnifiedSearchModal] Skipping null result');
      return false;
    }

    // Must have an id
    if (!result.id || typeof result.id !== 'string') {
      logger.debug('[UnifiedSearchModal] Skipping result with invalid id', { result });
      return false;
    }

    return true;
  });

  // Log if we filtered out any results
  if (validResults.length !== response.results.length) {
    logger.warn('[UnifiedSearchModal] Filtered invalid results', {
      original: response.results.length,
      valid: validResults.length
    });
  }

  return { valid: true, results: validResults };
};

const normalizeList = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const getFileExtension = (nameOrPath) => {
  if (!nameOrPath || typeof nameOrPath !== 'string') return '';
  const parts = nameOrPath.split('.');
  if (parts.length < 2) return '';
  return parts.pop().toLowerCase();
};

const buildRecommendationGraph = (fileNodes = []) => {
  const folderNodesMap = new Map();
  const edges = [];

  fileNodes.forEach((node) => {
    const folder = typeof node?.data?.suggestedFolder === 'string' ? node.data.suggestedFolder : '';
    const trimmed = folder.trim();
    if (!trimmed) return;

    const folderId = `folder:${trimmed}`;
    if (!folderNodesMap.has(folderId)) {
      const basePosition = node.position || { x: 0, y: 0 };
      folderNodesMap.set(folderId, {
        id: folderId,
        type: 'folderNode',
        position: { x: basePosition.x + 260, y: basePosition.y },
        data: { kind: 'folder', label: trimmed, memberCount: 0 },
        draggable: true
      });
    }

    const folderNode = folderNodesMap.get(folderId);
    folderNode.data.memberCount = (folderNode.data.memberCount || 0) + 1;

    edges.push({
      id: `e:organize:${node.id}->${folderId}`,
      source: node.id,
      target: folderId,
      type: 'smartStep',
      label: 'Organize',
      style: {
        stroke: '#f59e0b',
        strokeWidth: 1.5
      },
      data: {
        kind: 'organize'
      }
    });
  });

  return {
    folderNodes: Array.from(folderNodesMap.values()),
    edges
  };
};

// ============================================================================
// Sub-Components
// ============================================================================

function ResultRow({
  result,
  isSelected,
  isBulkSelected,
  isFocused,
  query,
  index = 0,
  onSelect,
  onToggleBulk,
  onOpen,
  onReveal,
  onCopyPath
}) {
  const path = result?.metadata?.path || '';
  const name = result?.metadata?.name || safeBasename(path) || result?.id || 'Unknown';
  const category = result?.metadata?.category || 'Uncategorized';

  // Format date and confidence
  const dateStr = result?.metadata?.date ? new Date(result.metadata.date).toLocaleDateString() : '';

  const confidence = result?.metadata?.confidence || 0;

  // Parse keywords: might be an array or a comma-separated string from ChromaDB
  const rawKeywords = result?.metadata?.keywords || [];
  const keywords = Array.isArray(rawKeywords)
    ? rawKeywords
    : typeof rawKeywords === 'string' && rawKeywords.length > 0
      ? rawKeywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
      : [];

  const entities = normalizeList(result?.metadata?.keyEntities).slice(0, 3);
  const dates = normalizeList(result?.metadata?.dates).slice(0, 2);

  // Calculate animation delay - stagger up to 300ms max
  const animationDelay = `${Math.min(index * 30, 300)}ms`;

  return (
    <div
      role="button"
      tabIndex={0}
      data-result-item
      onClick={() => onSelect(result)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(result);
        }
      }}
      style={{ animationDelay }}
      className={`
        group w-full text-left rounded-xl border p-4 transition-all cursor-pointer search-result-item relative
        ${isSelected ? 'border-stratosort-blue bg-stratosort-blue/5 shadow-sm' : 'border-system-gray-200 bg-white hover:border-system-gray-300 hover:shadow-md'}
        ${isBulkSelected ? 'ring-2 ring-stratosort-blue/20' : ''}
        ${isFocused && !isSelected ? 'ring-2 ring-stratosort-blue/40 border-stratosort-blue/50' : ''}
      `}
    >
      {/* Bulk Selection Checkbox */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleBulk(result.id);
        }}
        className={`absolute top-4 left-3 z-10 p-0.5 rounded transition-opacity ${isBulkSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        title={isBulkSelected ? 'Deselect' : 'Select'}
      >
        {isBulkSelected ? (
          <CheckSquare className="w-5 h-5 text-stratosort-blue bg-white rounded-sm" />
        ) : (
          <Square className="w-5 h-5 text-system-gray-300 bg-white rounded-sm" />
        )}
      </button>

      <div className="pl-7">
        {/* Header: Name and Date */}
        <div className="flex justify-between items-start gap-4 mb-1">
          <div className="min-w-0 flex-1">
            <HighlightedText
              text={name}
              query={query}
              className="font-semibold text-system-gray-900 truncate block text-base"
            />
          </div>
          {dateStr && (
            <span className="text-xs text-system-gray-400 whitespace-nowrap pt-1 font-medium">
              {dateStr}
            </span>
          )}
        </div>

        {/* Sub-header: Category and Confidence */}
        <div className="flex items-center gap-3 mb-3">
          <span className="text-sm text-stratosort-blue font-medium">{category}</span>
          <span className="text-sm text-system-gray-400">Confidence: {confidence}%</span>
        </div>

        {/* Keywords / Tags */}
        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {keywords.map((keyword, idx) => (
              <span
                key={`${result.id}-kw-${idx}`}
                className="px-3 py-1 rounded-full bg-blue-50 text-stratosort-blue text-xs font-medium"
              >
                {keyword}
              </span>
            ))}
          </div>
        )}
        {(entities.length > 0 || dates.length > 0) && (
          <div className="mt-2 text-xs text-system-gray-500 space-y-1">
            {entities.length > 0 && <div>Entities: {entities.join(', ')}</div>}
            {dates.length > 0 && <div>Dates: {dates.join(', ')}</div>}
          </div>
        )}
      </div>

      {/* Quick actions - only on selected */}
      {isSelected && (
        <div className="absolute bottom-4 right-4 flex gap-1 bg-white/80 backdrop-blur-sm rounded-lg p-1 shadow-sm border border-system-gray-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpen(path);
            }}
            className="p-1.5 rounded-md hover:bg-stratosort-blue/10 transition-colors"
            title="Open file"
          >
            <ExternalLink className="w-4 h-4 text-stratosort-blue" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReveal(path);
            }}
            className="p-1.5 rounded-md hover:bg-stratosort-blue/10 transition-colors"
            title="Show in folder"
          >
            <FolderOpen className="w-4 h-4 text-stratosort-blue" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCopyPath(path);
            }}
            className="p-1.5 rounded-md hover:bg-stratosort-blue/10 transition-colors"
            title="Copy path"
          >
            <Copy className="w-4 h-4 text-stratosort-blue" />
          </button>
        </div>
      )}
    </div>
  );
}

ResultRow.propTypes = {
  result: PropTypes.object.isRequired,
  isSelected: PropTypes.bool.isRequired,
  isBulkSelected: PropTypes.bool.isRequired,
  isFocused: PropTypes.bool,
  query: PropTypes.string,
  index: PropTypes.number,
  onSelect: PropTypes.func.isRequired,
  onToggleBulk: PropTypes.func.isRequired,
  onOpen: PropTypes.func.isRequired,
  onReveal: PropTypes.func.isRequired,
  onCopyPath: PropTypes.func.isRequired
};
ResultRow.displayName = 'ResultRow';

function StatsDisplay({ stats, isLoadingStats, onRefresh }) {
  return (
    <div className="flex items-center gap-2">
      {stats ? (
        <span className="flex items-center gap-1 text-xs text-system-gray-500">
          <span className="font-medium text-system-gray-700">{stats.folders}</span>
          <span>folder{stats.folders !== 1 ? 's' : ''}</span>
          <span className="text-system-gray-300">•</span>
          <span className="font-medium text-system-gray-700">{stats.files}</span>
          <span>file{stats.files !== 1 ? 's' : ''} indexed</span>
        </span>
      ) : isLoadingStats ? (
        <span className="flex items-center gap-2 text-xs text-system-gray-400">
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-system-gray-300" />
          Loading index...
        </span>
      ) : (
        <span className="text-xs text-system-gray-400">No embeddings</span>
      )}
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-system-gray-400 hover:text-system-gray-700 p-1 rounded hover:bg-system-gray-100 transition-colors"
        onClick={onRefresh}
        disabled={isLoadingStats}
        title="Refresh embeddings status"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isLoadingStats ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}

StatsDisplay.propTypes = {
  stats: PropTypes.object,
  isLoadingStats: PropTypes.bool.isRequired,
  onRefresh: PropTypes.func.isRequired
};
StatsDisplay.displayName = 'StatsDisplay';

function EmptyEmbeddingsBanner({
  onRebuildFolders,
  onRebuildFiles,
  isRebuildingFolders,
  isRebuildingFiles
}) {
  return (
    <StateMessage
      icon={Sparkles}
      tone="warning"
      size="md"
      align="left"
      title="No embeddings yet"
      description="Knowledge OS requires file embeddings. If you already analyzed files in the past but this number is still zero, your search index was likely reset and needs a one-time rebuild from analysis history."
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onRebuildFolders}
            disabled={isRebuildingFolders}
          >
            {isRebuildingFolders ? 'Building...' : 'Build Folder Embeddings'}
          </Button>
          <Button variant="primary" size="sm" onClick={onRebuildFiles} disabled={isRebuildingFiles}>
            {isRebuildingFiles ? 'Building...' : 'Build File Embeddings'}
          </Button>
        </div>
      }
      className="glass-panel border border-stratosort-warning/30 bg-stratosort-warning/10 p-4 rounded-xl"
      contentClassName="max-w-xl"
    />
  );
}

EmptyEmbeddingsBanner.propTypes = {
  onRebuildFolders: PropTypes.func.isRequired,
  onRebuildFiles: PropTypes.func.isRequired,
  isRebuildingFolders: PropTypes.bool.isRequired,
  isRebuildingFiles: PropTypes.bool.isRequired
};
EmptyEmbeddingsBanner.displayName = 'EmptyEmbeddingsBanner';

/**
 * Banner shown when search falls back to keyword-only mode
 * Helps users understand why Knowledge OS isn't working
 */
function SearchModeBanner({ meta }) {
  if (!meta?.fallback) return null;

  return (
    <div className="glass-panel border border-stratosort-warning/30 bg-stratosort-warning/5 px-3 py-2 text-xs rounded-lg flex items-center gap-2">
      <MessageSquare className="w-4 h-4 text-stratosort-warning shrink-0" />
      <span className="text-system-gray-600">
        <strong>Limited search:</strong> Using keyword search only
        {meta.fallbackReason ? ` (${meta.fallbackReason})` : ' (embedding model unavailable)'}.
        Knowledge OS semantic matching is disabled.
      </span>
    </div>
  );
}

SearchModeBanner.propTypes = {
  meta: PropTypes.shape({
    mode: PropTypes.string,
    fallback: PropTypes.bool,
    fallbackReason: PropTypes.string,
    originalMode: PropTypes.string
  })
};
SearchModeBanner.displayName = 'SearchModeBanner';

function TabButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all
        ${
          active
            ? 'bg-stratosort-blue text-white shadow-md'
            : 'bg-system-gray-100 text-system-gray-600 hover:bg-system-gray-200 hover:text-system-gray-900'
        }
      `}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

TabButton.propTypes = {
  active: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
  icon: PropTypes.elementType.isRequired,
  label: PropTypes.string.isRequired
};
TabButton.displayName = 'TabButton';

// SearchExplainer and SearchProcessCard removed - users don't need to understand how search works

// ============================================================================
// Main Component
// ============================================================================

export default function UnifiedSearchModal({
  isOpen,
  onClose,
  defaultTopK = 20,
  initialTab = 'search'
}) {
  const redactPaths = useAppSelector((state) => Boolean(state?.system?.redactPaths));
  // Tab state
  // Graph is currently feature-flagged off. If callers pass initialTab="graph",
  // ensure we still render the Search tab content instead of a blank body.
  const effectiveInitialTab = GRAPH_FEATURE_FLAGS.SHOW_GRAPH
    ? initialTab
    : initialTab === 'graph'
      ? 'search'
      : initialTab;
  const [activeTab, setActiveTab] = useState(effectiveInitialTab);

  // Shared state
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [stats, setStats] = useState(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [hasLoadedStats, setHasLoadedStats] = useState(false);
  const [isRebuildingFolders, setIsRebuildingFolders] = useState(false);
  const [isRebuildingFiles, setIsRebuildingFiles] = useState(false);
  const [error, setError] = useState('');

  // Search tab state
  const [searchResults, setSearchResults] = useState([]);
  const [selectedSearchId, setSelectedSearchId] = useState(null);
  const [selectedDocumentDetails, setSelectedDocumentDetails] = useState(null);
  const [isLoadingDocumentDetails, setIsLoadingDocumentDetails] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [queryMeta, setQueryMeta] = useState(null); // Stores spell corrections and synonyms info
  const [searchMeta, setSearchMeta] = useState(null); // Stores search mode and fallback info
  const [bulkSelectedIds, setBulkSelectedIds] = useState(new Set());
  const [searchRefreshTrigger, setSearchRefreshTrigger] = useState(0);
  const [focusedResultIndex, setFocusedResultIndex] = useState(-1);
  const [viewMode, setViewMode] = useState('all'); // 'all' or 'grouped'

  // nodeTypes and edgeTypes are defined as module-level constants (NODE_TYPES, EDGE_TYPES)
  // to prevent React Flow warning about recreating objects on render

  // Chat tab state
  const [chatMessages, setChatMessages] = useState([]);
  const [isChatting, setIsChatting] = useState(false);
  const [chatError, setChatError] = useState('');
  const [chatWarning, setChatWarning] = useState('');
  const [useSearchContext, setUseSearchContext] = useState(true);
  const [responseMode, setResponseMode] = useState('fast');
  const chatSessionRef = useRef(null);
  const [recommendationMap, setRecommendationMap] = useState({});
  const [_isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    const loadResponseMode = async () => {
      try {
        const settings = await window.electronAPI?.settings?.get?.();
        if (!isMounted) return;
        const savedMode = settings?.chatResponseMode;
        if (savedMode === 'fast' || savedMode === 'deep') {
          setResponseMode(savedMode);
        }
      } catch (error) {
        logger.debug('[UnifiedSearchModal] Failed to load chat response mode', {
          error: error?.message || String(error)
        });
      }
    };
    loadResponseMode();
    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  // Graph tab state
  const { nodes, edges, selectedNodeId, actions: graphActions } = useGraphState();
  const [freshMetadata, setFreshMetadata] = useState(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [addMode, setAddMode] = useState(true);
  const [withinQuery, setWithinQuery] = useState('');
  const [debouncedWithinQuery, setDebouncedWithinQuery] = useState('');
  // No-op for removed status bar to prevent breaking existing calls
  // eslint-disable-next-line no-unused-vars
  const [graphStatus, setGraphStatus] = useState('');

  // Layout state
  const [autoLayout, setAutoLayout] = useState(true);
  const [isLayouting, setIsLayouting] = useState(false);

  // Multi-hop expansion state
  const [hopCount, setHopCount] = useState(1);
  const [decayFactor, setDecayFactor] = useState(0.7);

  // Clustering state
  const [showClusters, setShowClusters] = useState(false);
  const [isComputingClusters, setIsComputingClusters] = useState(false);

  // Help tour state (for re-showing the tour via help button)
  const [showTourManually, setShowTourManually] = useState(false);

  // Persistence and Notes state
  const [graphNotes, setGraphNotes] = useState({}); // Map of nodeId -> note string
  const [enableAutoClustering, setEnableAutoClustering] = useState(true);
  const [showEdgeLabels, setShowEdgeLabels] = useState(true); // Default to showing labels for clarity
  const showEdgeLabelsRef = useRef(true); // Ref for access in callbacks without dependency

  // Sync ref with state
  useEffect(() => {
    showEdgeLabelsRef.current = showEdgeLabels;
  }, [showEdgeLabels, showEdgeLabelsRef]); // Default to false to reduce clutter

  const dispatch = useAppDispatch();
  const handleOpenSettings = useCallback(() => {
    dispatch(toggleSettings());
    onClose?.();
  }, [dispatch, onClose]);

  // Graph filtering state
  const [activeFilters, setActiveFilters] = useState({
    types: ['cluster', 'file', 'query', 'folder'],
    confidence: ['high', 'medium', 'low']
  });

  // Zoom state
  const [zoomLevel, setZoomLevel] = useState(1);

  // Focus mode state - for local graph view
  const [focusNodeId, setFocusNodeId] = useState(null);
  const [focusDepth, setFocusDepth] = useState(2);

  // Highlight sync state - for syncing highlights between search list and graph
  const [_highlightedNodeId, _setHighlightedNodeId] = useState(null);

  const handleToggleFilter = useCallback((category, value) => {
    setActiveFilters((prev) => {
      const current = prev[category] || [];
      const newValues = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [category]: newValues };
    });
  }, []);

  // Duplicates detection state (duplicateGroups stored for potential future export feature)
  // eslint-disable-next-line no-unused-vars
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [isFindingDuplicates, setIsFindingDuplicates] = useState(false);

  // Confirmation modal state
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // UI State for progressive disclosure
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [isGraphMaximized, setIsGraphMaximized] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Refs
  const lastSearchRef = useRef(0);
  const searchRequestCounterRef = useRef(0);
  const withinRequestCounterRef = useRef(0);
  const withinReqRef = useRef(0);
  const reactFlowInstance = useRef(null);
  const resultListRef = useRef(null);
  const wasOpenRef = useRef(false);

  // Refs for tracking auto-load state
  const hasAutoLoadedClusters = useRef(false);
  const hasShownClusterCelebration = useRef(false);

  // Ref to avoid temporal dead zone with loadClusters in keyboard shortcuts
  const loadClustersRef = useRef(null);

  // Ref for expandFromSelected to be used by findSimilar event handler
  const expandFromSelectedRef = useRef(null);

  // Ref for expandCluster to be used in handleClusterExpand (defined before expandCluster)
  const expandClusterRef = useRef(null);

  // Ref for cluster action callbacks to rehydrate saved graphs
  const clusterActionRefs = useRef({});

  // Refs to access current nodes/edges in callbacks without creating stale closures
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  // File Actions Hook
  const { openFile, revealFile, copyPath } = useFileActions(setError);

  // ============================================================================
  // Chat Handlers
  // ============================================================================

  const buildSuggestionFiles = useCallback((results) => {
    if (!Array.isArray(results)) return [];
    return results
      .map((result) => {
        const metadata = result?.metadata || {};
        const path = metadata.path || result?.id || '';
        const name = metadata.name || safeBasename(path) || '';
        if (!path) return null;

        return {
          path,
          name,
          extension: getFileExtension(name || path),
          analysis: {
            subject: metadata.subject,
            summary: metadata.summary,
            tags: metadata.tags || [],
            category: metadata.category,
            confidence: metadata.confidence
          }
        };
      })
      .filter(Boolean);
  }, []);

  const hydrateRecommendationMap = useCallback(async () => {
    const files = buildSuggestionFiles(searchResults);
    if (!files.length || !window.electronAPI?.suggestions?.getBatchSuggestions) {
      setRecommendationMap({});
      return;
    }

    setIsLoadingRecommendations(true);
    try {
      const response = await window.electronAPI.suggestions.getBatchSuggestions(files);
      if (!response?.success || !Array.isArray(response.groups)) {
        setRecommendationMap({});
        return;
      }

      const nextMap = {};
      response.groups.forEach((group) => {
        const groupFolder = group?.folder;
        const groupFiles = Array.isArray(group?.files) ? group.files : [];
        groupFiles.forEach((file) => {
          const filePath = file?.path;
          if (!filePath) return;
          nextMap[filePath] = file?.suggestion?.folder || groupFolder || '';
        });
      });

      setRecommendationMap(nextMap);
    } catch (recErr) {
      logger.debug('[Search] Recommendation lookup failed:', recErr?.message || recErr);
      setRecommendationMap({});
    } finally {
      setIsLoadingRecommendations(false);
    }
  }, [buildSuggestionFiles, searchResults]);

  useEffect(() => {
    if (!isOpen) return;
    hydrateRecommendationMap();
  }, [hydrateRecommendationMap, isOpen]);

  const ensureChatSession = useCallback(() => {
    if (!chatSessionRef.current) {
      chatSessionRef.current = crypto.randomUUID();
    }
    return chatSessionRef.current;
  }, []);

  const handleChatSend = useCallback(
    async (text, overrideContextIds = null) => {
      const trimmed = typeof text === 'string' ? text.trim() : '';
      if (!trimmed) return;

      setChatError('');
      setChatWarning('');
      setIsChatting(true);
      setChatMessages((prev) => [...prev, { role: 'user', text: trimmed }]);

      try {
        const sessionId = ensureChatSession();
        let contextFileIds = [];

        if (Array.isArray(overrideContextIds) && overrideContextIds.length > 0) {
          contextFileIds = overrideContextIds;
        } else if (useSearchContext) {
          contextFileIds = Array.from(
            new Set(
              (searchResults || [])
                .map((result) => result?.id)
                .filter((id) => typeof id === 'string' && id.length > 0)
            )
          )
            .sort((aId, bId) => {
              const aPath = searchResults.find((r) => r?.id === aId)?.metadata?.path || '';
              const bPath = searchResults.find((r) => r?.id === bId)?.metadata?.path || '';
              const aRec = recommendationMap[aPath] ? 1 : 0;
              const bRec = recommendationMap[bPath] ? 1 : 0;
              return bRec - aRec;
            })
            .slice(0, 200);
        }

        logger.info('[KnowledgeOS] Chat query', {
          sessionId,
          queryLength: trimmed.length,
          useSearchContext,
          contextFileCount: contextFileIds.length,
          topK: Math.min(8, defaultTopK)
        });

        const response = await window.electronAPI?.chat?.query?.({
          sessionId,
          query: trimmed,
          topK: Math.min(8, defaultTopK),
          mode: 'hybrid',
          contextFileIds,
          responseMode
        });

        if (!response || response.success !== true) {
          throw new Error(response?.error || 'Chat request failed');
        }

        const nextWarning =
          response?.meta?.warning ||
          (response?.meta?.retrievalAvailable === false
            ? 'Document retrieval unavailable. Responses use model knowledge only.'
            : '');
        setChatWarning(nextWarning);

        const assistantMessage = {
          role: 'assistant',
          documentAnswer: response.response?.documentAnswer || [],
          modelAnswer: response.response?.modelAnswer || [],
          followUps: response.response?.followUps || [],
          sources: response.sources || []
        };

        setChatMessages((prev) => [...prev, assistantMessage]);
      } catch (chatErr) {
        logger.warn('[KnowledgeOS] Chat query failed', { error: chatErr?.message || chatErr });
        setChatError(chatErr?.message || 'Chat request failed');
        setChatWarning('');
      } finally {
        setIsChatting(false);
      }
    },
    [
      defaultTopK,
      ensureChatSession,
      recommendationMap,
      responseMode,
      searchResults,
      useSearchContext
    ]
  );

  const handleResponseModeChange = useCallback((nextMode) => {
    if (nextMode !== 'fast' && nextMode !== 'deep') return;
    setResponseMode(nextMode);
    window.electronAPI?.settings?.save?.({ chatResponseMode: nextMode }).catch((err) => {
      logger.debug('[UnifiedSearchModal] Failed to save chat response mode', {
        error: err?.message || String(err)
      });
      setError('Failed to save chat response mode. Please try again.');
    });
  }, []);

  const handleChatReset = useCallback(async () => {
    setChatMessages([]);
    setChatError('');
    setChatWarning('');
    setIsChatting(false);
    const sessionId = ensureChatSession();
    logger.info('[KnowledgeOS] Chat session reset', { sessionId });
    await window.electronAPI?.chat?.resetSession?.(sessionId);
    chatSessionRef.current = crypto.randomUUID();
  }, [ensureChatSession]);

  const handleChatOpenSource = useCallback(
    (source) => {
      if (source?.path) {
        openFile(source.path);
      }
    },
    [openFile]
  );

  const handleUseSourcesInGraph = useCallback(
    async (sources) => {
      if (!GRAPH_FEATURE_FLAGS.SHOW_GRAPH || !Array.isArray(sources)) return;

      logger.info('[KnowledgeOS] Open sources in graph', {
        sourceCount: sources.length
      });

      const fileNodes = sources.map((source, idx) => ({
        id: source.fileId,
        type: 'fileNode',
        position: defaultNodePosition(idx),
        data: {
          kind: 'file',
          label: source.name || source.metadata?.name || source.fileId,
          path: source.path || source.metadata?.path || '',
          score: source.score || 0,
          tags: normalizeList(source.tags || source.metadata?.tags).slice(0, 5),
          entities: normalizeList(source.entities || source.metadata?.entities).slice(0, 5),
          dates: normalizeList(source.dates || source.metadata?.dates).slice(0, 3),
          suggestedFolder: recommendationMap[source.path || source.metadata?.path] || '',
          category: getFileCategory(source.path || source.metadata?.path || ''),
          subject:
            source.subject ||
            source.metadata?.subject ||
            (recommendationMap[source.path || source.metadata?.path]
              ? `Folder: ${recommendationMap[source.path || source.metadata?.path]}`
              : '')
        },
        draggable: true
      }));

      const { folderNodes, edges: organizeEdges } = buildRecommendationGraph(fileNodes);

      graphActions.setNodes([...fileNodes, ...folderNodes]);
      graphActions.setEdges(organizeEdges);
      setActiveTab('graph');

      const fileIds = sources.map((s) => s.fileId).filter(Boolean);
      if (fileIds.length >= 2) {
        const simEdgesResp = await window.electronAPI?.embeddings?.getSimilarityEdges?.(fileIds, {
          threshold: 0.75,
          maxEdgesPerNode: 1
        });
        if (simEdgesResp?.success && Array.isArray(simEdgesResp.edges)) {
          const nodeDataMap = new Map();
          fileNodes.forEach((n) => {
            nodeDataMap.set(n.id, {
              label: n.data?.label || '',
              tags: n.data?.tags || [],
              category: n.data?.category || '',
              subject: n.data?.subject || ''
            });
          });

          const similarityEdges = simEdgesResp.edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            type: 'similarity',
            animated: false,
            data: {
              kind: 'similarity',
              similarity: edge.similarity,
              sourceData: nodeDataMap.get(edge.source) || {},
              targetData: nodeDataMap.get(edge.target) || {},
              showEdgeLabels: showEdgeLabelsRef.current
            }
          }));
          if (similarityEdges.length > 0) {
            graphActions.setEdges(similarityEdges);
            logger.info('[KnowledgeOS] Added similarity edges', {
              edgeCount: similarityEdges.length
            });
          }
        }
      }

      if (autoLayout && fileNodes.length > 1) {
        try {
          const { nodes: layoutedNodes, edges: layoutedEdges } = await debouncedElkLayout(
            fileNodes,
            edgesRef.current || [],
            {
              direction: 'RIGHT',
              spacing: GRAPH_LAYOUT_SPACING,
              layerSpacing: GRAPH_LAYER_SPACING
            }
          );
          graphActions.setNodes(layoutedNodes);
          if (layoutedEdges && layoutedEdges.length > 0) {
            graphActions.setEdges(layoutedEdges);
          }
        } catch (layoutError) {
          logger.warn('[Graph] Layout from chat sources failed:', layoutError);
        }
      }
    },
    [autoLayout, graphActions, recommendationMap]
  );

  // ============================================================================
  // Reset on open
  // ============================================================================

  useEffect(() => {
    if (!isOpen) {
      // Cancel any pending layout operations when modal closes
      cancelPendingLayout();
      hasAutoLoadedClusters.current = false;
      reactFlowInstance.current = null; // Clear ref to prevent memory leak
      return () => {};
    }

    const isOpening = !wasOpenRef.current;
    if (isOpening) {
      logger.info('[KnowledgeOS] Opened', {
        initialTab,
        effectiveInitialTab
      });
      wasOpenRef.current = true;

      setActiveTab(effectiveInitialTab);
      setQuery('');
      setDebouncedQuery('');
      setError('');
      setStats(null);
      setHasLoadedStats(false);
      setIsLoadingStats(false);
      // Search state
      setSearchResults([]);
      setSelectedSearchId(null);
      setIsSearching(false);
      setQueryMeta(null);
      setSearchMeta(null);
      setBulkSelectedIds(new Set());
      // Chat state
      setChatMessages([]);
      setChatError('');
      setIsChatting(false);
      setUseSearchContext(true);
      chatSessionRef.current = crypto.randomUUID();
      // Graph state
      graphActions.setNodes([]);
      graphActions.setEdges([]);
      graphActions.selectNode(null);
      setAddMode(true);
      setWithinQuery('');
      setDebouncedWithinQuery('');
      setGraphStatus('');
      // Layout state
      setAutoLayout(true);
      setIsLayouting(false);
      // Multi-hop state
      setHopCount(1);
      setDecayFactor(0.7);
      // Clustering state
      setShowClusters(false);
      setIsComputingClusters(false);
      // Duplicates state
      setDuplicateGroups([]);
      setIsFindingDuplicates(false);
    }

    // Cleanup pending layouts on unmount
    return () => {
      cancelPendingLayout();
      graphActions.reset();
    };
  }, [isOpen, effectiveInitialTab, graphActions, initialTab]);

  useEffect(() => {
    if (!isOpen) {
      if (wasOpenRef.current) {
        logger.info('[KnowledgeOS] Closed');
        wasOpenRef.current = false;
      }
      return;
    }
    logger.info('[KnowledgeOS] Tab changed', { tab: activeTab });
  }, [activeTab, isOpen]);

  // FIX P2-14: Reset focusedResultIndex when switching tabs
  // Prevents stale focus state when returning to search tab
  useEffect(() => {
    setFocusedResultIndex(-1);
  }, [activeTab]);

  // Update edge visibility when toggle changes
  useEffect(() => {
    graphActions.setEdges((prevEdges) =>
      prevEdges.map((e) => ({
        ...e,
        data: { ...e.data, showEdgeLabels }
      }))
    );
  }, [showEdgeLabels, graphActions]);

  // ============================================================================
  // Persistence & Notes
  // ============================================================================

  const handleSaveGraph = useCallback(() => {
    try {
      const state = {
        nodes,
        edges,
        notes: graphNotes,
        chatMessages,
        settings: {
          enableAutoClustering,
          autoLayout,
          showEdgeLabels
        },
        timestamp: Date.now()
      };
      localStorage.setItem('stratosort_graph_state', JSON.stringify(state));
      setGraphStatus('Graph, chat, and settings saved');
    } catch (e) {
      logger.error('Failed to save graph', e);
      setError('Failed to save graph state');
    }
  }, [nodes, edges, graphNotes, chatMessages, enableAutoClustering, autoLayout, showEdgeLabels]);

  const handleLoadGraph = useCallback(() => {
    try {
      const saved = localStorage.getItem('stratosort_graph_state');
      if (!saved) {
        setGraphStatus('No saved graph found');
        return;
      }
      const state = JSON.parse(saved);
      if (Array.isArray(state.nodes) && Array.isArray(state.edges)) {
        const rehydratedNodes = state.nodes.map((node) => {
          if (node?.type === 'clusterNode' || node?.data?.kind === 'cluster') {
            return {
              ...node,
              data: {
                ...node.data,
                ...clusterActionRefs.current
              }
            };
          }
          return node;
        });
        graphActions.setNodes(rehydratedNodes);
        // Ensure edge visibility respects current or loaded setting
        const loadedShowLabels = state.settings?.showEdgeLabels ?? true;

        // Restore edges with updated visibility if needed
        const restoredEdges = state.edges.map((e) => ({
          ...e,
          data: { ...e.data, showEdgeLabels: loadedShowLabels }
        }));
        graphActions.setEdges(restoredEdges);

        if (state.notes) setGraphNotes(state.notes);
        if (state.chatMessages) setChatMessages(state.chatMessages);

        // Restore settings
        if (state.settings) {
          if (state.settings.enableAutoClustering !== undefined)
            setEnableAutoClustering(state.settings.enableAutoClustering);
          if (state.settings.autoLayout !== undefined) setAutoLayout(state.settings.autoLayout);
          setShowEdgeLabels(loadedShowLabels);
        }

        setGraphStatus(`Loaded graph from ${new Date(state.timestamp).toLocaleTimeString()}`);
      } else {
        logger.warn('[UnifiedSearchModal] Saved graph state invalid, resetting', {
          hasNodes: Array.isArray(state.nodes),
          hasEdges: Array.isArray(state.edges)
        });
        graphActions.setNodes([]);
        graphActions.setEdges([]);
        setGraphStatus('Saved graph state was invalid and has been reset');
      }
    } catch (e) {
      logger.error('Failed to load graph', e);
      setError('Failed to load saved graph');
    }
  }, [graphActions]);

  // ============================================================================
  // Shared: File Actions (defined early for keyboard shortcut dependency)
  // ============================================================================

  const convertSearchToGraph = useCallback(async () => {
    if (searchResults.length === 0) return;

    // Clear existing graph if not in add mode
    if (!addMode) {
      graphActions.setNodes([]);
      graphActions.setEdges([]);
    }

    // Create query node
    const queryNodeId = makeQueryNodeId(debouncedQuery || 'search', Date.now());
    const queryNode = {
      id: queryNodeId,
      type: 'queryNode',
      position: { x: 40, y: 200 },
      data: { kind: 'query', label: debouncedQuery || 'Search Results' },
      draggable: true
    };

    // Create file nodes from search results
    const fileNodes = searchResults.slice(0, 20).map((result, idx) => {
      const filePath = result?.metadata?.path || result?.id || '';
      const displayName =
        result?.metadata?.name ||
        safeBasename(filePath) ||
        filePath.split(/[/\\]/).pop() ||
        result?.id;

      return {
        id: result.id,
        type: 'fileNode',
        position: { x: 280, y: 40 + idx * 70 },
        data: {
          kind: 'file',
          label: displayName,
          path: filePath,
          score: result.score || 0,
          tags: normalizeList(result?.metadata?.tags || result?.metadata?.keywords).slice(0, 5),
          entities: normalizeList(result?.metadata?.keyEntities).slice(0, 5),
          dates: normalizeList(result?.metadata?.dates).slice(0, 3),
          suggestedFolder: recommendationMap[filePath] || '',
          category: result?.metadata?.category || '',
          subject: result?.metadata?.subject || ''
        },
        draggable: true
      };
    });

    // Create edges from query to results
    const queryEdges = fileNodes.map((node) => {
      const result = searchResults.find((r) => r.id === node.id);
      return {
        id: `e:${queryNodeId}->${node.id}`,
        source: queryNodeId,
        target: node.id,
        type: 'queryMatch',
        data: {
          kind: 'query_match',
          score: result?.score || 0,
          matchDetails: result?.matchDetails || {},
          showEdgeLabels: showEdgeLabelsRef.current
        }
      };
    });

    const { folderNodes, edges: organizeEdges } = buildRecommendationGraph(fileNodes);

    // Update graph state
    graphActions.setNodes((prev) => {
      const incoming = [queryNode, ...fileNodes, ...folderNodes];
      if (!addMode) return incoming;
      const existing = new Set(prev.map((n) => n.id));
      const newNodes = incoming.filter((n) => !existing.has(n.id));
      return [...prev, ...newNodes];
    });

    graphActions.setEdges((prev) => {
      const incomingEdges = [...queryEdges, ...organizeEdges];
      if (!addMode) return incomingEdges;
      const existing = new Set(prev.map((e) => e.id));
      const newEdges = incomingEdges.filter((e) => !existing.has(e.id));
      return [...prev, ...newEdges];
    });

    // Switch to graph tab
    setActiveTab('graph');
    setGraphStatus(`Converted ${fileNodes.length} results to graph`);

    // Apply layout
    if (autoLayout) {
      try {
        // FIX: Use refs to get current nodes/edges to avoid stale closure issues
        // If nodes/edges change during the async layout, we want to merge with
        // the CURRENT state, not the state at the time this function was created
        const currentNodes = nodesRef.current || [];
        const currentEdges = edgesRef.current || [];
        const allNodes = addMode
          ? [
              ...currentNodes.filter((n) => n.id !== queryNodeId),
              queryNode,
              ...fileNodes,
              ...folderNodes
            ]
          : [queryNode, ...fileNodes, ...folderNodes];
        const allEdges = addMode
          ? [
              ...currentEdges.filter((e) => !e.id.startsWith(`e:${queryNodeId}`)),
              ...queryEdges,
              ...organizeEdges
            ]
          : [...queryEdges, ...organizeEdges];

        const { nodes: layoutedNodes, edges: layoutedEdges } = await debouncedElkLayout(
          allNodes,
          allEdges,
          {
            direction: 'RIGHT',
            spacing: GRAPH_LAYOUT_SPACING,
            layerSpacing: GRAPH_LAYER_SPACING
          }
        );
        graphActions.setNodes(layoutedNodes);
        if (layoutedEdges && layoutedEdges.length > 0) {
          graphActions.setEdges(layoutedEdges);
        }
      } catch (layoutError) {
        logger.warn('[Graph] Layout after conversion failed:', layoutError);
      }
    }
  }, [searchResults, debouncedQuery, addMode, autoLayout, graphActions, recommendationMap]);

  // ============================================================================
  // Keyboard Shortcuts
  // ============================================================================

  // Reset focused index when search results change
  useEffect(() => {
    setFocusedResultIndex(-1);
  }, [searchResults]);

  // Scroll focused result into view
  useEffect(() => {
    if (focusedResultIndex >= 0 && resultListRef.current) {
      const items = resultListRef.current.querySelectorAll('[data-result-item]');
      if (items[focusedResultIndex]) {
        items[focusedResultIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [focusedResultIndex]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (e) => {
      // Ctrl/Cmd + F: Focus search input
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        // Find and focus the search input
        const searchInput = document.querySelector(
          '[aria-label="Search query"], [aria-label="Search to add nodes"]'
        );
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      }

      // Escape: Close modal (handled by Modal component, but also clear selection)
      if (e.key === 'Escape') {
        if (selectedNodeId) {
          graphActions.selectNode(null);
        }
        if (focusedResultIndex >= 0) {
          setFocusedResultIndex(-1);
        }
      }

      // Arrow key navigation for search results
      if (activeTab === 'search' && searchResults.length > 0) {
        // Check if autocomplete dropdown is open (has visible suggestions)
        const autocompleteOpen = document.querySelector('[role="listbox"]');
        if (autocompleteOpen) return; // Let autocomplete handle arrow keys

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setFocusedResultIndex((prev) => {
            const next = Math.min(prev + 1, searchResults.length - 1);
            // Also select when navigating
            if (searchResults[next]) {
              setSelectedSearchId(searchResults[next].id);
            }
            return next;
          });
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusedResultIndex((prev) => {
            const next = Math.max(prev - 1, -1);
            // Select result or clear selection when at -1
            if (next >= 0 && searchResults[next]) {
              setSelectedSearchId(searchResults[next].id);
            } else if (next === -1) {
              setSelectedSearchId(null); // Clear selection when defocusing
            }
            return next;
          });
        }
        // Enter to open focused result
        if (e.key === 'Enter' && focusedResultIndex >= 0 && !e.ctrlKey && !e.metaKey) {
          const result = searchResults[focusedResultIndex];
          if (result?.metadata?.path) {
            e.preventDefault();
            openFile(result.metadata.path);
          }
        }
      }

      // Ctrl/Cmd + Enter: Run search or load clusters
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (activeTab === 'graph' && nodes.length === 0) {
          loadClustersRef.current?.();
        }
      }

      // Tab switching: Ctrl + 1/2
      if (e.ctrlKey && e.key === '1') {
        e.preventDefault();
        setActiveTab('search');
      }
      if (e.ctrlKey && e.key === '2') {
        e.preventDefault();
        setActiveTab('graph');
      }

      // "?" key: Show graph tour/help (only on graph tab, not in input)
      if (e.key === '?' && activeTab === 'graph') {
        const tagName = document.activeElement?.tagName?.toLowerCase();
        if (tagName !== 'input' && tagName !== 'textarea') {
          e.preventDefault();
          setShowTourManually(true);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    isOpen,
    activeTab,
    selectedNodeId,
    nodes.length,
    searchResults,
    focusedResultIndex,
    openFile,
    graphActions
  ]);

  // Graph keyboard navigation (arrow keys, Enter, Escape, Home, End)
  useGraphKeyboardNav({
    nodes,
    edges,
    selectedNodeId,
    onSelectNode: graphActions.selectNode,
    onOpenFile: openFile,
    reactFlowInstance,
    enabled: isOpen && activeTab === 'graph' && nodes.length > 0
  });

  // Listen for findSimilar events from FileNode context menu
  // Use refs to avoid re-subscribing on every nodes change
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleFindSimilar = (event) => {
      const { nodeId } = event.detail || {};
      if (!nodeId) return;

      // Use nodesRef to access current nodes without re-subscribing
      const currentNodes = nodesRef.current || [];
      const node = currentNodes.find((n) => n.id === nodeId);
      if (node && node.data?.kind === 'file') {
        // Use the ref to call expandFromSelected with the specific node
        expandFromSelectedRef.current?.(node);
      }
    };

    const handleToggleCluster = (event) => {
      const { nodeId } = event.detail || {};
      if (nodeId && expandClusterRef.current) {
        expandClusterRef.current(nodeId);
      }
    };

    const handleSearchAgain = (event) => {
      const { query: searchQuery } = event.detail || {};
      if (!searchQuery) return;
      setActiveTab('search');
      setQuery(searchQuery);
      setDebouncedQuery(searchQuery);
    };

    const handleFocusNode = (event) => {
      const { nodeId } = event.detail || {};
      if (!nodeId) return;
      setFocusNodeId(nodeId);

      // Center on the focused node
      const currentNodes = nodesRef.current || [];
      const node = currentNodes.find((n) => n.id === nodeId);
      if (node && reactFlowInstance.current) {
        reactFlowInstance.current.setCenter(node.position.x + 100, node.position.y + 50, {
          duration: 300,
          zoom: 1.2
        });
      }
    };

    window.addEventListener('graph:findSimilar', handleFindSimilar);
    window.addEventListener('graph:toggleCluster', handleToggleCluster);
    window.addEventListener('graph:searchAgain', handleSearchAgain);
    window.addEventListener('graph:focusNode', handleFocusNode);
    return () => {
      window.removeEventListener('graph:findSimilar', handleFindSimilar);
      window.removeEventListener('graph:toggleCluster', handleToggleCluster);
      window.removeEventListener('graph:searchAgain', handleSearchAgain);
      window.removeEventListener('graph:focusNode', handleFocusNode);
    };
  }, [isOpen]); // Removed nodes - use nodesRef instead to prevent frequent re-subscription

  // ============================================================================
  // Shared: Stats & Rebuild
  // ============================================================================

  const refreshStats = useCallback(async () => {
    if (!window?.electronAPI?.embeddings?.getStats) return;
    setIsLoadingStats(true);
    try {
      const res = await window.electronAPI.embeddings.getStats();
      if (res?.success) {
        setStats({
          files: typeof res.files === 'number' ? res.files : 0,
          folders: typeof res.folders === 'number' ? res.folders : 0,
          serverUrl: res.serverUrl || ''
        });
      } else {
        setStats(null);
      }
    } catch (e) {
      logger.warn('Failed to load embedding stats', { error: e?.message });
      setStats(null);
    } finally {
      setIsLoadingStats(false);
      setHasLoadedStats(true);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    refreshStats();
  }, [isOpen, refreshStats]);

  // Listen for file operation events (move/delete) to refresh search results
  useEffect(() => {
    if (!isOpen) return undefined;
    // Guard: Exit early if API not available to prevent unnecessary effect re-runs
    const api = window.electronAPI?.events?.onFileOperationComplete;
    if (!api) return undefined;

    const cleanup = api((data) => {
      if (data?.operation === 'move' || data?.operation === 'delete') {
        logger.debug('[Search] File operation detected, refreshing search', {
          operation: data.operation,
          oldPath: data.oldPath
        });
        // Trigger search refresh by incrementing counter
        setSearchRefreshTrigger((prev) => prev + 1);
        // Also refresh stats
        refreshStats();
      }
    });
    return typeof cleanup === 'function' ? cleanup : undefined;
  }, [isOpen, refreshStats]);

  const rebuildFolders = useCallback(async () => {
    if (!window?.electronAPI?.embeddings?.rebuildFolders) return;
    setIsRebuildingFolders(true);
    setError('');
    try {
      const res = await window.electronAPI.embeddings.rebuildFolders();
      if (!res?.success) throw new Error(res?.error || 'Folder rebuild failed');
      await refreshStats();
    } catch (e) {
      setError(getErrorMessage(e, 'Folder rebuild'));
    } finally {
      setIsRebuildingFolders(false);
    }
  }, [refreshStats]);

  const rebuildFiles = useCallback(async () => {
    if (!window?.electronAPI?.embeddings?.rebuildFiles) return;
    setIsRebuildingFiles(true);
    setError('');
    try {
      const res = await window.electronAPI.embeddings.rebuildFiles();
      if (!res?.success) throw new Error(res?.error || 'File rebuild failed');
      await refreshStats();
    } catch (e) {
      setError(getErrorMessage(e, 'File rebuild'));
    } finally {
      setIsRebuildingFiles(false);
    }
  }, [refreshStats]);

  // ============================================================================
  // Bulk Selection Handlers
  // ============================================================================

  const toggleBulkSelection = useCallback((resultId) => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) {
        next.delete(resultId);
      } else {
        next.add(resultId);
      }
      return next;
    });
  }, []);

  const _selectAllResults = useCallback(() => {
    setBulkSelectedIds(new Set(searchResults.map((r) => r.id)));
  }, [searchResults]);

  const clearBulkSelection = useCallback(() => {
    setBulkSelectedIds(new Set());
  }, []);

  const _copySelectedPaths = useCallback(async () => {
    const paths = searchResults
      .filter((r) => bulkSelectedIds.has(r.id))
      .map((r) => r.metadata?.path)
      .filter(Boolean);
    if (paths.length === 0) return;
    try {
      await navigator.clipboard.writeText(paths.join('\n'));
      setGraphStatus(`Copied ${paths.length} path(s) to clipboard`);
    } catch (e) {
      logger.warn('[Search] Clipboard write failed', e);
      setError('Could not copy to clipboard. Check browser permissions.');
    }
  }, [searchResults, bulkSelectedIds]);

  const moveSelectedToFolder = useCallback(async () => {
    const selectedFiles = searchResults.filter((r) => bulkSelectedIds.has(r.id));
    if (selectedFiles.length === 0) return;

    try {
      const dirResult = await window.electronAPI?.files?.selectDirectory?.();
      if (!dirResult?.success || !dirResult?.path) return;

      const destFolder = dirResult.path;
      const totalFiles = selectedFiles.length;
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < totalFiles; i++) {
        const file = selectedFiles[i];
        const sourcePath = file.metadata?.path;
        if (!sourcePath) continue;

        // Show progress indicator for large batch operations
        if (totalFiles > 3) {
          setGraphStatus(`Moving file ${i + 1} of ${totalFiles}...`);
        }

        const fileName = safeBasename(sourcePath);
        try {
          await window.electronAPI?.files?.performOperation?.({
            operation: 'move',
            source: sourcePath,
            destination: `${destFolder}/${fileName}`
          });
          successCount++;
        } catch (e) {
          logger.error('[Search] Failed to move file', { path: sourcePath, error: e });
          failCount++;
        }
      }

      if (successCount > 0) {
        setGraphStatus(`Moved ${successCount} file(s) to ${safeBasename(destFolder)}`);
        clearBulkSelection();
        // Optionally refresh search results
      }
      if (failCount > 0) {
        setError(`Failed to move ${failCount} file(s)`);
      }
    } catch (e) {
      logger.error('[Search] Move operation failed', e);
      setError(`Move failed: ${e?.message || 'Unknown error'}`);
    }
  }, [searchResults, bulkSelectedIds, clearBulkSelection]);

  /**
   * Create a Smart Folder from a cluster's metadata
   * Uses the cluster's label, category, and tags to define the folder
   */
  const handleCreateSmartFolderFromCluster = useCallback(async (clusterData) => {
    try {
      // Prompt user to select destination directory
      const dirResult = await window.electronAPI?.files?.selectDirectory?.();
      if (!dirResult?.success || !dirResult?.path) {
        // User cancelled
        return;
      }

      const basePath = dirResult.path;
      const folderName = clusterData.label || 'Cluster Folder';

      // Build the full path for the new smart folder
      const folderPath = `${basePath}/${folderName}`;

      // Create the smart folder using existing API
      const result = await window.electronAPI?.smartFolders?.add?.({
        name: folderName,
        path: folderPath,
        description: `Auto-created from cluster with ${clusterData.memberCount || 0} similar files`,
        keywords: clusterData.commonTags || [],
        category: clusterData.dominantCategory || 'General'
      });

      if (result?.success) {
        setError(''); // Clear any existing error
        setGraphStatus(`Smart folder "${folderName}" created successfully!`);
        logger.info('[Graph] Created smart folder from cluster', {
          folderName,
          memberCount: clusterData.memberCount
        });
      } else {
        setError(`Failed to create folder: ${result?.error || 'Unknown error'}`);
      }
    } catch (e) {
      logger.error('[Graph] Failed to create smart folder from cluster', e);
      setError(`Failed to create folder: ${e?.message || 'Unknown error'}`);
    }
  }, []);

  /**
   * Move all files in a cluster to a selected folder
   * Uses the existing FILES.PERFORM_OPERATION handler
   */
  const handleMoveAllToFolder = useCallback(async (clusterData) => {
    try {
      const memberIds = clusterData?.memberIds || [];
      if (memberIds.length === 0) {
        setError('No files in this cluster');
        return;
      }

      // Prompt user to select destination
      const dirResult = await window.electronAPI?.files?.selectDirectory?.();
      if (!dirResult?.success || !dirResult?.path) {
        return; // User cancelled
      }

      const destFolder = dirResult.path;

      // Get file metadata for all members in one call
      const metadataResult = await window.electronAPI?.embeddings?.getFileMetadata?.(memberIds);
      if (!metadataResult?.success) {
        setError('Failed to retrieve file metadata');
        return;
      }

      const metadata = metadataResult.metadata || {};
      let successCount = 0;
      let failCount = 0;

      // Move each file
      for (const id of memberIds) {
        try {
          const fileMetadata = metadata[id];
          const sourcePath = fileMetadata?.path;
          if (!sourcePath) {
            failCount++;
            continue;
          }

          const fileName = safeBasename(sourcePath);
          await window.electronAPI?.files?.performOperation?.({
            operation: 'move',
            source: sourcePath,
            destination: `${destFolder}/${fileName}`
          });
          successCount++;
        } catch (e) {
          logger.error('[Graph] Failed to move cluster file', { id, error: e });
          failCount++;
        }
      }

      if (successCount > 0) {
        setGraphStatus(`Moved ${successCount} file(s) to ${safeBasename(destFolder)}`);
      }
      if (failCount > 0) {
        setError(`Failed to move ${failCount} file(s)`);
      }
    } catch (e) {
      logger.error('[Graph] Move all to folder failed', e);
      setError(`Move failed: ${e?.message || 'Unknown error'}`);
    }
  }, []);

  /**
   * Export a list of file paths from a cluster to clipboard
   */
  const handleExportFileList = useCallback(async (clusterData) => {
    try {
      const memberIds = clusterData?.memberIds || [];
      if (memberIds.length === 0) {
        setError('No files in this cluster');
        return;
      }

      // Get file metadata for all members in one call
      const metadataResult = await window.electronAPI?.embeddings?.getFileMetadata?.(memberIds);
      if (!metadataResult?.success) {
        setError('Failed to retrieve file metadata');
        return;
      }

      const metadata = metadataResult.metadata || {};
      const paths = memberIds.map((id) => metadata[id]?.path).filter(Boolean);

      if (paths.length === 0) {
        setError('Could not retrieve file paths');
        return;
      }

      try {
        await navigator.clipboard.writeText(paths.join('\n'));
        setGraphStatus(`Copied ${paths.length} file path(s) to clipboard`);
      } catch (clipboardErr) {
        logger.error('[Graph] Clipboard write failed', clipboardErr);
        setError('Could not copy to clipboard. Check browser permissions.');
      }
    } catch (e) {
      logger.error('[Graph] Export file list failed', e);
      setError(`Export failed: ${e?.message || 'Unknown error'}`);
    }
  }, []);

  /**
   * Open all files in a cluster
   */
  const handleOpenAllFilesInCluster = useCallback(async (clusterData) => {
    const memberIds = clusterData?.memberIds || [];
    if (memberIds.length === 0) {
      setError('No files in this cluster');
      return;
    }

    const fileApi = window.electronAPI?.files;
    if (!fileApi?.open) {
      setError('Open operation is unavailable');
      return;
    }

    // Limit to prevent opening too many files at once
    const MAX_FILES_TO_OPEN = 10;
    if (memberIds.length > MAX_FILES_TO_OPEN) {
      setGraphStatus(
        `Opening first ${MAX_FILES_TO_OPEN} of ${memberIds.length} files (limit reached)`
      );
    }

    try {
      const subsetIds = memberIds.slice(0, MAX_FILES_TO_OPEN);

      // Get file metadata for members
      const metadataResult = await window.electronAPI?.embeddings?.getFileMetadata?.(subsetIds);
      if (!metadataResult?.success) {
        setError('Failed to retrieve file metadata');
        return;
      }

      const metadata = metadataResult.metadata || {};
      let openedCount = 0;
      let failedCount = 0;

      // Open sequentially to avoid overwhelming the shell/open handlers
      for (const id of subsetIds) {
        const filePath = metadata[id]?.path;
        if (!filePath) {
          failedCount++;
          continue;
        }

        try {
          const result = await fileApi.open(filePath);
          if (result?.success !== false) {
            openedCount++;
          } else {
            failedCount++;
          }
        } catch (err) {
          logger.warn('[Graph] Failed to open cluster file', { id, err });
          failedCount++;
        }
      }

      if (openedCount > 0) {
        setGraphStatus(`Opened ${openedCount} file(s)`);
      }
      if (failedCount > 0 && openedCount === 0) {
        setError('Unable to open files. They may have been moved or deleted.');
      } else if (failedCount > 0) {
        setGraphStatus((prev) =>
          prev ? `${prev} (${failedCount} failed)` : `${openedCount} opened, ${failedCount} failed`
        );
      }
    } catch (e) {
      logger.error('[Graph] Open all files failed', e);
      setError(`Failed to open files: ${e?.message || 'Unknown error'}`);
    }
  }, []);

  /**
   * Search within a specific cluster - focuses the within-graph search on cluster files
   */
  const handleSearchWithinCluster = useCallback((clusterData) => {
    const label = clusterData?.label || 'cluster';
    // Set the within-graph search query to help user search within this cluster
    setWithinQuery(`in:${label}`);
    setGraphStatus(`Searching within "${label}" - enter your query above`);

    // If cluster is not expanded, expand it first
    const clusterId = clusterData?.id || clusterData?.clusterId;
    if (clusterId && !clusterData?.expanded) {
      const memberIds = clusterData?.memberIds || [];
      if (memberIds.length > 0) {
        expandClusterRef.current?.(clusterId, memberIds);
      }
    }
  }, []);

  /**
   * Rename a cluster label (user override of auto-generated label)
   */
  const handleRenameCluster = useCallback(
    (clusterData) => {
      const clusterId = clusterData?.id || clusterData?.clusterId;
      const newLabel = clusterData?.newLabel;

      if (!clusterId || !newLabel) return;

      graphActions.setNodes((prev) =>
        prev.map((n) =>
          n.id === clusterId
            ? {
                ...n,
                data: {
                  ...n.data,
                  label: newLabel,
                  isAutoGenerated: false
                }
              }
            : n
        )
      );

      setGraphStatus(`Cluster renamed to "${newLabel}"`);
    },
    [graphActions]
  );

  /**
   * Expand all collapsed clusters in the graph
   */
  const handleExpandAllClusters = useCallback(async () => {
    const clusterNodes = nodes.filter(
      (n) => n.type === 'clusterNode' && n.data?.kind === 'cluster' && !n.data?.expanded
    );

    if (clusterNodes.length === 0) {
      setGraphStatus('All clusters are already expanded');
      return;
    }

    setGraphStatus(`Expanding ${clusterNodes.length} clusters...`);

    for (const cluster of clusterNodes) {
      const memberIds = cluster.data?.memberIds || [];
      if (memberIds.length > 0) {
        await expandClusterRef.current?.(cluster.id, memberIds);
        // Small delay to prevent UI freeze
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    setGraphStatus(`Expanded ${clusterNodes.length} clusters`);
  }, [nodes]);

  /**
   * Focus on a specific node - shows only the node and its neighbors up to focusDepth
   */
  const _handleFocusOnNode = useCallback(
    (nodeId) => {
      if (!nodeId) return;
      setFocusNodeId(nodeId);
      setGraphStatus(`Focused on node. Showing ${focusDepth} level(s) of connections.`);

      // Center view on focused node
      const node = nodes.find((n) => n.id === nodeId);
      if (node && reactFlowInstance.current) {
        reactFlowInstance.current.setCenter(node.position.x + 100, node.position.y + 50, {
          duration: 300,
          zoom: 1.2
        });
      }
    },
    [focusDepth, nodes]
  );

  /**
   * Clear focus mode - show all nodes again
   */
  const handleClearFocus = useCallback(() => {
    setFocusNodeId(null);
    setGraphStatus('Focus cleared - showing all nodes');
  }, []);

  /**
   * Get nodes visible in focus mode based on depth from focused node
   */
  const getNodesInFocus = useCallback(
    (nodeId, depth) => {
      if (!nodeId) return new Set();

      const visible = new Set([nodeId]);
      let frontier = [nodeId];

      for (let d = 0; d < depth; d++) {
        const next = [];
        for (const id of frontier) {
          // Find all connected nodes via edges
          edges.forEach((e) => {
            if (e.source === id && !visible.has(e.target)) {
              visible.add(e.target);
              next.push(e.target);
            } else if (e.target === id && !visible.has(e.source)) {
              visible.add(e.source);
              next.push(e.source);
            }
          });

          // Also include cluster members if this is a cluster node
          const node = nodes.find((n) => n.id === id);
          if (node?.data?.memberIds) {
            node.data.memberIds.forEach((memberId) => {
              if (!visible.has(memberId)) {
                visible.add(memberId);
                next.push(memberId);
              }
            });
          }
        }
        frontier = next;
      }

      return visible;
    },
    [edges, nodes]
  );

  /**
   * Collapse all expanded clusters in the graph
   */
  const handleCollapseAllClusters = useCallback(() => {
    const expandedClusters = nodes.filter(
      (n) => n.type === 'clusterNode' && n.data?.kind === 'cluster' && n.data?.expanded
    );

    if (expandedClusters.length === 0) {
      setGraphStatus('No expanded clusters to collapse');
      return;
    }

    // Collect all member IDs from expanded clusters
    const allMemberIds = new Set();
    expandedClusters.forEach((cluster) => {
      (cluster.data?.memberIds || []).forEach((id) => allMemberIds.add(id));
    });

    // Remove member nodes and mark clusters as collapsed
    graphActions.setNodes((prev) =>
      prev
        .filter((n) => !allMemberIds.has(n.id))
        .map((n) =>
          n.type === 'clusterNode' && n.data?.expanded
            ? { ...n, data: { ...n.data, expanded: false } }
            : n
        )
    );

    // Remove edges connected to member nodes
    graphActions.setEdges((prev) =>
      prev.filter((e) => !allMemberIds.has(e.source) && !allMemberIds.has(e.target))
    );

    setGraphStatus(`Collapsed ${expandedClusters.length} clusters`);
  }, [nodes, graphActions]);

  /**
   * Handle cluster expand/collapse from ClusterNode component
   * Looks up the cluster node and triggers expansion with memberIds
   */
  const handleClusterExpand = useCallback(
    (clusterId) => {
      // Use ref to get current nodes state to avoid stale closure issues
      const currentNodes = nodesRef.current || [];
      const clusterNode = currentNodes.find((n) => n.id === clusterId);

      if (!clusterNode) {
        logger.warn('[Graph] Cluster node not found for expand:', clusterId);
        return;
      }

      const memberIds = clusterNode.data?.memberIds || [];
      if (memberIds.length === 0) {
        logger.warn('[Graph] Cluster has no members to expand:', clusterId);
        return;
      }

      // Check if already expanded - toggle collapse
      if (clusterNode.data?.expanded) {
        // Collapse: remove member nodes and edges connected to them
        const memberIdSet = new Set(memberIds);
        graphActions.setNodes((prev) =>
          prev
            .filter((n) => !memberIdSet.has(n.id))
            .map((n) => (n.id === clusterId ? { ...n, data: { ...n.data, expanded: false } } : n))
        );
        graphActions.setEdges((prev) =>
          prev.filter((e) => !memberIdSet.has(e.source) && !memberIdSet.has(e.target))
        );
        setGraphStatus('Cluster collapsed');
      } else {
        // Expand using existing expandCluster function
        expandClusterRef.current?.(clusterId, memberIds);
      }
    },
    [graphActions]
  );

  useEffect(() => {
    clusterActionRefs.current = {
      onCreateSmartFolder: handleCreateSmartFolderFromCluster,
      onMoveAllToFolder: handleMoveAllToFolder,
      onExportFileList: handleExportFileList,
      onOpenAllFiles: handleOpenAllFilesInCluster,
      onSearchWithinCluster: handleSearchWithinCluster,
      onRenameCluster: handleRenameCluster,
      onExpand: handleClusterExpand
    };
  }, [
    handleCreateSmartFolderFromCluster,
    handleMoveAllToFolder,
    handleExportFileList,
    handleOpenAllFilesInCluster,
    handleSearchWithinCluster,
    handleRenameCluster,
    handleClusterExpand
  ]);

  /**
   * Find near-duplicate files across the collection
   * Displays them as special clusters in the graph
   */
  const handleFindDuplicates = useCallback(async () => {
    setIsFindingDuplicates(true);
    setError('');
    setDuplicateGroups([]);

    try {
      const result = await window.electronAPI?.embeddings?.findDuplicates?.({
        threshold: 0.9,
        maxResults: 30
      });

      if (!result?.success) {
        setError(result?.error || 'Failed to find duplicates');
        return;
      }

      if (result.groups.length === 0) {
        setGraphStatus('No duplicate files found');
        return;
      }

      // Store duplicate groups
      setDuplicateGroups(result.groups);

      // Display duplicates as special cluster nodes
      const dupNodes = result.groups.map((group, idx) => ({
        id: group.id,
        type: 'clusterNode',
        position: defaultNodePosition(idx),
        data: {
          kind: 'duplicate',
          label: `Duplicates (${Math.round(group.averageSimilarity * 100)}% similar)`,
          memberCount: group.memberCount,
          memberIds: group.members.map((m) => m.id),
          expanded: false,
          confidence: 'high',
          dominantCategory: 'Duplicate Group',
          commonTags: [],
          isAutoGenerated: true,
          onCreateSmartFolder: handleCreateSmartFolderFromCluster,
          onMoveAllToFolder: handleMoveAllToFolder,
          onExportFileList: handleExportFileList,
          // New action callbacks
          onOpenAllFiles: handleOpenAllFilesInCluster,
          onSearchWithinCluster: handleSearchWithinCluster,
          onRenameCluster: handleRenameCluster,
          // Expand/collapse callback
          onExpand: handleClusterExpand
        },
        draggable: true
      }));

      graphActions.setNodes(dupNodes);
      graphActions.setEdges([]);
      setShowClusters(false);
      setGraphStatus(
        `Found ${result.groups.length} duplicate group(s) with ${result.totalDuplicates} files`
      );
    } catch (e) {
      logger.error('[Graph] Find duplicates failed', e);
      setError(`Find duplicates failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setIsFindingDuplicates(false);
    }
  }, [
    handleCreateSmartFolderFromCluster,
    handleMoveAllToFolder,
    handleExportFileList,
    handleOpenAllFilesInCluster,
    handleSearchWithinCluster,
    handleRenameCluster,
    handleClusterExpand,
    graphActions
  ]);

  // ============================================================================
  // Debounce query
  // ============================================================================

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), TIMEOUTS.DEBOUNCE_INPUT);
    return () => clearTimeout(handle);
  }, [query]);

  // ============================================================================
  // Search Tab Logic
  // ============================================================================

  const selectedSearchResult = useMemo(
    () => (selectedSearchId ? searchResults.find((r) => r?.id === selectedSearchId) : null),
    [searchResults, selectedSearchId]
  );

  // NOTE: selectedNode must be defined before the useEffect below that uses it
  const selectedNode = useMemo(
    () => (selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null),
    [nodes, selectedNodeId]
  );

  // Fetch full details (including extracted text) when selection changes
  useEffect(() => {
    // Determine the path to fetch details for
    const path =
      activeTab === 'search'
        ? selectedSearchResult?.metadata?.path
        : selectedNode?.data?.kind === 'file'
          ? freshMetadata?.path || selectedNode.data?.path
          : null;

    if (!path) {
      setSelectedDocumentDetails(null);
      return undefined;
    }

    // Don't re-fetch if we already have details for this path
    if (
      selectedDocumentDetails?.metadata?.path === path ||
      selectedDocumentDetails?.originalPath === path
    )
      return undefined;

    let cancelled = false;
    const fetchDetails = async () => {
      setIsLoadingDocumentDetails(true);
      try {
        const history = await window.electronAPI?.analysisHistory?.getFileHistory?.(path);
        if (!cancelled && history) {
          setSelectedDocumentDetails(history);
        }
      } catch (err) {
        logger.warn('Failed to fetch document details', err);
      } finally {
        if (!cancelled) setIsLoadingDocumentDetails(false);
      }
    };
    fetchDetails();
    return () => {
      cancelled = true;
    };
  }, [selectedSearchResult, selectedNode, freshMetadata, selectedDocumentDetails, activeTab]);

  useEffect(() => {
    if (activeTab !== 'search') return undefined;
    let cancelled = false;

    const run = async () => {
      if (!isOpen) return;
      const q = debouncedQuery;
      if (!q || q.length < 2) {
        setSearchResults([]);
        setSelectedSearchId(null);
        setQueryMeta(null);
        setSearchMeta(null);
        setError('');
        return;
      }

      const requestId = (searchRequestCounterRef.current += 1);
      lastSearchRef.current = requestId;
      setIsSearching(true);
      setError('');

      try {
        logger.info('[KnowledgeOS] Search started', {
          queryLength: q.length,
          topK: defaultTopK,
          mode: 'hybrid'
        });

        // Use hybrid search with LLM re-ranking for top results
        const response = await window.electronAPI?.embeddings?.search?.(q, {
          topK: defaultTopK,
          mode: 'hybrid',
          rerank: true, // Enable LLM re-ranking
          rerankTopN: 10 // Re-rank top 10 results
        });
        if (cancelled) return;
        if (lastSearchRef.current !== requestId) return;

        // FIX: Use proper validation to ensure response structure is valid
        const validation = validateSearchResponse(response, 'Search');
        if (!validation.valid) {
          setSearchResults([]);
          setSelectedSearchId(null);
          setError(getErrorMessage({ message: validation.error }, 'Search'));
          return;
        }

        const next = validation.results;
        setSearchResults(next);
        setSelectedSearchId(next[0]?.id || null);
        setBulkSelectedIds(new Set()); // Clear bulk selection on new results
        // Store query processing metadata for "Did you mean?" feedback
        setQueryMeta(response.queryMeta || null);
        // Store search mode metadata (fallback detection)
        setSearchMeta({
          mode: response.mode || 'hybrid',
          fallback: response.meta?.fallback || false,
          fallbackReason: response.meta?.fallbackReason || null,
          originalMode: response.meta?.originalMode || null
        });

        logger.info('[KnowledgeOS] Search completed', {
          resultCount: next.length,
          mode: response.mode || 'hybrid',
          fallback: Boolean(response.meta?.fallback),
          fallbackReason: response.meta?.fallbackReason || null
        });
      } catch (e) {
        if (cancelled) return;
        if (lastSearchRef.current !== requestId) return;
        logger.warn('[KnowledgeOS] Search failed', { error: e?.message || e });
        setSearchResults([]);
        setSelectedSearchId(null);
        setError(getErrorMessage(e, 'Search'));
      } finally {
        // Only reset if this request is still the latest.
        // Avoid clearing the loading state for newer in-flight requests.
        if (lastSearchRef.current === requestId) {
          setIsSearching(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // searchRefreshTrigger triggers re-search when files are moved/deleted
  }, [debouncedQuery, isOpen, defaultTopK, activeTab, searchRefreshTrigger]);

  const searchStatusLabel = useMemo(() => {
    if (isSearching) return 'Searching...';
    if (error) return 'Search error';
    if (!debouncedQuery || debouncedQuery.length < 2) return 'Type to search';
    return `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`;
  }, [isSearching, error, debouncedQuery, searchResults.length]);

  // Group results by file type category
  const groupedResults = useMemo(() => {
    if (!searchResults.length) return {};
    const groups = {};
    searchResults.forEach((result) => {
      const name = result?.metadata?.name || result?.id || '';
      const category = getFileCategory(name);
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(result);
    });
    // Sort categories by count (most results first)
    const sortedCategories = Object.keys(groups).sort(
      (a, b) => groups[b].length - groups[a].length
    );
    const sortedGroups = {};
    sortedCategories.forEach((cat) => {
      sortedGroups[cat] = groups[cat];
    });
    return sortedGroups;
  }, [searchResults]);

  // Pre-compute ID-to-index map for O(1) lookup in grouped view
  const resultIdToIndex = useMemo(() => {
    const map = new Map();
    searchResults.forEach((r, i) => map.set(r.id, i));
    return map;
  }, [searchResults]);

  // ============================================================================
  // Graph Tab Logic
  // ============================================================================

  const fileNodeIds = useMemo(
    () => nodes.filter((n) => n?.data?.kind === 'file').map((n) => n.id),
    [nodes]
  );

  // Fetch fresh metadata from ChromaDB when a file node is selected
  // This ensures we show the CURRENT file path after files have been moved/organized
  useEffect(() => {
    if (!selectedNode || selectedNode.data?.kind !== 'file') {
      setFreshMetadata(null);
      return undefined;
    }

    let cancelled = false;
    const nodeId = selectedNode.id;

    const fetchFreshMetadata = async () => {
      setIsLoadingMetadata(true);
      try {
        const resp = await window.electronAPI?.embeddings?.getFileMetadata?.([nodeId]);
        if (!cancelled && resp?.success) {
          setFreshMetadata(resp.metadata?.[nodeId] || null);
        }
      } catch {
        // Silently fail - use cached metadata from node
        if (!cancelled) setFreshMetadata(null);
      } finally {
        if (!cancelled) setIsLoadingMetadata(false);
      }
    };

    fetchFreshMetadata();
    return () => {
      cancelled = true;
    };
  }, [selectedNode]);

  const upsertFileNode = useCallback(
    (result, preferredPosition) => {
      const id = result?.id;
      if (!id) return null;
      const metadata = result?.metadata || {};
      const path = metadata.path || '';
      const name = metadata.name || safeBasename(path) || id;
      const score = typeof result?.score === 'number' ? result.score : undefined;

      // Parse tags from JSON string (ChromaDB stores as string) or use array directly
      let tags = [];
      if (Array.isArray(metadata.tags)) {
        tags = metadata.tags;
      } else if (typeof metadata.tags === 'string' && metadata.tags) {
        try {
          tags = JSON.parse(metadata.tags);
        } catch {
          tags = [];
        }
      }
      const category = metadata.category || getFileCategory(path);
      const suggestedFolder = recommendationMap[path] || '';
      const subject = metadata.subject || (suggestedFolder ? `Folder: ${suggestedFolder}` : '');
      const summary = metadata.summary || '';
      const content = result?.document || '';

      return {
        id,
        type: 'fileNode', // Custom node type for card-like styling
        position: preferredPosition || { x: 0, y: 0 },
        data: {
          kind: 'file',
          label: name,
          path,
          score,
          tags: normalizeList(tags.length > 0 ? tags : metadata.keywords).slice(0, 5),
          entities: normalizeList(metadata.keyEntities).slice(0, 5),
          dates: normalizeList(metadata.dates).slice(0, 3),
          suggestedFolder,
          category,
          subject,
          summary,
          content
        },
        draggable: true
      };
    },
    [recommendationMap]
  );

  /**
   * Apply ELK layout to current graph nodes and edges
   */
  const applyLayout = useCallback(async () => {
    if (nodes.length === 0) return;

    setIsLayouting(true);
    setGraphStatus('Applying layout...');

    try {
      const { nodes: layoutedNodes, edges: layoutedEdges } = await elkLayout(nodes, edges, {
        direction: 'RIGHT',
        spacing: GRAPH_LAYOUT_SPACING,
        layerSpacing: GRAPH_LAYER_SPACING
      });

      graphActions.setNodes(layoutedNodes);
      if (layoutedEdges && layoutedEdges.length > 0) {
        graphActions.setEdges(layoutedEdges);
      }
      setGraphStatus('Layout applied');
    } catch (error) {
      logger.error('[Graph] Layout failed:', error);
      setGraphStatus('Layout failed');
    } finally {
      setIsLayouting(false);
    }
  }, [nodes, edges, graphActions]);

  /**
   * Handle drag over for file drops to graph
   */
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Check if this is a file drop
    if (
      e.dataTransfer?.types?.includes('Files') ||
      e.dataTransfer?.types?.includes('text/uri-list')
    ) {
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, []);

  /**
   * Handle drag leave
   */
  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set false if we're leaving the container (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragOver(false);
    }
  }, []);

  /**
   * Handle file drop to add files to graph
   */
  const handleFileDrop = useCallback(
    async (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (!e.dataTransfer) return;

      // Get dropped files
      const fileList = Array.from(e.dataTransfer.files || []);
      if (fileList.length === 0) return;

      setGraphStatus(`Looking up ${fileList.length} file${fileList.length > 1 ? 's' : ''}...`);

      try {
        const addedNodes = [];
        const addedEdges = [];

        for (const file of fileList) {
          // Get file path - on Electron, dropped files have a path property
          const filePath = file.path;
          if (!filePath) continue;

          // Search for this file by name to find it in ChromaDB
          const fileName = filePath.split(/[\\/]/).pop();
          const searchResp = await window.electronAPI?.embeddings?.search?.(fileName, {
            topK: 20,
            mode: 'hybrid'
          });

          if (!searchResp?.success || !searchResp.results?.length) {
            logger.debug('[Graph] File not found in index:', fileName);
            continue;
          }

          // Find exact path match in results
          const matchingResult = searchResp.results.find(
            (r) => r.metadata?.path?.toLowerCase() === filePath.toLowerCase()
          );

          if (!matchingResult) {
            logger.debug('[Graph] No exact path match for:', filePath);
            continue;
          }

          // Calculate position for the new node
          const existingNodeCount = nodes.length + addedNodes.length;
          const pos = defaultNodePosition(existingNodeCount);

          // Create node using upsertFileNode
          const node = upsertFileNode(matchingResult, pos);
          if (node) {
            // Check if node already exists
            const existingNode = nodes.find((n) => n.id === node.id);
            if (!existingNode) {
              addedNodes.push(node);
            }
          }
        }

        if (addedNodes.length === 0) {
          setError('Dropped files not found in index. Try analyzing them first.');
          setGraphStatus('');
          return;
        }

        // Add new nodes to graph
        graphActions.setNodes((prev) => [...prev, ...addedNodes]);

        // If we have existing nodes, try to find similarity connections
        if (nodes.length > 0 && addedNodes.length > 0) {
          try {
            const existingIds = nodes.map((n) => n.id);
            const newIds = addedNodes.map((n) => n.id);

            // Get similarity edges between new and existing nodes
            for (const newId of newIds) {
              const simResp = await window.electronAPI?.embeddings?.findSimilar?.(newId, 5);
              if (simResp?.success && simResp.results) {
                for (const sim of simResp.results) {
                  if (existingIds.includes(sim.id) && sim.score > 0.5) {
                    addedEdges.push({
                      id: `e:${newId}->${sim.id}`,
                      source: newId,
                      target: sim.id,
                      type: 'similarity',
                      animated: false,
                      data: {
                        kind: 'similarity',
                        score: sim.score,
                        showEdgeLabels: showEdgeLabelsRef.current
                      }
                    });
                  }
                }
              }
            }
          } catch (simErr) {
            logger.debug('[Graph] Failed to get similarity edges for dropped files:', simErr);
          }
        }

        // Add edges if any
        if (addedEdges.length > 0) {
          graphActions.setEdges((prev) => {
            const existingIds = new Set(prev.map((e) => e.id));
            const newEdges = addedEdges.filter((e) => !existingIds.has(e.id));
            return [...prev, ...newEdges];
          });
        }

        // Apply layout if auto-layout is enabled
        if (autoLayout && addedNodes.length > 0) {
          const allNodes = [...nodes, ...addedNodes];
          const allEdges = [...edges, ...addedEdges];
          try {
            const { nodes: layoutedNodes, edges: layoutedEdges } = await debouncedElkLayout(
              allNodes,
              allEdges,
              {
                direction: 'RIGHT',
                spacing: GRAPH_LAYOUT_SPACING,
                layerSpacing: GRAPH_LAYER_SPACING
              }
            );
            graphActions.setNodes(layoutedNodes);
            if (layoutedEdges && layoutedEdges.length > 0) {
              graphActions.setEdges(layoutedEdges);
            }
          } catch (layoutErr) {
            logger.debug('[Graph] Layout after drop failed:', layoutErr);
          }
        }

        setGraphStatus(
          `Added ${addedNodes.length} file${addedNodes.length > 1 ? 's' : ''} to graph`
        );
      } catch (err) {
        logger.error('[Graph] File drop failed:', err);
        setError('Failed to add files to graph');
        setGraphStatus('');
      }
    },
    [nodes, edges, graphActions, upsertFileNode, autoLayout]
  );

  /**
   * Load and display semantic clusters
   */
  const loadClusters = useCallback(async () => {
    setIsComputingClusters(true);
    setGraphStatus('Analyzing file relationships...');
    setError('');

    try {
      // First compute clusters
      const computeResp = await window.electronAPI?.embeddings?.computeClusters?.('auto');
      if (!computeResp || computeResp.success !== true) {
        throw new Error(computeResp?.error || 'Failed to compute clusters');
      }

      // Get clusters for display
      const clustersResp = await window.electronAPI?.embeddings?.getClusters?.();
      if (!clustersResp || clustersResp.success !== true) {
        throw new Error(clustersResp?.error || 'Failed to get clusters');
      }

      const clusters = clustersResp.clusters || [];
      const crossClusterEdges = clustersResp.crossClusterEdges || [];

      if (clusters.length === 0) {
        setGraphStatus('No related groups found yet. Try indexing more files.');
        return;
      }

      // Create cluster nodes with rich metadata
      const clusterNodes = clusters.map((cluster, idx) => ({
        id: cluster.id,
        type: 'clusterNode',
        position: defaultNodePosition(idx),
        data: {
          kind: 'cluster',
          id: cluster.id,
          clusterId: cluster.clusterId,
          label: cluster.label,
          memberCount: cluster.memberCount,
          memberIds: cluster.memberIds,
          expanded: false,
          // Rich metadata for meaningful cluster display
          confidence: cluster.confidence || 'low',
          dominantCategory: cluster.dominantCategory || null,
          commonTags: cluster.commonTags || [],
          isAutoGenerated: true,
          // Action callbacks for cluster context menu
          onCreateSmartFolder: handleCreateSmartFolderFromCluster,
          onMoveAllToFolder: handleMoveAllToFolder,
          onExportFileList: handleExportFileList,
          // New action callbacks
          onOpenAllFiles: handleOpenAllFilesInCluster,
          onSearchWithinCluster: handleSearchWithinCluster,
          onRenameCluster: handleRenameCluster,
          // Expand/collapse callback
          onExpand: handleClusterExpand
        },
        draggable: true
      }));

      // Create cross-cluster edges with visible similarity labels
      // Dynamic filtering: reduce clutter by keeping only top connections per cluster

      // 1. Deduplicate edges (A->B and B->A are the same connection)
      const uniqueEdgesMap = new Map();
      crossClusterEdges.forEach((edge) => {
        // Create a sorted key so A->B and B->A produce the same key "A-B" (if A < B)
        const [u, v] = [edge.source, edge.target].sort();
        const key = `${u}|${v}`;

        // Keep the one with higher similarity if duplicates exist (though usually they are equal)
        if (
          !uniqueEdgesMap.has(key) ||
          (edge.similarity || 0) > (uniqueEdgesMap.get(key).similarity || 0)
        ) {
          uniqueEdgesMap.set(key, edge);
        }
      });
      const uniqueEdges = Array.from(uniqueEdgesMap.values());

      // 2. Group by source to limit connections per cluster
      const edgesByNode = new Map();
      uniqueEdges.forEach((edge) => {
        // Add to source bucket
        if (!edgesByNode.has(edge.source)) edgesByNode.set(edge.source, []);
        edgesByNode.get(edge.source).push(edge);

        // Add to target bucket too so we count connections for both sides
        if (!edgesByNode.has(edge.target)) edgesByNode.set(edge.target, []);
        edgesByNode.get(edge.target).push(edge);
      });

      // 3. Strict filtering: Only keep edges that are among the "Top N" for BOTH nodes
      // or at least very strong. This creates a "Nearest Neighbor" graph.
      const MAX_CONNECTIONS = 2;
      const STRICT_THRESHOLD = 0.65;

      const meaningfulEdges = uniqueEdges.filter((edge) => {
        const sim = edge.similarity || 0;
        if (sim < STRICT_THRESHOLD) return false;

        // Check if this edge is important for Source
        const sourceEdges = edgesByNode.get(edge.source) || [];
        sourceEdges.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
        const isTopForSource = sourceEdges.indexOf(edge) < MAX_CONNECTIONS;

        // Check if this edge is important for Target
        const targetEdges = edgesByNode.get(edge.target) || [];
        targetEdges.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
        const isTopForTarget = targetEdges.indexOf(edge) < MAX_CONNECTIONS;

        // Keep if it's a top connection for EITHER side (to ensure connectivity)
        return isTopForSource || isTopForTarget;
      });

      const clusterEdges = meaningfulEdges.map((edge) => ({
        id: `cross:${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
        type: 'similarity',
        animated: true,
        style: {
          stroke: '#9ca3af',
          strokeWidth: Math.max(1, (edge.similarity || 0.5) * 1.5), // Even thinner
          strokeDasharray: '4,8', // Very sparse dashing
          opacity: 0 // Hidden by default (faded out), will be shown on hover via class/state
        },
        className: 'cross-cluster-edge opacity-0 transition-opacity duration-300', // CSS class for control
        data: {
          kind: 'cross_cluster',
          similarity: edge.similarity || 0.5
        }
      }));

      // Update graph
      graphActions.setNodes(clusterNodes);
      graphActions.setEdges(clusterEdges);
      setShowClusters(true);
      setGraphStatus(`Found ${clusters.length} groups of related files`);

      // Apply intelligent layout for better cluster visualization
      // Layout considers: confidence levels (inner/outer rings), relationships (connected clusters nearby)
      if (clusterNodes.length > 0) {
        try {
          // Calculate dynamic radius based on cluster count and card size to prevent overlap
          const estimatedArcWidth = 320 + 140; // cluster card width + padding
          const minRadius = 450;
          const dynamicRadius = Math.max(
            minRadius,
            (Math.max(clusterNodes.length, 1) * estimatedArcWidth) / (2 * Math.PI)
          );

          const layoutedNodes = clusterRadialLayout(clusterNodes, clusterEdges, {
            centerX: 450,
            centerY: 320,
            radius: dynamicRadius
          });
          graphActions.setNodes(layoutedNodes);

          // Update status with celebration or regular info
          const highCount = clusters.filter((c) => c.confidence === 'high').length;
          const firstClusterLabel = clusters[0]?.label || 'your files';

          // First time celebration - explain what happened
          if (!hasShownClusterCelebration.current) {
            hasShownClusterCelebration.current = true;
            setGraphStatus(
              `Discovered ${clusters.length} groups! Try double-clicking "${firstClusterLabel}" to explore.`
            );
          } else if (highCount > 0) {
            setGraphStatus(
              `Found ${clusters.length} groups (${highCount} strong match${highCount > 1 ? 'es' : ''})`
            );
          }
        } catch (layoutError) {
          logger.warn('[Graph] Cluster layout failed:', layoutError);
        }
      }
    } catch (e) {
      setError(getErrorMessage(e, 'Cluster loading'));
      setGraphStatus('');
    } finally {
      setIsComputingClusters(false);
    }
  }, [
    handleCreateSmartFolderFromCluster,
    handleMoveAllToFolder,
    handleExportFileList,
    handleOpenAllFilesInCluster,
    handleSearchWithinCluster,
    handleRenameCluster,
    handleClusterExpand,
    graphActions
  ]);

  // Assign to ref so keyboard shortcuts can access it
  loadClustersRef.current = loadClusters;

  // Auto-load clusters when opening graph tab (if files are indexed)
  useEffect(() => {
    if (!isOpen || activeTab !== 'graph') return;
    if (hasAutoLoadedClusters.current) return;
    if (nodes.length > 0) return; // Already have nodes
    if (!stats?.files || stats.files === 0) return; // No indexed files
    if (!enableAutoClustering) return; // Skip if auto-clustering is disabled

    // Auto-load clusters to give users something to explore
    hasAutoLoadedClusters.current = true;
    loadClusters();
  }, [isOpen, activeTab, stats, nodes.length, loadClusters, enableAutoClustering]);

  // Real-time updates: Listen for file operations
  useEffect(() => {
    const handleFileOperation = async (event) => {
      const detail = event.detail || {};
      const operationType = detail.operationType || detail.operation;

      if (!operationType) return;

      if (operationType === 'delete') {
        const deletedPaths = Array.isArray(detail.files)
          ? detail.files
          : [detail.filePath || detail.oldPath].filter(Boolean);
        if (deletedPaths.length === 0) return;

        // Remove nodes for deleted paths
        graphActions.setNodes((prev) => prev.filter((n) => !deletedPaths.includes(n.data?.path)));
        return;
      }

      if (operationType === 'move' || operationType === 'rename') {
        let pathPairs = [];

        if (
          Array.isArray(detail.files) &&
          Array.isArray(detail.destinations) &&
          detail.files.length === detail.destinations.length
        ) {
          pathPairs = detail.files.map((oldPath, index) => ({
            oldPath,
            newPath: detail.destinations[index]
          }));
        } else {
          const oldPath = detail.filePath || detail.oldPath;
          const newPath = detail.destPath || detail.newPath;
          if (oldPath && newPath) {
            pathPairs = [{ oldPath, newPath }];
          }
        }

        if (pathPairs.length === 0) return;

        graphActions.setNodes((prev) =>
          prev.map((n) => {
            const match = pathPairs.find((pair) => pair.oldPath === n.data?.path);
            if (!match) return n;
            return {
              ...n,
              data: {
                ...n.data,
                path: match.newPath,
                label: safeBasename(match.newPath)
              }
            };
          })
        );
      }
    };

    window.addEventListener('file-operation-complete', handleFileOperation);
    return () => window.removeEventListener('file-operation-complete', handleFileOperation);
  }, [graphActions]);

  /**
   * Expand a cluster to show its members with current file names
   */
  const expandCluster = useCallback(
    async (clusterId, memberIds) => {
      if (!Array.isArray(memberIds) || memberIds.length === 0) return;

      setGraphStatus('Expanding cluster...');

      try {
        // Get cluster node for layout calculation - use ref for latest nodes
        const currentNodes = nodesRef.current || [];
        const clusterNode = currentNodes.find((n) => n.id === clusterId);

        // Fetch actual file metadata to get current names (not original names)
        let membersWithMetadata = [];
        try {
          // Extract numeric cluster ID from the string ID (e.g., "cluster:0" -> 0)
          const numericClusterId = parseInt(clusterId.replace('cluster:', ''), 10);
          const memberResp =
            await window.electronAPI?.embeddings?.getClusterMembers?.(numericClusterId);

          if (memberResp?.success && Array.isArray(memberResp.members)) {
            membersWithMetadata = memberResp.members;
          }
        } catch (fetchErr) {
          logger.warn('[Graph] Failed to fetch cluster members metadata:', fetchErr);
        }

        // Build a map of id -> metadata for quick lookup
        const metadataMap = new Map(membersWithMetadata.map((m) => [m.id, m.metadata || {}]));

        // Create file nodes with proper current names from metadata
        const memberNodes = memberIds.map((id) => {
          const metadata = metadataMap.get(id) || {};
          // Use metadata.name first (current organized name), fallback to path extraction
          const currentName =
            metadata.name ||
            safeBasename(metadata.path) ||
            safeBasename(id) ||
            id.split('/').pop() ||
            id.split('\\').pop() ||
            id;

          return {
            id,
            type: 'fileNode',
            position: { x: 0, y: 0 }, // Will be set by layout
            data: {
              kind: 'file',
              label: currentName,
              path: metadata.path || id,
              // Include metadata for edge tooltips
              tags: Array.isArray(metadata.tags) ? metadata.tags : [],
              entities: normalizeList(metadata.keyEntities).slice(0, 5),
              dates: normalizeList(metadata.dates).slice(0, 3),
              suggestedFolder: recommendationMap[metadata.path] || '',
              category: metadata.category || '',
              subject: metadata.subject || ''
            },
            draggable: true
          };
        });

        // Apply expansion layout to position nodes nicely
        // Use smart dynamic layout that adjusts radius and angle based on count
        // Point the fan AWAY from the center of the graph (approx 450, 320) to avoid overlap
        const layoutedMemberNodes = clusterExpansionLayout(clusterNode, memberNodes, {
          offsetX: 320, // Base radius
          spacing: 80, // Arc length per node
          minAngle: Math.PI / 4, // Minimum arc for small clusters
          origin: { x: 450, y: 320 } // Center of the graph layout
        });

        // Create edges from cluster to members (Distinct visual style)
        // Use smooth bezier curves instead of straight lines for a more organic feel
        const memberEdges = memberIds.map((id) => ({
          id: `cluster:${clusterId}->${id}`,
          source: clusterId,
          target: id,
          type: 'default', // Using default bezier curve instead of straight
          animated: false,
          style: {
            stroke: '#fbbf24', // Amber-400
            strokeWidth: 1.5,
            opacity: 0.4
          },
          data: { kind: 'cluster_member' }
        }));

        const { folderNodes, edges: organizeEdges } = buildRecommendationGraph(layoutedMemberNodes);

        // Add to existing graph
        graphActions.setNodes((prev) => {
          const existingIds = new Set(prev.map((n) => n.id));
          const newNodes = layoutedMemberNodes.filter((n) => !existingIds.has(n.id));

          // Mark cluster as expanded
          const updated = prev.map((n) => {
            if (n.id === clusterId) {
              return { ...n, data: { ...n.data, expanded: true } };
            }
            return n;
          });

          const withFolders = folderNodes.filter((n) => !existingIds.has(n.id));
          return [...updated, ...newNodes, ...withFolders];
        });

        graphActions.setEdges((prev) => {
          const existingIds = new Set(prev.map((e) => e.id));
          const newEdges = memberEdges.filter((e) => !existingIds.has(e.id));
          const newOrganizeEdges = organizeEdges.filter((e) => !existingIds.has(e.id));
          return [...prev, ...newEdges, ...newOrganizeEdges];
        });

        setGraphStatus(
          `${layoutedMemberNodes.length} related files. Right-click cluster to organize them.`
        );
      } catch (e) {
        setError(getErrorMessage(e, 'Cluster expansion'));
        setGraphStatus('');
      }
    },
    [graphActions, recommendationMap]
  );

  // Assign to ref so handleClusterExpand can access it
  expandClusterRef.current = expandCluster;

  const runGraphSearch = useCallback(
    async (overrideQuery) => {
      // Accept overrideQuery to support immediate search from autocomplete
      // without waiting for state update
      const q = (typeof overrideQuery === 'string' ? overrideQuery : query).trim();
      if (q.length < 2) return;

      // Update query state if using override (keeps UI in sync)
      if (typeof overrideQuery === 'string' && overrideQuery !== query) {
        setQuery(overrideQuery);
      }

      // Capture addMode at search start to prevent race condition if user toggles during async operation
      const shouldAddMode = addMode;

      setError('');
      setGraphStatus('Searching...');

      try {
        // Use hybrid search with LLM re-ranking for graph results
        const resp = await window.electronAPI?.embeddings?.search?.(q, {
          topK: defaultTopK,
          mode: 'hybrid',
          rerank: true, // Enable LLM re-ranking
          rerankTopN: 10 // Re-rank top 10 results
        });
        if (!resp || resp.success !== true) {
          throw new Error(resp?.error || 'Search failed');
        }

        const results = Array.isArray(resp.results) ? resp.results : [];
        const salt = Date.now();
        const queryNodeId = makeQueryNodeId(q, salt);

        const nextNodes = [];
        const nextEdges = [];

        const queryNode = {
          id: queryNodeId,
          type: 'queryNode', // Custom query node type
          position: { x: 40, y: 40 },
          data: { kind: 'query', label: q },
          draggable: true
        };

        nextNodes.push(queryNode);

        results.forEach((r, idx) => {
          const node = upsertFileNode(r, defaultNodePosition(idx));
          if (!node) return;
          nextNodes.push(node);
          nextEdges.push({
            id: `e:${queryNodeId}->${node.id}`,
            source: queryNodeId,
            target: node.id,
            type: 'queryMatch',
            animated: false, // Using custom edge with hover effects
            data: {
              kind: 'query_match',
              score: r.score,
              matchDetails: r.matchDetails || {}
            }
          });
        });

        const { folderNodes, edges: organizeEdges } = buildRecommendationGraph(
          nextNodes.filter((node) => node.type === 'fileNode')
        );
        if (folderNodes.length > 0) {
          nextNodes.push(...folderNodes);
          nextEdges.push(...organizeEdges);
        }

        // Compute final nodes and edges FIRST to avoid stale closure issues
        // These values are used for both state update and layout calculation
        let finalNodes;
        let finalEdges;
        let nodeLimitReached = false;

        if (!shouldAddMode) {
          // Replace mode - use nextNodes directly
          if (nextNodes.length > MAX_GRAPH_NODES) {
            finalNodes = nextNodes.slice(0, MAX_GRAPH_NODES);
            nodeLimitReached = true;
            setError(
              `Graph limit (${MAX_GRAPH_NODES} nodes) exceeded. Showing first ${MAX_GRAPH_NODES} results.`
            );
          } else {
            finalNodes = nextNodes;
          }
          finalEdges = nextEdges;
        } else {
          // Add mode - merge with current state using refs to get latest values
          // This prevents stale closure issues when state changes during async operation
          const currentNodes = nodesRef.current || [];
          const currentEdges = edgesRef.current || [];

          const nodeMap = new Map(currentNodes.map((n) => [n.id, n]));
          nextNodes.forEach((n) => {
            if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
          });
          const merged = Array.from(nodeMap.values());

          if (merged.length > MAX_GRAPH_NODES) {
            // Don't add more nodes if limit reached
            finalNodes = currentNodes;
            nodeLimitReached = true;
            setError(`Graph limit (${MAX_GRAPH_NODES} nodes) reached. Clear graph to start fresh.`);
          } else {
            finalNodes = merged;
          }

          const edgeMap = new Map(currentEdges.map((e) => [e.id, e]));
          nextEdges.forEach((e) => edgeMap.set(e.id, e));

          finalEdges = Array.from(edgeMap.values());
        }

        // Filter edges to only include those where both source and target exist in finalNodes
        // This prevents ELK layout errors and orphaned edges (especially after node limiting)
        const finalNodeIds = new Set(finalNodes.map((n) => n.id));
        finalEdges = finalEdges.filter(
          (e) => finalNodeIds.has(e.source) && finalNodeIds.has(e.target)
        );

        // Now update state with computed values (only if there are changes)
        graphActions.setNodes((prev) => {
          // Skip update if nothing changed (add mode and limit reached)
          if (nodeLimitReached && shouldAddMode) return prev;
          // Check if update is needed
          if (
            prev.length === finalNodes.length &&
            prev.every((n, i) => n.id === finalNodes[i]?.id)
          ) {
            return prev;
          }
          return finalNodes;
        });

        graphActions.setEdges((prev) => {
          if (nodeLimitReached && shouldAddMode) return prev;
          if (
            prev.length === finalEdges.length &&
            prev.every((e, i) => e.id === finalEdges[i]?.id)
          ) {
            return prev;
          }
          return finalEdges;
        });

        graphActions.selectNode(results[0]?.id || queryNodeId);
        setGraphStatus(`Found ${results.length} matching file${results.length === 1 ? '' : 's'}`);

        // Apply auto-layout if enabled (debounced to prevent rapid re-layouts)
        // Uses pre-computed finalNodes/finalEdges to avoid stale state issues
        if (autoLayout && finalNodes.length > 1 && !nodeLimitReached) {
          setGraphStatus('Applying layout...');
          try {
            // Use smart layout for large graphs (progressive rendering)
            // Use debounced layout for smaller graphs
            let layoutedNodes;
            if (finalNodes.length > LARGE_GRAPH_THRESHOLD) {
              const result = await smartLayout(finalNodes, finalEdges, {
                direction: 'RIGHT',
                spacing: GRAPH_LAYOUT_SPACING,
                layerSpacing: GRAPH_LAYER_SPACING,
                progressive: true
              });
              layoutedNodes = result.nodes;
              if (result.edges && result.edges.length > 0) {
                graphActions.setEdges(result.edges);
              }
              if (result.isPartial) {
                setGraphStatus(
                  `${results.length} results (${result.layoutedCount} laid out, ${finalNodes.length - result.layoutedCount} in grid)`
                );
              }
            } else {
              const layoutResult = await debouncedElkLayout(finalNodes, finalEdges, {
                direction: 'RIGHT',
                spacing: GRAPH_LAYOUT_SPACING,
                layerSpacing: GRAPH_LAYER_SPACING,
                debounceMs: 150
              });
              layoutedNodes = layoutResult.nodes;
              if (layoutResult.edges && layoutResult.edges.length > 0) {
                graphActions.setEdges(layoutResult.edges);
              }
            }
            graphActions.setNodes(layoutedNodes);
            if (finalNodes.length <= LARGE_GRAPH_THRESHOLD) {
              setGraphStatus(
                `Found ${results.length} file${results.length === 1 ? '' : 's'}, organized by relevance`
              );
            }
          } catch (layoutError) {
            logger.warn('[Graph] Auto-layout failed:', layoutError);
          }
        }

        // Fetch and add similarity edges between file nodes
        const expandedFileIds = nextNodes.filter((n) => n.type === 'fileNode').map((n) => n.id);

        if (expandedFileIds.length >= 2) {
          try {
            const simEdgesResp = await window.electronAPI?.embeddings?.getSimilarityEdges?.(
              expandedFileIds,
              { threshold: 0.75, maxEdgesPerNode: 1 }
            );

            if (simEdgesResp?.success && Array.isArray(simEdgesResp.edges)) {
              // Build a map of node data for tooltip info
              const nodeDataMap = new Map();
              nextNodes.forEach((n) => {
                if (n.type === 'fileNode') {
                  nodeDataMap.set(n.id, {
                    label: n.data?.label || '',
                    tags: n.data?.tags || [],
                    category: n.data?.category || '',
                    subject: n.data?.subject || ''
                  });
                }
              });

              const similarityEdges = simEdgesResp.edges
                .filter((e) => finalNodeIds.has(e.source) && finalNodeIds.has(e.target))
                .map((e) => ({
                  id: e.id,
                  source: e.source,
                  target: e.target,
                  type: 'similarity', // Use custom edge component
                  animated: false,
                  data: {
                    kind: 'similarity',
                    similarity: e.similarity,
                    sourceData: nodeDataMap.get(e.source) || {},
                    targetData: nodeDataMap.get(e.target) || {},
                    showEdgeLabels: showEdgeLabelsRef.current
                  }
                }));

              if (similarityEdges.length > 0) {
                graphActions.setEdges((prev) => {
                  const existingIds = new Set(prev.map((e) => e.id));
                  const newEdges = similarityEdges.filter((e) => !existingIds.has(e.id));
                  if (newEdges.length === 0) return prev;
                  return [...prev, ...newEdges];
                });
                setGraphStatus((prev) => `${prev} • ${similarityEdges.length} connections`);
              }
            }
          } catch (simErr) {
            logger.debug('[Graph] Failed to fetch similarity edges:', simErr);
          }
        }

        if (expandedFileIds.length >= 2) {
          try {
            const relEdgesResp = await window.electronAPI?.knowledge?.getRelationshipEdges?.(
              expandedFileIds,
              { minWeight: 2, maxEdges: 200 }
            );

            if (relEdgesResp?.success && Array.isArray(relEdgesResp.edges)) {
              const relationshipEdges = relEdgesResp.edges.map((edge) => ({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                type: 'smartStep',
                label: 'Knowledge',
                style: {
                  stroke: '#22c55e',
                  strokeDasharray: '4,4',
                  strokeWidth: 1.5
                },
                data: {
                  kind: 'knowledge',
                  weight: edge.weight
                }
              }));

              if (relationshipEdges.length > 0) {
                graphActions.setEdges((prev) => {
                  const existingIds = new Set(prev.map((e) => e.id));
                  const newEdges = relationshipEdges.filter((e) => !existingIds.has(e.id));
                  if (newEdges.length === 0) return prev;
                  return [...prev, ...newEdges];
                });
                setGraphStatus((prev) => `${prev} • ${relationshipEdges.length} knowledge links`);
              }
            }
          } catch (relErr) {
            logger.debug('[Graph] Failed to fetch knowledge edges:', relErr);
          }
        }
      } catch (e) {
        setGraphStatus('');
        setError(getErrorMessage(e, 'Graph search'));
      }
    },
    [query, defaultTopK, addMode, autoLayout, graphActions, upsertFileNode]
  );

  const expandFromSelected = useCallback(
    async (overrideNode = null) => {
      // Use provided node or fall back to selectedNode (fixes stale closure in onNodeDoubleClick)
      const seed = overrideNode || selectedNode;
      if (!seed || seed.data?.kind !== 'file') return;
      const seedId = seed.id;

      setError('');
      setGraphStatus(`Expanding (${hopCount} hop${hopCount > 1 ? 's' : ''})...`);

      try {
        // Use multi-hop expansion when hopCount > 1, otherwise use findSimilar for single hop
        const resp =
          hopCount > 1
            ? await window.electronAPI?.embeddings?.findMultiHop?.([seedId], {
                hops: hopCount,
                decay: decayFactor
              })
            : await window.electronAPI?.embeddings?.findSimilar?.(seedId, 10);
        if (!resp || resp.success !== true) {
          throw new Error(resp?.error || 'Expand failed');
        }

        const results = Array.isArray(resp.results) ? resp.results : [];
        const seedPos = seed.position || { x: 200, y: 200 };

        const nextNodes = [];
        const nextEdges = [];

        // Get seed node data for tooltips
        const seedNodeData = {
          label: seed.data?.label || '',
          tags: seed.data?.tags || [],
          category: seed.data?.category || '',
          subject: seed.data?.subject || ''
        };

        results.forEach((r, idx) => {
          const pos = {
            x: seedPos.x + 280,
            y: seedPos.y + idx * 80
          };
          const node = upsertFileNode(r, pos);
          if (!node?.id) return; // Ensure node has valid id for edge creation
          nextNodes.push(node);

          // Get target node data for tooltip
          const targetNodeData = {
            label: node.data?.label || '',
            tags: node.data?.tags || [],
            category: node.data?.category || '',
            subject: node.data?.subject || ''
          };

          nextEdges.push({
            id: `e:${seedId}->${node.id}`,
            source: seedId,
            target: node.id,
            type: 'similarity', // Use custom edge component
            animated: false,
            data: {
              kind: 'similarity',
              similarity: r.score || 0,
              sourceData: seedNodeData,
              targetData: targetNodeData,
              showEdgeLabels: showEdgeLabelsRef.current
            }
          });
        });

        const { folderNodes, edges: organizeEdges } = buildRecommendationGraph(nextNodes);
        const nextNodesWithFolders = [...nextNodes, ...folderNodes];
        const nextEdgesWithFolders = [...nextEdges, ...organizeEdges];

        graphActions.setNodes((prev) => {
          // Check if any new nodes need to be added
          const existingIds = new Set(prev.map((n) => n.id));
          const hasNewNodes = nextNodesWithFolders.some((n) => !existingIds.has(n.id));

          if (!hasNewNodes) {
            // No new nodes to add, preserve reference to prevent unnecessary updates
            return prev;
          }

          // Merge new nodes with existing ones
          const map = new Map(prev.map((n) => [n.id, n]));
          nextNodesWithFolders.forEach((n) => {
            if (!map.has(n.id)) map.set(n.id, n);
          });
          return Array.from(map.values());
        });
        graphActions.setEdges((prev) => {
          // Check if any new edges need to be added
          const existingEdgeIds = new Set(prev.map((e) => e.id));
          const hasNewEdges = nextEdgesWithFolders.some((e) => !existingEdgeIds.has(e.id));

          if (!hasNewEdges) {
            // No new edges to add, preserve reference to prevent unnecessary updates
            return prev;
          }

          // Merge new edges with existing ones
          const map = new Map(prev.map((e) => [e.id, e]));
          nextEdgesWithFolders.forEach((e) => map.set(e.id, e));
          return Array.from(map.values());
        });

        setGraphStatus(`Expanded: +${results.length}`);

        // Apply auto-layout if enabled (debounced)
        if (autoLayout && nextNodes.length > 0) {
          setGraphStatus('Applying layout...');
          try {
            // Get the final nodes and edges for layout
            const finalNodes = (() => {
              const map = new Map(nodes.map((n) => [n.id, n]));
              nextNodes.forEach((n) => {
                if (!map.has(n.id)) map.set(n.id, n);
              });
              return Array.from(map.values());
            })();

            const finalEdges = (() => {
              const map = new Map(edges.map((e) => [e.id, e]));
              nextEdges.forEach((e) => map.set(e.id, e));
              return Array.from(map.values());
            })();

            // Use debounced layout for expansion
            const { nodes: layoutedNodes, edges: layoutedEdges } = await debouncedElkLayout(
              finalNodes,
              finalEdges,
              {
                direction: 'RIGHT',
                spacing: GRAPH_LAYOUT_SPACING,
                layerSpacing: GRAPH_LAYER_SPACING,
                debounceMs: 100 // Shorter debounce for explicit user action
              }
            );
            graphActions.setNodes(layoutedNodes);
            if (layoutedEdges && layoutedEdges.length > 0) {
              graphActions.setEdges(layoutedEdges);
            }
            setGraphStatus(`Expanded: +${results.length} (laid out)`);
          } catch (layoutError) {
            logger.warn('[Graph] Auto-layout after expand failed:', layoutError);
          }
        }

        // Fetch similarity edges among newly expanded nodes (not just to the seed)
        if (nextNodes.length > 1) {
          try {
            const expandedNodeIds = nextNodes.map((n) => n.id);
            const simEdgesResp = await window.electronAPI?.embeddings?.getSimilarityEdges?.(
              expandedNodeIds,
              { threshold: 0.75, maxEdgesPerNode: 1 }
            );

            if (simEdgesResp?.success && Array.isArray(simEdgesResp.edges)) {
              // Build node data map for tooltips
              const nodeDataMap = new Map();
              nextNodes.forEach((n) => {
                nodeDataMap.set(n.id, {
                  label: n.data?.label || '',
                  tags: n.data?.tags || [],
                  category: n.data?.category || '',
                  subject: n.data?.subject || ''
                });
              });

              const interNodeEdges = simEdgesResp.edges
                .filter((e) => e.source !== seedId && e.target !== seedId) // Exclude seed edges (already added)
                .map((e) => ({
                  id: `sim:${e.source}->${e.target}`,
                  source: e.source,
                  target: e.target,
                  type: 'similarity',
                  animated: false,
                  data: {
                    kind: 'similarity',
                    similarity: e.similarity,
                    sourceData: nodeDataMap.get(e.source) || {},
                    targetData: nodeDataMap.get(e.target) || {},
                    showEdgeLabels: showEdgeLabelsRef.current
                  }
                }));

              if (interNodeEdges.length > 0) {
                graphActions.setEdges((prev) => {
                  const existingIds = new Set(prev.map((e) => e.id));
                  const newEdges = interNodeEdges.filter((e) => !existingIds.has(e.id));
                  if (newEdges.length === 0) return prev;
                  return [...prev, ...newEdges];
                });
                setGraphStatus((prev) => `${prev} • +${interNodeEdges.length} connections`);
              }
            }
          } catch (simErr) {
            logger.debug('[Graph] Failed to fetch inter-node similarity edges:', simErr);
          }
        }
      } catch (e) {
        setGraphStatus('');
        setError(getErrorMessage(e, 'Node expansion'));
      }
    },
    [selectedNode, autoLayout, nodes, edges, hopCount, decayFactor, graphActions, upsertFileNode]
  );

  // Assign to ref so event handlers can access it
  expandFromSelectedRef.current = expandFromSelected;

  // Debounce within-graph query
  useEffect(() => {
    const handle = setTimeout(
      () => setDebouncedWithinQuery(withinQuery.trim()),
      TIMEOUTS.DEBOUNCE_INPUT
    );
    return () => clearTimeout(handle);
  }, [withinQuery]);

  // Combined Node Styling Effect: Filters + Search Scoring
  useEffect(() => {
    if (activeTab !== 'graph' || !isOpen) return undefined;

    let cancelled = false;
    const requestId = (withinRequestCounterRef.current += 1);
    withinReqRef.current = requestId;

    const run = async () => {
      // 1. Prepare search scores if query exists
      let scoreMap = null;
      const q = debouncedWithinQuery;
      let topMatches = [];

      if (q && q.length >= 2 && fileNodeIds.length > 0) {
        try {
          const resp = await window.electronAPI?.embeddings?.scoreFiles?.(q, fileNodeIds);
          if (cancelled || withinReqRef.current !== requestId) return;

          if (resp && resp.success === true && Array.isArray(resp.scores)) {
            scoreMap = new Map(resp.scores.map((s) => [s.id, clamp01(s.score)]));

            topMatches = resp.scores
              .filter((s) => s.score > 0.5)
              .sort((a, b) => b.score - a.score)
              .slice(0, 5);
          }
        } catch (e) {
          setError(getErrorMessage(e, 'File scoring'));
        }
      }

      // 2. Calculate focus mode visibility
      const focusVisibleNodes = focusNodeId ? getNodesInFocus(focusNodeId, focusDepth) : null;

      // 3. Apply updates (Filters + Scores + Focus)
      graphActions.setNodes((prev) => {
        let changed = false;
        const updated = prev.map((n) => {
          // Normalize kind from node type or data
          const kind =
            n.data?.kind ||
            (n.type === 'clusterNode'
              ? 'cluster'
              : n.type === 'queryNode'
                ? 'query'
                : n.type === 'folderNode'
                  ? 'folder'
                  : 'file');

          // -- Filter Logic --
          const isTypeActive = activeFilters.types.includes(kind);

          // Special case: if node is cluster, check confidence
          let isConfidenceActive = true;
          if (kind === 'cluster') {
            // ClusterNode normalizes confidence to low/medium/high
            const conf = ['high', 'medium', 'low'].includes(n.data?.confidence)
              ? n.data?.confidence
              : 'low';
            isConfidenceActive = activeFilters.confidence.includes(conf);
          }

          // -- Focus Mode Logic --
          const isInFocus = focusVisibleNodes ? focusVisibleNodes.has(n.id) : true;

          const shouldHide = !isTypeActive || !isConfidenceActive || !isInFocus;

          // -- Score/Opacity Logic --
          let opacity = 1;
          let borderColor;
          let borderWidth;
          let withinScore;

          if (scoreMap) {
            // Search is active
            if (kind === 'file' || n.type === 'fileNode') {
              const s = scoreMap.get(n.id);
              if (typeof s === 'number') {
                withinScore = s;
                opacity = scoreToOpacity(s);
                if (s > 0.75) {
                  borderColor = 'rgba(37,99,235,0.9)';
                  borderWidth = 2;
                }
              } else {
                // Not a match - fade out
                withinScore = 0;
                opacity = 0.3;
              }
            } else if (kind === 'cluster' && n.data?.memberIds) {
              // Keep cluster visible if it contains a matching file
              const hasMatchingMember = n.data.memberIds.some(
                (id) => (scoreMap.get(id) || 0) > 0.5
              );
              opacity = hasMatchingMember ? 1 : 0.3;
            } else {
              // Other nodes (queries, empty clusters) dim when searching files
              opacity = 0.3;
            }
          }

          // -- Check for changes --
          const currentHidden = n.hidden === true;
          const currentOpacity = n.style?.opacity ?? 1;
          const currentScore = n.data?.withinScore;

          if (
            shouldHide === currentHidden &&
            opacity === currentOpacity &&
            withinScore === currentScore &&
            n.style?.borderColor === borderColor &&
            n.style?.borderWidth === borderWidth
          ) {
            return n;
          }

          changed = true;
          const newData = { ...(n.data || {}) };
          if (withinScore !== undefined) newData.withinScore = withinScore;
          else delete newData.withinScore;

          return {
            ...n,
            hidden: shouldHide,
            data: newData,
            style: {
              ...(n.style || {}),
              opacity,
              borderColor,
              borderWidth
            }
          };
        });

        return changed ? updated : prev;
      });

      // FIX: Also hide edges connected to hidden nodes to prevent orphaned edges
      // This ensures edges don't point to non-existent visual nodes
      // Build set of hidden node IDs based on current filter state
      const hiddenNodeIds = new Set();
      nodes.forEach((n) => {
        const kind =
          n.data?.kind ||
          (n.type === 'clusterNode'
            ? 'cluster'
            : n.type === 'queryNode'
              ? 'query'
              : n.type === 'folderNode'
                ? 'folder'
                : 'file');
        const isTypeActive = activeFilters.types.includes(kind);
        let isConfidenceActive = true;
        if (kind === 'cluster') {
          const conf = ['high', 'medium', 'low'].includes(n.data?.confidence)
            ? n.data?.confidence
            : 'low';
          isConfidenceActive = activeFilters.confidence.includes(conf);
        }
        if (!isTypeActive || !isConfidenceActive) {
          hiddenNodeIds.add(n.id);
        }
      });

      graphActions.setEdges((prevEdges) => {
        let edgeChanged = false;
        const updatedEdges = prevEdges.map((e) => {
          const shouldHideEdge = hiddenNodeIds.has(e.source) || hiddenNodeIds.has(e.target);
          if (e.hidden !== shouldHideEdge) {
            edgeChanged = true;
            return { ...e, hidden: shouldHideEdge };
          }
          return e;
        });

        return edgeChanged ? updatedEdges : prevEdges;
      });

      // 3. Zoom to matches (only if search was performed and we have matches)
      if (topMatches.length > 0 && reactFlowInstance.current) {
        reactFlowInstance.current.fitView({
          nodes: topMatches.map((m) => ({ id: m.id })),
          padding: 0.3,
          duration: 300,
          maxZoom: 1.5
        });
        graphActions.selectNode(topMatches[0].id);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [
    debouncedWithinQuery,
    fileNodeIds,
    isOpen,
    activeTab,
    graphActions,
    activeFilters,
    nodes,
    focusNodeId,
    focusDepth,
    getNodesInFocus
  ]);

  const onNodeClick = useCallback(
    (_, node) => {
      if (!node?.id) return;
      graphActions.selectNode(node.id);
    },
    [graphActions]
  );

  const onNodesChange = useCallback(
    (changes) => {
      // 1. Let React Flow helper handle all node updates (dragging, resizing, selection flags)
      graphActions.onNodesChange(changes);

      // 2. Sync our separate selection state for the details panel
      for (const change of changes) {
        if (change.type === 'select') {
          if (change.selected) {
            graphActions.selectNode(change.id);
          } else {
            graphActions.selectNode((prev) => (prev === change.id ? null : prev));
          }
        }
      }
    },
    [graphActions]
  );

  // Double-click on a node to expand it (file or cluster)
  // Mouse enter/leave handlers for interactive edge visibility
  const onNodeMouseEnter = useCallback(
    (_, node) => {
      // Only apply for cluster nodes
      if (node.type !== 'clusterNode') return;

      // Find all edges connected to this node
      graphActions.setEdges((prevEdges) =>
        prevEdges.map((edge) => {
          // If edge is connected to this node, make it visible
          if (edge.source === node.id || edge.target === node.id) {
            return {
              ...edge,
              style: {
                ...edge.style,
                opacity: 0.8 // Visible on hover
              },
              className: edge.className?.replace('opacity-0', 'opacity-100') || ''
            };
          }
          return edge;
        })
      );
    },
    [graphActions]
  );

  const onNodeMouseLeave = useCallback(
    (_, node) => {
      if (node.type !== 'clusterNode') return;

      // Hide all cross-cluster edges again
      graphActions.setEdges((prevEdges) =>
        prevEdges.map((edge) => {
          if (edge.data?.kind === 'cross_cluster') {
            return {
              ...edge,
              style: {
                ...edge.style,
                opacity: 0 // Hidden again
              },
              className: edge.className?.replace('opacity-100', 'opacity-0') || ''
            };
          }
          return edge;
        })
      );
    },
    [graphActions]
  );

  const onNodeDoubleClick = useCallback(
    (_, node) => {
      if (!node?.id) return;

      const kind = node?.data?.kind;

      // Handle cluster node double-click
      if (kind === 'cluster') {
        const memberIds = node?.data?.memberIds;
        if (Array.isArray(memberIds) && memberIds.length > 0) {
          expandCluster(node.id, memberIds);
        }
        return;
      }

      // Handle file node double-click
      if (kind === 'file') {
        graphActions.selectNode(node.id);
        // Pass node directly to avoid stale closure (selectedNode won't update until re-render)
        expandFromSelected(node);
      }
    },
    [expandFromSelected, expandCluster, graphActions]
  );

  // ============================================================================
  // Computed values
  // ============================================================================

  // Avoid recreating ReactFlow props on every render; unstable refs can trigger StoreUpdater loops.
  // CRITICAL: Only create new objects when selection or node data actually changes
  const rfNodes = useMemo(() => {
    // FIX: Progressive disclosure - hide clusters if not enabled
    // This allows toggling visibility without losing data
    const visibleNodes = showClusters ? nodes : nodes.filter((n) => n.data?.kind !== 'cluster');

    return visibleNodes.map((n) => {
      const isSelected = n.id === selectedNodeId;
      // Only create new object if selection state actually changed
      // Preserve node reference when possible to prevent unnecessary ReactFlow updates
      const currentSelected = n.selected === true || n.selected === false ? n.selected : false;
      if (currentSelected === isSelected) {
        // Selection hasn't changed, return node as-is to preserve reference stability
        // This prevents ReactFlow StoreUpdater from detecting false changes
        return n;
      }
      // Selection changed, create new object with updated selected state
      return {
        ...n,
        selected: isSelected
      };
    });
  }, [nodes, selectedNodeId, showClusters]);

  // FIX: Filter edges based on visible nodes to prevent "dangling" edges
  const rfEdges = useMemo(() => {
    if (showClusters) return edges;

    const visibleNodeIds = new Set(rfNodes.map((n) => n.id));
    return edges.filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target));
  }, [edges, rfNodes, showClusters]);

  const rfFitViewOptions = useMemo(() => ({ padding: 0.2 }), []);
  const rfDefaultViewport = useMemo(() => ({ x: 0, y: 0, zoom: 1 }), []);
  const rfProOptions = useMemo(() => ({ hideAttribution: true }), []);
  const rfNodeTypes = useMemo(() => NODE_TYPES, []);
  const rfEdgeTypes = useMemo(() => EDGE_TYPES, []);
  const miniMapNodeColor = useCallback((n) => {
    if (n.data?.kind === 'query') return '#6366f1'; // Indigo for queries
    if (n.data?.kind === 'cluster' || n.data?.kind === 'duplicate') return '#f59e0b'; // Amber for clusters
    return '#3b82f6'; // Blue for files
  }, []);

  const showEmptyBanner =
    hasLoadedStats && stats && typeof stats.files === 'number' && stats.files === 0 && !error;
  // Use fresh metadata from ChromaDB when available (for current file paths after moves)
  const selectedPath = freshMetadata?.path || selectedNode?.data?.path || '';
  const selectedLabel = freshMetadata?.name || selectedNode?.data?.label || selectedNode?.id || '';
  const selectedKind = selectedNode?.data?.kind || '';

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="KnowledgeOS"
      size="full"
      className={`search-modal transition-colors duration-300 ${
        isGraphMaximized ? 'bg-system-gray-100' : ''
      }`}
    >
      <div className="flex flex-col gap-4 min-h-[60vh]">
        {isOpen && isLoadingStats && !hasLoadedStats && (
          <ModalLoadingOverlay message="Loading Knowledge OS..." />
        )}
        {/* Header - simplified when graph is hidden */}
        {GRAPH_FEATURE_FLAGS.SHOW_GRAPH && !isGraphMaximized ? (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-system-gray-200">
            <div className="flex items-center gap-4">
              <TabButton
                active={activeTab === 'search'}
                onClick={() => setActiveTab('search')}
                icon={List}
                label="Discover"
              />
              <TabButton
                active={activeTab === 'chat'}
                onClick={() => setActiveTab('chat')}
                icon={MessageSquare}
                label="Understand"
              />
              <TabButton
                active={activeTab === 'graph'}
                onClick={() => setActiveTab('graph')}
                icon={Network}
                label="Relate"
              />
            </div>
            <StatsDisplay stats={stats} isLoadingStats={isLoadingStats} onRefresh={refreshStats} />
          </div>
        ) : (
          <div className="flex items-center justify-between text-xs text-system-gray-400">
            <span>
              {hasLoadedStats ? `${stats?.files || 0} files indexed` : 'Loading index...'}
            </span>
            <button
              onClick={refreshStats}
              disabled={isLoadingStats}
              className="hover:text-system-gray-600 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingStats ? 'animate-spin' : ''}`} />
            </button>
          </div>
        )}

        {/* Empty embeddings banner */}
        {showEmptyBanner && (
          <EmptyEmbeddingsBanner
            onRebuildFolders={rebuildFolders}
            onRebuildFiles={rebuildFiles}
            isRebuildingFolders={isRebuildingFolders}
            isRebuildingFiles={isRebuildingFiles}
          />
        )}

        {/* Error banner */}
        {error && (
          <StateMessage
            icon={AlertTriangle}
            tone="error"
            size="sm"
            align="left"
            title="Search error"
            description={error}
            className="glass-panel border border-stratosort-danger/30 bg-stratosort-danger/10 p-3 rounded-xl"
            contentClassName="max-w-xl"
          />
        )}

        {/* Search Tab Content */}
        {activeTab === 'search' && (
          <div className="flex flex-col gap-4 flex-1">
            {/* Clean search input */}
            <div className="flex items-center gap-3">
              <SearchAutocomplete
                value={query}
                onChange={setQuery}
                onSearch={(q) => {
                  setQuery(q);
                }}
                placeholder="Describe what you're looking for..."
                ariaLabel="Search query"
                className="flex-1"
                autoFocus
              />
              {isSearching && (
                <div className="flex items-center gap-2 text-xs text-system-gray-400 shrink-0">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Searching...</span>
                </div>
              )}
            </div>

            {/* Search mode fallback banner */}
            <SearchModeBanner meta={searchMeta} />

            {/* Results header with view toggle */}
            {searchResults.length > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-system-gray-500">{searchStatusLabel}</span>
                <div className="flex items-center gap-2">
                  {/* View in Graph button */}
                  {GRAPH_FEATURE_FLAGS.SHOW_GRAPH && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={convertSearchToGraph}
                      title="Visualize search results as a graph"
                    >
                      <Network className="h-3.5 w-3.5" />
                      <span>View in Graph</span>
                    </Button>
                  )}
                  {/* Ask Assistant button */}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setActiveTab('chat');
                      // If there is a query, ask about it
                      if (debouncedQuery) {
                        handleChatSend(`Tell me about "${debouncedQuery}" based on these results`);
                      }
                    }}
                    title="Ask AI assistant about these results"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>Ask AI</span>
                  </Button>
                  <div
                    className="flex items-center gap-1 bg-system-gray-100 rounded-lg p-0.5"
                    role="group"
                    aria-label="View mode"
                  >
                    <button
                      type="button"
                      onClick={() => setViewMode('all')}
                      aria-label="View all results"
                      aria-pressed={viewMode === 'all'}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1 ${
                        viewMode === 'all'
                          ? 'bg-white text-system-gray-900 shadow-sm'
                          : 'text-system-gray-500 hover:text-system-gray-700'
                      }`}
                    >
                      <List className="w-3.5 h-3.5 -mt-0.5" />
                      <span>All</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('grouped')}
                      aria-label="Group results by type"
                      aria-pressed={viewMode === 'grouped'}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1 ${
                        viewMode === 'grouped'
                          ? 'bg-white text-system-gray-900 shadow-sm'
                          : 'text-system-gray-500 hover:text-system-gray-700'
                      }`}
                    >
                      <LayoutGrid className="w-3.5 h-3.5 -mt-0.5" />
                      <span>By Type</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Bulk action bar - only shown when items are selected */}
            {bulkSelectedIds.size > 0 && (
              <div className="flex items-center gap-3 p-2 bg-stratosort-blue/5 border border-stratosort-blue/20 rounded-lg">
                <span className="text-sm text-stratosort-blue">
                  {bulkSelectedIds.size} selected
                </span>
                <Button variant="secondary" size="sm" onClick={moveSelectedToFolder}>
                  <FolderInput className="h-3.5 w-3.5" />
                  <span>Move</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={clearBulkSelection}>
                  Clear
                </Button>
              </div>
            )}

            {/* Query correction feedback - "Did you mean?" */}
            {queryMeta?.corrections?.length > 0 && searchResults.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="text-amber-800">
                  Showing results for{' '}
                  <span className="font-medium">
                    {queryMeta.corrections.map((c) => c.corrected).join(', ')}
                  </span>{' '}
                  instead of{' '}
                  <span className="text-amber-600 line-through">
                    {queryMeta.corrections.map((c) => c.original).join(', ')}
                  </span>
                </span>
              </div>
            )}

            {/* Results grid */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 flex-1">
              <div ref={resultListRef} className="flex flex-col gap-2 overflow-y-auto max-h-[60vh]">
                {searchResults.length === 0 && !error && !isSearching ? (
                  <EmptySearchState
                    query={debouncedQuery}
                    hasIndexedFiles={stats?.files > 0}
                    onSearchClick={setQuery}
                  />
                ) : null}

                {/* Flat list view */}
                {viewMode === 'all' &&
                  searchResults.map((r, index) => (
                    <ResultRow
                      key={r.id}
                      result={r}
                      isSelected={r.id === selectedSearchId}
                      isBulkSelected={bulkSelectedIds.has(r.id)}
                      isFocused={index === focusedResultIndex}
                      query={debouncedQuery}
                      index={index}
                      onSelect={(res) => {
                        setSelectedSearchId(res.id);
                        setFocusedResultIndex(index);
                      }}
                      onToggleBulk={toggleBulkSelection}
                      onOpen={openFile}
                      onReveal={revealFile}
                      onCopyPath={copyPath}
                    />
                  ))}

                {/* Grouped by type view */}
                {viewMode === 'grouped' &&
                  Object.entries(groupedResults).map(([category, results]) => (
                    <div key={category} className="mb-4">
                      <div className="flex items-center gap-2 mb-2 sticky top-0 bg-white py-1 z-10">
                        <h4 className="text-xs font-semibold text-system-gray-500 uppercase tracking-wide">
                          {category}
                        </h4>
                        <span className="text-xs text-system-gray-400 bg-system-gray-100 px-1.5 py-0.5 rounded-full">
                          {results.length}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {results.map((r) => {
                          const globalIndex = resultIdToIndex.get(r.id) ?? -1;
                          return (
                            <ResultRow
                              key={r.id}
                              result={r}
                              isSelected={r.id === selectedSearchId}
                              isBulkSelected={bulkSelectedIds.has(r.id)}
                              isFocused={globalIndex === focusedResultIndex}
                              query={debouncedQuery}
                              index={globalIndex >= 0 ? globalIndex : 0}
                              onSelect={(res) => {
                                setSelectedSearchId(res.id);
                                setFocusedResultIndex(globalIndex);
                              }}
                              onToggleBulk={toggleBulkSelection}
                              onOpen={openFile}
                              onReveal={revealFile}
                              onCopyPath={copyPath}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>

              {/* Preview panel - clean and focused */}
              <div className="surface-panel p-4 min-h-[12rem] flex flex-col">
                {selectedSearchResult ? (
                  <div className="flex flex-col gap-4 flex-1">
                    {/* File info header */}
                    <div>
                      <h3 className="heading-tertiary break-words">
                        {selectedSearchResult?.metadata?.name ||
                          safeBasename(selectedSearchResult?.metadata?.path) ||
                          'File'}
                      </h3>
                      <p className="text-xs text-system-gray-500 mt-1 break-all">
                        {formatDisplayPath(selectedSearchResult?.metadata?.path || '', {
                          redact: redactPaths,
                          segments: 2
                        })}
                      </p>
                    </div>

                    {/* Subject/summary - the main content */}
                    {(() => {
                      const subject =
                        selectedDocumentDetails?.analysis?.subject ||
                        selectedSearchResult?.metadata?.subject;
                      const summary =
                        selectedDocumentDetails?.analysis?.summary ||
                        selectedSearchResult?.metadata?.summary;

                      if (!subject && !summary) return null;

                      return (
                        <div className="bg-system-gray-50 rounded-lg p-3">
                          {subject && (
                            <p className="text-sm font-medium text-system-gray-800">{subject}</p>
                          )}
                          {summary && (
                            <p className="text-sm text-system-gray-600 mt-1">{summary}</p>
                          )}
                        </div>
                      );
                    })()}

                    {/* Tags - compact display */}
                    {(() => {
                      const tags =
                        selectedDocumentDetails?.analysis?.tags ||
                        selectedSearchResult?.metadata?.tags;
                      if (!Array.isArray(tags) || tags.length === 0) return null;

                      return (
                        <div className="flex flex-wrap gap-1.5">
                          {tags.slice(0, 6).map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 rounded-full bg-system-gray-100 text-system-gray-600 text-xs"
                            >
                              {tag}
                            </span>
                          ))}
                          {tags.length > 6 && (
                            <span className="text-xs text-system-gray-400">
                              +{tags.length - 6} more
                            </span>
                          )}
                        </div>
                      );
                    })()}

                    {/* Document content preview */}
                    {isLoadingDocumentDetails ? (
                      <div className="flex-1 flex items-center justify-center p-4">
                        <RefreshCw className="w-5 h-5 text-system-gray-300 animate-spin" />
                      </div>
                    ) : (
                      (selectedDocumentDetails?.analysis?.extractedText ||
                        selectedSearchResult?.matchDetails?.bestSnippet ||
                        selectedSearchResult?.document) && (
                        <div className="flex-1 overflow-y-auto">
                          <div className="text-[10px] uppercase text-system-gray-400 font-semibold mb-1 tracking-wider">
                            Content Preview
                          </div>
                          <p className="text-xs text-system-gray-600 whitespace-pre-wrap leading-relaxed">
                            {String(
                              selectedDocumentDetails?.analysis?.extractedText ||
                                selectedSearchResult?.matchDetails?.bestSnippet ||
                                selectedSearchResult?.document
                            ).slice(0, 1000)}
                            {String(
                              selectedDocumentDetails?.analysis?.extractedText ||
                                selectedSearchResult?.matchDetails?.bestSnippet ||
                                selectedSearchResult?.document
                            ).length > 1000 && '...'}
                          </p>
                        </div>
                      )
                    )}

                    {/* Actions - prominent at bottom */}
                    <div className="flex gap-2 pt-2 mt-auto border-t border-system-gray-100">
                      <Button
                        variant="primary"
                        size="sm"
                        className="flex-1"
                        onClick={() => openFile(selectedSearchResult?.metadata?.path)}
                      >
                        <ExternalLink className="h-4 w-4" />
                        <span>Open File</span>
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => revealFile(selectedSearchResult?.metadata?.path)}
                      >
                        <FolderOpen className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyPath(selectedSearchResult?.metadata?.path)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center">
                    <FileText className="w-12 h-12 text-system-gray-200 mb-3" />
                    <p className="text-sm text-system-gray-500">Select a file to preview</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Chat Tab Content */}
        {activeTab === 'chat' && (
          <div className="flex-1 min-h-[60vh] surface-panel flex flex-col overflow-hidden">
            {hasLoadedStats && (!stats || stats.files === 0) && (
              <div className="mx-4 mt-4 rounded-lg border border-stratosort-warning/30 bg-stratosort-warning/10 px-3 py-2 text-xs text-system-gray-700 flex items-center justify-between gap-3">
                <span>
                  Embeddings are not ready yet. Build your embeddings in Settings to enable document
                  citations and sources.
                </span>
                <Button variant="secondary" size="sm" onClick={handleOpenSettings}>
                  Open Settings
                </Button>
              </div>
            )}
            <ChatPanel
              messages={chatMessages}
              onSend={handleChatSend}
              onReset={handleChatReset}
              isSending={isChatting}
              error={chatError}
              warning={chatWarning}
              useSearchContext={useSearchContext}
              onToggleSearchContext={(next) => setUseSearchContext(next)}
              onOpenSource={handleChatOpenSource}
              onUseSourcesInGraph={handleUseSourcesInGraph}
              isSearching={isSearching}
              isLoadingStats={isLoadingStats}
              responseMode={responseMode}
              onResponseModeChange={handleResponseModeChange}
            />
          </div>
        )}

        {/* Graph Tab Content */}
        {GRAPH_FEATURE_FLAGS.SHOW_GRAPH && activeTab === 'graph' && (
          <div
            className={`grid gap-3 flex-1 min-h-[60vh] transition-all duration-300 ${
              isGraphMaximized ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[320px_1fr_320px]'
            }`}
          >
            {/* Left: Controls */}
            {!isGraphMaximized && (
              <div
                className="surface-panel p-4 flex flex-col gap-4 overflow-y-auto"
                role="complementary"
                aria-label="Graph Controls"
              >
                {/* 1. Primary Action: Add to Graph */}
                <div>
                  <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <SearchIcon className="w-3.5 h-3.5" />
                    Add to Graph
                  </div>
                  <SearchAutocomplete
                    value={query}
                    onChange={setQuery}
                    onSearch={runGraphSearch}
                    placeholder="Search files..."
                    ariaLabel="Search to add nodes"
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <label className="text-xs text-system-gray-600 flex items-center gap-2 select-none cursor-pointer">
                      <input
                        type="checkbox"
                        checked={addMode}
                        onChange={(e) => setAddMode(e.target.checked)}
                        className="rounded"
                      />
                      Add to existing
                    </label>
                    <Button variant="primary" size="sm" onClick={runGraphSearch}>
                      Add
                    </Button>
                  </div>
                </div>

                {/* 2. Exploration Tools */}
                <div className="pt-3 border-t border-system-gray-200">
                  <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Network className="w-3.5 h-3.5" />
                    <span>Explore</span>
                  </div>

                  <div className="space-y-3">
                    <Button
                      variant={showClusters ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={loadClusters}
                      disabled={isComputingClusters}
                      className="w-full justify-center"
                      title="Group similar files into clusters"
                    >
                      <Layers className="h-4 w-4" />
                      <span>
                        {isComputingClusters
                          ? 'Computing...'
                          : showClusters
                            ? 'Refresh Clusters'
                            : 'Auto-discover Clusters'}
                      </span>
                    </Button>

                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={applyLayout}
                      disabled={nodes.length === 0 || isLayouting}
                      className="w-full justify-center"
                      title="Organize nodes automatically"
                    >
                      <LayoutGrid className="h-4 w-4" />
                      <span>{isLayouting ? 'Organizing...' : 'Re-organize Layout'}</span>
                    </Button>

                    {/* Expand/Collapse All Clusters */}
                    {showClusters && (
                      <div className="flex gap-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleExpandAllClusters}
                          disabled={
                            nodes.filter(
                              (n) =>
                                n.type === 'clusterNode' &&
                                n.data?.kind === 'cluster' &&
                                !n.data?.expanded
                            ).length === 0
                          }
                          className="flex-1 justify-center text-xs"
                          title="Expand all clusters"
                        >
                          <Maximize2 className="h-3.5 w-3.5" />
                          <span>Expand All</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCollapseAllClusters}
                          disabled={
                            nodes.filter(
                              (n) =>
                                n.type === 'clusterNode' &&
                                n.data?.kind === 'cluster' &&
                                n.data?.expanded
                            ).length === 0
                          }
                          className="flex-1 justify-center text-xs"
                          title="Collapse all clusters"
                        >
                          <Minimize2 className="h-3.5 w-3.5" />
                          <span>Collapse All</span>
                        </Button>
                      </div>
                    )}

                    {/* Focus Mode Controls */}
                    {focusNodeId && (
                      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-2 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-indigo-700">
                            Focus Mode Active
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleClearFocus}
                            className="text-xs text-indigo-600 hover:bg-indigo-100 p-1 h-auto"
                          >
                            Clear Focus
                          </Button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-indigo-600">Depth:</span>
                          <select
                            value={focusDepth}
                            onChange={(e) => setFocusDepth(Number(e.target.value))}
                            className="flex-1 text-xs border border-indigo-200 rounded px-2 py-1 bg-white text-indigo-700"
                            style={{ colorScheme: 'light' }}
                          >
                            <option value={1} className="bg-white text-indigo-700">
                              1 level
                            </option>
                            <option value={2} className="bg-white text-indigo-700">
                              2 levels
                            </option>
                            <option value={3} className="bg-white text-indigo-700">
                              3 levels
                            </option>
                          </select>
                        </div>
                      </div>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (nodes.length > 0) {
                          setShowClearConfirm(true);
                        }
                      }}
                      disabled={nodes.length === 0}
                      className="w-full justify-center text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                      Clear Graph
                    </Button>
                  </div>
                </div>

                {/* 3. Advanced / Secondary Controls (Collapsible) */}
                <div className="pt-2 border-t border-system-gray-200">
                  <button
                    onClick={() => setShowAdvancedControls(!showAdvancedControls)}
                    className="flex items-center w-full text-left text-xs font-semibold text-system-gray-500 uppercase tracking-wider mb-2 hover:text-system-gray-800 transition-colors"
                  >
                    {showAdvancedControls ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                    <span>Advanced Options</span>
                  </button>

                  {showAdvancedControls && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200 pl-1">
                      {/* Filter */}
                      <div>
                        <div className="text-xs font-medium text-system-gray-700 mb-1.5">
                          Filter Visibility
                        </div>
                        <Input
                          value={withinQuery}
                          onChange={(e) => setWithinQuery(e.target.value)}
                          placeholder="Filter nodes..."
                          className="h-8 text-xs"
                        />
                      </div>

                      {/* Expansion Settings */}
                      <div>
                        <div className="text-xs font-medium text-system-gray-700 mb-1.5">
                          Connection Depth
                        </div>
                        <div className="flex items-center gap-2 mb-2">
                          <select
                            value={hopCount}
                            onChange={(e) => setHopCount(Number(e.target.value))}
                            className="flex-1 text-xs border border-system-gray-200 rounded px-2 py-1.5 bg-white text-system-gray-900"
                            style={{ colorScheme: 'light' }}
                          >
                            <option value={1} className="bg-white text-system-gray-900">
                              1 level (Direct)
                            </option>
                            <option value={2} className="bg-white text-system-gray-900">
                              2 levels
                            </option>
                            <option value={3} className="bg-white text-system-gray-900">
                              3 levels (Deep)
                            </option>
                          </select>
                        </div>
                      </div>

                      {/* Auto-layout Toggle */}
                      <label className="text-xs text-system-gray-600 flex items-center gap-2 select-none cursor-pointer">
                        <input
                          type="checkbox"
                          checked={autoLayout}
                          onChange={(e) => setAutoLayout(e.target.checked)}
                          className="rounded"
                        />
                        Auto-layout on changes
                      </label>

                      {/* Auto-clustering Toggle */}
                      <label className="text-xs text-system-gray-600 flex items-center gap-2 select-none cursor-pointer">
                        <input
                          type="checkbox"
                          checked={enableAutoClustering}
                          onChange={(e) => setEnableAutoClustering(e.target.checked)}
                          className="rounded"
                        />
                        Auto-load clusters
                      </label>

                      {/* Edge Labels Toggle */}
                      <label className="text-xs text-system-gray-600 flex items-center gap-2 select-none cursor-pointer mt-1">
                        <input
                          type="checkbox"
                          checked={showEdgeLabels}
                          onChange={(e) => setShowEdgeLabels(e.target.checked)}
                          className="rounded"
                        />
                        Show connection labels
                      </label>

                      {/* Save/Load Controls */}
                      <div className="pt-2 mt-2 border-t border-system-gray-100 flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleSaveGraph}
                          className="flex-1 justify-center text-xs"
                        >
                          Save State
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleLoadGraph}
                          className="flex-1 justify-center text-xs"
                        >
                          Load State
                        </Button>
                      </div>

                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleFindDuplicates}
                        disabled={isFindingDuplicates}
                        className="w-full justify-center text-xs"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>Find Duplicates</span>
                      </Button>
                    </div>
                  )}
                </div>

                {/* Status Footer */}
                <div className="mt-auto pt-4 text-xs text-system-gray-400 border-t border-system-gray-100">
                  {nodes.length > 0 ? (
                    <div className="flex justify-between items-center">
                      <span>{nodes.length} nodes</span>
                      <span>{edges.length} links</span>
                    </div>
                  ) : (
                    <div className="italic text-center">Empty graph</div>
                  )}
                </div>
              </div>
            )}

            {/* Center: Graph */}
            <div
              className={`surface-panel p-0 overflow-hidden min-h-[50vh] rounded-xl border relative transition-all duration-300 ${
                isGraphMaximized ? 'shadow-lg ring-1 ring-system-gray-200' : ''
              } ${
                isDragOver
                  ? 'border-stratosort-blue border-2 bg-stratosort-blue/5 ring-4 ring-stratosort-blue/20'
                  : 'border-system-gray-200'
              }`}
              role="main"
              aria-label="Graph Visualization"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleFileDrop}
            >
              {/* Graph Controls: Help & Maximize */}
              <div className="absolute top-3 right-3 z-20 flex gap-2">
                {isGraphMaximized && nodes.length > 0 && (
                  <div className="bg-white/90 backdrop-blur-sm border border-system-gray-200 rounded-lg px-3 py-1.5 text-xs font-medium text-system-gray-600 shadow-sm flex items-center gap-2">
                    <span>{nodes.length} nodes</span>
                    <span className="w-px h-3 bg-system-gray-300" />
                    <span>{edges.length} links</span>
                  </div>
                )}
                {/* Toggle Clusters Button - Progressive Disclosure */}
                {nodes.some((n) => n.data?.kind === 'cluster') && (
                  <button
                    onClick={() => setShowClusters(!showClusters)}
                    className={`p-1.5 backdrop-blur-sm border rounded-lg shadow-sm transition-all flex items-center gap-1.5 px-2 ${
                      showClusters
                        ? 'bg-amber-50 border-amber-200 text-amber-700'
                        : 'bg-white/90 border-system-gray-200 text-system-gray-600 hover:text-system-gray-800 hover:bg-white'
                    }`}
                    title={
                      showClusters
                        ? 'Hide clusters (simplify view)'
                        : 'Show clusters (reveal structure)'
                    }
                  >
                    <Layers className="w-4 h-4" />
                    <span className="text-xs font-medium hidden sm:inline">
                      {showClusters ? 'Clusters On' : 'Clusters Off'}
                    </span>
                  </button>
                )}

                {/* Help button to re-show tour */}
                <button
                  onClick={() => setShowTourManually(true)}
                  className="p-1.5 bg-white/90 backdrop-blur-sm border border-system-gray-200 rounded-lg shadow-sm text-system-gray-600 hover:text-stratosort-blue hover:bg-white transition-all"
                  title="Show graph tour"
                >
                  <HelpCircle className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setIsGraphMaximized(!isGraphMaximized);
                    // Wait for layout transition then fit view
                    setTimeout(() => {
                      reactFlowInstance.current?.fitView({ padding: 0.2, duration: 800 });
                    }, 300);
                  }}
                  className="p-1.5 bg-white/90 backdrop-blur-sm border border-system-gray-200 rounded-lg shadow-sm text-system-gray-600 hover:text-system-gray-900 hover:bg-white transition-all"
                  title={isGraphMaximized ? 'Exit Full View' : 'Maximize Graph View'}
                >
                  {isGraphMaximized ? (
                    <Minimize2 className="w-4 h-4" />
                  ) : (
                    <Maximize2 className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* Drag overlay indicator */}
              {isDragOver && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-stratosort-blue/10 backdrop-blur-sm pointer-events-none animate-in fade-in duration-200">
                  <div className="bg-white rounded-xl shadow-xl px-8 py-6 flex flex-col items-center gap-3 border-2 border-stratosort-blue border-dashed">
                    <div className="w-12 h-12 rounded-full bg-stratosort-blue/10 flex items-center justify-center">
                      <FolderPlus className="w-6 h-6 text-stratosort-blue" />
                    </div>
                    <div className="text-sm font-medium text-system-gray-900">
                      Drop files to add to graph
                    </div>
                    <div className="text-xs text-system-gray-500">Files must be indexed first</div>
                  </div>
                </div>
              )}

              {nodes.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-8 animate-in fade-in duration-500">
                  <div className="w-20 h-20 bg-system-gray-50 rounded-full flex items-center justify-center mb-6">
                    <Network className="w-10 h-10 text-stratosort-blue opacity-50" />
                  </div>

                  <h3 className="heading-secondary mb-2">Stop Searching. Start Finding.</h3>
                  <p className="text-sm text-system-gray-500 max-w-md mb-8 leading-relaxed">
                    Your files are scattered across folders. Clustering reveals how they naturally
                    belong together—even files you forgot you had.
                  </p>

                  {/* Inline Search for Empty State */}
                  <div className="w-full max-w-sm mb-8 relative z-10">
                    <div className="relative group">
                      <SearchAutocomplete
                        value={query}
                        onChange={setQuery}
                        onSearch={runGraphSearch}
                        placeholder="Search for files to start..."
                        className="shadow-md border-transparent bg-white/80 backdrop-blur-sm rounded-2xl focus-within:border-stratosort-blue/50 focus-within:shadow-lg focus-within:ring-0 transition-all duration-300"
                        autoFocus
                      />
                    </div>
                    <div className="text-xs text-system-gray-400 mt-2 flex justify-center gap-4">
                      <span>or drag files here from the list</span>
                    </div>
                  </div>

                  {/* Quick start options */}
                  {stats?.files > 0 && (
                    <div className="flex flex-col gap-2 mb-8 w-full max-w-xs">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={loadClusters}
                        disabled={isComputingClusters}
                        className="w-full justify-center bg-white border border-system-gray-200 hover:bg-system-gray-50 text-system-gray-700 shadow-sm"
                      >
                        <Layers className="h-4 w-4 text-stratosort-blue" />
                        <span>
                          {isComputingClusters
                            ? 'Analyzing relationships...'
                            : 'Discover how your files connect'}
                        </span>
                      </Button>
                    </div>
                  )}

                  {/* Empty state guidance */}
                  {stats?.files === 0 && (
                    <StateMessage
                      icon={FolderPlus}
                      tone="warning"
                      size="sm"
                      align="left"
                      title="No files indexed yet"
                      description={
                        <>
                          Go to Settings &rarr; Embeddings &rarr; Rebuild Files to index your
                          analyzed files.
                        </>
                      }
                      className="mb-8 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg"
                      contentClassName="max-w-xs"
                    />
                  )}

                  <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-xs text-system-gray-400 max-w-md border-t border-system-gray-100 pt-6">
                    <div className="flex items-center gap-2">
                      <kbd className="px-1.5 py-0.5 rounded bg-system-gray-100 border border-system-gray-200 font-mono text-system-gray-600">
                        Click
                      </kbd>
                      <span>to select nodes</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <kbd className="px-1.5 py-0.5 rounded bg-system-gray-100 border border-system-gray-200 font-mono text-system-gray-600">
                        Double-click
                      </kbd>
                      <span>to expand</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <kbd className="px-1.5 py-0.5 rounded bg-system-gray-100 border border-system-gray-200 font-mono text-system-gray-600">
                        Drag
                      </kbd>
                      <span>to rearrange</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <kbd className="px-1.5 py-0.5 rounded bg-system-gray-100 border border-system-gray-200 font-mono text-system-gray-600">
                        Space
                      </kbd>
                      <span>to center</span>
                    </div>
                  </div>
                </div>
              ) : (
                <GraphErrorBoundary
                  onReset={() => {
                    // Force re-render by triggering a minor state update
                    setZoomLevel((z) => z);
                  }}
                  onClearGraph={() => {
                    graphActions.setNodes([]);
                    graphActions.setEdges([]);
                    graphActions.selectNode(null);
                    setError('');
                  }}
                >
                  <style>
                    {`
                      .graph-zoomed-out .file-node-label {
                        opacity: 0;
                        transition: opacity 0.2s;
                      }
                    `}
                  </style>
                  <ReactFlow
                    nodes={rfNodes}
                    edges={rfEdges}
                    nodeTypes={rfNodeTypes}
                    edgeTypes={rfEdgeTypes}
                    onNodesChange={onNodesChange}
                    onEdgesChange={graphActions.onEdgesChange}
                    className={`bg-[var(--surface-muted)] ${zoomLevel < 0.6 ? 'graph-zoomed-out' : ''}`}
                    onNodeClick={onNodeClick}
                    onNodeDoubleClick={onNodeDoubleClick}
                    onNodeMouseEnter={onNodeMouseEnter}
                    onNodeMouseLeave={onNodeMouseLeave}
                    onInit={(instance) => {
                      reactFlowInstance.current = instance;
                    }}
                    onMove={(_, viewport) => setZoomLevel(viewport.zoom)}
                    fitView
                    fitViewOptions={rfFitViewOptions}
                    minZoom={0.2}
                    maxZoom={2}
                    defaultViewport={rfDefaultViewport}
                    proOptions={rfProOptions}
                  >
                    <Background color="#e5e7eb" gap={16} />
                    <MiniMap pannable zoomable nodeColor={miniMapNodeColor} />
                    <Controls showInteractive={false} />

                    {/* Zoom Level Indicator */}
                    {zoomLevel < 0.6 && (
                      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-system-gray-900/75 backdrop-blur-md text-white text-xs px-4 py-2 rounded-full shadow-lg pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-300 z-50 border border-white/10">
                        Labels hidden at this zoom • Scroll to zoom in
                      </div>
                    )}

                    {/* Keyboard shortcuts hint (subtle, bottom-left) */}
                    {nodes.length > 0 && zoomLevel >= 0.6 && (
                      <div className="absolute bottom-3 left-3 text-[10px] text-system-gray-400 pointer-events-none z-10 flex items-center gap-1.5">
                        <kbd className="px-1 py-0.5 rounded bg-white/80 border border-system-gray-200 text-system-gray-500 font-mono shadow-sm">
                          ?
                        </kbd>
                        <span>for help</span>
                      </div>
                    )}
                  </ReactFlow>
                </GraphErrorBoundary>
              )}
            </div>

            {/* Right: Details & Legend */}
            {!isGraphMaximized && (
              <div
                className="surface-panel flex flex-col h-full overflow-hidden"
                role="complementary"
                aria-label="Node Details"
              >
                <div className="p-4 border-b border-system-gray-100 bg-system-gray-50/50 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-stratosort-blue" aria-hidden="true" />
                  <div className="text-sm font-semibold text-system-gray-900">
                    {selectedNode ? 'Node Details' : 'Legend'}
                  </div>
                </div>

                <div className="p-4 overflow-y-auto flex-1">
                  {selectedNode ? (
                    <>
                      {isLoadingMetadata ? (
                        /* Skeleton loading state */
                        <div className="animate-pulse space-y-4">
                          <div className="h-4 bg-system-gray-200 rounded w-3/4" />
                          <div className="h-3 bg-system-gray-200 rounded w-full" />
                          <div className="h-3 bg-system-gray-200 rounded w-1/2" />
                          <div className="flex gap-2 pt-2">
                            <div className="h-8 bg-system-gray-200 rounded w-20" />
                            <div className="h-8 bg-system-gray-200 rounded w-20" />
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-6">
                          {/* Header Info */}
                          <div>
                            <div className="flex items-start gap-3 mb-2">
                              <div className="mt-1 p-2 bg-white border border-system-gray-200 rounded-lg shadow-sm text-stratosort-blue">
                                {selectedKind === 'query' ? (
                                  <SearchIcon className="h-5 w-5" />
                                ) : selectedKind === 'cluster' ? (
                                  <Layers className="h-5 w-5" />
                                ) : (
                                  <FileText className="h-5 w-5" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-system-gray-900 break-words leading-snug">
                                  {selectedLabel}
                                </div>
                                <div className="text-xs text-system-gray-500 mt-1 capitalize px-2 py-0.5 bg-system-gray-100 rounded-full inline-block">
                                  {selectedKind} Node
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Analysis Section (Subject & Summary) */}
                          {(() => {
                            const subject =
                              selectedDocumentDetails?.analysis?.subject ||
                              selectedNode.data?.subject;
                            const summary =
                              selectedDocumentDetails?.analysis?.summary ||
                              selectedNode.data?.summary;
                            if (!subject && !summary) return null;
                            return (
                              <div className="space-y-2">
                                <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider">
                                  Analysis
                                </div>
                                <div className="bg-system-gray-50 rounded-lg p-3 border border-system-gray-100">
                                  {subject && (
                                    <p className="text-sm font-medium text-system-gray-800 mb-1">
                                      {subject}
                                    </p>
                                  )}
                                  {summary && (
                                    <p className="text-xs text-system-gray-600 leading-relaxed">
                                      {summary}
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Tags Section */}
                          {(() => {
                            const tags =
                              selectedDocumentDetails?.analysis?.tags || selectedNode.data?.tags;
                            if (!Array.isArray(tags) || tags.length === 0) return null;
                            return (
                              <div className="space-y-2">
                                <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider">
                                  Tags
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {tags.map((tag) => (
                                    <span
                                      key={tag}
                                      className="px-2 py-0.5 rounded-full bg-system-gray-100 text-system-gray-600 text-[10px] border border-system-gray-200"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Content Preview */}
                          {isLoadingDocumentDetails ? (
                            <div className="flex items-center justify-center p-4">
                              <RefreshCw className="w-5 h-5 text-system-gray-300 animate-spin" />
                            </div>
                          ) : (
                            (selectedDocumentDetails?.analysis?.extractedText ||
                              selectedNode.data?.content) && (
                              <div className="space-y-2">
                                <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider">
                                  Content Preview
                                </div>
                                <div className="bg-white border border-system-gray-100 rounded-lg p-3 max-h-48 overflow-y-auto">
                                  <p className="text-xs text-system-gray-600 whitespace-pre-wrap leading-relaxed">
                                    {String(
                                      selectedDocumentDetails?.analysis?.extractedText ||
                                        selectedNode.data?.content
                                    ).slice(0, 500)}
                                    {String(
                                      selectedDocumentDetails?.analysis?.extractedText ||
                                        selectedNode.data?.content
                                    ).length > 500 && '...'}
                                  </p>
                                </div>
                              </div>
                            )
                          )}

                          {/* Properties Section */}
                          {selectedPath && (
                            <div className="space-y-2">
                              <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider">
                                Properties
                              </div>
                              <div className="bg-system-gray-50 rounded-lg p-3 border border-system-gray-100 space-y-2">
                                <div>
                                  <div className="text-[10px] text-system-gray-400 uppercase tracking-wide mb-0.5">
                                    Path
                                  </div>
                                  <div className="text-xs text-system-gray-700 font-mono break-all leading-relaxed select-all">
                                    {selectedPath}
                                  </div>
                                </div>
                                {selectedNode.data?.score > 0 && (
                                  <div>
                                    <div className="text-[10px] text-system-gray-400 uppercase tracking-wide mb-0.5">
                                      Relevance Score
                                    </div>
                                    <div className="text-xs text-system-gray-700">
                                      {Math.round(selectedNode.data.score * 100)}%
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Notes Section */}
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider flex justify-between">
                              <span>Notes</span>
                            </div>
                            <textarea
                              className="w-full text-xs p-2 border border-system-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-stratosort-blue/20 focus:border-stratosort-blue/50"
                              rows={3}
                              placeholder="Add notes about this node or connection..."
                              value={graphNotes[selectedNode.id] || ''}
                              onChange={(e) =>
                                setGraphNotes((prev) => ({
                                  ...prev,
                                  [selectedNode.id]: e.target.value
                                }))
                              }
                            />
                          </div>

                          {/* Connections Section */}
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider flex justify-between">
                              <span>Connections</span>
                              <span className="text-system-gray-400 font-normal">
                                {
                                  edges.filter(
                                    (e) =>
                                      e.source === selectedNode.id || e.target === selectedNode.id
                                  ).length
                                }{' '}
                                links
                              </span>
                            </div>
                            <div className="flex flex-col gap-1.5 mt-1">
                              {(() => {
                                const neighbors = edges
                                  .filter(
                                    (e) =>
                                      e.source === selectedNode.id || e.target === selectedNode.id
                                  )
                                  .map((e) => {
                                    const otherId =
                                      e.source === selectedNode.id ? e.target : e.source;
                                    const otherNode = nodes.find((n) => n.id === otherId);
                                    return {
                                      id: otherId,
                                      label: otherNode?.data?.label || otherNode?.id || 'Unknown',
                                      kind: otherNode?.data?.kind || 'file',
                                      similarity: e.data?.similarity
                                    };
                                  });

                                if (neighbors.length === 0)
                                  return (
                                    <div className="text-xs text-system-gray-400 italic">
                                      No direct connections
                                    </div>
                                  );

                                return neighbors.slice(0, 10).map((n) => (
                                  <button
                                    key={n.id}
                                    onClick={() => graphActions.selectNode(n.id)}
                                    className="flex items-center gap-2 p-1.5 rounded-md hover:bg-system-gray-100 text-left transition-colors group"
                                  >
                                    <div className="shrink-0">
                                      {n.kind === 'query' ? (
                                        <SearchIcon className="h-3 w-3 text-system-gray-400" />
                                      ) : n.kind === 'cluster' ? (
                                        <Layers className="h-3 w-3 text-system-gray-400" />
                                      ) : (
                                        <FileText className="h-3 w-3 text-system-gray-400" />
                                      )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-[11px] font-medium text-system-gray-700 truncate group-hover:text-stratosort-blue">
                                        {n.label}
                                      </div>
                                    </div>
                                    {typeof n.similarity === 'number' && (
                                      <div className="text-[10px] text-system-gray-400">
                                        {Math.round(n.similarity * 100)}%
                                      </div>
                                    )}
                                  </button>
                                ));
                              })()}
                              {edges.filter(
                                (e) => e.source === selectedNode.id || e.target === selectedNode.id
                              ).length > 10 && (
                                <div className="text-[10px] text-system-gray-400 pl-6 mt-1">
                                  +{' '}
                                  {edges.filter(
                                    (e) =>
                                      e.source === selectedNode.id || e.target === selectedNode.id
                                  ).length - 10}{' '}
                                  more
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Actions Section */}
                          <div className="space-y-2 pt-2 border-t border-system-gray-100">
                            <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider mb-2">
                              Actions
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => openFile(selectedPath)}
                                disabled={!selectedPath}
                                className="w-full justify-center"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                <span>Open</span>
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => revealFile(selectedPath)}
                                disabled={!selectedPath}
                                className="w-full justify-center"
                              >
                                <FolderOpen className="h-3.5 w-3.5" />
                                <span>Reveal</span>
                              </Button>
                            </div>

                            {selectedKind === 'file' && selectedPath && (
                              <>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => {
                                    const fileName = safeBasename(selectedPath) || 'file';
                                    setQuery(`similar to: ${fileName}`);
                                    setActiveTab('search');
                                  }}
                                  className="w-full justify-center"
                                >
                                  <SearchIcon className="h-3.5 w-3.5" />
                                  <span>Find Similar</span>
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => {
                                    const fileName = safeBasename(selectedPath) || 'file';
                                    setActiveTab('chat');
                                    // Pre-populate chat context/input with this file
                                    const contextMsg = `Tell me about ${fileName}`;
                                    handleChatSend(contextMsg, [selectedNode.id]);
                                  }}
                                  className="w-full justify-center"
                                >
                                  <MessageSquare className="h-3.5 w-3.5" />
                                  <span>Ask Assistant</span>
                                </Button>
                              </>
                            )}
                          </div>

                          {selectedKind === 'file' && (
                            <div className="text-[10px] text-system-gray-300 font-mono mt-4 truncate">
                              ID: {selectedNode.id}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="h-full flex flex-col">
                      {/* Integrated Legend when no node selected */}
                      {showClusters ? (
                        <div className="space-y-4">
                          <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider mb-2">
                            Cluster Legend
                          </div>
                          <ClusterLegend
                            className="shadow-none border-none p-0 bg-transparent w-full"
                            activeFilters={activeFilters}
                            onToggleFilter={handleToggleFilter}
                            compact={false}
                          />
                        </div>
                      ) : nodes.length > 0 ? (
                        <div className="space-y-4">
                          <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider mb-2">
                            Graph Legend
                          </div>
                          <ClusterLegend
                            compact={false}
                            className="shadow-none border-none p-0 bg-transparent w-full"
                            activeFilters={activeFilters}
                            onToggleFilter={handleToggleFilter}
                          />
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center py-12 text-system-gray-400">
                          <div className="w-12 h-12 rounded-full bg-system-gray-100 flex items-center justify-center mb-3">
                            <Sparkles className="w-6 h-6 text-system-gray-300" />
                          </div>
                          <p className="text-sm font-medium text-system-gray-600">No Selection</p>
                          <p className="text-xs text-system-gray-400 mt-1 max-w-[200px]">
                            Select a node to view details, or run a search to populate the graph.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* First-time user tour (or re-triggered via help button) */}
      {activeTab === 'graph' && (
        <GraphTour
          isOpen={isOpen && activeTab === 'graph'}
          forceShow={showTourManually}
          onComplete={() => setShowTourManually(false)}
        />
      )}

      {/* Clear confirmation modal */}
      <ConfirmModal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => {
          graphActions.setNodes([]);
          graphActions.setEdges([]);
          graphActions.selectNode(null);
          setError('');
          setGraphStatus('');
          setShowClusters(false);
        }}
        title="Clear Graph?"
        message="This will remove all nodes and connections from your exploration. This cannot be undone."
        confirmText="Clear Graph"
        cancelText="Cancel"
        variant="warning"
      />
    </Modal>
  );
}

UnifiedSearchModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  defaultTopK: PropTypes.number,
  initialTab: PropTypes.oneOf(['search', 'graph'])
};
