import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import ReactFlow, { Background, Controls, MiniMap, Panel } from 'reactflow';
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

import Modal, { ConfirmModal } from '../ui/Modal';
import { ModalLoadingOverlay } from '../ui/LoadingSkeleton';
import { Button, IconButton, Input, Select, StateMessage, Textarea } from '../ui';
import HighlightedText from '../ui/HighlightedText';
import { getFileCategory } from '../ui/FileIcon';
import { Heading, Text } from '../ui/Typography';
import { TIMEOUTS } from '../../../shared/performanceConstants';
import { createLogger } from '../../../shared/logger';
import { GRAPH_FEATURE_FLAGS } from '../../../shared/featureFlags';
import { safeBasename } from '../../utils/pathUtils';
import { joinPath } from '../../utils/platform';
import { formatDisplayPath } from '../../utils/pathDisplay';
import { scoreToOpacity, clamp01 } from '../../utils/scoreUtils';
import { makeQueryNodeId, defaultNodePosition } from '../../utils/graphUtils';
import { extractFileName } from '../../utils/pathNormalization';
import { extractDroppedFiles, isFileDragEvent } from '../../utils/dragAndDrop';
import {
  elkLayout,
  debouncedElkLayout,
  cancelPendingLayout,
  smartLayout,
  clusterRadialLayout,
  clusterExpansionLayout,
  LARGE_GRAPH_THRESHOLD
} from '../../utils/elkLayout';
import { useGraphState, useGraphKeyboardNav, useFileActions } from '../../hooks';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { toggleSettings } from '../../store/slices/uiSlice';
import { NODE_TYPES, EDGE_TYPES } from './graphTypes';
import SearchAutocomplete from './SearchAutocomplete';
import ClusterLegend from './ClusterLegend';
import EmptySearchState from './EmptySearchState';
import GraphTour from './GraphTour';
import GraphErrorBoundary from './GraphErrorBoundary';
import ChatPanel from './ChatPanel';
import { mapErrorToNotification } from '../../utils/errorMapping';

const logger = createLogger('UnifiedSearchModal');
// Maximum nodes allowed in graph to prevent memory exhaustion
const MAX_GRAPH_NODES = 300;
const GRAPH_LAYOUT_SPACING = 300; // Increased from 180 to reduce clutter
const GRAPH_LAYER_SPACING = 400; // Increased from 280 to reduce clutter
const ZOOM_LABEL_HIDE_THRESHOLD = 0.6;
// Keep React Flow type maps stable across renders/mounts.
const STABLE_NODE_TYPES = NODE_TYPES;
const STABLE_EDGE_TYPES = EDGE_TYPES;
const GRAPH_SIDEBAR_CARD = 'rounded-lg border border-system-gray-200 bg-white/90 p-3 shadow-sm';
const GRAPH_SIDEBAR_SECTION_TITLE =
  'text-[11px] font-semibold text-system-gray-500 uppercase tracking-wider flex items-center gap-2';

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
  const keywordDisplay = keywords.slice(0, 8);
  const keywordOverflow = Math.max(0, keywords.length - keywordDisplay.length);

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
      <IconButton
        onClick={(e) => {
          e.stopPropagation();
          onToggleBulk(result.id);
        }}
        icon={
          isBulkSelected ? (
            <CheckSquare className="w-5 h-5 text-stratosort-blue bg-white rounded-sm" />
          ) : (
            <Square className="w-5 h-5 text-system-gray-300 bg-white rounded-sm" />
          )
        }
        size="sm"
        variant="ghost"
        className={`absolute top-4 left-3 z-10 h-7 w-7 p-0.5 transition-opacity ${isBulkSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        title={isBulkSelected ? 'Deselect' : 'Select'}
        aria-label={isBulkSelected ? 'Deselect result' : 'Select result'}
      />

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
            <Text
              as="span"
              variant="tiny"
              className="text-system-gray-400 whitespace-nowrap pt-1 font-medium"
            >
              {dateStr}
            </Text>
          )}
        </div>

        {/* Sub-header: Category and Confidence */}
        <div className="flex items-center gap-3 mb-3">
          <Text as="span" variant="small" className="text-stratosort-blue font-medium">
            {category}
          </Text>
          <Text as="span" variant="small" className="text-system-gray-400">
            Confidence: {confidence}%
          </Text>
        </div>

        {/* Keywords / Tags */}
        {keywordDisplay.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {keywordDisplay.map((keyword, idx) => (
              <Text
                as="span"
                variant="tiny"
                key={`${result.id}-kw-${idx}`}
                className="px-3 py-1 rounded-full bg-blue-50 text-stratosort-blue font-medium"
              >
                {keyword}
              </Text>
            ))}
            {keywordOverflow > 0 && (
              <Text as="span" variant="tiny" className="text-system-gray-400">
                +{keywordOverflow} more
              </Text>
            )}
          </div>
        )}
        {(entities.length > 0 || dates.length > 0) && (
          <div className="mt-2 space-y-1">
            {entities.length > 0 && (
              <Text as="div" variant="tiny" className="text-system-gray-500">
                Entities: {entities.join(', ')}
              </Text>
            )}
            {dates.length > 0 && (
              <Text as="div" variant="tiny" className="text-system-gray-500">
                Dates: {dates.join(', ')}
              </Text>
            )}
          </div>
        )}
      </div>

      {/* Quick actions - only on selected */}
      {isSelected && (
        <div className="absolute bottom-4 right-4 flex gap-1 bg-white/80 backdrop-blur-sm rounded-lg p-1 shadow-sm border border-system-gray-100">
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              onOpen(path);
            }}
            title="Open file"
            aria-label="Open file"
            size="sm"
            variant="ghost"
            className="h-7 w-7 hover:bg-stratosort-blue/10"
            icon={<ExternalLink className="w-4 h-4 text-stratosort-blue" />}
          />
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              onReveal(path);
            }}
            title="Show in folder"
            aria-label="Show in folder"
            size="sm"
            variant="ghost"
            className="h-7 w-7 hover:bg-stratosort-blue/10"
            icon={<FolderOpen className="w-4 h-4 text-stratosort-blue" />}
          />
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              onCopyPath(path);
            }}
            title="Copy path"
            aria-label="Copy path"
            size="sm"
            variant="ghost"
            className="h-7 w-7 hover:bg-stratosort-blue/10"
            icon={<Copy className="w-4 h-4 text-stratosort-blue" />}
          />
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
        <Text as="span" variant="tiny" className="flex items-center gap-1 text-system-gray-500">
          <Text as="span" variant="tiny" className="font-medium text-system-gray-700">
            {stats.folders}
          </Text>
          <span>folder{stats.folders !== 1 ? 's' : ''}</span>
          <span className="text-system-gray-300">•</span>
          <Text as="span" variant="tiny" className="font-medium text-system-gray-700">
            {stats.files}
          </Text>
          <span>file{stats.files !== 1 ? 's' : ''} indexed</span>
        </Text>
      ) : isLoadingStats ? (
        <Text as="span" variant="tiny" className="flex items-center gap-2 text-system-gray-400">
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-system-gray-300" />
          Loading index...
        </Text>
      ) : (
        <Text as="span" variant="tiny" className="text-system-gray-400">
          No embeddings
        </Text>
      )}
      <IconButton
        icon={<RefreshCw className={`h-3.5 w-3.5 ${isLoadingStats ? 'animate-spin' : ''}`} />}
        size="sm"
        variant="ghost"
        onClick={onRefresh}
        disabled={isLoadingStats}
        title="Refresh embeddings status"
        aria-label="Refresh embeddings status"
        className="h-7 w-7 text-system-gray-400 hover:text-system-gray-700"
      />
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
  isRebuildingFiles,
  embeddingConfig,
  onOpenSettings
}) {
  const timing = embeddingConfig?.timing || null;
  const policy = embeddingConfig?.policy || null;
  const isManual = timing === 'manual';
  const isPolicyDisabled = policy === 'skip' || policy === 'web_only';
  const isDeferred = timing === 'after_organize';

  const title = isManual
    ? 'Embeddings are set to manual'
    : isPolicyDisabled
      ? 'Embeddings are disabled'
      : isDeferred
        ? 'Embeddings are deferred until after organize'
        : 'No embeddings yet';

  const description = isManual
    ? 'Knowledge OS search needs local embeddings, but your settings are set to Manual only. Turn automatic embedding back on (Settings → Embedding behavior), then rebuild to populate the index.'
    : isPolicyDisabled
      ? `Your default embedding policy is set to "${policy}". Knowledge OS won’t create local embeddings, so semantic search will return no results.`
      : isDeferred
        ? 'Your embedding timing is set to After organize/move. Files will be indexed once they are moved into Smart Folders. You can also run a rebuild now.'
        : 'Knowledge OS requires file embeddings. If you already analyzed files in the past but this number is still zero, your search index was likely reset and needs a one-time rebuild from analysis history.';

  return (
    <StateMessage
      icon={Sparkles}
      tone="warning"
      size="md"
      align="left"
      title={title}
      description={description}
      action={
        <div className="flex flex-wrap gap-2">
          {onOpenSettings && (isManual || isPolicyDisabled || isDeferred) && (
            <Button variant="secondary" size="sm" onClick={onOpenSettings}>
              Open Settings
            </Button>
          )}
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
  isRebuildingFiles: PropTypes.bool.isRequired,
  embeddingConfig: PropTypes.shape({
    timing: PropTypes.oneOf(['during_analysis', 'after_organize', 'manual']),
    policy: PropTypes.oneOf(['embed', 'skip', 'web_only'])
  }),
  onOpenSettings: PropTypes.func
};
EmptyEmbeddingsBanner.displayName = 'EmptyEmbeddingsBanner';

/**
 * Banner shown when search falls back to keyword-only mode
 * Helps users understand why Knowledge OS isn't working
 */
function SearchModeBanner({ meta }) {
  if (!meta?.fallback) return null;

  return (
    <div className="glass-panel border border-stratosort-warning/30 bg-stratosort-warning/5 px-3 py-2 rounded-lg flex items-center gap-compact">
      <MessageSquare className="w-4 h-4 text-stratosort-warning shrink-0" />
      <Text as="span" variant="tiny" className="text-system-gray-600">
        <strong>Limited search:</strong> Using keyword search only
        {meta.fallbackReason ? ` (${meta.fallbackReason})` : ' (embedding model unavailable)'}.
        Knowledge OS semantic matching is disabled.
      </Text>
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
    <Button
      type="button"
      onClick={onClick}
      variant={active ? 'primary' : 'ghost'}
      size="sm"
      leftIcon={<Icon className="w-4 h-4" />}
      className={`rounded-lg px-3 ${active ? 'shadow-md' : 'bg-system-gray-100 text-system-gray-600 hover:bg-system-gray-200'}`}
    >
      {label}
    </Button>
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
// Graph filter defaults
// ============================================================================
const DEFAULT_CLUSTER_MODE = 'topic';
const getDefaultClusterFilters = () => ({
  confidence: ['high', 'medium', 'low'],
  minSize: 1,
  fileType: 'all',
  search: ''
});
const getDefaultActiveFilters = () => ({
  types: ['cluster', 'file', 'query', 'folder'],
  confidence: ['high', 'medium', 'low']
});

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
  const effectiveInitialTab = useMemo(
    () =>
      GRAPH_FEATURE_FLAGS.SHOW_GRAPH ? initialTab : initialTab === 'graph' ? 'search' : initialTab,
    [initialTab]
  );
  const [activeTab, setActiveTab] = useState(effectiveInitialTab);

  // Track previous isOpen to detect modal open transitions
  const prevIsOpenRef = useRef(false);

  // Reset tabs only when modal opens (isOpen transitions from false to true)
  // Do NOT reset when effectiveInitialTab changes, as that would override
  // programmatic tab switches like "View in Graph"
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      // Modal just opened - reset to initial tab
      setActiveTab(effectiveInitialTab);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, effectiveInitialTab]);

  // Shared state
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [stats, setStats] = useState(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [hasLoadedStats, setHasLoadedStats] = useState(false);
  const [embeddingConfig, setEmbeddingConfig] = useState(null);
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
  const edgeTooltipsRef = useRef(true);
  const hasAutoDisabledEdgeLabels = useRef(false);
  const hasAutoDisabledTooltips = useRef(false);
  const edgeTooltipsEnabled = nodes.length <= LARGE_GRAPH_THRESHOLD;

  // Cluster configuration state
  const [clusterMode, setClusterMode] = useState(DEFAULT_CLUSTER_MODE); // topic | time | type | tag
  const [clusterFilters, setClusterFilters] = useState(getDefaultClusterFilters);
  const clusterFiltersRef = useRef(clusterFilters);
  const clusterModeRef = useRef(clusterMode);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const lastClustersRef = useRef(null);
  const lastCrossClusterEdgesRef = useRef(null);

  // Guide assistant state
  const [showGuidePanel, setShowGuidePanel] = useState(false);
  const [guideInput, setGuideInput] = useState('');

  // Persist cluster preferences locally (simple best-effort)
  useEffect(() => {
    try {
      const raw = window.localStorage?.getItem('graph.clusterPrefs');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.mode) setClusterMode(parsed.mode);
        if (parsed?.filters) setClusterFilters((prev) => ({ ...prev, ...parsed.filters }));
        if (typeof parsed.showGuidePanel === 'boolean') setShowGuidePanel(parsed.showGuidePanel);
      }
    } catch (err) {
      logger.debug('[Graph] Failed to load cluster prefs', err);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const { search: _search, ...persistFilters } = clusterFilters; // exclude transient search
        window.localStorage?.setItem(
          'graph.clusterPrefs',
          JSON.stringify({ mode: clusterMode, filters: persistFilters, showGuidePanel })
        );
      } catch (err) {
        logger.debug('[Graph] Failed to save cluster prefs', err);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [clusterMode, clusterFilters, showGuidePanel]);

  // Sync clusterFilters ref so loadClusters can read current filters without re-creating
  useEffect(() => {
    clusterFiltersRef.current = clusterFilters;
  }, [clusterFilters]);

  // Sync clusterMode ref so cluster rendering can update without recomputing
  useEffect(() => {
    clusterModeRef.current = clusterMode;
  }, [clusterMode]);

  // Sync ref with state
  useEffect(() => {
    showEdgeLabelsRef.current = showEdgeLabels;
  }, [showEdgeLabels]);
  useEffect(() => {
    edgeTooltipsRef.current = edgeTooltipsEnabled;
  }, [edgeTooltipsEnabled]);

  const [performanceNotice, setPerformanceNotice] = useState('');
  const noticeTimerRef = useRef(null);
  const showPerformanceNotice = useCallback((message) => {
    setPerformanceNotice(message);
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = setTimeout(() => {
      setPerformanceNotice('');
    }, 4000);
  }, []);
  useEffect(
    () => () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
    },
    []
  );

  const applyEdgeUiPrefs = useCallback((edgesToUpdate) => {
    if (!Array.isArray(edgesToUpdate) || edgesToUpdate.length === 0) {
      return edgesToUpdate || [];
    }

    const showLabels = showEdgeLabelsRef.current;
    const showTooltips = edgeTooltipsRef.current;
    let changed = false;
    const updated = edgesToUpdate.map((edge) => {
      const currentLabels = edge.data?.showEdgeLabels ?? true;
      const currentTooltips = edge.data?.showEdgeTooltips ?? true;
      if (currentLabels === showLabels && currentTooltips === showTooltips) return edge;
      changed = true;
      return {
        ...edge,
        data: {
          ...edge.data,
          showEdgeLabels: showLabels,
          showEdgeTooltips: showTooltips
        }
      };
    });

    return changed ? updated : edgesToUpdate;
  }, []);

  useEffect(() => {
    if (
      nodes.length > LARGE_GRAPH_THRESHOLD &&
      showEdgeLabels &&
      !hasAutoDisabledEdgeLabels.current
    ) {
      hasAutoDisabledEdgeLabels.current = true;
      setShowEdgeLabels(false);
      showPerformanceNotice('Large graph: connection labels disabled for performance.');
    }
    if (nodes.length <= LARGE_GRAPH_THRESHOLD) {
      hasAutoDisabledEdgeLabels.current = false;
    }
  }, [nodes.length, showEdgeLabels, showPerformanceNotice]);

  useEffect(() => {
    if (nodes.length > LARGE_GRAPH_THRESHOLD && !hasAutoDisabledTooltips.current) {
      hasAutoDisabledTooltips.current = true;
      showPerformanceNotice('Large graph: connection tooltips disabled for performance.');
    }
    if (nodes.length <= LARGE_GRAPH_THRESHOLD) {
      hasAutoDisabledTooltips.current = false;
    }
  }, [nodes.length, showPerformanceNotice]);

  const dispatch = useAppDispatch();
  const handleOpenSettings = useCallback(() => {
    dispatch(toggleSettings());
    onClose?.();
  }, [dispatch, onClose]);

  // Graph filtering state
  const [activeFilters, setActiveFilters] = useState(getDefaultActiveFilters);

  // Bridge overlay state (used for Guide "bridges only" intent)
  const [bridgeOverlayEnabled, setBridgeOverlayEnabled] = useState(false);

  // Zoom state
  const [zoomLevel, setZoomLevel] = useState(1);
  const zoomBucketRef = useRef(zoomLevel < ZOOM_LABEL_HIDE_THRESHOLD);
  useEffect(() => {
    zoomBucketRef.current = zoomLevel < ZOOM_LABEL_HIDE_THRESHOLD;
  }, [zoomLevel]);
  const [hoveredClusterId, setHoveredClusterId] = useState(null);
  const [hasHoveredCluster, setHasHoveredCluster] = useState(false);

  // Focus mode state - for local graph view
  const [focusNodeId, setFocusNodeId] = useState(null);
  const [focusDepth, setFocusDepth] = useState(2);

  // Related clusters UI state (accordion + file list expansion)
  const [expandedRelatedClusters, setExpandedRelatedClusters] = useState(() => ({}));
  const [showAllBridgeFilesByBridge, setShowAllBridgeFilesByBridge] = useState(() => ({}));
  const [isRelatedClustersOpen, setIsRelatedClustersOpen] = useState(true);

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

  // Reset graph filters to defaults (cluster + active filters)
  const resetGraphFilters = useCallback(() => {
    setClusterMode(DEFAULT_CLUSTER_MODE);
    setClusterFilters(getDefaultClusterFilters());
    setActiveFilters(getDefaultActiveFilters());
    setBridgeOverlayEnabled(false);
    setGuideInput('');
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
  const graphContainerRef = useRef(null);
  const wasOpenRef = useRef(false);

  // Refs for tracking auto-load state
  const hasAutoLoadedClusters = useRef(false);

  // Ref to avoid temporal dead zone with loadClusters in keyboard shortcuts
  const loadClustersRef = useRef(null);

  // Ref for expandFromSelected to be used by findSimilar event handler
  const expandFromSelectedRef = useRef(null);

  // Ref for expandCluster to be used in handleClusterExpand (defined before expandCluster)
  const expandClusterRef = useRef(null);

  // Ref for cluster action callbacks to rehydrate saved graphs
  const clusterActionRefs = useRef({});

  // Track the last fetched document details path to avoid re-fetching
  const lastFetchedDetailsPathRef = useRef(null);

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

    // Limit batch size to prevent IPC timeouts
    const MAX_BATCH_SIZE = 50;
    const filesToProcess = files.slice(0, MAX_BATCH_SIZE);

    if (files.length > MAX_BATCH_SIZE) {
      logger.warn('[UnifiedSearchModal] Truncating recommendation request to avoid timeout', {
        total: files.length,
        processing: MAX_BATCH_SIZE
      });
    }

    setIsLoadingRecommendations(true);
    try {
      const response = await window.electronAPI.suggestions.getBatchSuggestions(filesToProcess);
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
        const { message } = mapErrorToNotification({ error: chatErr?.message || chatErr });
        setChatError(message);
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
              showEdgeLabels: showEdgeLabelsRef.current,
              showEdgeTooltips: edgeTooltipsRef.current
            }
          }));
          if (similarityEdges.length > 0) {
            graphActions.setEdges([...organizeEdges, ...similarityEdges]);
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
            graphActions.setEdges(applyEdgeUiPrefs(layoutedEdges));
          }
        } catch (layoutError) {
          logger.warn('[Graph] Layout from chat sources failed:', layoutError);
        }
      }
    },
    [autoLayout, graphActions, recommendationMap, applyEdgeUiPrefs]
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
      // Clear accumulated state to prevent memory buildup while modal is closed
      setSearchResults([]);
      setChatMessages([]);
      graphActions.setNodes([]);
      graphActions.setEdges([]);
      setBulkSelectedIds(new Set());
      setDuplicateGroups([]);
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
      setEmbeddingConfig(null);
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
      setIsGraphMaximized(false);
      setWithinQuery('');
      setDebouncedWithinQuery('');
      setGraphStatus('');
      // Layout state
      setAutoLayout(true);
      setIsLayouting(false);
      setHoveredClusterId(null);
      setHasHoveredCluster(false);
      setPerformanceNotice('');
      hasAutoDisabledEdgeLabels.current = false;
      hasAutoDisabledTooltips.current = false;
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
    graphActions.setEdges((prevEdges) => {
      let changed = false;
      const nextEdges = prevEdges.map((e) => {
        const currentLabels = e.data?.showEdgeLabels ?? true;
        const currentTooltips = e.data?.showEdgeTooltips ?? true;
        if (currentLabels === showEdgeLabels && currentTooltips === edgeTooltipsEnabled) {
          return e;
        }
        changed = true;
        return {
          ...e,
          data: { ...e.data, showEdgeLabels, showEdgeTooltips: edgeTooltipsEnabled }
        };
      });
      return changed ? nextEdges : prevEdges;
    });
  }, [showEdgeLabels, edgeTooltipsEnabled, graphActions]);

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
          data: {
            ...e.data,
            showEdgeLabels: loadedShowLabels,
            showEdgeTooltips: edgeTooltipsEnabled
          }
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
  }, [graphActions, edgeTooltipsEnabled]);

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
          showEdgeLabels: showEdgeLabelsRef.current,
          showEdgeTooltips: edgeTooltipsRef.current
        }
      };
    });

    const { folderNodes, edges: organizeEdges } = buildRecommendationGraph(fileNodes);

    // Update graph state
    // When adding to graph, filter out cluster nodes to avoid clutter
    graphActions.setNodes((prev) => {
      const incoming = [queryNode, ...fileNodes, ...folderNodes];
      if (!addMode) return incoming;
      // Filter out cluster nodes from previous state - they don't mix well with search results
      const prevWithoutClusters = prev.filter(
        (n) => n.type !== 'clusterNode' && n.data?.kind !== 'cluster'
      );
      const existing = new Set(prevWithoutClusters.map((n) => n.id));
      const newNodes = incoming.filter((n) => !existing.has(n.id));
      return [...prevWithoutClusters, ...newNodes];
    });

    graphActions.setEdges((prev) => {
      const incomingEdges = [...queryEdges, ...organizeEdges];
      if (!addMode) return incomingEdges;
      // Filter out cluster-related edges when adding search results
      const prevWithoutClusterEdges = prev.filter(
        (e) => e.data?.kind !== 'cluster_member' && e.data?.kind !== 'cross_cluster'
      );
      const existing = new Set(prevWithoutClusterEdges.map((e) => e.id));
      const newEdges = incomingEdges.filter((e) => !existing.has(e.id));
      return [...prevWithoutClusterEdges, ...newEdges];
    });

    // Turn off cluster view when adding search results
    if (addMode) {
      setShowClusters(false);
    }

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
        // Filter out cluster nodes when in add mode - they don't mix well with search results
        const nodesWithoutClusters = currentNodes.filter(
          (n) => n.type !== 'clusterNode' && n.data?.kind !== 'cluster'
        );
        const edgesWithoutClusters = currentEdges.filter(
          (e) => e.data?.kind !== 'cluster_member' && e.data?.kind !== 'cross_cluster'
        );
        const allNodes = addMode
          ? [
              ...nodesWithoutClusters.filter((n) => n.id !== queryNodeId),
              queryNode,
              ...fileNodes,
              ...folderNodes
            ]
          : [queryNode, ...fileNodes, ...folderNodes];
        const allEdges = addMode
          ? [
              ...edgesWithoutClusters.filter((e) => !e.id.startsWith(`e:${queryNodeId}`)),
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
          graphActions.setEdges(applyEdgeUiPrefs(layoutedEdges));
        }
      } catch (layoutError) {
        logger.warn('[Graph] Layout after conversion failed:', layoutError);
      }
    }
  }, [
    searchResults,
    debouncedQuery,
    addMode,
    autoLayout,
    graphActions,
    recommendationMap,
    applyEdgeUiPrefs
  ]);

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
    enabled: isOpen && activeTab === 'graph' && nodes.length > 0,
    containerRef: graphContainerRef
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
      const [statsResult, settingsResult] = await Promise.allSettled([
        window.electronAPI.embeddings.getStats(),
        window.electronAPI?.settings?.get?.()
      ]);
      const res = statsResult.status === 'fulfilled' ? statsResult.value : null;
      const settings = settingsResult.status === 'fulfilled' ? settingsResult.value : null;

      if (settings && typeof settings === 'object') {
        setEmbeddingConfig({
          timing:
            settings.embeddingTiming === 'during_analysis' ||
            settings.embeddingTiming === 'after_organize' ||
            settings.embeddingTiming === 'manual'
              ? settings.embeddingTiming
              : null,
          policy:
            settings.defaultEmbeddingPolicy === 'embed' ||
            settings.defaultEmbeddingPolicy === 'skip' ||
            settings.defaultEmbeddingPolicy === 'web_only'
              ? settings.defaultEmbeddingPolicy
              : null
        });
      } else {
        setEmbeddingConfig(null);
      }

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
      setEmbeddingConfig(null);
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

  const clearBulkSelection = useCallback(() => {
    setBulkSelectedIds(new Set());
  }, []);

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
            destination: joinPath(destFolder, fileName)
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
      const folderPath = joinPath(basePath, folderName);

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
            destination: joinPath(destFolder, fileName)
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

      if (openedCount > 0 && failedCount > 0) {
        setGraphStatus(`Opened ${openedCount} file(s) (${failedCount} failed)`);
      } else if (openedCount > 0) {
        setGraphStatus(`Opened ${openedCount} file(s)`);
      } else if (failedCount > 0) {
        setError('Unable to open files. They may have been moved or deleted.');
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
   * Clear focus mode - show all nodes again
   */
  const handleClearFocus = useCallback(() => {
    setFocusNodeId(null);
    setGraphStatus('Focus cleared - showing all nodes');
  }, []);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const adjacencyByNode = useMemo(() => {
    const map = new Map();
    edges.forEach((edge) => {
      if (!map.has(edge.source)) map.set(edge.source, new Set());
      if (!map.has(edge.target)) map.set(edge.target, new Set());
      map.get(edge.source).add(edge.target);
      map.get(edge.target).add(edge.source);
    });
    return map;
  }, [edges]);

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
          // Find all connected nodes via adjacency map
          const neighbors = adjacencyByNode.get(id);
          if (neighbors) {
            neighbors.forEach((neighborId) => {
              if (!visible.has(neighborId)) {
                visible.add(neighborId);
                next.push(neighborId);
              }
            });
          }

          // Also include cluster members if this is a cluster node
          const node = nodeById.get(id);
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
    [adjacencyByNode, nodeById]
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

  // NOTE: selectedNode must be defined before callbacks that reference it
  const selectedNode = useMemo(
    () => (selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null),
    [nodes, selectedNodeId]
  );

  const focusNode = useCallback(
    (nodeId, { zoom = 1.15 } = {}) => {
      if (!nodeId) return;
      graphActions.selectNode(nodeId);
      const currentNodes = nodesRef.current || [];
      const node = currentNodes.find((n) => n.id === nodeId);
      if (node && reactFlowInstance.current) {
        reactFlowInstance.current.setCenter(node.position.x + 100, node.position.y + 50, {
          duration: 350,
          zoom
        });
      }
    },
    [graphActions]
  );

  const clusterInsights = useMemo(() => {
    if (!showClusters) {
      return {
        clustersById: new Map(),
        clusterNodes: [],
        topConnections: [],
        emergingClusters: [],
        connectedEdgeCounts: new Map()
      };
    }

    const clusterNodes = nodes.filter((n) => n?.data?.kind === 'cluster');
    const clustersById = new Map(clusterNodes.map((n) => [n.id, n]));

    const crossEdges = edges.filter((e) => e?.data?.kind === 'cross_cluster');
    const connectedEdgeCounts = new Map();
    for (const e of crossEdges) {
      connectedEdgeCounts.set(e.source, (connectedEdgeCounts.get(e.source) || 0) + 1);
      connectedEdgeCounts.set(e.target, (connectedEdgeCounts.get(e.target) || 0) + 1);
    }

    const topConnections = crossEdges
      .map((e) => {
        const src = clustersById.get(e.source);
        const tgt = clustersById.get(e.target);
        const sim = Number.isFinite(e?.data?.similarity) ? e.data.similarity : 0;
        const sharedTerms = Array.isArray(e?.data?.sharedTerms) ? e.data.sharedTerms : [];
        const bridgeFiles = Array.isArray(e?.data?.bridgeFiles) ? e.data.bridgeFiles : [];
        return {
          id: e.id,
          sourceId: e.source,
          targetId: e.target,
          similarity: sim,
          sharedTerms: sharedTerms.filter(Boolean).slice(0, 3),
          bridgeFiles,
          sourceLabel: src?.data?.label || e.source,
          targetLabel: tgt?.data?.label || e.target
        };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    const emergingClusters = clusterNodes
      .filter((n) => Number.isFinite(n?.data?.timeRange?.endMs))
      .map((n) => ({
        id: n.id,
        label: n?.data?.label || n.id,
        endMs: n.data.timeRange.endMs,
        startMs: Number.isFinite(n?.data?.timeRange?.startMs) ? n.data.timeRange.startMs : null,
        memberCount: n?.data?.memberCount || 0
      }))
      .sort((a, b) => (b.endMs || 0) - (a.endMs || 0))
      .slice(0, 5);

    return {
      clustersById,
      clusterNodes,
      topConnections,
      emergingClusters,
      connectedEdgeCounts
    };
  }, [showClusters, nodes, edges]);

  /**
   * Guide assistant intent handler
   */
  const handleGuideIntent = useCallback(
    async (intent, payload = {}) => {
      const applyAndLoad = (mode, nextFilters = {}) => {
        setClusterMode(mode);
        setClusterFilters((prev) => ({ ...prev, ...nextFilters }));
        // Defer load to allow state to update
        setTimeout(() => {
          loadClustersRef.current?.();
        }, 0);
      };

      // Guide overlays (e.g., bridges-only)
      if (intent === 'bridgesOnly') {
        setBridgeOverlayEnabled(true);
      }

      if (intent === 'related') {
        applyAndLoad('topic', { minSize: 1, confidence: ['high', 'medium', 'low'] });
        setGraphStatus('Showing related topics');
        return;
      }

      if (intent === 'recent') {
        applyAndLoad('time', { minSize: 1, confidence: ['high', 'medium', 'low'] });
        setGraphStatus('Showing recent changes (time clusters)');
        return;
      }

      if (intent === 'type') {
        applyAndLoad('type', { fileType: 'all' });
        setGraphStatus('Grouping by file type');
        return;
      }

      if (intent === 'bridges') {
        applyAndLoad('topic', { minSize: 1, confidence: ['high', 'medium'] });
        setGraphStatus('Highlighting bridges between clusters');
        return;
      }

      if (intent === 'bridgesOnly') {
        setFocusNodeId(null);
        setActiveFilters((prev) => ({ ...prev, types: ['cluster'] }));
        applyAndLoad('topic', { minSize: 1, confidence: ['high', 'medium'] });
        // Hide cluster nodes? keep clusters; show only cross edges by dimming others
        setShowClusters(true);
        setGraphStatus('Showing bridges only');
        return;
      }

      if (intent === 'expand') {
        if (selectedNode?.id && selectedNode?.data?.kind === 'cluster') {
          handleClusterExpand(selectedNode.id);
          setGraphStatus('Expanding from selection');
        } else if (selectedNode?.id && selectedNode?.data?.kind === 'file') {
          expandFromSelectedRef.current?.();
          setGraphStatus('Expanding from file selection');
        } else {
          setGraphStatus('Select a node to expand');
        }
        return;
      }

      if (intent === 'custom' && typeof payload.text === 'string') {
        const text = payload.text.trim().toLowerCase();
        if (text.includes('recent') || text.includes('new')) {
          applyAndLoad('time', { minSize: 1 });
          setGraphStatus('Showing recent clusters');
        } else if (text.includes('type') || text.includes('doc')) {
          applyAndLoad('type', {});
          setGraphStatus('Grouping by file type');
        } else if (text.includes('bridge') || text.includes('gap')) {
          applyAndLoad('topic', { confidence: ['high', 'medium'] });
          setGraphStatus('Surfacing bridges and strong clusters');
        } else {
          applyAndLoad('topic', {});
          setGraphStatus('Showing topic clusters');
        }
        return;
      }

      // Default
      applyAndLoad('topic', {});
      setGraphStatus('Showing topic clusters');
    },
    [
      setClusterMode,
      setClusterFilters,
      setGraphStatus,
      setFocusNodeId,
      setActiveFilters,
      setShowClusters,
      handleClusterExpand,
      selectedNode
    ]
  );

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
      lastFetchedDetailsPathRef.current = null;
      return undefined;
    }

    // Don't re-fetch if we already have details for this path
    if (lastFetchedDetailsPathRef.current === path) return undefined;

    let cancelled = false;
    const fetchDetails = async () => {
      setIsLoadingDocumentDetails(true);
      try {
        const history = await window.electronAPI?.analysisHistory?.getFileHistory?.(path);
        if (!cancelled && history) {
          lastFetchedDetailsPathRef.current = path;
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
  }, [selectedSearchResult, selectedNode, freshMetadata, activeTab]);

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
        graphActions.setEdges(applyEdgeUiPrefs(layoutedEdges));
      }
      setGraphStatus('Layout applied');
    } catch (error) {
      logger.error('[Graph] Layout failed:', error);
      setGraphStatus('Layout failed');
    } finally {
      setIsLayouting(false);
    }
  }, [nodes, edges, graphActions, applyEdgeUiPrefs]);

  /**
   * Handle drag over for file drops to graph
   */
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Check if this is a file drop
    if (!isFileDragEvent(e)) return;
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
    setIsDragOver(true);
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

      const { paths: droppedPaths } = extractDroppedFiles(e.dataTransfer);
      if (droppedPaths.length === 0) return;

      setGraphStatus(
        `Looking up ${droppedPaths.length} file${droppedPaths.length > 1 ? 's' : ''}...`
      );

      try {
        const addedNodes = [];
        const addedEdges = [];

        for (const filePath of droppedPaths) {
          if (!filePath) continue;

          // Search for this file by name to find it in ChromaDB
          const fileName = extractFileName(filePath) || filePath;
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
                        showEdgeLabels: showEdgeLabelsRef.current,
                        showEdgeTooltips: edgeTooltipsRef.current
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
              graphActions.setEdges(applyEdgeUiPrefs(layoutedEdges));
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
    [nodes, edges, graphActions, upsertFileNode, autoLayout, applyEdgeUiPrefs]
  );

  /**
   * Load and display semantic clusters
   */
  const formatDateLabel = useCallback((iso) => {
    if (!iso) return '';
    const ms = Date.parse(String(iso));
    if (!Number.isFinite(ms)) return '';
    try {
      return new Date(ms).toLocaleDateString();
    } catch {
      return '';
    }
  }, []);

  const getClusterDisplayLabel = useCallback(
    (cluster) => {
      const mode = clusterModeRef.current || DEFAULT_CLUSTER_MODE;
      const fallback = cluster?.label || 'Cluster';

      if (mode === 'type') {
        // Prefer file-category buckets ("document", "image", etc) over semantic categories ("Finance", etc).
        if (cluster?.dominantFileCategoryLabel) return String(cluster.dominantFileCategoryLabel);
        if (cluster?.dominantFileCategory) return String(cluster.dominantFileCategory);
        return fallback;
      }
      if (mode === 'tag') {
        // "Tag/Folder": prefer dominant folder name (more consistently available than tags),
        // then fall back to first common tag if present.
        if (cluster?.dominantFolderName) return String(cluster.dominantFolderName);
        const tag = Array.isArray(cluster?.commonTags) ? cluster.commonTags[0] : null;
        return tag ? String(tag) : fallback;
      }
      if (mode === 'time') {
        const start = cluster?.timeRange?.start;
        const end = cluster?.timeRange?.end;
        const startLabel = formatDateLabel(start);
        const endLabel = formatDateLabel(end);
        if (startLabel && endLabel && startLabel !== endLabel) return `${startLabel} – ${endLabel}`;
        if (endLabel) return endLabel;
        return fallback;
      }

      // topic (semantic) default
      return fallback;
    },
    [formatDateLabel]
  );

  const sortClustersForMode = useCallback((clusters) => {
    const mode = clusterModeRef.current || DEFAULT_CLUSTER_MODE;
    const list = Array.isArray(clusters) ? clusters.slice() : [];

    if (mode === 'time') {
      list.sort((a, b) => {
        const aMs = Number.isFinite(a?.timeRange?.endMs)
          ? a.timeRange.endMs
          : Date.parse(a?.timeRange?.end);
        const bMs = Number.isFinite(b?.timeRange?.endMs)
          ? b.timeRange.endMs
          : Date.parse(b?.timeRange?.end);
        const aVal = Number.isFinite(aMs) ? aMs : 0;
        const bVal = Number.isFinite(bMs) ? bMs : 0;
        return bVal - aVal;
      });
      return list;
    }

    if (mode === 'type') {
      const typeLabel = (c) =>
        String(
          c?.dominantFileCategoryLabel || c?.dominantFileCategory || c?.dominantCategory || ''
        );
      list.sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)));
      return list;
    }

    if (mode === 'tag') {
      const tagOrFolder = (c) =>
        String(
          c?.dominantFolderName || (Array.isArray(c?.commonTags) ? c.commonTags[0] || '' : '') || ''
        );
      list.sort((a, b) => tagOrFolder(a).localeCompare(tagOrFolder(b)));
      return list;
    }

    return list;
  }, []);

  const renderClustersToGraph = useCallback(
    (clusters, crossClusterEdges) => {
      const currentFilters = clusterFiltersRef.current;
      const normalizedSearch = (currentFilters.search || '').trim().toLowerCase();

      const filteredClusters = (Array.isArray(clusters) ? clusters : []).filter((cluster) => {
        const confOk = currentFilters.confidence.includes(cluster.confidence || 'low');
        const sizeOk = (cluster.memberCount || 0) >= (currentFilters.minSize || 1);
        const typeOk =
          currentFilters.fileType === 'all' ||
          String(cluster.dominantFileCategory || cluster.dominantCategory || '').toLowerCase() ===
            String(currentFilters.fileType || '').toLowerCase();
        const searchOk =
          !normalizedSearch ||
          (cluster.label || '').toLowerCase().includes(normalizedSearch) ||
          (cluster.commonTags || [])
            .map((t) => (t || '').toLowerCase())
            .some((t) => t.includes(normalizedSearch));
        return confOk && sizeOk && searchOk && typeOk;
      });

      if (filteredClusters.length === 0) {
        graphActions.setNodes([]);
        graphActions.setEdges([]);
        setShowClusters(true);
        setGraphStatus('No groups match your current filters.');
        return;
      }

      const ordered = sortClustersForMode(filteredClusters);

      const clusterNodes = ordered.map((cluster, idx) => ({
        id: cluster.id,
        type: 'clusterNode',
        position: defaultNodePosition(idx),
        data: {
          kind: 'cluster',
          id: cluster.id,
          clusterId: cluster.clusterId,
          label: getClusterDisplayLabel(cluster),
          memberCount: cluster.memberCount,
          memberIds: cluster.memberIds,
          expanded: false,
          topTerms: cluster.topTerms || cluster.commonTags || [],
          confidence: cluster.confidence || 'low',
          dominantCategory: cluster.dominantCategory || null,
          commonTags: cluster.commonTags || [],
          timeRange: cluster.timeRange || null,
          isAutoGenerated: true,
          onCreateSmartFolder: handleCreateSmartFolderFromCluster,
          onMoveAllToFolder: handleMoveAllToFolder,
          onExportFileList: handleExportFileList,
          onOpenAllFiles: handleOpenAllFilesInCluster,
          onSearchWithinCluster: handleSearchWithinCluster,
          onRenameCluster: handleRenameCluster,
          onExpand: handleClusterExpand
        },
        draggable: true
      }));

      const filteredClusterIds = new Set(filteredClusters.map((c) => c.id));
      const uniqueEdgesMap = new Map();
      (Array.isArray(crossClusterEdges) ? crossClusterEdges : [])
        .filter(
          (edge) => filteredClusterIds.has(edge.source) && filteredClusterIds.has(edge.target)
        )
        .forEach((edge) => {
          const [u, v] = [edge.source, edge.target].sort();
          const key = `${u}|${v}`;

          const current = uniqueEdgesMap.get(key) || {
            similarity: 0,
            count: 0,
            sharedTerms: [],
            bridgeFiles: []
          };

          const mergedBridgeFiles = [
            ...(current.bridgeFiles || []),
            ...(edge.bridgeFiles || []).slice(0, 6)
          ].filter(Boolean);

          const uniqueBridgeFiles = Array.from(
            new Map(
              mergedBridgeFiles.map((file) => [file?.id || file?.path || file, file])
            ).values()
          );

          uniqueEdgesMap.set(key, {
            ...current,
            source: u,
            target: v,
            similarity: Math.max(current.similarity || 0, edge.similarity || 0),
            bridgeFiles: uniqueBridgeFiles,
            count:
              uniqueBridgeFiles.length > 0
                ? uniqueBridgeFiles.length
                : (current.count || 0) + (edge.count || 0),
            sharedTerms: [
              ...(current.sharedTerms || []),
              ...(edge.commonTerms || edge.sharedTerms || edge.tags || edge.labels || []).slice(
                0,
                3
              )
            ].filter(Boolean)
          });
        });

      const uniqueEdges = Array.from(uniqueEdgesMap.values());
      const edgesByNode = new Map();
      uniqueEdges.forEach((edge) => {
        if (!edgesByNode.has(edge.source)) edgesByNode.set(edge.source, []);
        edgesByNode.get(edge.source).push(edge);

        if (!edgesByNode.has(edge.target)) edgesByNode.set(edge.target, []);
        edgesByNode.get(edge.target).push(edge);
      });

      const MAX_CONNECTIONS = 2;
      const STRICT_THRESHOLD = 0.65;
      const meaningfulEdges = uniqueEdges.filter((edge) => {
        const sim = edge.similarity || 0;
        if (sim < STRICT_THRESHOLD) return false;

        const sourceEdges = edgesByNode.get(edge.source) || [];
        sourceEdges.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
        const isTopForSource = sourceEdges.indexOf(edge) < MAX_CONNECTIONS;

        const targetEdges = edgesByNode.get(edge.target) || [];
        targetEdges.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
        const isTopForTarget = targetEdges.indexOf(edge) < MAX_CONNECTIONS;

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
          strokeWidth: Math.max(1, (edge.similarity || 0.5) * 1.5),
          strokeDasharray: '4,8',
          opacity: 0.35
        },
        className: 'cross-cluster-edge',
        data: {
          kind: 'cross_cluster',
          similarity: edge.similarity || 0.5,
          bridgeCount: edge.count || 0,
          sharedTerms: Array.from(new Set(edge.sharedTerms || [])).slice(0, 3),
          bridgeFiles: edge.bridgeFiles || [],
          showEdgeLabels: false,
          showEdgeTooltips: edgeTooltipsRef.current
        }
      }));

      graphActions.setNodes(clusterNodes);
      graphActions.setEdges(clusterEdges);
      setShowClusters(true);

      const mode = clusterModeRef.current || DEFAULT_CLUSTER_MODE;
      setGraphStatus(`Found ${filteredClusters.length} groups (cluster by: ${mode})`);

      if (clusterNodes.length > 0) {
        try {
          const estimatedArcWidth = 320 + 140;
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
        } catch (layoutError) {
          logger.warn('[Graph] Cluster layout failed:', layoutError);
        }
      }
    },
    [
      graphActions,
      getClusterDisplayLabel,
      sortClustersForMode,
      handleCreateSmartFolderFromCluster,
      handleMoveAllToFolder,
      handleExportFileList,
      handleOpenAllFilesInCluster,
      handleSearchWithinCluster,
      handleRenameCluster,
      handleClusterExpand
    ]
  );

  const loadClusters = useCallback(async () => {
    setIsComputingClusters(true);
    setGraphStatus('Analyzing file relationships...');
    setError('');

    try {
      // Prefer using cached clusters when available; recompute only if stale.
      let clustersResp = await window.electronAPI?.embeddings?.getClusters?.();
      if (!clustersResp || clustersResp.success !== true) {
        throw new Error(clustersResp?.error || 'Failed to get clusters');
      }

      if (clustersResp.stale === true) {
        const computeResp = await window.electronAPI?.embeddings?.computeClusters?.('auto');
        if (!computeResp || computeResp.success !== true) {
          throw new Error(computeResp?.error || 'Failed to compute clusters');
        }
        clustersResp = await window.electronAPI?.embeddings?.getClusters?.();
        if (!clustersResp || clustersResp.success !== true) {
          throw new Error(clustersResp?.error || 'Failed to get clusters');
        }
      }

      const clusters = clustersResp.clusters || [];
      const crossClusterEdges = clustersResp.crossClusterEdges || [];

      if (!Array.isArray(clusters) || clusters.length === 0) {
        setGraphStatus('No related groups found yet. Try indexing more files.');
        setShowClusters(true);
        graphActions.setNodes([]);
        graphActions.setEdges([]);
        return;
      }

      lastClustersRef.current = clusters;
      lastCrossClusterEdgesRef.current = crossClusterEdges;

      renderClustersToGraph(clusters, crossClusterEdges);
    } catch (e) {
      setError(getErrorMessage(e, 'Cluster loading'));
      setGraphStatus('');
    } finally {
      setIsComputingClusters(false);
    }
  }, [graphActions, renderClustersToGraph]);

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

  // Refresh cluster presentation when mode/filters change (no recompute needed).
  useEffect(() => {
    if (!isOpen || activeTab !== 'graph') return;
    if (!showClusters) return;
    if (isComputingClusters) return;

    const clusters = lastClustersRef.current;
    if (!Array.isArray(clusters) || clusters.length === 0) return;
    const crossEdges = lastCrossClusterEdgesRef.current || [];

    const timer = setTimeout(() => {
      renderClustersToGraph(clusters, crossEdges);
    }, 200);

    return () => clearTimeout(timer);
  }, [
    isOpen,
    activeTab,
    showClusters,
    isComputingClusters,
    clusterMode,
    clusterFilters,
    renderClustersToGraph
  ]);

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
        // Graph search should be fast and interactive.
        // LLM re-ranking can exceed IPC timeouts and make the modal feel "stuck".
        const resp = await window.electronAPI?.embeddings?.search?.(q, {
          topK: defaultTopK,
          mode: 'hybrid',
          rerank: false
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

          // Filter out cluster nodes from current graph - they don't mix well with search results
          // Cluster nodes are designed for cluster exploration view, not search accumulation
          const nodesWithoutClusters = currentNodes.filter(
            (n) => n.type !== 'clusterNode' && n.data?.kind !== 'cluster'
          );
          const edgesWithoutClusters = currentEdges.filter(
            (e) => e.data?.kind !== 'cluster_member' && e.data?.kind !== 'cross_cluster'
          );

          // Turn off cluster view since we're transitioning to search results
          setShowClusters(false);

          const nodeMap = new Map(nodesWithoutClusters.map((n) => [n.id, n]));
          nextNodes.forEach((n) => {
            if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
          });
          const merged = Array.from(nodeMap.values());

          if (merged.length > MAX_GRAPH_NODES) {
            // Don't add more nodes if limit reached
            finalNodes = nodesWithoutClusters;
            nodeLimitReached = true;
            setError(`Graph limit (${MAX_GRAPH_NODES} nodes) reached. Clear graph to start fresh.`);
          } else {
            finalNodes = merged;
          }

          const edgeMap = new Map(edgesWithoutClusters.map((e) => [e.id, e]));
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
                graphActions.setEdges(applyEdgeUiPrefs(result.edges));
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
                graphActions.setEdges(applyEdgeUiPrefs(layoutResult.edges));
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

        if (expandedFileIds.length >= 2) {
          try {
            const simEdgesResp = await window.electronAPI?.embeddings?.getSimilarityEdges?.(
              expandedFileIds,
              { threshold: 0.75, maxEdgesPerNode: 1 }
            );

            if (simEdgesResp?.success && Array.isArray(simEdgesResp.edges)) {
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
                    showEdgeLabels: showEdgeLabelsRef.current,
                    showEdgeTooltips: edgeTooltipsRef.current
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
                type: 'knowledge',
                data: {
                  kind: 'knowledge',
                  weight: edge.weight,
                  concepts: Array.isArray(edge.concepts) ? edge.concepts : [],
                  sourceData: nodeDataMap.get(edge.source) || {},
                  targetData: nodeDataMap.get(edge.target) || {},
                  showEdgeTooltips: edgeTooltipsRef.current
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
    [query, defaultTopK, addMode, autoLayout, graphActions, upsertFileNode, applyEdgeUiPrefs]
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
              showEdgeLabels: showEdgeLabelsRef.current,
              showEdgeTooltips: edgeTooltipsRef.current
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
            // Use refs to get current state (nodes/edges from closure may be stale)
            const finalNodes = (() => {
              const currentNodes = nodesRef.current || [];
              const map = new Map(currentNodes.map((n) => [n.id, n]));
              nextNodes.forEach((n) => {
                if (!map.has(n.id)) map.set(n.id, n);
              });
              return Array.from(map.values());
            })();

            const finalEdges = (() => {
              const currentEdges = edgesRef.current || [];
              const map = new Map(currentEdges.map((e) => [e.id, e]));
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
              graphActions.setEdges(applyEdgeUiPrefs(layoutedEdges));
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
                    showEdgeLabels: showEdgeLabelsRef.current,
                    showEdgeTooltips: edgeTooltipsRef.current
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
    [
      selectedNode,
      autoLayout,
      hopCount,
      decayFactor,
      graphActions,
      upsertFileNode,
      applyEdgeUiPrefs
    ]
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
  const onNodeMouseEnter = useCallback((_, node) => {
    // Only apply for cluster nodes
    if (node.type !== 'clusterNode') return;

    setHoveredClusterId((prev) => (prev === node.id ? prev : node.id));
    setHasHoveredCluster(true);
  }, []);

  const onNodeMouseLeave = useCallback((_, node) => {
    if (node.type !== 'clusterNode') return;

    setHoveredClusterId((prev) => (prev === node.id ? null : prev));
    setHasHoveredCluster(false);
  }, []);

  const handleGraphMove = useCallback((_, viewport) => {
    if (!viewport || typeof viewport.zoom !== 'number') return;
    const nextBucket = viewport.zoom < ZOOM_LABEL_HIDE_THRESHOLD;
    if (nextBucket === zoomBucketRef.current) return;
    zoomBucketRef.current = nextBucket;
    setZoomLevel(viewport.zoom);
  }, []);

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

  // Keep ReactFlow type maps stable across renders (React Flow warning #002).
  // Even if hot reload swaps module-level bindings, these refs remain stable for this mount.
  const rfNodeTypes = useRef(STABLE_NODE_TYPES).current;
  const rfEdgeTypes = useRef(STABLE_EDGE_TYPES).current;

  // FIX: Filter edges based on visible nodes to prevent "dangling" edges
  // Split into baseEdges (expensive, no hover deps) and rfEdges (lightweight hover overlay)
  const baseEdges = useMemo(() => {
    const filtered = showClusters
      ? edges
      : (() => {
          const visibleNodeIds = new Set(rfNodes.map((n) => n.id));
          return edges.filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target));
        })();

    // Bridge overlay: dim non-bridge edges when showing cluster bridges only
    if (bridgeOverlayEnabled && showClusters) {
      return filtered.map((edge) => {
        const isBridge = edge.data?.kind === 'cross_cluster';
        return {
          ...edge,
          style: {
            ...edge.style,
            opacity: isBridge ? 0.9 : 0.05
          },
          data: {
            ...edge.data,
            showEdgeLabels: Boolean(isBridge)
          }
        };
      });
    }

    return filtered;
  }, [edges, rfNodes, showClusters, bridgeOverlayEnabled]);

  const rfEdges = useMemo(() => {
    if (!hoveredClusterId && !hasHoveredCluster) return baseEdges;
    if (!showClusters || bridgeOverlayEnabled) return baseEdges;

    // Hovered cluster highlighting: only when overlay is off
    if (hoveredClusterId) {
      const hoveredId = hoveredClusterId;
      return baseEdges.map((edge) => {
        if (edge.data?.kind !== 'cross_cluster') return edge;
        const isConnected = edge.source === hoveredId || edge.target === hoveredId;
        const targetOpacity = isConnected ? 0.8 : 0;
        const currentOpacity = edge.style?.opacity ?? 1;
        if (currentOpacity === targetOpacity) return edge;
        return {
          ...edge,
          style: {
            ...edge.style,
            opacity: targetOpacity
          },
          className: isConnected
            ? edge.className?.replace('opacity-0', 'opacity-100') || edge.className
            : edge.className?.replace('opacity-100', 'opacity-0') || edge.className
        };
      });
    }

    // hasHoveredCluster is true but hoveredClusterId is null (mouse left cluster)
    return baseEdges.map((edge) => {
      if (edge.data?.kind !== 'cross_cluster') return edge;
      const currentOpacity = edge.style?.opacity ?? 1;
      if (currentOpacity === 0) return edge;
      return {
        ...edge,
        style: {
          ...edge.style,
          opacity: 0
        },
        className: edge.className?.replace('opacity-100', 'opacity-0') || edge.className
      };
    });
  }, [baseEdges, hoveredClusterId, hasHoveredCluster, showClusters, bridgeOverlayEnabled]);

  const rfFitViewOptions = useMemo(() => ({ padding: 0.2 }), []);
  const rfDefaultViewport = useMemo(() => ({ x: 0, y: 0, zoom: 1 }), []);
  const rfProOptions = useMemo(() => ({ hideAttribution: true }), []);

  const miniMapNodeColor = useCallback((n) => {
    if (n.data?.kind === 'query') return '#6366f1'; // Indigo for queries
    if (n.data?.kind === 'cluster' || n.data?.kind === 'duplicate') return '#f59e0b'; // Amber for clusters
    return '#3b82f6'; // Blue for files
  }, []);

  // Helper to compute visible filters as chips
  const activeClusterFilterChips = useMemo(() => {
    const chips = [];
    const conf = clusterFilters.confidence || [];
    if (!conf.includes('high') || !conf.includes('medium') || !conf.includes('low')) {
      chips.push(`Conf: ${conf.join(', ')}`);
    }
    if ((clusterFilters.minSize || 1) > 1) chips.push(`Min ${clusterFilters.minSize}`);
    if (clusterFilters.fileType && clusterFilters.fileType !== 'all') {
      chips.push(`Type: ${clusterFilters.fileType}`);
    }
    if (clusterFilters.search) chips.push(`Search: ${clusterFilters.search}`);
    return chips;
  }, [clusterFilters]);

  const activeGraphFilterChips = useMemo(() => {
    const chips = [];
    const types = activeFilters.types || [];
    const conf = activeFilters.confidence || [];
    if (types.length > 0 && types.length < 4) {
      chips.push(`Nodes: ${types.join(', ')}`);
    }
    if (conf.length > 0 && conf.length < 3) {
      chips.push(`Conf: ${conf.join(', ')}`);
    }
    return chips;
  }, [activeFilters]);

  const hasGraphFilterIndicators = useMemo(
    () =>
      bridgeOverlayEnabled ||
      clusterMode !== DEFAULT_CLUSTER_MODE ||
      activeClusterFilterChips.length > 0 ||
      activeGraphFilterChips.length > 0,
    [bridgeOverlayEnabled, clusterMode, activeClusterFilterChips, activeGraphFilterChips]
  );

  const showEmptyBanner =
    hasLoadedStats && stats && typeof stats.files === 'number' && stats.files === 0 && !error;
  // Use fresh metadata from ChromaDB when available (for current file paths after moves)
  const selectedPath = freshMetadata?.path || selectedNode?.data?.path || '';
  const selectedLabel = freshMetadata?.name || selectedNode?.data?.label || selectedNode?.id || '';
  const selectedKind = selectedNode?.data?.kind || '';

  // Cluster-specific derived data
  const selectedClusterInfo = useMemo(() => {
    if (selectedKind !== 'cluster' || !selectedNode) return null;
    const neighborEdges = edges.filter(
      (e) =>
        e.data?.kind === 'cross_cluster' &&
        (e.source === selectedNode.id || e.target === selectedNode.id)
    );
    const neighborIds = new Set(
      neighborEdges.map((e) => (e.source === selectedNode.id ? e.target : e.source))
    );
    const neighborNodes = rfNodes.filter((n) => neighborIds.has(n.id));
    const bridges = neighborEdges.map((edge) => ({
      id: edge.id,
      similarity: edge.data?.similarity || 0,
      bridgeCount: edge.data?.bridgeCount || 0,
      sharedTerms: edge.data?.sharedTerms || [],
      targetId: edge.source === selectedNode.id ? edge.target : edge.source,
      targetLabel: neighborNodes.find(
        (n) => n.id === (edge.source === selectedNode.id ? edge.target : edge.source)
      )?.data?.label,
      bridgeFiles: edge.data?.bridgeFiles || []
    }));
    return {
      bridges,
      neighbors: neighborNodes
    };
  }, [edges, rfNodes, selectedKind, selectedNode]);

  // Reset related-cluster UI when selection changes to avoid "sticky" expansion noise
  useEffect(() => {
    // Clear per-bridge expansion state whenever the selected node changes
    setExpandedRelatedClusters({});
    setShowAllBridgeFilesByBridge({});

    const count = selectedClusterInfo?.bridges?.length || 0;
    // Progressive disclosure: auto-collapse when there are many related clusters
    setIsRelatedClustersOpen(count > 0 && count <= 2);
  }, [selectedNodeId, selectedClusterInfo?.bridges?.length]);

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
      <div className="relative flex flex-col gap-4 min-h-[60vh]">
        {isOpen && isLoadingStats && !hasLoadedStats && (
          <ModalLoadingOverlay message="Loading Knowledge OS..." inline />
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
          <Text
            as="div"
            variant="tiny"
            className="flex items-center justify-between text-system-gray-400"
          >
            <span>
              {hasLoadedStats ? `${stats?.files || 0} files indexed` : 'Loading index...'}
            </span>
            <IconButton
              onClick={refreshStats}
              disabled={isLoadingStats}
              size="sm"
              variant="ghost"
              className="h-7 w-7 text-system-gray-400 hover:text-system-gray-600"
              title="Refresh embeddings status"
              aria-label="Refresh embeddings status"
              icon={<RefreshCw className={`h-3.5 w-3.5 ${isLoadingStats ? 'animate-spin' : ''}`} />}
            />
          </Text>
        )}

        {/* Empty embeddings banner */}
        {showEmptyBanner && (
          <EmptyEmbeddingsBanner
            onRebuildFolders={rebuildFolders}
            onRebuildFiles={rebuildFiles}
            isRebuildingFolders={isRebuildingFolders}
            isRebuildingFiles={isRebuildingFiles}
            embeddingConfig={embeddingConfig}
            onOpenSettings={handleOpenSettings}
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
                <Text
                  as="div"
                  variant="tiny"
                  className="flex items-center gap-2 text-system-gray-400 shrink-0"
                >
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Searching...</span>
                </Text>
              )}
            </div>

            {/* Search mode fallback banner */}
            <SearchModeBanner meta={searchMeta} />

            {/* Results header with view toggle */}
            {searchResults.length > 0 && (
              <div className="flex items-center justify-between">
                <Text as="span" variant="small" className="text-system-gray-500">
                  {searchStatusLabel}
                </Text>
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
                    <Button
                      type="button"
                      onClick={() => setViewMode('all')}
                      aria-label="View all results"
                      aria-pressed={viewMode === 'all'}
                      variant={viewMode === 'all' ? 'secondary' : 'ghost'}
                      size="sm"
                      leftIcon={<List className="w-3.5 h-3.5" />}
                      className={`rounded-md px-2.5 py-1 text-xs h-auto ${viewMode === 'all' ? 'bg-white text-system-gray-900 shadow-sm' : 'text-system-gray-500 hover:text-system-gray-700'}`}
                    >
                      All
                    </Button>
                    <Button
                      type="button"
                      onClick={() => setViewMode('grouped')}
                      aria-label="Group results by type"
                      aria-pressed={viewMode === 'grouped'}
                      variant={viewMode === 'grouped' ? 'secondary' : 'ghost'}
                      size="sm"
                      leftIcon={<LayoutGrid className="w-3.5 h-3.5" />}
                      className={`rounded-md px-2.5 py-1 text-xs h-auto ${viewMode === 'grouped' ? 'bg-white text-system-gray-900 shadow-sm' : 'text-system-gray-500 hover:text-system-gray-700'}`}
                    >
                      By Type
                    </Button>
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
                    indexingHint={embeddingConfig}
                    onOpenSettings={handleOpenSettings}
                    onRebuildFiles={rebuildFiles}
                    onSearchClick={setQuery}
                    corrections={queryMeta?.corrections}
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
                        <Text
                          as="h4"
                          variant="tiny"
                          className="font-semibold text-system-gray-500 uppercase tracking-wide"
                        >
                          {category}
                        </Text>
                        <Text
                          as="span"
                          variant="tiny"
                          className="text-system-gray-400 bg-system-gray-100 px-1.5 py-0.5 rounded-full"
                        >
                          {results.length}
                        </Text>
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
                      <Heading as="h3" variant="h5" className="break-words">
                        {selectedSearchResult?.metadata?.name ||
                          safeBasename(selectedSearchResult?.metadata?.path) ||
                          'File'}
                      </Heading>
                      <Text variant="tiny" className="text-system-gray-500 mt-1 break-all">
                        {formatDisplayPath(selectedSearchResult?.metadata?.path || '', {
                          redact: redactPaths,
                          segments: 2
                        })}
                      </Text>
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
                            <Text variant="small" className="font-medium text-system-gray-800">
                              {subject}
                            </Text>
                          )}
                          {summary && (
                            <Text variant="small" className="text-system-gray-600 mt-1">
                              {summary}
                            </Text>
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
                            <Text
                              as="span"
                              variant="tiny"
                              key={tag}
                              className="px-2 py-0.5 rounded-full bg-system-gray-100 text-system-gray-600"
                            >
                              {tag}
                            </Text>
                          ))}
                          {tags.length > 6 && (
                            <Text as="span" variant="tiny" className="text-system-gray-400">
                              +{tags.length - 6} more
                            </Text>
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
                          <Text
                            variant="tiny"
                            className="text-system-gray-600 whitespace-pre-wrap leading-relaxed"
                          >
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
                          </Text>
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
                    <Text variant="small" className="text-system-gray-500">
                      Select a file to preview
                    </Text>
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
              <div className="mx-4 mt-4 rounded-lg border border-stratosort-warning/30 bg-stratosort-warning/10 px-3 py-2 flex items-center justify-between gap-3">
                <Text as="span" variant="tiny" className="text-system-gray-700">
                  Embeddings are not ready yet. Build your embeddings in Settings to enable document
                  citations and sources.
                </Text>
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
                className="surface-panel p-0 flex flex-col h-full overflow-hidden"
                role="complementary"
                aria-label="Graph Controls"
              >
                <div className="p-4 border-b border-system-gray-100 bg-system-gray-50/50">
                  <Text as="div" variant="tiny" className={GRAPH_SIDEBAR_SECTION_TITLE}>
                    <Network className="w-3.5 h-3.5 text-stratosort-blue" aria-hidden="true" />
                    <span>Graph Controls</span>
                  </Text>
                </div>

                <div className="p-4 flex-1 min-h-0 overflow-y-auto panel-scroll flex flex-col gap-5">
                  {/* Add to Graph */}
                  <section className="space-y-2">
                    <Text as="div" variant="tiny" className={GRAPH_SIDEBAR_SECTION_TITLE}>
                      <SearchIcon className="w-3.5 h-3.5" />
                      Add to Graph
                    </Text>
                    <div className={`${GRAPH_SIDEBAR_CARD} space-y-3`}>
                      <SearchAutocomplete
                        value={query}
                        onChange={setQuery}
                        onSearch={runGraphSearch}
                        placeholder="Search files..."
                        ariaLabel="Search to add nodes"
                        className="bg-white shadow-sm"
                      />
                      <div className="flex items-center justify-between gap-3">
                        <Text
                          as="label"
                          variant="tiny"
                          className="text-system-gray-600 flex items-center gap-2 select-none cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={addMode}
                            onChange={(e) => setAddMode(e.target.checked)}
                            className="h-4 w-4 rounded border-system-gray-300 text-stratosort-blue focus:ring-stratosort-blue/20"
                          />
                          Add to existing
                        </Text>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={runGraphSearch}
                          className="px-4 py-1.5 h-auto text-xs font-semibold shadow-sm"
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  </section>

                  {/* Explore */}
                  <section className="space-y-3">
                    <Text as="div" variant="tiny" className={GRAPH_SIDEBAR_SECTION_TITLE}>
                      <Network className="w-3.5 h-3.5" />
                      <span>Explore</span>
                    </Text>

                    <div className={`${GRAPH_SIDEBAR_CARD} space-y-3`}>
                      <div>
                        <Text
                          as="label"
                          variant="tiny"
                          className="font-medium text-system-gray-700 mb-1.5 block"
                        >
                          Cluster by
                        </Text>
                        <Select
                          value={clusterMode}
                          onChange={(e) => setClusterMode(e.target.value)}
                          className="text-sm shadow-sm bg-white"
                        >
                          <option value="topic">Topic (semantic)</option>
                          <option value="time">Time (recency)</option>
                          <option value="type">Type (file category)</option>
                          <option value="tag">Tag/Folder</option>
                        </Select>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-between text-xs font-medium text-system-gray-700 bg-white border border-system-gray-200 rounded-lg px-3 py-2 hover:bg-system-gray-50"
                        onClick={() => setShowAdvancedFilters((prev) => !prev)}
                        aria-expanded={showAdvancedFilters}
                        aria-controls="advanced-cluster-filters"
                      >
                        <span>
                          {showAdvancedFilters ? 'Hide advanced filters' : 'Show advanced filters'}
                        </span>
                        <ChevronDown
                          className={`h-3.5 w-3.5 text-system-gray-400 transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`}
                        />
                      </Button>

                      {showAdvancedFilters && (
                        <div
                          id="advanced-cluster-filters"
                          className="mt-2 space-y-3 border border-system-gray-200 rounded-lg p-3 bg-system-gray-50/80"
                        >
                          <Text
                            as="div"
                            variant="tiny"
                            className="font-medium text-system-gray-600 mb-1.5"
                          >
                            Confidence Level
                          </Text>
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {['high', 'medium', 'low'].map((conf) => (
                              <Text
                                key={conf}
                                as="label"
                                variant="tiny"
                                className="flex items-center gap-1.5 text-system-gray-600 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={clusterFilters.confidence.includes(conf)}
                                  onChange={(e) =>
                                    setClusterFilters((prev) => {
                                      const current = prev.confidence;
                                      const next = e.target.checked
                                        ? Array.from(new Set([...current, conf]))
                                        : current.filter((c) => c !== conf);
                                      return { ...prev, confidence: next };
                                    })
                                  }
                                  className="h-4 w-4 rounded border-system-gray-300 text-stratosort-blue focus:ring-stratosort-blue/20"
                                />
                                <span className="capitalize">{conf}</span>
                              </Text>
                            ))}
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Text
                                as="label"
                                variant="tiny"
                                className="font-medium text-system-gray-600 mb-1.5 block"
                              >
                                Min size
                              </Text>
                              <Input
                                type="number"
                                min={1}
                                value={clusterFilters.minSize}
                                onChange={(e) =>
                                  setClusterFilters((prev) => ({
                                    ...prev,
                                    minSize: Math.max(1, Number(e.target.value) || 1)
                                  }))
                                }
                                className="h-8 text-sm bg-white"
                              />
                            </div>

                            <div>
                              <Text
                                as="label"
                                variant="tiny"
                                className="font-medium text-system-gray-600 mb-1.5 block"
                              >
                                File type
                              </Text>
                              <Select
                                value={clusterFilters.fileType}
                                onChange={(e) =>
                                  setClusterFilters((prev) => ({
                                    ...prev,
                                    fileType: e.target.value
                                  }))
                                }
                                className="h-8 text-sm bg-white"
                              >
                                <option value="all">All</option>
                                <option value="document">Document</option>
                                <option value="spreadsheet">Spreadsheet</option>
                                <option value="code">Code</option>
                                <option value="image">Image</option>
                                <option value="audio">Audio</option>
                                <option value="video">Video</option>
                              </Select>
                            </div>
                          </div>

                          <Input
                            value={clusterFilters.search}
                            onChange={(e) =>
                              setClusterFilters((prev) => ({ ...prev, search: e.target.value }))
                            }
                            placeholder="Search clusters..."
                            className="h-8 text-sm bg-white"
                          />
                        </div>
                      )}
                    </div>

                    {/* Insights (actionable + discovery) */}
                    {showClusters &&
                      (clusterInsights.topConnections.length > 0 ||
                        clusterInsights.emergingClusters.length > 0) && (
                        <div className="pt-3 border-t border-system-gray-100 space-y-3">
                          <div className="flex items-center justify-between">
                            <Text
                              as="div"
                              variant="tiny"
                              className="font-semibold text-system-gray-500 uppercase tracking-wider flex items-center gap-2"
                            >
                              <Sparkles className="h-3.5 w-3.5 text-stratosort-blue" />
                              Insights
                            </Text>
                            <Button
                              variant={bridgeOverlayEnabled ? 'secondary' : 'ghost'}
                              size="sm"
                              onClick={() => setBridgeOverlayEnabled((v) => !v)}
                              className="h-7 px-2 py-0 text-xs"
                              title="Dim everything except cross-cluster bridges"
                            >
                              {bridgeOverlayEnabled ? 'Bridges: On' : 'Bridges only'}
                            </Button>
                          </div>

                          {clusterInsights.topConnections.length > 0 && (
                            <div className="space-y-2">
                              <Text
                                as="div"
                                variant="tiny"
                                className="font-semibold text-system-gray-500 uppercase tracking-wider"
                              >
                                Top connections
                              </Text>
                              <div className="space-y-1.5">
                                {clusterInsights.topConnections.map((c) => (
                                  <div
                                    key={c.id}
                                    onClick={() => focusNode(c.targetId)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        focusNode(c.targetId);
                                      }
                                    }}
                                    className="w-full text-left border border-system-gray-200 rounded-lg bg-white hover:bg-system-gray-50 px-2 py-2 cursor-pointer"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <Text
                                        as="span"
                                        variant="tiny"
                                        className="text-system-gray-800"
                                      >
                                        <span className="font-medium">{c.sourceLabel}</span>
                                        <span className="text-system-gray-400 mx-1">↔</span>
                                        <span className="font-medium">{c.targetLabel}</span>
                                      </Text>
                                      <Text
                                        as="span"
                                        variant="tiny"
                                        className="text-system-gray-500"
                                      >
                                        {Math.round((c.similarity || 0) * 100)}%
                                      </Text>
                                    </div>
                                    {c.sharedTerms.length > 0 && (
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {c.sharedTerms.slice(0, 3).map((t) => (
                                          <span
                                            key={`${c.id}-${t}`}
                                            className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-[10px]"
                                          >
                                            {t}
                                          </span>
                                        ))}
                                        {Array.isArray(c.bridgeFiles) &&
                                          c.bridgeFiles.length > 0 && (
                                            <span className="px-1.5 py-0.5 bg-white border border-system-gray-200 rounded text-[10px] text-system-gray-600">
                                              {c.bridgeFiles.length} bridge file
                                              {c.bridgeFiles.length === 1 ? '' : 's'}
                                            </span>
                                          )}
                                      </div>
                                    )}
                                    {Array.isArray(c.bridgeFiles) && c.bridgeFiles.length > 0 && (
                                      <div className="mt-2 space-y-1">
                                        {c.bridgeFiles.slice(0, 3).map((file) => {
                                          const filePath = file?.path || null;
                                          const label =
                                            file?.name ||
                                            (filePath ? safeBasename(filePath) : null) ||
                                            file?.id ||
                                            String(file);
                                          return (
                                            <div
                                              key={filePath || file?.id || label}
                                              className="flex items-center justify-between gap-2 text-[11px] text-system-gray-700 bg-white border border-system-gray-100 rounded px-2 py-1"
                                              onClick={(e) => e.stopPropagation()}
                                              role="presentation"
                                            >
                                              <span className="truncate flex-1">{label}</span>
                                              {filePath && (
                                                <div className="flex gap-1">
                                                  <Button
                                                    variant="ghost"
                                                    size="xs"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      openFile(filePath);
                                                    }}
                                                    title="Open file"
                                                  >
                                                    <ExternalLink className="h-3 w-3" />
                                                  </Button>
                                                  <Button
                                                    variant="ghost"
                                                    size="xs"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      revealFile(filePath);
                                                    }}
                                                    title="Show in folder"
                                                  >
                                                    <FolderOpen className="h-3 w-3" />
                                                  </Button>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                        {c.bridgeFiles.length > 3 && (
                                          <Text
                                            as="div"
                                            variant="tiny"
                                            className="text-system-gray-500"
                                          >
                                            +{c.bridgeFiles.length - 3} more
                                          </Text>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {clusterInsights.emergingClusters.length > 0 && (
                            <div className="space-y-2">
                              <Text
                                as="div"
                                variant="tiny"
                                className="font-semibold text-system-gray-500 uppercase tracking-wider"
                              >
                                Emerging topics
                              </Text>
                              <div className="space-y-1.5">
                                {clusterInsights.emergingClusters.map((c) => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => focusNode(c.id)}
                                    className="w-full text-left border border-system-gray-200 rounded-lg bg-white hover:bg-system-gray-50 px-2 py-2"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <Text
                                        as="span"
                                        variant="tiny"
                                        className="text-system-gray-800"
                                      >
                                        <span className="font-medium">{c.label}</span>
                                      </Text>
                                      <Text
                                        as="span"
                                        variant="tiny"
                                        className="text-system-gray-500"
                                      >
                                        {new Date(c.endMs).toLocaleDateString()}
                                      </Text>
                                    </div>
                                    <Text
                                      as="div"
                                      variant="tiny"
                                      className="text-system-gray-500 mt-0.5"
                                    >
                                      {c.memberCount} file{c.memberCount === 1 ? '' : 's'}
                                    </Text>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {selectedNode?.data?.kind === 'cluster' && (
                            <div className="space-y-2">
                              <Text
                                as="div"
                                variant="tiny"
                                className="font-semibold text-system-gray-500 uppercase tracking-wider"
                              >
                                Suggested next actions
                              </Text>
                              <div className="flex flex-wrap gap-2">
                                {typeof selectedNode?.data?.onCreateSmartFolder === 'function' &&
                                  ['high', 'medium'].includes(
                                    String(selectedNode?.data?.confidence)
                                  ) &&
                                  (selectedNode?.data?.memberCount || 0) >= 6 && (
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      className="h-8 text-xs"
                                      onClick={() =>
                                        selectedNode?.data?.onCreateSmartFolder?.(selectedNode.data)
                                      }
                                    >
                                      Create Smart Folder
                                    </Button>
                                  )}

                                {(clusterInsights.connectedEdgeCounts.get(selectedNode.id) || 0) >
                                  0 && (
                                  <Button
                                    variant={bridgeOverlayEnabled ? 'secondary' : 'ghost'}
                                    size="sm"
                                    className="h-8 text-xs"
                                    onClick={() => setBridgeOverlayEnabled(true)}
                                  >
                                    Explore Bridges
                                  </Button>
                                )}

                                {typeof selectedNode?.data?.onSearchWithinCluster ===
                                  'function' && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 text-xs"
                                    onClick={() =>
                                      selectedNode?.data?.onSearchWithinCluster?.(selectedNode.data)
                                    }
                                  >
                                    Search Within
                                  </Button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                    {/* Guide assistant */}
                    <div className={GRAPH_SIDEBAR_CARD}>
                      <div className="flex items-center justify-between mb-2">
                        <Text
                          as="span"
                          variant="tiny"
                          className="font-semibold text-system-gray-700"
                        >
                          Guide me
                        </Text>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowGuidePanel((v) => !v)}
                          className="h-7 px-2 py-0 text-xs text-system-gray-500 hover:text-stratosort-blue"
                        >
                          {showGuidePanel ? 'Hide' : 'Show'}
                        </Button>
                      </div>
                      {showGuidePanel && (
                        <div className="space-y-2 pt-2 border-t border-system-gray-100">
                          <div className="grid grid-cols-2 gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs justify-start h-8"
                              onClick={() => handleGuideIntent('related')}
                            >
                              Related topics
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs justify-start h-8"
                              onClick={() => handleGuideIntent('recent')}
                            >
                              Recent changes
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs justify-start h-8"
                              onClick={() => handleGuideIntent('type')}
                            >
                              By type
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs justify-start h-8"
                              onClick={() => handleGuideIntent('bridges')}
                            >
                              Bridges/gaps
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs justify-start h-8"
                              onClick={() => handleGuideIntent('expand')}
                            >
                              Expand selection
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs justify-start h-8"
                              onClick={() => handleGuideIntent('bridgesOnly')}
                            >
                              Bridges only
                            </Button>
                          </div>
                          <div className="flex gap-1.5 pt-1">
                            <Input
                              value={guideInput}
                              onChange={(e) => setGuideInput(e.target.value)}
                              placeholder="Describe what you need..."
                              className="h-8 text-sm bg-white"
                            />
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() =>
                                guideInput.trim() &&
                                handleGuideIntent('custom', { text: guideInput })
                              }
                              className="h-8 px-3 text-xs font-semibold"
                            >
                              Go
                            </Button>
                          </div>
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-system-gray-500 hover:text-system-gray-700"
                              onClick={resetGraphFilters}
                            >
                              Reset filters
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Actions */}
                  <section className="space-y-3">
                    <Text as="div" variant="tiny" className={GRAPH_SIDEBAR_SECTION_TITLE}>
                      <List className="w-3.5 h-3.5" />
                      <span>Actions</span>
                    </Text>
                    <div className={`${GRAPH_SIDEBAR_CARD} space-y-3`}>
                      <div className="space-y-2.5">
                        <Button
                          variant={showClusters ? 'primary' : 'secondary'}
                          size="sm"
                          onClick={loadClusters}
                          disabled={isComputingClusters}
                          className="w-full justify-center h-9 text-xs font-semibold shadow-sm"
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
                          className="w-full justify-center h-9 text-xs font-semibold shadow-sm"
                          title="Organize nodes automatically"
                        >
                          <LayoutGrid className="h-4 w-4" />
                          <span>{isLayouting ? 'Organizing...' : 'Re-organize Layout'}</span>
                        </Button>
                      </div>

                      {showClusters && (
                        <div className="pt-3 border-t border-system-gray-100 flex gap-2">
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
                            className="flex-1 justify-center text-xs h-8"
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
                            className="flex-1 justify-center text-xs h-8"
                            title="Collapse all clusters"
                          >
                            <Minimize2 className="h-3.5 w-3.5" />
                            <span>Collapse All</span>
                          </Button>
                        </div>
                      )}

                      {focusNodeId && (
                        <div className="pt-3 border-t border-system-gray-100">
                          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <Text
                                as="span"
                                variant="tiny"
                                className="font-medium text-indigo-700"
                              >
                                Focus Mode Active
                              </Text>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleClearFocus}
                                className="text-xs text-indigo-600 hover:bg-indigo-100 px-2 py-0.5 h-auto"
                              >
                                Clear Focus
                              </Button>
                            </div>
                            <div>
                              <Text
                                as="label"
                                variant="tiny"
                                className="font-medium text-indigo-600 mb-1.5 block"
                              >
                                Focus Depth
                              </Text>
                              <Select
                                value={focusDepth}
                                onChange={(e) => setFocusDepth(Number(e.target.value))}
                                className="text-sm text-indigo-700"
                              >
                                <option value={0}>Only selected</option>
                                <option value={1}>1 level (Direct)</option>
                                <option value={2}>2 levels</option>
                                <option value={3}>3 levels (Deep)</option>
                              </Select>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="pt-3 border-t border-system-gray-100">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (nodes.length > 0) {
                              setShowClearConfirm(true);
                            }
                          }}
                          disabled={nodes.length === 0}
                          className="w-full justify-center text-red-600 border border-red-100 bg-red-50/40 hover:bg-red-50 hover:text-red-700"
                        >
                          Clear Graph
                        </Button>
                      </div>
                    </div>
                  </section>

                  {/* Advanced Options */}
                  <section className="space-y-2">
                    <Text as="div" variant="tiny" className={GRAPH_SIDEBAR_SECTION_TITLE}>
                      <CheckSquare className="w-3.5 h-3.5" />
                      <span>Advanced</span>
                    </Text>
                    <div className={`${GRAPH_SIDEBAR_CARD} !p-2`}>
                      <Button
                        onClick={() => setShowAdvancedControls(!showAdvancedControls)}
                        variant="ghost"
                        size="sm"
                        rightIcon={
                          showAdvancedControls ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )
                        }
                        className="w-full justify-between text-xs font-semibold text-system-gray-600 hover:text-system-gray-800 px-2 py-2"
                      >
                        Advanced Options
                      </Button>

                      {showAdvancedControls && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200 pt-3 border-t border-system-gray-100">
                          {/* Filter */}
                          <div>
                            <Text
                              as="label"
                              variant="tiny"
                              className="font-medium text-system-gray-600 mb-1.5 block"
                            >
                              Filter Visibility
                            </Text>
                            <Input
                              value={withinQuery}
                              onChange={(e) => setWithinQuery(e.target.value)}
                              placeholder="Filter nodes..."
                              className="h-8 text-sm bg-white"
                            />
                          </div>

                          {/* Expansion Settings */}
                          <div>
                            <Text
                              as="label"
                              variant="tiny"
                              className="font-medium text-system-gray-600 mb-1.5 block"
                            >
                              Connection Depth
                            </Text>
                            <Select
                              value={hopCount}
                              onChange={(e) => setHopCount(Number(e.target.value))}
                              className="text-sm bg-white"
                            >
                              <option value={1}>1 level (Direct)</option>
                              <option value={2}>2 levels</option>
                              <option value={3}>3 levels (Deep)</option>
                            </Select>
                          </div>

                          {/* Behavior Options */}
                          <div className="space-y-2 pt-1">
                            <Text
                              as="label"
                              variant="tiny"
                              className="text-system-gray-600 flex items-center gap-2 select-none cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={autoLayout}
                                onChange={(e) => setAutoLayout(e.target.checked)}
                                className="h-4 w-4 rounded border-system-gray-300 text-stratosort-blue focus:ring-stratosort-blue/20"
                              />
                              Auto-layout on changes
                            </Text>

                            <Text
                              as="label"
                              variant="tiny"
                              className="text-system-gray-600 flex items-center gap-2 select-none cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={enableAutoClustering}
                                onChange={(e) => setEnableAutoClustering(e.target.checked)}
                                className="h-4 w-4 rounded border-system-gray-300 text-stratosort-blue focus:ring-stratosort-blue/20"
                              />
                              Auto-load clusters
                            </Text>

                            <Text
                              as="label"
                              variant="tiny"
                              className="text-system-gray-600 flex items-center gap-2 select-none cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={showEdgeLabels}
                                onChange={(e) => setShowEdgeLabels(e.target.checked)}
                                className="h-4 w-4 rounded border-system-gray-300 text-stratosort-blue focus:ring-stratosort-blue/20"
                              />
                              Show connection labels
                            </Text>
                          </div>

                          {/* Save/Load Controls */}
                          <div className="pt-2 mt-2 border-t border-system-gray-100 flex gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={handleSaveGraph}
                              className="flex-1 justify-center h-8 text-xs"
                            >
                              Save State
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={handleLoadGraph}
                              className="flex-1 justify-center h-8 text-xs"
                            >
                              Load State
                            </Button>
                          </div>

                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleFindDuplicates}
                            disabled={isFindingDuplicates}
                            className="w-full justify-center h-8 text-xs"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            <span>Find Duplicates</span>
                          </Button>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Status Footer */}
                  <Text
                    as="div"
                    variant="tiny"
                    className="mt-auto pt-4 text-system-gray-400 border-t border-system-gray-100"
                  >
                    {nodes.length > 0 ? (
                      <div className="flex justify-between items-center">
                        <span>{nodes.length} nodes</span>
                        <span>{edges.length} links</span>
                      </div>
                    ) : (
                      <div className="italic text-center">Empty graph</div>
                    )}
                  </Text>
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
              ref={graphContainerRef}
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
                  <Button
                    onClick={() => setShowClusters(!showClusters)}
                    variant="secondary"
                    size="sm"
                    leftIcon={<Layers className="w-4 h-4" />}
                    className={`h-8 px-2 backdrop-blur-sm shadow-sm ${
                      showClusters
                        ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                        : 'bg-white/90 border-system-gray-200 text-system-gray-600 hover:text-system-gray-800 hover:bg-white'
                    }`}
                    title={
                      showClusters
                        ? 'Hide clusters (simplify view)'
                        : 'Show clusters (reveal structure)'
                    }
                  >
                    <Text as="span" variant="tiny" className="font-medium hidden sm:inline">
                      {showClusters ? 'Clusters On' : 'Clusters Off'}
                    </Text>
                  </Button>
                )}

                {/* Help button to re-show tour */}
                <IconButton
                  onClick={() => setShowTourManually(true)}
                  size="sm"
                  variant="secondary"
                  className="h-8 w-8 bg-white/90 text-system-gray-600 hover:text-stratosort-blue hover:bg-white"
                  title="Show graph tour"
                  aria-label="Show graph tour"
                  icon={<HelpCircle className="w-4 h-4" />}
                />
                <IconButton
                  onClick={() => {
                    setIsGraphMaximized(!isGraphMaximized);
                    // Wait for layout transition then fit view
                    setTimeout(() => {
                      reactFlowInstance.current?.fitView({ padding: 0.2, duration: 800 });
                    }, 300);
                  }}
                  size="sm"
                  variant="secondary"
                  className="h-8 w-8 bg-white/90 text-system-gray-600 hover:text-system-gray-900 hover:bg-white"
                  title={isGraphMaximized ? 'Exit Full View' : 'Maximize Graph View'}
                  aria-label={isGraphMaximized ? 'Exit full view' : 'Maximize graph view'}
                  icon={
                    isGraphMaximized ? (
                      <Minimize2 className="w-4 h-4" />
                    ) : (
                      <Maximize2 className="w-4 h-4" />
                    )
                  }
                />
              </div>

              {/* Drag overlay indicator */}
              {isDragOver && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-stratosort-blue/10 backdrop-blur-sm pointer-events-none animate-in fade-in duration-200">
                  <div className="bg-white rounded-xl shadow-xl px-8 py-6 flex flex-col items-center gap-3 border-2 border-stratosort-blue border-dashed">
                    <div className="w-12 h-12 rounded-full bg-stratosort-blue/10 flex items-center justify-center">
                      <FolderPlus className="w-6 h-6 text-stratosort-blue" />
                    </div>
                    <Text variant="small" className="font-medium text-system-gray-900">
                      Drop files to add to graph
                    </Text>
                    <Text variant="tiny" className="text-system-gray-500">
                      Files must be indexed first
                    </Text>
                  </div>
                </div>
              )}

              {nodes.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-8 animate-in fade-in duration-500">
                  <div className="w-20 h-20 bg-system-gray-50 rounded-full flex items-center justify-center mb-6">
                    <Network className="w-10 h-10 text-stratosort-blue opacity-50" />
                  </div>

                  <Heading as="h3" variant="h4" className="mb-2">
                    Stop Searching. Start Finding.
                  </Heading>
                  <Text
                    variant="small"
                    className="text-system-gray-500 max-w-md mb-8 leading-relaxed"
                  >
                    Your files are scattered across folders. Clustering reveals how they naturally
                    belong together—even files you forgot you had.
                  </Text>

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
                    <Text
                      as="div"
                      variant="tiny"
                      className="text-system-gray-400 mt-2 flex justify-center gap-4"
                    >
                      <span>or drag files here from the list</span>
                    </Text>
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

                  <Text
                    as="div"
                    variant="tiny"
                    className="grid grid-cols-2 gap-x-8 gap-y-3 text-system-gray-400 max-w-md border-t border-system-gray-100 pt-6"
                  >
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
                  </Text>
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

                      /* Hide connection handles (dots) for now */
                      .graph-flow .react-flow__handle {
                        opacity: 0;
                        pointer-events: none;
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
                    className={`graph-flow bg-[var(--surface-muted)] ${zoomLevel < ZOOM_LABEL_HIDE_THRESHOLD ? 'graph-zoomed-out' : ''}`}
                    onNodeClick={onNodeClick}
                    onNodeDoubleClick={onNodeDoubleClick}
                    onNodeMouseEnter={onNodeMouseEnter}
                    onNodeMouseLeave={onNodeMouseLeave}
                    onInit={(instance) => {
                      reactFlowInstance.current = instance;
                    }}
                    onMove={handleGraphMove}
                    fitView
                    fitViewOptions={rfFitViewOptions}
                    minZoom={0.2}
                    maxZoom={2}
                    zoomOnScroll={false}
                    // Wheel scrolling should scroll the modal page; panning is available via drag.
                    panOnScroll={false}
                    defaultViewport={rfDefaultViewport}
                    proOptions={rfProOptions}
                  >
                    <Background color="#e5e7eb" gap={16} />
                    <MiniMap pannable zoomable nodeColor={miniMapNodeColor} />
                    <Controls showInteractive={false} />

                    {/* Active filter chips (top-left) */}
                    {hasGraphFilterIndicators && (
                      <Panel position="top-left" className="pointer-events-auto">
                        <div className="flex flex-wrap items-center gap-1.5 bg-white/90 backdrop-blur border border-system-gray-200 rounded-lg px-2 py-1 shadow-sm">
                          {clusterMode !== DEFAULT_CLUSTER_MODE && (
                            <span className="px-2 py-0.5 rounded-full bg-system-gray-50 border border-system-gray-200 text-[10px] text-system-gray-600">
                              Mode: {clusterMode}
                            </span>
                          )}
                          {bridgeOverlayEnabled && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[10px] text-amber-700">
                              Bridges only
                            </span>
                          )}
                          {activeClusterFilterChips.map((chip) => (
                            <span
                              key={`cluster-${chip}`}
                              className="px-2 py-0.5 rounded-full bg-system-gray-50 border border-system-gray-200 text-[10px] text-system-gray-600"
                            >
                              {chip}
                            </span>
                          ))}
                          {activeGraphFilterChips.map((chip) => (
                            <span
                              key={`graph-${chip}`}
                              className="px-2 py-0.5 rounded-full bg-system-gray-50 border border-system-gray-200 text-[10px] text-system-gray-600"
                            >
                              {chip}
                            </span>
                          ))}
                          <Button variant="ghost" size="xs" onClick={resetGraphFilters}>
                            Reset
                          </Button>
                        </div>
                      </Panel>
                    )}

                    {/* Zoom Level Indicator */}
                    {zoomLevel < ZOOM_LABEL_HIDE_THRESHOLD && (
                      <Text
                        as="div"
                        variant="tiny"
                        className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-system-gray-900/75 backdrop-blur-md text-white px-4 py-2 rounded-full shadow-lg pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-300 z-50 border border-white/10"
                      >
                        Labels hidden at this zoom • Use Ctrl/Cmd + scroll or +/- to zoom in
                      </Text>
                    )}

                    {/* Keyboard shortcuts hint (subtle, bottom-left) */}
                    {nodes.length > 0 && zoomLevel >= ZOOM_LABEL_HIDE_THRESHOLD && (
                      <Text
                        as="div"
                        variant="tiny"
                        className="absolute bottom-3 left-3 text-system-gray-400 pointer-events-none z-10 flex items-center gap-1.5"
                      >
                        <kbd className="px-1 py-0.5 rounded bg-white/80 border border-system-gray-200 text-system-gray-500 font-mono shadow-sm">
                          ?
                        </kbd>
                        <span>for help</span>
                      </Text>
                    )}

                    {/* Performance notice (auto-hide) */}
                    {performanceNotice && (
                      <Text
                        as="div"
                        variant="tiny"
                        className="absolute top-4 left-1/2 -translate-x-1/2 bg-system-gray-900/80 backdrop-blur-md text-white px-3 py-1.5 rounded-full shadow-md pointer-events-none animate-in fade-in slide-in-from-top-1 duration-200 z-40 border border-white/10"
                      >
                        {performanceNotice}
                      </Text>
                    )}

                    {/* Filter chips */}
                    {activeClusterFilterChips.length > 0 && (
                      <Text
                        as="div"
                        variant="tiny"
                        className="absolute top-3 left-3 flex flex-wrap gap-2 text-system-gray-600"
                      >
                        {activeClusterFilterChips.map((chip) => (
                          <span
                            key={chip}
                            className="px-2 py-0.5 bg-white/80 border border-system-gray-200 rounded-full shadow-sm"
                          >
                            {chip}
                          </span>
                        ))}
                      </Text>
                    )}
                  </ReactFlow>
                </GraphErrorBoundary>
              )}
            </div>

            {/* Right: Details & Legend */}
            {!isGraphMaximized && (
              <div
                className="surface-panel p-0 flex flex-col h-full overflow-hidden"
                role="complementary"
                aria-label="Node Details"
              >
                <div className="p-4 border-b border-system-gray-100 bg-system-gray-50/50">
                  <Text as="div" variant="tiny" className={GRAPH_SIDEBAR_SECTION_TITLE}>
                    <Sparkles className="h-3.5 w-3.5 text-stratosort-blue" aria-hidden="true" />
                    <span>{selectedNode ? 'Node Details' : 'Legend'}</span>
                  </Text>
                </div>

                <div className="p-4 flex-1 min-h-0 overflow-y-auto panel-scroll">
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
                      ) : selectedKind === 'cluster' ? (
                        <div className="flex flex-col gap-6">
                          <div className="flex items-start gap-3 mb-2">
                            <div className="mt-1 p-2 bg-white border border-system-gray-200 rounded-lg shadow-sm text-amber-600">
                              <Layers className="h-5 w-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <Text
                                variant="small"
                                className="font-semibold text-system-gray-900 break-words leading-snug"
                              >
                                {selectedLabel}
                              </Text>
                              <Text
                                as="div"
                                variant="tiny"
                                className="text-system-gray-500 mt-1 flex flex-wrap gap-2"
                              >
                                <span className="px-2 py-0.5 bg-system-gray-100 rounded-full">
                                  {selectedNode.data?.memberCount || 0} files
                                </span>
                                <span className="px-2 py-0.5 bg-system-gray-100 rounded-full capitalize">
                                  {selectedNode.data?.confidence || 'low'} confidence
                                </span>
                                {selectedNode.data?.dominantCategory && (
                                  <span className="px-2 py-0.5 bg-system-gray-100 rounded-full">
                                    {selectedNode.data.dominantCategory}
                                  </span>
                                )}
                              </Text>
                            </div>
                          </div>

                          {(selectedNode.data?.topTerms?.length > 0 ||
                            selectedNode.data?.commonTags?.length > 0) && (
                            <div className="space-y-2">
                              <Text
                                as="div"
                                variant="tiny"
                                className="font-semibold text-system-gray-500 uppercase tracking-wider"
                              >
                                Why this cluster
                              </Text>
                              <div className="flex flex-wrap gap-1.5">
                                {(
                                  selectedNode.data?.topTerms ||
                                  selectedNode.data?.commonTags ||
                                  []
                                )
                                  .slice(0, 8)
                                  .map((term) => (
                                    <span
                                      key={term}
                                      className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-[11px]"
                                    >
                                      {term}
                                    </span>
                                  ))}
                              </div>
                            </div>
                          )}

                          {selectedClusterInfo?.bridges?.length > 0 && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <Text
                                  as="div"
                                  variant="tiny"
                                  className="font-semibold text-system-gray-500 uppercase tracking-wider"
                                >
                                  Related clusters
                                </Text>
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  className="text-system-gray-600 hover:text-system-gray-800"
                                  rightIcon={
                                    <ChevronRight
                                      className={`h-3.5 w-3.5 transition-transform ${
                                        isRelatedClustersOpen ? 'rotate-90' : 'rotate-0'
                                      }`}
                                    />
                                  }
                                  onClick={() => setIsRelatedClustersOpen((prev) => !prev)}
                                  aria-label={
                                    isRelatedClustersOpen
                                      ? 'Collapse related clusters'
                                      : 'Expand related clusters'
                                  }
                                >
                                  <span>
                                    {isRelatedClustersOpen
                                      ? 'Hide'
                                      : `Show (${selectedClusterInfo.bridges.length})`}
                                  </span>
                                </Button>
                              </div>

                              {isRelatedClustersOpen ? (
                                <div className="space-y-2">
                                  {selectedClusterInfo.bridges.map((bridge) => {
                                    const bridgeKey =
                                      bridge?.id || bridge?.targetId || bridge?.targetLabel || '';
                                    const isExpanded = Boolean(
                                      expandedRelatedClusters?.[bridgeKey]
                                    );
                                    const bridgeFiles = Array.isArray(bridge?.bridgeFiles)
                                      ? bridge.bridgeFiles
                                      : [];
                                    const showAllFiles = Boolean(
                                      showAllBridgeFilesByBridge?.[bridgeKey]
                                    );
                                    const visibleFiles = showAllFiles
                                      ? bridgeFiles
                                      : bridgeFiles.slice(0, 3);

                                    return (
                                      <div
                                        key={bridge.id}
                                        className="border border-system-gray-200 rounded-lg p-2 bg-system-gray-50"
                                      >
                                        <div className="flex items-start justify-between gap-2">
                                          <button
                                            type="button"
                                            className="min-w-0 flex-1 text-left"
                                            title="Select related cluster"
                                            onClick={() => {
                                              if (bridge?.targetId)
                                                graphActions.selectNode?.(bridge.targetId);
                                            }}
                                          >
                                            <Text
                                              as="div"
                                              variant="small"
                                              className="truncate text-system-gray-800 hover:text-stratosort-blue"
                                            >
                                              {bridge.targetLabel || bridge.targetId}
                                            </Text>
                                            <Text
                                              as="div"
                                              variant="tiny"
                                              className="text-system-gray-500 mt-0.5"
                                            >
                                              {Math.round((bridge.similarity || 0) * 100)}% match
                                            </Text>
                                          </button>

                                          <Button
                                            variant="ghost"
                                            size="xs"
                                            className="text-system-gray-600 hover:text-system-gray-800 shrink-0"
                                            rightIcon={
                                              <ChevronRight
                                                className={`h-3.5 w-3.5 transition-transform ${
                                                  isExpanded ? 'rotate-90' : 'rotate-0'
                                                }`}
                                              />
                                            }
                                            onClick={() =>
                                              setExpandedRelatedClusters((prev) => ({
                                                ...(prev || {}),
                                                [bridgeKey]: !prev?.[bridgeKey]
                                              }))
                                            }
                                            aria-label={
                                              isExpanded
                                                ? 'Hide related cluster details'
                                                : 'Show related cluster details'
                                            }
                                          >
                                            <span>
                                              {isExpanded ? 'Hide details' : 'Show details'}
                                            </span>
                                          </Button>
                                        </div>

                                        <Text
                                          as="div"
                                          variant="tiny"
                                          className="text-system-gray-600 mt-2 flex flex-wrap gap-1"
                                        >
                                          {(bridge.sharedTerms || [])
                                            .slice(0, isExpanded ? 8 : 3)
                                            .map((t) => (
                                              <span
                                                key={t}
                                                className="px-1.5 py-0.5 bg-white border border-system-gray-200 rounded text-[10px]"
                                              >
                                                {t}
                                              </span>
                                            ))}
                                          {bridge.bridgeCount > 0 && (
                                            <span className="px-1.5 py-0.5 bg-white border border-system-gray-200 rounded text-[10px]">
                                              {bridge.bridgeCount} bridge file
                                              {bridge.bridgeCount === 1 ? '' : 's'}
                                            </span>
                                          )}
                                        </Text>

                                        {isExpanded && bridgeFiles.length > 0 && (
                                          <div className="mt-2 space-y-1 max-h-40 overflow-y-auto pr-1">
                                            {visibleFiles.map((file) => (
                                              <div
                                                key={file?.path || file?.id || file}
                                                className="flex items-center justify-between text-xs text-system-gray-700 bg-white border border-system-gray-100 rounded px-2 py-1"
                                              >
                                                <span className="truncate flex-1 mr-2">
                                                  {file?.name || file?.path || file}
                                                </span>
                                                {file?.path && (
                                                  <div className="flex gap-1">
                                                    <Button
                                                      variant="ghost"
                                                      size="xs"
                                                      onClick={() => openFile(file.path)}
                                                      aria-label="Open bridge file"
                                                      title="Open"
                                                    >
                                                      <ExternalLink className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button
                                                      variant="ghost"
                                                      size="xs"
                                                      onClick={() => revealFile(file.path)}
                                                      aria-label="Reveal bridge file"
                                                      title="Reveal"
                                                    >
                                                      <FolderOpen className="h-3.5 w-3.5" />
                                                    </Button>
                                                  </div>
                                                )}
                                              </div>
                                            ))}

                                            {bridgeFiles.length > 3 && (
                                              <div className="flex items-center justify-between pt-1">
                                                <div className="text-[11px] text-system-gray-500">
                                                  {showAllFiles
                                                    ? `Showing ${bridgeFiles.length} files`
                                                    : `+${bridgeFiles.length - 3} more`}
                                                </div>
                                                <Button
                                                  variant="ghost"
                                                  size="xs"
                                                  className="text-system-gray-600 hover:text-system-gray-800"
                                                  onClick={() =>
                                                    setShowAllBridgeFilesByBridge((prev) => ({
                                                      ...(prev || {}),
                                                      [bridgeKey]: !prev?.[bridgeKey]
                                                    }))
                                                  }
                                                >
                                                  <span>
                                                    {showAllFiles ? 'Show less' : 'Show all'}
                                                  </span>
                                                </Button>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <Text as="div" variant="tiny" className="text-system-gray-500">
                                  Hidden to reduce clutter. Expand to explore bridges to other
                                  clusters.
                                </Text>
                              )}
                            </div>
                          )}

                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setFocusNodeId(selectedNode.id);
                                setFocusDepth(0);
                                setGraphStatus('Focus: selected cluster only');
                              }}
                            >
                              <Maximize2 className="h-4 w-4" />
                              <span>Show only cluster</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setFocusNodeId(selectedNode.id);
                                setFocusDepth(1);
                                setGraphStatus('Focus: selected cluster + neighbors');
                              }}
                            >
                              <Layers className="h-4 w-4" />
                              <span>Show neighbors</span>
                            </Button>
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
                                <Text
                                  variant="small"
                                  className="font-semibold text-system-gray-900 break-words leading-snug"
                                >
                                  {selectedLabel}
                                </Text>
                                <Text
                                  as="div"
                                  variant="tiny"
                                  className="text-system-gray-500 mt-1 capitalize px-2 py-0.5 bg-system-gray-100 rounded-full inline-block"
                                >
                                  {selectedKind} Node
                                </Text>
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
                                <Text
                                  as="div"
                                  variant="tiny"
                                  className="font-semibold text-system-gray-500 uppercase tracking-wider"
                                >
                                  Analysis
                                </Text>
                                <div className="bg-system-gray-50 rounded-lg p-3 border border-system-gray-100">
                                  {subject && (
                                    <Text
                                      variant="small"
                                      className="font-medium text-system-gray-800 mb-1"
                                    >
                                      {subject}
                                    </Text>
                                  )}
                                  {summary && (
                                    <Text
                                      variant="tiny"
                                      className="text-system-gray-600 leading-relaxed"
                                    >
                                      {summary}
                                    </Text>
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
                                <Text
                                  as="div"
                                  variant="tiny"
                                  className="font-semibold text-system-gray-500 uppercase tracking-wider"
                                >
                                  Tags
                                </Text>
                                <div className="flex flex-wrap gap-1.5">
                                  {tags.map((tag) => (
                                    <Text
                                      as="span"
                                      variant="tiny"
                                      key={tag}
                                      className="px-2 py-0.5 rounded-full bg-system-gray-100 text-system-gray-600 border border-system-gray-200"
                                    >
                                      {tag}
                                    </Text>
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
                                <Text
                                  as="div"
                                  variant="tiny"
                                  className="font-semibold text-system-gray-500 uppercase tracking-wider"
                                >
                                  Content Preview
                                </Text>
                                <div className="bg-white border border-system-gray-100 rounded-lg p-3 max-h-48 overflow-y-auto">
                                  <Text
                                    variant="tiny"
                                    className="text-system-gray-600 whitespace-pre-wrap leading-relaxed"
                                  >
                                    {String(
                                      selectedDocumentDetails?.analysis?.extractedText ||
                                        selectedNode.data?.content
                                    ).slice(0, 500)}
                                    {String(
                                      selectedDocumentDetails?.analysis?.extractedText ||
                                        selectedNode.data?.content
                                    ).length > 500 && '...'}
                                  </Text>
                                </div>
                              </div>
                            )
                          )}

                          {/* Properties Section */}
                          {selectedPath && (
                            <div className="space-y-2">
                              <Text
                                as="div"
                                variant="tiny"
                                className="font-semibold text-system-gray-500 uppercase tracking-wider"
                              >
                                Properties
                              </Text>
                              <div className="bg-system-gray-50 rounded-lg p-3 border border-system-gray-100 space-y-2">
                                <div>
                                  <Text
                                    as="div"
                                    variant="tiny"
                                    className="text-system-gray-400 uppercase tracking-wide mb-0.5"
                                  >
                                    Path
                                  </Text>
                                  <Text
                                    as="div"
                                    variant="tiny"
                                    className="text-system-gray-700 font-mono break-all leading-relaxed select-all"
                                  >
                                    {selectedPath}
                                  </Text>
                                </div>
                                {selectedNode.data?.score > 0 && (
                                  <div>
                                    <Text
                                      as="div"
                                      variant="tiny"
                                      className="text-system-gray-400 uppercase tracking-wide mb-0.5"
                                    >
                                      Relevance Score
                                    </Text>
                                    <Text as="div" variant="tiny" className="text-system-gray-700">
                                      {Math.round(selectedNode.data.score * 100)}%
                                    </Text>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Notes Section */}
                          <div className="space-y-2">
                            <Text
                              as="div"
                              variant="tiny"
                              className="font-semibold text-system-gray-500 uppercase tracking-wider flex justify-between"
                            >
                              <span>Notes</span>
                            </Text>
                            <Textarea
                              className="w-full text-sm"
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
                            <Text
                              as="div"
                              variant="tiny"
                              className="font-semibold text-system-gray-500 uppercase tracking-wider flex justify-between"
                            >
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
                            </Text>
                            <div className="flex flex-col gap-1.5 mt-1">
                              {(() => {
                                const neighborsMap = new Map();
                                edges
                                  .filter(
                                    (e) =>
                                      e.source === selectedNode.id || e.target === selectedNode.id
                                  )
                                  .forEach((e) => {
                                    const otherId =
                                      e.source === selectedNode.id ? e.target : e.source;
                                    if (!otherId) return;
                                    const similarity = e.data?.similarity;
                                    const existing = neighborsMap.get(otherId);
                                    if (existing) {
                                      if (
                                        typeof similarity === 'number' &&
                                        (typeof existing.similarity !== 'number' ||
                                          similarity > existing.similarity)
                                      ) {
                                        neighborsMap.set(otherId, {
                                          ...existing,
                                          similarity
                                        });
                                      }
                                      return;
                                    }
                                    const otherNode = nodes.find((n) => n.id === otherId);
                                    neighborsMap.set(otherId, {
                                      id: otherId,
                                      label: otherNode?.data?.label || otherNode?.id || 'Unknown',
                                      kind: otherNode?.data?.kind || 'file',
                                      similarity
                                    });
                                  });
                                const neighbors = Array.from(neighborsMap.values());

                                if (neighbors.length === 0)
                                  return (
                                    <Text
                                      as="div"
                                      variant="tiny"
                                      className="text-system-gray-400 italic"
                                    >
                                      No direct connections
                                    </Text>
                                  );

                                return neighbors.slice(0, 10).map((n) => {
                                  const icon =
                                    n.kind === 'query' ? (
                                      <SearchIcon className="h-3 w-3 text-system-gray-400" />
                                    ) : n.kind === 'cluster' ? (
                                      <Layers className="h-3 w-3 text-system-gray-400" />
                                    ) : (
                                      <FileText className="h-3 w-3 text-system-gray-400" />
                                    );
                                  return (
                                    <Button
                                      key={n.id}
                                      variant="ghost"
                                      size="sm"
                                      leftIcon={icon}
                                      onClick={() => graphActions.selectNode(n.id)}
                                      className="w-full justify-between h-auto px-2 py-1.5 rounded-md text-left text-[11px] text-system-gray-700 hover:bg-system-gray-100"
                                    >
                                      <span className="flex-1 min-w-0 truncate group-hover:text-stratosort-blue">
                                        {n.label}
                                      </span>
                                      {typeof n.similarity === 'number' ? (
                                        <span className="text-[10px] text-system-gray-400">
                                          {Math.round(n.similarity * 100)}%
                                        </span>
                                      ) : null}
                                    </Button>
                                  );
                                });
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
                      {showClusters || nodes.length > 0 ? (
                        <div className="space-y-4">
                          <div className={`${GRAPH_SIDEBAR_CARD} space-y-3`}>
                            <div className="flex items-center justify-between">
                              <Text
                                as="div"
                                variant="tiny"
                                className="font-semibold text-system-gray-600 uppercase tracking-wider"
                              >
                                {showClusters ? 'Cluster Legend' : 'Graph Legend'}
                              </Text>
                              <Text as="div" variant="tiny" className="text-system-gray-400">
                                Click to filter
                              </Text>
                            </div>
                            <ClusterLegend
                              showHeader={false}
                              className="shadow-none border-none p-0 bg-transparent w-full"
                              activeFilters={activeFilters}
                              onToggleFilter={handleToggleFilter}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center py-12 text-system-gray-400">
                          <div className="w-12 h-12 rounded-full bg-system-gray-100 flex items-center justify-center mb-3">
                            <Sparkles className="w-6 h-6 text-system-gray-300" />
                          </div>
                          <Text variant="small" className="font-medium text-system-gray-600">
                            No Selection
                          </Text>
                          <Text variant="tiny" className="text-system-gray-400 mt-1 max-w-[200px]">
                            Select a node to view details, or run a search to populate the graph.
                          </Text>
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
